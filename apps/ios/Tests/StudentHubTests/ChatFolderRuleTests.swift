import GRDB
import XCTest

@testable import StudentHub

/// Правило состава папки (§C контракта «чаты как Telegram») и порядок закреплённых —
/// то, что клиент обязан считать так же, как сервер: иначе вкладка, её счётчик и «Выкл.
/// уведомления» разойдутся с тем, что сервер считает папкой.
final class ChatFolderRuleTests: XCTestCase {
    // MARK: - Состав папки

    /// «Контакты» — личные чаты с друзьями, «Не контакты» — остальные личные.
    func testContactsAndNonContactsSplitPrivateChatsByFriendship() throws {
        let database = try seeded()
        try addFolder("f-contacts", contacts: true, in: database)
        try addFolder("f-strangers", nonContacts: true, in: database)

        XCTAssertEqual(try ids(in: "f-contacts", database), ["p-friend"])
        XCTAssertEqual(try ids(in: "f-strangers", database), ["p-stranger"])
    }

    /// «Группы» берут все групповые типы, но не «Избранное» и не поддержку: те попадают
    /// в папку только явным выбором.
    func testGroupsFlagTakesGroupTypesButNotSavedOrSupport() throws {
        let database = try seeded()
        try addFolder("f-groups", groups: true, in: database)

        XCTAssertEqual(try ids(in: "f-groups", database), ["g-group", "g-subject"])

        try addFolder("f-explicit", chats: ["saved", "support"], in: database)
        XCTAssertEqual(try ids(in: "f-explicit", database), ["saved", "support"])
    }

    /// Исключение сильнее и типа, и явного выбора.
    func testExcludedChatLosesToNothing() throws {
        let database = try seeded()
        try addFolder("f-1", chats: ["g-group"], groups: true, excluded: ["g-group", "g-subject"], in: database)

        XCTAssertEqual(try ids(in: "f-1", database), [])
    }

    /// Счётчик вкладки — непрочитанные чаты папки: со звуком отдельно от заглушённых,
    /// пометка «как новое» считается непрочитанным.
    func testFolderBadgeCountsUnreadAndMarkedChats() throws {
        let database = try seeded()
        try database.writer.write { db in
            try db.execute(sql: "UPDATE chat SET unreadCount = 3 WHERE id = 'g-group'")
            try db.execute(sql: "UPDATE chat SET markedUnread = 1 WHERE id = 'g-subject'")
            try db.execute(sql: "UPDATE chat SET unreadCount = 1, muted = 1 WHERE id = 'p-friend'")
        }
        try addFolder("f-1", contacts: true, groups: true, color: 2, in: database)

        let summary = try database.reader.read { db in try ChatListQuery.folderSummary(in: db) }

        XCTAssertEqual(summary.badges["f-1"], ChatFolderBadge(unread: 2, mutedUnread: 1, total: 3, muted: 1))
        XCTAssertEqual(summary.tags["g-group"], [ChatFolderTag(folderID: "f-1", name: "f-1", color: 2)])
        XCTAssertNil(summary.tags["p-stranger"])
    }

    // MARK: - Закреплённые

    /// Закреплённые — по ручному месту; у кого места нет, те ниже, свежим закреплением
    /// выше. Дальше — по свежести.
    func testPinnedChatsFollowManualOrderThenPinTime() throws {
        let database = try AppDatabase.inMemory()
        try database.writer.write { db in
            try chat("late-pin", pinnedAt: 300).insert(db)
            try chat("early-pin", pinnedAt: 100).insert(db)
            try chat("second", pinnedAt: 200, pinnedOrder: 1).insert(db)
            try chat("first", pinnedAt: 50, pinnedOrder: 0).insert(db)
            try chat("plain", updatedAt: 1_900_000_000).insert(db)
        }

        let rows = try database.reader.read { db in try ChatListQuery.rows(for: .all).fetchAll(db) }

        XCTAssertEqual(rows.map(\.id), ["first", "second", "late-pin", "early-pin", "plain"])
    }

    /// Перестановка пишет места всем закреплённым: перечисленным — по порядку, прочим —
    /// ниже них. Новое закрепление встаёт на самый верх.
    func testReorderAndNewPinGoOnTop() async throws {
        let database = try AppDatabase.inMemory()
        let records = [chat("a", pinnedAt: 100), chat("b", pinnedAt: 200), chat("c", pinnedAt: 300), chat("d")]
        try await database.writer.write { db in
            for record in records { try record.insert(db) }
        }
        let store = ChatStore(database: database)

        try await store.setPinnedOrder(["a", "c"])
        var order = try await database.reader.read { db in try ChatListQuery.pinnedChatIDs(in: db) }
        XCTAssertEqual(order, ["a", "c", "b"])

        try await store.setPinned(true, chatID: "d")
        order = try await database.reader.read { db in try ChatListQuery.pinnedChatIDs(in: db) }
        XCTAssertEqual(order, ["d", "a", "c", "b"])
    }

