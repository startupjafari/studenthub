import Foundation

/// Refresh-токен: его транспорт — httpOnly-cookie, его хранилище — связка ключей.
///
/// Сервер отдаёт refresh только в cookie и в теле ответа не отдаёт никогда
/// (`BACKEND_RULES §18.6`). Нативному клиенту это не мешает: httpOnly ограничивает
/// JavaScript в браузере, а не владельца хранилища — `HTTPCookieStorage` эту cookie
/// приложению показывает.
///
/// Зачем тогда копировать её в связку ключей. Хранилище cookie — кэш, а не надёжное
/// место: система вправе его очистить (выгрузка приложения с сохранением данных,
/// восстановление из резервной копии), и человек без всякой причины окажется на
/// экране входа. Связка ключей это переживает, и перед обновлением сессии значение
/// возвращается в cookie-хранилище.
protocol RefreshCookieStore: Sendable {
    /// Значение refresh-cookie, если оно сейчас есть у `URLSession`.
    func value() -> String?
    /// Вернуть значение в хранилище cookie — после того как оно опустело.
    func restore(_ value: String)
    func clear()
}

/// Хранилище cookie самой системы.
///
/// `@unchecked Sendable`: `HTTPCookieStorage` потокобезопасно, но Sendable не
/// помечено — ручная пометка здесь честнее, чем копия состояния.
struct SystemRefreshCookieStore: RefreshCookieStore, @unchecked Sendable {
    /// Имя и путь заданы сервером (`apps/api/src/modules/auth/auth.constants.ts`):
    /// меняются они только вместе с API.
    static let cookieName = "sh_refresh"

    /// Срок жизни refresh-токена на сервере — 30 дней. Ставим столько же: cookie,
    /// пережившая свой токен, только вводит в заблуждение.
    private static let lifetime: TimeInterval = 30 * 24 * 60 * 60

    private let authURL: URL
    private let storage: HTTPCookieStorage

    init(baseURL: URL = AppConfiguration.apiBaseURL, storage: HTTPCookieStorage = .shared) {
        // Cookie выставлена на auth-путь, а не на корень: по другому адресу система
        // её не отдаст и не примет.
        authURL = baseURL.appendingPathComponent("auth")
        self.storage = storage
    }

    func value() -> String? {
        storage.cookies(for: authURL)?.first { $0.name == Self.cookieName }?.value
    }

    func restore(_ value: String) {
        guard let host = authURL.host else { return }
        let cookie = HTTPCookie(properties: [
            .name: Self.cookieName,
            .value: value,
            .domain: host,
            .path: authURL.path,
            .secure: authURL.scheme == "https" ? "TRUE" : "FALSE",
            .expires: Date().addingTimeInterval(Self.lifetime),
        ])
        guard let cookie else { return }
        storage.setCookie(cookie)
    }

    func clear() {
        storage.cookies(for: authURL)?
            .filter { $0.name == Self.cookieName }
            .forEach { storage.deleteCookie($0) }
    }
}
