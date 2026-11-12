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
/// То же число, что сервер кладёт в `aps.badge` каждого пуша, — непрочитанные
/// уведомления (`GET /notifications/unread-count`). Раньше приложение ставило сумму
/// непрочитанного по чатам: пуш показывал одно, открытое приложение — другое, и бейдж
/// прыгал. Нет связи — не трогаем: старое число честнее, чем ноль.
///
/// Число берётся у общего счётчика (`UnreadNotificationsCounter`, п. 18 аудита): он же
/// у колокольчика, и запрос в полёте — один на всех. Догон по пушу просит свежее число
/// (`maxAge: 0`), но к уже идущему запросу присоединяется.
struct BadgeCounter: Sendable {
    func refresh() async {
        await AppServices.unreadNotifications.refresh(maxAge: 0)
    }

    /// Выход из аккаунта: чужое число на иконке следующему человеку ни к чему.
    func reset() async {
        await AppServices.unreadNotifications.reset()
        try? await UNUserNotificationCenter.current().setBadgeCount(0)
    }
}
