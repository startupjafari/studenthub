import GRDB
import XCTest

@testable import StudentHub

final class MessageStoreTests: XCTestCase {
    func testHistoryPageIsStoredAndLastSeqLifted() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database)
        let store = MessageStore(database: database)

        try await store.save(messages: [dto(id: "m-1", seq: 1), dto(id: "m-2", seq: 2)], chatID: "c-1")

        try await database.reader.read { db in
            XCTAssertEqual(try MessageRecord.fetchCount(db), 2)
            XCTAssertEqual(try ChatRecord.fetchOne(db, key: "c-1")?.lastSeq, 2)
        }
    }

    /// Удаление приходит отдельным списком и ставит метку, а не стирает строку:
    /// в ленте на этом месте остаётся «сообщение удалено», и соседи не прыгают.
    func testUpdatesMarkDeletionInsteadOfErasing() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database)
        let store = MessageStore(database: database)
        try await store.save(messages: [dto(id: "m-1", seq: 1)], chatID: "c-1")

        try await store.apply(
            ChatUpdatesDTO(created: [], mutated: [], deletedIds: ["m-1"], latestSeq: 1, overflow: false),
            chatID: "c-1"
        )

        let stored = try await database.reader.read { db in try MessageRecord.fetchOne(db, key: "m-1") }
        XCTAssertNotNil(stored)
        XCTAssertNotNil(stored?.deletedAt)
    }

    /// Правка известного сообщения меняет текст, а не создаёт второе.
    func testMutationUpdatesExistingRow() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database)
        let store = MessageStore(database: database)
        try await store.save(messages: [dto(id: "m-1", seq: 1, content: "было")], chatID: "c-1")

        try await store.apply(
            ChatUpdatesDTO(
                created: [],
                mutated: [dto(id: "m-1", seq: 1, content: "стало")],
                deletedIds: [],
                latestSeq: 1,
                overflow: false
            ),
            chatID: "c-1"
        )

        try await database.reader.read { db in
            XCTAssertEqual(try MessageRecord.fetchCount(db), 1)
            XCTAssertEqual(try MessageRecord.fetchOne(db, key: "m-1")?.content, "стало")
        }
    }

    /// Разрыв больше серверного лимита склеивать нечем: подтверждённую историю
    /// сбрасываем, а неотправленное своё остаётся — его человек ещё не видел ушедшим.
    func testClearHistoryKeepsPendingMessages() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database)
        let store = MessageStore(database: database)
        try await store.save(messages: [dto(id: "m-1", seq: 1)], chatID: "c-1")
        try await database.writer.write { db in
            try pending(id: "local-1").insert(db)
        }

        try await store.clearHistory(chatID: "c-1")

        try await database.reader.read { db in
            XCTAssertNil(try MessageRecord.fetchOne(db, key: "m-1"))
            XCTAssertNotNil(try MessageRecord.fetchOne(db, key: "local-1"))
            XCTAssertEqual(try ChatRecord.fetchOne(db, key: "c-1")?.lastSeq, 0)
        }
    }

    // MARK: - Помощники

    private func seedChat(in database: AppDatabase) async throws {
        try await database.writer.write { db in
            try ChatRecord(
                id: "c-1",
                type: ChatKind.group.rawValue,
                title: "Чат",
                avatarUrl: nil,
                chatDescription: nil,
                subject: nil,
                memberCount: 2,
                unreadCount: 0,
                muted: false,
                mutedImportantOnly: false,
                pinnedAt: nil,
                archivedAt: nil,
                requestIncoming: false,
                requestOutgoing: false,
                othersReadAt: nil,
                lastMessageId: nil,
                lastSeq: 0,
                updatedAt: Date(timeIntervalSince1970: 1_800_000_000)
            ).insert(db)
        }
    }

    private func dto(id: String, seq: Int, content: String = "текст") -> ChatMessageDTO {
        ChatMessageDTO(
            id: id,
            chatId: "c-1",
            seq: seq,
            senderId: "u-1",
            content: content,
            replyToId: nil,
            replyQuote: nil,
            systemType: nil,
            editedAt: nil,
            deletedAt: nil,
            pinnedAt: nil,
            createdAt: Date(timeIntervalSince1970: 1_800_000_000),
            media: nil
        )
    }

    private func pending(id: String) -> MessageRecord {
        MessageRecord(
            id: id,
            remoteId: nil,
            chatId: "c-1",
            seq: nil,
            senderId: "u-me",
            content: "неотправленное",
            replyToId: nil,
            replyQuote: nil,
            systemType: nil,
            editedAt: nil,
            deletedAt: nil,
            pinnedAt: nil,
            createdAt: Date(),
            sendState: .pending
        )
    }
}

