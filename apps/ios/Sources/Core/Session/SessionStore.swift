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

    private var token: AccessToken?
    private var inFlightRefresh: Task<AccessToken?, Never>?

    init(auth: SessionRefreshing = AuthAPI(), secrets: SecretStore = Keychain()) {
        self.auth = auth
        self.secrets = secrets
    }

    /// Был ли вход на этом устройстве. По нему холодный старт решает, пробовать
    /// продлить сессию или сразу показать экран входа.
    var hasStoredSession: Bool {
        secrets.value(for: .sessionPresent) != nil
    }

    /// Разобранный токен — для тех, кому нужна роль и scope, а не строка.
    var currentToken: AccessToken? { token }

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
    @discardableResult
    func adopt(_ session: AuthSession) -> AccessToken? {
        guard let parsed = AccessToken(raw: session.accessToken) else { return nil }
        token = parsed
        if let refreshToken = session.refreshToken {
            secrets.set(refreshToken, for: .refreshToken)
        }
        secrets.set("1", for: .sessionPresent)
        return parsed
    }

    /// Выход. Сначала гасим сессию на сервере, затем чистим своё — порядок важен:
    /// после очистки отправить запрос уже нечем, и сессия осталась бы живой.
    func signOut() async {
        try? await auth.endSession(using: secrets.value(for: .refreshToken))
        forgetSession()
    }

    private func performRefresh() async -> AccessToken? {
        do {
            return adopt(try await auth.refresh(using: secrets.value(for: .refreshToken)))
        } catch {
            // Сессия невосстановима — забываем её, иначе каждый следующий запрос
            // будет заново ломиться в обновление.
            if let apiError = error as? APIError, apiError.code?.meansSessionExpired == true {
                forgetSession()
            }
            return nil
        }
    }

    private func forgetSession() {
        token = nil
        secrets.remove(.refreshToken)
        secrets.remove(.sessionPresent)
    }
}
