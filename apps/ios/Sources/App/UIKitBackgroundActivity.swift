import UIKit

/// Фоновое задание iOS (`beginBackgroundTask`) для `BackgroundActivity`.
struct UIKitBackgroundActivity: BackgroundActivity {
    func begin(_ name: String) async -> BackgroundActivityToken {
        await MainActor.run {
            let token = BackgroundActivityToken()
            let id = UIApplication.shared.beginBackgroundTask(withName: name) {
                // Время вышло: задание закрываем, работа сама закончится ошибкой сети.
                // Обработчик система зовёт на главном потоке.
                MainActor.assumeIsolated { Self.finish(token) }
            }
            if id != .invalid { token.identifier = id.rawValue }
            return token
        }
    }

    func end(_ token: BackgroundActivityToken) async {
        await MainActor.run { Self.finish(token) }
    }

    @MainActor
    private static func finish(_ token: BackgroundActivityToken) {
        guard let raw = token.identifier else { return }
        token.identifier = nil
        UIApplication.shared.endBackgroundTask(UIBackgroundTaskIdentifier(rawValue: raw))
    }
}
