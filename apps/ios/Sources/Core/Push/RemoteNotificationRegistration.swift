import Foundation

/// Просьба к системе выдать токен пушей или перестать их принимать
/// (`registerForRemoteNotifications` / `unregisterForRemoteNotifications`).
///
/// Протокол, а не прямой вызов UIKit — по образцу `BackgroundActivity`: регистратор пушей
/// живёт в ядре, а ядро без UI-фреймворков (`docs/IOS_RULES.md` 9.1.3). Реальная
/// реализация — `UIKitRemoteNotifications` в приложении (`AppServices.pushRegistrar`).
protocol RemoteNotificationRegistration: Sendable {
    @MainActor func registerForRemoteNotifications()
    @MainActor func unregisterForRemoteNotifications()
}

/// Без системной регистрации — для тестов и окружений без UIKit.
struct NoRemoteNotificationRegistration: RemoteNotificationRegistration {
    func registerForRemoteNotifications() {}
    func unregisterForRemoteNotifications() {}
}
