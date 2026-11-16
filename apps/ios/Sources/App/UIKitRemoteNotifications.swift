import UIKit

/// Регистрация пушей через `UIApplication` для `RemoteNotificationRegistration`.
struct UIKitRemoteNotifications: RemoteNotificationRegistration {
    func registerForRemoteNotifications() {
        UIApplication.shared.registerForRemoteNotifications()
    }

    func unregisterForRemoteNotifications() {
        UIApplication.shared.unregisterForRemoteNotifications()
    }
}
