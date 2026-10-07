import XCTest

/// Обход экранов: вход и каждая вкладка по очереди.
///
/// Это не проверка логики — её закрывают юнит-тесты. Смысл обхода в том, что он
/// идёт на симуляторе с записью видео, и человек без Mac может посмотреть
/// работающее приложение, скачав артефакт прогона. Заодно обход ловит то, чего
/// юнит-тесты не видят вовсе: экран, который не открывается, и вёрстку, которая
/// разъезжается на крупном шрифте.
final class ScreenTourTests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testTourEveryTab() {
        let app = launchApp()
        signIn(app)

        let tabs = app.tabBars.firstMatch
        XCTAssertTrue(tabs.waitForExistence(timeout: 30), "Оболочка с вкладками не появилась после входа")

        for index in 0..<tabs.buttons.count {
            let tab = tabs.buttons.element(boundBy: index)
            guard tab.exists else { continue }
            tab.tap()
            // Пауза не ради анимации, а ради видео: без неё экран успевает
            // мелькнуть и на записи его не разглядеть.
            Thread.sleep(forTimeInterval: 1.5)
            capture(app, named: "tab-\(index)-\(tab.label)")
        }
    }

    /// Тот же обход на самом крупном шрифте. Сломанная вёрстка видна сразу, а
    /// «Dynamic Type до XXL не ломает раскладку» — пункт приёмки фазы.
    func testTourWithLargestText() {
        let app = launchApp(extraArguments: [
            "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityXXL",
        ])
        signIn(app)

        let tabs = app.tabBars.firstMatch
        XCTAssertTrue(tabs.waitForExistence(timeout: 30), "Оболочка с вкладками не появилась после входа")

        for index in 0..<tabs.buttons.count {
            let tab = tabs.buttons.element(boundBy: index)
            guard tab.exists else { continue }
            tab.tap()
            Thread.sleep(forTimeInterval: 1.5)
            capture(app, named: "xxl-tab-\(index)")
        }
    }

    // MARK: - Шаги

    private func launchApp(extraArguments: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        // Сеть подменена заготовками: обход не зависит ни от стенда, ни от связи.
        app.launchArguments += ["-uiTestStub"] + extraArguments
        app.launch()
        return app
    }

    private func signIn(_ app: XCUIApplication) {
        let identifier = app.textFields["login.identifier"]
        XCTAssertTrue(identifier.waitForExistence(timeout: 30), "Экран входа не появился")
        capture(app, named: "login")

        identifier.tap()
        identifier.typeText("student@studenthub.kz")

        let password = app.secureTextFields["login.password"]
        XCTAssertTrue(password.waitForExistence(timeout: 5), "Поле пароля не найдено")
        password.tap()
        password.typeText("Demo1234!")

        capture(app, named: "login-filled")
        app.buttons["login.submit"].tap()
    }

    /// Скриншот кладётся в отчёт прогона. Видео показывает движение, снимки —
    /// детали, которые на записи смазываются.
    private func capture(_ app: XCUIApplication, named name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
