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
        sheetTitle.swipeDown(velocity: .fast)
        if sheetTitle.exists { sheetTitle.swipeDown(velocity: .fast) }
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
