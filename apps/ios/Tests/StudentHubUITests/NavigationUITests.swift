import XCTest

/// Основная навигация: вкладки, прерванные переходы, возврат к корню стека.
final class NavigationUITests: MockUITestCase {
    private let tabs = ["Главная", "Чаты", "Разделы", "Лента"]

    func testEveryTabShowsItsContent() throws {
        waitForShell()
        for title in tabs {
            openTab(title)
            XCTAssertTrue(tab(title).isSelected, "вкладка «\(title)» не выбрана")
            assertOnScreen(app.navigationBars[title], "панель вкладки «\(title)»")
        }
        // Своё содержимое у вкладок, а не только заголовок.
        openTab("Чаты")
        XCTAssertTrue(chatRow(Self.firstChatID).waitForExistence(timeout: timeout), "список чатов пуст")
        openTab("Лента")
        XCTAssertTrue(
            app.descendants(matching: .any)["feed.post.post-1"].waitForExistence(timeout: timeout), "лента пуста")
    }

    /// Нажатия подряд, не дожидаясь конца перехода: последняя вкладка побеждает, и
    /// на экране нет ни второй панели, ни застрявшего промежуточного кадра.
    func testRapidTabSwitchingEndsOnLastTab() throws {
        waitForShell()
        let sequence = ["Лента", "Чаты", "Разделы", "Главная", "Лента", "Чаты", "Разделы"]
        for title in sequence {
            tab(title).tap()
        }
        let last = sequence.last!
        XCTAssertTrue(app.navigationBars[last].waitForExistence(timeout: timeout), "не остановились на «\(last)»")
        XCTAssertTrue(tab(last).isSelected)
        for other in tabs where other != last {
            XCTAssertFalse(tab(other).isSelected, "выбрана и «\(other)»")
            XCTAssertFalse(app.navigationBars[other].exists, "на экране осталась панель «\(other)»")
        }
        assertOnScreen(app.navigationBars[last], "панель после серии переключений")
        // Повторная серия — переходы не залипли после первой.
        tab("Лента").tap()
        tab("Чаты").tap()
        XCTAssertTrue(app.navigationBars["Чаты"].waitForExistence(timeout: timeout))
        XCTAssertTrue(chatRow(Self.firstChatID).waitForExistence(timeout: timeout))
    }

    /// Повторное нажатие на выбранную вкладку внутри стека — возврат к её корню
    /// (поведение `UITabBarController`, которое SwiftUI сохраняет для `NavigationStack`).
    func testReselectingTabPopsToRoot() throws {
        openChat()
        // В переписке панель вкладок спрятана: возвращаемся назад, открываем ещё раз
        // уже вложенный экран с видимой панелью — профиль из «Главной».
        backButton.tap()
        XCTAssertTrue(waitForDisappearance(chatTitle), "не вернулись из переписки")
        openTab("Главная")
        let profile = app.buttons["toolbar.profile"]
        XCTAssertTrue(profile.waitForExistence(timeout: timeout), "нет кнопки профиля")
        profile.tap()
        XCTAssertTrue(app.descendants(matching: .any)["profile.settings"].waitForExistence(timeout: timeout), "профиль не открылся")
        XCTAssertFalse(app.navigationBars["Главная"].exists)

        tab("Главная").tap()
        XCTAssertTrue(app.navigationBars["Главная"].waitForExistence(timeout: timeout), "повторное нажатие не вернуло к корню")
        XCTAssertTrue(waitForDisappearance(app.descendants(matching: .any)["profile.settings"].firstMatch))
    }

    /// Переход внутрь и назад кнопкой: экран возвращается на место целиком.
    func testPushAndBackRestoresRoot() throws {
        openTab("Главная")
        let rootBar = app.navigationBars["Главная"]
        let before = rootBar.frame
        app.buttons["toolbar.profile"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["profile.settings"].waitForExistence(timeout: timeout))
        backButton.tap()
        XCTAssertTrue(rootBar.waitForExistence(timeout: timeout))
        XCTAssertTrue(waitForHittable(app.buttons["toolbar.profile"]))
        XCTAssertEqual(rootBar.frame.minX, before.minX, accuracy: 1, "панель не вернулась на место")
        XCTAssertEqual(rootBar.frame.width, before.width, accuracy: 1)
    }

    func testWorkspaceScreen() throws {
        openTab("Разделы")
        assertScreen("workspace")
    }
}
