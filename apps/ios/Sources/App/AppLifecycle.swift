import Foundation
import Observation

/// Жизненный цикл приложения для экранов (P1-10 аудита).
///
/// Раньше при возврате из фона обновлялись только сокет и первая страница чатов: открытая
/// «Главная» или журнал показывали данные многочасовой давности, пока человек сам не
/// потянет список, а опрос сервера (камеры, аудитории, QR посещаемости) в фоне не вставал
/// на паузу. Теперь:
/// - `foregroundEpoch` растёт, когда приложение вернулось после паузы дольше `staleAfter`:
///   видимые `RemoteContent` и `PagedList` перечитывают себя (короткий выход за
///   уведомлением запросов не порождает);
/// - `waitUntilActive()` держит цикл опроса, пока приложение в фоне.
///
/// Без SwiftUI намеренно: фазу сцены переводит `AppShellView`, а логика проверяется тестами.
@MainActor
@Observable
final class AppLifecycle {
    static let shared = AppLifecycle()

    private(set) var isActive = true
    private(set) var foregroundEpoch = 0

    @ObservationIgnored private var backgroundedAt: Date?
    @ObservationIgnored private var waiters: [CheckedContinuation<Void, Never>] = []

    /// Сколько нужно провести в фоне, чтобы видимое считалось несвежим.
    static let staleAfter: TimeInterval = 60

    func enterBackground(at now: Date = Date()) {
        guard isActive else { return }
        isActive = false
        backgroundedAt = now
    }

    func becomeActive(at now: Date = Date()) {
        guard !isActive else { return }
        isActive = true
        if let backgroundedAt, now.timeIntervalSince(backgroundedAt) >= Self.staleAfter {
            foregroundEpoch &+= 1
        }
        backgroundedAt = nil
        let resumed = waiters
        waiters = []
        for waiter in resumed { waiter.resume() }
    }

    /// Дождаться переднего плана. На переднем плане — сразу.
    func waitUntilActive() async {
        guard !isActive else { return }
        await withCheckedContinuation { waiters.append($0) }
    }
}
