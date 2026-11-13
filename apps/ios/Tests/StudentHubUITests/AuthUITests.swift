import XCTest

/// Вход по паролю на mock API: неверный пароль — ошибка и экран остаётся; верный —
/// оболочка с вкладками.
final class AuthUITests: MockUITestCase {
    override var scenario: Scenario { .signedOut }

    private var identifier: XCUIElement { app.textFields["auth.identifier"] }

    private var password: XCUIElement {
        app.secureTextFields["auth.password"].exists ? app.secureTextFields["auth.password"] : app.textFields["auth.password"]
    }

    private func signIn(login: String, password secret: String) {
        XCTAssertTrue(identifier.waitForExistence(timeout: timeout), "нет экрана входа")
        identifier.tap()
        identifier.typeText(login)
        type(secret, into: password)
        app.buttons["auth.signIn"].tap()
    }

    /// Ввод в `SecureField` теряет первые символы, если фокус и автозаполнение пароля
    /// ещё не встали, когда раннер начал печатать. Проверяем, сколько символов реально
    /// в поле (у защищённого поля `value` — точки по числу символов), и при расхождении
    /// стираем и печатаем заново.
    private func type(_ secret: String, into field: XCUIElement) {
        for _ in 0..<3 {
            field.tap()
            XCTAssertTrue(field.waitForExistence(timeout: timeout))
            field.typeText(secret)
            let typed = (field.value as? String) ?? ""
            if typed.count == secret.count { return }
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: typed.count + 2))
        }
        XCTFail("пароль не вводится в поле: в нём \((field.value as? String)?.count ?? 0) символов вместо \(secret.count)")
    }

    func testLoginScreenLooksRight() throws {
        XCTAssertTrue(waitForHittable(identifier), "поле логина не появилось")
        XCTAssertTrue(app.buttons["auth.signIn"].exists)
        XCTAssertTrue(app.buttons["auth.forgot"].exists || app.descendants(matching: .any)["auth.forgot"].exists)
        assertScreen("login")
    }

    func testWrongPasswordShowsErrorAndStays() throws {
        signIn(login: Self.login, password: "wrong-password")
        let error = app.descendants(matching: .any)["auth.error"].firstMatch
        XCTAssertTrue(error.waitForExistence(timeout: timeout), "ошибка входа не показалась")
        XCTAssertTrue(identifier.exists, "экран входа пропал после неверного пароля")
        XCTAssertFalse(tab("Чаты").exists, "оболочка открылась с неверным паролем")
    }

    func testCorrectPasswordOpensShell() throws {
        signIn(login: Self.login, password: Self.password)
        waitForShell()
        XCTAssertTrue(waitForDisappearance(identifier), "экран входа не ушёл")
        for title in ["Главная", "Чаты", "Разделы", "Лента"] {
            XCTAssertTrue(tab(title).exists, "нет вкладки «\(title)»")
        }
    }

    func testForgotPasswordOpensAndReturns() throws {
        let forgot = app.descendants(matching: .any)["auth.forgot"].firstMatch
        XCTAssertTrue(forgot.waitForExistence(timeout: timeout))
        forgot.tap()
        XCTAssertTrue(waitForDisappearance(app.buttons["auth.signIn"]), "экран восстановления не открылся")
        backButton.tap()
        XCTAssertTrue(waitForHittable(identifier), "не вернулись к форме входа")
    }
}
