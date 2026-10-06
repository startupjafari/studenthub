import UIKit
import UserNotifications

/// Делегат приложения.
///
/// SwiftUI обходится без него почти везде, но пуши — ровно то место, где система
/// по-прежнему разговаривает с `UIApplicationDelegate`: токен устройства, тихие
/// доставки и нажатие на уведомление приходят только сюда.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    private let registrar = PushRegistrar()

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { await registrar.register(deviceToken: deviceToken) }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // Не ошибка приложения: в симуляторе без Apple ID токена нет вовсе, и
        // падать из-за этого нечему.
    }

    /// Тихий пуш: данных в нём нет, есть повод за ними сходить. Система даёт на это
    /// считаные секунды, поэтому тянем только список чатов — он же обновит бейдж.
    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification payload: [AnyHashable: Any]
    ) async -> UIBackgroundFetchResult {
        guard PushRouting.isSilent(payload) else { return .noData }
        return await AppServices.pushSync.catchUp() ? .newData : .failed
    }

    // MARK: - UNUserNotificationCenterDelegate

    /// Уведомление пришло, пока приложение открыто. Показываем плашку, но без
    /// звука: человек и так смотрит в экран.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list]
    }

    /// Нажатие на уведомление: ведём туда, о чём оно.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let payload = response.notification.request.content.userInfo
        guard let link = PushRouting.link(from: payload) else { return }
        // Роль нужна, чтобы не открыть раздел, которого у этого человека нет:
        // пуш мог прийти на устройство, где уже вошёл кто-то другой.
        let role = await AppServices.session.currentToken?.role ?? .unknown
        await AppServices.router.open(link, for: role)
    }
}
