import GRDB
import XCTest

@testable import StudentHub

/// Целостность синхронизации переписки (IOS_RULES 9.3, 9.5): позиция догона, поздние
/// ответы, переполнение.
final class ChatSyncIntegrityTests: XCTestCase {
    // MARK: - Правило позиции

    func testPositionAdvancesOnlyByContinuousPiece() {
        XCTAssertEqual(SyncPosition.step(from: 5, seqs: [6]), .advance(to: 6))
        XCTAssertEqual(SyncPosition.step(from: 5, seqs: [5]), .stay)
        XCTAssertEqual(SyncPosition.step(from: 5, seqs: [3]), .stay)
        XCTAssertEqual(SyncPosition.step(from: 5, seqs: [8]), .gap)
        XCTAssertEqual(SyncPosition.step(from: 5, seqs: []), .stay)
        // Страница, перекрывающая позицию, продолжает её до своего верха.
        XCTAssertEqual(SyncPosition.step(from: 5, seqs: [4, 5, 6, 7]), .advance(to: 7))
        XCTAssertEqual(SyncPosition.step(from: 5, seqs: [7, 8, 9]), .gap)
    }

    /// Ни разу не сверенный чат начинает позицию с последней страницы, но не с одиночного
    /// сообщения сокета: старее страницы — история, а не пропуск.
    func testUnsyncedChatStartsOnlyFromHeadPage() {
        XCTAssertEqual(SyncPosition.step(from: 0, seqs: [51, 100], isHead: true), .advance(to: 100))
        XCTAssertEqual(SyncPosition.step(from: 0, seqs: [100]), .gap)
        XCTAssertEqual(SyncPosition.step(from: 0, seqs: [1]), .advance(to: 1))
        // Сверенный чат и с последней страницы через разрыв не перескакивает.
        XCTAssertEqual(SyncPosition.step(from: 10, seqs: [51, 100], isHead: true), .gap)
    }

    // MARK: - Хранилище

