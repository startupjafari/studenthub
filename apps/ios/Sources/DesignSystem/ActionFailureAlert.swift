import SwiftUI

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
