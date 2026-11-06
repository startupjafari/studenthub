import Foundation

/// Состояние согласия на обработку персональных данных (`GET /users/me/consent`).
///
/// Согласие из регистрации перестаёт подходить, когда меняется редакция документов или
/// когда дата рождения в профиле расходится с тем, кто его давал (сам человек или
/// законный представитель). Тогда `required`, и без нового согласия с ПДн не работаем.
struct ConsentStateDTO: Decodable, Equatable {
    /// `VERSION` — новая редакция документов, `AGE_BASIS` — сменилось основание.
    let required: Bool
    let reason: String?
    let guardianRequired: Bool
    let birthDateRequired: Bool
}

protocol ConsentChecking: Sendable {
    func state() async throws -> ConsentStateDTO
    func accept(guardianConsent: Bool?, birthDate: String?) async throws -> ConsentStateDTO
}

struct ConsentAPI: ConsentChecking {
    private let client: APIClient

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    func state() async throws -> ConsentStateDTO {
        try await client.send(.get("users/me/consent"), as: ConsentStateDTO.self)
    }

    /// Повторное согласие (`AcceptConsentSchema`): `consent` всегда `true`, остальное —
    /// только когда нужно, иначе ключ не отправляется вовсе (схема строгая).
    func accept(guardianConsent: Bool?, birthDate: String?) async throws -> ConsentStateDTO {
        struct Body: Encodable {
            let consent = true
            let guardianConsent: Bool?
            let birthDate: String?
        }
        return try await client.send(
            try .post("users/me/consent", json: Body(guardianConsent: guardianConsent, birthDate: birthDate)),
            as: ConsentStateDTO.self
        )
    }
}
