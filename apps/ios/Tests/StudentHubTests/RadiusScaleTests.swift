import XCTest

@testable import StudentHub

/// Шкала радиусов считается от одного корня. Тест держит эту связь: если кто-то
/// поправит производное значение руками, форма системы разъедется с вебом молча.
final class RadiusScaleTests: XCTestCase {
    func testScaleDerivesFromRoot() {
        XCTAssertEqual(Radius.sm, Radius.root * 0.6, accuracy: 0.001)
        XCTAssertEqual(Radius.md, Radius.root * 0.8, accuracy: 0.001)
        XCTAssertEqual(Radius.xl, Radius.root * 1.4, accuracy: 0.001)
        XCTAssertEqual(Radius.xxl, Radius.root * 1.8, accuracy: 0.001)
    }

    func testNestedRadiusNeverExceedsOuter() {
        XCTAssertLessThan(Radius.nested(Radius.xxl), Radius.xxl)
        XCTAssertGreaterThanOrEqual(Radius.nested(Radius.sm), Radius.sm)
    }
}
