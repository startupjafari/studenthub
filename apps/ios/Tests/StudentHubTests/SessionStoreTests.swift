import XCTest

@testable import StudentHub

/// Действует до 2100 года — чтобы тест не начал падать однажды утром.
private let longLivedToken = """
    eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLWZ1dHVyZSIsInJvbGUiOiJURUFDSEVSIiwidW5pdmVyc2l0eUlkIjoidS05IiwiZmFjdWx0eUlkIjpudWxsLCJncm91cElkIjpudWxsLCJ0ZmEiOnRydWUsImV4cCI6NDEwMjQ0NDgwMH0.signature
    """

final class SessionStoreTests: XCTestCase {
    /// Главное требование плана: сколько бы экранов ни спросили токен разом,
    /// обновление уходит одно. Второй refresh сервер считает повторным
    /// использованием и гасит сессию целиком.
    func testConcurrentCallersShareOneRefresh() async {
        let auth = StubAuth(token: longLivedToken)
        let store = SessionStore(auth: auth, secrets: MemorySecrets())

        async let first = store.refreshedAccessToken()
        async let second = store.refreshedAccessToken()
        async let third = store.refreshedAccessToken()
        let results = await [first, second, third]

        XCTAssertEqual(results.compactMap { $0 }.count, 3)
        let calls = await auth.refreshCalls
        XCTAssertEqual(calls, 1)
    }

    func testValidTokenIsReusedWithoutNetwork() async {
        let auth = StubAuth(token: longLivedToken)
        let store = SessionStore(auth: auth, secrets: MemorySecrets())

        await store.adopt(AuthSession(accessToken: longLivedToken, refreshToken: nil))
        let token = await store.accessToken()

        XCTAssertEqual(token, longLivedToken)
        let calls = await auth.refreshCalls
        XCTAssertEqual(calls, 0)
    }

    /// Без признака прошлого входа приложение не должно дёргать обновление:
    /// человек просто ещё не входил.
    func testColdStartWithoutSessionDoesNotRefresh() async {
        let auth = StubAuth(token: longLivedToken)
        let store = SessionStore(auth: auth, secrets: MemorySecrets())

        let token = await store.accessToken()

        XCTAssertNil(token)
        let calls = await auth.refreshCalls
        XCTAssertEqual(calls, 0)
    }

    /// Сессия мертва — следы стираем, иначе каждый следующий запрос снова пойдёт
    /// обновляться и снова получит 401.
    func testDeadSessionIsForgotten() async {
        let secrets = MemorySecrets()
        let auth = StubAuth(token: longLivedToken)
        await auth.failNext(
            with: .server(code: .tokenExpired, message: "Сессия истекла", details: [], statusCode: 401)
        )
        let store = SessionStore(auth: auth, secrets: secrets)
        await store.adopt(AuthSession(accessToken: longLivedToken, refreshToken: "r-1"))

        let token = await store.refreshedAccessToken()

        XCTAssertNil(token)
        let hasSession = await store.hasStoredSession
        XCTAssertFalse(hasSession)
        XCTAssertNil(secrets.value(for: .refreshToken))
    }

    func testSignOutClearsEverything() async {
        let secrets = MemorySecrets()
        let store = SessionStore(auth: StubAuth(token: longLivedToken), secrets: secrets)
        await store.adopt(AuthSession(accessToken: longLivedToken, refreshToken: "r-1"))

        await store.signOut()

        let hasSession = await store.hasStoredSession
        XCTAssertFalse(hasSession)
        XCTAssertNil(secrets.value(for: .sessionPresent))
    }
}

// MARK: - Дублёры

private actor StubAuth: SessionRefreshing {
    private(set) var refreshCalls = 0
    private let token: String
    private var nextFailure: APIError?

    init(token: String) { self.token = token }

    func failNext(with error: APIError) { nextFailure = error }

    func refresh(using storedRefreshToken: String?) async throws -> AuthSession {
        refreshCalls += 1
        // Пауза, чтобы вызовы действительно наложились, а не выстроились в ряд.
        try? await Task.sleep(for: .milliseconds(20))
        if let nextFailure {
            self.nextFailure = nil
            throw nextFailure
        }
        return AuthSession(accessToken: token, refreshToken: nil)
    }

    func endSession(using storedRefreshToken: String?) async throws {}
}

/// Связка ключей симулятора в юнит-тестах недоступна без прав на подпись.
private final class MemorySecrets: SecretStore, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String: String] = [:]

    func value(for key: SecretKey) -> String? {
        lock.withLock { storage[key.rawValue] }
    }

    func set(_ value: String, for key: SecretKey) {
        lock.withLock { storage[key.rawValue] = value }
    }

    func remove(_ key: SecretKey) {
        _ = lock.withLock { storage.removeValue(forKey: key.rawValue) }
    }
}
