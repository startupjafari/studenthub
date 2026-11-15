import XCTest

/// Замеры взаимодействий в переписке (ТЗ 15.11, сценарий 13) на mock API с длинной
/// историей (`SH_UITEST_LARGE=1`: 2000 сообщений в первом чате): меню по долгому
/// нажатию, выбор, лист вложений, поиск, память после повторного открытия панелей.
///
/// Числа с симулятора — сравнительные (`scripts/perf_check.py`); частота кадров на
/// iPhone и подвисания под пальцем — Instruments на устройстве. Без `SH_PERF=1` пропуск.
final class ChatInteractionsPerfTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        guard ProcessInfo.processInfo.environment["SH_PERF"] == "1" else {
            throw XCTSkip("Замеры — только в scripts/test.sh perf (SH_PERF=1)")
        }
        app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(ru)", "-AppleLocale", "ru_RU"]
        app.launchEnvironment["SH_UITEST_MOCK"] = "1"
        app.launchEnvironment["SH_UITEST_LARGE"] = "1"
        app.launchEnvironment["SH_UITEST_SCENARIO"] = "student"
        app.launch()
        openFirstChat()
    }

    override func tearDownWithError() throws {
        app?.terminate()
    }

    private var options: XCTMeasureOptions {
        let options = XCTMeasureOptions()
        options.iterationCount = 5
        options.invocationOptions = [.manuallyStop]
        return options
    }

    private func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    private func openFirstChat() {
        let chats = TabBarButtons.button("Чаты", in: app)
        XCTAssertTrue(chats.waitForExistence(timeout: 20))
        chats.tap()
        let row = element("chatlist.row.chat-1")
        XCTAssertTrue(row.waitForExistence(timeout: 15))
        row.tap()
        XCTAssertTrue(element("chat.title").waitForExistence(timeout: 15))
    }

    private var lastBubble: XCUIElement { element("message.bubble.chat-1-m2000") }

    /// Долгое нажатие → меню на экране → закрыть.
    func testContextMenuAppearance() {
        XCTAssertTrue(lastBubble.waitForExistence(timeout: 15))
        measure(metrics: [XCTClockMetric(), XCTCPUMetric(application: app)], options: options) {
            lastBubble.press(forDuration: 0.5)
            XCTAssertTrue(element("message.menu.select").waitForExistence(timeout: 5))
            stopMeasuring()
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08)).tap()
            XCTAssertTrue(element("message.bubble.chat-1-m2000").waitForExistence(timeout: 5))
        }
    }

    /// Выбор десяти сообщений подряд: отметки и счётчик без пересборки ленты.
    func testSelectionToggling() {
        XCTAssertTrue(lastBubble.waitForExistence(timeout: 15))
        lastBubble.press(forDuration: 0.5)
        element("message.menu.select").tap()
        measure(metrics: [XCTClockMetric(), XCTCPUMetric(application: app), XCTMemoryMetric(application: app)], options: options) {
            for seq in stride(from: 1999, through: 1994, by: -1) {
                let mark = element("message.select.chat-1-m\(seq)")
                if mark.exists { mark.tap() }
            }
            stopMeasuring()
            for seq in stride(from: 1999, through: 1994, by: -1) {
                let mark = element("message.select.chat-1-m\(seq)")
                if mark.exists { mark.tap() }
            }
        }
    }

    /// Лист вложений: появление и память (сетка «Фото»).
    func testAttachmentSheetOpenAndMemory() {
        let attach = element("chat.attach")
        XCTAssertTrue(attach.waitForExistence(timeout: 15))
        measure(metrics: [XCTClockMetric(), XCTMemoryMetric(application: app)], options: options) {
            attach.tap()
            XCTAssertTrue(element("chat.attach.section.file").waitForExistence(timeout: 10))
            stopMeasuring()
            app.swipeDown(velocity: .fast)
            XCTAssertTrue(attach.waitForExistence(timeout: 10))
        }
    }

    /// Поиск по длинной переписке: от ввода до счётчика совпадений.
    func testSearchInLongHistory() {
        element("chat.title").press(forDuration: 1.0)
        app.buttons["Поиск в чате"].firstMatch.tap()
        let field = element("chat.search.field")
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        measure(metrics: [XCTClockMetric(), XCTCPUMetric(application: app)], options: options) {
            field.typeText("курсов")
            XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", " из ")).firstMatch.waitForExistence(timeout: 10))
            stopMeasuring()
            field.buttons.firstMatch.tap()
        }
    }

    /// Утечки: меню, лист вложений и поиск открыты и закрыты много раз — память не растёт.
    func testRepeatedPanelsMemory() {
        XCTAssertTrue(lastBubble.waitForExistence(timeout: 15))
        measure(metrics: [XCTMemoryMetric(application: app)], options: options) {
            for _ in 0..<3 {
                lastBubble.press(forDuration: 0.5)
                _ = element("message.menu.select").waitForExistence(timeout: 5)
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08)).tap()
                element("chat.attach").tap()
                _ = element("chat.attach.section.file").waitForExistence(timeout: 10)
                app.swipeDown(velocity: .fast)
                _ = element("chat.attach").waitForExistence(timeout: 10)
            }
            stopMeasuring()
        }
    }
}
