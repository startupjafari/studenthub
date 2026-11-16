import SwiftUI
import UIKit

/// Единая точка ветвлений «под VoiceOver» (IOS_RULES 11.5.1).
///
/// Код, который раскладывается под VoiceOver иначе (нет плавающей даты, история не уходит
/// сама), читает признак отсюда, а не из разбросанных `UIAccessibility.isVoiceOverRunning`:
/// иначе отладочная подмена дошла бы только до части мест, и тест проверял бы не то, что
/// видит человек с VoiceOver.
enum VoiceOver {
    /// Подмена для UI-тестов (`SH_UITEST_VOICEOVER=1`): симулятор VoiceOver не запускает,
    /// а раскладку «как под ним» проверить нужно. В Release строки переменной нет вовсе.
    static let forced: Bool = {
        #if DEBUG
            ProcessInfo.processInfo.environment["SH_UITEST_VOICEOVER"] == "1"
        #else
            false
        #endif
    }()

    /// Для UIKit-кода, где нет окружения SwiftUI: системный VoiceOver или тестовый.
    static var isRunning: Bool { UIAccessibility.isVoiceOverRunning || forced }
}

private struct VoiceOverOnKey: EnvironmentKey {
    static var defaultValue: Bool { VoiceOver.isRunning }
}

extension EnvironmentValues {
    /// Работает ли VoiceOver: системный или тестовая подмена. Читать вместо
    /// `accessibilityVoiceOverEnabled` — та только для чтения, и UI-тест её не включит.
    var voiceOverOn: Bool {
        get { self[VoiceOverOnKey.self] }
        set { self[VoiceOverOnKey.self] = newValue }
    }
}

/// Корень приложения передаёт вниз `voiceOverOn`, следя за системным VoiceOver.
private struct VoiceOverPolicyModifier: ViewModifier {
    @Environment(\.accessibilityVoiceOverEnabled) private var system

    func body(content: Content) -> some View {
        content.environment(\.voiceOverOn, system || VoiceOver.forced)
    }
}

extension View {
    /// Повесить на корень сцены рядом с `motionPolicy()`.
    func voiceOverPolicy() -> some View { modifier(VoiceOverPolicyModifier()) }
}
