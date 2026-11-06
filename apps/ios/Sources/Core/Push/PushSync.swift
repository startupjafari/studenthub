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
struct BadgeCounter: Sendable {
    private let client: APIClient

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    func refresh() async {
        struct Answer: Decodable { let count: Int }
        guard let answer = try? await client.send(.get("notifications/unread-count"), as: Answer.self) else {
            return
        }
        try? await UNUserNotificationCenter.current().setBadgeCount(answer.count)
    }

    /// Выход из аккаунта: чужое число на иконке следующему человеку ни к чему.
    func reset() async {
        try? await UNUserNotificationCenter.current().setBadgeCount(0)
    }
}
