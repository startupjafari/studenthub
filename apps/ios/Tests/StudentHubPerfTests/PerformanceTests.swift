import XCTest

/// Производительность на mock API с большими данными (`SH_UITEST_LARGE=1`: сотни чатов,
/// тысячи сообщений, сотни постов): запуск, прокрутка, переходы, CPU и память.
///
/// Метрики сверяет `scripts/perf_check.py` с `Tests/perf-baseline.json`. Это симулятор на
/// раннере CI: числа сравнительные — они ловят регрессию между коммитами на одной
/// машине, но не говорят, сколько кадров в секунду будет на iPhone. Частота 120 Гц,
/// подвисания на устройстве и тепловой режим проверяются только Instruments на телефоне.
///
/// Без `SH_PERF=1` (его ставит `scripts/test.sh perf`) набор пропускается.
final class PerformanceTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        guard ProcessInfo.processInfo.environment["SH_PERF"] == "1" else {
            throw XCTSkip("Замеры — только в scripts/test.sh perf (SH_PERF=1)")
        }
    }

    private func makeApp(signedIn: Bool = true) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(ru)", "-AppleLocale", "ru_RU"]
        app.launchEnvironment["SH_UITEST_MOCK"] = "1"
        app.launchEnvironment["SH_UITEST_LARGE"] = "1"
        app.launchEnvironment["SH_UITEST_SCENARIO"] = signedIn ? "student" : "signedOut"
        return app
    }

    private var options: XCTMeasureOptions {
        let options = XCTMeasureOptions()
        options.iterationCount = 5
        return options
    }

    /// Панель Liquid Glass отдаёт по два элемента на вкладку — берём нажимаемый
    /// (как `MockUITestCase.tab`).
    private func tab(_ title: String, in app: XCUIApplication) -> XCUIElement {
        let matches = app.tabBars.buttons.matching(NSPredicate(format: "label == %@", title))
        if matches.count > 1 {
            for index in 0..<matches.count where matches.element(boundBy: index).isHittable {
                return matches.element(boundBy: index)
            }
        }
        return matches.firstMatch
    }

    // MARK: - Запуск

    /// Холодный запуск до первого отзывчивого кадра — уже с сессией, сразу в оболочку.
    func testLaunchToShell() {
        let app = makeApp()
        measure(metrics: [XCTApplicationLaunchMetric(waitUntilResponsive: true)], options: options) {
            app.launch()
            XCTAssertTrue(tab("Чаты", in: app).waitForExistence(timeout: 20))
            app.terminate()
        }
    }

    // MARK: - Прокрутка

    /// Длинный список чатов: подвисания при прокрутке и торможении, CPU и память.
    func testChatListScroll() {
        let app = makeApp()
        app.launch()
        tab("Чаты", in: app).tap()
        let list = app.collectionViews.firstMatch.exists ? app.collectionViews.firstMatch : app.tables.firstMatch
        XCTAssertTrue(list.waitForExistence(timeout: 15))

        let options = self.options
        options.invocationOptions = [.manuallyStop]
        measure(
            metrics: [XCTOSSignpostMetric.scrollingAndDecelerationMetric, XCTCPUMetric(application: app),
                      XCTMemoryMetric(application: app)],
            options: options
        ) {
            list.swipeUp(velocity: .fast)
            list.swipeUp(velocity: .fast)
            stopMeasuring()
            list.swipeDown(velocity: .fast)
            list.swipeDown(velocity: .fast)
        }
    }

    /// Переписка с тысячами сообщений: прокрутка истории вверх и обратно.
    func testMessageHistoryScroll() {
        let app = makeApp()
        app.launch()
        tab("Чаты", in: app).tap()
        let firstRow = app.cells.firstMatch
        XCTAssertTrue(firstRow.waitForExistence(timeout: 15))
        firstRow.tap()
        let messages = app.descendants(matching: .any)["chat.messages"]
        XCTAssertTrue(messages.waitForExistence(timeout: 15))

        let options = self.options
        options.invocationOptions = [.manuallyStop]
        measure(
            metrics: [XCTOSSignpostMetric.scrollingAndDecelerationMetric, XCTCPUMetric(application: app),
                      XCTMemoryMetric(application: app)],
            options: options
        ) {
            messages.swipeDown(velocity: .fast)
            messages.swipeDown(velocity: .fast)
            stopMeasuring()
            messages.swipeUp(velocity: .fast)
            messages.swipeUp(velocity: .fast)
        }
    }

    /// Лента публикаций: карточки с картинками и счётчиками.
    func testFeedScroll() {
        let app = makeApp()
        app.launch()
        tab("Лента", in: app).tap()
        let feed = app.descendants(matching: .any)["feed.list"]
        XCTAssertTrue(feed.waitForExistence(timeout: 15))

        let options = self.options
        options.invocationOptions = [.manuallyStop]
        measure(
            metrics: [XCTOSSignpostMetric.scrollingAndDecelerationMetric, XCTMemoryMetric(application: app)],
            options: options
        ) {
            feed.swipeUp(velocity: .fast)
            feed.swipeUp(velocity: .fast)
            stopMeasuring()
            feed.swipeDown(velocity: .fast)
            feed.swipeDown(velocity: .fast)
        }
    }

    // MARK: - Переходы

    /// Открыть переписку и вернуться: переход навигации (signpost системы).
    func testOpenChatTransition() {
        let app = makeApp()
        app.launch()
        tab("Чаты", in: app).tap()
        let firstRow = app.cells.firstMatch
        XCTAssertTrue(firstRow.waitForExistence(timeout: 15))

        let options = self.options
        options.invocationOptions = [.manuallyStop]
        measure(metrics: [XCTOSSignpostMetric.navigationTransitionMetric, XCTClockMetric()], options: options) {
            firstRow.tap()
            XCTAssertTrue(app.descendants(matching: .any)["chat.messages"].waitForExistence(timeout: 10))
            stopMeasuring()
            app.navigationBars.buttons.firstMatch.tap()
            XCTAssertTrue(firstRow.waitForExistence(timeout: 10))
        }
    }

    /// Смена вкладок по кругу: время до появления содержимого.
    func testTabSwitching() {
        let app = makeApp()
        app.launch()
        XCTAssertTrue(tab("Чаты", in: app).waitForExistence(timeout: 20))
        measure(metrics: [XCTClockMetric(), XCTCPUMetric(application: app)], options: options) {
            for title in ["Чаты", "Разделы", "Лента", "Главная"] {
                let button = tab(title, in: app)
                button.tap()
                XCTAssertTrue(button.isSelected)
            }
        }
    }
}
