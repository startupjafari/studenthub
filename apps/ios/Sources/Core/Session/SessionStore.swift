import Foundation

/// Сессия пользователя: кто вошёл и каким токеном подписываются запросы.
///
/// Актор, а не класс с замком, ровно из-за одного требования плана: обновление
/// должно быть одно в полёте. Холодный старт поднимает несколько экранов разом, и
/// без этого они пошлют три параллельных `refresh`; сервер считает повторное
/// использование refresh-токена кражей и гасит сессию целиком — человек оказывается
/// на экране входа без всякой причины.
actor SessionStore: AuthorizationProvider {
    private let auth: SessionRefreshing
    private let secrets: SecretStore
    private let cookies: RefreshCookieStore

    private var token: AccessToken?
    private var inFlightRefresh: Task<AccessToken?, Never>?

    init(
        auth: SessionRefreshing = AuthAPI(),
        secrets: SecretStore = Keychain(),
        cookies: RefreshCookieStore = SystemRefreshCookieStore()
    ) {
        self.auth = auth
        self.secrets = secrets
        self.cookies = cookies
    }

    /// Был ли вход на этом устройстве. По нему холодный старт решает, пробовать
    /// продлить сессию или сразу показать экран входа.
    var hasStoredSession: Bool {
        secrets.value(for: .sessionPresent) != nil
    }

    /// Разобранный токен — для тех, кому нужна роль и scope, а не строка.
    var currentToken: AccessToken? { token }

    /// Холодный старт: поднять сессию и вернуть разобранный токен.
    ///
    /// Отдельно от `accessToken()` ради одной строки — та отдаёт строку для
    /// заголовка, а корневому экрану нужна роль, чтобы решить, что показывать.
    /// Возврат `nil` означает ровно одно: показывать вход.
    func restoredToken() async -> AccessToken? {
        _ = await accessToken()
        return token
    }

    // MARK: - AuthorizationProvider

    func accessToken() async -> String? {
        if let token, token.isUsable() { return token.raw }
        guard token != nil || hasStoredSession else { return nil }
        return await refreshedAccessToken()
    }

    func refreshedAccessToken() async -> String? {
        if let inFlightRefresh { return await inFlightRefresh.value?.raw }

        let task = Task<AccessToken?, Never> { await self.performRefresh() }
        inFlightRefresh = task
        let refreshed = await task.value
        if inFlightRefresh == task { inFlightRefresh = nil }
        return refreshed?.raw
    }

    // MARK: - Жизненный цикл сессии

    /// Принять сессию, выданную входом или обновлением.
    ///
    /// Сервер только что положил свежую refresh-cookie — переносим её в связку
    /// ключей, пока она на месте: хранилище cookie система вправе очистить, связку
    /// ключей — нет.
    @discardableResult
    func adopt(_ session: AuthSession) -> AccessToken? {
        guard let parsed = AccessToken(raw: session.accessToken) else { return nil }
        token = parsed
        if let refreshCookie = cookies.value() {
            secrets.set(refreshCookie, for: .refreshToken)
        }
        secrets.set("1", for: .sessionPresent)
        return parsed
    }

    /// Выход. Сначала гасим сессию на сервере, затем чистим своё — порядок важен:
    /// после очистки отправить запрос уже нечем, и сессия осталась бы живой.
    func signOut() async {
        restoreRefreshCookieIfNeeded()
        try? await auth.endSession()
        forgetSession()
    }

    private func performRefresh() async -> AccessToken? {
        restoreRefreshCookieIfNeeded()
        do {
            return adopt(try await auth.refresh())
        } catch {
            // Сессия невосстановима — забываем её, иначе каждый следующий запрос
            // будет заново ломиться в обновление.
            if let apiError = error as? APIError, apiError.code?.meansSessionExpired == true {
                forgetSession()
            }
            return nil
        }
    }

    /// Хранилище cookie опустело, а в связке ключей токен есть — возвращаем его на
    /// место. Без этого очистка кэша системой выглядела бы как выход из аккаунта.
    private func restoreRefreshCookieIfNeeded() {
        guard cookies.value() == nil, let stored = secrets.value(for: .refreshToken) else { return }
        cookies.restore(stored)
    }

    private func forgetSession() {
        token = nil
        cookies.clear()
        secrets.remove(.refreshToken)
        secrets.remove(.sessionPresent)
    }
}
