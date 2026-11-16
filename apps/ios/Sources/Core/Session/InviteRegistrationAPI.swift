import Foundation

/// Что известно о приглашении до регистрации (`GET /invites/:token/preview`).
///
/// Самого адреса в превью нет — оно публично по токену; есть только признак, что
/// приглашение выдано без адреса (ссылкой в мессенджер), и тогда email спрашивает форма.
struct InvitePreview: Decodable, Equatable {
    let role: Role
    let emailRequired: Bool
    let universityId: String?
    let facultyId: String?
    let groupId: String?
    let expiresAt: Date
}

/// Тело `POST /auth/register-by-invite` — `RegisterByInviteSchema`. Схема строгая
/// (`.strict()`): лишних полей не шлём, пустые необязательные опускаются.
struct InviteRegistration: Encodable, Equatable {
    let token: String
    let username: String
    let firstName: String
    let lastName: String
    let password: String
    /// Только у приглашения без адреса.
    let email: String?
    /// «ГГГГ-ММ-ДД».
    let birthDate: String
    /// Схема принимает только `true`: отказ — это незаполненная форма.
    let consent: Bool
    /// Обязательно, если на дату регистрации нет 18.
    let guardianConsent: Bool?
}

/// Регистрация по приглашению вуза. Маршруты публичные: аккаунта ещё нет. Роль и
/// область (вуз, факультет, группа) берутся из приглашения, а не из формы.
protocol InviteRegistering: Sendable {
    /// Отказы — по коду: `NOT_FOUND`, `INVITE_EXPIRED`, `INVITE_USED`, `INVITE_REVOKED`,
    /// `RATE_LIMIT`.
    func preview(token: String) async throws -> InvitePreview
    /// Сессия сразу: после регистрации человек уже внутри. Занятое имя —
    /// `USERNAME_TAKEN`, занятый адрес — `CONFLICT` с полем `email`.
    func register(_ form: InviteRegistration) async throws -> AuthSession
}

struct InviteRegistrationAPI: InviteRegistering {
    private let client: APIClient

    init(client: APIClient = APIClient(authorization: nil)) {
        self.client = client
    }

    func preview(token: String) async throws -> InvitePreview {
        var endpoint = Endpoint.get("invites/\(token)/preview")
        endpoint.requiresAuthorization = false
        return try await client.send(endpoint, as: InvitePreview.self)
    }

    func register(_ form: InviteRegistration) async throws -> AuthSession {
        var endpoint = try Endpoint.post("auth/register-by-invite", json: form)
        endpoint.requiresAuthorization = false
        return try await client.send(endpoint, as: AuthSession.self)
    }
}
