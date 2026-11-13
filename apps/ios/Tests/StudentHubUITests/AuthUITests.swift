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
        password.tap()
        password.typeText(secret)
        app.buttons["auth.signIn"].tap()
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
