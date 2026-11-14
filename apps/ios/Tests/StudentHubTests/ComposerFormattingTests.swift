import XCTest

@testable import StudentHub

/// Форматирование в поле ввода — разметка Markdown, которую понимают веб и пузырь:
/// что встаёт на место выделения и где остаётся курсор.
final class ComposerFormattingTests: XCTestCase {
    func testInlineMarkersWrapSelection() {
        XCTAssertEqual(ComposerFormat.bold.apply(to: "слово").text, "**слово**")
        XCTAssertEqual(ComposerFormat.italic.apply(to: "слово").text, "_слово_")
        XCTAssertEqual(ComposerFormat.monospace.apply(to: "x").text, "`x`")
        XCTAssertEqual(ComposerFormat.strikethrough.apply(to: "x").text, "~~x~~")
        // Выделение остаётся на самом тексте, без разметки.
        XCTAssertEqual(ComposerFormat.bold.apply(to: "слово").selection, NSRange(location: 2, length: 5))
    }

    /// Пустое выделение — пара маркеров с курсором между ними.
    func testEmptySelectionPutsCaretInside() {
        let result = ComposerFormat.bold.apply(to: "")
        XCTAssertEqual(result.text, "****")
        XCTAssertEqual(result.selection, NSRange(location: 2, length: 0))
    }

    /// Повтор на размеченном снимает разметку.
    func testRepeatedFormatUnwraps() {
        let result = ComposerFormat.bold.apply(to: "**слово**")
        XCTAssertEqual(result.text, "слово")
        XCTAssertEqual(result.selection, NSRange(location: 0, length: 5))
    }

    func testLink() {
        let result = ComposerFormat.link.apply(to: "сайт", url: "https://example.com")
        XCTAssertEqual(result.text, "[сайт](https://example.com)")
        XCTAssertEqual(result.selection, NSRange(location: 1, length: 4))
    }

    func testQuoteEveryLineAndBack() {
        let quoted = ComposerFormat.quote.apply(to: "раз\nдва").text
        XCTAssertEqual(quoted, "> раз\n> два")
        XCTAssertEqual(ComposerFormat.quote.apply(to: quoted).text, "раз\nдва")
    }

    func testCodeBlock() {
        let result = ComposerFormat.codeBlock.apply(to: "let x = 1")
        XCTAssertEqual(result.text, "```\nlet x = 1\n```")
        XCTAssertEqual(result.selection, NSRange(location: 4, length: 9))
    }

    // MARK: Списки

    func testBulletAddedAtLineStart() {
        let change = ComposerList.toggle(.bulleted, in: "первое\nвторое", at: 9)
        XCTAssertEqual(change.range, NSRange(location: 7, length: 0))
        XCTAssertEqual(change.replacement, "- ")
    }

    func testBulletRemovedWhenPresent() {
        let change = ComposerList.toggle(.bulleted, in: "- пункт", at: 4)
        XCTAssertEqual(change.range, NSRange(location: 0, length: 2))
        XCTAssertEqual(change.replacement, "")
    }

    /// Номер — следующий за строкой выше.
    func testNumberContinuesPreviousLine() {
        let text = "1. раз\n2. два\nтри"
        let change = ComposerList.toggle(.numbered, in: text, at: (text as NSString).length)
        XCTAssertEqual(change.replacement, "3. ")
        XCTAssertEqual(ComposerList.toggle(.numbered, in: "раз", at: 0).replacement, "1. ")
    }

    /// Маркер другого вида заменяется, а не добавляется вторым.
    func testSwitchBulletToNumber() {
        let change = ComposerList.toggle(.numbered, in: "- пункт", at: 3)
        XCTAssertEqual(change.range, NSRange(location: 0, length: 2))
        XCTAssertEqual(change.replacement, "1. ")
    }

    func testMarkerDetection() {
        XCTAssertEqual(ComposerList.marker(of: "12. пункт"), "12. ")
        XCTAssertEqual(ComposerList.marker(of: "- пункт"), "- ")
        XCTAssertNil(ComposerList.marker(of: "2024 год"))
        XCTAssertNil(ComposerList.marker(of: "текст"))
    }
}
