import XCTest
@testable import ChatLab

/// Логика без UI: строки ленты, серии, раскладка, генератор истории, формулы жестов.
final class ChatRowBuilderTests: XCTestCase {
    private let base = Date(timeIntervalSince1970: 1_790_000_000)

    private func message(_ id: MessageID, _ author: Author, minutes: Double, kind: MessageKind = .text, group: Int64? = nil) -> Message {
        Message(id: id, author: author, date: base.addingTimeInterval(minutes * 60), text: "m\(id)", kind: kind, groupId: group)
    }

    func testNewestRowIsFirstAndDatesInserted() {
        let messages = [
            message(1, .peer, minutes: 0),
            message(2, .me, minutes: 60 * 24 + 5),
        ]
        let rows = ChatRowBuilder.build(messages: messages)
        // Перевёрнутый порядок: [m2, дата2, m1, дата1].
        XCTAssertEqual(rows.count, 4)
        XCTAssertEqual(rows[0].id, .message(2))
        if case .date = rows[1].kind {} else { XCTFail("ожидалась дата над вторым днём") }
        XCTAssertEqual(rows[2].id, .message(1))
        if case .date = rows[3].kind {} else { XCTFail("ожидалась дата над первым днём") }
    }

    func testMergeFlagsWithinTenMinutesSameAuthor() {
        let messages = [
            message(1, .me, minutes: 0),
            message(2, .me, minutes: 2),
            message(3, .me, minutes: 30), // разрыв > 10 мин
            message(4, .peer, minutes: 31),
        ]
        let rows = ChatRowBuilder.build(messages: messages).filter { $0.primary != nil }
        let byId = Dictionary(uniqueKeysWithValues: rows.map { ($0.primary!.id, $0.merge) })
        XCTAssertEqual(byId[1], MergeFlags(top: false, bottom: true))
        XCTAssertEqual(byId[2], MergeFlags(top: true, bottom: false), "серия рвётся через 10 минут — у второго хвост")
        XCTAssertEqual(byId[3], MergeFlags(top: false, bottom: false))
        XCTAssertEqual(byId[4], MergeFlags(top: false, bottom: false), "другой автор — новая серия")
    }

    func testAlbumGroupsIntoOneRow() {
        let photo = MessageKind.photo(MediaRef(file: "p.jpg", width: 100, height: 100))
        let messages = [
            message(1, .me, minutes: 0, kind: photo, group: 7),
            message(2, .me, minutes: 0, kind: photo, group: 7),
            message(3, .me, minutes: 0, kind: photo, group: 7),
            message(4, .me, minutes: 1),
        ]
        let rows = ChatRowBuilder.build(messages: messages).filter { $0.primary != nil }
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows[1].allIds, [1, 2, 3])
        XCTAssertEqual(rows[1].id, .message(1), "идентичность альбома — первое сообщение")
    }

    func testRowIdsStableWhenMessageAppended() {
        let messages = (1...5).map { message(MessageID($0), .peer, minutes: Double($0)) }
        let before = ChatRowBuilder.build(messages: messages).map(\.id)
        let after = ChatRowBuilder.build(messages: messages + [message(6, .me, minutes: 7)]).map(\.id)
        XCTAssertEqual(Array(after.dropFirst()), before, "добавление снизу не меняет идентичность остальных строк")
    }
}

final class MessageLayoutTests: XCTestCase {
    private let width: CGFloat = 393

    private func layout(_ message: Message, merge: MergeFlags = MergeFlags(top: false, bottom: false)) -> MessageLayout {
        var row = ChatRow(id: .message(message.id), kind: .messages([message]))
        row.merge = merge
        return MessageLayoutEngine.layout(row: row, width: width, replyLookup: { _ in nil })
    }

    func testOutgoingBubbleHugsRightEdge() {
        let result = layout(Message(id: 1, author: .me, date: Date(), text: "Привет"))
        XCTAssertEqual(result.style, .bubble)
        XCTAssertEqual(result.bubbleFrame.maxX, width - BubbleMetrics.edgeInset, accuracy: 0.5)
        XCTAssertGreaterThanOrEqual(result.bubbleFrame.height, 33)
    }

    func testIncomingBubbleHugsLeftEdge() {
        let result = layout(Message(id: 1, author: .peer, date: Date(), text: "Привет"))
        XCTAssertEqual(result.bubbleFrame.minX, BubbleMetrics.edgeInset, accuracy: 0.5)
    }

