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
        // Признак установки — до первого обращения к базе: её каталог и отличает
        // обновление от новой установки (10.1.12).
        AppServices.installation.prepare(containerHasData: AppDatabase.storeExists())
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .appearanceTheme(theme)
                // Уменьшение движения — одно значение на всё дерево (`Motion`).
                .motionPolicy()
                // VoiceOver — тоже одно значение: системный или тестовая подмена (`VoiceOver`).
                .voiceOverPolicy()
                // Каждая ссылка — из текста ленты, материалов, `Link` — через один
                // открыватель с проверкой адреса, а не молча в систему (10.3.4).
                .environment(\.openURL, ExternalLinkOpener.action)
        }
    }
}
