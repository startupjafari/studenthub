import Foundation
import GRDB
import Observation

/// Экран переписки.
///
/// Как и список, читает только базу: открывается мгновенно и в самолёте показывает
/// то, что успело скачаться. Сеть догоняет разницу и пишет её в базу — лента
/// перерисовывается сама.
@Observable
final class ChatThreadModel {
    let chatID: String

    private(set) var days: [MessageTimeline.Day] = []
    private(set) var title: String?
    private(set) var isLoadingOlder = false
    private(set) var failure: String?
    /// Первое непрочитанное на момент открытия. Лента прокручивается к нему один
    /// раз: дальше человек управляет сам.
    private(set) var openingAnchor: String?

    /// Текст в поле ввода. Черновик пишется в базу с задержкой: человек печатает
    /// быстрее, чем имеет смысл ходить в хранилище, но потерять написанное нельзя.
    var draft = ""
    /// На какое сообщение отвечаем.
    private(set) var replyTo: MessageRecord?

    private let viewerID: String
    private let database: AppDatabase
    private let api: ChatMessagesFetching
    private let store: MessageStore
    private let outbox: MessageOutbox

    private var messagesTask: Task<Void, Never>?
    private var chatTask: Task<Void, Never>?
    private var olderCursor: String?
    private var reachedBeginning = false
    private var didPickAnchor = false
    private var draftTask: Task<Void, Never>?
    private var messages: [MessageRecord] = []

    init(
        chatID: String,
        viewerID: String,
        database: AppDatabase = AppServices.database,
        api: ChatMessagesFetching = ChatsAPI(),
        store: MessageStore? = nil,
        outbox: MessageOutbox? = nil
    ) {
        self.chatID = chatID
        self.viewerID = viewerID
        self.database = database
        self.api = api
        self.store = store ?? MessageStore(database: database)
        self.outbox = outbox ?? MessageOutbox(database: database)
    }

    deinit {
        messagesTask?.cancel()
        chatTask?.cancel()
        draftTask?.cancel()
    }

    @MainActor
    func start() {
        observeMessages()
        observeChat()
        loadDraft()
    }

    /// Открытие чата: догнать разницу, а если истории нет вовсе — скачать последнюю
    /// страницу.
    @MainActor
    func open() async {
        let known = (try? await store.lastSeq(chatID: chatID)) ?? 0
        if known == 0 || messages.isEmpty {
            await loadLatest()
        } else {
            await catchUp(since: known)
        }
        // Неотправленное с прошлого раза дослать молча: человек нажал «отправить»
        // когда-то давно, и спрашивать его об этом снова незачем.
        await outbox.flush(chatID: chatID)
    }

    // MARK: - Отправка

    @MainActor
    func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        let answering = replyTo?.remoteId
        draft = ""
        replyTo = nil
        draftTask?.cancel()
        await persistDraft("")

