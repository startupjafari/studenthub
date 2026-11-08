import Foundation

/// QR-сессия входа (`POST /auth/qr/create`).
///
/// `qr` — готовая картинка сервера (`data:image/svg+xml;base64,…`) с адресом
/// подтверждения внутри; сам адрес и `approveToken` наружу не отдаются. `claimSecret`
/// в картинку не попадает: забрать сессию может только тот, кто её создал.
struct QRSignInTicket: Decodable, Equatable {
    let qrId: String
    let qr: String
    let claimSecret: String
    /// Сколько секунд живёт сессия (сейчас 120).
    let expiresIn: Int
}

/// Вход без пароля и восстановление пароля. Все маршруты публичные: токена ещё нет.
///
/// Вход по QR — тот же сценарий, что у веба на компьютере: это устройство показывает
/// код, телефон, где человек уже вошёл, подтверждает его (`QRApproveView`), и это
/// устройство забирает сессию. Так в приложение входят на новом телефоне или iPad,
/// не набирая пароль.
protocol AuthRecovering: Sendable {
    func createQRSession() async throws -> QRSignInTicket
    /// Забрать сессию после подтверждения. Пока не подтверждено — `BAD_REQUEST`,
    /// истекло или уже забрано — `NOT_FOUND`.
    func claimQRSession(_ ticket: QRSignInTicket) async throws -> AuthSession
    /// Письмо со ссылкой на новый пароль. Ответ одинаковый для любого адреса — сервер
    /// не выдаёт, зарегистрирован ли он.
    func requestPasswordReset(email: String) async throws
}

struct AuthRecoveryAPI: AuthRecovering {
    private let client: APIClient

    /// Клиент без авторизации, как у входа: сессию выдают эти же маршруты.
    init(client: APIClient = APIClient(authorization: nil)) {
        self.client = client
    }

    func createQRSession() async throws -> QRSignInTicket {
        try await client.send(publicEndpoint("auth/qr/create"), as: QRSignInTicket.self)
    }

    func claimQRSession(_ ticket: QRSignInTicket) async throws -> AuthSession {
        struct Body: Encodable {
            let qrId: String
            let claimSecret: String
        }
        return try await client.send(
            try publicEndpoint("auth/qr/claim", json: Body(qrId: ticket.qrId, claimSecret: ticket.claimSecret)),
            as: AuthSession.self
        )
    }

    func requestPasswordReset(email: String) async throws {
        struct Body: Encodable { let email: String }
        try await client.send(try publicEndpoint("auth/password/forgot", json: Body(email: email)))
    }

    private func publicEndpoint(_ path: String) -> Endpoint {
        var endpoint = Endpoint.post(path)
        endpoint.requiresAuthorization = false
        return endpoint
    }

    private func publicEndpoint<Body: Encodable>(_ path: String, json body: Body) throws -> Endpoint {
        var endpoint = try Endpoint.post(path, json: body)
        endpoint.requiresAuthorization = false
        return endpoint
    }
}