    func testLongTextWrapsWithinMaxWidth() {
        let text = String(repeating: "очень длинное сообщение ", count: 40)
        let result = layout(Message(id: 1, author: .peer, date: Date(), text: text))
        XCTAssertLessThanOrEqual(result.bubbleFrame.width, BubbleMetrics.maxBubbleWidth(width) + 0.5)
        XCTAssertGreaterThan(result.text?.lineCount ?? 0, 5)
        XCTAssertGreaterThan(result.height, 150)
    }

    func testShortTextKeepsTimeOnSameLine() {
        let result = layout(Message(id: 1, author: .me, date: Date(), text: "Ок"))
        // Одна строка текста: время справа на той же строке → пузырь в одну строку.
        XCTAssertLessThan(result.bubbleFrame.height, 40)
        XCTAssertEqual(result.statusPlacement, .inline)
    }

    func testMergedSpacingIsTighter() {
        let message = Message(id: 1, author: .me, date: Date(), text: "Ок")
        let single = layout(message)
        let merged = layout(message, merge: MergeFlags(top: true, bottom: true))
        XCTAssertLessThan(merged.height, single.height)
        XCTAssertFalse(merged.hasTail)
        XCTAssertTrue(single.hasTail)
    }

    func testEmojiOnlyIsFreeform() {
        XCTAssertEqual(MessageLayoutEngine.emojiOnlyCount("🔥🔥"), 2)
        XCTAssertNil(MessageLayoutEngine.emojiOnlyCount("Привет 🔥"))
        XCTAssertNil(MessageLayoutEngine.emojiOnlyCount("1"), "цифра — не эмодзи, хоть и isEmoji")
        let result = layout(Message(id: 1, author: .peer, date: Date(), text: "😂"))
        XCTAssertEqual(result.style, .freeform)
        XCTAssertEqual(result.statusPlacement, .pill)
    }

    func testPhotoWithoutCaptionHasOverlayStatus() {
        let photo = MessageKind.photo(MediaRef(file: "p.jpg", width: 1280, height: 960))
        let result = layout(Message(id: 1, author: .me, date: Date(), text: "", kind: photo))
        XCTAssertEqual(result.content, .media)
        XCTAssertEqual(result.statusPlacement, .overlay)
        XCTAssertLessThanOrEqual(result.contentFrame.width, BubbleMetrics.maxMediaWidth(width))
    }

    func testEditedShowsEditedLabel() {
        var message = Message(id: 1, author: .me, date: Date(), text: "текст")
        message.editedAt = Date()
        XCTAssertTrue(layout(message).statusText.hasPrefix("изменено"))
    }

    func testMosaicFillsWidthForAlbum() {
        let messages = (1...4).map { index in
            Message(id: MessageID(index), author: .me, date: Date(), text: "", kind: .photo(MediaRef(file: "\(index)", width: 1000, height: 800)), groupId: 1)
        }
        let mosaic = MessageLayoutEngine.mosaicLayout(messages: messages, maxWidth: 280)
        XCTAssertEqual(mosaic.tiles.count, 4)
        for tile in mosaic.tiles {
            XCTAssertLessThanOrEqual(tile.maxX, 280.5)
            XCTAssertGreaterThan(tile.width, 40)
        }
        XCTAssertEqual(mosaic.size.width, 280)
    }

    func testLinksDetected() {
        let text = TextLayout.make("Смотри https://example.com/route и пиши", font: Fonts.message, maxWidth: 300)
        XCTAssertEqual(text.links.count, 1)
        XCTAssertEqual(text.links.first?.url.host, "example.com")
    }
}

@MainActor
final class ChatStoreTests: XCTestCase {
    private func makeStore(messages: [Message] = []) -> ChatStore {
        ChatStore(state: ChatState(peer: MockChatService.peer, messages: messages, pinnedIds: [], settings: ChatSettings(), forwardedCounts: [:]))
    }

    override func setUp() {
        super.setUp()
        MockChatService.shared.autoReplies = false
        MockChatService.shared.peerReadsMessages = false
    }

