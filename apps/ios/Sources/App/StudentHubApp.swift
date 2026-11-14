import SwiftUI

@main
struct StudentHubApp: App {
    /// Делегат нужен ради пушей: токен устройства, тихие доставки и нажатие на
    /// уведомление система отдаёт только ему.
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @AppStorage(AppearanceTheme.storageKey) private var theme = AppearanceTheme.system.rawValue

    init() {
        // Режим UI-тестов (`SH_UITEST_MOCK=1`): чистое состояние и сеть из фикстур — до
        // первого обращения к `AppServices`. В Release — пустой вызов.
        UITestHooks.prepareIfNeeded()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .appearanceTheme(theme)
                // Уменьшение движения — одно значение на всё дерево (`Motion`).
                .motionPolicy()
        }
    }
}
