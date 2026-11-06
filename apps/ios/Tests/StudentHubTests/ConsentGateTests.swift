import XCTest

@testable import StudentHub

@MainActor
final class ConsentGateTests: XCTestCase {
    /// Сервер сказал «нужно согласие» — экран закрывает приложение.
    func testRequiredStateClosesTheApp() async {
        let api = StubConsent(state: state(required: true))
        let model = ConsentGateModel(api: api)

        await model.load()

        XCTAssertTrue(model.isRequired)
    }

    /// Без галочки запрос не уходит: отказ — это незаполненная форма.
    func testAcceptWithoutConsentDoesNotReachServer() async {
        let api = StubConsent(state: state(required: true))
        let model = ConsentGateModel(api: api)
        await model.load()

        await model.accept()

        XCTAssertEqual(api.accepts, 0)
        XCTAssertNotNil(model.failure)
        XCTAssertTrue(model.isRequired)
    }

    /// За несовершеннолетнего согласие даёт представитель: без второй галочки — нельзя.
    func testGuardianConsentIsRequiredForMinor() async {
        let api = StubConsent(state: state(required: true, guardianRequired: true))
        let model = ConsentGateModel(api: api)
        await model.load()
        model.consent = true

        await model.accept()
        XCTAssertEqual(api.accepts, 0)

        model.guardianConsent = true
        await model.accept()
        XCTAssertEqual(api.accepts, 1)
        XCTAssertEqual(api.lastGuardian, true)
        XCTAssertFalse(model.isRequired)
    }

    private func state(required: Bool, guardianRequired: Bool = false) -> ConsentStateDTO {
        ConsentStateDTO(required: required, reason: "VERSION", guardianRequired: guardianRequired, birthDateRequired: false)
    }
}

private final class StubConsent: ConsentChecking, @unchecked Sendable {
    private let lock = NSLock()
    private let initial: ConsentStateDTO
    private(set) var accepts = 0
    private(set) var lastGuardian: Bool?

    init(state: ConsentStateDTO) {
        initial = state
    }

    func state() async throws -> ConsentStateDTO { initial }

    func accept(guardianConsent: Bool?, birthDate: String?) async throws -> ConsentStateDTO {
        lock.withLock {
            accepts += 1
            lastGuardian = guardianConsent
        }
        return ConsentStateDTO(required: false, reason: nil, guardianRequired: false, birthDateRequired: false)
    }
}
