import XCTest

@testable import StudentHub

/// Разбор `data:` URL, общий для QR всех экранов (P2-4 аудита).
final class DataURLTests: XCTestCase {
    func testDecodesBase64AfterComma() {
        let bytes = Data([0x89, 0x50, 0x4E, 0x47])
        let url = "data:image/png;base64," + bytes.base64EncodedString()

        XCTAssertEqual(DataURL.data(from: url), bytes)
    }

    func testRejectsMissingCommaBrokenBase64AndNil() {
        XCTAssertNil(DataURL.data(from: nil))
        XCTAssertNil(DataURL.data(from: "data:image/png;base64"))
        XCTAssertNil(DataURL.data(from: "data:image/png;base64,@@@"))
    }
}
