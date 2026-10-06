import SwiftUI

@main
struct StudentHubApp: App {
    /// Делегат нужен ради пушей: токен устройства, тихие доставки и нажатие на
    /// уведомление система отдаёт только ему.
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}
