import XCTest

@testable import StudentHub

/// Экраны до входа: QR-вход и восстановление пароля.
final class QRCodeDrawingTests: XCTestCase {
    /// `Fixtures/qr-login.svg` — настоящая картинка сервера (`renderQrDataUrl`, адрес
    /// `https://studenthub.kz/qr?t=…`, 45×45 модулей плюс тихая зона в 2 модуля).
    /// Числа сверены с матрицей `qrcode`: 858 модулей без «глаз» и места под знак.
    func testServerQRBecomesTheSameModules() throws {
        let drawing = try XCTUnwrap(QRCodeDrawing(svg: fixture()))

        XCTAssertEqual(drawing.side, 49)
        XCTAssertEqual(drawing.badge, 11)
        XCTAssertEqual(drawing.modules.filter { $0.strokeWidth != nil }.count, 3, "три рамки «глаз»")
        XCTAssertEqual(drawing.modules.filter { $0.strokeWidth == nil && $0.rect.width == 3 }.count, 3, "три ядра «глаз»")
        XCTAssertEqual(drawing.modules.filter { $0.strokeWidth == nil && $0.rect.width == 1 }.count, 858)
    }

    func testDataURLIsDecoded() throws {
        let url = "data:image/svg+xml;base64," + Data(try fixture().utf8).base64EncodedString()
        XCTAssertNotNil(QRCodeDrawing(dataURL: url))
    }

    /// Не та картинка — не код: рисовать догадку вместо QR нельзя.
    func testForeignImagesAreRejected() {
        XCTAssertNil(QRCodeDrawing(dataURL: "data:image/png;base64,AAAA"))
        XCTAssertNil(QRCodeDrawing(svg: "<svg viewBox=\"0 0 10 10\"></svg>"))
        XCTAssertNil(QRCodeDrawing(dataURL: "не картинка"))
    }

    private func fixture() throws -> String {
        let url = URL(filePath: #filePath).deletingLastPathComponent().appending(path: "Fixtures/qr-login.svg")
        return try String(contentsOf: url, encoding: .utf8)
    }
}

@MainActor
final class QRSignInModelTests: XCTestCase {
    /// Сервер ответил «не найдено» — код истёк или уже использован: экран предлагает
    /// обновить, а не висит в ожидании.
    func testNotFoundMeansExpired() async throws {
        let api = StubRecovery(claim: .failure(APIError.server(code: .notFound, message: "", details: [], statusCode: 404)))
        let model = QRSignInModel(api: api, pollInterval: .milliseconds(1))

        await model.run(into: AppSessionModel())

        XCTAssertEqual(model.state, .expired)
    }

    /// Не удалось создать сессию — ошибка, а не пустой квадрат.
    func testCreateFailureIsShown() async {
        let api = StubRecovery(create: .failure(APIError.server(code: .internalError, message: "", details: [], statusCode: 500)))
        let model = QRSignInModel(api: api, pollInterval: .milliseconds(1))

        await model.run(into: AppSessionModel())

        guard case .failed = model.state else { return XCTFail("ожидалась ошибка, получено \(model.state)") }
    }
}

@MainActor
final class ForgotPasswordModelTests: XCTestCase {
    func testEmailFormat() {
        XCTAssertTrue(ForgotPasswordModel.isValidEmail("ivan.petrov@uni.edu.kz"))
        XCTAssertFalse(ForgotPasswordModel.isValidEmail(""))
        XCTAssertFalse(ForgotPasswordModel.isValidEmail("ivan@uni"))
        XCTAssertFalse(ForgotPasswordModel.isValidEmail("ivan petrov@uni.kz"))
        XCTAssertFalse(ForgotPasswordModel.isValidEmail("@uni.kz"))
        XCTAssertFalse(ForgotPasswordModel.isValidEmail("a@b@uni.kz"))
    }

    /// Неверный адрес до сервера не уходит: лимит писем общий, три в четверть часа.
    func testInvalidEmailIsNotSent() async {
        let api = StubRecovery()
        let model = ForgotPasswordModel(api: api)
        model.email = "не почта"

        await model.send()

        XCTAssertNotNil(model.emailError)
        XCTAssertTrue(api.resetRequests.isEmpty)
        XCTAssertEqual(model.phase, .form)
    }

