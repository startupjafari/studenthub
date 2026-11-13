import XCTest

/// Переписка на mock API: открытие, отправка, клавиатура, возврат назад кнопкой и
/// свайпом от края — в том числе отменённым.
final class ChatUITests: MockUITestCase {
    func testOpenChatShowsHistory() throws {
        openChat()
        // Последнее сообщение фикстур — внизу ленты, на экране.
        let last = app.descendants(matching: .any)["message.bubble.chat-1-m\(Self.firstChatMessages)"].firstMatch
        XCTAssertTrue(last.waitForExistence(timeout: timeout), "нет последнего сообщения истории")
        XCTAssertTrue(app.descendants(matching: .any)["chat.messages"].exists, "нет ленты сообщений")
        let tabBarTab = tab("Чаты")
        XCTAssertFalse(tabBarTab.exists && tabBarTab.isHittable, "панель вкладок видна поверх переписки")
    }

    func testSendMessageAppearsInThread() throws {
        openChat()
        let text = "UI-тест: проверка отправки"
        composer.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: timeout), "клавиатура не появилась")
        composer.typeText(text)
        let send = app.buttons["chat.send"]
        XCTAssertTrue(send.waitForExistence(timeout: timeout), "кнопка отправки не появилась")
        send.tap()

        XCTAssertTrue(app.staticTexts[text].waitForExistence(timeout: timeout), "сообщение не появилось в ленте")
        // Сервер подтвердил: строка получила серверный id (`chat-1-m41`).
        let confirmed = app.descendants(matching: .any)["message.bubble.chat-1-m\(Self.firstChatMessages + 1)"].firstMatch
        XCTAssertTrue(confirmed.waitForExistence(timeout: timeout), "сообщение не подтвердилось сервером")
        assertOnScreen(app.staticTexts[text], "отправленное сообщение")
        // Поле очистилось — кнопка отправки уступила место микрофону.
        XCTAssertTrue(waitForDisappearance(send), "поле ввода не очистилось после отправки")
    }

    func testKeyboardHidesWhenLeavingChat() throws {
        openChat()
        composer.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: timeout), "клавиатура не появилась")
        backButton.tap()
        XCTAssertTrue(waitForDisappearance(app.keyboards.firstMatch), "клавиатура осталась после выхода из чата")
        XCTAssertTrue(chatRow(Self.firstChatID).waitForExistence(timeout: timeout), "не вернулись к списку")
        XCTAssertTrue(waitForHittable(tab("Чаты")), "панель вкладок не вернулась")
    }

    /// Клавиатура поднимает поле ввода ровно над собой, а лента уезжает вместе с ним:
    /// последнее сообщение остаётся видно над полем.
    func testComposerRidesAboveKeyboard() throws {
        openChat()
        let last = app.descendants(matching: .any)["message.bubble.chat-1-m\(Self.firstChatMessages)"].firstMatch
        XCTAssertTrue(waitForHittable(last))
        composer.tap()
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: timeout), "клавиатура не появилась")
        XCTAssertTrue(waitForHittable(composer))
        settle()

        let keyboardTop = keyboard.frame.minY
        XCTAssertLessThanOrEqual(composer.frame.maxY, keyboardTop + 1, "поле ввода под клавиатурой")
        XCTAssertGreaterThan(composer.frame.maxY, keyboardTop - 80, "поле ввода оторвалось от клавиатуры")
        XCTAssertTrue(last.isHittable, "последнее сообщение спряталось за клавиатурой")
        XCTAssertLessThanOrEqual(last.frame.maxY, composer.frame.minY + 1, "последнее сообщение под полем ввода")
    }

    /// Ленту тянут вниз через клавиатуру — клавиатура уходит (интерактивное скрытие), поле
    /// ввода возвращается к низу экрана.
    func testDraggingMessagesDownHidesKeyboard() throws {
        openChat()
        composer.tap()
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: timeout), "клавиатура не появилась")
        let raised = composer.frame.minY

        let messages = app.descendants(matching: .any)["chat.messages"].firstMatch
        let start = messages.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
        let end = app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.98))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .default, thenHoldForDuration: 0)

        XCTAssertTrue(waitForDisappearance(keyboard), "клавиатура не ушла за пальцем")
        XCTAssertTrue(waitForHittable(composer))
        settle()
        XCTAssertGreaterThan(composer.frame.minY, raised + 100, "поле ввода не вернулось к низу")
        assertOnScreen(composer, "поле ввода после скрытия клавиатуры")
    }

    func testBackButtonReturnsToList() throws {
        openChat()
        backButton.tap()
        XCTAssertTrue(waitForDisappearance(chatTitle), "переписка не закрылась")
        let row = chatRow(Self.firstChatID)
        XCTAssertTrue(waitForHittable(row), "строка чата не на месте")
        assertOnScreen(row, "строка чата после возврата")
    }

    /// Свайп от края на четверть ширины и медленно — меньше порога: переход отменяется,
    /// переписка возвращается на место без скачка.
    func testCancelledEdgeSwipeStaysInChat() throws {
        openChat()
        XCTAssertTrue(waitForHittable(chatTitle))
        let before = chatTitle.frame
        let window = app.windows.firstMatch
        let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.5))
        let end = window.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.5))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.4)

        XCTAssertTrue(waitForHittable(chatTitle), "после отмены свайпа переписки нет")
        XCTAssertTrue(composer.exists, "поле ввода пропало после отмены свайпа")
        XCTAssertEqual(chatTitle.frame.minX, before.minX, accuracy: 2, "заголовок не вернулся на место")
        XCTAssertEqual(chatTitle.frame.minY, before.minY, accuracy: 2)
        XCTAssertFalse(app.navigationBars["Чаты"].exists, "список чатов виден после отменённого свайпа")
    }

    /// Свайп от края почти на всю ширину — переход завершается, список на месте.
    func testFullEdgeSwipeGoesBack() throws {
        openChat()
        let window = app.windows.firstMatch
        let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.5))
        let end = window.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .fast, thenHoldForDuration: 0)

        XCTAssertTrue(waitForDisappearance(chatTitle), "свайп назад не закрыл переписку")
        XCTAssertTrue(app.navigationBars["Чаты"].waitForExistence(timeout: timeout))
        let row = chatRow(Self.firstChatID)
        XCTAssertTrue(waitForHittable(row))
        assertOnScreen(row, "строка чата после свайпа назад")
    }

    /// Открыть — закрыть — открыть подряд: переход не залипает между повторами.
    func testReopenChatRepeatedly() throws {
        for _ in 0..<3 {
            openChat()
            backButton.tap()
            XCTAssertTrue(waitForDisappearance(chatTitle), "переписка не закрылась")
        }
        XCTAssertTrue(waitForHittable(chatRow(Self.firstChatID)))
    }
}
