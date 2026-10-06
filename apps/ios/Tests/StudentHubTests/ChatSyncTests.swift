import GRDB
import XCTest

@testable import StudentHub

final class ChatDTOTests: XCTestCase {
    /// Ответ сервера шире, чем нужно списку. Разбор обязан это пережить: иначе любое
    /// новое поле на бэкенде роняло бы экран у всех, кто не обновился.
    func testExtraFieldsDoNotBreakDecoding() throws {
        let json = """
            {
              "id": "c-1",
              "type": "GROUP",
              "title": "ИС-21",
              "memberCount": 24,
              "unread": true,
              "unreadCount": 3,
              "muted": false,
              "isOwner": false,
              "blocked": false,
              "online": true,
              "updatedAt": "2026-10-06T10:00:00.000Z",
              "lastMessage": {
                "id": "m-9",
                "chatId": "c-1",
                "seq": 42,
                "senderId": "u-7",
                "content": "Завтра в 10",
                "createdAt": "2026-10-06T09:59:00.000Z",
                "sender": { "id": "u-7", "firstName": "Алия" },
                "media": []
              }
            }
            """

        let item = try JSONCoding.decoder.decode(ChatListItemDTO.self, from: Data(json.utf8))

        XCTAssertEqual(item.id, "c-1")
        XCTAssertEqual(item.unreadCount, 3)
        XCTAssertEqual(item.lastMessage?.seq, 42)
        XCTAssertEqual(item.lastMessage?.content, "Завтра в 10")
    }
}

final class ChatStoreTests: XCTestCase {
    func testPageIsStoredWithItsPreviewMessage() async throws {
        let database = try AppDatabase.inMemory()
        let store = ChatStore(database: database)

        try await store.save(chats: [item(id: "c-1", title: "ИС-21", seq: 5, text: "Привет")])

        try await database.reader.read { db in
            let chat = try ChatRecord.fetchOne(db, key: "c-1")
            XCTAssertEqual(chat?.title, "ИС-21")
            XCTAssertEqual(chat?.lastSeq, 5)
            XCTAssertEqual(chat?.lastMessageId, "m-5")
            // Превью — обычное сообщение: когда чат откроют, строка просто обновится.
            XCTAssertEqual(try MessageRecord.fetchOne(db, key: "m-5")?.content, "Привет")
        }
    }

    /// Позиция догона только растёт: страница списка может приехать с отставанием от
    /// сокета, и откат номера означал бы перекачку переписки.
    func testLastSeqNeverGoesBackwards() async throws {
        let database = try AppDatabase.inMemory()
        let store = ChatStore(database: database)

        try await store.save(chats: [item(id: "c-1", seq: 10, text: "свежее")])
        try await store.save(chats: [item(id: "c-1", seq: 4, text: "отставшее")])

        let seq = try await database.reader.read { db in try ChatRecord.fetchOne(db, key: "c-1")?.lastSeq }
        XCTAssertEqual(seq, 10)
    }

    /// Местный неотправленный черновик — всегда свежее серверного: человек печатает
    /// быстрее, чем уходит запрос.
    func testUnsyncedLocalDraftSurvivesServerAnswer() async throws {
        let database = try AppDatabase.inMemory()
        let store = ChatStore(database: database)
        try await store.save(chats: [item(id: "c-1")])
        try await database.writer.write { db in
            try DraftRecord(
                chatId: "c-1", text: "моё", replyToId: nil, updatedAt: Date(), isSynced: false
            ).upsert(db)
        }

        try await store.save(chats: [item(id: "c-1", draft: "серверное")])

        let draft = try await database.reader.read { db in try DraftRecord.fetchOne(db, key: "c-1") }
        XCTAssertEqual(draft?.text, "моё")
    }

    func testServerDraftIsMirroredWhenNoLocalOne() async throws {
        let database = try AppDatabase.inMemory()
        let store = ChatStore(database: database)

        try await store.save(chats: [item(id: "c-1", draft: "с другого устройства")])

        let draft = try await database.reader.read { db in try DraftRecord.fetchOne(db, key: "c-1") }
        XCTAssertEqual(draft?.text, "с другого устройства")
        XCTAssertEqual(draft?.isSynced, true)
    }

    /// Папки приходят целиком, поэтому и заменяются целиком: удалённая иначе осталась
    /// бы вкладкой навсегда.
    func testFoldersAreReplacedWholesale() async throws {
        let database = try AppDatabase.inMemory()
        let store = ChatStore(database: database)

        try await store.save(folders: [
            ChatFolderDTO(id: "f-1", name: "Учёба", position: 0, chatIds: ["c-1", "c-2"]),
            ChatFolderDTO(id: "f-2", name: "Личное", position: 1, chatIds: []),
        ])
        try await store.save(folders: [
            ChatFolderDTO(id: "f-1", name: "Учёба", position: 0, chatIds: ["c-9"])
        ])

        try await database.reader.read { db in
            XCTAssertEqual(try FolderRecord.fetchCount(db), 1)
            let items = try FolderChatRecord.fetchAll(db)
            XCTAssertEqual(items.map(\.chatId), ["c-9"])
        }
    }

    // MARK: - Помощники

    private func item(
        id: String,
        title: String? = "Чат",
        seq: Int? = 1,
        text: String = "текст",
        draft: String? = nil,
        pinnedAt: Date? = nil,
        archived: Bool = false,
        requestIncoming: Bool = false
    ) -> ChatListItemDTO {
        ChatListItemDTO(
            id: id,
            type: ChatKind.group.rawValue,
            title: title,
            avatarUrl: nil,
            description: nil,
            subject: nil,
            memberCount: 2,
            unreadCount: 0,
            muted: false,
            mutedImportantOnly: false,
            draft: draft,
            pinnedAt: pinnedAt,
            archived: archived,
            othersReadAt: nil,
            requestIncoming: requestIncoming,
            requestOutgoing: false,
            lastMessage: seq.map { seq in
                ChatMessageDTO(
                    id: "m-\(seq)",
                    chatId: id,
                    seq: seq,
                    senderId: "u-1",
                    content: text,
                    replyToId: nil,
                    replyQuote: nil,
                    systemType: nil,
                    editedAt: nil,
                    deletedAt: nil,
                    pinnedAt: nil,
                    createdAt: Date(timeIntervalSince1970: 1_800_000_000),
                    media: nil
                )
            },
            updatedAt: Date(timeIntervalSince1970: 1_800_000_000)
        )
    }
}