    /// «Прочитать» гасит и счётчик, и пометку; откат возвращает обоих.
    func testMarkReadClearsCounterAndMarkAndRestores() async throws {
        let database = try AppDatabase.inMemory()
        var unread = chat("u")
        unread.unreadCount = 4
        var marked = chat("m")
        marked.markedUnread = true
        let records = [unread, marked]
        try await database.writer.write { db in
            for record in records { try record.insert(db) }
        }
        let store = ChatStore(database: database)

        let previous = try await store.markRead(chatIDs: ["u", "m"])
        let unreadTab = try await database.reader.read { db in try ChatListQuery.rows(for: .unread).fetchAll(db) }
        XCTAssertTrue(unreadTab.isEmpty)

        try await store.restore(previous)
        let restored = try await database.reader.read { db in try ChatListQuery.rows(for: .unread).fetchAll(db) }
        XCTAssertEqual(Set(restored.map(\.id)), ["u", "m"])
        XCTAssertEqual(restored.first { $0.id == "m" }?.isUnread, true)
    }

    /// Старый сервер новых полей папки не присылает — папка остаётся прежней.
    func testFolderDecodesWithoutNewFields() throws {
        let json = #"{"id":"f","name":"Учёба","position":0,"chatIds":["c"],"color":42}"#
        let folder = try JSONDecoder().decode(ChatFolderDTO.self, from: Data(json.utf8))

        XCTAssertEqual(folder.chatIds, ["c"])
        XCTAssertEqual(folder.excludedChatIds, [])
        XCTAssertNil(folder.color, "цвет вне палитры — без цвета")
        XCTAssertFalse(folder.includesTypes)
    }

    // MARK: - Помощники

    private func seeded() throws -> AppDatabase {
        let database = try AppDatabase.inMemory()
        try database.writer.write { db in
            try chat("p-friend", type: "PRIVATE", isFriend: true, updatedAt: 1_800_000_006).insert(db)
            try chat("p-stranger", type: "PRIVATE", updatedAt: 1_800_000_005).insert(db)
            try chat("g-group", type: "GROUP", updatedAt: 1_800_000_004).insert(db)
            try chat("g-subject", type: "SUBJECT", updatedAt: 1_800_000_003).insert(db)
            try chat("saved", type: "SAVED", updatedAt: 1_800_000_002).insert(db)
            try chat("support", type: "SUPPORT", updatedAt: 1_800_000_001).insert(db)
        }
        return database
    }

    private func addFolder(
        _ id: String,
        chats: [String] = [],
        contacts: Bool = false,
        nonContacts: Bool = false,
        groups: Bool = false,
        excluded: [String] = [],
        color: Int? = nil,
        in database: AppDatabase
    ) throws {
        try database.writer.write { db in
            try FolderRecord(
                id: id, name: id, position: 0, color: color,
                includeContacts: contacts, includeNonContacts: nonContacts, includeGroups: groups
            ).insert(db)
            for chat in chats { try FolderChatRecord(folderId: id, chatId: chat).insert(db) }
            for chat in excluded { try FolderExcludedChatRecord(folderId: id, chatId: chat).insert(db) }
        }
    }

    private func ids(in folderID: String, _ database: AppDatabase) throws -> [String] {
        try database.reader.read { db in
            try ChatListQuery.rows(for: .folder(id: folderID, name: folderID)).fetchAll(db).map(\.id)
        }
    }

    private func chat(
        _ id: String,
        type: String = "GROUP",
        isFriend: Bool = false,
        updatedAt: TimeInterval = 1_800_000_000,
        pinnedAt: TimeInterval? = nil,
        pinnedOrder: Int? = nil
    ) -> ChatRecord {
        ChatRecord(
            id: id,
            type: type,
            title: id,
            avatarUrl: nil,
            chatDescription: nil,
            subject: nil,
            memberCount: 2,
            unreadCount: 0,
            muted: false,
            mutedImportantOnly: false,
            pinnedAt: pinnedAt.map { Date(timeIntervalSince1970: $0) },
            archivedAt: nil,
            requestIncoming: false,
            requestOutgoing: false,
            othersReadAt: nil,
            lastMessageId: nil,
            lastSeq: 0,
            updatedAt: Date(timeIntervalSince1970: updatedAt),
            pinnedOrder: pinnedOrder,
            isFriend: isFriend
        )
    }
}
