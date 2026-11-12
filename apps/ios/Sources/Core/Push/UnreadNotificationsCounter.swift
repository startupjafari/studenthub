import Foundation
import Observation
import UserNotifications

/// Сколько непрочитанных уведомлений — одно число на всё приложение (п. 18 аудита).
///
/// Раньше колокольчик на «Главной», догон по тихому пушу (`BadgeCounter`) и бейдж иконки
/// спрашивали `notifications/unread-count` каждый сам — на холодном старте до трёх раз.
/// Теперь источник один: запрос в полёте — один на всех, свежий ответ (моложе `maxAge`)
/// не перезапрашивается, бейдж иконки ставится вместе с числом. Экран уведомлений
/// поправляет число сразу, когда что-то прочитано (`adjust`), — до ответа сервера.
///
/// TODO(PERFORMANCE_AUDIT «Требует бэкенда»: счётчик в ответе страницы уведомлений и
/// событием сокета) — тогда число придёт без отдельного запроса.
@MainActor
@Observable
final class UnreadNotificationsCounter {
    /// Последнее известное число; `nil` — ещё не спрашивали.
    private(set) var count: Int?

    @ObservationIgnored private let fetch: @Sendable () async throws -> Int
    @ObservationIgnored private let setBadge: @Sendable (Int) async -> Void
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private var inFlight: Task<Int?, Never>?
    @ObservationIgnored private var fetchedAt: Date?
    /// Растёт со сбросом (выход из аккаунта) и с каждой правкой на экране: ответ,
    /// запрошенный раньше, не перепишет ни чужое, ни только что поправленное число.
    @ObservationIgnored private var generation = 0
    /// Номер запроса в полёте — чтобы снять с полёта именно свой.
    @ObservationIgnored private var requestID = 0

    nonisolated init(
        fetch: @escaping @Sendable () async throws -> Int = UnreadNotificationsCounter.fetchFromServer,
        setBadge: @escaping @Sendable (Int) async -> Void = UnreadNotificationsCounter.applyBadge,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.fetch = fetch
        self.setBadge = setBadge
        self.now = now
    }

    /// Обновить, если число старше `maxAge` секунд. Запрос уже идёт — дождаться его.
    /// Нет связи — остаётся прежнее: старое число честнее нуля.
    @discardableResult
    func refresh(maxAge: TimeInterval = 15) async -> Int? {
        if let fetchedAt, let count, now().timeIntervalSince(fetchedAt) < maxAge { return count }
        if let inFlight {
            _ = await inFlight.value
            return count
        }
        let started = generation
        requestID += 1
        let request = requestID
        let fetch = fetch
        let task = Task { try? await fetch() }
        inFlight = task
        let value = await task.value
        // Сброс мог снять этот запрос и завести новый — чужой не трогаем.
        if requestID == request { inFlight = nil }
        guard started == generation, let value else { return count }
        count = value
        fetchedAt = now()
        await setBadge(value)
        return value
    }

    /// Прочитали (или откатили прочтение) на экране: число меняется сразу. Запрос,
    /// начатый раньше, этого числа уже не перепишет; следующее обновление — свежее.
    func adjust(by delta: Int) {
        guard delta != 0, let current = count else { return }
        let next = max(0, current + delta)
        generation += 1
        count = next
        // Своё число — свежее: колокольчик в ближайшие секунды не спросит сервер, который
        // мог ещё не получить «прочитано», и точка не вернётся.
        fetchedAt = now()
        let setBadge = setBadge
        Task { await setBadge(next) }
    }

    /// Выход из аккаунта: число прежнего человека не показывается и не ставится на иконку.
    func reset() {
        generation += 1
        inFlight?.cancel()
        inFlight = nil
        count = nil
        fetchedAt = nil
    }

    nonisolated static func fetchFromServer() async throws -> Int {
        try await FeedAPI().unreadNotifications()
    }

    nonisolated static func applyBadge(_ value: Int) async {
        try? await UNUserNotificationCenter.current().setBadgeCount(value)
    }
}
