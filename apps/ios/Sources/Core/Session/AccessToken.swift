import Foundation

/// Разобранный access-токен.
///
/// Подпись клиент не проверяет и проверять не должен: ключ у сервера, и доверять
/// содержимому токена здесь нельзя — только читать его, чтобы знать срок жизни и не
/// рисовать разделы, которых у роли всё равно нет. Решение о доступе принимает API.
struct AccessToken: Equatable {
    let raw: String
    let subject: String
    let role: Role
    let universityID: String?
    let facultyID: String?
    let groupID: String?
    let twoFactorEnabled: Bool
    let expiresAt: Date

    /// Токен живёт 15 минут. Обновляем заранее: запрос с токеном, которому осталась
    /// секунда, доедет до сервера уже просроченным.
    static let refreshMargin: TimeInterval = 30

    func isUsable(at moment: Date = Date()) -> Bool {
        expiresAt.timeIntervalSince(moment) > Self.refreshMargin
    }

    init?(raw: String) {
        let parts = raw.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3, let payload = Self.decodeBase64URL(String(parts[1])) else {
            return nil
        }
        guard let claims = try? JSONDecoder().decode(Claims.self, from: payload) else {
            return nil
        }

        self.raw = raw
        subject = claims.sub
        role = claims.role
        universityID = claims.universityId
        facultyID = claims.facultyId
        groupID = claims.groupId
        twoFactorEnabled = claims.tfa ?? false
        expiresAt = Date(timeIntervalSince1970: claims.exp)
    }

    private struct Claims: Decodable {
        let sub: String
        let role: Role
        let universityId: String?
        let facultyId: String?
        let groupId: String?
        let tfa: Bool?
        let exp: TimeInterval
    }

    /// base64url отличается от base64 двумя символами и отсутствием выравнивания.
    private static func decodeBase64URL(_ value: String) -> Data? {
        var normalized = value.replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = normalized.count % 4
        if remainder > 0 {
            normalized.append(String(repeating: "=", count: 4 - remainder))
        }
        return Data(base64Encoded: normalized)
    }
}
