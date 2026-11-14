import UIKit
import UserNotifications

// ЗАГЛУШКА: локальные уведомления — отдельный шаг.
@MainActor
final class LocalNotifications: NSObject, UNUserNotificationCenterDelegate {
    static let shared = LocalNotifications()
    var isAppActive = true
    var isChatVisible = false

    func notifyIfNeeded(about message: Message, count: Int) {}
}
