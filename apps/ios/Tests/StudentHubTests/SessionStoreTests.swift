import XCTest

@testable import StudentHub

/// Действует до 2100 года — чтобы тест не начал падать однажды утром.
private let longLivedToken = """
    eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLWZ1dHVyZSIsInJvbGUiOiJURUFDSEVSIiwidW5pdmVyc2l0eUlkIjoidS05IiwiZmFjdWx0eUlkIjpudWxsLCJncm91cElkIjpudWxsLCJ0ZmEiOnRydWUsImV4cCI6NDEwMjQ0NDgwMH0.signature
    """

/// Истёк в 2001 году — для холодного старта с просроченным последним токеном.
private let expiredToken = """
    eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLXBhc3QiLCJyb2xlIjoiVEVBQ0hFUiIsInVuaXZlcnNpdHlJZCI6InUtOSIsImZhY3VsdHlJZCI6bnVsbCwiZ3JvdXBJZCI6bnVsbCwidGZhIjp0cnVlLCJleHAiOjEwMDAwMDAwMDB9.signature
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

    // MARK: - Холодный старт без сети

    /// Последний токен ещё действует — интерфейс открывается по нему без сети и без
    /// продления: запросы им же и подписываются.
    func testColdStartWithUsableTokenOpensWithoutNetwork() async {
        let secrets = MemorySecrets()
        secrets.set("rt-1", for: .refreshToken)
        secrets.set("1", for: .sessionPresent)
        secrets.set(longLivedToken, for: .lastAccessToken)
        let auth = StubAuth(token: longLivedToken)
        let store = makeStore(auth: auth, secrets: secrets)

        let restoration = await store.restore()

        XCTAssertEqual(restoration, .active(AccessToken(raw: longLivedToken)!))
        let token = await store.accessToken()
        XCTAssertEqual(token, longLivedToken)
        let calls = await auth.refreshCalls
        XCTAssertEqual(calls, 0)
    }

    /// Токен истёк, сети нет: интерфейс всё равно открывается сразу по последнему
    /// токену, продление идёт фоном одно на всех, и его неудача человека не разлогинивает.
    func testColdStartWithExpiredTokenSurvivesNoNetwork() async {
        let secrets = MemorySecrets()
        secrets.set("rt-1", for: .refreshToken)
        secrets.set("1", for: .sessionPresent)
        secrets.set(expiredToken, for: .lastAccessToken)
        let auth = StubAuth(token: longLivedToken)
        await auth.failNext(with: .transport(URLError(.timedOut)))
        let store = makeStore(auth: auth, secrets: secrets)
        let ended = Flag()
        await store.onSessionEnded { ended.raise() }

        let restoration = await store.restore()
        // Запрос экрана присоединяется к фоновому продлению, а не шлёт своё.
        let token = await store.accessToken()

        XCTAssertEqual(restoration, .cached(AccessToken(raw: expiredToken)!))
        XCTAssertNil(token)
        let calls = await auth.refreshCalls
        XCTAssertEqual(calls, 1)
        let hasSession = await store.hasStoredSession
        XCTAssertTrue(hasSession)
        XCTAssertFalse(ended.isRaised)
        XCTAssertNotNil(secrets.value(for: .lastAccessToken))
    }

    /// Отказ сервера в фоновом продлении — не «нет сети»: сессия кончилась, следы
    /// стираются, интерфейс уходит на вход (`onSessionEnded`).
    func testRejectedBackgroundRefreshEndsSession() async {
        let secrets = MemorySecrets()
        secrets.set("rt-1", for: .refreshToken)
        secrets.set("1", for: .sessionPresent)
        secrets.set(expiredToken, for: .lastAccessToken)
        let auth = StubAuth(token: longLivedToken)
        await auth.failNext(
            with: .server(code: .tokenExpired, message: "Сессия истекла", details: [], statusCode: 401)
        )
        let store = makeStore(auth: auth, secrets: secrets)
        let ended = Flag()
        await store.onSessionEnded { ended.raise() }

        let restoration = await store.restore()
        _ = await store.accessToken()

        XCTAssertEqual(restoration, .cached(AccessToken(raw: expiredToken)!))
        XCTAssertTrue(ended.isRaised)
        XCTAssertNil(secrets.value(for: .lastAccessToken))
        let hasSession = await store.hasStoredSession
        XCTAssertFalse(hasSession)
    }

    // MARK: - Продление: заранее, без повторов, без связки ключей

    /// 401 пришёл на старый токен, а сессию уже продлил другой запрос — второго обмена
    /// refresh-токена нет: при ротации он был бы лишним.
    func testRefreshAfterStaleUnauthorizedReusesCurrentToken() async {
        let auth = StubAuth(token: longLivedToken)
        let store = makeStore(auth: auth)
        await store.adopt(AuthSession(accessToken: longLivedToken))

        let token = await store.refreshedAccessToken(replacing: expiredToken)

        XCTAssertEqual(token, longLivedToken)
        let calls = await auth.refreshCalls
        XCTAssertEqual(calls, 0)
    }

    /// Токен скоро истечёт — запрос идёт с ним и не ждёт, а продление уходит фоном.
    func testTokenCloseToExpiryIsRefreshedInBackground() async {
        let auth = StubAuth(token: longLivedToken)
        let store = makeStore(auth: auth)
        let soon = makeToken(expiringIn: 120)
        await store.adopt(AuthSession(accessToken: soon))

        let token = await store.accessToken()

        XCTAssertEqual(token, soon)
        // Фоновое продление — то же единственное в полёте: дожидаемся его.
        let refreshed = await store.refreshedAccessToken()
        XCTAssertEqual(refreshed, longLivedToken)
        let calls = await auth.refreshCalls
        XCTAssertEqual(calls, 1)
    }

    /// Связка ключей заперта до первой разблокировки: секреты «не читаются», но сессию
    /// это не гасит — продления без cookie нет, ничего не стирается, запросы — «нет связи».
    func testLockedKeychainNeitherRefreshesNorEndsSession() async {
        let secrets = MemorySecrets()
        secrets.set("rt-1", for: .refreshToken)
        secrets.set("1", for: .sessionPresent)
        secrets.set(expiredToken, for: .lastAccessToken)
        secrets.locked = true
        let auth = StubAuth(token: longLivedToken)
        let store = makeStore(auth: auth, secrets: secrets)
        let ended = Flag()
        await store.onSessionEnded { ended.raise() }

        let token = await store.refreshedAccessToken()
        let pending = await store.isSessionPending

        XCTAssertNil(token)
        XCTAssertTrue(pending)
        XCTAssertFalse(ended.isRaised)
        let calls = await auth.refreshCalls
        XCTAssertEqual(calls, 0)
        secrets.locked = false
        XCTAssertEqual(secrets.value(for: .refreshToken), "rt-1")
    }

    /// Ответ на продление потерялся (обрыв) — через пару секунд один повтор тем же
    /// единственным продлением: успевает в окно, где сервер отдаёт уже выданного преемника.
    func testLostRefreshResponseIsRetriedOnce() async throws {
        let secrets = MemorySecrets()
        secrets.set("rt-1", for: .refreshToken)
        secrets.set("1", for: .sessionPresent)
        let auth = StubAuth(token: longLivedToken)
        await auth.failNext(with: .transport(URLError(.networkConnectionLost)))
        let store = makeStore(auth: auth, secrets: secrets, lossRetryDelay: .milliseconds(50))

        let first = await store.refreshedAccessToken()
        XCTAssertNil(first)
        try await Task.sleep(for: .milliseconds(400))

        let calls = await auth.refreshCalls
        XCTAssertEqual(calls, 2)
        let token = await store.accessToken()
        XCTAssertEqual(token, longLivedToken)
    }

    /// Связку ключей разблокировали — отложенное из-за неё продление доводится.
    func testUnlockResumesDeferredRefresh() async {
        let secrets = MemorySecrets()
        secrets.set("rt-1", for: .refreshToken)
        secrets.set("1", for: .sessionPresent)
        secrets.locked = true
        let auth = StubAuth(token: longLivedToken)
        let store = makeStore(auth: auth, secrets: secrets)

        let locked = await store.refreshedAccessToken()
        XCTAssertNil(locked)
        secrets.locked = false
        await store.resumeAfterUnlock()
        let token = await store.refreshedAccessToken()

        XCTAssertEqual(token, longLivedToken)
        let calls = await auth.refreshCalls
        XCTAssertEqual(calls, 1)
    }

    /// Запас продления заранее — 5 минут, но не больше трети срока жизни токена.
    func testEarlyRefreshWindowIsCappedByLifetime() {
        let usual = AccessToken(raw: makeToken(expiringIn: 15 * 60, issuedAgo: 0))!
        let short = AccessToken(raw: makeToken(expiringIn: 6 * 60, issuedAgo: 0))!
        let withoutIssueTime = AccessToken(raw: makeToken(expiringIn: 60))!

        XCTAssertEqual(SessionStore.earlyRefreshWindow(for: usual), 5 * 60, accuracy: 1)
        XCTAssertEqual(SessionStore.earlyRefreshWindow(for: short), 2 * 60, accuracy: 1)
        // Без `iat` — срок жизни по умолчанию сервера, 15 минут.
        XCTAssertEqual(SessionStore.earlyRefreshWindow(for: withoutIssueTime), 5 * 60, accuracy: 1)
    }

    // MARK: - Выход без сети

    /// Выход не дошёл до сервера — он откладывается вместе с refresh-токеном и токеном
    /// пушей и досылается потом, этой самой cookie, а не текущей.
    func testSignOutWithoutNetworkIsCompletedLater() async {
        let secrets = MemorySecrets()
        let auth = StubAuth(token: longLivedToken)
        let store = makeStore(auth: auth, secrets: secrets, cookies: MemoryCookies(value: "rt-1"))
        await store.adopt(AuthSession(accessToken: longLivedToken))
        await auth.failNextEnd(with: .transport(URLError(.notConnectedToInternet)))

        let delivered = await store.signOut(deviceToken: "apns-0123456789abcdef")

        XCTAssertFalse(delivered)
        let hasSession = await store.hasStoredSession
        XCTAssertFalse(hasSession, "локально человек вышел сразу")
        var pending = await store.hasPendingLogouts
        XCTAssertTrue(pending)

        await store.completePendingLogouts()

        pending = await store.hasPendingLogouts
        XCTAssertFalse(pending)
        let ended = await auth.endedSessions
        XCTAssertEqual(ended.last?.refreshToken, "rt-1")
        XCTAssertEqual(ended.last?.deviceToken, "apns-0123456789abcdef")
    }

    /// Отказ сервера при досылке — повод забыть выход, а не повторять его вечно.
    func testRejectedPendingLogoutIsDropped() async {
        let secrets = MemorySecrets()
        let auth = StubAuth(token: longLivedToken)
        let store = makeStore(auth: auth, secrets: secrets, cookies: MemoryCookies(value: "rt-1"))
        await store.adopt(AuthSession(accessToken: longLivedToken))
        await auth.failNextEnd(with: .transport(URLError(.timedOut)))
        await store.signOut(deviceToken: nil)
        await auth.failNextEnd(
            with: .server(code: .unauthorized, message: "Нет сессии", details: [], statusCode: 401)
        )

        await store.completePendingLogouts()

        let pending = await store.hasPendingLogouts
        XCTAssertFalse(pending)
    }

    // MARK: - Эпоха сессии, окно грации, запись в связку ключей

    /// Правило 9.7.1: «Выйти» посреди продления — продление по возвращении ничего не
    /// записывает, и холодный старт не откроет сессию вышедшего.
    func testSignOutDuringRefreshDiscardsItsResult() async throws {
        let secrets = MemorySecrets()
        secrets.set("rt-1", for: .refreshToken)
        secrets.set("1", for: .sessionPresent)
        let cookies = MemoryCookies(value: "rt-1")
        let auth = StubAuth(token: longLivedToken)
        await auth.delayNext(by: .milliseconds(200))
        await auth.rotate(into: cookies, value: "rt-2")
        let store = makeStore(auth: auth, secrets: secrets, cookies: cookies)

        let refresh = Task { await store.refreshedAccessToken() }
        try await Task.sleep(for: .milliseconds(50))
        await store.signOut()
        let refreshed = await refresh.value

        XCTAssertNil(refreshed)
        let hasSession = await store.hasStoredSession
        XCTAssertFalse(hasSession)
        XCTAssertNil(secrets.value(for: .refreshToken))
        XCTAssertNil(secrets.value(for: .lastAccessToken))
        XCTAssertNil(cookies.value())
        let token = await store.accessToken()
        XCTAssertNil(token)
    }

    /// Вошёл другой человек, пока продлевалась сессия прежнего: остаются его токен и
    /// его refresh-cookie, а не ротированные прежнего.
    func testSignInDuringRefreshKeepsTheNewSession() async throws {
        let secrets = MemorySecrets()
        secrets.set("rt-old", for: .refreshToken)
        secrets.set("1", for: .sessionPresent)
        let cookies = MemoryCookies(value: "rt-old")
        let auth = StubAuth(token: longLivedToken)
        await auth.delayNext(by: .milliseconds(200))
        await auth.rotate(into: cookies, value: "rt-old-2")
        let store = makeStore(auth: auth, secrets: secrets, cookies: cookies)
        let newcomer = makeToken(expiringIn: 3600)

        let refresh = Task { await store.refreshedAccessToken() }
        try await Task.sleep(for: .milliseconds(50))
        cookies.restore("rt-new")
        await store.adopt(AuthSession(accessToken: newcomer))
        _ = await refresh.value

        let current = await store.currentToken
        XCTAssertEqual(current?.raw, newcomer)
        XCTAssertEqual(secrets.value(for: .refreshToken), "rt-new")
        XCTAssertEqual(secrets.value(for: .lastAccessToken), newcomer)
        XCTAssertEqual(cookies.value(), "rt-new")
    }

    /// Отказ сервера в продлении прежней сессии не гасит сессию вошедшего после.
    func testStaleRejectionDoesNotEndTheNewSession() async throws {
        let secrets = MemorySecrets()
        secrets.set("rt-old", for: .refreshToken)
        secrets.set("1", for: .sessionPresent)
        let cookies = MemoryCookies(value: "rt-old")
        let auth = StubAuth(token: longLivedToken)
        await auth.delayNext(by: .milliseconds(200))
        await auth.failNext(
            with: .server(code: .tokenExpired, message: "Сессия истекла", details: [], statusCode: 401)
        )
        let store = makeStore(auth: auth, secrets: secrets, cookies: cookies)
        let ended = Flag()
        await store.onSessionEnded { ended.raise() }

        let refresh = Task { await store.refreshedAccessToken() }
        try await Task.sleep(for: .milliseconds(50))
        cookies.restore("rt-new")
        await store.adopt(AuthSession(accessToken: makeToken(expiringIn: 3600)))
        _ = await refresh.value

        XCTAssertFalse(ended.isRaised)
        let hasSession = await store.hasStoredSession
        XCTAssertTrue(hasSession)
        XCTAssertEqual(secrets.value(for: .refreshToken), "rt-new")
    }

    /// Правило 9.7.2: ответ «повис» дольше окна грации — повтор старым токеном сервер
    /// счёл бы кражей, поэтому вслепую его не шлём.
    func testLostRefreshPastReuseGraceIsNotRetried() async throws {
        let secrets = MemorySecrets()
        secrets.set("rt-1", for: .refreshToken)
        secrets.set("1", for: .sessionPresent)
        let auth = StubAuth(token: longLivedToken)
        await auth.delayNext(by: .milliseconds(200))
        await auth.failNext(with: .transport(URLError(.timedOut)))
        let store = makeStore(
            auth: auth, secrets: secrets, lossRetryDelay: .milliseconds(50), lossRetryBudget: .milliseconds(150)
        )

        let first = await store.refreshedAccessToken()
        XCTAssertNil(first)
        try await Task.sleep(for: .milliseconds(400))

        let calls = await auth.refreshCalls
        XCTAssertEqual(calls, 1)
    }

    /// Таймаут продления и пауза повтора укладываются в окно грации сервера с запасом.
    func testRefreshTimeoutAndRetryFitServerGrace() {
        let worstCase = Duration.seconds(AuthAPI.refreshTimeout) + SessionStore.defaultLossRetryDelay
        XCTAssertLessThanOrEqual(worstCase, SessionStore.lossRetryBudget)
        XCTAssertLessThan(SessionStore.lossRetryBudget, SessionStore.serverReuseGrace)
    }

    /// Правило 10.2.2: ротированный refresh-токен не записался — погашенный прежний не
    /// остаётся в связке ключей, а запись повторяется после разблокировки.
    func testFailedRefreshTokenWriteDropsTheStaleOne() async {
        let secrets = MemorySecrets()
        secrets.set("rt-1", for: .refreshToken)
        secrets.set("1", for: .sessionPresent)
        let cookies = MemoryCookies(value: "rt-1")
        let auth = StubAuth(token: longLivedToken)
        await auth.rotate(into: cookies, value: "rt-2")
        let store = makeStore(auth: auth, secrets: secrets, cookies: cookies)
        secrets.failWrites(to: .refreshToken)

        let refreshed = await store.refreshedAccessToken()

        XCTAssertEqual(refreshed, longLivedToken)
        XCTAssertNil(secrets.value(for: .refreshToken))
        XCTAssertEqual(cookies.value(), "rt-2")

        secrets.failWrites(to: nil)
        await store.resumeAfterUnlock()

        XCTAssertEqual(secrets.value(for: .refreshToken), "rt-2")
    }

    /// Токен с заданным сроком — для проверок «скоро истечёт».
    private func makeToken(expiringIn seconds: TimeInterval, issuedAgo: TimeInterval? = nil) -> String {
        func encode(_ json: String) -> String {
            Data(json.utf8).base64EncodedString()
                .replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
        }
        let now = Date()
        let exp = Int(now.addingTimeInterval(seconds).timeIntervalSince1970)
        let iat = issuedAgo.map { #","iat":\#(Int(now.addingTimeInterval(-$0).timeIntervalSince1970))"# } ?? ""
        let header = encode(#"{"alg":"HS256","typ":"JWT"}"#)
        let payload = encode(
            #"{"sub":"user-soon","role":"TEACHER","universityId":"u-9","facultyId":null,"groupId":null,"tfa":true,"exp":"# + "\(exp)\(iat)}"
        )
        return "\(header).\(payload).signature"
    }

    private func makeStore(
        auth: StubAuth? = nil,
        secrets: MemorySecrets = MemorySecrets(),
        cookies: MemoryCookies = MemoryCookies(),
        lossRetryDelay: Duration = .seconds(60),
        lossRetryBudget: Duration = .seconds(120)
    ) -> SessionStore {
        SessionStore(
            auth: auth ?? StubAuth(token: longLivedToken),
            secrets: secrets,
            cookies: cookies,
            lossRetryDelay: lossRetryDelay,
            lossRetryBudget: lossRetryBudget
        )
    }
}

// MARK: - Дублёры

private actor StubAuth: SessionRefreshing {
    private(set) var refreshCalls = 0
    private(set) var endedSessions: [(deviceToken: String?, refreshToken: String?)] = []
    private let token: String
    private var nextFailure: APIError?
    private var nextEndFailure: APIError?
    private var nextDelay: Duration?
    private var rotation: (jar: MemoryCookies, value: String)?

    init(token: String) { self.token = token }

    func failNext(with error: APIError) { nextFailure = error }
    func failNextEnd(with error: APIError) { nextEndFailure = error }
    /// Ответ на следующее продление задержится — «повис» в сети.
    func delayNext(by delay: Duration) { nextDelay = delay }
    /// Успешное продление кладёт в банку новую cookie — как `Set-Cookie` ответа,
    /// который `APIClient` впитывает до того, как хранилище увидит ответ.
    func rotate(into jar: MemoryCookies, value: String) { rotation = (jar, value) }

    func refresh() async throws -> AuthSession {
        refreshCalls += 1
        // Пауза, чтобы вызовы действительно наложились, а не выстроились в ряд.
        try? await Task.sleep(for: .milliseconds(20))
        if let nextDelay {
            self.nextDelay = nil
            try? await Task.sleep(for: nextDelay)
        }
        if let nextFailure {
            self.nextFailure = nil
            throw nextFailure
        }
        if let rotation { rotation.jar.restore(rotation.value) }
        return AuthSession(accessToken: token)
    }

    func endSession(deviceToken: String?, refreshToken: String?) async throws {
        if let nextEndFailure {
            self.nextEndFailure = nil
            throw nextEndFailure
        }
        endedSessions.append((deviceToken, refreshToken))
    }
}

/// Отметка «сессия кончилась» из обработчика хранилища.
private final class Flag: @unchecked Sendable {
    private let lock = NSLock()
    private var raised = false

    func raise() { lock.withLock { raised = true } }
    var isRaised: Bool { lock.withLock { raised } }
}

/// Связка ключей симулятора в юнит-тестах недоступна без прав на подпись.
private final class MemorySecrets: SecretStore, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String: String] = [:]
    private var isLockedValue = false

    /// Как связка ключей до первой разблокировки: секреты есть, но не читаются.
    var locked: Bool {
        get { lock.withLock { isLockedValue } }
        set { lock.withLock { isLockedValue = newValue } }
    }

    var isLocked: Bool { locked }

    func value(for key: SecretKey) -> String? {
        lock.withLock { isLockedValue ? nil : storage[key.rawValue] }
    }

    private var failing: Set<SecretKey> = []

    /// Записи по ключу отклоняются, как у связки ключей при сбое: прежнее значение остаётся.
    func failWrites(to key: SecretKey?) {
        lock.withLock { failing = key.map { [$0] } ?? [] }
    }

    @discardableResult
    func set(_ value: String, for key: SecretKey) -> Bool {
        lock.withLock {
            guard !failing.contains(key) else { return false }
            storage[key.rawValue] = value
            return true
        }
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

final class RefreshCookieJarTests: XCTestCase {
    private let url = URL(string: "https://api.example.kz/api/v1/auth/refresh")!

    /// Ответ входа или продления кладёт refresh-cookie — в память, а не в системное
    /// хранилище, которое пишет её на диск.
    func testSetCookieIsAbsorbed() {
        let jar = RefreshCookieJar()
        let response = HTTPURLResponse(
            url: url, statusCode: 200, httpVersion: nil,
            headerFields: ["Set-Cookie": "sh_refresh=rt-9; Path=/api/v1/auth; Max-Age=2592000; HttpOnly; Secure"]
        )!

        jar.absorb(response, url: url)

        XCTAssertEqual(jar.value(), "rt-9")
    }

    /// Выход и отказ в сессии стирают cookie сроком в прошлом.
    func testExpiredSetCookieClearsTheJar() {
        let jar = RefreshCookieJar()
        jar.restore("rt-9")
        let response = HTTPURLResponse(
            url: url, statusCode: 200, httpVersion: nil,
            headerFields: ["Set-Cookie": "sh_refresh=; Path=/api/v1/auth; Expires=Thu, 01 Jan 1970 00:00:00 GMT"]
        )!

        jar.absorb(response, url: url)

        XCTAssertNil(jar.value())
    }

    /// Ответ без нашей cookie ничего не трогает.
    func testUnrelatedResponseKeepsTheCookie() {
        let jar = RefreshCookieJar()
        jar.restore("rt-9")
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: [:])!

        jar.absorb(response, url: url)

        XCTAssertEqual(jar.value(), "rt-9")
    }
}
