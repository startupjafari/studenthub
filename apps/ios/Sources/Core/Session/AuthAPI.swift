import Foundation

/// Ответ эндпоинтов входа и обновления сессии.
///
/// `refreshToken` сегодня всегда `nil`: сервер кладёт его в httpOnly-cookie, а в теле
/// не отдаёт. Поле заведено заранее — когда закроется Задача Б2, тот же код начнёт
/// класть токен в связку ключей, и ничего переписывать не придётся.
struct AuthSession: Decodable, Equatable {
    let accessToken: String
    let refreshToken: String?
}

/// Операции сессии, которые ходят в сеть. Отдельный протокол нужен, чтобы
/// `SessionStore` тестировался без сети и чтобы не замкнуть его с `APIClient`:
/// клиент спрашивает у хранилища токен, хранилище просит у этого протокола новый.
protocol SessionRefreshing: Sendable {
    func refresh(using storedRefreshToken: String?) async throws -> AuthSession
    func endSession(using storedRefreshToken: String?) async throws
}

/// Маршруты сессии. Все три публичные: токена на руках как раз нет.
struct AuthAPI: SessionRefreshing {
    private let client: APIClient

    /// Клиент без провайдера авторизации — иначе обновление сессии попыталось бы
    /// получить токен у того, кто его и обновляет.
    init(client: APIClient = APIClient(authorization: nil)) {
        self.client = client
    }

    func refresh(using storedRefreshToken: String?) async throws -> AuthSession {
        try await client.send(endpoint("auth/refresh", refreshToken: storedRefreshToken), as: AuthSession.self)
    }

    func endSession(using storedRefreshToken: String?) async throws {
        try await client.send(endpoint("auth/logout", refreshToken: storedRefreshToken))
    }

    /// Тело уходит, только если токен у нас действительно есть. Пока его нет,
    /// запрос идёт пустым, и сессию опознаёт cookie — как сегодня и работает веб.
    private func endpoint(_ path: String, refreshToken: String?) -> Endpoint {
        var endpoint: Endpoint
        if let refreshToken, let body = try? Endpoint.post(path, json: RefreshRequest(refreshToken: refreshToken)) {
            endpoint = body
        } else {
            endpoint = .post(path)
        }
        endpoint.requiresAuthorization = false
        return endpoint
    }

    private struct RefreshRequest: Encodable {
        let refreshToken: String
    }
}
