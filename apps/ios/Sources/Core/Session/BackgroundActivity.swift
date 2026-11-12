import UIKit

/// Фоновое задание iOS вокруг короткой работы, которую нельзя бросить на полпути
/// (обмен refresh-токена): ушедшее в фон приложение получает время её закончить.
enum BackgroundActivity {
    /// Чем закрыть задание. Класс — чтобы закрытие по истечению времени и обычное не
    /// закрыли его дважды.
    final class Handle: @unchecked Sendable {
        fileprivate var id: UIBackgroundTaskIdentifier = .invalid
    }

    @MainActor
    static func begin(_ name: String) -> Handle {
        let handle = Handle()
        handle.id = UIApplication.shared.beginBackgroundTask(withName: name) {
            // Время вышло: задание закрываем, работа сама закончится ошибкой сети.
            // Обработчик система зовёт на главном потоке.
            MainActor.assumeIsolated { end(handle) }
        }
        return handle
    }

    @MainActor
    static func end(_ handle: Handle) {
        guard handle.id != .invalid else { return }
        UIApplication.shared.endBackgroundTask(handle.id)
        handle.id = .invalid
    }
}
