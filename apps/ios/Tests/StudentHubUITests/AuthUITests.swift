import XCTest

/// Вход по паролю на mock API: неверный пароль — ошибка и экран остаётся; верный —
/// оболочка с вкладками.
final class AuthUITests: MockUITestCase {
    override var scenario: Scenario { .signedOut }

    private var identifier: XCUIElement { app.textFields["auth.identifier"] }

    private func signIn(login: String, password secret: String) {
        XCTAssertTrue(identifier.waitForExistence(timeout: timeout), "нет экрана входа")
        identifier.tap()
        identifier.typeText(login)
        type(secret)
        app.buttons["auth.signIn"].tap()
    }

    /// Пароль печатается в открытое поле («Показать пароль»). Синтетический ввод XCUITest
    /// в `SecureField` на симуляторе iOS 26 не доходит: поле в фокусе, клавиатура открыта,
    /// а в поле пусто — `value` отдаёт плейсхолдер «Пароль». Открытое поле — тот же
    /// `model.password` и тот же вход, проверяется сценарий, а не системная клавиатура.
    ///
    /// Число символов сверяется с `value` и при расхождении ввод повторяется: первые
    /// символы теряются, если фокус ещё не встал, когда раннер начал печатать.
    private func type(_ secret: String) {
        let toggle = app.buttons["auth.passwordVisibility"]
        XCTAssertTrue(toggle.waitForExistence(timeout: timeout), "нет кнопки «Показать пароль»")
        toggle.tap()
        let field = app.textFields["auth.password"]
        XCTAssertTrue(field.waitForExistence(timeout: timeout), "поле пароля не открылось")
        for _ in 0..<3 {
            field.tap()
            field.typeText(secret)
            let typed = (field.value as? String) ?? ""
            if typed == secret { return }
            let length = typed == field.placeholderValue ? 0 : typed.count
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: length + 2))
        }
        XCTFail("пароль не вводится в поле: «\((field.value as? String) ?? "")» вместо \(secret.count) символов")
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