    /// Адрес уходит в той форме, что ждёт сервер, а подтверждение не говорит, есть ли
    /// такой человек.
    func testValidEmailIsNormalizedAndConfirmed() async {
        let api = StubRecovery()
        let model = ForgotPasswordModel(api: api)
        model.email = "  Ivan.Petrov@Uni.KZ "

        await model.send()

        XCTAssertEqual(api.resetRequests, ["ivan.petrov@uni.kz"])
        XCTAssertEqual(model.phase, .sent(email: "ivan.petrov@uni.kz"))
        XCTAssertNotNil(model.resendAvailableAt)
    }

    func testServerFailureKeepsForm() async {
        let api = StubRecovery(reset: .failure(APIError.server(code: .rateLimit, message: "Слишком много запросов", details: [], statusCode: 429)))
        let model = ForgotPasswordModel(api: api)
        model.email = "ivan@uni.kz"

        await model.send()

        XCTAssertEqual(model.phase, .form)
        XCTAssertNotNil(model.formError)
    }
}

@MainActor
final class ResetPasswordModelTests: XCTestCase {
    private let token = "Qm9yaXMtdGhlLXRva2VuLWZyb20tbWFpbA"

    /// Обрезанную почтовым клиентом ссылку видно сразу, без запроса.
    func testTruncatedTokenIsInvalidUpFront() {
        XCTAssertEqual(ResetPasswordModel(token: "short", api: StubRecovery()).phase, .invalid)
        XCTAssertEqual(ResetPasswordModel(token: "", api: StubRecovery()).phase, .invalid)
        XCTAssertEqual(ResetPasswordModel(token: token, api: StubRecovery()).phase, .form)
    }

    /// Пароль не по политике до сервера не уходит.
    func testWeakPasswordIsNotSent() async {
        let api = StubRecovery()
        let model = ResetPasswordModel(token: token, api: api)
        model.password = "password"

        await model.save()

        XCTAssertNotNil(model.passwordError)
        XCTAssertTrue(api.newPasswords.isEmpty)
    }

    func testSavedPasswordEndsInDone() async {
        let api = StubRecovery()
        let model = ResetPasswordModel(token: token, api: api)
        model.password = "Secret-2026"

        await model.save()

        XCTAssertEqual(model.phase, .done)
        XCTAssertEqual(api.newPasswords.first?.token, token)
        XCTAssertEqual(model.password, "", "пароль не держим в памяти дольше нужного")
    }

    /// Неизвестная, использованная и истёкшая ссылка — один ответ и один выход.
    func testBadRequestMeansDeadLink() async {
        let api = StubRecovery(newPassword: .failure(APIError.server(code: .badRequest, message: "", details: [], statusCode: 400)))
        let model = ResetPasswordModel(token: token, api: api)
        model.password = "Secret-2026"

        await model.save()

        XCTAssertEqual(model.phase, .invalid)
    }
}

final class AuthLinkTests: XCTestCase {
    func testWebAndSchemeLinks() {
        XCTAssertEqual(
            AuthLink(url: URL(string: "https://studenthub.kz/reset-password?token=abc_DEF-123")!),
            .resetPassword(token: "abc_DEF-123")
        )
        XCTAssertEqual(
            AuthLink(url: URL(string: "http://192.168.0.19.nip.io:3000/register?token=1b4e28ba-2fa1-11d2-883f-0016d3cca427")!),
            .register(token: "1b4e28ba-2fa1-11d2-883f-0016d3cca427")
        )
        XCTAssertEqual(AuthLink(url: URL(string: "studenthub://register?token=abc")!), .register(token: "abc"))
    }

    func testForeignLinksAreIgnored() {
        XCTAssertNil(AuthLink(url: URL(string: "https://studenthub.kz/register")!), "без токена")
        XCTAssertNil(AuthLink(url: URL(string: "https://studenthub.kz/chats?token=abc")!))
        XCTAssertNil(AuthLink(url: URL(string: "https://studenthub.kz/a/register?token=abc")!))
        XCTAssertNil(AuthLink(url: URL(string: "ftp://studenthub.kz/register?token=abc")!))
    }

    /// Токен встаёт в путь запроса превью — «../» из чужой ссылки туда попасть не должен.
    func testTokenWithPathCharactersIsRejected() {
        XCTAssertNil(AuthLink(url: URL(string: "https://studenthub.kz/register?token=..%2F..%2Fauth%2Fme")!))
        XCTAssertNil(AuthLink(url: URL(string: "https://studenthub.kz/register?token=a%20b")!))
    }

