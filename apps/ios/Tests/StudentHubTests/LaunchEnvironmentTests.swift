import XCTest

@testable import StudentHub

/// Переменные запуска для тестов разбираются строго: опечатка заметна, а не превращается
/// в прогон «как в коде» (`docs/IOS_RULES.md` 2.7.8, 2.7.9).
final class LaunchEnvironmentTests: XCTestCase {
    func testKnownFlagsAreApplied() {
        let parsed = PerformanceFlags.parseReporting("chatHeightCache=1, chatBubbleFlatShadow=0")
        XCTAssertEqual(parsed.flags, [.chatHeightCache: true, .chatBubbleFlatShadow: false])
        XCTAssertEqual(parsed.problems, [])
    }

    func testAllSwitchesEveryFlag() {
        let parsed = PerformanceFlags.parseReporting("all=0")
        XCTAssertEqual(parsed.flags.count, PerformanceFlags.Switch.allCases.count)
        XCTAssertTrue(parsed.flags.values.allSatisfy { $0 == false })
    }

    func testEmptySpecIsNotAProblem() {
        XCTAssertEqual(PerformanceFlags.parseReporting("").problems, [])
    }

    /// Опечатка в имени, значение не 0/1 и пара без «=» — каждая названа; понятые пары
    /// рядом всё равно применяются.
    func testTyposAreReported() {
        let parsed = PerformanceFlags.parseReporting("chatHeightCach=1,chatEstimatedHeights=yes,all,chatHeightCache=1")
        XCTAssertEqual(parsed.problems.count, 3)
        XCTAssertEqual(parsed.flags, [.chatHeightCache: true])
    }

    func testScenarioNamesAreContract() {
        XCTAssertEqual(UITestEnvironment.scenario(nil), .signedOut)
        XCTAssertEqual(UITestEnvironment.scenario(""), .signedOut)
        XCTAssertEqual(UITestEnvironment.scenario("signedOut"), .signedOut)
        XCTAssertEqual(UITestEnvironment.scenario("student"), .student)
    }
}
