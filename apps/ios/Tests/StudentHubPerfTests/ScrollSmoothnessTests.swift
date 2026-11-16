import XCTest

/// Плавность прокрутки переписки — числами монитора приложения (`ScrollJankMonitor`), а
/// не системной метрикой: `XCTOSSignpostMetric.scrollingAndDecelerationMetric` на
/// симуляторе отдаёт только длительность, без рывков.
///
/// Один прогон — несколько положений раскладки ленты подряд, на одной машине: числа
/// сравнимы между собой. Абсолютные значения — симулятор раннера, а не iPhone; сравнивать
/// варианты друг с другом и коммиты между собой, а не с порогом Apple.
///
/// Итог каждой прокрутки — строка `SCROLL_REPORT` в логе прогона и вложение теста
/// (`scripts/test.sh` выносит строки в сводку). Тест ничего не утверждает: это замер.
///
/// Без `SH_PERF=1` (его ставит `scripts/test.sh scroll` и `perf`) набор пропускается.
final class ScrollSmoothnessTests: XCTestCase {
    /// Положения раскладки: имя в отчёте и `SH_PERF_FLAGS` запускаемого приложения.
    private static let variants: [(name: String, flags: String)] = [
        ("build", ""),
        ("noEstimates", "chatEstimatedHeights=0"),
        ("heightCache", "chatHeightCache=1"),
    ]

    override func setUpWithError() throws {
        continueAfterFailure = false
        guard ProcessInfo.processInfo.environment["SH_PERF"] == "1" else {
            throw XCTSkip("Замеры — только в scripts/test.sh scroll/perf (SH_PERF=1)")
        }
    }

    /// Длинная переписка (2000 сообщений, ≈480 в дне): вверх через историю с догрузкой
    /// страниц и обратно к свежему краю.
    func testMessageHistoryScroll() {
        for variant in Self.variants {
            let app = launch(flags: variant.flags)
            let messages = openLongChat(in: app)

            for _ in 0..<8 { messages.swipeDown(velocity: .fast) }
            emit("\(variant.name) older", report(of: messages))

            for _ in 0..<4 { messages.swipeUp(velocity: .fast) }
            emit("\(variant.name) total", report(of: messages))

            app.terminate()
        }
    }

    // MARK: - Помощники

    private func launch(flags: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(ru)", "-AppleLocale", "ru_RU"]
        app.launchEnvironment["SH_UITEST_MOCK"] = "1"
        app.launchEnvironment["SH_UITEST_LARGE"] = "1"
        app.launchEnvironment["SH_UITEST_SCENARIO"] = "student"
        app.launchEnvironment["SH_PERF_FLAGS"] = flags
        app.launch()
        return app
    }

    private func openLongChat(in app: XCUIApplication) -> XCUIElement {
        let tab = TabBarButtons.button("Чаты", in: app)
        XCTAssertTrue(tab.waitForExistence(timeout: 20))
        tab.tap()
        let firstRow = app.cells.firstMatch
        XCTAssertTrue(firstRow.waitForExistence(timeout: 15))
        firstRow.tap()
        let messages = app.descendants(matching: .any)["chat.messages"].firstMatch
        XCTAssertTrue(messages.waitForExistence(timeout: 15))
        // Лента расставилась и затихла: первая прокрутка не должна мерить открытие.
        Thread.sleep(forTimeInterval: 1.5)
        return messages
    }

    /// Отчёт монитора, когда лента докатилась после последнего взмаха (`active=0`). Взмах
    /// по катящейся ленте — та же прокрутка, поэтому ждём покоя, а не числа прокруток.
    /// Не дождались — то, что есть.
    private func report(of messages: XCUIElement) -> String {
        let deadline = Date().addingTimeInterval(8)
        var value = ""
        while Date() < deadline {
            value = messages.value as? String ?? ""
            if value.hasPrefix("active=0") { break }
            Thread.sleep(forTimeInterval: 0.3)
        }
        return value
    }

    private func emit(_ name: String, _ report: String) {
        let line = "SCROLL_REPORT variant=\(name) \(report.isEmpty ? "нет отчёта" : report)"
        print(line)
        let attachment = XCTAttachment(string: line)
        attachment.name = "SCROLL_REPORT \(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
