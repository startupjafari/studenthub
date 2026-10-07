import Foundation
import Sentry
import UIKit

/// Наблюдаемость приложения (задача 5.5 плана).
///
/// Три вопроса, на которые она обязана отвечать: падает ли сборка, за сколько
/// человек видит первый экран и доходят ли пуши. Без первого релиз слепой, без
/// второго «тормозит» остаётся спором, без третьего жалоба «не приходят
/// уведомления» нерасследуема.
enum Observability {
    nonisolated(unsafe) private static var launchStartedAt: Date?

    /// Инициализация трекера. Без DSN — молчит, как и бэкенд: отладочные сборки не
    /// должны засорять ленту issue.
    static func start() {
        launchStartedAt = Date()
        guard
            let dsn = Bundle.main.object(forInfoDictionaryKey: "SHSentryDSN") as? String,
            !dsn.trimmingCharacters(in: .whitespaces).isEmpty
        else { return }

        SentrySDK.start { options in
            options.dsn = dsn
            options.releaseName = "ios@\(AppConfiguration.marketingVersion)+\(AppConfiguration.buildNumber)"
            options.environment = AppConfiguration.isRelease ? "production" : "development"
            // Персональных данных в трекер не отправляем: правило проекта — наружу
            // уходит только идентификатор (BACKEND_RULES §11.3).
            options.sendDefaultPii = false
            options.attachScreenshot = false
            options.attachViewHierarchy = false
            options.beforeSend = { event in
                event.user?.email = nil
                event.user?.username = nil
                event.user?.ipAddress = nil
                return event
            }
        }
    }

    /// Кто сейчас в приложении — только id, как и на сервере.
    static func identify(userID: String?) {
        SentrySDK.setUser(userID.map { id in
            let user = User()
            user.userId = id
            return user
        })
    }

    /// Первый экран показан. Меряем от старта процесса: человеку важно время до
    /// содержимого, а не до `applicationDidFinishLaunching`.
    static func launchFinished() {
        guard let launchStartedAt else { return }
        let seconds = Date().timeIntervalSince(launchStartedAt)
        self.launchStartedAt = nil
        breadcrumb("launch", data: ["seconds": String(format: "%.2f", seconds)])
    }

    /// Пуш дошёл до устройства. Доставку APNs не гарантирует, и единственный способ
    /// понять, теряются ли уведомления, — считать их на обоих концах.
    static func pushDelivered(silent: Bool) {
        breadcrumb("push", data: ["silent": silent ? "1" : "0"])
    }

    static func pushOpened() {
        breadcrumb("push", data: ["action": "opened"])
    }

    private static func breadcrumb(_ category: String, data: [String: String]) {
        let crumb = Breadcrumb(level: .info, category: category)
        crumb.data = data
        SentrySDK.addBreadcrumb(crumb)
    }
}
