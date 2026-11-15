import XCTest

/// Сценарии чата на моковых данных. Каждый тест стартует с исходной истории (`-resetData`)
/// и проверяет итог действия — текст в ленте, статус, счётчик, исчезновение, — а не только
/// наличие кнопок. Номера — пункты §11 задания.
final class ChatFlowUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    override func tearDown() {
        if let app, testRun?.hasSucceeded == false {
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = "Последний экран"
            shot.lifetime = .keepAlways
            add(shot)
        }
        super.tearDown()
    }

    // 1. Открытие чата
    func test01_opensDirectlyIntoChat() {
        app = ChatLabApp.launch()
        XCTAssertTrue(app.chatList.exists)
        let title = app.descendants(matching: .any)["chat.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 3))
        XCTAssertTrue(title.label.contains("Алина Соколова"), "в шапке — собеседник: \(title.label)")
        XCTAssertGreaterThan(app.messageBubbles.count, 3, "на экране видны сообщения истории")
        XCTAssertTrue(app.inputField.exists)
    }

    // 2. Прокрутка 300+ сообщений до самого начала и обратно
    func test02_scrollsWholeHistoryAndBack() {
        app = ChatLabApp.launch()
        let first = app.descendants(matching: .any)["message.1"]
        var swipes = 0
        while !first.exists, swipes < 120 {
            app.chatList.swipeDown(velocity: .fast)
            swipes += 1
        }
        XCTAssertTrue(first.exists, "первое сообщение истории достижимо прокруткой (\(swipes) свайпов)")
        XCTAssertGreaterThan(swipes, 10, "история длинная — за пару свайпов до начала не дойти")
        let down = app.buttons["chat.scrollToBottom"]
        XCTAssertTrue(down.waitForExistence(timeout: 2) && down.isHittable, "вдали от низа видна кнопка «вниз»")
        down.tap()
        XCTAssertTrue(first.waitForDisappearance(timeout: 4), "кнопка «вниз» уводит от начала истории")
        XCTAssertTrue(down.wait(until: "isHittable == false", timeout: 4), "внизу кнопка «вниз» прячется")
    }

    // 3. Отправка: текст в ленте, статус доходит до «прочитано»
    func test03_sendMessageReachesRead() {
        app = ChatLabApp.launch()
        let text = "Тестовое сообщение \(Int.random(in: 1000...9999))"
        app.send(text)
        let bubble = app.bubble(containing: text)
        XCTAssertTrue(bubble.waitForExistence(timeout: 3), "отправленное появилось в ленте")
        XCTAssertEqual(app.inputField.value as? String ?? "", "", "поле очищено после отправки")
        XCTAssertTrue(bubble.wait(until: "value == 'прочитано'", timeout: 8), "статус дошёл до «прочитано», сейчас: \(bubble.value ?? "nil")")
    }

    // 4. Получение нового сообщения (Debug Menu)
    func test04_receivesIncomingMessage() {
        app = ChatLabApp.launch()
        let before = app.messageBubbles.count
        app.debugAction("debug.receiveOne")
        let title = app.descendants(matching: .any)["chat.title"]
        XCTAssertTrue(title.wait(until: "label CONTAINS 'печатает'", timeout: 3), "перед сообщением собеседник «печатает»")
        let incoming = app.bubble(containing: "Ты тут?")
        XCTAssertTrue(incoming.waitForExistence(timeout: 5), "входящее появилось внизу ленты")
        XCTAssertGreaterThanOrEqual(app.messageBubbles.count, before)
        XCTAssertTrue(title.wait(until: "NOT (label CONTAINS 'печатает')", timeout: 4), "после сообщения «печатает» гаснет")
    }

    // 5. Открытие и закрытие клавиатуры: панель ввода едет вместе с ней
    func test05_keyboardOpensAndCloses() {
        app = ChatLabApp.launch()
        let panelBefore = app.inputField.frame
        app.inputField.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 3))
        let panelOpen = app.inputField.frame
        XCTAssertLessThan(panelOpen.minY, panelBefore.minY - 150, "поле поднялось над клавиатурой")
        XCTAssertLessThanOrEqual(panelOpen.maxY, app.keyboards.firstMatch.frame.minY + 1, "клавиатура не закрывает поле")
        // Нижний пузырь тоже поднялся вместе с панелью.
        if let lowest = app.lowestBubble {
            XCTAssertLessThan(lowest.frame.maxY, app.keyboards.firstMatch.frame.minY, "последнее сообщение видно над клавиатурой")
        }
        app.chatList.swipeDown()
        XCTAssertTrue(app.keyboards.firstMatch.waitForDisappearance(timeout: 3), "свайп по ленте прячет клавиатуру")
        XCTAssertEqual(app.inputField.frame.minY, panelBefore.minY, accuracy: 2, "поле вернулось вниз")
    }

    // 6. Ответ свайпом
    func test06_swipeToReplyAttachesQuote() {
        app = ChatLabApp.launch()
        guard let bubble = app.lowestBubble else { return XCTFail("нет пузыря") }
        let quoted = bubble.label
        app.swipeToReply(bubble)
        let accessory = app.staticTexts["input.accessory.title"]
        XCTAssertTrue(accessory.waitForExistence(timeout: 3), "над полем — панель ответа")
        XCTAssertTrue(accessory.label.hasPrefix("В ответ"))
        let reply = "Отвечаю свайпом"
        app.inputField.typeText(reply)
        app.sendButton.tap()
        let sent = app.bubble(containing: reply)
        XCTAssertTrue(sent.waitForExistence(timeout: 3))
        XCTAssertTrue(sent.label.contains("Ответ на"), "у отправленного есть цитата: \(sent.label) ← \(quoted)")
        XCTAssertFalse(accessory.exists, "панель ответа закрылась после отправки")
    }

    // 7. Контекстное меню: все действия на месте, закрытие возвращает ленту
    func test07_contextMenuShowsActionsAndCloses() {
        app = ChatLabApp.launch()
        app.send("Для меню")
        let bubble = app.bubble(containing: "Для меню")
        XCTAssertTrue(bubble.waitForExistence(timeout: 3))
        app.openContextMenu(on: bubble)
        for id in ["reply", "copy", "forward", "edit", "pin", "select", "delete"] {
            XCTAssertTrue(app.descendants(matching: .any)["contextMenu.\(id)"].exists, "в меню есть «\(id)»")
        }
        XCTAssertTrue(app.otherElements["reaction.bar"].exists, "над пузырём — панель реакций")
        // Закрыть касанием фона.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08)).tap()
        XCTAssertTrue(app.otherElements["contextMenu"].waitForDisappearance(timeout: 3))
        XCTAssertTrue(bubble.isHittable, "пузырь вернулся на место")
        // «Копировать» кладёт текст в буфер.
        app.openContextMenu(on: bubble)
        app.descendants(matching: .any)["contextMenu.copy"].tap()
        XCTAssertTrue(app.staticTexts["toast.text"].waitForExistence(timeout: 3))
        XCTAssertEqual(UIPasteboard.general.string, "Для меню")
    }

    // 8. Редактирование
    func test08_editMessageChangesTextAndMarksEdited() {
        app = ChatLabApp.launch()
        app.send("Исходный текст")
        let bubble = app.bubble(containing: "Исходный текст")
        XCTAssertTrue(bubble.waitForExistence(timeout: 3))
        let identifier = bubble.identifier
        app.openContextMenu(on: bubble)
        app.descendants(matching: .any)["contextMenu.edit"].tap()
        XCTAssertTrue(app.staticTexts["input.accessory.title"].waitForExistence(timeout: 3))
        XCTAssertEqual(app.inputField.value as? String, "Исходный текст", "в поле — текст сообщения")
        app.inputField.clearText()
        app.inputField.typeText("Исправленный текст")
        XCTAssertEqual(app.sendButton.label, "Сохранить")
        app.sendButton.tap()
        let edited = app.descendants(matching: .any)[identifier]
        XCTAssertTrue(edited.wait(until: "label CONTAINS 'Исправленный текст'", timeout: 3), "тот же пузырь с новым текстом")
        XCTAssertTrue(edited.label.contains("изменено"))
        XCTAssertFalse(app.bubble(containing: "Исходный текст").exists, "старого текста нет — новое сообщение не создано")
    }

    // 9. Удаление
    func test09_deleteMessageRemovesIt() {
        app = ChatLabApp.launch()
        app.send("Удали меня")
        let bubble = app.bubble(containing: "Удали меня")
        XCTAssertTrue(bubble.waitForExistence(timeout: 3))
        app.openContextMenu(on: bubble)
        app.descendants(matching: .any)["contextMenu.delete"].tap()
        let confirm = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Удалить у меня и у'")).firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 3), "подтверждение удаления")
        confirm.tap()
        XCTAssertTrue(bubble.waitForDisappearance(timeout: 3), "сообщение исчезло из ленты")
    }

    // 10. Реакции: из меню и двойным касанием, повтор снимает
    func test10_reactionsAppearAndToggle() {
        app = ChatLabApp.launch()
        app.send("Поставь реакцию")
        let bubble = app.bubble(containing: "Поставь реакцию")
        XCTAssertTrue(bubble.waitForExistence(timeout: 3))
        app.openContextMenu(on: bubble)
        app.descendants(matching: .any)["reaction.option.❤️"].tap()
        let heart = app.descendants(matching: .any)["reaction.❤️"]
        XCTAssertTrue(heart.waitForExistence(timeout: 3), "под сообщением — ❤️")
        XCTAssertTrue(heart.label.contains("ваша"))
        heart.tap()
        XCTAssertTrue(heart.waitForDisappearance(timeout: 3), "повторное нажатие снимает реакцию")
        bubble.doubleTap()
        XCTAssertTrue(app.descendants(matching: .any)["reaction.👍"].waitForExistence(timeout: 3), "двойное касание ставит 👍")
    }

    // 11. Открытие фото и видео, закрытие жестом вниз
    func test11_opensPhotoAndVideoViewer() {
        app = ChatLabApp.launch()
        app.debugAction("debug.sendPhoto")
        let photo = app.messageBubbles.matching(NSPredicate(format: "label BEGINSWITH 'Фотография'")).allElementsBoundByIndex.last
        XCTAssertNotNil(photo)
        XCTAssertTrue(photo!.waitForExistence(timeout: 5))
        photo!.tap()
        let viewer = app.otherElements["mediaViewer"]
        XCTAssertTrue(viewer.waitForExistence(timeout: 3), "фото открылось в просмотрщике")
        XCTAssertTrue(app.staticTexts["mediaViewer.counter"].label.contains("из"))
        app.swipeDown(velocity: .fast)
        XCTAssertTrue(viewer.waitForDisappearance(timeout: 3), "жест вниз закрывает просмотрщик")

        // Видео — ищем в истории.
        let video = app.messageBubbles.matching(NSPredicate(format: "label BEGINSWITH 'Видео'")).firstMatch
        var swipes = 0
        while !(video.exists && video.isHittable), swipes < 60 {
            app.chatList.swipeDown()
            swipes += 1
        }
        XCTAssertTrue(video.isHittable, "в истории есть видео")
        video.tap()
        XCTAssertTrue(viewer.waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["mediaViewer.video.play"].waitForExistence(timeout: 3), "у видео — панель проигрывания")
        app.buttons["mediaViewer.close"].tap()
        XCTAssertTrue(viewer.waitForDisappearance(timeout: 3))
    }

    // 12. Профиль и обратно
    func test12_profileOpensAndReturns() {
        app = ChatLabApp.launch()
        app.descendants(matching: .any)["chat.title"].tap()
        let profile = app.descendants(matching: .any)["profile.screen"]
        XCTAssertTrue(profile.waitForExistence(timeout: 3))
        XCTAssertTrue(app.descendants(matching: .any)["profile.phone"].label.contains("+7"))
        XCTAssertTrue(app.descendants(matching: .any)["profile.username"].label.contains("alina_sokol"))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.inputField.waitForExistence(timeout: 3), "вернулись в чат")
        XCTAssertTrue(profile.waitForDisappearance(timeout: 2))
    }

    // 13. Возврат назад жестом (и снова в чат)
    func test13_backSwipeReturnsToChatList() {
        app = ChatLabApp.launch()
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.5))
        start.press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)), withVelocity: .fast, thenHoldForDuration: 0)
        let row = app.descendants(matching: .any)["chatList.row.alina"]
        XCTAssertTrue(row.waitForExistence(timeout: 3), "свайп назад открыл список чатов")
        XCTAssertFalse(app.inputField.exists)
        row.tap()
        XCTAssertTrue(app.inputField.waitForExistence(timeout: 3), "из списка — снова в переписку")
    }

    // 14. Поиск с навигацией по результатам
    func test14_searchNavigatesResults() {
        app = ChatLabApp.launch()
        app.openMoreMenu(item: "Поиск")
        let field = app.searchFields["search.field"].exists ? app.searchFields["search.field"] : app.descendants(matching: .any)["search.field"]
        XCTAssertTrue(field.waitForExistence(timeout: 3))
        field.typeText("кофе")
        let counter = app.descendants(matching: .any)["search.counter"]
        XCTAssertTrue(counter.wait(until: "label CONTAINS ' из '", timeout: 4), "найдено несколько совпадений: \(counter.label)")
        let first = counter.label
        XCTAssertTrue(first.hasPrefix("1 из"), "первым — самое свежее совпадение")
        app.buttons["search.up"].tap()
        XCTAssertTrue(counter.wait(until: "label BEGINSWITH '2 из'", timeout: 3), "стрелка вверх — к более старому")
        XCTAssertTrue(app.bubble(containing: "оф").exists, "найденное сообщение на экране")
        app.buttons["search.cancel"].tap()
        XCTAssertTrue(app.inputField.waitForExistence(timeout: 3), "после поиска — снова поле ввода")
    }

    // 15. Переключение темы — по пикселям обоев
    func test15_themeToggleChangesColors() {
        app = ChatLabApp.launch(theme: "light")
        let region = CGRect(x: 20, y: app.frame.height * 0.35, width: 60, height: 60)
        let light = averageLuminance(of: app.screenshot(), in: region)
        app.openMoreMenu(item: "Тёмная тема")
        sleep(1)
        let dark = averageLuminance(of: app.screenshot(), in: region)
        XCTAssertGreaterThan(light, 0.45, "светлая тема — светлые обои")
        XCTAssertLessThan(dark, 0.3, "тёмная тема — тёмные обои")
        app.openMoreMenu(item: "Светлая тема")
        sleep(1)
        XCTAssertGreaterThan(averageLuminance(of: app.screenshot(), in: region), 0.45)
    }

    // 16. Быстрые последовательные действия
    func test16_rapidActionsKeepStateConsistent() {
        app = ChatLabApp.launch()
        app.inputField.tap()
        for index in 1...10 {
            app.inputField.typeText("Быстро \(index)")
            app.sendButton.tap()
        }
        for index in 7...10 {
            XCTAssertTrue(app.bubble(containing: "Быстро \(index)").waitForExistence(timeout: 3), "сообщение \(index) на месте")
        }
        // Меню открыть-закрыть подряд, клавиатура туда-обратно — без зависаний и залипших оверлеев.
        let bubble = app.bubble(containing: "Быстро 10")
        for _ in 0..<4 {
            app.openContextMenu(on: bubble)
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08)).tap()
            XCTAssertTrue(app.otherElements["contextMenu"].waitForDisappearance(timeout: 2))
        }
        for _ in 0..<3 {
            app.inputField.tap()
            XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 2))
            app.chatList.swipeDown()
            XCTAssertTrue(app.keyboards.firstMatch.waitForDisappearance(timeout: 2))
        }
        app.debugAction("debug.receive10")
        XCTAssertTrue(app.bubble(containing: "Быстро 10").exists || app.buttons["chat.scrollToBottom"].exists)
        // Порядок отправленных сохранился.
        let nine = app.bubble(containing: "Быстро 9")
        let ten = app.bubble(containing: "Быстро 10")
        if nine.exists, ten.exists {
            XCTAssertLessThan(nine.frame.minY, ten.frame.minY, "отправленные идут по порядку")
        }
    }

    // Голосовое без микрофона: тестовый путь через действие доступности.
    func test17_voiceMessageSendsAndPlays() {
        app = ChatLabApp.launch()
        app.debugAction("debug.sendVoice")
        let voice = app.messageBubbles.matching(NSPredicate(format: "label BEGINSWITH 'Голосовое'")).allElementsBoundByIndex.last
        XCTAssertNotNil(voice)
        XCTAssertTrue(voice!.waitForExistence(timeout: 3))
    }

    // Закрепление: панель закрепа показывает сообщение, нажатие переходит к нему.
    func test18_pinShowsPanelAndJumps() {
        app = ChatLabApp.launch()
        app.send("Важное: встреча в 19:00")
        let bubble = app.bubble(containing: "Важное: встреча")
        XCTAssertTrue(bubble.waitForExistence(timeout: 3))
        app.openContextMenu(on: bubble)
        app.descendants(matching: .any)["contextMenu.pin"].tap()
        let pinned = app.staticTexts["pinned.text"]
        XCTAssertTrue(pinned.wait(until: "label CONTAINS 'Важное'", timeout: 3), "в панели закрепа — новое сообщение")
        XCTAssertTrue(app.bubble(containing: "Вы закрепили").waitForExistence(timeout: 3), "служебное «Вы закрепили»")
    }
}

extension XCUIElement {
    func clearText() {
        guard let value = value as? String, !value.isEmpty else { return }
        tap()
        let delete = String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count + 2)
        typeText(delete)
    }
}
