import UIKit
import UserNotifications

/// Локальные уведомления о моковых входящих.
///
/// - Входящее, пока приложение свёрнуто или открыт не чат, — уведомление сразу (если чат не
///   «без звука»).
/// - «Входящее через 5 с» (Debug Menu): уведомление по таймеру системы + запись «ожидающего»
///   сообщения. Свернули приложение — система покажет баннер, а при возврате сообщение
///   появится в ленте. Не сворачивали — оно придёт в ленту по таймеру внутри процесса,
///   а системное уведомление снимается.
/// - Нажатие на уведомление открывает переписку.
@MainActor
final class LocalNotifications: NSObject, UNUserNotificationCenterDelegate {
    static let shared = LocalNotifications()

    var isAppActive = true {
        didSet {
            guard isAppActive, !oldValue else { return }
            deliverPendingIfNeeded()
            UNUserNotificationCenter.current().setBadgeCount(0)
        }
    }

    var isChatVisible = false

    private var didRequestAuthorization = false
    private static let pendingKey = "notifications.pendingIncoming"

    struct PendingIncoming: Codable {
        var id: String
        var date: Date
        var text: String
    }

    private var center: UNUserNotificationCenter { .current() }

    // MARK: Разрешение

    func requestAuthorizationIfNeeded() async -> Bool {
        guard !LaunchOptions.uiTesting else { return false }
        if !didRequestAuthorization {
            didRequestAuthorization = true
            _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
        }
        let settings = await center.notificationSettings()
        return settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
    }

    // MARK: Входящие

    func notifyIfNeeded(about message: Message, count: Int) {
        let store = ChatStore.shared
        guard !LaunchOptions.uiTesting, !message.isOutgoing, !store.settings.isMuted else { return }
        guard !isAppActive || !isChatVisible else { return }
        let title = store.peer.displayName
        let body = count > 1 ? "\(count) новых сообщений" : notificationBody(for: message)
        Task {
            guard await requestAuthorizationIfNeeded() else { return }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = .default
            content.threadIdentifier = "chat.\(store.peer.id)"
            content.badge = NSNumber(value: count)
            let request = UNNotificationRequest(identifier: "incoming.\(message.id)", content: content, trigger: nil)
            try? await center.add(request)
        }
    }

    private func notificationBody(for message: Message) -> String {
        switch message.kind {
        case .text, .service: return message.text
        default:
            let preview = message.text.isEmpty ? message.kind.shortDescription : message.text
            return "\(message.kind.iconEmoji) \(preview)"
        }
    }

    // MARK: Отложенное входящее (Debug Menu)

    /// Через `delay` секунд придёт входящее. Чтобы увидеть баннер — сверните приложение.
    func scheduleDelayedIncoming(after delay: TimeInterval = 5) {
        let pool = MockCorpus.incomingPool
        let text = pool[Int.random(in: 0..<pool.count)]
        let pending = PendingIncoming(id: UUID().uuidString, date: Date().addingTimeInterval(delay), text: text)
        var list = loadPending()
        list.append(pending)
        savePending(list)

        let peerName = ChatStore.shared.peer.displayName
        let muted = ChatStore.shared.settings.isMuted
        Task {
            if !muted, await requestAuthorizationIfNeeded() {
                let content = UNMutableNotificationContent()
                content.title = peerName
                content.body = text
                content.sound = .default
                content.badge = 1
                let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, delay), repeats: false)
                try? await center.add(UNNotificationRequest(identifier: "pending.\(pending.id)", content: content, trigger: trigger))
            }
        }
        // Приложение осталось открытым — сообщение придёт само в срок.
        DispatchQueue.main.asyncAfter(deadline: .now() + delay + 0.05) { [weak self] in
            MainActor.assumeIsolated {
                guard let self, self.isAppActive else { return }
                self.deliverPendingIfNeeded(suppressSystemNotification: true)
            }
        }
    }

    /// Положить в ленту ожидающие входящие, чьё время прошло.
    func deliverPendingIfNeeded(suppressSystemNotification: Bool = false) {
        let now = Date()
        let list = loadPending()
        guard !list.isEmpty else { return }
        let due = list.filter { $0.date <= now }
        guard !due.isEmpty else { return }
        savePending(list.filter { $0.date > now })
        if suppressSystemNotification {
            let ids = due.map { "pending.\($0.id)" }
            center.removePendingNotificationRequests(withIdentifiers: ids)
            center.removeDeliveredNotifications(withIdentifiers: ids)
        }
        let store = ChatStore.shared
        guard !store.settings.isBlocked else { return }
        let messages = due.sorted { $0.date < $1.date }.map {
            Message(id: 0, author: .peer, date: $0.date, text: $0.text, status: .read)
        }
        MockChatService.shared.stopTyping()
        store.receive(batch: messages)
        if suppressSystemNotification, let last = store.lastMessage {
            // Приложение открыто, но, может быть, не на чате — обычное правило уведомлений.
            notifyIfNeeded(about: last, count: messages.count)
        }
    }

    var pendingCount: Int { loadPending().count }

    private func loadPending() -> [PendingIncoming] {
        guard let data = UserDefaults.standard.data(forKey: Self.pendingKey) else { return [] }
        return (try? JSONDecoder().decode([PendingIncoming].self, from: data)) ?? []
    }

    private func savePending(_ list: [PendingIncoming]) {
        if list.isEmpty {
            UserDefaults.standard.removeObject(forKey: Self.pendingKey)
        } else if let data = try? JSONEncoder().encode(list) {
            UserDefaults.standard.set(data, forKey: Self.pendingKey)
        }
    }

    // MARK: Делегат центра уведомлений

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        // Баннер поверх открытого чата не нужен: сообщение и так видно в ленте.
        let chatVisible = await MainActor.run { self.isChatVisible && self.isAppActive }
        return chatVisible ? [] : [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        await MainActor.run {
            self.deliverPendingIfNeeded()
            self.openChat()
        }
    }

    /// Показать переписку: вернуться к ней в стеке или открыть заново.
    func openChat() {
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
        guard let window = windows.first(where: { $0.isKeyWindow }) ?? windows.first,
              let navigation = window.rootViewController as? UINavigationController else { return }
        navigation.presentedViewController?.dismiss(animated: false)
        if navigation.topViewController is ChatViewController { return }
        if let chat = navigation.viewControllers.first(where: { $0 is ChatViewController }) {
            navigation.popToViewController(chat, animated: true)
        } else {
            navigation.pushViewController(ChatViewController(store: .shared), animated: true)
        }
    }
}
