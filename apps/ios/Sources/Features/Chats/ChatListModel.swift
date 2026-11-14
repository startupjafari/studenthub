import Foundation
import GRDB
import Observation
import os

/// Список чатов.
///
/// Экран читает базу, а не сеть: наблюдаемый запрос GRDB сам присылает новый срез
/// после любой записи — пришла ли она со списка, из сокета или от свайпа по строке.
/// Поэтому действия ничего не «перерисовывают» руками.
@Observable
final class ChatListModel {
    private(set) var rows: [ChatListRow] = []
    private(set) var tabs: [ChatListTab] = [.all]
    private(set) var tab: ChatListTab = .all
    private(set) var isRefreshing = false
    /// Архивные чаты — для строки «Архив» над списком, как в Telegram.
    private(set) var archived: [ChatListRow] = []
    /// Растёт на каждом живом изменении списка — новом срезе базы после первого.
    /// Экран анимирует по нему перестановку строк и счётчики; первый срез (открытие
    /// экрана, смена вкладки) ревизию не трогает и встаёт сразу, без пролёта строк.
    private(set) var liveRevision = 0
    /// Сообщение о последней неудаче. Список при этом продолжает работать: он читает
    /// базу, и отсутствие сети ему не мешает.
    private(set) var failure: String?
    /// Последнее обновление не прошло из-за связи — пустой экран говорит «нет связи».
    private(set) var isOffline = false
    /// Сбой обновления списка — отдельно от отказа действия (удалить, очистить): пустой
    /// экран с ошибкой загрузки говорит только о первом.
    private(set) var loadFailure: String?
    /// Счётчики вкладок папок и теги папок для строк — по правилу состава папки.
    private(set) var folderSummary = ChatFolderSummary()

    private let database: AppDatabase
    private let api: ChatsFetching
    private let store: ChatStore
    private let actions: ChatActing
    private let listActions: ChatListActing

    private var rowsTask: Task<Void, Never>?
    private var tabsTask: Task<Void, Never>?
    private var archiveTask: Task<Void, Never>?
    private var summaryTask: Task<Void, Never>?

    /// Сколько страниц списка тянем за один заход. Страница — сотня чатов; пять
    /// страниц покрывают любого живого человека, а бесконечный цикл по курсору на
    /// сломанном сервере крутился бы вечно.
    private static let maxPages = 5

    init(
        database: AppDatabase = AppServices.database,
        api: ChatsFetching = ChatsAPI(),
        store: ChatStore? = nil,
        actions: ChatActing = ChatsAPI(),
        listActions: ChatListActing = ChatsAPI()
    ) {
        self.database = database
        self.api = api
        self.store = store ?? ChatStore(database: database)
        self.actions = actions
        self.listActions = listActions
    }

    deinit {
        rowsTask?.cancel()
        tabsTask?.cancel()
        archiveTask?.cancel()
        summaryTask?.cancel()
    }

    /// Экран архива держит одну вкладку и за остальными не следит: иначе, разархивировав
    /// последний чат, он молча переключился бы на «Все».
    @MainActor
    func start(archive: Bool = false) {
        if archive {
            tab = .archive
            observeRows()
        } else {
            observeTabs()
            observeRows()
            observeArchive()
            observeFolderSummary()
        }
    }

    @MainActor
    func select(_ tab: ChatListTab) {
        guard tab != self.tab else { return }
        self.tab = tab
        observeRows()
    }

