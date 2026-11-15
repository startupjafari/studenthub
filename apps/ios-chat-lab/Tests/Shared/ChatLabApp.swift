import XCTest

/// Обвязка UI- и perf-тестов: запуск с исходной историей, поиск элементов ленты,
/// ожидание результата (а не просто наличия кнопки), чтение замеров монитора кадров.
enum ChatLabApp {
    /// Свежее приложение: исходная история (`-resetData`), без случайных автоответов (`-uiTesting`).
    static func launch(animations: Bool = true, theme: String = "light", extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        var arguments = ["-resetData", "-uiTesting", "-theme", theme]
        if !animations { arguments.append("-disableAnimations") }
        app.launchArguments = arguments + extra
        app.launch()
        XCTAssertTrue(app.otherElements["chat.screen"].waitForExistence(timeout: 10) || app.collectionViews["chat.list"].waitForExistence(timeout: 5),
                      "приложение должно открыться сразу в переписке")
        return app
    }
}

extension XCUIApplication {
    var chatList: XCUIElement { collectionViews["chat.list"] }
    var inputField: XCUIElement { textViews["input.text"] }
    var sendButton: XCUIElement { buttons["input.send"] }

    /// Все пузыри на экране (идентификатор `message.<id>`).
    var messageBubbles: XCUIElementQuery {
        descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'message.'"))
    }

    /// Пузырь с текстом (подстрока подписи).
    func bubble(containing text: String) -> XCUIElement {
        descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'message.' AND label CONTAINS %@", text)).firstMatch
    }

    /// Самый нижний (новый) видимый пузырь.
    var lowestBubble: XCUIElement? {
        let all = messageBubbles.allElementsBoundByIndex.filter { $0.exists && $0.isHittable }
        return all.max { $0.frame.maxY < $1.frame.maxY }
    }

    /// Отправить текст через поле ввода.
    func send(_ text: String) {
        if !inputField.hasKeyboardFocus { inputField.tap() }
        inputField.typeText(text)
        sendButton.tap()
    }

    /// Пункт меню «Ещё» в шапке чата.
    func openMoreMenu(item title: String) {
        let more = navigationBars.buttons["chat.more"]
        XCTAssertTrue(more.waitForExistence(timeout: 5))
        more.tap()
        let button = buttons[title].firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 3), "нет пункта «\(title)» в меню")
        button.tap()
    }

    /// Действие Debug Menu по ключу (`debug.receiveOne` …). Разовые действия закрывают лист
    /// сами; переключатели (`debug.slowNetwork` …) — нет, тогда лист закрываем кнопкой.
    func debugAction(_ key: String) {
        openMoreMenu(item: "Debug Menu")
        let toggle = switches[key]
        if toggle.waitForExistence(timeout: 2) {
            toggle.tap()
        } else {
            let row = descendants(matching: .any)[key].firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 5), "нет строки \(key) в Debug Menu")
            row.tap()
        }
        let close = buttons["debug.close"]
        if close.waitForExistence(timeout: 1) { close.tap() }
    }

    /// Долгое нажатие на пузырь → меню сообщения.
    func openContextMenu(on bubble: XCUIElement) {
        bubble.press(forDuration: 0.6)
        XCTAssertTrue(otherElements["contextMenu"].waitForExistence(timeout: 3), "меню сообщения не открылось")
    }

    /// Свайп влево по пузырю (ответ).
    func swipeToReply(_ bubble: XCUIElement) {
        let start = bubble.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.5))
        let end = start.withOffset(CGVector(dx: -120, dy: 0))
        start.press(forDuration: 0.02, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.05)
    }

    /// Замер монитора кадров приложения (JSON из `perf.summary`).
    func perfSummary() -> [String: Double] {
        let element = descendants(matching: .any)["perf.summary"]
        guard element.waitForExistence(timeout: 3) else { return [:] }
        let raw = (element.value as? String) ?? element.label
        guard let data = raw.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return object.compactMapValues { ($0 as? NSNumber)?.doubleValue }
    }
}

extension XCUIElement {
    /// Ждать, пока условие станет истинным (значение, метка, существование).
    @discardableResult
    func wait(until predicate: String, timeout: TimeInterval = 5) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: predicate), object: self)
        return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
    }

    func waitForDisappearance(timeout: TimeInterval = 5) -> Bool {
        wait(until: "exists == false", timeout: timeout)
    }

    var hasKeyboardFocus: Bool { (value(forKey: "hasKeyboardFocus") as? Bool) ?? false }
}

/// Средняя яркость области снимка экрана (0…1) — проверка темы по пикселям, а не по флагу.
func averageLuminance(of screenshot: XCUIScreenshot, in rect: CGRect) -> CGFloat {
    let image = screenshot.image
    guard let cgImage = image.cgImage else { return -1 }
    let scale = CGFloat(cgImage.width) / image.size.width
    let crop = CGRect(x: rect.minX * scale, y: rect.minY * scale, width: rect.width * scale, height: rect.height * scale)
    guard let cropped = cgImage.cropping(to: crop) else { return -1 }
    let width = 16, height = 16
    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    guard let context = CGContext(
        data: &pixels, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return -1 }
    context.draw(cropped, in: CGRect(x: 0, y: 0, width: width, height: height))
    var total: CGFloat = 0
    for index in stride(from: 0, to: pixels.count, by: 4) {
        total += (0.2126 * CGFloat(pixels[index]) + 0.7152 * CGFloat(pixels[index + 1]) + 0.0722 * CGFloat(pixels[index + 2])) / 255
    }
    return total / CGFloat(width * height)
}
