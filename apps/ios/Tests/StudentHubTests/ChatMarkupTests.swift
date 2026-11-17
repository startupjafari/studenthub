import SwiftUI
import XCTest

@testable import StudentHub

/// Подчёркнутый `++…++` и спойлер `||…||` (PROJECT.md §3.6) — те же правила, что у веба
/// (`apps/web/src/shared/lib/chat-markup.test.ts`) и Android (`ChatMarkupTest.kt`).
final class ChatMarkupTests: XCTestCase {
    private func show(_ text: String) -> String {
        ChatMarkup.replace(text) { kind, inner in
            kind == .spoiler ? "[S:\(inner)]" : "[U:\(inner)]"
        }
    }

    func testPairs() {
        XCTAssertEqual(show("a ++b++ c"), "a [U:b] c")
        XCTAssertEqual(show("a ||b c|| d"), "a [S:b c] d")
        XCTAssertEqual(show("||**ж** ++п++||"), "[S:**ж** [U:п]]")
        XCTAssertEqual(show("(||ответ||)."), "([S:ответ]).")
    }

    func testCodeAndExpressionsStayText() {
        for text in ["i++; j++", "C++ и C++", "a || b || c", "a||b||c", "x ++ y ++ z", "|||a|||", "++++"] {
            XCTAssertEqual(show(text), text, text)
        }
    }

    func testEscapesInlineCodeAndBlankLine() {
        XCTAssertEqual(show("\\||a||"), "\\||a||")
        XCTAssertEqual(show("`||a||` и ||b||"), "`||a||` и [S:b]")
        XCTAssertEqual(show("||a\n\nb||"), "||a\n\nb||")
        XCTAssertEqual(show("||a\nb||"), "[S:a\nb]")
    }

    func testRewriteEscapesUnbalancedBrackets() {
        XCTAssertEqual(ChatMarkup.rewrite("||a]b||"), "^[a\\]b](spoiler: true)")
        XCTAssertEqual(ChatMarkup.rewrite("||[сайт](https://x.kz)||"), "^[[сайт](https://x.kz)](spoiler: true)")
        XCTAssertNil(ChatMarkup.rewrite("**жирный** без маркеров"))
    }

    func testContainsSpoiler() {
        XCTAssertTrue(ChatMarkup.containsSpoiler("ответ ||42||"))
        XCTAssertFalse(ChatMarkup.containsSpoiler("a || b"))
        XCTAssertFalse(ChatMarkup.containsSpoiler("++только подчёркнутый++"))
    }

    /// Разбор пузыря: маркеры уходят, остаётся текст с атрибутами; старая разметка — как была.
    func testRichTextChatFlavor() {
        let text = RichText.attributed("это ++важно++, ответ ||**42**||", chat: true)
        XCTAssertEqual(String(text.characters), "это важно, ответ 42")
        let spoilers = text.runs[ChatSpoilerAttribute.self].filter { $0.0 == true }
        XCTAssertEqual(spoilers.map { String(text[$0.1].characters) }, ["42"])
        let underlined = text.runs[ChatUnderlineAttribute.self].filter { $0.0 == true }
        XCTAssertEqual(underlined.map { String(text[$0.1].characters) }, ["важно"])
        // Жирный внутри спойлера разобран тем же разборщиком.
        let bold = text.runs.filter { $0.inlinePresentationIntent?.contains(.stronglyEmphasized) == true }
        XCTAssertEqual(bold.map { String(text[$0.range].characters) }, ["42"])
    }

    /// У постов маркеров нет — `++` и `||` остаются буквами.
    func testPostsKeepMarkersAsText() {
        XCTAssertEqual(String(RichText.attributed("||a|| ++b++").characters), "||a|| ++b++")
    }

    func testOldBoldUnderscoreStaysBold() {
        let text = RichText.attributed("__жирный__", chat: true)
        XCTAssertEqual(String(text.characters), "жирный")
        XCTAssertTrue(text.runs.allSatisfy { $0.inlinePresentationIntent?.contains(.stronglyEmphasized) == true })
    }

    /// Скрытый спойлер: текст на месте (раскладка не прыгает), но прозрачный и без ссылки;
    /// VoiceOver читает «скрытый текст».
    func testConcealedSpoiler() {
        let hidden = BubbleTextStyle().attributed("ответ ||[тут](https://x.kz)||")
        XCTAssertEqual(String(hidden.characters), "ответ тут")
        let spoiler = hidden.runs.first { $0[ChatSpoilerAttribute.self] == true }
        XCTAssertNotNil(spoiler)
        XCTAssertNil(spoiler?.link)
        XCTAssertEqual(spoiler?[AttributeScopes.SwiftUIAttributes.ForegroundColorAttribute.self], Color.clear)
        XCTAssertEqual(BubbleTextStyle().spoken(hidden), "ответ " + ChatMarkup.spokenPlaceholder)

        let shown = BubbleTextStyle(revealSpoilers: true).attributed("ответ ||[тут](https://x.kz)||")
        XCTAssertEqual(shown.runs.first { $0[ChatSpoilerAttribute.self] == true }?.link, URL(string: "https://x.kz"))
        XCTAssertEqual(BubbleTextStyle(revealSpoilers: true).spoken(shown), "ответ тут")
    }

    func testPlaceholderLength() {
        XCTAssertEqual(ChatMarkup.placeholder(for: "42"), "⠿⠿")
        XCTAssertEqual(ChatMarkup.placeholder(for: String(repeating: "x", count: 40)), String(repeating: "⠿", count: 12))
    }
}