    /// Догнать сервер. Вызывается при открытии экрана и по жесту «потянуть вниз».
    @MainActor
    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        do {
            // Папки не зависят от страниц — запрос идёт параллельно, а не после всех
            // страниц (п. 45 аудита). Сбой страниц снимет и его (`async let`).
            let api = api
            async let folders = api.folders()
            var cursor: String?
            for _ in 0..<Self.maxPages {
                let page = try await api.chats(cursor: cursor, limit: ChatsAPI.pageLimit)
                try await store.save(chats: page.items)
                guard page.meta?.hasNext == true, let next = page.meta?.cursor else { break }
                cursor = next
            }
            try await store.save(folders: try await folders)
            failure = nil
            loadFailure = nil
            isOffline = false
        } catch is CancellationError {
            // Запрос отменили (ушли с вкладки, обновление перезапустилось) — это не сбой.
            // Раньше отмена показывалась общим «Что-то пошло не так» над списком.
            return
        } catch {
            failure = error.userMessage
            loadFailure = failure
            isOffline = error.isOffline
        }
    }

    // MARK: - Действия строки

    /// Все три действия устроены одинаково: пишем в базу сразу, затем говорим
    /// серверу. Отказ сервера откатываем — иначе список разойдётся с ним молча, и
    /// человек узнает об этом при следующем запуске.

    @MainActor
    func togglePinned(_ row: ChatListRow) async {
        await act(
            local: { try await store.setPinned(!row.isPinned, chatID: row.id) },
            remote: { try await api.setPinned(!row.isPinned, chatID: row.id) },
            rollback: { try await store.setPinned(row.isPinned, chatID: row.id) }
        )
    }

    @MainActor
    func toggleMuted(_ row: ChatListRow) async {
        await act(
            local: { try await store.setMuted(!row.muted, chatID: row.id) },
            remote: { try await api.setMuted(!row.muted, chatID: row.id) },
            rollback: { try await store.setMuted(row.muted, chatID: row.id) }
        )
    }

    @MainActor
    func toggleArchived(_ row: ChatListRow) async {
        let archived = row.archivedAt != nil
        await act(
            local: { try await store.setArchived(!archived, chatID: row.id) },
            remote: { try await api.setArchived(!archived, chatID: row.id) },
            rollback: { try await store.setArchived(archived, chatID: row.id) }
        )
    }

    /// Звук на время. Без срока — навсегда; «только важное» оставляет упоминания и
    /// ответы мне.
    @MainActor
    func mute(_ row: ChatListRow, minutes: Int?, importantOnly: Bool = false) async {
        await act(
            local: { try await store.setMuted(true, chatID: row.id) },
            remote: { try await actions.mute(chatID: row.id, minutes: minutes, importantOnly: importantOnly) },
            rollback: { try await store.setMuted(row.muted, chatID: row.id) }
        )
    }

    /// Прочитать, не открывая.
    @MainActor
    func markRead(_ row: ChatListRow) async {
        await markRead(chatIDs: [row.id])
    }

    /// «Пометить как новое» и обратно — из меню и свайпа строки. Непрочитанный чат
    /// (счётчик или пометка) читается целиком, прочитанный получает пометку.
    @MainActor
    func toggleMarkedUnread(_ row: ChatListRow) async {
        if row.isUnread {
            await markRead(chatIDs: [row.id])
            return
        }
        await act(
            local: { try await store.setMarkedUnread(true, chatID: row.id) },
            remote: { try await listActions.setMarkedUnread(true, chatID: row.id) },
            rollback: { try await store.setMarkedUnread(false, chatID: row.id) }
        )
    }

    /// Прочитать чаты целиком: `POST /chats/read` пачками по 200. Счётчики гаснут сразу,
    /// отказ сервера возвращает их. Старый сервер маршрута не знает — тогда как раньше,
    /// отметкой до последнего сообщения через сокет.
    @MainActor
    func markRead(chatIDs: [String]) async {
        guard !chatIDs.isEmpty else { return }
        let previous: [ChatReadSnapshot]
        do {
            previous = try await store.markRead(chatIDs: chatIDs)
        } catch {
            failure = String(localized: "chats.error.local", defaultValue: "Не удалось сохранить изменение")
            return
        }
        guard !previous.isEmpty else { return }
        let ids = previous.map(\.chatID)
        var sent = 0
        do {
            while sent < ids.count {
                let batch = Array(ids[sent..<min(sent + ChatsAPI.readBatch, ids.count)])
                try await listActions.readChats(batch)
                sent += batch.count
            }
            failure = nil
        } catch let error as APIError where error.code == .notFound && sent == 0 {
            await markReadBySocket(previous)
        } catch {
            // Прошедшие пачки сервер уже прочитал — возвращаем только остальные.
            try? await store.restore(Array(previous[sent...]))
            if !(error is CancellationError) { failure = error.userMessage }
        }
    }

    /// Непрочитанные чаты папки — «Прочитать все» из меню вкладки.
    @MainActor
    func markFolderRead(folderID: String) async {
        let ids = (try? await database.reader.read { db in
            try ChatListQuery.unreadChatIDs(folderID: folderID, in: db)
        }) ?? []
        await markRead(chatIDs: ids)
    }

    /// Перетаскивание в режиме «Изм.»: двигаются только закреплённые и только внутри
    /// своего блока — бросок ниже него ставит строку последней из закреплённых. Строки
    /// меняются сразу и синхронно: `List` ждёт новые данные тем же кадром, иначе строка
    /// на миг прыгает назад.
    @MainActor
    func movePinned(from source: IndexSet, to destination: Int) {
        let pinnedCount = rows.prefix(while: \.isPinned).count
        guard source.allSatisfy({ $0 < pinnedCount }) else { return }
        var next = rows
        next.move(fromOffsets: source, toOffset: min(destination, pinnedCount))
        guard next.map(\.id) != rows.map(\.id) else { return }
        rows = next
        let visible = next.prefix(pinnedCount).map(\.id)
        Task { await reorderPinned(visible) }
    }

    /// Новый порядок закреплённых, видимых на вкладке, — id сверху вниз. На вкладке папки
    /// видна только часть закреплённых: остальные остаются на своих местах, а видимые
    /// меняются местами между собой.
    @MainActor
    func reorderPinned(_ visible: [String]) async {
        let all = (try? await database.reader.read { db in try ChatListQuery.pinnedChatIDs(in: db) }) ?? []
        let shown = Set(visible)
        var next = visible.makeIterator()
        let order = all.map { shown.contains($0) ? (next.next() ?? $0) : $0 }
        guard order != all else { return }
        let previous: [String: Int?]
        do {
            previous = try await store.setPinnedOrder(order)
        } catch {
            failure = String(localized: "chats.error.local", defaultValue: "Не удалось сохранить изменение")
            return
        }
        do {
            try await listActions.setPinnedOrder(Array(order.prefix(100)))
            failure = nil
        } catch {
            try? await store.restorePinnedOrder(previous)
            if !(error is CancellationError) { failure = error.userMessage }
        }
    }

    /// Прочтение по-старому: отметка до последнего сообщения уходит сокетом, пометку
    /// «как новое» снимает отдельный маршрут.
    @MainActor
    private func markReadBySocket(_ reads: [ChatReadSnapshot]) async {
        for read in reads {
            if read.markedUnread {
                try? await listActions.setMarkedUnread(false, chatID: read.chatID)
            }
            guard read.unreadCount > 0 else { continue }
            let id = read.chatID
            let last: String?? = try? await database.reader.read { db in
                try ChatRecord.fetchOne(db, key: id)?.lastMessageId
            }
            guard let messageID = last ?? nil else { continue }
            await AppServices.realtime.markRead(chatID: id, messageID: messageID)
        }
        failure = nil
    }

    /// Очистить историю у себя: у собеседников переписка остаётся.
    @MainActor
    func clearHistory(_ row: ChatListRow) async {
        do {
            try await actions.clearHistory(chatID: row.id)
            try await MessageStore(database: database).clearHistory(chatID: row.id)
            failure = nil
        } catch {
            failure = message(for: error)
        }
    }

    /// Удалить личный чат, выйти из группы или удалить свою группу — решает сервер.
    @MainActor
    func delete(_ row: ChatListRow) async {
        do {
            try await actions.deleteChat(chatID: row.id)
            let id = row.id
            _ = try await database.writer.write { db in try ChatRecord.deleteOne(db, key: id) }
            failure = nil
        } catch {
            failure = message(for: error)
        }
    }

    // MARK: - Несколько чатов разом (режим правки)

    @MainActor
    func markRead(_ rows: [ChatListRow]) async {
        await markRead(chatIDs: rows.filter(\.isUnread).map(\.id))
    }

    @MainActor
    func setArchived(_ archived: Bool, rows: [ChatListRow]) async {
        for row in rows where (row.archivedAt != nil) != archived {
            await toggleArchived(row)
        }
    }

    @MainActor
    func delete(_ rows: [ChatListRow]) async {
        for row in rows {
            await delete(row)
        }
    }

    private func message(for error: Error) -> String {
        error.userMessage
    }

    // MARK: - Внутреннее

    @MainActor
    private func act(
        local: () async throws -> Void,
        remote: () async throws -> Void,
        rollback: () async throws -> Void
    ) async {
        do {
            try await local()
        } catch {
            failure = String(localized: "chats.error.local", defaultValue: "Не удалось сохранить изменение")
            return
        }
        do {
            try await remote()
            failure = nil
        } catch {
            try? await rollback()
            failure = error.userMessage
        }
    }

    @MainActor
    private func observeRows() {
        rowsTask?.cancel()
        let request = ChatListQuery.rows(for: tab)
        let observation = ValueObservation.tracking { db -> [ChatListRow] in
            let signpost = Signposts.chats.beginInterval("ChatListRead")
            let rows = try request.fetchAll(db)
            Signposts.chats.endInterval("ChatListRead", signpost, "rows: \(rows.count)")
            return rows
        }
        // Запись, не меняющая строк (страница истории, прочтение в открытом чате), не
        // будит список и не запускает анимацию перестановки.
        .removeDuplicates()
        rowsTask = Task { @MainActor [weak self, database] in
            var isFirst = true
            for await rows in AsyncValues.stream(of: observation, in: database.reader) {
                Signposts.chats.emitEvent("ChatListApply", "rows: \(rows.count)")
                self?.rows = rows
                if isFirst {
                    isFirst = false
                } else {
                    self?.liveRevision &+= 1
                }
            }
        }
    }

    @MainActor
    private func observeArchive() {
        archiveTask?.cancel()
        let request = ChatListQuery.rows(for: .archive)
        let observation = ValueObservation.tracking { db in try request.fetchAll(db) }
            .removeDuplicates()
        archiveTask = Task { @MainActor [weak self, database] in
            var isFirst = true
            for await rows in AsyncValues.stream(of: observation, in: database.reader) {
                self?.archived = rows
                // Строка «Архив» появляется и уходит той же анимацией, что и строки.
                if isFirst {
                    isFirst = false
                } else {
                    self?.liveRevision &+= 1
                }
            }
        }
    }

    @MainActor
    private func observeFolderSummary() {
        summaryTask?.cancel()
        let observation = ValueObservation.tracking { db in try ChatListQuery.folderSummary(in: db) }
            .removeDuplicates()
        summaryTask = Task { @MainActor [weak self, database] in
            for await summary in AsyncValues.stream(of: observation, in: database.reader) {
                self?.folderSummary = summary
            }
        }
    }

    @MainActor
    private func observeTabs() {
        tabsTask?.cancel()
        let observation = ValueObservation.tracking { db in try ChatListQuery.tabs(in: db) }
            .removeDuplicates()
        tabsTask = Task { @MainActor [weak self, database] in
            for await tabs in AsyncValues.stream(of: observation, in: database.reader) {
                self?.tabs = tabs
                // Папку удалили (здесь или на другом устройстве) — возвращаемся к «Все»,
                // иначе экран остался бы на вкладке, которой больше нет. Переименованная
                // папка — та же вкладка с новой подписью: остаёмся на ней.
                if let current = self?.tab, !tabs.contains(current) {
                    if case .folder(let id, _) = current, let renamed = tabs.first(where: { $0.folderID == id }) {
                        self?.tab = renamed
                    } else {
                        self?.select(.all)
                    }
                }
            }
        }
    }
}
