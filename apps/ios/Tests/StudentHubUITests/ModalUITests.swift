import XCTest

/// Листы: открытие, закрытие кнопкой и жестом, повторное открытие сразу после закрытия.
///
/// Лист — «Подробнее» в своём профиле: статичный, без сети после открытия и без
/// системных запросов.
final class ModalUITests: MockUITestCase {
    private var sheetTitle: XCUIElement { app.navigationBars["Подробнее"] }
    private var done: XCUIElement { app.buttons["profile.details.done"] }

    private func openProfile() {
        openTab("Главная")
        let profile = app.buttons["toolbar.profile"]
        XCTAssertTrue(profile.waitForExistence(timeout: timeout), "нет кнопки профиля")
        profile.tap()
    }

    private func openDetails(file: StaticString = #filePath, line: UInt = #line) {
        let details = app.descendants(matching: .any)["profile.details"].firstMatch
        XCTAssertTrue(details.waitForExistence(timeout: timeout), "нет строки «Подробнее»", file: file, line: line)
        if !(details.exists && details.isHittable) { app.swipeUp() }
        details.tap()
        XCTAssertTrue(waitForHittable(done), "лист не открылся до конца", file: file, line: line)
        assertOnScreen(sheetTitle, "заголовок листа")
    }

    func testSheetClosesWithButton() throws {
        openProfile()
        openDetails()
        XCTAssertTrue(app.staticTexts["ИС-21"].exists, "в листе нет данных профиля")
        done.tap()
        XCTAssertTrue(waitForDisappearance(sheetTitle), "лист не закрылся кнопкой")
    }

    func testSheetClosesWithSwipeDown() throws {
        openProfile()
        openDetails()
        // `swipeDown()` по заголовку двигает палец на высоту самого элемента (~20 pt) —
        // это не жест закрытия. Тянем от верха листа к низу экрана, как человек.
        let window = app.windows.firstMatch
        let top = sheetTitle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let bottom = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.98))
        top.press(forDuration: 0.05, thenDragTo: bottom, withVelocity: .fast, thenHoldForDuration: 0)
        XCTAssertTrue(waitForDisappearance(sheetTitle), "лист не закрылся жестом")
        XCTAssertTrue(waitForHittable(app.descendants(matching: .any)["profile.details"].firstMatch))
    }

    /// Открыть сразу после закрытия, пока закрытие ещё может доигрывать: лист
    /// открывается снова и закрывается, ничего не залипает.
    func testReopenRightAfterClose() throws {
        openProfile()
        for _ in 0..<3 {
            openDetails()
            done.tap()
            XCTAssertTrue(waitForDisappearance(sheetTitle), "лист не закрылся")
        }
    }

    func testDetailsSheetSnapshot() throws {
        openProfile()
        openDetails()
        assertScreen("profile-details")
    }
}
