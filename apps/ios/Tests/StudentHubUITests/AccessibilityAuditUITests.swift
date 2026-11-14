import XCTest

/// Аудит доступности ключевых экранов на mock API (IOS_RULES 11.5.2): вход, список чатов,
/// переписка — обычная и «как под VoiceOver» (`SH_UITEST_VOICEOVER=1`, 11.5.1).
///
/// Рядом со снимком экрана прикладывается дерево `app.debugDescription`: флаги аудита —
/// только подсказки, отсутствующий элемент видно лишь по снимку и дереву.
///
/// Пропускается без `SH_UITEST_LOGIN`, как сценарии на живом сервере: прогон по просьбе
/// владельца, пока первый отчёт аудита не разобран, — иначе CI краснел бы от уже
/// существующих находок, а не от новых.
final class AccessibilityAuditUITests: MockUITestCase {
    /// Классы ошибок правила: интерактивный элемент без метки (`sufficientElementDescription`);
    /// дубль, «голая» картинка, голый текст внутри контрола (`elementDetection`); элемент вне
    /// экрана или нулевого размера (`hitRegion`). Контраст и крупный шрифт — вопросы
    /// оформления, у них свои правила и проверка глазами.
    private let audited: XCUIAccessibilityAuditType = [.sufficientElementDescription, .elementDetection, .hitRegion]

    override func setUpWithError() throws {
        guard let login = ProcessInfo.processInfo.environment["SH_UITEST_LOGIN"], !login.isEmpty else {
            throw XCTSkip("Нет SH_UITEST_LOGIN — аудит доступности пропущен, как сценарии на живом сервере")
        }
        try super.setUpWithError()
    }

    func testSignInScreen() throws {
        relaunch(environment: ["SH_UITEST_SCENARIO": Scenario.signedOut.rawValue])
        XCTAssertTrue(app.textFields["auth.identifier"].waitForExistence(timeout: timeout), "нет экрана входа")
        try audit("вход")
    }

    func testChatList() throws {
        openTab("Чаты")
        XCTAssertTrue(chatRow(Self.firstChatID).waitForExistence(timeout: timeout), "нет списка чатов")
        try audit("список чатов")
    }

    func testThread() throws {
        openChat()
        try audit("переписка")
    }

    /// Под VoiceOver лента раскладывается иначе (нет плавающей даты) — аудит и для неё.
    func testThreadAsUnderVoiceOver() throws {
        relaunch(environment: ["SH_UITEST_VOICEOVER": "1"])
        openChat()
        try audit("переписка под VoiceOver")
    }

    // MARK: - Помощники

    private func audit(_ screen: String) throws {
        settle()
        attachScreenshot(screen)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = "дерево доступности: \(screen)"
        tree.lifetime = .keepAlways
        add(tree)
        try app.performAccessibilityAudit(for: audited)
    }
}
