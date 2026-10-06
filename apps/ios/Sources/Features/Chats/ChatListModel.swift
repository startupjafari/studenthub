import Foundation
import GRDB
import Observation

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
    /// Сообщение о последней неудаче. Список при этом продолжает работать: он читает
    /// базу, и отсутствие сети ему не мешает.
    private(set) var failure: String?

    private let database: AppDatabase
    private let api: ChatsFetching
    private let store: ChatStore

    private var rowsTask: Task<Void, Never>?
    private var tabsTask: Task<Void, Never>?

    /// Сколько страниц списка тянем за один заход. Страница — сотня чатов; пять
    /// страниц покрывают любого живого человека, а бесконечный цикл по курсору на
    /// сломанном сервере крутился бы вечно.
    private static let maxPages = 5

    init(
        database: AppDatabase = AppServices.database,
        api: ChatsFetching = ChatsAPI(),
        store: ChatStore? = nil
    ) {
        self.database = database
        self.api = api
        self.store = store ?? ChatStore(database: database)
    }

    deinit {
        rowsTask?.cancel()
        tabsTask?.cancel()
    }

    @MainActor
    func start() {
        observeTabs()
        observeRows()
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
            var cursor: String?
            for _ in 0..<Self.maxPages {
                let page = try await api.chats(cursor: cursor, limit: ChatsAPI.pageLimit)
                try await store.save(chats: page.items)
                guard page.meta?.hasNext == true, let next = page.meta?.cursor else { break }
                cursor = next
            }
            try await store.save(folders: try await api.folders())
            failure = nil
        } catch {
            failure = (error as? APIError)?.displayMessage
                ?? String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
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
            failure = (error as? APIError)?.displayMessage
                ?? String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
        }
    }

    @MainActor
    private func observeRows() {
        rowsTask?.cancel()
        let request = ChatListQuery.rows(for: tab)
        let observation = ValueObservation.tracking { db in try request.fetchAll(db) }
        rowsTask = Task { @MainActor [weak self, database] in
            guard let values = self?.values(of: observation, in: database.reader) else { return }
            for await rows in values {
                self?.rows = rows
            }
        }
    }

    @MainActor
    private func observeTabs() {
        tabsTask?.cancel()
        let observation = ValueObservation.tracking { db in try ChatListQuery.tabs(in: db) }
        tabsTask = Task { @MainActor [weak self, database] in
            guard let values = self?.values(of: observation, in: database.reader) else { return }
            for await tabs in values {
                self?.tabs = tabs
                // Папку удалили на другом устройстве — возвращаемся к «Все», иначе
                // экран остался бы на вкладке, которой больше нет.
                if let current = self?.tab, !tabs.contains(current) {
                    self?.select(.all)
                }
            }
        }
    }

    /// Поток значений наблюдения, в котором ошибка чтения не роняет экран: база
    /// локальная, и единственная причина сбоя — повреждение файла, с которым список
    /// всё равно ничего не сделает.
    private func values<T>(
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
