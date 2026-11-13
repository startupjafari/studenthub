import Observation
import SwiftUI

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

extension View {
    /// Алерт отказа действия: текст ошибки, кнопка «Понятно».
    func actionFailureAlert(_ message: Binding<String?>) -> some View {
        alert(
            String(localized: "feed.actionFailed", defaultValue: "Не получилось"),
            isPresented: Binding(get: { message.wrappedValue != nil }, set: { if !$0 { message.wrappedValue = nil } })
        ) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        } message: {
            Text(message.wrappedValue ?? "")
        }
    }

    /// Тот же алерт для `ActionRunner`.
    func actionFailureAlert(_ runner: ActionRunner) -> some View {
        actionFailureAlert(Bindable(runner).failure)
    }
}
