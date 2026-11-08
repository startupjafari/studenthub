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

/// Подменный API восстановления: ответы задаются заранее, запросы запоминаются.
private final class StubRecovery: AuthRecovering, @unchecked Sendable {
    private let create: Result<QRSignInTicket, Error>
    private let claim: Result<AuthSession, Error>
    private let reset: Result<Void, Error>
    private(set) var resetRequests: [String] = []

    init(
        create: Result<QRSignInTicket, Error>? = nil,
        claim: Result<AuthSession, Error> = .failure(APIError.server(code: .badRequest, message: "", details: [], statusCode: 400)),
        reset: Result<Void, Error> = .success(())
    ) {
        self.create = create ?? .success(StubRecovery.ticket())
        self.claim = claim
        self.reset = reset
    }

    func createQRSession() async throws -> QRSignInTicket { try create.get() }
    func claimQRSession(_ ticket: QRSignInTicket) async throws -> AuthSession { try claim.get() }
    func requestPasswordReset(email: String) async throws {
        resetRequests.append(email)
        try reset.get()
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
