import SwiftUI
import XCTest

@testable import StudentHub

/// Новые виды сообщений и операции переписки: разбор ответа сервера (контракт
/// docs/PROJECT.md, раздел чатов), подсветка поиска, итог пересылки.
final class ChatTelegramFeaturesTests: XCTestCase {
    // MARK: Контракт

    func testMessageWithLocationContactChecklistAndStickerDecodes() throws {
        let json = Data(
            """
            {"id":"m-1","chatId":"c-1","seq":7,"senderId":"u-1","content":"","replyToId":null,
             "replyQuote":null,"systemType":null,"editedAt":null,"deletedAt":null,"pinnedAt":null,
             "createdAt":"2026-11-12T08:00:00.000Z","media":[],
             "location":{"lat":43.2389,"lng":76.8897,"title":"КазНУ","address":"аль-Фараби, 71"},
             "contact":{"name":"Айгерим","phones":["+7 701 000 00 00"],"emails":[],"userId":null},
             "checklist":{"id":"cl-1","title":"Практика","othersCanAdd":true,"othersCanMark":false,
               "items":[{"id":"i-1","text":"Паспорт","order":0,"done":true,"doneAt":"2026-11-12T09:00:00.000Z",
                 "doneBy":{"id":"u-2","firstName":"Ерлан","lastName":"Ахметов"}},
                 {"id":"i-2","text":"Направление","order":1,"done":false,"doneAt":null,"doneBy":null}]},
             "sticker":{"id":"s-1","setId":"set-1","emoji":"🎓","width":512,"height":512},
             "poll":{"id":"p-1","question":"Когда?","description":"Выберите день","multiple":false,
               "anonymous":true,"allowRevote":true,"closed":false,"options":[{"id":"o-1","text":"Пн","order":0}]}}
            """.utf8
        )

        let message = try JSONCoding.decoder.decode(ChatMessageDTO.self, from: json)
        let extras = message.extras

        XCTAssertEqual(extras.location?.title, "КазНУ")
        XCTAssertEqual(extras.location?.lat ?? 0, 43.2389, accuracy: 0.0001)
        XCTAssertEqual(extras.contact?.phones, ["+7 701 000 00 00"])
        XCTAssertEqual(extras.checklist?.items.filter(\.done).count, 1)
        XCTAssertEqual(extras.checklist?.items.first?.doneBy?.name, "Ахметов Ерлан")
        XCTAssertEqual(extras.checklist?.othersCanMark, false)
        XCTAssertEqual(extras.sticker?.emoji, "🎓")
        XCTAssertEqual(extras.poll?.description, "Выберите день")
    }

    /// Старое сообщение из базы (без новых полей) читается как раньше: обновление
    /// приложения не должно ломать сохранённую переписку.
    func testOldStoredExtrasStillDecode() throws {
        let json = Data(#"{"reactions":[],"isForwarded":false}"#.utf8)
        let extras = try JSONDecoder().decode(MessageExtras.self, from: json)
        XCTAssertNil(extras.location)
        XCTAssertNil(extras.checklist)
        XCTAssertNil(extras.sticker)
    }

    func testForwardResultDecodesPartialFailure() throws {
        let json = Data(
            """
            {"results":[{"chatId":"c-1","ok":true,"messageIds":["n-1","n-2"]},
                        {"chatId":"c-2","ok":false,"messageIds":[],"code":"FORBIDDEN"}]}
            """.utf8
        )
        let result = try JSONCoding.decoder.decode(ForwardResultDTO.self, from: json)
        XCTAssertEqual(result.results.filter(\.ok).map(\.chatId), ["c-1"])
        XCTAssertEqual(result.results.last?.code, "FORBIDDEN")
    }

    func testStickerSetsDecode() throws {
        let json = Data(
            """
            [{"id":"set-1","title":"Студенты","slug":"students",
              "stickers":[{"id":"s-1","emoji":"🎓","width":512,"height":512,
                "url":"https://files.example/s-1.webp?sig=1","expiresAt":"2026-11-12T08:15:00.000Z"}]}]
            """.utf8
        )
        let sets = try JSONCoding.decoder.decode([StickerSetDTO].self, from: json)
        XCTAssertEqual(sets.first?.stickers.first?.emoji, "🎓")
        XCTAssertNotNil(sets.first?.stickers.first?.expiresAt)
    }

    func testMediaKindsMatchServerValues() {
        XCTAssertEqual(ChatMediaKind.voiceNote.rawValue, "voice_note")
        XCTAssertEqual(ChatMediaKind.music.rawValue, "music")
        XCTAssertEqual(ChatMediaKind.gif.rawValue, "gif")
        XCTAssertEqual(ChatMediaKindTab.voice.kind, .voiceNote)
        XCTAssertNil(ChatMediaKindTab.polls.kind)
    }

    // MARK: Пересылка

    func testForwardOutcomeCompleteness() {
        XCTAssertTrue(ForwardOutcome(delivered: ["c-1"]).isComplete)
        XCTAssertFalse(ForwardOutcome(delivered: ["c-1"], failed: ["c-2"]).isComplete)
        XCTAssertFalse(ForwardOutcome(failure: "Нет сети").isComplete)
        XCTAssertFalse(ForwardOutcome().isComplete)
    }

    // MARK: Поиск

    /// Совпадения подсвечиваются без учёта регистра и «ё/е», все, а не только первое.
    func testSearchHighlightMarksEveryMatch() {
        var text = AttributedString("Ёлка и ёлочка, ЕЛКА")
        SearchHighlight.apply("елк", to: &text, background: .yellow)
        let highlighted = text.runs.filter { $0.backgroundColor != nil }.map { String(text[$0.range].characters) }
        XCTAssertEqual(highlighted, ["Ёлк", "ЕЛК"])
    }

    func testSearchHighlightIgnoresOneLetter() {
        var text = AttributedString("а б в")
        SearchHighlight.apply("а", to: &text, background: .yellow)
        XCTAssertTrue(text.runs.allSatisfy { $0.backgroundColor == nil })
    }

    // MARK: Голосовые

    func testEnvelopeResamplesToWidth() {
        XCTAssertEqual(VoiceEnvelopeView.resample([0, 1, 0, 1], count: 2), [0.5, 0.5])
        XCTAssertEqual(VoiceEnvelopeView.resample([1], count: 3), [1, 1, 1])
        XCTAssertEqual(VoiceEnvelopeView.resample([], count: 2), [0.1, 0.1])
    }

    func testRecordingClockShowsHundredths() {
        XCTAssertEqual(VoiceRecordingStrip.clock(7.42), "0:07,42")
        XCTAssertEqual(VoiceRecordingStrip.clock(65), "1:05,00")
    }
}
