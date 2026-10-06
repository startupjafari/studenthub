import XCTest

@testable import StudentHub

/// Действует до 2100 года — чтобы тест не начал падать однажды утром.
private let longLivedToken = """
    eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLWZ1dHVyZSIsInJvbGUiOiJTVFVERU5UIiwidW5pdmVyc2l0eUlkIjoidS05IiwiZmFjdWx0eUlkIjpudWxsLCJncm91cElkIjpudWxsLCJ0ZmEiOnRydWUsImV4cCI6NDEwMjQ0NDgwMH0.signature
    """

@MainActor
final class LoginFlowTests: XCTestCase {
    /// Обычный вход без второго фактора: сессия открыта, пароль в форме не остался.
    func testSuccessfulSignInOpensSession() async {
        let issuer = StubIssuer()
        issuer.signInResult = .success(.session(AuthSession(accessToken: longLivedToken, refreshToken: nil)))
        let session = makeSession()
        let model = LoginModel(auth: issuer)
        model.identifier = "  student@univer.kz  "
        model.password = "Secret123!"

        await model.signIn(into: session)

        XCTAssertEqual(session.token?.raw, longLivedToken)
        XCTAssertEqual(model.password, "")
        XCTAssertNil(model.formError)
        // Пробелы по краям — обычная добыча автоподстановки, и сервер из-за них
        // не найдёт пользователя.
        XCTAssertEqual(issuer.lastIdentifier, "student@univer.kz")
    }

    /// Пустую форму в сеть не отправляем: лимит входа общий, пять попыток за 15 минут.
    func testEmptyFormDoesNotReachNetwork() async {
        let issuer = StubIssuer()
        let session = makeSession()
        let model = LoginModel(auth: issuer)

        await model.signIn(into: session)

        XCTAssertEqual(issuer.signInCalls, 0)
        XCTAssertNotNil(model.identifierError)
        XCTAssertNotNil(model.passwordError)
        XCTAssertNil(session.token)
    }

    func testTwoFactorChallengeMovesToSecondStep() async {
        let issuer = StubIssuer()
        issuer.signInResult = .success(.twoFactorRequired(challengeToken: "challenge-1"))
        let session = makeSession()
        let model = LoginModel(auth: issuer)
        model.identifier = "teacher@univer.kz"
        model.password = "Secret123!"

        await model.signIn(into: session)

        XCTAssertEqual(model.step, .twoFactor)
        XCTAssertNil(session.token)
    }

    /// Код проверяется challenge'ем, выданным на первом шаге, а не паролем заново.
    func testVerifiedCodeOpensSession() async {
        let issuer = StubIssuer()
        issuer.signInResult = .success(.twoFactorRequired(challengeToken: "challenge-1"))
        issuer.verifyResult = .success(AuthSession(accessToken: longLivedToken, refreshToken: nil))
        let session = makeSession()
        let model = LoginModel(auth: issuer)
        model.identifier = "teacher@univer.kz"
        model.password = "Secret123!"
        await model.signIn(into: session)

        model.code = "123456"
        await model.verifyTwoFactor(into: session)

        XCTAssertEqual(issuer.lastChallenge, "challenge-1")
        XCTAssertEqual(session.token?.raw, longLivedToken)
        XCTAssertEqual(model.code, "")
        XCTAssertEqual(model.step, .credentials)
    }

    /// Ошибка про код — под полем кода, а не баннером над формой (§10.3): человек
    /// смотрит туда, где печатал.
    func testWrongCodeIsShownUnderTheField() async {
        let issuer = StubIssuer()
        issuer.signInResult = .success(.twoFactorRequired(challengeToken: "challenge-1"))
        issuer.verifyResult = .failure(
            .server(code: .invalidTwoFactorCode, message: "Неверный код", details: [], statusCode: 401)
        )
        let session = makeSession()
        let model = LoginModel(auth: issuer)
        model.identifier = "teacher@univer.kz"
        model.password = "Secret123!"
        await model.signIn(into: session)

        model.code = "000000"
        await model.verifyTwoFactor(into: session)

        XCTAssertEqual(model.codeError, "Неверный код")
        XCTAssertNil(model.formError)
        XCTAssertEqual(model.step, .twoFactor)
    }

    /// Блокировка по счётчику неудач — не про поле, а про учётную запись: такому
    /// сообщению место над формой.
    func testLockedAccountIsShownAboveTheForm() async {
        let issuer = StubIssuer()
        issuer.signInResult = .failure(
            .server(code: .loginLocked, message: "Слишком много попыток", details: [], statusCode: 429)
        )
        let session = makeSession()
        let model = LoginModel(auth: issuer)
        model.identifier = "student@univer.kz"
        model.password = "Secret123!"

        await model.signIn(into: session)

        XCTAssertEqual(model.formError, "Слишком много попыток")
        XCTAssertNil(session.token)
    }

    /// Возврат с шага кода выбрасывает challenge: он одноразовый, и второй раз
    /// отправить его некуда.
    func testStartOverForgetsChallenge() async {
        let issuer = StubIssuer()
        issuer.signInResult = .success(.twoFactorRequired(challengeToken: "challenge-1"))
        let session = makeSession()
        let model = LoginModel(auth: issuer)
        model.identifier = "teacher@univer.kz"
        model.password = "Secret123!"
        await model.signIn(into: session)

        model.startOver()
        model.code = "123456"
        await model.verifyTwoFactor(into: session)

        XCTAssertEqual(model.step, .credentials)
        XCTAssertEqual(issuer.verifyCalls, 0)
    }

    private func makeSession() -> AppSessionModel {
        AppSessionModel(store: SessionStore(auth: SilentRefresher(), secrets: MemorySecrets()))
    }
}

// MARK: - Дублёры

private final class StubIssuer: SessionIssuing, @unchecked Sendable {
    private let lock = NSLock()

    var signInResult: Result<LoginOutcome, APIError> = .failure(.malformedResponse(statusCode: 0))
    var verifyResult: Result<AuthSession, APIError> = .failure(.malformedResponse(statusCode: 0))

    private(set) var signInCalls = 0
    private(set) var verifyCalls = 0
    private(set) var lastIdentifier: String?
    private(set) var lastChallenge: String?

    func signIn(identifier: String, password: String) async throws -> LoginOutcome {
        let result: Result<LoginOutcome, APIError> = lock.withLock {
            signInCalls += 1
            lastIdentifier = identifier
            return signInResult
        }
        return try result.get()
    }

    func verifyTwoFactor(challengeToken: String, code: String) async throws -> AuthSession {
        let result: Result<AuthSession, APIError> = lock.withLock {
            verifyCalls += 1
            lastChallenge = challengeToken
            return verifyResult
        }
        return try result.get()
    }
}

/// Продлевать в этих тестах нечего: сессия приходит из входа, а не из cookie.
private struct SilentRefresher: SessionRefreshing {
    func refresh(using storedRefreshToken: String?) async throws -> AuthSession {
        throw APIError.malformedResponse(statusCode: 0)
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
