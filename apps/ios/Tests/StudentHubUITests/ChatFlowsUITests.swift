import XCTest

/// Ключевые сценарии переписки на живом сервере: текст, ответ, реакция, меню, поиск,
/// лист вложений, панель emoji и замок записи голосового.
///
/// Нужны учётка с хотя бы одним чатом и сервер, на который собрано приложение:
/// `TEST_RUNNER_SH_UITEST_LOGIN=… TEST_RUNNER_SH_UITEST_PASSWORD=… xcodebuild test …`.
/// Без учётки сценарии пропускаются — в CI её нет. Учётка без 2FA (вход по паролю).
final class ChatFlowsUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        guard let login = environment["SH_UITEST_LOGIN"], let password = environment["SH_UITEST_PASSWORD"],
            !login.isEmpty, !password.isEmpty
        else {
            throw XCTSkip("Нет SH_UITEST_LOGIN / SH_UITEST_PASSWORD — сценарии на живом сервере пропущены")
        }
        app = XCUIApplication()
        app.launch()
        // Системные запросы (микрофон, уведомления) — разрешаем.
        addUIInterruptionMonitor(withDescription: "Системный запрос") { alert in
            for title in ["Разрешить", "Allow", "OK", "Разрешить при использовании"] where alert.buttons[title].exists {
                alert.buttons[title].tap()
                return true
            }
            return false
        }
        try signInIfNeeded(login: login, password: password)
        try openFirstChat()
    }

    // MARK: Сценарии

    func testSendTextMessage() throws {
        let text = "UI-тест \(UUID().uuidString.prefix(6))"
        send(text)
        XCTAssertTrue(app.staticTexts[text].waitForExistence(timeout: 10), "отправленное сообщение не появилось в ленте")
    }

    /// Долгое нажатие — меню с реакциями над пузырём; «Ответить» открывает полосу ответа.
    func testMenuReplyAndReaction() throws {
        let text = "Ответ-тест \(UUID().uuidString.prefix(6))"
        send(text)
        let bubble = app.staticTexts[text]
        XCTAssertTrue(bubble.waitForExistence(timeout: 10))

        bubble.press(forDuration: 0.6)
        let like = app.buttons["message.react.👍"]
        XCTAssertTrue(like.waitForExistence(timeout: 3), "нет панели реакций")
        XCTAssertTrue(app.buttons["message.menu.reply"].exists, "нет пункта «Ответить»")
        like.tap()
        XCTAssertTrue(app.buttons["👍"].waitForExistence(timeout: 10), "реакция не встала под сообщение")

        bubble.press(forDuration: 0.6)
        app.buttons["message.menu.reply"].tap()
        XCTAssertTrue(app.buttons[localized("Отменить")].waitForExistence(timeout: 3), "нет полосы ответа")
    }

    func testMenuCopyAndSelect() throws {
        let text = "Копия-тест \(UUID().uuidString.prefix(6))"
        send(text)
        let bubble = app.staticTexts[text]
        XCTAssertTrue(bubble.waitForExistence(timeout: 10))
        bubble.press(forDuration: 0.6)
        app.buttons["message.menu.copy"].tap()
        // Буфер из раннера не читаем: iOS спросила бы «Разрешить вставку». Достаточно
        // подтверждения, которое видит и человек.
        XCTAssertTrue(app.staticTexts["Текст скопирован"].waitForExistence(timeout: 3))

        bubble.press(forDuration: 0.6)
        app.buttons["message.menu.select"].tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "Выбрано")).firstMatch.waitForExistence(timeout: 3))
        app.buttons[localized("Отмена")].tap()
    }

    func testAttachmentSheetSections() throws {
        app.buttons["chat.attach"].tap()
        for title in ["Галерея", "Файл", "Геопозиция", "Список", "Звук", "Контакт"] {
            XCTAssertTrue(app.buttons[title].waitForExistence(timeout: 3), "нет раздела «\(title)»")
        }
        app.buttons["Файл"].tap()
        XCTAssertTrue(app.buttons["Выбрать в «Файлах»"].waitForExistence(timeout: 3))
    }

    func testExpressionPanelTabs() throws {
        app.buttons["chat.expressions"].tap()
        for title in ["Emoji", "Стикеры", "GIF"] {
            XCTAssertTrue(app.buttons[title].waitForExistence(timeout: 3), "нет вкладки «\(title)»")
        }
        app.buttons["Стикеры"].tap()
        app.buttons["chat.expressions"].tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 3), "клавиатура не вернулась")
    }

    /// Удержание микрофона и свайп вверх — запись закрепляется («Отмена» вместо подсказки
    /// «влево — отмена»); «Отмена» удаляет запись.
    func testVoiceLockAndCancel() throws {
        let mic = app.otherElements["chat.mic"].exists ? app.otherElements["chat.mic"] : app.buttons["chat.mic"]
        XCTAssertTrue(mic.waitForExistence(timeout: 3))
        let start = mic.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let up = start.withOffset(CGVector(dx: 0, dy: -160))
        start.press(forDuration: 0.6, thenDragTo: up)
        app.tap() // даёт сработать монитору системного запроса микрофона
        let cancel = app.buttons[localized("Отмена")]
        if cancel.waitForExistence(timeout: 3) {
            cancel.tap()
        } else {
            // Первый запуск: разрешение спрошено, запись начнётся со следующего удержания.
            start.press(forDuration: 0.6, thenDragTo: up)
            XCTAssertTrue(cancel.waitForExistence(timeout: 3), "запись не закрепилась свайпом вверх")
            cancel.tap()
        }
        XCTAssertTrue(app.textViews["chat.composer"].waitForExistence(timeout: 3) || app.textFields["chat.composer"].exists)
    }

    // MARK: Помощники

    private func signInIfNeeded(login: String, password: String) throws {
        let identifier = app.textFields["auth.identifier"]
        guard identifier.waitForExistence(timeout: 8) else { return }
        identifier.tap()
        identifier.typeText(login)
        let secret = app.secureTextFields["auth.password"].exists ? app.secureTextFields["auth.password"] : app.textFields["auth.password"]
        secret.tap()
        secret.typeText(password)
        app.buttons["auth.signIn"].tap()
    }

    private func openFirstChat() throws {
        let chats = app.tabBars.buttons[localized("Чаты")]
        XCTAssertTrue(chats.waitForExistence(timeout: 20), "нет вкладки «Чаты» — вход не удался?")
        chats.tap()
        let first = app.cells.firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 15), "у учётки нет ни одного чата")
        first.tap()
        XCTAssertTrue(composer.waitForExistence(timeout: 10), "переписка не открылась")
    }

    private var composer: XCUIElement {
        let view = app.textViews["chat.composer"]
        return view.exists ? view : app.textFields["chat.composer"]
    }

    private func send(_ text: String) {
        composer.tap()
        composer.typeText(text)
        app.buttons["chat.send"].tap()
    }

    private func localized(_ russian: String) -> String { russian }
}
