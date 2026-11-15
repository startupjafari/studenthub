import XCTest

/// Взаимодействия в переписке по записи Telegram (ТЗ 15.11, ЧАСТЬ 29): меню и реакции,
/// выбор, пересылка, закрепление, удаление, сохранение фото, лист вложений, поиск.
///
/// Всё — на mock API (`MockServer`): реакции, закрепы, пересылка, скрытие и поиск держат
/// состояние в процессе приложения, как настоящий сервер. Чего здесь нет: настоящей
/// камеры и геопозиции (подмена `SH_UITEST_LOCATION`), системного выбора файлов.
final class ChatInteractionsUITests: MockUITestCase {
    // MARK: - Помощники

    private func any(_ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    private func bubble(_ id: String) -> XCUIElement {
        any("message.bubble.\(id)")
    }

    private func button(_ id: String) -> XCUIElement {
        app.buttons[id].firstMatch
    }

    private var list: XCUIElement { any("chat.messages") }

    /// Сообщение в режиме выбора: пузырь целиком — кнопка-отметка.
    private func mark(_ id: String) -> XCUIElement {
        any("message.select.\(id)")
    }

    /// Долгое нажатие — меню поверх переписки.
    private func openMenu(_ id: String, file: StaticString = #filePath, line: UInt = #line) {
        let target = bubble(id)
        XCTAssertTrue(target.waitForExistence(timeout: timeout), "нет сообщения \(id)", file: file, line: line)
        // `message.bubble.*` — вся строка во ширину ленты, а меню ловит только касание по
        // самому пузырю (`menuItem(at:)`): у короткого сообщения центр строки — пустое
        // место сбоку. Жмём по тексту внутри пузыря (у снимка — время на нём).
        let content = target.staticTexts.firstMatch
        (content.exists ? content : target).press(forDuration: 0.7)
        // Показания зонда ленты (`UITestProbe`): начался ли жест, отказал ли показ.
        XCTAssertTrue(
            any("message.menu.select").waitForExistence(timeout: timeout),
            "меню не открылось; зонд: \(list.value as? String ?? "—")", file: file, line: line)
    }

    private func menuAction(_ id: String) -> XCUIElement { any("message.menu.\(id)") }

    /// В пузыре есть текст с подстрокой — подпись контейнера в XCUITest бывает пустой.
    private func bubble(_ id: String, contains text: String) -> Bool {
        bubble(id).descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
            .waitForExistence(timeout: timeout)
    }

    private func waitForLabel(_ element: XCUIElement, containing text: String, timeout: TimeInterval? = nil) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", text), object: element)
        return XCTWaiter().wait(for: [expectation], timeout: timeout ?? self.timeout) == .completed
    }

