import XCTest

/// Флаги второй волны (`PerformanceFlags.Switch`) — на настоящей ленте переписки, а не
/// на отдельном пузыре: своя раскладка с кешем высот (2.5), кеш замеров пузыря (2.6),
/// плоская тень (2.7) и короткое ожидание истории (2.9).
///
/// Вместо эталона — сравнение двух запусков в одном тесте: приложение с выключенными
/// флагами и с включёнными должно показать одну и ту же ленту — внизу, наверху и после
/// возврата вниз. Ошибка кеша высот видна именно так: строки наезжают друг на друга,
/// между ними дыры, или лента после прокрутки встаёт не туда.
final class PerformanceFlagUITests: MockUITestCase {
    private var messages: XCUIElement {
        app.descendants(matching: .any)["chat.messages"].firstMatch
    }

    private func bubble(_ position: Int, chat: String = MockUITestCase.firstChatID) -> XCUIElement {
        app.descendants(matching: .any)["message.bubble.\(chat)-m\(position)"].firstMatch
    }

    // MARK: - Одна и та же лента

    /// Каждый флаг — отдельно: расхождение сразу показывает, какой из них виноват.
    ///
    /// Кеш высот (2.5) пока не готов: строки у верха экрана остаются высотой оценки, между
    /// пузырями дыры (те же сообщения ниже встают верно). Флаг выключен по умолчанию, тест
    /// держит дефект на виду: ожидаемое падение строгое — когда раскладку починят, тест
    /// покраснеет и напомнит снять отметку и включить флаг.
    func testHeightCacheKeepsChatTheSame() throws {
        XCTExpectFailure("кеш высот (2.5): дыры между пузырями у верха ленты, флаг выключен")
        assertChatLooksTheSame(flag: "chatHeightCache")
    }

    func testBubbleLayoutCacheKeepsChatTheSame() throws {
        assertChatLooksTheSame(flag: "chatBubbleLayoutCache")
    }

    /// Плоская тень — приближение размытой: допуск по каналу тот же, что в
    /// `MessageBubbleSnapshotTests.testFlatShadowLooksLikeBlurredShadow`.
    func testFlatShadowKeepsChatTheSame() throws {
        assertChatLooksTheSame(
            flag: "chatBubbleFlatShadow",
            tolerance: SnapshotComparison.Tolerance(channel: 26, fraction: 0.002))
    }

    private func assertChatLooksTheSame(
        flag: String,
        tolerance: SnapshotComparison.Tolerance = .screen,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let off = captureChat(flags: "all=0", file: file, line: line)
        let on = captureChat(flags: "all=0,\(flag)=1", file: file, line: line)

        for (name, before, after) in [
            ("внизу", off.bottom, on.bottom),
            ("наверху", off.top, on.top),
            ("снова внизу", off.back, on.back),
        ] {
            if let mismatch = SnapshotComparison.compare(reference: before, actual: after, tolerance: tolerance) {
                attach(before, "\(flag): \(name) — выключен")
                attach(after, "\(flag): \(name) — включён")
                if let diff = mismatch.diff { attach(diff, "\(flag): \(name) — разница") }
                XCTFail("лента \(name) отличается с флагом \(flag): \(mismatch)", file: file, line: line)
            }
        }
    }

    private struct Captures {
        let bottom: UIImage
        let top: UIImage
        let back: UIImage
    }

    /// Открыть первый чат и снять ленту у свежего края, в начале истории и снова внизу.
    private func captureChat(flags: String, file: StaticString = #filePath, line: UInt = #line) -> Captures {
        relaunch(environment: ["SH_PERF_FLAGS": flags])
        openChat(file: file, line: line)
        let last = bubble(Self.firstChatMessages)
        XCTAssertTrue(waitForHittable(last), "нет последнего сообщения (\(flags))", file: file, line: line)
        let bottom = screen()

        let first = bubble(1)
        for _ in 0..<20 where !(first.exists && first.isHittable) {
            messages.swipeDown(velocity: .fast)
        }
        XCTAssertTrue(waitForHittable(first), "не долистали до начала истории (\(flags))", file: file, line: line)
        // Дотянуть до самого верха: первое сообщение могло показаться у нижнего края.
        messages.swipeDown(velocity: .fast)
        let top = screen()

        for _ in 0..<20 where !(last.exists && last.isHittable) {
            messages.swipeUp(velocity: .fast)
        }
        messages.swipeUp(velocity: .fast)
        XCTAssertTrue(waitForHittable(last), "не вернулись к свежему краю (\(flags))", file: file, line: line)
        assertOnScreen(last, "последнее сообщение после прокрутки (\(flags))", file: file, line: line)
        let back = screen()
        return Captures(bottom: bottom, top: top, back: back)
    }

    // MARK: - Медленная сеть: лента держится за низ

    /// Шаг 2.9: в базе только превью из списка чатов, страница истории идёт 1,5 с. Лента
    /// показывает превью через 0,6 с, а когда страница приезжает — сообщения встают над
    /// ним, и последнее остаётся на месте, без прыжка.
    func testThinHistoryArrivesWithoutJump() throws {
        relaunch(environment: ["SH_PERF_FLAGS": "chatThinHistoryShortWait=1", "SH_UITEST_HISTORY_DELAY_MS": "1500"])
        openChat()

        let last = bubble(Self.firstChatMessages)
        XCTAssertTrue(waitForHittable(last), "превью последнего сообщения не показалось")
        let before = last.frame

        let previous = bubble(Self.firstChatMessages - 1)
        XCTAssertTrue(previous.waitForExistence(timeout: timeout), "страница истории не приехала")
        settle()
        XCTAssertTrue(last.isHittable, "последнее сообщение ушло с экрана, когда приехала история")
        XCTAssertEqual(last.frame.maxY, before.maxY, accuracy: 2, "последнее сообщение прыгнуло")
        XCTAssertLessThan(previous.frame.maxY, last.frame.minY + 1, "история встала не над последним сообщением")
        assertOnScreen(composer, "поле ввода")
    }

    // MARK: - Помощники

    private func screen() -> UIImage {
        settle(1.0)
        return XCUIScreen.main.screenshot().image
    }

    private func attach(_ image: UIImage, _ name: String) {
        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
