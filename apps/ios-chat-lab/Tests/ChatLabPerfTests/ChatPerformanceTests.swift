import XCTest

/// Замеры производительности (схема ChatLabPerf, Release). Два источника чисел:
/// - метрики XCTest: время запуска, подвисания прокрутки по системным сигнпостам
///   (`XCTOSSignpostMetric.scroll*`), CPU, память, длительность взаимодействий;
/// - монитор кадров приложения (`perf.summary`, CADisplayLink): число кадров, fps, рывки,
///   худший кадр. Эти числа печатаются строкой `PERF …` и сверяются с Tests/perf-baseline.json
///   скриптом scripts/perf_check.py.
///
/// На симуляторе цифры годятся только для сравнения прогонов между собой; плавность на 120 Гц
/// проверяется на iPhone (`scripts/run-performance-tests.sh` сам берёт подключённый телефон).
final class ChatPerformanceTests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    // MARK: Запуск

    func testLaunchToChat() {
        measure(metrics: [XCTApplicationLaunchMetric(waitUntilResponsive: true)]) {
            let app = XCUIApplication()
            app.launchArguments = ["-uiTesting"]
            app.launch()
        }
    }

    // MARK: Прокрутка длинной истории

    func testScrollHistoryHitches() {
        let app = ChatLabApp.launch()
        resetPerf(app)
        let options = XCTMeasureOptions()
        options.iterationCount = 5
        measure(metrics: [XCTOSSignpostMetric.scrollDraggingMetric, XCTOSSignpostMetric.scrollDecelerationMetric, XCTCPUMetric(application: app), XCTMemoryMetric(application: app)], options: options) {
            for _ in 0..<6 { app.chatList.swipeDown(velocity: .fast) }
            for _ in 0..<6 { app.chatList.swipeUp(velocity: .fast) }
        }
        report("scroll_history", app)
    }

    /// Медленная прокрутка: ячейки с медиа появляются по одной — здесь видны рывки раскладки
    /// и декодирования, которые быстрая прокрутка «проскакивает».
    func testSlowScrollThroughMedia() {
        let app = ChatLabApp.launch()
        sleep(3) // медиа сгенерированы при первом запуске
        resetPerf(app)
        measure(metrics: [XCTOSSignpostMetric.scrollDraggingMetric]) {
            for _ in 0..<10 { app.chatList.swipeDown(velocity: .slow) }
        }
        report("scroll_media_slow", app)
    }

    // MARK: Взаимодействия

    func testKeyboardOpenClose() {
        let app = ChatLabApp.launch()
        resetPerf(app)
        measure(metrics: [XCTClockMetric()]) {
            app.inputField.tap()
            _ = app.keyboards.firstMatch.waitForExistence(timeout: 3)
            app.chatList.swipeDown()
            _ = app.keyboards.firstMatch.waitForDisappearance(timeout: 3)
        }
        report("keyboard", app)
    }

    func testContextMenuOpenClose() {
        let app = ChatLabApp.launch()
        guard let bubble = app.lowestBubble else { return XCTFail("нет пузыря") }
        resetPerf(app)
        measure(metrics: [XCTClockMetric()]) {
            bubble.press(forDuration: 0.5)
            _ = app.otherElements["contextMenu"].waitForExistence(timeout: 3)
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08)).tap()
            _ = app.otherElements["contextMenu"].waitForDisappearance(timeout: 3)
        }
        report("context_menu", app)
    }

    func testSendBurst() {
        let app = ChatLabApp.launch()
        app.inputField.tap()
        resetPerf(app)
        measure(metrics: [XCTClockMetric(), XCTCPUMetric(application: app)]) {
            for index in 0..<5 {
                app.inputField.typeText("Замер \(index)")
                app.sendButton.tap()
            }
        }
        report("send_burst", app)
    }

    func testMediaViewerOpenClose() {
        let app = ChatLabApp.launch()
        app.debugAction("debug.sendPhoto")
        let photo = app.messageBubbles.matching(NSPredicate(format: "label BEGINSWITH 'Фотография'")).allElementsBoundByIndex.last
        guard let photo, photo.waitForExistence(timeout: 5) else { return XCTFail("нет фото") }
        resetPerf(app)
        measure(metrics: [XCTClockMetric()]) {
            photo.tap()
            _ = app.otherElements["mediaViewer"].waitForExistence(timeout: 3)
            app.swipeDown(velocity: .fast)
            _ = app.otherElements["mediaViewer"].waitForDisappearance(timeout: 3)
        }
        report("media_viewer", app)
    }

    func testIncomingBurstWhileScrolledUp() {
        let app = ChatLabApp.launch()
        for _ in 0..<4 { app.chatList.swipeDown() }
        let anchor = app.lowestBubble
        let before = anchor?.frame
        resetPerf(app)
        app.debugAction("debug.receive10")
        sleep(1)
        if let anchor, let before, anchor.exists {
            // Пользователь не внизу: пришедшие сообщения не сдвигают читаемое.
            XCTAssertEqual(anchor.frame.minY, before.minY, accuracy: 2, "позиция ленты сохранилась")
        }
        XCTAssertTrue((app.buttons["chat.scrollToBottom"].value as? String ?? "").contains("новых"), "у кнопки «вниз» — счётчик пришедших")
        report("incoming_burst", app)
    }

    // MARK: Монитор кадров

    private func resetPerf(_ app: XCUIApplication) {
        app.debugAction("debug.perfReset")
    }

    /// Строка `PERF …` для scripts/perf_check.py + вложение с полным JSON.
    private func report(_ name: String, _ app: XCUIApplication) {
        let summary = app.perfSummary()
        let keys = ["frames", "fps", "hitches", "hitchRatioMsPerS", "worstMs", "maxFps"]
        let line = "PERF name=\(name) " + keys.compactMap { key in summary[key].map { "\(key)=\($0)" } }.joined(separator: " ")
        print(line)
        let attachment = XCTAttachment(string: line)
        attachment.name = "perf-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertFalse(summary.isEmpty, "монитор кадров не отдал замер (perf.summary)")
        XCTAssertGreaterThan(summary["frames"] ?? 0, 0, "кадры не считались — замер пустой")
    }
}
