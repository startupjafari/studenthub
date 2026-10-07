import XCTest

@testable import StudentHub

/// Ожидаемые значения посчитаны независимо от этого кода — по формулам OKLab
/// Оттоссона — и сверены с тем, что браузер рисует по `globals.css`. Тест ловит
/// ровно то, ради чего палитра хранится в oklch: расхождение приложения с вебом.
final class OKLCHTests: XCTestCase {
    private let accuracy = 0.0005

    func testWhiteStaysWhite() {
        let (red, green, blue) = OKLCH(1, 0, 0).rgb
        XCTAssertEqual(red, 1, accuracy: accuracy)
        XCTAssertEqual(green, 1, accuracy: accuracy)
        XCTAssertEqual(blue, 1, accuracy: accuracy)
    }

    /// `--foreground` светлой темы: серый без насыщенности, около #0A0A0A.
    func testAchromaticForeground() {
        let (red, green, blue) = OKLCH(0.145, 0, 0).rgb
        XCTAssertEqual(red, 0.039388, accuracy: accuracy)
        XCTAssertEqual(green, 0.039388, accuracy: accuracy)
        XCTAssertEqual(blue, 0.039388, accuracy: accuracy)
    }

    /// `--primary` светлой темы — та самая образовательная синяя, #2563EB.
    func testPrimaryMatchesWeb() {
        let (red, green, blue) = OKLCH(0.546, 0.215, 262.9).rgb
        XCTAssertEqual(red, 0.145754, accuracy: accuracy)
        XCTAssertEqual(green, 0.388121, accuracy: accuracy)
        XCTAssertEqual(blue, 0.920921, accuracy: accuracy)
    }

    /// `--success` выходит за охват sRGB по красному каналу: значение должно
    /// обрезаться по краю, а не уйти в отрицательное и перевернуть цвет.
    func testOutOfGamutIsClamped() {
        let (red, green, blue) = OKLCH(0.522, 0.114, 162.5).rgb
        XCTAssertEqual(red, 0, accuracy: accuracy)
        XCTAssertEqual(green, 0.491168, accuracy: accuracy)
        XCTAssertEqual(blue, 0.335063, accuracy: accuracy)
    }
}
