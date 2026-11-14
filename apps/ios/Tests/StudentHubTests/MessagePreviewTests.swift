import XCTest

@testable import StudentHub

/// Однострочное превью сообщения (IOS_RULES 7.7.1, 7.7.2): без разметки, код — словом,
/// переводы строк — пробелом, длина — по графемам.
final class MessagePreviewTests: XCTestCase {
    func testInlineMarkupIsStripped() {
        XCTAssertEqual(MessagePreview.text("**жирный** и `код` и ~~нет~~"), "жирный и код и нет")
        XCTAssertEqual(MessagePreview.text("[сайт](https://example.com)"), "сайт")
    }

    func testCodeBlockBecomesWord() {
        XCTAssertEqual(MessagePreview.text("Смотри:\n```swift\nlet a = 1\n```\nвот"), "Смотри: Код вот")
    }

    func testQuoteAndLineBreaksCollapse() {
        XCTAssertEqual(MessagePreview.text("> цитата\n>\nответ\r\nещё"), "цитата ответ ещё")
    }

    func testPlainTextUnchanged() {
        XCTAssertEqual(MessagePreview.text("Привет, как дела?"), "Привет, как дела?")
    }

    /// Длинное режется по графемам: семейный emoji не распадается.
    func testClipByGraphemes() {
        let family = "👨‍👩‍👧"
        let text = String(repeating: family, count: MessagePreview.maxLength + 5)
        let preview = MessagePreview.text(text)
        XCTAssertEqual(preview.count, MessagePreview.maxLength + 1)
        XCTAssertTrue(preview.hasSuffix(family + "…"))
    }
}
