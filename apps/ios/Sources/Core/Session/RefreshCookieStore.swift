import Foundation

/// Refresh-токен: его транспорт — httpOnly-cookie, его хранилище — связка ключей.
///
/// Сервер отдаёт refresh только в cookie и в теле ответа не отдаёт никогда
/// (`BACKEND_RULES §18.6`). Нативному клиенту это не мешает: httpOnly ограничивает
/// JavaScript в браузере, а не владельца соединения — клиент API сам читает
/// `Set-Cookie` и сам подставляет `Cookie` (`APIClient`).
///
/// Системное хранилище cookie (`HTTPCookieStorage`) для этого не годится: cookie с
/// `Max-Age` оно пишет в `Library/Cookies`, а этот файл уезжает в резервную копию
/// iCloud/Finder и не защищён как `ThisDeviceOnly`. Копия телефона получала бы живую
/// сессию владельца в обход связки ключей. Поэтому cookie живёт только в памяти
/// процесса, а между запусками — в связке ключей (`SessionStore` переносит её туда).
protocol RefreshCookieStore: Sendable {
    /// Значение refresh-cookie, если оно сейчас есть у клиента.
    func value() -> String?
    /// Вернуть значение — из связки ключей после перезапуска.
    func restore(_ value: String)
    func clear()
}

/// Refresh-cookie в памяти процесса. Одна на приложение: её кладут ответы входа,
/// продления и регистрации, а берёт обмен на новый токен и выход.
final class RefreshCookieJar: RefreshCookieStore, @unchecked Sendable {
    static let shared = RefreshCookieJar()

    /// Имя задано сервером (`apps/api/src/modules/auth/auth.constants.ts`): меняется
    /// только вместе с API.
    static let cookieName = "sh_refresh"

    private let lock = NSLock()
    private var stored: String?

    func value() -> String? {
        lock.withLock { stored }
    }

    func restore(_ value: String) {
        lock.withLock { stored = value }
    }

    func clear() {
        lock.withLock { stored = nil }
    }

    /// Заголовок для запроса к `auth/*`.
    static func header(for value: String) -> String {
        "\(cookieName)=\(value)"
    }

    /// Ответ сервера: новая refresh-cookie (вход, продление) или её стирание (выход,
    /// отказ в сессии — пустое значение или срок в прошлом).
    func absorb(_ response: HTTPURLResponse, url: URL) {
        var fields: [String: String] = [:]
        for (key, value) in response.allHeaderFields {
            guard let key = key as? String, let value = value as? String else { continue }
            fields[key] = value
        }
        let cookies = HTTPCookie.cookies(withResponseHeaderFields: fields, for: url)
        guard let cookie = cookies.first(where: { $0.name == Self.cookieName }) else { return }
        if cookie.value.isEmpty || (cookie.expiresDate.map { $0 <= Date() } ?? false) {
            clear()
        } else {
            restore(cookie.value)
        }
    }

    /// Прежние сборки держали cookie в системном хранилище — а значит, и на диске, в
    /// файле резервной копии. Стираем всё, что там лежит для адреса API: клиент cookie
    /// оттуда больше не берёт, а значение уже перенесено в связку ключей.
    static func purgeSystemStorage(baseURL: URL = AppConfiguration.apiBaseURL) {
        guard let host = baseURL.host else { return }
        let storage = HTTPCookieStorage.shared
        for cookie in storage.cookies ?? [] where host.hasSuffix(cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))) {
            storage.deleteCookie(cookie)
        }
    }
}
