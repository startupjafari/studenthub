import SwiftUI
import XCTest

@testable import StudentHub

/// Новые виды сообщений и операции переписки: разбор ответа сервера (контракт
/// docs/PROJECT.md, раздел чатов), подсветка поиска, итог пересылки.
final class ChatTelegramFeaturesTests: XCTestCase {
    // MARK: Контракт

    func testMessageWithLocationContactAndChecklistDecodes() throws {
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
        XCTAssertEqual(extras.poll?.description, "Выберите день")
    }

    /// Старое сообщение из базы (без новых полей) читается как раньше: обновление
    /// приложения не должно ломать сохранённую переписку.
    func testOldStoredExtrasStillDecode() throws {
        let json = Data(#"{"reactions":[],"isForwarded":false}"#.utf8)
        let extras = try JSONDecoder().decode(MessageExtras.self, from: json)
        XCTAssertNil(extras.location)
        XCTAssertNil(extras.checklist)
    }

    /// Стикеры убраны, а в базе остались сообщения-стикеры прошлых версий: лишнее поле
    /// не ломает разбор, сообщение остаётся без известного содержимого (заглушка).
    func testStoredStickerExtrasStillDecode() throws {
        let json = Data(#"{"reactions":[],"isForwarded":false,"sticker":{"id":"s-1","emoji":"🎓"}}"#.utf8)
        let extras = try JSONDecoder().decode(MessageExtras.self, from: json)
        XCTAssertFalse(extras.hasKnownContent)
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

    func testMediaKindsMatchServerValues() {
        XCTAssertEqual(ChatMediaKind.voiceNote.rawValue, "voice_note")
        XCTAssertEqual(ChatMediaKind.music.rawValue, "music")
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

    // MARK: Живая геопозиция

    func testLiveLocationState() throws {
        let now = Date()
        let live = MessageExtras.Location(lat: 1, lng: 2, liveUntil: now.addingTimeInterval(600), liveUpdatedAt: now)
        XCTAssertTrue(live.isLive(at: now))
        XCTAssertFalse(live.isLive(at: now.addingTimeInterval(601)))
        XCTAssertFalse(MessageExtras.Location(lat: 1, lng: 2).isLive(at: now))

        let caption = LocationMessageView.caption(
            until: now.addingTimeInterval(600), updated: now.addingTimeInterval(-180), now: now
        )
        XCTAssertTrue(caption.contains("3"), caption)
    }

    func testLiveLocationDecodes() throws {
        let json = Data(
            #"{"lat":43.2,"lng":76.9,"title":null,"address":null,"liveUntil":"2026-11-12T10:00:00.000Z","liveUpdatedAt":"2026-11-12T09:55:00.000Z","heading":90,"accuracy":12.5}"#.utf8
        )
        let location = try JSONCoding.decoder.decode(MessageExtras.Location.self, from: json)
        XCTAssertNotNil(location.liveUntil)
        XCTAssertEqual(location.accuracy, 12.5)
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
