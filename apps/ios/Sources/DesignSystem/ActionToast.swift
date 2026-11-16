import SwiftUI
import UIKit

/// Короткое сообщение сверху экрана, которое уходит само: «не сохранилось — нет связи»
/// после отката оптимистичного действия. Не алерт: откат — не повод останавливать
/// человека кнопкой «Понятно», но и молча возвращать переключатель нельзя.
///
/// Вид — как плашка «Текст скопирован» в переписке. Движение уважает «Уменьшение
/// движения»; появление сопровождается тактильным «ошибка» и объявлением VoiceOver.
private struct ActionToastModifier: ViewModifier {
    @Binding var message: String?
    var duration: Duration

    @Environment(\.motionReduced) private var reduceMotion
    @State private var hideTask: Task<Void, Never>?

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .top) {
                if let message {
                    Text(message)
                        .font(Typography.meta.weight(.semibold))
                        .foregroundStyle(Palette.foreground)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, Spacing.lg)
                        .padding(.vertical, Spacing.sm)
                        .floatingGlass(in: Capsule())
                        .padding(.top, Spacing.md)
                        .padding(.horizontal, Spacing.xl)
                        .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
                        .onTapGesture { self.message = nil }
                        .accessibilityAddTraits(.updatesFrequently)
                }
            }
            .animation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion), value: message)
            .sensoryFeedback(trigger: message) { _, next in next == nil ? nil : .error }
            .onChange(of: message) { _, next in
                hideTask?.cancel()
                guard let next else { return }
                UIAccessibility.post(notification: .announcement, argument: next)
                hideTask = Task { @MainActor in
                    try? await Task.sleep(for: duration)
                    guard !Task.isCancelled else { return }
                    self.message = nil
                }
            }
            .onDisappear { hideTask?.cancel() }
    }
}

extension View {
    /// Плашка-сообщение сверху, пока `message` не `nil`; через `duration` сама уходит.
    func actionToast(_ message: Binding<String?>, duration: Duration = .seconds(2.5)) -> some View {
        modifier(ActionToastModifier(message: message, duration: duration))
    }
}
