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
    private let uploader: AttachmentUploader
    private let realtime: RealtimeCoordinator

    private var messagesTask: Task<Void, Never>?
    private var chatTask: Task<Void, Never>?
    private var olderCursor: String?
    private var reachedBeginning = false
    private var didPickAnchor = false
    private var draftTask: Task<Void, Never>?
    private var lastReadSent: String?
    private var lastReadAt: Date?
    private var lastActionAt: Date?
    private var messages: [MessageRecord] = []

    init(
        chatID: String,
        viewerID: String,
        database: AppDatabase = AppServices.database,
        api: ChatMessagesFetching = ChatsAPI(),
        store: MessageStore? = nil,
        outbox: MessageOutbox? = nil,
        uploader: AttachmentUploader? = nil,
        realtime: RealtimeCoordinator = AppServices.realtime
    ) {
        self.chatID = chatID
        self.viewerID = viewerID
        self.database = database
        self.api = api
        self.store = store ?? MessageStore(database: database)
        self.outbox = outbox ?? MessageOutbox(database: database)
        self.uploader = uploader ?? AttachmentUploader(database: database)
        self.realtime = realtime
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

    /// Вход в чат: комната сокета плюс обычное открытие.
    @MainActor
    func enter() async {
        await realtime.open(chatID: chatID)
        await open()
    }

    /// Уход с экрана: комнату отпускаем и гасим свою подпись — иначе собеседник
    /// будет видеть «печатает…» у закрытого чата.
    @MainActor
    func leave() async {
        await realtime.send(action: nil, chatID: chatID)
        await realtime.close(chatID: chatID)
    }

    /// Связь вернулась — догоняем пропущенное. События за время обрыва никто не
    /// переприсылает (PROJECT.md §9.2c).
    @MainActor
    func catchUpAfterReconnect() async {
        let known = (try? await store.lastSeq(chatID: chatID)) ?? 0
        guard known > 0 else { return await loadLatest() }
        await catchUp(since: known)
    }

    /// Кто сейчас печатает или записывает голосовое в этом чате.
    var othersAction: String? {
        realtime.actions[chatID]?.values.first
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
        // Сообщение ушло — подпись «печатает…» снимаем явно, не дожидаясь таймера.
        lastActionAt = nil
        await realtime.send(action: nil, chatID: chatID)
    }

    /// Отправить вложение. Подпись к нему — текущий текст поля ввода: так же, как
    /// в вебе, отдельной формы для подписи нет.
    @MainActor
    func attach(_ attachment: OutgoingAttachment) async {
        let caption = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let answering = replyTo?.remoteId
        draft = ""
        replyTo = nil
        await persistDraft("")

        // Подпись о загрузке — не сразу: сжатый снимок улетает за доли секунды, и
        // она успела бы только мигнуть (PROJECT.md §9.1a).
        let action = Self.action(for: attachment.mime, name: attachment.name)
        let notifier = Task { [realtime, chatID] in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            await realtime.send(action: action, chatID: chatID)
        }

        await uploader.send(
            attachment,
            chatID: chatID,
            senderID: viewerID,
            caption: caption.isEmpty ? nil : caption,
            replyToID: answering
        )

        notifier.cancel()
        await realtime.send(action: nil, chatID: chatID)
    }

    private static func action(for mime: String, name: String?) -> String {
        if mime.hasPrefix("audio/") { return "RECORDING_VOICE" }
        if mime.hasPrefix("image/") { return "UPLOADING_PHOTO" }
        if mime.hasPrefix("video/") { return "UPLOADING_VIDEO" }
        return "UPLOADING_FILE"
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

    /// Отметить прочитанным до последнего чужого сообщения.
    ///
    /// Шлём не чаще раза в 800 мс и только то, что действительно новее прошлой
    /// отметки: сервер двигает её только вперёд, а лишние события — это трафик на
    /// каждом прокруте.
    @MainActor
    func markRead() async {
        guard let last = messages.last(where: { $0.senderId != viewerID && $0.remoteId != nil }),
            let id = last.remoteId,
            id != lastReadSent
        else { return }
        if let sentAt = lastReadAt, Date().timeIntervalSince(sentAt) < 0.8 { return }
        lastReadSent = id
        lastReadAt = Date()
        await realtime.markRead(chatID: chatID, messageID: id)
    }

    @MainActor
    func draftChanged() {
        noteTyping()
        draftTask?.cancel()
        let text = draft
        draftTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            await self?.persistDraft(text)
        }
    }

    /// Подтверждение набора отправляется не чаще раза в три секунды (§9.1a):
    /// получатель гасит подпись через четыре, и чаще подтверждать незачем.
    @MainActor
    private func noteTyping() {
        if let sentAt = lastActionAt, Date().timeIntervalSince(sentAt) < 3 { return }
        lastActionAt = Date()
        Task { [realtime, chatID] in await realtime.send(action: "TYPING", chatID: chatID) }
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
        let id = chatID
        // Сообщения и вложения читаем одним наблюдением: раздельные дали бы кадр,
        // где картинка уже пришла, а сообщения под неё ещё нет.
        let observation = ValueObservation.tracking { db -> ThreadSnapshot in
            let messages = try request.fetchAll(db)
            let attachments = try AttachmentRecord.fetchAll(
                db,
                sql: """
                    SELECT a.* FROM attachment a
                    JOIN message m ON m.id = a.messageId
                    WHERE m.chatId = ?
                    """,
                arguments: [id]
            )
            return ThreadSnapshot(
                messages: messages,
                attachments: Dictionary(grouping: attachments, by: \.messageId)
            )
        }
        messagesTask = Task { @MainActor [weak self, database] in
            guard let self else { return }
            for await snapshot in AsyncValues.stream(of: observation, in: database.reader) {
                self.messages = snapshot.messages
                self.days = MessageTimeline.build(
                    from: snapshot.messages,
                    attachments: snapshot.attachments,
                    viewerID: self.viewerID
                )
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


/// Срез переписки: сообщения и их вложения, прочитанные одним запросом.
struct ThreadSnapshot: Equatable {
    let messages: [MessageRecord]
    let attachments: [String: [AttachmentRecord]]
}