    func testEditKeepsIdAndMarksEdited() {
        let store = makeStore(messages: [Message(id: 1, author: .me, date: Date(), text: "было")])
        var changes: [ChatChange] = []
        let token = store.observe { changes.append($0) }
        store.edit(1, text: "стало")
        XCTAssertEqual(store.message(1)?.text, "стало")
        XCTAssertNotNil(store.message(1)?.editedAt)
        XCTAssertEqual(changes.last?.reason, .edit)
        XCTAssertEqual(changes.last?.updated, [1])
        _ = token
    }

    func testCannotEditIncoming() {
        let store = makeStore(messages: [Message(id: 1, author: .peer, date: Date(), text: "чужое")])
        store.edit(1, text: "моё")
        XCTAssertEqual(store.message(1)?.text, "чужое")
    }

    func testDeleteRemovesAndUnpins() {
        let store = makeStore(messages: (1...3).map { Message(id: MessageID($0), author: .me, date: Date(), text: "\($0)") })
        store.pin(2, notify: false)
        store.delete([2])
        XCTAssertNil(store.message(2))
        XCTAssertFalse(store.isPinned(2))
        XCTAssertEqual(store.messages.map(\.id), [1, 3])
        XCTAssertEqual(store.index(of: 3), 1, "индекс пересобран")
    }

    func testReactionToggleIsSingleChoice() {
        let store = makeStore(messages: [Message(id: 1, author: .peer, date: Date(), text: "x")])
        store.toggleReaction(1, emoji: "👍")
        store.toggleReaction(1, emoji: "❤️")
        XCTAssertEqual(store.message(1)?.reactions.map(\.emoji), ["❤️"], "одна реакция пользователя: новая заменяет старую")
        store.toggleReaction(1, emoji: "❤️")
        XCTAssertEqual(store.message(1)?.reactions.count, 0, "повторное нажатие снимает")
    }

    func testPinAddsServiceMessage() {
        let store = makeStore(messages: [Message(id: 1, author: .peer, date: Date(), text: "Адрес: Абая 10")])
        store.pin(1)
        XCTAssertTrue(store.isPinned(1))
        XCTAssertEqual(store.messages.last?.isService, true)
        XCTAssertTrue(store.messages.last?.text.contains("Адрес") == true)
    }

    func testSendAddsSendingMessageAtEnd() {
        let store = makeStore(messages: [Message(id: 1, author: .peer, date: Date(), text: "x")])
        let sent = store.send(text: "Привет", replyTo: 1)
        XCTAssertEqual(store.messages.last?.id, sent.id)
        XCTAssertEqual(sent.status, .sending)
        XCTAssertEqual(sent.replyTo, 1)
    }

    func testForwardToCurrentChatCreatesForwardedCopy() {
        let store = makeStore(messages: [Message(id: 1, author: .peer, date: Date(), text: "новость")])
        let created = store.forward([1], to: ForwardTarget(id: 777, name: "Алина", subtitle: "", isCurrentChat: true))
        XCTAssertEqual(created.count, 1)
        XCTAssertEqual(created.first?.forward?.authorName, MockChatService.peer.displayName)
        XCTAssertEqual(store.messages.count, 2)
    }

    func testForwardToOtherChatCountsOnly() {
        let store = makeStore(messages: [Message(id: 1, author: .peer, date: Date(), text: "новость")])
        store.forward([1], to: ForwardTarget(id: 5, name: "Мама", subtitle: "", isCurrentChat: false))
        XCTAssertEqual(store.messages.count, 1)
        XCTAssertEqual(store.state.forwardedCounts[5], 1)
    }

    func testSearchNewestFirstCaseInsensitive() {
        let store = makeStore(messages: [
            Message(id: 1, author: .peer, date: Date(), text: "Кофе утром"),
            Message(id: 2, author: .me, date: Date(), text: "без кофе никак"),
            Message(id: 3, author: .me, date: Date(), text: "чай"),
        ])
        XCTAssertEqual(store.search("КОФЕ"), [2, 1])
        XCTAssertEqual(store.search("  "), [])
    }

    func testClearHistory() {
        let store = makeStore(messages: [Message(id: 1, author: .peer, date: Date(), text: "x")])
        store.pin(1, notify: false)
        store.clearHistory()
        XCTAssertTrue(store.messages.isEmpty)
        XCTAssertTrue(store.pinnedIds.isEmpty)
    }

    func testStateRoundTripsThroughJSON() throws {
        let state = MockChatService.initialState(now: Date(timeIntervalSince1970: 1_790_000_000))
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        let decoded = try decoder.decode(ChatState.self, from: encoder.encode(state))
        XCTAssertEqual(decoded.messages, state.messages)
        XCTAssertEqual(decoded.pinnedIds, state.pinnedIds)
    }
}