        await outbox.send(text: text, chatID: chatID, senderID: viewerID, replyToID: answering)
    }

    @MainActor
    func retry(_ message: MessageRecord) async {
        await outbox.retry(message)
    }

    @MainActor
    func reply(to message: MessageRecord) {
        // Отвечать можно только на то, что уже знает сервер: у неотправленного нет
        // идентификатора, на который сослаться.
        guard message.remoteId != nil, message.deletedAt == nil else { return }
        replyTo = message
    }

    @MainActor
    func cancelReply() {
        replyTo = nil
    }

    // MARK: - Черновик

    @MainActor
    func draftChanged() {
        draftTask?.cancel()
        let text = draft
        draftTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            await self?.persistDraft(text)
        }
    }

    @MainActor
    private func loadDraft() {
        Task { @MainActor [weak self, database, chatID] in
            let stored = try? await database.reader.read { db in
                try DraftRecord.fetchOne(db, key: chatID)
            }
            guard let self, self.draft.isEmpty, let stored else { return }
            self.draft = stored.text
        }
    }

    @MainActor
    private func persistDraft(_ text: String) async {
        let chatID = chatID
        try? await database.writer.write { db in
            if text.isEmpty {
                _ = try DraftRecord.deleteOne(db, key: chatID)
                return
            }
            try DraftRecord(
                chatId: chatID,
                text: text,
                replyToId: nil,
                updatedAt: Date(),
                // Серверу черновик ещё не донесён: это сделает синхронизация списка.
                isSynced: false
            ).upsert(db)
        }
    }

    /// Подгрузка вверх. Вызывается, когда лента подъехала к началу загруженного.
    @MainActor
    func loadOlder() async {
        guard !isLoadingOlder, !reachedBeginning else { return }
        isLoadingOlder = true
        defer { isLoadingOlder = false }

        do {
            let page = try await api.messages(
                chatID: chatID,
                cursor: olderCursor,
                limit: ChatsAPI.messagePageLimit
            )
            try await store.save(messages: page.items, chatID: chatID)
            olderCursor = page.meta?.cursor
            reachedBeginning = page.meta?.hasNext != true
            failure = nil
        } catch {
            failure = message(for: error)
        }
    }

    // MARK: - Синхронизация

    @MainActor
    private func loadLatest() async {
        do {
            let page = try await api.messages(chatID: chatID, cursor: nil, limit: ChatsAPI.messagePageLimit)
            try await store.save(messages: page.items, chatID: chatID)
            olderCursor = page.meta?.cursor
            reachedBeginning = page.meta?.hasNext != true
            failure = nil
        } catch {
            failure = message(for: error)
        }
    }

    @MainActor
    private func catchUp(since: Int) async {
        do {
            // Отметка времени для правок и удалений — время самого свежего известного
            // сообщения. Своего времени последней синхронизации мы не храним, а всё,
            // что отредактировали позже этого момента, в ответ попадёт.
            let newest = messages.last?.createdAt
            let updates = try await api.updates(chatID: chatID, since: since, sinceTs: newest)
            if updates.overflow {
                // Разрыв больше серверного лимита: склеивать нечего, честнее
                // перекачать хвост заново.
                try await store.clearHistory(chatID: chatID)
                olderCursor = nil
                reachedBeginning = false
                await loadLatest()
                return
            }
            try await store.apply(updates, chatID: chatID)
            failure = nil
        } catch {
            failure = message(for: error)
        }
    }

    // MARK: - Наблюдение за базой

    @MainActor
    private func observeMessages() {
        messagesTask?.cancel()
        let request = store.messages(chatID: chatID)
        let observation = ValueObservation.tracking { db in try request.fetchAll(db) }
        messagesTask = Task { @MainActor [weak self, database] in
            guard let self else { return }
            for await rows in AsyncValues.stream(of: observation, in: database.reader) {
                self.messages = rows
                self.days = MessageTimeline.build(from: rows, viewerID: self.viewerID)
                self.pickAnchorIfNeeded()
            }
        }
    }

    @MainActor
    private func observeChat() {
        chatTask?.cancel()
        let id = chatID
        let observation = ValueObservation.tracking { db in try ChatRecord.fetchOne(db, key: id) }
        chatTask = Task { @MainActor [weak self, database] in
            guard let self else { return }
            for await chat in AsyncValues.stream(of: observation, in: database.reader) {
                self.title = chat?.title
                self.unreadCount = chat?.unreadCount ?? 0
                self.pickAnchorIfNeeded()
            }
        }
    }

    private var unreadCount = 0

    /// Якорь выбирается один раз за открытие: пересчитывать его на каждое новое
    /// сообщение значило бы дёргать ленту под пальцем.
    @MainActor
    private func pickAnchorIfNeeded() {
        guard !didPickAnchor, !messages.isEmpty else { return }
        didPickAnchor = true
        openingAnchor = MessageTimeline.firstUnreadID(
            in: messages,
            viewerID: viewerID,
            unreadCount: unreadCount
        )
    }

    private func message(for error: Error) -> String {
        (error as? APIError)?.displayMessage
            ?? String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
    }
}

/// Поток значений наблюдения GRDB.
///
/// Общий для всех экранов: ошибка чтения локальной базы не повод падать — список и
/// лента просто перестают обновляться, а показывают то, что уже прочитали.
enum AsyncValues {
    static func stream<T>(
        of observation: ValueObservation<ValueReducers.Fetch<T>>,
        in reader: any DatabaseReader
    ) -> AsyncStream<T> {
        AsyncStream { continuation in
            let cancellable = observation.start(
                in: reader,
                scheduling: .async(onQueue: .main),
                onError: { _ in continuation.finish() },
                onChange: { value in continuation.yield(value) }
            )
            continuation.onTermination = { _ in cancellable.cancel() }
        }
    }
}