    private func waitForValue(_ element: XCUIElement, _ value: String) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: element)
        return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
    }

    private func staticText(containing text: String) -> XCUIElement {
        app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    /// Системный запрос (доступ к «Фото») — нажать «Разрешить», если он показан.
    private func allowSystemAlert() {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let titles = ["Разрешить", "Allow", "Разрешить доступ ко всем фото", "Allow Full Access", "OK"]
        let alert = springboard.alerts.firstMatch
        guard alert.waitForExistence(timeout: 3) else { return }
        for title in titles where alert.buttons[title].exists {
            alert.buttons[title].tap()
            return
        }
    }

    private func openAttachSheet(section: String? = nil) {
        let attach = any("chat.attach")
        XCTAssertTrue(attach.waitForExistence(timeout: timeout))
        attach.tap()
        if let section {
            let tab = any("chat.attach.section.\(section)")
            XCTAssertTrue(tab.waitForExistence(timeout: timeout), "нет раздела \(section)")
            tab.tap()
        }
    }

    // MARK: - 1. Контекстное меню

    func testLongPressShowsReactionsAndMenuAndClosesOnOutsideTap() throws {
        openChat()
        openMenu("chat-1-m40")
        for emoji in ["👌", "🙏", "👍", "😂", "😁", "❤️", "👎"] {
            XCTAssertTrue(any("message.react.\(emoji)").exists, "нет реакции \(emoji)")
        }
        XCTAssertTrue(app.buttons["Другие реакции"].exists, "нет стрелки расширенных реакций")
        for action in ["reply", "copy", "pin", "forward", "delete", "select"] {
            XCTAssertTrue(menuAction(action).exists, "нет пункта \(action)")
        }
        XCTAssertFalse(menuAction("saveMedia").exists, "«Сохранить фото» у текста")
        // Нажатие мимо меню — закрыть.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08)).tap()
        XCTAssertTrue(waitForDisappearance(menuAction("select")), "меню не закрылось")
        XCTAssertTrue(bubble("chat-1-m40").waitForExistence(timeout: timeout), "сообщение не вернулось на место")
    }

    // MARK: - 2. Реакции

    func testReactionAddsShowsAndRemoves() throws {
        openChat()
        openMenu("chat-1-m40")
        any("message.react.👍").tap()
        let reaction = bubble("chat-1-m40").descendants(matching: .any)["message.reaction.👍"].firstMatch
        XCTAssertTrue(reaction.waitForExistence(timeout: timeout), "реакция не появилась под сообщением")
        XCTAssertEqual(reaction.value as? String, "1")

        // Повторно: моя реакция отмечена, повторное нажатие снимает её.
        openMenu("chat-1-m40")
        XCTAssertTrue(any("message.react.👍").isSelected, "своя реакция не отмечена в меню")
        any("message.react.👍").tap()
        XCTAssertTrue(waitForDisappearance(reaction), "реакция не снялась")

        // Другая реакция — заменяет, а не добавляется второй.
        openMenu("chat-1-m40")
        any("message.react.❤️").tap()
        let heart = bubble("chat-1-m40").descendants(matching: .any)["message.reaction.❤️"].firstMatch
        XCTAssertTrue(heart.waitForExistence(timeout: timeout))
        openMenu("chat-1-m40")
        any("message.react.👌").tap()
        XCTAssertTrue(waitForDisappearance(heart), "прежняя реакция не заменилась")
        XCTAssertTrue(bubble("chat-1-m40").descendants(matching: .any)["message.reaction.👌"].firstMatch.waitForExistence(timeout: timeout))
    }

    // MARK: - 3. Множественный выбор

    func testSelectionCountsPersistsAcrossScrollAndCancels() throws {
        openChat()
        openMenu("chat-1-m40")
        menuAction("select").tap()
        let title = any("chat.selection.title")
        XCTAssertTrue(waitForLabel(title, containing: "1"), "исходное сообщение не выбрано")
        for id in ["chat-1-m39", "chat-1-m38", "chat-1-m37"] { mark(id).tap() }
        XCTAssertTrue(waitForLabel(title, containing: "4"), "счётчик не 4: \(title.label)")
        mark("chat-1-m38").tap()
        XCTAssertTrue(waitForLabel(title, containing: "3"), "снятие не уменьшило счётчик")

        list.swipeDown()
        list.swipeDown()
        list.swipeUp()
        list.swipeUp()
        XCTAssertTrue(waitForLabel(title, containing: "3"), "выбор потерялся после прокрутки")
        XCTAssertEqual(mark("chat-1-m39").value as? String, "Выбрано")
        XCTAssertEqual(mark("chat-1-m38").value as? String, "Не выбрано")

        // Массовые действия: у чужих сообщений «Удалить» доступно (у меня), «Переслать» — да.
        XCTAssertTrue(any("chat.selection.arrowshape.turn.up.right").isEnabled)

        any("chat.selection.cancel").tap()
        XCTAssertTrue(waitForDisappearance(title), "режим выбора не закрылся")
        XCTAssertTrue(composer.waitForExistence(timeout: timeout), "поле ввода не вернулось")
    }

    // MARK: - 4. Пересылка десяти сообщений

    func testForwardTenMessagesToTwoChatsWithHiddenNamesAndComment() throws {
        openChat()
        openMenu("chat-1-m40")
        menuAction("select").tap()
        for seq in stride(from: 39, through: 31, by: -1) {
            let target = mark("chat-1-m\(seq)")
            if !target.isHittable { list.swipeDown() }
            XCTAssertTrue(waitForHittable(target), "не видно chat-1-m\(seq)")
            target.tap()
        }
        XCTAssertTrue(waitForLabel(any("chat.selection.title"), containing: "10"), "выбрано не 10")
        any("chat.selection.arrowshape.turn.up.right").tap()

        let sheet = any("chat.forward")
        XCTAssertTrue(sheet.waitForExistence(timeout: timeout), "экран пересылки не открылся")
        XCTAssertTrue(waitForLabel(any("chat.forward.title"), containing: "Переслать"))
        any("chat.forward.row.chat-2").tap()
        any("chat.forward.row.chat-3").tap()
        XCTAssertTrue(staticText(containing: "Переслать 10 сообщений").waitForExistence(timeout: timeout))

        any("chat.forward.options").tap()
        XCTAssertTrue(any("chat.forward.preview").waitForExistence(timeout: timeout), "нет предпросмотра")
        XCTAssertTrue(staticText(containing: "Переслано от").exists, "имена по умолчанию видны")
        any("chat.forward.names.hide").tap()
        XCTAssertTrue(waitForDisappearance(staticText(containing: "Переслано от")), "предпросмотр не обновился")
        any("chat.forward.options.done").tap()
        XCTAssertTrue(staticText(containing: "Имена отправителей скрыты").waitForExistence(timeout: timeout))
        // Получатели после параметров на месте.
        XCTAssertTrue(any("chat.forward.row.chat-2").isSelected)

        let comment = app.textViews["chat.forward.comment"]
        comment.tap()
        comment.typeText("Смотри")
        any("chat.forward.emoji").tap()
        let emoji = app.buttons["😀"].firstMatch
        XCTAssertTrue(emoji.waitForExistence(timeout: timeout), "панель эмодзи не открылась")
        emoji.tap()
        any("chat.forward.emoji").tap()
        XCTAssertEqual(comment.value as? String, "Смотри😀", "эмодзи не в конце комментария")

        any("chat.forward.send").tap()
        XCTAssertTrue(waitForDisappearance(sheet), "лист пересылки не закрылся")
        XCTAssertTrue(staticText(containing: "Переслано в 2").waitForExistence(timeout: timeout), "нет итога пересылки")

        // У получателя: комментарий, затем десять пересланных по времени, без «Переслано от».
        backButton.tap()
        openChat("chat-3")
        XCTAssertTrue(bubble("chat-3-m13", contains: "Смотри"), "нет комментария")
        XCTAssertTrue(bubble("chat-3-m14", contains: "Хорошо, договорились"), "первым ушло не самое старое")
        XCTAssertTrue(bubble("chat-3-m23", contains: "Привет! Ты сегодня на паре"), "последним — не самое новое")
        XCTAssertFalse(bubble("chat-3-m24").exists, "лишнее сообщение — дубль пересылки")
        XCTAssertFalse(staticText(containing: "Переслано от").exists, "имя отправителя не скрыто")
    }

    // MARK: - 5. Закрепление

    func testPinShowsBarJumpsAndUnpinAllWithUndo() throws {
        openChat()
        openMenu("chat-1-m40")
        menuAction("pin").tap()
        let bar = any("chat.pinned.bar")
        XCTAssertTrue(bar.waitForExistence(timeout: timeout), "плашка закреплённого не появилась")
        bar.tap()
        XCTAssertTrue(bubble("chat-1-m40").waitForExistence(timeout: timeout))

        openMenu("chat-1-m39")
        menuAction("pin").tap()
        XCTAssertTrue(waitForLabel(bar, containing: "из 2"), "второе закрепление не видно: \(bar.label)")

        bar.press(forDuration: 1.0)
        let unpinAll = app.buttons["Открепить все сообщения"].firstMatch
        XCTAssertTrue(unpinAll.waitForExistence(timeout: timeout), "нет меню закреплений")
        XCTAssertTrue(app.buttons["Показать все сообщения"].exists)
        unpinAll.tap()
        let confirm = app.buttons["Открепить все сообщения"].firstMatch
        if confirm.waitForExistence(timeout: 3) { confirm.tap() }
        XCTAssertTrue(waitForDisappearance(bar), "плашка не исчезла после открепления")

        let undo = any("chat.toast.action")
        XCTAssertTrue(undo.waitForExistence(timeout: timeout), "нет «Отменить»")
        undo.tap()
        XCTAssertTrue(bar.waitForExistence(timeout: timeout), "отмена не вернула закрепления")
    }

    // MARK: - 6. Удаление

    func testDeleteForMeAndForEveryone() throws {
        openChat()
        // Чужое сообщение: только «у меня».
        openMenu("chat-1-m38")
        menuAction("delete").tap()
        XCTAssertTrue(app.buttons["Удалить у меня"].firstMatch.waitForExistence(timeout: timeout))
        XCTAssertFalse(app.buttons["Удалить у всех"].firstMatch.exists, "«у всех» для чужого")
        app.buttons["Удалить у меня"].firstMatch.tap()
        XCTAssertTrue(waitForDisappearance(bubble("chat-1-m38")), "сообщение не скрылось у меня")
        XCTAssertTrue(bubble("chat-1-m37").exists, "соседнее сообщение пропало")

        // Своё — можно у всех: остаётся «Сообщение удалено».
        openMenu("chat-1-m39")
        menuAction("delete").tap()
        XCTAssertTrue(app.buttons["Удалить у всех"].firstMatch.waitForExistence(timeout: timeout), "нет «у всех» для своего")
        app.buttons["Удалить у всех"].firstMatch.tap()
        XCTAssertTrue(bubble("chat-1-m39", contains: "удален"), "своё не удалилось у всех")
    }

    // MARK: - 7. Сохранить фото

    func testSavePhotoFromMenuShowsResultAndMenuReopens() throws {
        openChat("chat-3")
        let photo = "chat-3-m8"
        openMenu(photo)
        let save = menuAction("saveMedia")
        XCTAssertTrue(save.exists, "нет «Сохранить фото» у снимка")
        XCTAssertFalse(menuAction("copy").exists, "«Скопировать» у снимка без подписи")
        save.tap()
        allowSystemAlert()
        let success = staticText(containing: "Фото сохранено")
        let failure = app.alerts["Не получилось"]
        let outcome = XCTWaiter().wait(for: [
            XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true"), object: success),
        ], timeout: timeout)
        if outcome != .completed {
            // Нет доступа в среде прогона — ошибка видна человеку, а не проглочена.
            XCTAssertTrue(failure.exists, "ни успеха, ни ошибки после «Сохранить фото»")
            failure.buttons.firstMatch.tap()
        }
        // Меню открывается снова, без зависшего состояния.
        openMenu(photo)
        XCTAssertTrue(menuAction("saveMedia").exists)
    }

    // MARK: - 8. Четыре фотографии

    func testFourPhotosNumberedHiddenUngroupedWithCaption() throws {
        openChat()
        openAttachSheet()
        allowSystemAlert()
        let assets = app.descendants(matching: .any).matching(identifier: "chat.attach.asset")
        _ = assets.firstMatch.waitForExistence(timeout: timeout)
        guard assets.count >= 4 else { throw XCTSkip("в «Фото» симулятора меньше четырёх снимков") }
        for index in 0..<4 { assets.element(boundBy: index).tap() }
        for index in 0..<4 {
            XCTAssertEqual(assets.element(boundBy: index).value as? String, "\(index + 1)", "номер выбора \(index)")
        }
        // Снять второй — номера пересчитываются по порядку выбора.
        assets.element(boundBy: 1).tap()
        XCTAssertTrue(waitForValue(assets.element(boundBy: 2), "2"))
        XCTAssertTrue(waitForValue(assets.element(boundBy: 3), "3"))
        assets.element(boundBy: 1).tap()
        XCTAssertTrue(waitForValue(assets.element(boundBy: 1), "4"), "вернувшийся встаёт последним")

        any("chat.attach.options").tap()
        app.buttons["Скрыть под спойлер"].tap()
        XCTAssertTrue(waitForValue(assets.element(boundBy: 0), "1 hidden"), "миниатюры не скрыты")
        any("chat.attach.options").tap()
        app.buttons["Отменить скрытие"].tap()
        XCTAssertTrue(waitForValue(assets.element(boundBy: 0), "1"), "скрытие не отменилось")

        let caption = any("chat.attach.caption")
        caption.tap()
        caption.typeText("Подпись к фото")
        XCTAssertEqual(assets.element(boundBy: 0).value as? String, "1", "ввод подписи сбросил выбор")

        any("chat.attach.options").tap()
        app.buttons["Отправить без группировки"].tap()
        // Четыре отдельных сообщения, по порядку выбора.
        XCTAssertTrue(bubble("chat-1-m44").waitForExistence(timeout: 30), "ушло не четыре сообщения")
        XCTAssertFalse(bubble("chat-1-m45").exists)
    }

    // MARK: - 9. Файлы

    func testFileTabActionsAndRecentFileGoesToSendQueue() throws {
        openChat()
        openAttachSheet(section: "file")
        XCTAssertTrue(any("chat.attach.option.photo").waitForExistence(timeout: timeout), "нет «Выбрать из Галереи»")
        XCTAssertTrue(any("chat.attach.option.folder").exists, "нет «Выбрать в «Файлах»»")
        // Сканер — только где есть камера (на симуляторе его нет).
        let recent = any("chat.attach.recent.row.file-doc-2")
        XCTAssertTrue(recent.waitForExistence(timeout: timeout), "нет «Недавно отправленных»")
        XCTAssertTrue(staticText(containing: "Отчёт по практике.pdf").exists)
        // Поиск по недавним.
        let search = app.textFields.matching(NSPredicate(format: "placeholderValue == %@", "Поиск файлов")).firstMatch
        if search.waitForExistence(timeout: 3) {
            search.tap()
            search.typeText("архив")
            XCTAssertTrue(waitForDisappearance(recent), "поиск не отфильтровал")
            XCTAssertTrue(any("chat.attach.recent.row.file-doc-3").waitForExistence(timeout: timeout))
            search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 5))
        }
        XCTAssertTrue(any("chat.attach.recent.row.file-doc-2").waitForExistence(timeout: timeout))
        any("chat.attach.recent.row.file-doc-2").tap()
        let send = any("chat.attachSend.send")
        XCTAssertTrue(send.waitForExistence(timeout: timeout), "файл не попал в лист отправки")
        XCTAssertTrue(staticText(containing: "Отчёт по практике").exists, "в листе отправки нет имени файла")
        send.tap()
        XCTAssertTrue(bubble("chat-1-m41").waitForExistence(timeout: timeout), "файл не ушёл")
    }

    // MARK: - 10. Геопозиция

    func testLocationDeniedScreenThenFixedLocation() throws {
        relaunch(environment: ["SH_UITEST_LOCATION": "denied"])
        openChat()
        openAttachSheet(section: "location")
        XCTAssertTrue(staticText(containing: "Доступ к геопозиции").waitForExistence(timeout: timeout), "нет экрана отказа")
        XCTAssertTrue(any("chat.location.settings").exists, "нет «В настройки»")
        XCTAssertTrue(any("chat.location.sendDisabled").exists, "нет неактивной отправки")

        relaunch(environment: ["SH_UITEST_LOCATION": "fixed"])
        openChat()
        openAttachSheet(section: "location")
        XCTAssertFalse(staticText(containing: "Доступ к геопозиции").exists)
        let send = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "Отправить моё местоположение")).firstMatch
        XCTAssertTrue(send.waitForExistence(timeout: timeout), "нет отправки своей точки")
        XCTAssertTrue(send.isEnabled, "отправка неактивна при известной точке")
    }

    // MARK: - 11. Звук

    func testAudioTabPreviewDoesNotSendAndPickGoesToSendQueue() throws {
        openChat()
        openAttachSheet(section: "audio")
        XCTAssertTrue(any("chat.attach.option.folder").waitForExistence(timeout: timeout), "нет «Выбрать из файлов»")
        let play = any("chat.attach.recent.play.file-audio-1")
        XCTAssertTrue(play.waitForExistence(timeout: timeout), "нет списка «Ваши чаты»")
        play.tap()
        XCTAssertTrue(waitForLabel(play, containing: "Пауза"), "воспроизведение не началось")
        play.tap()
        XCTAssertTrue(waitForLabel(play, containing: "Прослушать"), "воспроизведение не остановилось")
        XCTAssertFalse(bubble("chat-1-m41").exists, "прослушивание отправило файл")

        any("chat.attach.recent.row.file-audio-1").tap()
        XCTAssertTrue(any("chat.attachSend.send").waitForExistence(timeout: timeout), "трек не попал в лист отправки")
    }

    // MARK: - 12. Поиск

    func testSearchCountsNavigatesListsAndCloses() throws {
        openChat()
        chatTitle.press(forDuration: 1.0)
        let open = app.buttons["Поиск в чате"].firstMatch
        XCTAssertTrue(open.waitForExistence(timeout: timeout), "нет «Поиск в чате»")
        open.tap()
        let field = any("chat.search.field")
        XCTAssertTrue(field.waitForExistence(timeout: timeout))
        field.typeText("курсов")
        // «Скинь, пожалуйста, методичку по курсовой.» — пять раз в сорока сообщениях.
        XCTAssertTrue(staticText(containing: "1 из 5").waitForExistence(timeout: timeout), "счётчик не «1 из 5»")
        any("chat.search.older").tap()
        XCTAssertTrue(staticText(containing: "2 из 5").waitForExistence(timeout: timeout))
        any("chat.search.newer").tap()
        XCTAssertTrue(staticText(containing: "1 из 5").waitForExistence(timeout: timeout))

        any("chat.search.list").tap()
        let third = any("chat.search.result.2")
        XCTAssertTrue(third.waitForExistence(timeout: timeout), "нет списка результатов")
        third.tap()
        XCTAssertTrue(staticText(containing: "3 из 5").waitForExistence(timeout: timeout), "переход из списка не встал на результат")
        XCTAssertEqual(field.value as? String, "курсов", "запрос потерялся после выбора из списка")

        // Фильтр «С файлами»: среди этих сообщений вложений нет.
        any("chat.search.files").tap()
        XCTAssertTrue(staticText(containing: "0 результатов").waitForExistence(timeout: timeout))
        any("chat.search.files").tap()
        XCTAssertTrue(staticText(containing: "из 5").waitForExistence(timeout: timeout))

        any("chat.search.close").tap()
        XCTAssertTrue(waitForDisappearance(field), "поиск не закрылся")
        XCTAssertTrue(chatTitle.waitForExistence(timeout: timeout), "шапка чата не вернулась")
    }

    // MARK: - Ответ и копирование

    func testReplyBarFocusesComposerAndCopyShowsToast() throws {
        openChat()
        openMenu("chat-1-m40")
        menuAction("reply").tap()
        XCTAssertTrue(staticText(containing: "Ответ").waitForExistence(timeout: timeout), "нет плашки ответа")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: timeout), "клавиатура не открылась для ответа")

        openMenu("chat-1-m39")
        menuAction("copy").tap()
        XCTAssertTrue(staticText(containing: "Текст скопирован").waitForExistence(timeout: timeout), "нет подтверждения копирования")
    }
}
