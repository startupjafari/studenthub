import XCTest

/// Основа сценариев на mock API: приложение запускается без сервера и без учётки, с
/// чистым состоянием и детерминированными данными (`Sources/App/UITesting`).
///
/// Окружение приложения:
/// - `SH_UITEST_MOCK=1` — сеть из фикстур, без сокета и запроса пушей;
/// - `SH_UITEST_SCENARIO` — `signedOut` (экран входа) или `student` (сразу вошёл);
/// - `SH_UITEST_REDUCE_MOTION=1` — уменьшение движения (см. `reduceMotion`).
///
/// Ассерты — на конечные состояния элементов, а не на паузы: XCUITest сам ждёт, пока
/// приложение затихнет, а `waitForExistence`/`waitForDisappearance` — пока элемент
/// придёт в нужное состояние.
class MockUITestCase: XCTestCase {
    enum Scenario: String {
        case signedOut
        case student
    }

    /// Учётка mock-сервера (`MockFixtures`).
    static let login = "student@test.local"
    static let password = "Test1234!"

    /// Первый чат фикстур: личный, 40 сообщений, последнее — `chat-1-m40`.
    static let firstChatID = "chat-1"
    static let firstChatMessages = 40

    var app: XCUIApplication!

    /// Сценарий запуска. Переопределяется в наборе.
    var scenario: Scenario { .student }
    /// Уменьшение движения — для набора `ReduceMotionUITests`.
    var reduceMotion: Bool { false }

    /// Ожидание по умолчанию: симулятор на раннере CI бывает медленным.
    let timeout: TimeInterval = 15

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchEnvironment["SH_UITEST_MOCK"] = "1"
        app.launchEnvironment["SH_UITEST_SCENARIO"] = scenario.rawValue
        if reduceMotion { app.launchEnvironment["SH_UITEST_REDUCE_MOTION"] = "1" }
        app.launchArguments += ["-AppleLanguages", "(ru)", "-AppleLocale", "ru_RU"]
        // Системные запросы (фото, микрофон) — разрешаем, чтобы не перекрыли экран.
        addUIInterruptionMonitor(withDescription: "Системный запрос") { alert in
            for title in ["Разрешить", "Allow", "OK", "Разрешить доступ ко всем фото", "Allow Full Access"]
            where alert.buttons[title].exists {
                alert.buttons[title].tap()
                return true
            }
            return false
        }
        app.launch()
    }

    override func tearDownWithError() throws {
        // Снимок последнего экрана — всегда: по нему разбирается упавший тест без
        // повторного прогона.
        if let app, app.state == .runningForeground {
            attachScreenshot("конец теста")
        }
        app?.terminate()
    }

    // MARK: - Оболочка

    func tab(_ title: String) -> XCUIElement {
        app.tabBars.buttons[title]
    }

    /// Дождаться оболочки с вкладками (сценарий `student` или после входа).
    @discardableResult
    func waitForShell(file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        let chats = tab("Чаты")
        XCTAssertTrue(chats.waitForExistence(timeout: timeout), "нет панели вкладок", file: file, line: line)
        return chats
    }

    func openTab(_ title: String, file: StaticString = #filePath, line: UInt = #line) {
        let button = tab(title)
        XCTAssertTrue(button.waitForExistence(timeout: timeout), "нет вкладки «\(title)»", file: file, line: line)
        button.tap()
        XCTAssertTrue(
            app.navigationBars[title].waitForExistence(timeout: timeout),
            "вкладка «\(title)» не открылась", file: file, line: line)
    }

    // MARK: - Чаты

    func chatRow(_ id: String) -> XCUIElement {
        app.descendants(matching: .any)["chatlist.row.\(id)"].firstMatch
    }

    var chatTitle: XCUIElement {
        app.descendants(matching: .any)["chat.title"].firstMatch
    }

    var composer: XCUIElement {
        let view = app.textViews["chat.composer"]
        return view.exists ? view : app.textFields["chat.composer"]
    }

    func openChat(_ id: String = MockUITestCase.firstChatID, file: StaticString = #filePath, line: UInt = #line) {
        openTab("Чаты", file: file, line: line)
        let row = chatRow(id)
        XCTAssertTrue(row.waitForExistence(timeout: timeout), "нет строки чата \(id)", file: file, line: line)
        row.tap()
        XCTAssertTrue(chatTitle.waitForExistence(timeout: timeout), "переписка не открылась", file: file, line: line)
        XCTAssertTrue(
            app.textViews["chat.composer"].waitForExistence(timeout: timeout) || app.textFields["chat.composer"].exists,
            "нет поля ввода", file: file, line: line)
    }

    /// Кнопка «назад» навигационной панели: у UIKit её идентификатор — `BackButton`,
    /// подпись зависит от заголовка предыдущего экрана.
    var backButton: XCUIElement {
        let bar = app.navigationBars.firstMatch
        for label in ["BackButton", "Чаты", "Назад", "Back"] where bar.buttons[label].exists {
            return bar.buttons[label]
        }
        return bar.buttons.element(boundBy: 0)
    }

    // MARK: - Ожидания

    /// Дождаться, что элемент исчез (или не существовал).
    @discardableResult
    func waitForDisappearance(_ element: XCUIElement, timeout: TimeInterval? = nil) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element)
        return XCTWaiter().wait(for: [expectation], timeout: timeout ?? self.timeout) == .completed
    }

    /// Дождаться, что элемент на экране и принимает касания: анимация появления дошла
    /// до конца, а не застряла посередине.
    @discardableResult
    func waitForHittable(_ element: XCUIElement, timeout: TimeInterval? = nil) -> Bool {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == true AND hittable == true"), object: element)
        return XCTWaiter().wait(for: [expectation], timeout: timeout ?? self.timeout) == .completed
    }

    /// Элемент целиком внутри окна — не уехал за край и не застрял в промежуточной позиции.
    func assertOnScreen(_ element: XCUIElement, _ message: String = "", file: StaticString = #filePath, line: UInt = #line) {
        let window = app.windows.firstMatch.frame
        let frame = element.frame
        XCTAssertFalse(frame.isEmpty, "пустая рамка: \(message)", file: file, line: line)
        XCTAssertTrue(
            window.insetBy(dx: -1, dy: -1).contains(frame),
            "элемент вне экрана (\(frame) в \(window)): \(message)", file: file, line: line)
    }

    /// Короткая пауза, чтобы мигание курсора и затухание индикаторов прокрутки не
    /// попали в снимок. Не для ожидания состояния — для этого `waitFor…`.
    func settle(_ seconds: TimeInterval = 0.6) {
        RunLoop.current.run(until: Date().addingTimeInterval(seconds))
    }

    // MARK: - Снимки

    func attachScreenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// Полноэкранный снимок против эталона (`SnapshotComparison`). Только стабильные
    /// экраны: без относительных дат («вчера», «2 ч назад») — они зависят от часов
    /// раннера, а не от кода.
    func assertScreen(_ name: String, file: StaticString = #filePath, line: UInt = #line) {
        // Клавиатура и курсор в снимок не идут: раскладка клавиатуры зависит от
        // настроек симулятора, а не от приложения.
        XCTAssertFalse(app.keyboards.firstMatch.exists, "снимок «\(name)» снимается без клавиатуры", file: file, line: line)
        settle()
        SnapshotComparison.assert(
            XCUIScreen.main.screenshot().image, named: name, suite: String(describing: type(of: self)),
            tolerance: .screen, testCase: self, file: file, line: line)
    }
}
