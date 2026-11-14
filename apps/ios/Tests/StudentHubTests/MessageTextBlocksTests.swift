import XCTest

@testable import StudentHub

/// Цитаты и списки в пузыре (IOS_RULES 7.6.1): тот же набор, что даёт поле ввода.
final class MessageTextBlocksTests: XCTestCase {
    private typealias Block = MessageTextBlocks.Block
    private typealias Item = MessageTextBlocks.ListItem

    /// Обычный текст идёт прежним путём одной строкой `Text`: блоков нет.
    func testPlainTextHasNoBlocks() {
        XCTAssertNil(MessageTextBlocks.blocks(ifAny: "Просто **текст**\nв две строки"))
        // Цифра в начале — повод разобрать, но не пункт: без «. » после неё.
        XCTAssertNil(MessageTextBlocks.blocks(ifAny: "10 минут\n-5 градусов"))
        XCTAssertFalse(MessageTextBlocks.mayHaveBlocks("Привет\nкак дела"))
    }

    /// Подряд идущие строки `>` — одна цитата; строка из одного `>` её не рвёт (7.6.3).
    func testQuoteLinesJoin() {
        XCTAssertEqual(
            MessageTextBlocks.parse("Он сказал:\n> первая\n>\n>вторая\nи ушёл"),
            [.text("Он сказал:"), .quote("первая\n\nвторая"), .text("и ушёл")]
        )
    }

    /// Пустая цитата остаётся текстом как есть.
    func testEmptyQuoteStaysText() {
        XCTAssertNil(MessageTextBlocks.blocks(ifAny: ">\n> "))
    }

    /// Экранированный знак — не цитата.
    func testEscapedQuoteIsText() {
        XCTAssertNil(MessageTextBlocks.blocks(ifAny: "\\> не цитата"))
    }

    /// Маркеры — те же, что ставит поле ввода (`ComposerList`): «- », «• », «N. ».
    func testListsFromComposerMarkers() {
        XCTAssertEqual(
            MessageTextBlocks.parse("Купить:\n- хлеб\n• **молоко**\n\n1. раз\n12. два"),
            [
                .text("Купить:"),
                .list([Item(marker: "•", text: "хлеб"), Item(marker: "•", text: "**молоко**")]),
                .list([Item(marker: "1.", text: "раз"), Item(marker: "12.", text: "два")]),
            ]
        )
    }

    /// Пустые строки внутри абзаца сохраняются, вокруг блока — нет.
    func testParagraphKeepsInnerBlankLines() {
        XCTAssertEqual(
            MessageTextBlocks.parse("а\n\nб\n\n> ц\n\nв"),
            [.text("а\n\nб"), .quote("ц"), .text("в")]
        )
    }

    /// `\r\n` и `U+2028` — тоже переводы строки: цитата после них узнаётся.
    func testForeignLineBreaks() {
        XCTAssertEqual(MessageTextBlocks.parse("а\r\n> б"), [.text("а"), .quote("б")])
        XCTAssertTrue(MessageTextBlocks.mayHaveBlocks("а\u{2028}> б"))
    }

    /// Цитата в конце не несёт время в последней строке, список — несёт.
    func testCarriesMeta() {
        XCTAssertFalse(MessageTextBlocks.carriesMeta("текст\n> цитата"))
        XCTAssertTrue(MessageTextBlocks.carriesMeta("> цитата\nответ"))
        XCTAssertTrue(MessageTextBlocks.carriesMeta("- пункт"))
        XCTAssertTrue(MessageTextBlocks.carriesMeta("обычный текст"))
    }

    /// Превью снимает знаки цитаты и рисует пункт маркером — тем же разбором.
    func testPreviewUsesSameParser() {
        XCTAssertEqual(MessagePreview.text("> **цитата**\n- пункт"), "цитата • пункт")
    }
}
