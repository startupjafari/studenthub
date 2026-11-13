import Foundation
import Observation

/// Действие экрана: «идёт работа», ошибка и перечитывание после успеха (P2-3 аудита).
///
/// Одна и та же связка — `isWorking`, `do/catch`, `failure = error.userMessage`,
/// перезагрузка — была переписана в 14 экранах своей функцией `run`. Экран держит
/// `@State private var actions = ActionRunner()`, кнопки смотрят на `isWorking`, ошибку
/// показывает `.actionFailureAlert(actions)`.
@MainActor
@Observable
final class ActionRunner {
    private(set) var isWorking = false
    /// Текст отказа для алерта; `nil` — алерта нет.
    var failure: String?

    /// Выполнить действие; `then` — после успеха (обычно перечитать экран). Отмена —
    /// не ошибка: экран ушёл, алерт не нужен. `true` — действие прошло.
    @discardableResult
    func run(_ action: () async throws -> Void, then: () async -> Void = {}) async -> Bool {
        isWorking = true
        defer { isWorking = false }
        do {
            try await action()
            failure = nil
            await then()
            return true
        } catch is CancellationError {
            return false
        } catch {
            failure = error.userMessage
            return false
        }
    }
}
