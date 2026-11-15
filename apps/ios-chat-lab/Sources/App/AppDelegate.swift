import UIKit
import UserNotifications

/// Точка входа. Окно поднимает `SceneDelegate`; здесь — только то, что живёт дольше сцены:
/// хранилище переписки, генерация медиа и уведомления.
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        LaunchOptions.apply()
        MediaFactory.shared.prepareIfNeeded()
        UNUserNotificationCenter.current().delegate = LocalNotifications.shared
        return true
    }

    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Default", sessionRole: connectingSceneSession.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}

@objc(SceneDelegate)
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.overrideUserInterfaceStyle = ThemeManager.shared.mode.interfaceStyle
        if LaunchOptions.disableAnimations {
            UIView.setAnimationsEnabled(false)
        }
        window.rootViewController = AppRouter.makeRoot()
        window.makeKeyAndVisible()
        self.window = window
        ThemeManager.shared.attach(window: window)
        DebugMenu.installShakeTrigger(in: window)
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        ChatStore.shared.flushToDisk()
        LocalNotifications.shared.isAppActive = false
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        LocalNotifications.shared.isAppActive = true
    }
}

/// Корень: список чатов, поверх которого сразу открыт единственный личный чат —
/// так кнопка «назад» и свайп назад работают как в Telegram, а приложение
/// открывается сразу в переписке.
enum AppRouter {
    @MainActor
    static func makeRoot() -> UIViewController {
        let list = ChatListViewController()
        let navigation = ChatNavigationController(rootViewController: list)
        let chat = ChatViewController(store: .shared)
        navigation.pushViewController(chat, animated: false)
        return navigation
    }
}

/// Аргументы запуска для UI- и perf-тестов. Только для отладки и тестов: на устройстве
/// пользователя они не передаются.
enum LaunchOptions {
    /// `-resetData` — начать с исходной истории (каждый UI-тест стартует с одинакового состояния).
    static var resetData: Bool { ProcessInfo.processInfo.arguments.contains("-resetData") }
    /// `-disableAnimations` — для тестов, которые проверяют результат, а не движение.
    static var disableAnimations: Bool { ProcessInfo.processInfo.arguments.contains("-disableAnimations") }
    /// `-uiTesting` — без системных запросов разрешений и без случайных входящих.
    static var uiTesting: Bool { ProcessInfo.processInfo.arguments.contains("-uiTesting") }
    /// `-theme dark|light` — стартовая тема.
    static var theme: String? {
        let args = ProcessInfo.processInfo.arguments
        guard let index = args.firstIndex(of: "-theme"), index + 1 < args.count else { return nil }
        return args[index + 1]
    }

    @MainActor
    static func apply() {
        if resetData {
            ChatStore.resetPersistentState()
        }
        if let theme, let mode = ThemeMode(rawValue: theme) {
            ThemeManager.shared.setMode(mode, animated: false)
        }
    }
}
