import XCTest

@testable import StudentHub

/// Что уйдёт на сервер из поля ввода (IOS_RULES 7.1.6, 7.1.7): ожидания записаны
/// значениями из `messageText()` сервера, а не копией клиентской логики.
final class OutgoingTextTests: XCTestCase {
    /// Сервер снимает U+200B…U+200D, U+2060, U+FEFF и пробелы по краям.
    func testNormalizedMatchesServer() {
        XCTAssertEqual(OutgoingText.normalized("  \u{200B}привет\u{2060} мир\u{FEFF}\n "), "привет мир")
        XCTAssertEqual(OutgoingText.normalized("\u{200D}\u{200C} \n"), "")
    }

    /// Один нормализатор переводов строк: CRLF, CR, U+2028, U+2029, NEL — в `\n`,
    /// заглушка вложения U+FFFC — прочь (IOS_RULES 7.2.2, 7.2.3).
    func testLineBreaksNormalized() {
        XCTAssertEqual(OutgoingText.normalizingLineBreaks("а\r\nб\rв\u{2028}г\u{2029}д\u{85}е"), "а\nб\nв\nг\nд\nе")
        XCTAssertEqual(OutgoingText.normalizingLineBreaks("фото\u{FFFC}\r\n\r\n"), "фото\n\n")
        XCTAssertEqual(OutgoingText.normalized("\u{FFFC} привет\r\nмир "), "привет\nмир")
        XCTAssertNil(OutgoingText.sendable("\u{FFFC}"))
        let plain = "без изменений\n"
        XCTAssertEqual(OutgoingText.normalizingLineBreaks(plain), plain)
    }

    /// Только невидимое и пробелы — отправлять нечего: микрофон, а не «Отправить».
    func testBlankAfterCleaning() {
        XCTAssertTrue(OutgoingText.isBlank(" \u{200B}\n"))
        XCTAssertNil(OutgoingText.sendable(" \u{200B}\n"))
        XCTAssertFalse(OutgoingText.isBlank(" а "))
        XCTAssertEqual(OutgoingText.sendable(" а "), "а")
    }

    /// Длина — в UTF-16, как JS `length`: emoji вне BMP весит две единицы.
    func testLengthCountsUTF16() {
        XCTAssertEqual(OutgoingText.length("😀"), 2)
        XCTAssertEqual(OutgoingText.length(" ab\u{200B} "), 2)
    }

    /// Ровно 4000 после очистки — проходит; на единицу больше — нет, и текст не обрезается.
    func testLimitIsServerLimit() {
        let atLimit = String(repeating: "я", count: 4000)
        XCTAssertEqual(OutgoingText.sendable("  " + atLimit + "\u{200B}"), atLimit)
        XCTAssertEqual(OutgoingText.remaining(atLimit), 0)

        let over = String(repeating: "я", count: 3999) + "😀"
        XCTAssertNil(OutgoingText.sendable(over))
        XCTAssertEqual(OutgoingText.remaining(over), -1)
    }

    /// Счётчик молчит, пока до лимита сотня и больше, — дальше показывает остаток.
    func testCounterAppearsNearLimit() {
        XCTAssertNil(OutgoingText.counter(String(repeating: "a", count: 3900)))
        XCTAssertEqual(OutgoingText.counter(String(repeating: "a", count: 3901)), 99)
        XCTAssertEqual(OutgoingText.counter(String(repeating: "a", count: 4010)), -10)
    }

    /// `SaveDraftSchema` меряет черновик как есть, без очистки.
    func testDraftLimitCountsRawText() {
        XCTAssertTrue(OutgoingText.draftFits(String(repeating: "a", count: 4000)))
        XCTAssertFalse(OutgoingText.draftFits(String(repeating: "a", count: 3999) + "\u{200B}\u{200B}"))
    }
}

/// Правка сообщения не трогает черновик чата (IOS_RULES 9.8.6).
final class ComposerInputTests: XCTestCase {
    func testEditKeepsDraftAndReturnsItAfter() {
        var input = ComposerInput()
        input.text = "неотправленное"

        input.beginEdit("старый текст")
        XCTAssertEqual(input.text, "старый текст")
        input.text = "новый текст"
        XCTAssertEqual(input.draft, "неотправленное")
        // Правка черновиком не сохраняется — ни в базу, ни на сервер.
        XCTAssertNil(input.draftToPersist)

        input.endEdit()
        XCTAssertEqual(input.text, "неотправленное")
        XCTAssertEqual(input.draftToPersist, "неотправленное")
        XCTAssertNil(input.editText)
    }

    func testEmptyDraftStaysEmptyAfterEdit() {
        var input = ComposerInput()
        input.beginEdit("текст")
        input.text = "текст поправленный"
        input.endEdit()
        XCTAssertEqual(input.text, "")
    }
}
