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
        let store = makeStore(auth: auth)

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
        let store = makeStore(auth: auth)

        await store.adopt(AuthSession(accessToken: longLivedToken))
        let token = await store.accessToken()

        XCTAssertEqual(token, longLivedToken)
        let calls = await auth.refreshCalls
        XCTAssertEqual(calls, 0)
    }

    /// Без признака прошлого входа приложение не должно дёргать обновление:
    /// человек просто ещё не входил.
    func testColdStartWithoutSessionDoesNotRefresh() async {
        let auth = StubAuth(token: longLivedToken)
        let store = makeStore(auth: auth)

        let token = await store.accessToken()

        XCTAssertNil(token)
        let calls = await auth.refreshCalls
        XCTAssertEqual(calls, 0)
    }

    /// Сессия мертва — следы стираем, иначе каждый следующий запрос снова пойдёт
    /// обновляться и снова получит 401.
    func testDeadSessionIsForgotten() async {
        let secrets = MemorySecrets()
        let cookies = MemoryCookies(value: "rt-1")
        let auth = StubAuth(token: longLivedToken)
        await auth.failNext(
            with: .server(code: .tokenExpired, message: "Сессия истекла", details: [], statusCode: 401)
        )
        let store = makeStore(auth: auth, secrets: secrets, cookies: cookies)
        await store.adopt(AuthSession(accessToken: longLivedToken))

        let token = await store.refreshedAccessToken()

        XCTAssertNil(token)
        let hasSession = await store.hasStoredSession
        XCTAssertFalse(hasSession)
        XCTAssertNil(secrets.value(for: .refreshToken))
        XCTAssertNil(cookies.value())
    }

    func testSignOutClearsEverything() async {
        let secrets = MemorySecrets()
        let cookies = MemoryCookies(value: "rt-1")
        let store = makeStore(auth: StubAuth(token: longLivedToken), secrets: secrets, cookies: cookies)
        await store.adopt(AuthSession(accessToken: longLivedToken))

        await store.signOut()

        let hasSession = await store.hasStoredSession
        XCTAssertFalse(hasSession)
        XCTAssertNil(secrets.value(for: .sessionPresent))
        XCTAssertNil(cookies.value())
    }

    // MARK: - Refresh-cookie и связка ключей

    /// Сервер положил refresh в cookie — приложение переносит её в связку ключей.
    /// Иначе очистка кэша системой равнялась бы выходу из аккаунта.
    func testAdoptCopiesRefreshCookieIntoKeychain() async {
        let secrets = MemorySecrets()
        let store = makeStore(secrets: secrets, cookies: MemoryCookies(value: "rt-42"))

        await store.adopt(AuthSession(accessToken: longLivedToken))

        XCTAssertEqual(secrets.value(for: .refreshToken), "rt-42")
    }

    /// Хранилище cookie опустело, а в связке ключей токен есть: перед обновлением
    /// возвращаем значение на место, и человек не теряет сессию.
    func testEmptyCookieJarIsRefilledFromKeychain() async {
        let secrets = MemorySecrets()
        secrets.set("rt-7", for: .refreshToken)
        secrets.set("1", for: .sessionPresent)
        let cookies = MemoryCookies()
        let store = makeStore(auth: StubAuth(token: longLivedToken), secrets: secrets, cookies: cookies)

        _ = await store.refreshedAccessToken()

        XCTAssertEqual(cookies.value(), "rt-7")
    }

    /// Нечего восстанавливать — не выдумываем: пустая связка ключей означает, что
    /// входа на устройстве не было.
    func testNothingIsRestoredWithoutStoredToken() async {
        let cookies = MemoryCookies()
        let store = makeStore(auth: StubAuth(token: longLivedToken), secrets: MemorySecrets(), cookies: cookies)

        _ = await store.refreshedAccessToken()

        XCTAssertNil(cookies.value())
    }

    private func makeStore(
        auth: StubAuth? = nil,
        secrets: MemorySecrets = MemorySecrets(),
        cookies: MemoryCookies = MemoryCookies()
    ) -> SessionStore {
        SessionStore(auth: auth ?? StubAuth(token: longLivedToken), secrets: secrets, cookies: cookies)
    }
}

// MARK: - Дублёры

private actor StubAuth: SessionRefreshing {
    private(set) var refreshCalls = 0
    private let token: String
    private var nextFailure: APIError?

    init(token: String) { self.token = token }

    func failNext(with error: APIError) { nextFailure = error }

    func refresh() async throws -> AuthSession {
        refreshCalls += 1
        // Пауза, чтобы вызовы действительно наложились, а не выстроились в ряд.
        try? await Task.sleep(for: .milliseconds(20))
        if let nextFailure {
            self.nextFailure = nil
            throw nextFailure
        }
        return AuthSession(accessToken: token)
    }

    func endSession() async throws {}
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

/// Хранилище cookie системы общее на процесс — в тестах подставляем своё, иначе
/// один тест протекал бы в другой.
private final class MemoryCookies: RefreshCookieStore, @unchecked Sendable {
    private let lock = NSLock()
    private var stored: String?

    init(value: String? = nil) { stored = value }

    func value() -> String? { lock.withLock { stored } }
    func restore(_ value: String) { lock.withLock { stored = value } }
    func clear() { lock.withLock { stored = nil } }
}
