import Foundation
// Sentry есть в сборке Xcode (project.yml). В сборке на устройство через xtool
// (Package.swift) его нет: DSN там пуст, трекер всё равно молчал бы.
#if canImport(Sentry)
    import Sentry
#endif
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

        #if canImport(Sentry)
            SentrySDK.start { options in
                options.dsn = dsn
                options.releaseName = "ios@\(AppConfiguration.marketingVersion)+\(AppConfiguration.buildNumber)"
                options.environment = AppConfiguration.isRelease ? "production" : "development"
                // Персональных данных в трекер не отправляем: правило проекта — наружу
                // уходит только идентификатор (BACKEND_RULES §11.3).
                options.sendDefaultPii = false
                options.attachScreenshot = false
                options.attachViewHierarchy = false
                // Диагностика MetricKit с устройств (зависания, тяжёлый CPU, запись на
                // диск): замеры в лаборатории не видят телефонов, на которых тормозит
                // у людей (план аудита, шаг 0.5). Без персональных данных — это отчёты
                // системы о процессе.
                options.enableMetricKit = true
                // Сетевые крошки Sentry пишут полный адрес запроса: id чатов и людей,
                // параметры поиска (правило 10.2.8). Нам они не нужны — свои крошки
                // ответов (`unexpectedResponse`) несут только статус и тип ошибки.
                options.enableNetworkBreadcrumbs = false
                // Вторая линия — на случай, если крошки с адресами включит обновление SDK
                // или интеграция: адрес сводится к шаблону маршрута, ключи наших
                // категорий — к белому списку.
                options.beforeBreadcrumb = { crumb in
                    guard crumb.category != "http" else { return nil }
                    crumb.data = Observability.sanitizedBreadcrumbData(crumb.data, category: crumb.category)
                    return crumb
                }
                options.beforeSend = { event in
                    event.user?.email = nil
                    event.user?.username = nil
                    event.user?.ipAddress = nil
                    return event
                }
            }
        #endif
    }

    /// Кто сейчас в приложении — только id, как и на сервере.
    static func identify(userID: String?) {
        #if canImport(Sentry)
            SentrySDK.setUser(userID.map { id in
                let user = User()
                user.userId = id
                return user
            })
        #endif
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

    /// Система не выдала токен устройства — пуши на это устройство не придут.
    /// Только домен и код ошибки: `localizedDescription` — текст для человека, в нём
    /// бывают подробности окружения, и для трекера он не константа.
    static func pushRegistrationFailed(_ error: Error) {
        let nsError = error as NSError
        breadcrumb("push", data: ["action": "register-failed", "error": "\(nsError.domain)#\(nsError.code)"])
    }

    /// Ответ, который приложение не смогло прочитать. Только статус и тип ошибки:
    /// тело ответа может содержать персональные данные и в трекер не уходит.
    static func unexpectedResponse(statusCode: Int, kind: String) {
        breadcrumb("api", data: ["status": String(statusCode), "kind": kind])
    }

    // MARK: - Белый список (правило 10.2.8)

    /// Ключи, которые наши крошки вправе отправить, — по категориям. Новый ключ сначала
    /// сюда, иначе `beforeBreadcrumb` его срежет (тест держит список честным).
    static let allowedBreadcrumbKeys: [String: Set<String>] = [
        "launch": ["seconds"],
        "push": ["silent", "action", "error"],
        "api": ["status", "kind"],
    ]

    /// Данные крошки перед отправкой: у наших категорий — только ключи из белого
    /// списка; у чужих (интеграции SDK) строки-адреса сводятся к шаблону маршрута.
    static func sanitizedBreadcrumbData(_ data: [String: Any]?, category: String) -> [String: Any]? {
        guard let data else { return nil }
        if let allowed = allowedBreadcrumbKeys[category] {
            return data.filter { allowed.contains($0.key) }
        }
        return data.mapValues { value in
            guard let text = value as? String, text.contains("/") else { return value }
            return routeTemplate(text)
        }
    }

    /// Адрес — шаблоном маршрута: без хоста, query и фрагмента, а сегменты-идентификаторы
    /// (uuid, cuid, числа, длинные токены) заменены на `:id`.
    /// `https://api.kz/api/v1/chats/c1x9…/messages?q=привет` → `/api/v1/chats/:id/messages`.
    static func routeTemplate(_ address: String) -> String {
        // Разбор руками, а не `URLComponents`: тот отказывается от адреса с кириллицей в
        // query, и адрес ушёл бы как есть.
        var rest = Substring(address)
        if let scheme = rest.range(of: "://") {
            rest = rest[scheme.upperBound...]
            rest = rest.firstIndex(of: "/").map { rest[$0...] } ?? ""
        }
        let path = rest.prefix { $0 != "?" && $0 != "#" }
        let segments = path.split(separator: "/", omittingEmptySubsequences: false).map { segment in
            isIdentifier(segment) ? ":id" : String(segment)
        }
        return segments.joined(separator: "/")
    }

    /// Сегмент пути похож на идентификатор, а не на имя маршрута: в нём есть цифры
    /// (uuid, cuid, номер) или он длиннее любого имени маршрута API.
    private static func isIdentifier(_ segment: Substring) -> Bool {
        guard !segment.isEmpty else { return false }
        if segment.count >= 20 { return true }
        // `v1` в `/api/v1/` — имя версии, а не id.
        if segment.count <= 3, segment.first == "v" { return false }
        return segment.contains { $0.isNumber }
    }

    private static func breadcrumb(_ category: String, data: [String: String]) {
        #if canImport(Sentry)
            let crumb = Breadcrumb(level: .info, category: category)
            crumb.data = data
            SentrySDK.addBreadcrumb(crumb)
        #endif
    }
}
