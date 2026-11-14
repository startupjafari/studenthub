import SwiftUI
import XCTest

@testable import StudentHub

/// Вид строки текста в пузыре: в непринятом запросе на переписку ссылки и упоминания —
/// простой текст (IOS_RULES 10.4.12), в обычном чате — как прежде.
final class BubbleTextStyleTests: XCTestCase {
    private let source = "Смотри [сайт](https://example.com), https://example.org и @someone"

    func testRegularChatKeepsLinks() {
        let text = BubbleTextStyle().attributed(source)
        XCTAssertTrue(text.runs.contains { $0.link != nil })
        XCTAssertTrue(text.runs.contains { $0.font != nil })
    }

    func testRequestIncomingMakesLinksPlain() {
        let text = BubbleTextStyle(plainLinks: true).attributed(source)
        XCTAssertFalse(text.runs.contains { $0.link != nil })
        XCTAssertFalse(text.runs.contains { $0.font != nil })
        // Видимый текст тот же: подпись ссылки остаётся, пропадает только переход.
        XCTAssertEqual(String(text.characters), String(BubbleTextStyle().attributed(source).characters))
    }
}
