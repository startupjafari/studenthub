import XCTest

@testable import StudentHub

final class QRLoginTicketTests: XCTestCase {
    func testTicketIsReadFromWebLink() {
        let token = "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90"
        let ticket = QRLoginTicket(scanned: "https://studenthub.kz/qr?t=\(token)")

        XCTAssertEqual(ticket?.approveToken, token)
    }

    func testWhitespaceAroundLinkIsTolerated() {
        let token = "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90"

        XCTAssertNotNil(QRLoginTicket(scanned: " https://studenthub.kz/qr?t=\(token)\n"))
    }

    /// Главная проверка всего разбора: на платформе есть другие QR — посещаемость,
    /// помещения, — и подтверждать вход, глядя на чужой код, человек не должен.
    func testForeignCodesAreRejected() {
        let token = "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90"
        let foreign = [
            "https://studenthub.kz/attendance/scan?t=\(token)",
            "https://studenthub.kz/qr",
            "https://studenthub.kz/qr?t=not-a-uuid",
            "WIFI:S:StudentHub;T:WPA;P:secret;;",
            "просто текст",
        ]

        for payload in foreign {
            XCTAssertNil(QRLoginTicket(scanned: payload), "принят чужой код: \(payload)")
        }
    }
}

@MainActor
final class QRApproveModelTests: XCTestCase {
    /// Между сканированием и запросом стоит подтверждение: молча подтверждать вход
    /// нельзя — это ровно то, чем пользуется чужой, подсунувший свой код.
    func testScanOnlyAsksForConfirmation() async {
        let api = StubApprover()
        let model = QRApproveModel(api: api)

        await model.scanned("https://studenthub.kz/qr?t=3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90")

        XCTAssertEqual(
            model.state,
            .confirming(QRLoginTicket(approveToken: "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90"), StubApprover.preview)
        )
        XCTAssertEqual(api.calls, 0)
        XCTAssertEqual(api.previews, 1)
    }

    /// Кто просит вход, показывается до кнопки: не удалось узнать — подтверждать
    /// вслепую нельзя, экран заканчивается ошибкой.
    func testPreviewFailureNeverOffersApproval() async {
        let api = StubApprover()
        api.previewFailure = .server(
            code: .notFound,
            message: "QR-сессия не найдена или истекла",
            details: [],
            statusCode: 404
        )
        let model = QRApproveModel(api: api)

        await model.scanned("https://studenthub.kz/qr?t=3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90")
        await model.approve()

        XCTAssertEqual(model.state, .failed("QR-сессия не найдена или истекла"))
        XCTAssertEqual(api.calls, 0)
    }

    func testConfirmedTicketIsSentToServer() async {
        let api = StubApprover()
        let model = QRApproveModel(api: api)
        await model.scanned("https://studenthub.kz/qr?t=3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90")

        await model.approve()

        XCTAssertEqual(api.calls, 1)
        XCTAssertEqual(model.state, .approved)
    }

    /// Сессия QR живёт две минуты. Истёкший код — самый частый отказ, и человек
    /// должен увидеть серверный текст, а не общую фразу.
    func testExpiredSessionShowsServerMessage() async {
        let api = StubApprover()
        api.failure = .server(
            code: .notFound,
            message: "QR-сессия не найдена или истекла",
            details: [],
            statusCode: 404
        )
        let model = QRApproveModel(api: api)
        await model.scanned("https://studenthub.kz/qr?t=3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90")

        await model.approve()

        XCTAssertEqual(model.state, .failed("QR-сессия не найдена или истекла"))
    }

    func testForeignCodeNeverReachesServer() async {
        let api = StubApprover()
        let model = QRApproveModel(api: api)

        await model.scanned("https://studenthub.kz/attendance/scan?t=3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90")
        await model.approve()

        XCTAssertEqual(api.calls, 0)
        if case .failed = model.state {} else {
            XCTFail("чужой код должен закончиться сообщением об ошибке, а не подтверждением")
        }
    }
}

// MARK: - Дублёры

private final class StubApprover: QRLoginApproving, @unchecked Sendable {
    private let lock = NSLock()
    static let preview = QRLoginPreview(
        requester: QRLoginPreview.Requester(browser: "Chrome", os: "Windows", ip: "192.0.2.10"),
        createdAt: nil
    )

    var failure: APIError?
    var previewFailure: APIError?
    private(set) var calls = 0
    private(set) var previews = 0

    func preview(_ ticket: QRLoginTicket) async throws -> QRLoginPreview {
        let error: APIError? = lock.withLock {
            previews += 1
            return previewFailure
        }
        if let error { throw error }
        return Self.preview
    }

    func approve(_ ticket: QRLoginTicket) async throws {
        let error: APIError? = lock.withLock {
            calls += 1
            return failure
        }
        if let error { throw error }
    }
}
