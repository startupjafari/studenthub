import XCTest

/// С уменьшением движения (`SH_UITEST_REDUCE_MOTION=1`) переходы обязаны доходить до
/// конечного состояния так же, как с анимацией: никакой «застрявшей» половины.
final class ReduceMotionUITests: MockUITestCase {
    override var reduceMotion: Bool { true }

    func testTabsSwitchToFinalState() throws {
        waitForShell()
        for title in ["Лента", "Чаты", "Разделы", "Главная"] {
            openTab(title)
            XCTAssertTrue(tab(title).isSelected)
            assertOnScreen(app.navigationBars[title], "панель «\(title)»")
        }
    }

    func testChatOpensAndClosesFully() throws {
        openChat()
        XCTAssertTrue(waitForHittable(chatTitle))
        assertOnScreen(chatTitle, "заголовок чата")
        backButton.tap()
        XCTAssertTrue(waitForDisappearance(chatTitle), "переписка не закрылась")
        XCTAssertTrue(waitForHittable(chatRow(Self.firstChatID)))
    }

    func testSheetOpensAndClosesFully() throws {
        openTab("Главная")
        app.buttons["toolbar.profile"].tap()
        let details = app.descendants(matching: .any)["profile.details"].firstMatch
        XCTAssertTrue(details.waitForExistence(timeout: timeout))
        details.tap()
        let done = app.buttons["profile.details.done"]
        XCTAssertTrue(waitForHittable(done), "лист не открылся до конца")
        assertOnScreen(app.navigationBars["Подробнее"], "заголовок листа")
        done.tap()
        XCTAssertTrue(waitForDisappearance(app.navigationBars["Подробнее"]), "лист не закрылся")
    }
}
