import XCTest

@testable import StudentHub

/// Общий ход действий экрана (P2-3 аудита).
@MainActor
final class ActionRunnerTests: XCTestCase {
    private struct Boom: Error {}

    /// Успех: работа помечена на время действия, после — перечитывание, ошибки нет.
    func testSuccessRunsThenAndClearsFailure() async {
        let runner = ActionRunner()
        runner.failure = "старая ошибка"
        var sawWorking = false
        var reloaded = false

        let ok = await runner.run({ sawWorking = runner.isWorking }, then: { reloaded = true })

        XCTAssertTrue(ok)
        XCTAssertTrue(sawWorking)
        XCTAssertTrue(reloaded)
        XCTAssertFalse(runner.isWorking)
        XCTAssertNil(runner.failure)
    }

    /// Отказ: текст для алерта, перечитывания нет.
    func testFailureSetsMessageAndSkipsThen() async {
        let runner = ActionRunner()
        var reloaded = false

        let ok = await runner.run({ throw Boom() }, then: { reloaded = true })

        XCTAssertFalse(ok)
        XCTAssertFalse(reloaded)
        XCTAssertNotNil(runner.failure)
        XCTAssertFalse(runner.isWorking)
    }

    /// Отмена — не ошибка: экран ушёл, алерта нет.
    func testCancellationIsNotAFailure() async {
        let runner = ActionRunner()

        let ok = await runner.run({ throw CancellationError() })

        XCTAssertFalse(ok)
        XCTAssertNil(runner.failure)
    }
}
