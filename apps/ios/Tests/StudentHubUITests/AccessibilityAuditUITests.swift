import XCTest

/// Аудит доступности ключевых экранов на mock API (IOS_RULES 11.5.2): вход, список чатов,
/// переписка — обычная и «как под VoiceOver» (`SH_UITEST_VOICEOVER=1`, 11.5.1).
///
/// Рядом со снимком экрана прикладывается дерево `app.debugDescription`: флаги аудита —
/// только подсказки, отсутствующий элемент видно лишь по снимку и дереву.
///
/// Данные — mock API, учётка не нужна. Свой набор `scripts/test.sh a11y` (из ui и ui-extended
/// исключён): ночной ios-nightly гоняет его отдельным шагом с `continue-on-error`, пока
/// первый отчёт аудита не разобран, — иначе прогон краснел бы от уже известных находок.
/// Когда находки исправлены, шаг становится обязательным.
final class AccessibilityAuditUITests: MockUITestCase {
    /// Классы ошибок правила: интерактивный элемент без метки (`sufficientElementDescription`);
    /// дубль, «голая» картинка, голый текст внутри контрола (`elementDetection`); элемент вне
    /// экрана или нулевого размера (`hitRegion`). Контраст и крупный шрифт — вопросы
    /// оформления, у них свои правила и проверка глазами.
    private let audited: XCUIAccessibilityAuditType = [.sufficientElementDescription, .elementDetection, .hitRegion]

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
