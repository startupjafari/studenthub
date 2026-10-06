import GRDB
import XCTest

@testable import StudentHub

final class ChatListQueryTests: XCTestCase {
    /// Закреплённые сверху, остальные по свежести — тот же порядок, что в вебе.
    func testPinnedChatsComeFirst() throws {
        let database = try seeded()

        let rows = try database.reader.read { db in
            try ChatListQuery.rows(for: .all).fetchAll(db)
        }

        XCTAssertEqual(rows.map(\.id), ["c-pinned", "c-fresh", "c-old"])
    }

    /// Архив и непринятые запросы — отдельные вкладки, в общем списке их нет: иначе
    /// человек отвечает незнакомцу, думая, что это обычный чат.
    func testArchiveAndRequestsAreOutOfTheMainList() throws {
        let database = try seeded()

        try database.reader.read { db in
            let all = try ChatListQuery.rows(for: .all).fetchAll(db).map(\.id)
            XCTAssertFalse(all.contains("c-archived"))
            XCTAssertFalse(all.contains("c-request"))

            XCTAssertEqual(try ChatListQuery.rows(for: .archive).fetchAll(db).map(\.id), ["c-archived"])
            XCTAssertEqual(try ChatListQuery.rows(for: .requests).fetchAll(db).map(\.id), ["c-request"])
        }
    }

    func testFolderShowsOnlyItsChats() throws {
        let database = try seeded()
        try database.writer.write { db in
            try FolderRecord(id: "f-1", name: "Учёба", position: 0).insert(db)
            try FolderChatRecord(folderId: "f-1", chatId: "c-old").insert(db)
        }

        let rows = try database.reader.read { db in
            try ChatListQuery.rows(for: .folder(id: "f-1", name: "Учёба")).fetchAll(db)
        }

        XCTAssertEqual(rows.map(\.id), ["c-old"])
    }

    /// Черновик показывается вместо превью: он важнее чужого последнего сообщения.
    func testDraftWinsOverLastMessage() throws {
        let database = try seeded()
        try database.writer.write { db in
            try DraftRecord(
                chatId: "c-fresh", text: "недописанное", replyToId: nil, updatedAt: Date(), isSynced: false
            ).insert(db)
        }

        let row = try database.reader.read { db in
            try ChatListQuery.rows(for: .all).fetchAll(db).first { $0.id == "c-fresh" }
        }

        XCTAssertEqual(row?.preview, "недописанное")
    }

    /// Удалённое сообщение не показывается в превью: в ленте на его месте тоже
    /// пусто, и строка списка не должна противоречить самому чату.
    func testDeletedMessageIsNotPreviewed() throws {
        let database = try AppDatabase.inMemory()
        try database.writer.write { db in
            try chat(id: "c-1").insert(db)
            try message(id: "m-1", chatId: "c-1", seq: 1, deletedAt: Date()).insert(db)
            try db.execute(sql: "UPDATE chat SET lastMessageId = 'm-1' WHERE id = 'c-1'")
        }

        let row = try database.reader.read { db in
            try ChatListQuery.rows(for: .all).fetchOne(db)
        }

        XCTAssertNil(row?.preview)
    }

    /// Пустые вкладки не показываем: «Архив» без архива занимает место и ничего не
    /// сообщает.
    func testTabsAppearOnlyWhenTheyHaveContent() throws {
        let empty = try AppDatabase.inMemory()
        XCTAssertEqual(try empty.reader.read { db in try ChatListQuery.tabs(in: db) }, [.all])

        let database = try seeded()
        try database.writer.write { db in
            try FolderRecord(id: "f-1", name: "Учёба", position: 0).insert(db)
        }

        let tabs = try database.reader.read { db in try ChatListQuery.tabs(in: db) }
        XCTAssertEqual(tabs, [.all, .folder(id: "f-1", name: "Учёба"), .requests, .archive])
    }

    // MARK: - Помощники

    private func seeded() throws -> AppDatabase {
        let database = try AppDatabase.inMemory()
        try database.writer.write { db in
            try chat(id: "c-old", updatedAt: 1_800_000_000).insert(db)
            try chat(id: "c-fresh", updatedAt: 1_800_001_000).insert(db)
            try chat(id: "c-pinned", updatedAt: 1_700_000_000, pinnedAt: Date()).insert(db)
            try chat(id: "c-archived", updatedAt: 1_800_002_000, archivedAt: Date()).insert(db)
            try chat(id: "c-request", updatedAt: 1_800_003_000, requestIncoming: true).insert(db)
        }
        return database
    }

    private func chat(
        id: String,
        updatedAt: TimeInterval = 1_800_000_000,
        pinnedAt: Date? = nil,
        archivedAt: Date? = nil,
        requestIncoming: Bool = false
    ) -> ChatRecord {
        ChatRecord(
            id: id,
            type: ChatKind.group.rawValue,
            title: id,
            avatarUrl: nil,
            chatDescription: nil,
            subject: nil,
            memberCount: 2,
            unreadCount: 0,
            muted: false,
            mutedImportantOnly: false,
            pinnedAt: pinnedAt,
            archivedAt: archivedAt,
            requestIncoming: requestIncoming,
            requestOutgoing: false,
            othersReadAt: nil,
            lastMessageId: nil,
            lastSeq: 0,
            updatedAt: Date(timeIntervalSince1970: updatedAt)
        )
    }

    private func message(id: String, chatId: String, seq: Int, deletedAt: Date? = nil) -> MessageRecord {
        MessageRecord(
            id: id,
            remoteId: id,
            chatId: chatId,
            seq: seq,
            senderId: "u-1",
            content: "текст",
            replyToId: nil,
            replyQuote: nil,
            systemType: nil,
            editedAt: nil,
            deletedAt: deletedAt,
            pinnedAt: nil,
            createdAt: Date(timeIntervalSince1970: 1_800_000_000),
            sendState: .sent
        )
    }
}
