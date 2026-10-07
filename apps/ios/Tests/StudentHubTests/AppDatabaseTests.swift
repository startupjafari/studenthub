import GRDB
import XCTest

@testable import StudentHub

final class AppDatabaseTests: XCTestCase {
    func testMigrationCreatesSchema() throws {
        let database = try AppDatabase.inMemory()

        try database.reader.read { db in
            XCTAssertTrue(try db.tableExists(ChatRecord.databaseTableName))
            XCTAssertTrue(try db.tableExists(MessageRecord.databaseTableName))
            XCTAssertTrue(try db.tableExists(DraftRecord.databaseTableName))
        }
    }

    /// Мигратор переживает повторный запуск на уже мигрированной базе — иначе второй
    /// запуск приложения падал бы на старте.
    func testMigratorIsIdempotent() throws {
        let queue = try DatabaseQueue()
        _ = try AppDatabase(queue)

        XCTAssertNoThrow(try AppDatabase(queue))
    }

    func testChatAndMessageRoundTrip() throws {
        let database = try AppDatabase.inMemory()
        let chat = makeChat(id: "c-1", title: "Группа ИС-21")
        let message = makeMessage(id: "m-1", chatId: "c-1", seq: 1, content: "Привет")

        try database.writer.write { db in
            try chat.insert(db)
            try message.insert(db)
        }

        try database.reader.read { db in
            XCTAssertEqual(try ChatRecord.fetchOne(db, key: "c-1"), chat)
            XCTAssertEqual(try MessageRecord.fetchOne(db, key: "m-1"), message)
        }
    }

    /// Удаление чата уносит его переписку и черновик: оставлять сироты в базе,
    /// которую никто не чистит, — верный способ однажды показать их на экране.
    func testDeletingChatRemovesItsMessagesAndDraft() throws {
        let database = try AppDatabase.inMemory()

        try database.writer.write { db in
            try makeChat(id: "c-1").insert(db)
            try makeMessage(id: "m-1", chatId: "c-1", seq: 1).insert(db)
            try DraftRecord(
                chatId: "c-1",
                text: "недописанное",
                replyToId: nil,
                updatedAt: Date(),
                isSynced: false
            ).insert(db)
            _ = try ChatRecord.deleteOne(db, key: "c-1")
        }

        try database.reader.read { db in
            XCTAssertEqual(try MessageRecord.fetchCount(db), 0)
            XCTAssertEqual(try DraftRecord.fetchCount(db), 0)
        }
    }

    /// Номер сообщения уникален в пределах чата — то же правило, что на сервере.
    func testDuplicateSeqInOneChatIsRejected() throws {
        let database = try AppDatabase.inMemory()

        try database.writer.write { db in
            try makeChat(id: "c-1").insert(db)
            try makeMessage(id: "m-1", chatId: "c-1", seq: 7).insert(db)
        }

        XCTAssertThrowsError(
            try database.writer.write { db in
                try makeMessage(id: "m-2", chatId: "c-1", seq: 7).insert(db)
            }
        )
    }

    /// А вот неотправленных без номера в чате может быть сколько угодно: номер
    /// выдаёт сервер, и до ответа его просто нет.
    func testSeveralPendingMessagesWithoutSeqCoexist() throws {
        let database = try AppDatabase.inMemory()

        try database.writer.write { db in
            try makeChat(id: "c-1").insert(db)
            try makeMessage(id: "local-1", chatId: "c-1", seq: nil, state: .pending).insert(db)
            try makeMessage(id: "local-2", chatId: "c-1", seq: nil, state: .pending).insert(db)
        }

        let pending = try database.reader.read { db in
            try MessageRecord
                .filter(MessageRecord.Columns.sendState != MessageSendState.sent.rawValue)
                .fetchCount(db)
        }
        XCTAssertEqual(pending, 2)
    }

    /// Черновик ровно один на чат: повторное сохранение переписывает прежний текст,
    /// а не плодит строки.
    func testDraftIsOnePerChat() throws {
        let database = try AppDatabase.inMemory()

        try database.writer.write { db in
            try makeChat(id: "c-1").insert(db)
            try DraftRecord(
                chatId: "c-1", text: "первый", replyToId: nil, updatedAt: Date(), isSynced: false
            ).insert(db)
            try DraftRecord(
                chatId: "c-1", text: "второй", replyToId: nil, updatedAt: Date(), isSynced: false
            ).upsert(db)
        }

        try database.reader.read { db in
            XCTAssertEqual(try DraftRecord.fetchCount(db), 1)
            XCTAssertEqual(try DraftRecord.fetchOne(db, key: "c-1")?.text, "второй")
        }
    }

    /// Тип чата, которого в этой сборке ещё нет, не должен ронять разбор списка.
    func testUnknownChatTypeIsTolerated() throws {
        let database = try AppDatabase.inMemory()
        var chat = makeChat(id: "c-1")
        chat.type = "BROADCAST_FROM_THE_FUTURE"

        try database.writer.write { db in try chat.insert(db) }

        let stored = try database.reader.read { db in try ChatRecord.fetchOne(db, key: "c-1") }
        XCTAssertEqual(stored?.kind, .unknown)
    }

    // MARK: - Помощники

    private func makeChat(id: String, title: String? = nil) -> ChatRecord {
        ChatRecord(
            id: id,
            type: ChatKind.group.rawValue,
            title: title,
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
        )
    }

    private func makeMessage(
        id: String,
        chatId: String,
        seq: Int?,
        content: String = "текст",
        state: MessageSendState = .sent
    ) -> MessageRecord {
        MessageRecord(
            id: id,
            remoteId: state == .sent ? id : nil,
            chatId: chatId,
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
            sendState: state
        )
    }
}
