import Foundation

/// Разобранный код входа по QR.
///
/// В QR на экране компьютера лежит не токен, а ссылка вида `https://<веб>/qr?t=<uuid>`
/// — тот же адрес, который открывает камера телефона без приложения. Поэтому
/// приложение разбирает ссылку, а не ждёт собственного формата.
struct QRLoginTicket: Equatable {
    let approveToken: String

    /// Строгий разбор — часть защиты, а не придирчивость. На платформе есть и
    /// другие QR (посещаемость, помещения), и у них свои адреса: пустив сюда любую
    /// ссылку с параметром `t`, мы дали бы человеку подтвердить вход, глядя на
    /// чужой код. Поэтому проверяем и путь, и то, что токен — UUID.
    init?(scanned payload: String) {
        guard
            let components = URLComponents(string: payload.trimmingCharacters(in: .whitespacesAndNewlines)),
            let scheme = components.scheme?.lowercased(),
            scheme == "https" || scheme == "http",
            components.path.hasSuffix("/qr"),
            let token = components.queryItems?.first(where: { $0.name == "t" })?.value,
            UUID(uuidString: token) != nil
        else { return nil }
        approveToken = token
    }

    /// Для тестов и для ручного ввода в отладочной сборке.
    init(approveToken: String) {
        self.approveToken = approveToken
    }
}

/// Подтверждение входа с уже залогиненного устройства. Протокол — чтобы экран
/// проверялся без сети: отказ сервера здесь такой же сценарий, как успех.
protocol QRLoginApproving: Sendable {
    func approve(_ ticket: QRLoginTicket) async throws
}

/// Единственный маршрут входа по QR, который делает телефон. Создание сессии и её
/// забор — дело компьютера, приложению они не нужны.
///
/// Запрос идёт с авторизацией: сервер берёт пользователя из токена, а не из тела.
/// Отсюда и место экрана — за входом, а не на нём.
struct QRLoginAPI: QRLoginApproving {
    private let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    func approve(_ ticket: QRLoginTicket) async throws {
        let endpoint = try Endpoint.post("auth/qr/approve", json: ApproveRequest(approveToken: ticket.approveToken))
        try await client.send(endpoint)
    }

    private struct ApproveRequest: Encodable {
        let approveToken: String
    }
}
