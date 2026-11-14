import XCTest

@testable import StudentHub

/// Разбор блоков кода в тексте сообщения (```` ``` ````), как в Telegram.
final class MessageCodeBlocksTests: XCTestCase {
    private typealias Segment = MessageCodeBlocks.Segment

    /// Текст без тройной кавычки идёт прежним путём: разбора нет вовсе.
    func testPlainTextHasNoSegments() {
        XCTAssertNil(MessageCodeBlocks.segments(ifAny: "Просто текст с `инлайн-кодом`"))
    }

    /// Язык на первой строке — подпись блока, а не часть кода.
    func testFenceWithLanguage() {
        let segments = MessageCodeBlocks.parse("Смотри:\n```swift\nlet a = 1\nprint(a)\n```\nГотово")
        XCTAssertEqual(segments, [
            .text("Смотри:"),
            .code(language: "swift", code: "let a = 1\nprint(a)"),
            .text("Готово"),
        ])
    }

    /// Без языка: перенос сразу после ```` ``` ```` отбрасывается, код начинается со
    /// следующей строки.
    func testFenceWithoutLanguage() {
        XCTAssertEqual(
            MessageCodeBlocks.parse("```\nIP: 109.235.119.227\nПароль: x\n```"),
            [.code(language: nil, code: "IP: 109.235.119.227\nПароль: x")]
        )
    }

    /// Однострочный блок: язык не выделяется, весь текст — код.
    func testInlineFence() {
        XCTAssertEqual(MessageCodeBlocks.parse("```ls -la```"), [.code(language: nil, code: "ls -la")])
    }

    /// Первая строка из нескольких слов — это код, а не язык.
    func testFirstLineWithSpacesIsCode() {
        XCTAssertEqual(
            MessageCodeBlocks.parse("```print(1) + 2\nfoo\n```"),
            [.code(language: nil, code: "print(1) + 2\nfoo")]
        )
    }

    /// Незакрытая тройная кавычка — обычный текст.
    func testUnclosedFenceStaysText() {
        XCTAssertNil(MessageCodeBlocks.segments(ifAny: "Начало ```swift\nlet a = 1"))
        XCTAssertEqual(MessageCodeBlocks.parse("a ```b"), [.text("a ```b")])
    }

    /// Пустой блок плашкой не рисуется.
    func testEmptyFenceStaysText() {
        XCTAssertNil(MessageCodeBlocks.segments(ifAny: "до ``````  после"))
    }

    /// Несколько блоков подряд и язык с символами (`c++`, `objective-c`).
    func testSeveralBlocks() {
        let segments = MessageCodeBlocks.parse("```c++\nint a;\n```\n```objective-c\n@end\n```")
        XCTAssertEqual(segments, [
            .code(language: "c++", code: "int a;"),
            .code(language: "objective-c", code: "@end"),
        ])
        XCTAssertEqual(MessageCodeBlocks.segments(ifAny: "```c++\nint a;\n```\n```objective-c\n@end\n```"), segments)
    }

    /// Пробелы в начале строк кода — часть кода (отступы), их не съедает разбор.
    func testIndentationIsKept() {
        XCTAssertEqual(
            MessageCodeBlocks.parse("```py\ndef f():\n    return 1\n```"),
            [.code(language: "py", code: "def f():\n    return 1")]
        )
    }
}
