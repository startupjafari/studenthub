import UIKit
import UniformTypeIdentifiers
import XCTest

@testable import StudentHub

/// «Копировать» сообщение (IOS_RULES 7.7.8): видимый текст без разметки, исходник —
/// своим типом для нашего поля ввода.
final class MessageClipboardTests: XCTestCase {
    /// Видимый текст — то, что нарисовано в пузыре: без `**`, `>` и ```` ``` ````, код —
    /// самим кодом, пункты — с маркером, переводы строк на месте.
    func testVisibleTextDropsMarkup() {
        XCTAssertEqual(
            MessagePreview.visibleText("**Итог:**\n> [сайт](https://example.com)\n- раз\n```swift\nlet a = 1\n```"),
            "Итог:\nсайт\n• раз\nlet a = 1"
        )
        XCTAssertEqual(MessagePreview.visibleText("Привет\n\nкак дела"), "Привет\n\nкак дела")
    }

    /// С разметкой — простой текст и исходник своим типом; без неё — только текст.
    func testItemCarriesMarkdownOnlyWhenDifferent() {
        let rich = MessageClipboard.item(markdown: "**жирный**", visible: "жирный")
        XCTAssertEqual(rich[UTType.utf8PlainText.identifier] as? String, "жирный")
        XCTAssertEqual(rich[MessageClipboard.markdownType] as? Data, Data("**жирный**".utf8))

        let plain = MessageClipboard.item(markdown: "просто", visible: "просто")
        XCTAssertNil(plain[MessageClipboard.markdownType])
    }

    /// Буфер отдаёт видимый текст всем, а исходник — нашему полю ввода.
    func testPasteboardRoundTrip() throws {
        let board = try XCTUnwrap(UIPasteboard(name: UIPasteboard.Name("studenthub.tests.clipboard"), create: true))
        defer { UIPasteboard.remove(withName: board.name) }

        MessageClipboard.copy("> **цитата**", to: board)
        XCTAssertEqual(board.string, "цитата")
        XCTAssertEqual(MessageClipboard.markdown(in: board), "> **цитата**")

        board.string = "чужой текст"
        XCTAssertNil(MessageClipboard.markdown(in: board))
    }
}