    func testLinkInsidePastedMessage() {
        XCTAssertEqual(
            AuthLink(pasted: "Вас пригласили в StudentHub: https://studenthub.kz/register?token=abc123 — до пятницы"),
            .register(token: "abc123")
        )
        XCTAssertEqual(AuthLink(pasted: "  https://studenthub.kz/reset-password?token=xyz  \n"), .resetPassword(token: "xyz"))
        XCTAssertNil(AuthLink(pasted: "abc123"), "голый токен не разобрать: приглашение это или сброс")
    }
}

final class PasswordPolicyTests: XCTestCase {
    func testPolicyMatchesSharedSchema() {
        XCTAssertNil(PasswordPolicy.problem("Secret-2026"))
        XCTAssertNil(PasswordPolicy.problem("Пароль-2026"), "кириллица — тоже буква")
        XCTAssertNotNil(PasswordPolicy.problem("Se-2026"), "короче 8")
        XCTAssertNotNil(PasswordPolicy.problem("12345678-"), "нет буквы")
        XCTAssertNotNil(PasswordPolicy.problem("Secret-word"), "нет цифры")
        XCTAssertNotNil(PasswordPolicy.problem("Secret2026"), "нет спецсимвола")
        XCTAssertNotNil(PasswordPolicy.problem(String(repeating: "Ж", count: 36) + "1!"), "больше 72 байт")
    }

    /// Буква для сервера — только латиница и `А–я`: «ә» в пароле считается спецсимволом.
    func testKazakhLetterCountsAsSpecial() {
        XCTAssertNil(PasswordPolicy.problem("Сәлем2026"))
    }

    func testScore() {
        XCTAssertEqual(PasswordPolicy.score(""), 0)
        XCTAssertEqual(PasswordPolicy.score("abc"), 1)
        XCTAssertEqual(PasswordPolicy.score("abc123"), 2)
        XCTAssertEqual(PasswordPolicy.score("Secret-2026"), 4)
    }
}

@MainActor
final class RegisterModelTests: XCTestCase {
    private let token = "1b4e28ba-2fa1-11d2-883f-0016d3cca427"

    func testPreviewOpensForm() async {
        let model = RegisterModel(token: token, api: StubInvites())

        await model.load()

        XCTAssertEqual(model.preview?.role, .student)
    }

    /// Текст отказа зависит от кода — истёкшее, использованное, отозванное.
    func testRefusalKeepsItsCode() async {
        let api = StubInvites(preview: .failure(APIError.server(code: .inviteExpired, message: "", details: [], statusCode: 410)))
        let model = RegisterModel(token: token, api: api)

        await model.load()

        XCTAssertEqual(model.phase, .invalid(.inviteExpired))
    }

    /// Нет связи — не «приглашение недействительно», а повтор.
    func testOfflineCanBeRetried() async {
        let api = StubInvites(preview: .failure(APIError.transport(URLError(.notConnectedToInternet))))
        let model = RegisterModel(token: token, api: api)

        await model.load()

        guard case .failed(_, let isOffline) = model.phase else { return XCTFail("ожидался сбой, получено \(model.phase)") }
        XCTAssertTrue(isOffline)
    }

    func testValidationMirrorsSchema() async {
        let model = RegisterModel(token: token, api: StubInvites())
        let now = Date()

        var errors = model.validate(emailRequired: true, now: now)
        XCTAssertEqual(
            Set(errors.keys),
            [.firstName, .lastName, .username, .email, .birthDate, .password, .consent]
        )

        model.firstName = "Айгерим"
        model.lastName = "Сапарова"
        model.username = "  Aigerim_S "
        model.email = "aigerim@uni.kz"
        model.birthDate = Calendar.current.date(byAdding: .year, value: -20, to: now)
        model.password = "Secret-2026"
        model.consent = true
        errors = model.validate(emailRequired: true, now: now)
        XCTAssertTrue(errors.isEmpty, "\(errors)")
    }

    /// До 18 лет нужна вторая галочка — согласие законного представителя.
    func testMinorNeedsGuardianConsent() {
        let model = RegisterModel(token: token, api: StubInvites())
        model.birthDate = Calendar.current.date(byAdding: .year, value: -16, to: Date())

        XCTAssertTrue(model.needsGuardian)
        XCTAssertNotNil(model.validate(emailRequired: false)[.guardianConsent])
    }

