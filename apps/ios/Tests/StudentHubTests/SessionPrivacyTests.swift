import XCTest

@testable import StudentHub

/// Действует до 2100 года.
private let rawToken = """
    eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLWZ1dHVyZSIsInJvbGUiOiJURUFDSEVSIiwidW5pdmVyc2l0eUlkIjoidS05IiwiZmFjdWx0eUlkIjpudWxsLCJncm91cElkIjpudWxsLCJ0ZmEiOnRydWUsImV4cCI6NDEwMjQ0NDgwMH0.signature
    """

/// Секреты не утекают через описание типов, хлебные крошки и локальные хранилища
/// (правила 10.2.6, 10.2.8, 10.1.11).
final class SessionPrivacyTests: XCTestCase {
    // MARK: - Описание без секретов

    func testTypesWithTokensPrintWithoutThem() throws {
        let token = try XCTUnwrap(AccessToken(raw: rawToken))
        let printed: [Any] = [
            token,
            AuthSession(accessToken: rawToken),
            LoginOutcome.session(AuthSession(accessToken: rawToken)),
            LoginOutcome.twoFactorRequired(challengeToken: "challenge-secret"),
            SessionRestoration.active(token),
            SessionRestoration.cached(token),
            PendingLogout(refreshToken: "rt-secret", deviceToken: "apns-secret"),
        ]
        for value in printed {
            var dumped = ""
            dump(value, to: &dumped)
            for text in ["\(value)", String(reflecting: value), dumped] {
                XCTAssertFalse(text.contains("signature"), text)
                XCTAssertFalse(text.contains("eyJ"), text)
                XCTAssertFalse(text.contains("secret"), text)
            }
        }
        // То, что показывать можно, остаётся — иначе описание бесполезно в отладке.
        XCTAssertTrue("\(token)".contains("user-future"))
    }

    @MainActor
    func testSessionStatePrintsWithoutToken() throws {
        let state = AppSessionModel.State.signedIn(try XCTUnwrap(AccessToken(raw: rawToken)))
        var dumped = ""
        dump(state, to: &dumped)
        for text in ["\(state)", String(reflecting: state), dumped] {
            XCTAssertFalse(text.contains("eyJ"), text)
        }
    }

    // MARK: - Хлебные крошки

    /// Наружу из наших категорий уходят только ключи белого списка.
    func testOwnBreadcrumbKeysAreAllowlisted() throws {
        let data: [String: Any] = ["action": "opened", "error": "x", "token": "secret", "url": "/chats/1"]
        let sanitized = try XCTUnwrap(Observability.sanitizedBreadcrumbData(data, category: "push"))
        XCTAssertEqual(Set(sanitized.keys), ["action", "error"])
    }

    /// У чужих крошек адрес сводится к шаблону маршрута.
    func testForeignBreadcrumbAddressBecomesRouteTemplate() throws {
        let data: [String: Any] = [
            "url": "https://api.studenthub.kz/api/v1/chats/cm3x9k2l0000abc/messages?q=привет#top",
            "method": "GET",
        ]
        let sanitized = try XCTUnwrap(Observability.sanitizedBreadcrumbData(data, category: "navigation"))
        XCTAssertEqual(sanitized["url"] as? String, "/api/v1/chats/:id/messages")
        XCTAssertEqual(sanitized["method"] as? String, "GET")
    }

    func testRouteTemplateDropsIdentifiers() {
        XCTAssertEqual(
            Observability.routeTemplate("/api/v1/users/0b8f9c2e-3d4a-4f5b-9c6d-7e8f9a0b1c2d/profile"),
            "/api/v1/users/:id/profile"
        )
        XCTAssertEqual(Observability.routeTemplate("/api/v1/feed?cursor=abc"), "/api/v1/feed")
        XCTAssertEqual(Observability.routeTemplate("/api/v1/schedule/42"), "/api/v1/schedule/:id")
    }

    // MARK: - Трансляции геопозиции

    /// После перезапуска продолжаются только свои незакончившиеся трансляции: чужие и
    /// записи без владельца (сборка до поля) — нет.
    @MainActor
    func testOnlyOwnLiveLocationsAreResumed() {
        let now = Date()
        let later = now.addingTimeInterval(600)
        let stored = [
            LiveLocationSharing.Session(messageID: "m1", chatID: "c1", until: later, ownerID: "me"),
            LiveLocationSharing.Session(messageID: "m2", chatID: "c1", until: later, ownerID: "previous"),
            LiveLocationSharing.Session(messageID: "m3", chatID: "c2", until: later, ownerID: nil),
            LiveLocationSharing.Session(messageID: "m4", chatID: "c2", until: now.addingTimeInterval(-1), ownerID: "me"),
        ]

        let resumed = LiveLocationSharing.resumable(stored, owner: "me", now: now)

        XCTAssertEqual(resumed.map(\.messageID), ["m1"])
    }
}
