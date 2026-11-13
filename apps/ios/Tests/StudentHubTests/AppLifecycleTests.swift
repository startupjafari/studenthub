import XCTest

@testable import StudentHub

/// Жизненный цикл приложения для экранов (P1-10 аудита).
@MainActor
final class AppLifecycleTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_800_000_000)

    /// Короткий выход (за уведомлением) не делает экраны несвежими, долгий — делает.
    func testEpochGrowsOnlyAfterLongBackground() {
        let lifecycle = AppLifecycle()

        lifecycle.enterBackground(at: start)
        lifecycle.becomeActive(at: start.addingTimeInterval(10))
        XCTAssertEqual(lifecycle.foregroundEpoch, 0)

        lifecycle.enterBackground(at: start.addingTimeInterval(20))
        lifecycle.becomeActive(at: start.addingTimeInterval(20 + AppLifecycle.staleAfter))
        XCTAssertEqual(lifecycle.foregroundEpoch, 1)
        XCTAssertTrue(lifecycle.isActive)
    }

    /// Повторная фаза той же стороны ничего не меняет.
    func testRepeatedPhasesAreIgnored() {
        let lifecycle = AppLifecycle()

        lifecycle.becomeActive(at: start)
        lifecycle.enterBackground(at: start)
        lifecycle.enterBackground(at: start.addingTimeInterval(500))
        lifecycle.becomeActive(at: start.addingTimeInterval(30))

        XCTAssertEqual(lifecycle.foregroundEpoch, 0)
    }

    /// Ожидание переднего плана: на переднем — сразу, в фоне — до возвращения.
    func testWaitUntilActiveResumesOnReturn() async {
        let lifecycle = AppLifecycle()
        await lifecycle.waitUntilActive()

        lifecycle.enterBackground(at: start)
        let waiter = Task { @MainActor in
            await lifecycle.waitUntilActive()
            return lifecycle.isActive
        }
        try? await Task.sleep(for: .milliseconds(20))
        lifecycle.becomeActive(at: start.addingTimeInterval(1))

        let resumedActive = await waiter.value
        XCTAssertTrue(resumedActive)
    }
}
