import SwiftUI

@main
struct StudentHubApp: App {
    /// Делегат нужен ради пушей: токен устройства, тихие доставки и нажатие на
    /// уведомление система отдаёт только ему.
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @AppStorage(AppearanceTheme.storageKey) private var theme = AppearanceTheme.system.rawValue

    var body: some Scene {
        WindowGroup {
            RootView()
                .appearanceTheme(theme)
                // Незакончившаяся трансляция геопозиции продолжается после перезапуска.
                .task { LiveLocationSharing.shared.resume() }
        }
    }
}
