import Foundation
import GRDB
import UserNotifications

/// Что делать по тихому пушу.
///
/// Отдельный тип, а не метод делегата: у системы на фоновую доставку считаные
/// секунды, и список действий должен быть виден целиком, а не разбросан по
/// обработчику.
struct PushSync: Sendable {
    private let api: ChatsFetching
    private let store: ChatStore
    private let badge: BadgeCounter

    init(
        api: ChatsFetching = ChatsAPI(),
        store: ChatStore? = nil,
        badge: BadgeCounter = BadgeCounter()
    ) {
        self.api = api
        self.store = store ?? ChatStore()
        self.badge = badge
    }

    /// Догнать список чатов и обновить бейдж. `false` — не получилось, система
    /// учтёт это при решении, давать ли фоновое время в следующий раз.
    @discardableResult
    func catchUp() async -> Bool {
        do {
            let page = try await api.chats(cursor: nil, limit: ChatsAPI.pageLimit)
            try await store.save(chats: page.items)
            await badge.refresh()
            return true
        } catch {
            return false
        }
    }
}

/// Число на иконке.
///
/// Считаем по своей базе, а не по счётчику из пуша: пуши теряются, приходят не по
/// порядку и не приходят вовсе при выключенных уведомлениях, а база — то, что
/// человек увидит, открыв приложение.
struct BadgeCounter: Sendable {
    private let database: AppDatabase

    init(database: AppDatabase = AppServices.database) {
        self.database = database
    }

    func refresh() async {
        let unread = (try? await database.reader.read { db in
            try Int.fetchOne(
                db,
                sql: "SELECT COALESCE(SUM(unreadCount), 0) FROM chat WHERE archivedAt IS NULL"
            ) ?? 0
        }) ?? 0
        try? await UNUserNotificationCenter.current().setBadgeCount(unread)
    }
}
