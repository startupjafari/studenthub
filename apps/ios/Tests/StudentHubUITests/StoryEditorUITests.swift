import XCTest

/// Редактор историй на mock API: камера — имитация (`StorySimulatedCamera`), галерея —
/// синтетическая (`StorySyntheticGallery`), поэтому сценарии идут на симуляторе без
/// камеры и без разрешений «Фото». Сценарии 1–9 — из ТЗ редактора (ЧАСТЬ 17).
///
/// Что здесь не проверяется: настоящая камера и микрофон, частота кадров под пальцем,
/// тактильный отклик — это iPhone (раздел «Что тесты не заменяют» в README).
final class StoryEditorUITests: MockUITestCase {
    // MARK: - Помощники

    private func any(_ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    private func button(_ id: String) -> XCUIElement {
        app.buttons[id].firstMatch
    }

    private var shutter: XCUIElement { any("story.camera.shutter") }
    private var editorNext: XCUIElement { button("story.editor.next") }
    private var textEntities: XCUIElementQuery { app.descendants(matching: .any).matching(identifier: "story.entity.text") }

    /// Лента → «Добавить» → камера историй.
    private func openStudio(file: StaticString = #filePath, line: UInt = #line) {
        openTab("Лента", file: file, line: line)
        let add = any("stories.add")
        XCTAssertTrue(add.waitForExistence(timeout: timeout), "нет кнопки «Добавить» в историях", file: file, line: line)
        add.tap()
        XCTAssertTrue(shutter.waitForExistence(timeout: timeout), "камера историй не открылась", file: file, line: line)
    }

    /// Снимок камерой → редактор.
    private func openEditorWithPhoto(file: StaticString = #filePath, line: UInt = #line) {
        openStudio(file: file, line: line)
        XCTAssertEqual(shutter.value as? String, "photo", file: file, line: line)
        shutter.tap()
        XCTAssertTrue(editorNext.waitForExistence(timeout: timeout), "редактор не открылся после снимка", file: file, line: line)
    }

    private func waitForValue(_ element: XCUIElement, _ value: String, timeout: TimeInterval? = nil) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: element)
        return XCTWaiter().wait(for: [expectation], timeout: timeout ?? self.timeout) == .completed
    }

    private func waitForValue(_ element: XCUIElement, containing fragment: String) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value CONTAINS %@", fragment), object: element)
        return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
    }

    /// Надпись из нескольких строк: ввод, эмодзи, шрифт и цвет — как в ТЗ (п. 7.3).
    private func addText(_ lines: [String], emoji: String? = nil, font: String? = nil, color: String? = nil) {
        button("story.editor.text").tap()
        let input = app.textViews["story.text.input"]
        XCTAssertTrue(input.waitForExistence(timeout: timeout), "поле надписи не появилось")
        input.typeText(lines.joined(separator: "\n"))
        if let emoji {
            button("story.text.emoji").tap()
            let cell = app.buttons[emoji].firstMatch
            XCTAssertTrue(cell.waitForExistence(timeout: timeout), "нет эмодзи \(emoji) в панели")
            cell.tap()
            button("story.text.keyboard").tap()
        }
        if let font {
            button("story.text.fonts").tap()
            let chip = button("story.text.font.\(font)")
            XCTAssertTrue(chip.waitForExistence(timeout: timeout), "нет шрифта \(font)")
            chip.tap()
            button("story.text.fontsBack").tap()
        }
        if let color {
            let swatch = button("story.text.color.\(color)")
            XCTAssertTrue(swatch.waitForExistence(timeout: timeout), "нет цвета \(color)")
            swatch.tap()
        }
        button("story.tool.done").tap()
        XCTAssertTrue(waitForDisappearance(input), "правка надписи не закрылась")
    }

    private func drawLine(from: CGVector, to: CGVector) {
        let canvas = any("story.drawing.canvas")
        XCTAssertTrue(canvas.waitForExistence(timeout: timeout))
        canvas.coordinate(withNormalizedOffset: from).press(forDuration: 0.05, thenDragTo: canvas.coordinate(withNormalizedOffset: to))
    }

    // MARK: - 1. Камера

    func testCameraModesSwitchShutter() throws {
        openStudio()
        XCTAssertEqual(shutter.value as? String, "photo", "по умолчанию — «Фото»")

        any("story.camera.mode.video").tap()
        XCTAssertTrue(waitForValue(shutter, "video"), "затвор не стал красным в «Видео»")
        XCTAssertTrue(any("story.camera.mode.video").isSelected)

        any("story.camera.mode.photo").tap()
        XCTAssertTrue(waitForValue(shutter, "photo"), "затвор не вернулся к «Фото»")

        // Смена камеры сохраняет режим.
        let flip = button("story.camera.flip")
        XCTAssertEqual(flip.value as? String, "back")
        flip.tap()
        XCTAssertTrue(waitForValue(flip, "front"), "камера не переключилась")
        XCTAssertEqual(shutter.value as? String, "photo", "режим сбросился при смене камеры")
    }

    func testVideoRecordingOpensVideoEditor() throws {
        openStudio()
        any("story.camera.mode.video").tap()
        XCTAssertTrue(waitForValue(shutter, "video"))
        shutter.tap()
        XCTAssertTrue(waitForValue(shutter, "recording"), "запись не началась")
        XCTAssertTrue(any("story.camera.recordingTimer").waitForExistence(timeout: timeout), "нет таймера записи")
        settle(1.5)
        shutter.tap()
        XCTAssertTrue(editorNext.waitForExistence(timeout: 30), "редактор видео не открылся")
    }

    // MARK: - 2. Коллаж

    func testCollageFourGridFillsAndOpensEditor() throws {
        openStudio()
        button("story.camera.collage").tap()
        let grid = button("story.collage.layout.fourGrid")
        XCTAssertTrue(grid.waitForExistence(timeout: timeout), "нет выбора раскладки")
        grid.tap()
        // Камера остаётся видна, ячеек — четыре, живая — первая.
        for index in 0..<4 {
            XCTAssertTrue(any("story.collage.cell.\(index)").waitForExistence(timeout: timeout), "нет ячейки \(index)")
        }
        XCTAssertFalse(any("story.collage.cell.4").exists, "лишняя ячейка")
        XCTAssertTrue(waitForValue(any("story.collage.cell.0"), "active"))
        XCTAssertEqual(any("story.collage.cell.1").value as? String, "empty")

        button("story.camera.collage").tap()
        shutter.tap()
        XCTAssertTrue(waitForValue(any("story.collage.cell.0"), "filled"))
        XCTAssertTrue(waitForValue(any("story.collage.cell.1"), "active"), "камера не перешла в следующую ячейку")
        shutter.tap()
        XCTAssertTrue(waitForValue(any("story.collage.cell.1"), "filled"))

        // Переснять первую ячейку.
        any("story.collage.cell.0").tap()
        XCTAssertTrue(waitForValue(any("story.collage.cell.0"), "active"), "ячейку нельзя переснять")
        shutter.tap()
        XCTAssertTrue(waitForValue(any("story.collage.cell.0"), "filled"))

        shutter.tap()
        shutter.tap()
        XCTAssertTrue(editorNext.waitForExistence(timeout: timeout), "после четырёх кадров редактор не открылся")
        // Собранный кадр уходит дальше одной картинкой.
        editorNext.tap()
        XCTAssertTrue(any("story.publish.preview").waitForExistence(timeout: 30), "коллаж не собрался в историю")
    }

    // MARK: - 3. Галерея

    func testGalleryKeepsScrollPositionAfterPreview() throws {
        openStudio()
        button("story.camera.gallery").tap()
        let gridView = any("story.gallery.grid")
        XCTAssertTrue(gridView.waitForExistence(timeout: timeout), "галерея не открылась")
        XCTAssertTrue(any("story.gallery.item.synthetic-1").waitForExistence(timeout: timeout))
        gridView.swipeUp()
        gridView.swipeUp()
        let visible = (1...StorySyntheticGalleryCount.value).map { any("story.gallery.item.synthetic-\($0)") }
            .first { $0.exists && $0.isHittable && $0.frame.minY > gridView.frame.minY + 40 }
        let picked = try XCTUnwrap(visible, "после прокрутки нет видимой плитки")
        let pickedID = picked.identifier
        XCTAssertFalse(any("story.gallery.item.synthetic-1").isHittable, "прокрутка не сдвинула сетку")

        picked.tap()
        XCTAssertTrue(editorNext.waitForExistence(timeout: timeout), "снимок из галереи не открылся")
        XCTAssertTrue(any("story.canvas").exists, "нет холста с предпросмотром")

        button("story.editor.close").tap()
        let again = any(pickedID)
        XCTAssertTrue(waitForHittable(again), "после возврата галерея не на прежней прокрутке")
        XCTAssertFalse(any("story.gallery.item.synthetic-1").isHittable, "галерея прокрутилась к началу")
    }

    func testGalleryMultiSelectKeepsOrder() throws {
        openStudio()
        button("story.camera.gallery").tap()
        XCTAssertTrue(any("story.gallery.item.synthetic-3").waitForExistence(timeout: timeout))
        button("story.gallery.select").tap()
        any("story.gallery.item.synthetic-3").tap()
        any("story.gallery.item.synthetic-1").tap()
        any("story.gallery.item.synthetic-2").tap()
        XCTAssertEqual(any("story.gallery.item.synthetic-3").value as? String, "1")
        XCTAssertEqual(any("story.gallery.item.synthetic-1").value as? String, "2")
        // Снять отметку — номера сдвигаются, порядок остальных прежний.
        any("story.gallery.item.synthetic-3").tap()
        XCTAssertTrue(waitForValue(any("story.gallery.item.synthetic-1"), "1"))
        XCTAssertEqual(any("story.gallery.item.synthetic-2").value as? String, "2")

        button("story.gallery.next").tap()
        XCTAssertTrue(editorNext.waitForExistence(timeout: timeout))
        let queue = any("story.editor.queue")
        XCTAssertTrue(queue.waitForExistence(timeout: timeout), "нет счётчика выбранных")
        XCTAssertEqual(queue.label, "1 / 2", "выбранные открываются не по порядку")
    }

    // MARK: - 4. Текст

    func testMultilineTextWithEmojiFontColorEditsWithoutDuplicates() throws {
        openEditorWithPhoto()
        // Цвет — из быстрых на панели над клавиатурой (первые шесть пресетов).
        addText(["Первая строка", "Вторая строка", "Третья строка"], emoji: "😀", font: "serif", color: "#30D158")

        XCTAssertEqual(textEntities.count, 1, "надпись должна быть одна")
        let entity = textEntities.firstMatch
        XCTAssertTrue(entity.label.contains("Третья строка😀"), "эмодзи не в конце текста: \(entity.label)")
        XCTAssertTrue(entity.label.contains("\n"), "строки слились")
        let value = entity.value as? String ?? ""
        XCTAssertTrue(value.contains("serif"), "шрифт не применился: \(value)")
        XCTAssertTrue(value.contains("#30D158"), "цвет не применился: \(value)")

        // Перетащить надпись.
        let before = entity.frame
        entity.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 0.05, thenDragTo: app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)))
        settle()
        XCTAssertNotEqual(textEntities.firstMatch.frame.midY, before.midY, accuracy: 4, "надпись не сдвинулась")

        // Повторная правка — та же надпись, без копии.
        textEntities.firstMatch.tap()
        let input = app.textViews["story.text.input"]
        XCTAssertTrue(input.waitForExistence(timeout: timeout), "повторная правка не открылась")
        input.typeText("!")
        button("story.tool.done").tap()
        XCTAssertTrue(waitForDisappearance(input))
        XCTAssertEqual(textEntities.count, 1, "правка создала дубликат")
        XCTAssertTrue(textEntities.firstMatch.label.hasSuffix("!"))
    }

    // MARK: - 5. Рисование

    func testDrawingUndoAndClearAllKeepPhotoAndText() throws {
        openEditorWithPhoto()
        addText(["Не стирать"])

        button("story.editor.draw").tap()
        button("story.drawing.brush.pen").tap()
        button("story.drawing.color.#FF453A").tap()
        drawLine(from: CGVector(dx: 0.2, dy: 0.3), to: CGVector(dx: 0.8, dy: 0.35))
        let canvas = any("story.drawing.canvas")
        XCTAssertTrue(waitForValue(canvas, "1"), "первая линия не нарисовалась")

        button("story.drawing.brush.marker").tap()
        XCTAssertTrue(button("story.drawing.brush.marker").isSelected)
        drawLine(from: CGVector(dx: 0.2, dy: 0.6), to: CGVector(dx: 0.8, dy: 0.65))
        XCTAssertTrue(waitForValue(canvas, "2"), "вторая линия не нарисовалась")

        button("story.drawing.undo").tap()
        XCTAssertTrue(waitForValue(canvas, "1"), "«Отмена» должна снять только вторую линию")

        button("story.drawing.redo").tap()
        XCTAssertTrue(waitForValue(canvas, "2"), "повтор не вернул линию")

        button("story.drawing.clear").tap()
        XCTAssertTrue(waitForValue(canvas, "0"), "«Очистить всё» не стёрло рисунок")
        XCTAssertEqual(textEntities.count, 1, "очистка рисунка удалила надпись")

        button("story.tool.done").tap()
        XCTAssertTrue(editorNext.waitForExistence(timeout: timeout))
        XCTAssertTrue(any("story.canvas").exists, "фото пропало")
        XCTAssertEqual(textEntities.count, 1)
    }

    // MARK: - 6. Цвет

    func testColorPickerPaletteOpacityAndSpectrum() throws {
        openEditorWithPhoto()
        button("story.editor.draw").tap()
        button("story.drawing.palette").tap()
        let sheet = any("story.color.sheet")
        XCTAssertTrue(sheet.waitForExistence(timeout: timeout), "выбор цвета не открылся")

        let preview = any("story.color.preview")
        let initial = preview.value as? String ?? ""
        any("story.color.grid").coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.45)).tap()
        XCTAssertNotEqual(preview.value as? String, initial, "оттенок из палитры не выбрался")

        let opacity = any("story.color.opacity")
        let width = opacity.frame.width
        opacity.coordinate(withNormalizedOffset: CGVector(dx: (13 + 0.33 * (width - 26)) / width, dy: 0.5)).tap()
        XCTAssertTrue(app.staticTexts["33%"].waitForExistence(timeout: timeout), "прозрачность не 33 %")
        XCTAssertTrue((preview.value as? String ?? "").hasSuffix("33%"), "предпросмотр не показывает прозрачность")

        let afterGrid = preview.value as? String
        app.buttons["Спектр"].tap()
        any("story.color.spectrum").coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.7)).tap()
        XCTAssertNotEqual(preview.value as? String, afterGrid, "спектр не обновил цвет")

        button("story.color.close").tap()
        XCTAssertTrue(waitForDisappearance(sheet))
        XCTAssertTrue(waitForValue(button("story.drawing.palette"), containing: "33%"), "цвет не применился к кисти")
    }

    // MARK: - 7. Обработка

    func testAdjustmentsAndLinearBlur() throws {
        openEditorWithPhoto()
        button("story.editor.adjust").tap()
        let brightness = any("story.adjust.brightness")
        XCTAssertTrue(brightness.waitForExistence(timeout: timeout), "нет ползунка яркости")
        brightness.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .press(forDuration: 0.05, thenDragTo: brightness.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5)))
        let contrast = any("story.adjust.contrast")
        contrast.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .press(forDuration: 0.05, thenDragTo: contrast.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.5)))
        XCTAssertNotEqual(brightness.value as? String, "0", "яркость не изменилась")
        XCTAssertNotEqual(contrast.value as? String, "0", "контраст не изменился")
        XCTAssertNotEqual(brightness.value as? String, "0", "контраст сбросил яркость")

        button("story.adjust.tab.blur").tap()
        button("story.blur.linear").tap()
        let guides = any("story.blur.guides")
        XCTAssertTrue(guides.waitForExistence(timeout: timeout), "нет направляющих линейного размытия")
        let canvas = any("story.canvas")
        canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
            .press(forDuration: 0.05, thenDragTo: canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)))

        button("story.tool.done").tap()
        XCTAssertTrue(editorNext.waitForExistence(timeout: timeout))
        XCTAssertFalse(guides.exists, "направляющие остались после подтверждения")
        // Значения пережили смену вкладок и подтверждение.
        button("story.editor.adjust").tap()
        XCTAssertNotEqual(any("story.adjust.brightness").value as? String, "0")
        button("story.tool.cancel").tap()
    }

    // MARK: - 8. Черновик

    func testDraftRestoresEditableState() throws {
        openEditorWithPhoto()
        addText(["Черновик тест"])
        button("story.editor.draw").tap()
        button("story.drawing.color.#30D158").tap()
        drawLine(from: CGVector(dx: 0.2, dy: 0.5), to: CGVector(dx: 0.7, dy: 0.55))
        XCTAssertTrue(waitForValue(any("story.drawing.canvas"), "1"))
        button("story.tool.done").tap()

        button("story.editor.close").tap()
        let alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: timeout), "нет диалога «Сбросить изменения?»")
        alert.buttons["Сохранить черновик"].firstMatch.tap()
        XCTAssertTrue(shutter.waitForExistence(timeout: timeout), "после сохранения черновика не вернулись к камере")

        button("story.camera.gallery").tap()
        // Панель галереи выезжает пружиной: тап по ещё едущему меню альбомов попадает
        // в плитку под ним. Ждём, пока рамка меню перестанет сдвигаться.
        XCTAssertTrue(any("story.gallery.item.synthetic-1").waitForExistence(timeout: timeout), "галерея не открылась")
        let album = any("story.gallery.album")
        XCTAssertTrue(album.waitForExistence(timeout: timeout))
        var last = album.frame
        for _ in 0..<20 {
            Thread.sleep(forTimeInterval: 0.15)
            let now = album.frame
            if now == last { break }
            last = now
        }
        album.tap()
        // Пункт системного меню: идентификатор SwiftUI туда не доходит — ищем по подписи.
        // В iOS 26 пункт меню бывает не Button, а MenuItem — ищем любой тип.
        let drafts = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label BEGINSWITH %@", "Черновики")).firstMatch
        XCTAssertTrue(drafts.waitForExistence(timeout: timeout), "в меню альбомов нет «Черновики»")
        drafts.tap()
        let draft = any("story.gallery.draft")
        XCTAssertTrue(draft.waitForExistence(timeout: timeout), "черновика нет в галерее")
        draft.tap()

        XCTAssertTrue(editorNext.waitForExistence(timeout: timeout), "черновик не открылся")
        XCTAssertEqual(textEntities.count, 1)
        XCTAssertTrue(textEntities.firstMatch.label.contains("Черновик тест"))
        button("story.editor.draw").tap()
        XCTAssertTrue(waitForValue(any("story.drawing.canvas"), "1"), "рисунок не восстановился")
        XCTAssertTrue(waitForValue(button("story.drawing.palette"), containing: "#30D158"), "цвет кисти не восстановился")
        // Всё снова редактируется: линия добавляется к восстановленной.
        drawLine(from: CGVector(dx: 0.3, dy: 0.7), to: CGVector(dx: 0.6, dy: 0.72))
        XCTAssertTrue(waitForValue(any("story.drawing.canvas"), "2"))
        button("story.tool.done").tap()
        textEntities.firstMatch.tap()
        XCTAssertTrue(app.textViews["story.text.input"].waitForExistence(timeout: timeout), "надпись черновика не редактируется")
        button("story.tool.cancel").tap()
    }

    // MARK: - 9. Выход без сохранения

    func testDiscardDialogCancelThenDelete() throws {
        openEditorWithPhoto()
        addText(["Изменение"])

        button("story.editor.close").tap()
        let alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: timeout))
        XCTAssertTrue(alert.staticTexts["Сбросить изменения?"].exists)
        XCTAssertTrue(alert.buttons["Удалить"].firstMatch.exists)
        XCTAssertTrue(alert.buttons["Сохранить черновик"].firstMatch.exists)
        XCTAssertTrue(alert.buttons["Отмена"].firstMatch.exists)

        alert.buttons["Отмена"].firstMatch.tap()
        XCTAssertTrue(waitForDisappearance(alert))
        XCTAssertTrue(editorNext.exists, "«Отмена» закрыла редактор")
        XCTAssertEqual(textEntities.count, 1, "«Отмена» потеряла правки")

        button("story.editor.close").tap()
        XCTAssertTrue(alert.waitForExistence(timeout: timeout))
        alert.buttons["Удалить"].firstMatch.tap()
        XCTAssertTrue(shutter.waitForExistence(timeout: timeout), "после «Удалить» не вернулись к камере")
        XCTAssertFalse(editorNext.exists)
    }

    /// Без изменений «×» закрывает редактор без диалога.
    func testCloseWithoutChangesSkipsDialog() throws {
        openEditorWithPhoto()
        button("story.editor.close").tap()
        XCTAssertTrue(shutter.waitForExistence(timeout: timeout))
        XCTAssertFalse(app.alerts.firstMatch.exists, "диалог без изменений")
    }

    // MARK: - Фон и возврат

    /// Уход в фон и возврат: камера снова работает, редактор не теряет правки.
    func testBackgroundAndReturnKeepsEditor() throws {
        openEditorWithPhoto()
        addText(["Фон"])
        XCUIDevice.shared.press(.home)
        settle(1)
        app.activate()
        XCTAssertTrue(editorNext.waitForExistence(timeout: timeout))
        XCTAssertEqual(textEntities.count, 1)
    }
}

/// Сколько снимков в синтетической галерее (`StorySyntheticGallery.count`).
private enum StorySyntheticGalleryCount {
    static let value = 60
}