    func testUsernameRules() {
        XCTAssertTrue(RegisterModel.isValidUsername("ivan_petrov"))
        XCTAssertTrue(RegisterModel.isValidUsername(" Ivan2026 "), "регистр и пробелы нормализуются")
        XCTAssertFalse(RegisterModel.isValidUsername("iv"))
        XCTAssertFalse(RegisterModel.isValidUsername("иван"))
        XCTAssertFalse(RegisterModel.isValidUsername("ivan.petrov"))
    }

    /// Занятое имя — ошибка поля, а не общая плашка.
    func testTakenUsernameLandsOnTheField() async {
        let api = StubInvites(register: .failure(APIError.server(code: .usernameTaken, message: "", details: [], statusCode: 409)))
        let model = RegisterModel(token: token, api: api)
        await model.load()
        model.firstName = "Иван"
        model.lastName = "Петров"
        model.username = "ivan"
        model.birthDate = Calendar.current.date(byAdding: .year, value: -20, to: Date())
        model.password = "Secret-2026"
        model.consent = true

        await model.submit(into: AppSessionModel())

        XCTAssertNotNil(model.errors[.username])
        XCTAssertNil(model.formError)
        XCTAssertEqual(api.registrations.first?.username, "ivan")
        XCTAssertNil(api.registrations.first?.guardianConsent, "совершеннолетнему галочка представителя не нужна")
    }
}

/// Подменный API приглашений.
private final class StubInvites: InviteRegistering, @unchecked Sendable {
    private let previewResult: Result<InvitePreview, Error>
    private let registerResult: Result<AuthSession, Error>
    private(set) var registrations: [InviteRegistration] = []

    init(
        preview: Result<InvitePreview, Error> = .success(InvitePreview(
            role: .student,
            emailRequired: false,
            universityId: "u1",
            facultyId: "f1",
            groupId: "g1",
            expiresAt: Date().addingTimeInterval(3600)
        )),
        register: Result<AuthSession, Error> = .failure(APIError.server(code: .internalError, message: "", details: [], statusCode: 500))
    ) {
        previewResult = preview
        registerResult = register
    }

    func preview(token: String) async throws -> InvitePreview { try previewResult.get() }
    func register(_ form: InviteRegistration) async throws -> AuthSession {
        registrations.append(form)
        return try registerResult.get()
    }
}

/// Подменный API восстановления: ответы задаются заранее, запросы запоминаются.
private final class StubRecovery: AuthRecovering, @unchecked Sendable {
    private let create: Result<QRSignInTicket, Error>
    private let claim: Result<AuthSession, Error>
    private let reset: Result<Void, Error>
    private let newPassword: Result<Void, Error>
    private(set) var resetRequests: [String] = []
    private(set) var newPasswords: [(token: String, password: String)] = []

    init(
        create: Result<QRSignInTicket, Error>? = nil,
        claim: Result<AuthSession, Error> = .failure(APIError.server(code: .badRequest, message: "", details: [], statusCode: 400)),
        reset: Result<Void, Error> = .success(()),
        newPassword: Result<Void, Error> = .success(())
    ) {
        self.create = create ?? .success(StubRecovery.ticket())
        self.claim = claim
        self.reset = reset
        self.newPassword = newPassword
    }

    func createQRSession() async throws -> QRSignInTicket { try create.get() }
    func claimQRSession(_ ticket: QRSignInTicket) async throws -> AuthSession { try claim.get() }
    func requestPasswordReset(email: String) async throws {
        resetRequests.append(email)
        try reset.get()
    }
    func resetPassword(token: String, password: String) async throws {
        newPasswords.append((token, password))
        try newPassword.get()
    }

    /// Билет с настоящей картинкой сервера, чтобы модель дошла до ожидания.
    private static func ticket() -> QRSignInTicket {
        let url = URL(filePath: #filePath).deletingLastPathComponent().appending(path: "Fixtures/qr-login.svg")
        let svg = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        return QRSignInTicket(
            qrId: "qr-1",
            qr: "data:image/svg+xml;base64," + Data(svg.utf8).base64EncodedString(),
            claimSecret: "secret",
            expiresIn: 120
        )
    }
}