    func testHistoryPageMovesPositionOnlyWhenContinuous() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database, syncSeq: 2)
        let store = MessageStore(database: database)

        try await store.save(messages: [dto(id: "m-6", seq: 6), dto(id: "m-7", seq: 7)], chatID: "c-1", isHead: true)
        var chat = try await read(database)
        XCTAssertEqual(chat?.syncSeq, 2)
        XCTAssertEqual(chat?.lastSeq, 7)

        try await store.save(messages: [dto(id: "m-3", seq: 3), dto(id: "m-4", seq: 4)], chatID: "c-1")
        chat = try await read(database)
        XCTAssertEqual(chat?.syncSeq, 4)
    }

    /// Первая сверка с последней страницы ставит и отметку времени — по часам сервера.
    func testHeadPageOfUnsyncedChatSetsServerMark() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database, syncSeq: 0)
        let store = MessageStore(database: database)

        try await store.save(messages: [dto(id: "m-9", seq: 9, at: 1_800_000_900)], chatID: "c-1", isHead: true)

        let chat = try await read(database)
        XCTAssertEqual(chat?.syncSeq, 9)
        XCTAssertEqual(chat?.syncedAt, Date(timeIntervalSince1970: 1_800_000_900))
    }

    /// Догон ставит позицию на `latestSeq`, а отметку — на серверный `syncedAt`.
    func testCatchUpTakesPositionAndMarkFromResponse() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database, syncSeq: 2)
        let store = MessageStore(database: database)
        let syncedAt = Date(timeIntervalSince1970: 1_800_001_000)

        try await store.apply(
            ChatUpdatesDTO(
                created: [dto(id: "m-3", seq: 3)], mutated: [], deletedIds: [], latestSeq: 4,
                overflow: false, syncedAt: syncedAt
            ),
            chatID: "c-1"
        )

        let mark = try await store.catchUpMark(chatID: "c-1")
        XCTAssertEqual(mark.since, 4)
        XCTAssertEqual(mark.sinceTs, syncedAt)
    }

    /// Без серверной отметки — время самого свежего подтверждённого, а не своего
    /// неотправленного с часами телефона.
    func testMarkFallsBackToNewestConfirmedMessage() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database, syncSeq: 1)
        let store = MessageStore(database: database)
        try await store.save(messages: [dto(id: "m-1", seq: 1, at: 1_800_000_100)], chatID: "c-1")
        try await database.writer.write { db in
            try self.pending(id: "local-1", at: 1_900_000_000).insert(db)
        }

        let mark = try await store.catchUpMark(chatID: "c-1")
        XCTAssertEqual(mark.sinceTs, Date(timeIntervalSince1970: 1_800_000_100))
    }

    /// Переполнение: скачанная страница одной транзакцией заменяет отправленную историю;
    /// неотправленное остаётся, позиция — на верх страницы.
    func testResetHistoryReplacesSentKeepsPending() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database, syncSeq: 1)
        let store = MessageStore(database: database)
        try await store.save(messages: [dto(id: "m-1", seq: 1)], chatID: "c-1")
        try await database.writer.write { db in
            try self.pending(id: "local-1", at: 1_800_000_000).insert(db)
        }

        try await store.resetHistory(
            with: [dto(id: "m-400", seq: 400), dto(id: "m-401", seq: 401)],
            chatID: "c-1",
            latestSeq: 401,
            syncedAt: Date(timeIntervalSince1970: 1_800_002_000)
        )

        try await database.reader.read { db in
            XCTAssertNil(try MessageRecord.fetchOne(db, key: "m-1"))
            XCTAssertNotNil(try MessageRecord.fetchOne(db, key: "m-401"))
            XCTAssertNotNil(try MessageRecord.fetchOne(db, key: "local-1"))
            let chat = try ChatRecord.fetchOne(db, key: "c-1")
            XCTAssertEqual(chat?.syncSeq, 401)
            XCTAssertEqual(chat?.syncedAt, Date(timeIntervalSince1970: 1_800_002_000))
        }
    }

    // MARK: - Помощники

    private func seedChat(in database: AppDatabase, syncSeq: Int) async throws {
        try await database.writer.write { db in
            try ChatRecord(
                id: "c-1", type: ChatKind.group.rawValue, title: "Чат", avatarUrl: nil,
                chatDescription: nil, subject: nil, memberCount: 2, unreadCount: 0, muted: false,
                mutedImportantOnly: false, pinnedAt: nil, archivedAt: nil, requestIncoming: false,
                requestOutgoing: false, othersReadAt: nil, lastMessageId: nil, lastSeq: syncSeq,
                updatedAt: Date(timeIntervalSince1970: 1_800_000_000), syncSeq: syncSeq
            ).insert(db)
        }
    }

    private func read(_ database: AppDatabase) async throws -> ChatRecord? {
        try await database.reader.read { db in try ChatRecord.fetchOne(db, key: "c-1") }
    }

    func dto(
        id: String,
        seq: Int,
        content: String = "текст",
        at time: TimeInterval = 1_800_000_000,
        editedAt: Date? = nil,
        deletedAt: Date? = nil
    ) -> ChatMessageDTO {
        ChatMessageDTO(
            id: id, chatId: "c-1", seq: seq, senderId: "u-1", content: content,
            replyToId: nil, replyQuote: nil, systemType: nil, editedAt: editedAt, deletedAt: deletedAt,
            pinnedAt: nil, createdAt: Date(timeIntervalSince1970: time), media: nil
        )
    }

    private func pending(id: String, at time: TimeInterval) -> MessageRecord {
        MessageRecord(
            id: id, remoteId: nil, chatId: "c-1", seq: nil, senderId: "u-me", content: "неотправленное",
            replyToId: nil, replyQuote: nil, systemType: nil, editedAt: nil, deletedAt: nil,
            pinnedAt: nil, createdAt: Date(timeIntervalSince1970: time), sendState: .pending
        )
    }
}