final class MessageOutboxTests: XCTestCase {
    /// Сообщение видно мгновенно, а подтверждение лишь меняет состояние строки:
    /// в этом и смысл оптимистичной вставки.
    func testSentMessageAppearsImmediatelyAndGetsConfirmed() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database)
        let api = StubSender()
        api.answer = ChatMessageDTO(
            id: "server-1",
            chatId: "c-1",
            seq: 7,
            senderId: "u-me",
            content: "привет",
            replyToId: nil,
            replyQuote: nil,
            systemType: nil,
            editedAt: nil,
            deletedAt: nil,
            pinnedAt: nil,
            createdAt: Date(timeIntervalSince1970: 1_800_000_100),
            media: nil
        )
        let outbox = MessageOutbox(database: database, api: api)

        let delivered = await outbox.send(text: "привет", chatID: "c-1", senderID: "u-me", replyToID: nil)

        XCTAssertTrue(delivered)
        let stored = try await database.reader.read { db in try MessageRecord.fetchAll(db) }
        XCTAssertEqual(stored.count, 1)
        XCTAssertEqual(stored.first?.remoteId, "server-1")
        XCTAssertEqual(stored.first?.seq, 7)
        XCTAssertEqual(stored.first?.sendState, .sent)
    }

    /// Сеть отказала — текст остаётся в ленте со своим состоянием, а не исчезает.
    func testFailedSendStaysInTheThread() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database)
        let api = StubSender()
        api.failure = .transport(URLError(.notConnectedToInternet))
        let outbox = MessageOutbox(database: database, api: api)

        let delivered = await outbox.send(text: "привет", chatID: "c-1", senderID: "u-me", replyToID: nil)

        XCTAssertFalse(delivered)
        let stored = try await database.reader.read { db in try MessageRecord.fetchOne(db) }
        XCTAssertEqual(stored?.sendState, .failed)
        XCTAssertNil(stored?.remoteId)
    }

    /// Очередь — это сами сообщения в базе, поэтому она переживает перезапуск и
    /// досылается в порядке написания.
    func testFlushResendsStuckMessagesInOrder() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database)
        let api = StubSender()
        api.failure = .transport(URLError(.notConnectedToInternet))
        let outbox = MessageOutbox(database: database, api: api)
        await outbox.send(text: "первое", chatID: "c-1", senderID: "u-me", replyToID: nil)
        await outbox.send(text: "второе", chatID: "c-1", senderID: "u-me", replyToID: nil)

        api.failure = nil
        api.answer = ChatMessageDTO(
            id: "server-1", chatId: "c-1", seq: 1, senderId: "u-me", content: "первое",
            replyToId: nil, replyQuote: nil, systemType: nil, editedAt: nil, deletedAt: nil,
            pinnedAt: nil, createdAt: Date(),
            media: nil
        )
        await outbox.flush(chatID: "c-1")

        XCTAssertEqual(api.sent, ["первое", "второе"])
    }

    private func seedChat(in database: AppDatabase) async throws {
        try await database.writer.write { db in
            try ChatRecord(
                id: "c-1", type: ChatKind.private.rawValue, title: "Чат", avatarUrl: nil,
                chatDescription: nil, subject: nil, memberCount: 2, unreadCount: 0, muted: false,
                mutedImportantOnly: false, pinnedAt: nil, archivedAt: nil, requestIncoming: false,
                requestOutgoing: false, othersReadAt: nil, lastMessageId: nil, lastSeq: 0,
                updatedAt: Date(timeIntervalSince1970: 1_800_000_000)
            ).insert(db)
        }
    }
}

private final class StubSender: ChatMessageSending, @unchecked Sendable {
    private let lock = NSLock()
    var answer: ChatMessageDTO?
    var failure: APIError?
    private(set) var sent: [String] = []

    func send(text: String, chatID: String, replyToID: String?) async throws -> ChatMessageDTO {
        let outcome: (APIError?, ChatMessageDTO?) = lock.withLock {
            sent.append(text)
            return (failure, answer)
        }
        if let error = outcome.0 { throw error }
        guard let answer = outcome.1 else { throw APIError.malformedResponse(statusCode: 0) }
        return answer
    }
}