final class MockHistoryTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_790_000_000)

    func testAtLeast300MessagesAndDeterministic() {
        let first = MockChatService.generateHistory(now: now)
        let second = MockChatService.generateHistory(now: now)
        XCTAssertGreaterThanOrEqual(first.count, 300)
        XCTAssertEqual(first, second, "сброс даёт ту же историю")
    }

    func testHistoryIsChronologicalWithUniqueIdsAndInPast() {
        let messages = MockChatService.generateHistory(now: now)
        XCTAssertEqual(Set(messages.map(\.id)).count, messages.count)
        for (older, newer) in zip(messages, messages.dropFirst()) {
            XCTAssertLessThan(older.date, newer.date)
            XCTAssertLessThan(older.id, newer.id)
        }
        XCTAssertLessThanOrEqual(messages.last!.date, now)
    }

    func testHistoryCoversAllKinds() {
        let messages = MockChatService.generateHistory(now: now)
        func count(_ predicate: (Message) -> Bool) -> Int { messages.filter(predicate).count }
        XCTAssertGreaterThan(count { if case .photo = $0.kind { return true }; return false }, 5)
        XCTAssertGreaterThan(count { if case .voice = $0.kind { return true }; return false }, 2)
        XCTAssertGreaterThan(count { if case .video = $0.kind { return true }; return false }, 0)
        XCTAssertGreaterThan(count { if case .file = $0.kind { return true }; return false }, 0)
        XCTAssertGreaterThan(count { $0.replyTo != nil }, 5)
        XCTAssertGreaterThan(count { !$0.reactions.isEmpty }, 5)
        XCTAssertGreaterThan(count { $0.groupId != nil }, 2, "есть альбомы")
        XCTAssertEqual(count { $0.status == .failed }, 1)
        // Ответы ссылаются только на существующие сообщения.
        let ids = Set(messages.map(\.id))
        for message in messages {
            if let reply = message.replyTo { XCTAssertTrue(ids.contains(reply)) }
        }
    }

    func testInitialStateHasPins() {
        let state = MockChatService.initialState(now: now)
        XCTAssertFalse(state.pinnedIds.isEmpty)
        XCTAssertTrue(state.pinnedIds.allSatisfy { id in state.messages.contains { $0.id == id } })
    }
}

final class GestureMathTests: XCTestCase {
    @MainActor
    func testSwipeToReplyResistance() {
        // До порога — 1:1.
        XCTAssertEqual(ChatViewController.swipeOffset(forTranslation: -30, threshold: 60), 30)
        // Вправо — ноль.
        XCTAssertEqual(ChatViewController.swipeOffset(forTranslation: 40, threshold: 60), 0)
        // После порога — меньше пальца и растёт монотонно.
        let a = ChatViewController.swipeOffset(forTranslation: -100, threshold: 60)
        let b = ChatViewController.swipeOffset(forTranslation: -200, threshold: 60)
        XCTAssertLessThan(a, 100)
        XCTAssertGreaterThan(b, a)
        // Предел — 180 pt.
        XCTAssertLessThanOrEqual(ChatViewController.swipeOffset(forTranslation: -5000, threshold: 60), 180)
    }

    func testBezierCurveEndpointsAndMonotonic() {
        let curve = BezierCurve.telegramSpring
        XCTAssertEqual(curve.value(at: 0), 0)
        XCTAssertEqual(curve.value(at: 1), 1)
        var previous: CGFloat = 0
        for step in 1...20 {
            let value = curve.value(at: CGFloat(step) / 20)
            XCTAssertGreaterThanOrEqual(value, previous - 1e-4)
            previous = value
        }
        // Кривая Telegram быстрая в начале: к середине времени пройдено больше половины.
        XCTAssertGreaterThan(curve.value(at: 0.5), 0.75)
    }

    func testWaveformIsFiveBit() {
        let waveform = MediaCatalog.waveform(seed: "voice_01.m4a", duration: 7)
        XCTAssertEqual(waveform.count, 64)
        XCTAssertTrue(waveform.allSatisfy { $0 <= 31 && $0 >= 1 })
        XCTAssertEqual(waveform, MediaCatalog.waveform(seed: "voice_01.m4a", duration: 7), "детерминированно")
    }
}
