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

    /// Пустое выделение и подпись, равная адресу, — голый адрес (IOS_RULES 7.4.4).
    func testSelfReferentialLinkIsBareAddress() {
        let empty = ComposerFormat.link.apply(to: "", url: "https://example.com")
        XCTAssertEqual(empty.text, "https://example.com")
        XCTAssertEqual(empty.selection, NSRange(location: 19, length: 0))
        XCTAssertEqual(ComposerFormat.link.apply(to: "Example.com/", url: "https://example.com").text, "https://example.com")
        XCTAssertEqual(ComposerFormat.link.apply(to: "www.example.com/a%20b", url: "http://example.com/a b").text, "http://example.com/a%20b")
    }

    /// Подпись и адрес однострочные, разметка экранируется (IOS_RULES 7.2.5).
    func testLinkEscapesLabelAndAddress() {
        let result = ComposerFormat.link.apply(to: "раз\n  [два]", url: "https://example.com/a b(c)")
        XCTAssertEqual(result.text, "[раз \\[два\\]](https://example.com/a%20b%28c%29)")
        XCTAssertEqual(result.selection, NSRange(location: 1, length: 11))
    }

    /// Снятие цитаты узнаёт и `>` без пробела (IOS_RULES 7.4.6).
    func testQuoteUnwrapsBareMarker() {
        XCTAssertEqual(ComposerFormat.quote.apply(to: "> раз\n>\n>два").text, "раз\n\nдва")
    }

    /// Внутри кода — только «Блок кода»; ссылка и моноширинный не накладываются (7.4.3).
    func testFormattingInsideCode() {
        let block = "текст\n```\nlet x = 1\n```\nпосле"
        let inBlock = ComposerContext.at(NSRange(location: 15, length: 3), in: block)
        XCTAssertTrue(inBlock.inCodeBlock)
        XCTAssertFalse(inBlock.allows(.bold))
        XCTAssertTrue(inBlock.allows(.codeBlock))
        XCTAssertFalse(ComposerContext.at(NSRange(location: 0, length: 5), in: block).inCode)
        XCTAssertFalse(ComposerContext.at(NSRange(location: 24, length: 5), in: block).inCode)
        // Незакрытый блок — код: его ещё пишут.
        XCTAssertTrue(ComposerContext.at(NSRange(location: 6, length: 0), in: "```\nlet").inCodeBlock)

        let inline = "вызов `run()` тут"
        XCTAssertTrue(ComposerContext.at(NSRange(location: 7, length: 3), in: inline).inInlineCode)
        XCTAssertFalse(ComposerContext.at(NSRange(location: 14, length: 3), in: inline).inCode)
        // Ссылку на моноширинный не кладём, моноширинный на ссылку — тоже.
        XCTAssertFalse(ComposerContext.at(NSRange(location: 6, length: 7), in: inline).allows(.link))
        let link = "[сайт](https://a.kz)"
        XCTAssertFalse(ComposerContext.at(NSRange(location: 1, length: 4), in: link).allows(.monospace))
        XCTAssertFalse(ComposerContext.at(NSRange(location: 0, length: 20), in: link).allows(.monospace))
        XCTAssertTrue(ComposerContext.at(NSRange(location: 1, length: 4), in: link).allows(.bold))
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
