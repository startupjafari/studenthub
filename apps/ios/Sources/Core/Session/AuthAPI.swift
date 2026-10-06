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

/// Чем кончился первый шаг входа.
///
/// Два исхода у одного эндпоинта — не прихоть сервера: пока код не проверен, сессии
/// нет и выдавать нечего, поэтому `/auth/login` отвечает либо токеном, либо
/// challenge'ем. Разделять их на клиенте типом, а не разбором полей по месту,
/// заставляет экран обработать оба случая.
enum LoginOutcome: Equatable {
    case session(AuthSession)
    case twoFactorRequired(challengeToken: String)
}

/// Операции сессии, которые ходят в сеть. Отдельный протокол нужен, чтобы
/// `SessionStore` тестировался без сети и чтобы не замкнуть его с `APIClient`:
/// клиент спрашивает у хранилища токен, хранилище просит у этого протокола новый.
protocol SessionRefreshing: Sendable {
    func refresh(using storedRefreshToken: String?) async throws -> AuthSession
    func endSession(using storedRefreshToken: String?) async throws
}

/// Выдача сессии: оба шага входа. Отдельно от `SessionRefreshing`, потому что это
/// разные стороны: продление сессии нужно хранилищу, а вход — экрану, и экран
/// должен тестироваться со своим дублёром, не трогая хранилище.
protocol SessionIssuing: Sendable {
    func signIn(identifier: String, password: String) async throws -> LoginOutcome
    func verifyTwoFactor(challengeToken: String, code: String) async throws -> AuthSession
}

/// Маршруты сессии. Все публичные: токена на руках как раз нет.
struct AuthAPI: SessionRefreshing, SessionIssuing {
    private let client: APIClient

    /// Клиент без провайдера авторизации — иначе обновление сессии попыталось бы
    /// получить токен у того, кто его и обновляет.
    init(client: APIClient = APIClient(authorization: nil)) {
        self.client = client
    }

    // MARK: - Вход

    /// Первый шаг. Идентификатор — почта ИЛИ имя пользователя: сервер принимает оба
    /// в одном поле (`LoginSchema`), и спрашивать у человека, что именно он вводит,
    /// незачем.
    func signIn(identifier: String, password: String) async throws -> LoginOutcome {
        let endpoint = try publicEndpoint(
            "auth/login",
            json: LoginRequest(identifier: identifier, password: password)
        )
        let response = try await client.send(endpoint, as: LoginResponse.self)

        if response.twoFactorRequired == true, let challengeToken = response.challengeToken {
            return .twoFactorRequired(challengeToken: challengeToken)
        }
        guard let accessToken = response.accessToken else {
            // Ответ по форме успешный, но ни токена, ни challenge'а в нём нет —
            // продолжать не с чем, и молчать об этом нельзя: экран застынет.
            throw APIError.malformedResponse(statusCode: 200)
        }
        return .session(AuthSession(accessToken: accessToken, refreshToken: response.refreshToken))
    }

    /// Второй шаг. Код — шесть цифр из приложения-аутентификатора или резервный код;
    /// длину и формат проверяет сервер, клиент отсекает только пустое.
    func verifyTwoFactor(challengeToken: String, code: String) async throws -> AuthSession {
        let endpoint = try publicEndpoint(
            "auth/login/2fa",
            json: TwoFactorRequest(challengeToken: challengeToken, code: code)
        )
        return try await client.send(endpoint, as: AuthSession.self)
    }

    // MARK: - Продление и выход

    func refresh(using storedRefreshToken: String?) async throws -> AuthSession {
        try await client.send(endpoint("auth/refresh", refreshToken: storedRefreshToken), as: AuthSession.self)
    }

    func endSession(using storedRefreshToken: String?) async throws {
        try await client.send(endpoint("auth/logout", refreshToken: storedRefreshToken))
    }

    // MARK: - Внутреннее

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

    private func publicEndpoint<Body: Encodable>(_ path: String, json body: Body) throws -> Endpoint {
        var endpoint = try Endpoint.post(path, json: body)
        endpoint.requiresAuthorization = false
        return endpoint
    }

    private struct RefreshRequest: Encodable {
        let refreshToken: String
    }

    private struct LoginRequest: Encodable {
        let identifier: String
        let password: String
    }

    private struct TwoFactorRequest: Encodable {
        let challengeToken: String
        let code: String
    }

    /// Оба исхода первого шага в одной записи: какие поля придут, решает сервер.
    private struct LoginResponse: Decodable {
        let accessToken: String?
        let refreshToken: String?
        let twoFactorRequired: Bool?
        let challengeToken: String?
    }
}
