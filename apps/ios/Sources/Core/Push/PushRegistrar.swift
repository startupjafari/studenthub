import Foundation
import UIKit
import UserNotifications

/// Регистрация устройства для пушей (план iOS, Задача 1.8).
///
/// Токен выдаёт система, а не мы: он меняется при переустановке приложения и
/// восстановлении из копии, поэтому подтверждается на каждом запуске, а не
/// однократно при первом согласии.
struct PushRegistrar: Sendable {
    private let client: APIClient

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    /// Спросить разрешение и, если дали, попросить систему о токене.
    ///
    /// Отказ — не ошибка: человек вправе не хотеть уведомлений, и приложение
    /// работает дальше без них.
    @MainActor
    func requestAuthorization() async {
        let center = UNUserNotificationCenter.current()
        let granted = (try? await center.requestAuthorization(options: [.alert, .badge, .sound])) ?? false
        guard granted else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    /// Отдать серверу токен, который прислала система.
    func register(deviceToken: Data) async {
        struct Body: Encodable {
            let token: String
            let platform: String
            let appVersion: String
        }
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        let body = Body(token: token, platform: "IOS", appVersion: AppConfiguration.clientVersion)
        _ = try? await client.send(try .post("push/devices", json: body))
        Self.lastToken = token
    }

    /// Отвязать устройство при выходе: иначе следующему человеку на этом телефоне
    /// прилетят чужие уведомления.
    func unregister() async {
        guard let token = Self.lastToken else { return }
        struct Body: Encodable { let token: String }
        _ = try? await client.send(try .post("push/devices/remove", json: Body(token: token)))
        Self.lastToken = nil
    }

    /// Последний отданный серверу токен. В `UserDefaults`, а не в связке ключей:
    /// это не секрет, а адрес доставки, и его знает вся система.
    private static var lastToken: String? {
        get { UserDefaults.standard.string(forKey: "push.device-token") }
        set {
            if let newValue {
                UserDefaults.standard.set(newValue, forKey: "push.device-token")
            } else {
                UserDefaults.standard.removeObject(forKey: "push.device-token")
            }
        }
    }
}

/// Куда ведёт нажатие на уведомление.
///
/// Сервер кладёт в пуш тот же адрес, что показывает вебу, — относительный путь.
/// Превращаем его в ссылку своей схемы: разбор диплинков у приложения один, и
/// заводить второй под пуши значит однажды развести их поведение.
enum PushRouting {
    static func link(from payload: [AnyHashable: Any]) -> DeepLink? {
        guard let raw = payload["url"] as? String, !raw.isEmpty else { return nil }
        let normalized = raw.hasPrefix("/") ? "\(DeepLink.scheme)://\(raw.dropFirst())" : raw
        guard let url = URL(string: normalized) else { return nil }
        return DeepLink(url: url)
    }

    /// Тихий пуш — повод сходить за данными, а не показать плашку.
    static func isSilent(_ payload: [AnyHashable: Any]) -> Bool {
        guard let aps = payload["aps"] as? [AnyHashable: Any] else { return false }
        return aps["alert"] == nil && (aps["content-available"] as? Int) == 1
    }
}
