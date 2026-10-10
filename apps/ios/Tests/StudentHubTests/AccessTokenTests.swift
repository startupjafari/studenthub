import XCTest

@testable import StudentHub

/// Подпись здесь не проверяется намеренно: ключ у сервера. Клиент читает payload
/// только чтобы знать срок жизни и не рисовать разделы, которых у роли нет.
final class AccessTokenTests: XCTestCase {
    /// Выдан на 15 минут, истёк 1790000900 (epoch).
    private let studentToken = """
        eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMTExMTExMS0yMjIyLTMzMzMtNDQ0NC01NTU1NTU1NTU1NTUiLCJyb2xlIjoiU1RVREVOVCIsInVuaXZlcnNpdHlJZCI6InUtMSIsImZhY3VsdHlJZCI6ImYtMSIsImdyb3VwSWQiOiJnLTEiLCJ0ZmEiOmZhbHNlLCJpYXQiOjE3OTAwMDAwMDAsImV4cCI6MTc5MDAwMDkwMH0.signature-not-verified-on-client
        """

    func testReadsSubjectRoleAndScope() throws {
        let token = try XCTUnwrap(AccessToken(raw: studentToken))

        XCTAssertEqual(token.subject, "11111111-2222-3333-4444-555555555555")
        XCTAssertEqual(token.role, .student)
        XCTAssertEqual(token.universityID, "u-1")
        XCTAssertEqual(token.groupID, "g-1")
        XCTAssertFalse(token.twoFactorEnabled)
        XCTAssertEqual(token.expiresAt.timeIntervalSince1970, 1_790_000_900, accuracy: 0.5)
    }

    /// Обновляемся заранее: токен, которому осталась секунда, доедет до сервера
    /// уже просроченным.
    func testTokenIsNotUsableInsideRefreshMargin() throws {
        let token = try XCTUnwrap(AccessToken(raw: studentToken))
        let expiry = token.expiresAt

        XCTAssertTrue(token.isUsable(at: expiry.addingTimeInterval(-120)))
        XCTAssertFalse(token.isUsable(at: expiry.addingTimeInterval(-10)))
        XCTAssertFalse(token.isUsable(at: expiry.addingTimeInterval(1)))
    }

    /// Роль, которой приложение ещё не знает, не должна ронять разбор токена.
    func testUnknownRoleDoesNotBreakParsing() throws {
        let payload = #"{"sub":"u","role":"CHANCELLOR","universityId":null,"facultyId":null,"groupId":null,"exp":4102444800}"#
        let token = try XCTUnwrap(AccessToken(raw: "header.\(base64URL(payload)).signature"))

        XCTAssertEqual(token.role, .unknown)
        XCTAssertFalse(token.role.isSupportedOnPhone)
    }

    func testMalformedTokensAreRejected() {
        XCTAssertNil(AccessToken(raw: "не-токен"))
        XCTAssertNil(AccessToken(raw: "header.payload"))
        XCTAssertNil(AccessToken(raw: "header.!!!не-base64!!!.signature"))
    }

    private func base64URL(_ value: String) -> String {
        Data(value.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
