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

    /// Переполнение (9.3.13): история не стирается. Страница ложится поверх, пропавшее в её
    /// диапазоне и выше помечено удалённым, ниже — «несверенное» с границей на низе
    /// страницы; неотправленное не тронуто, позиция — на верх страницы.
    func testOverflowKeepsHistoryAndMarksItUnsynced() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database, syncSeq: 1)
        let store = MessageStore(database: database)
        try await store.save(messages: [1, 2, 3, 402].map { dto(id: "m-\($0)", seq: $0) }, chatID: "c-1")
        try await database.writer.write { db in
            try self.pending(id: "local-1", at: 1_800_000_000).insert(db)
        }
        let mark = try await store.reconcileMark()

        try await store.resetAfterOverflow(
            with: [dto(id: "m-400", seq: 400), dto(id: "m-401", seq: 401)],
            chatID: "c-1",
            latestSeq: 402,
            syncedAt: Date(timeIntervalSince1970: 1_800_002_000),
            reachedStart: false,
            reconcilingUpTo: mark
        )

        let deleted = try await deletedFlags(database)
        XCTAssertEqual(deleted["m-1"], false, "ниже страницы — не стёрто и не помечено")
        XCTAssertEqual(deleted["m-3"], false)
        XCTAssertEqual(deleted["m-401"], false)
        XCTAssertEqual(deleted["m-402"], true, "выше низа страницы и нет в ней — удалено")
        XCTAssertEqual(deleted["local-1"], false)
        let chat = try await read(database)
        XCTAssertEqual(chat?.syncSeq, 402)
        XCTAssertEqual(chat?.unsyncedBelow, 400)
        XCTAssertEqual(chat?.syncedAt, Date(timeIntervalSince1970: 1_800_002_000))
        let boundary = try await store.unsyncedBoundary(chatID: "c-1")
        XCTAssertEqual(boundary?.seq, 400)
        XCTAssertEqual(boundary?.cursor, "m-400")
    }

    /// Страница под границей сверяет весь промежуток до границы (не только свой min…max),
    /// граница опускается до её низа, а на начале переписки снимается.
    func testRevalidationSweepsDownToBoundaryAndClearsAtStart() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database, syncSeq: 1)
        let store = MessageStore(database: database)
        try await store.save(messages: [1, 2, 3, 5, 399].map { dto(id: "m-\($0)", seq: $0) }, chatID: "c-1")
        var mark = try await store.reconcileMark()
        try await store.resetAfterOverflow(
            with: [dto(id: "m-400", seq: 400)], chatID: "c-1", latestSeq: 400, syncedAt: nil,
            reachedStart: false, reconcilingUpTo: mark
        )

        mark = try await store.reconcileMark()
        try await store.revalidate(
            page: [dto(id: "m-2", seq: 2), dto(id: "m-3", seq: 3)],
            chatID: "c-1", below: 400, reachedStart: false, reconcilingUpTo: mark
        )
        var deleted = try await deletedFlags(database)
        XCTAssertEqual(deleted["m-5"], true)
        XCTAssertEqual(deleted["m-399"], true, "между верхом страницы и границей — тоже сверено")
        XCTAssertEqual(deleted["m-3"], false)
        XCTAssertEqual(deleted["m-1"], false, "ниже страницы — ещё не сверено")
        var chat = try await read(database)
        XCTAssertEqual(chat?.unsyncedBelow, 2)

        mark = try await store.reconcileMark()
        try await store.revalidate(page: [], chatID: "c-1", below: 2, reachedStart: true, reconcilingUpTo: mark)
        deleted = try await deletedFlags(database)
        XCTAssertEqual(deleted["m-1"], true)
        chat = try await read(database)
        XCTAssertNil(chat?.unsyncedBelow)
        let boundary = try await store.unsyncedBoundary(chatID: "c-1")
        XCTAssertNil(boundary)
    }

    /// Ответ сверки, пришедший после нового переполнения, чужую границу не двигает.
    func testRevalidationKeepsNewerBoundary() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database, syncSeq: 1)
        let store = MessageStore(database: database)
        let mark = try await store.reconcileMark()
        try await store.resetAfterOverflow(
            with: [dto(id: "m-900", seq: 900)], chatID: "c-1", latestSeq: 900, syncedAt: nil,
            reachedStart: false, reconcilingUpTo: mark
        )

        try await store.revalidate(page: [], chatID: "c-1", below: 400, reachedStart: true, reconcilingUpTo: mark)

        let chat = try await read(database)
        XCTAssertEqual(chat?.unsyncedBelow, 900)
    }

    /// Явная очистка истории сервером по-прежнему стирает и снимает границу.
    func testServerClearStillErasesHistory() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database, syncSeq: 1)
        let store = MessageStore(database: database)
        try await store.save(messages: [dto(id: "m-1", seq: 1)], chatID: "c-1")
        let mark = try await store.reconcileMark()
        try await store.resetAfterOverflow(
            with: [dto(id: "m-400", seq: 400)], chatID: "c-1", latestSeq: 400, syncedAt: nil,
            reachedStart: false, reconcilingUpTo: mark
        )

        try await store.clearHistory(chatID: "c-1")

        let count = try await database.reader.read { db in try MessageRecord.fetchCount(db) }
        XCTAssertEqual(count, 0)
        let chat = try await read(database)
        XCTAssertNil(chat?.unsyncedBelow)
    }

    // MARK: - Поздний ответ

    /// Страница, ушедшая до `message:deleted`, не возвращает удалённое (IOS_RULES 9.5.2).
    func testLateAnswerDoesNotResurrectDeleted() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database, syncSeq: 1)
        let store = MessageStore(database: database)
        try await store.save(messages: [dto(id: "m-1", seq: 1)], chatID: "c-1")
        try await database.writer.write { db in
            try db.execute(sql: "UPDATE message SET deletedAt = ? WHERE id = 'm-1'", arguments: [Date()])
        }

        try await store.save(messages: [dto(id: "m-1", seq: 1)], chatID: "c-1")

        let stored = try await database.reader.read { db in try MessageRecord.fetchOne(db, key: "m-1") }
        XCTAssertNotNil(stored?.deletedAt)
    }

    /// Ответ со старой правкой (или без неё) не откатывает свежую (IOS_RULES 9.5.1), а
    /// более новая — применяется.
    func testLateAnswerDoesNotRollBackEdit() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database, syncSeq: 1)
        let store = MessageStore(database: database)
        let edited = Date(timeIntervalSince1970: 1_800_000_500)
        try await store.save(messages: [dto(id: "m-1", seq: 1, content: "новое", editedAt: edited)], chatID: "c-1")

        try await store.save(messages: [dto(id: "m-1", seq: 1, content: "старое")], chatID: "c-1")
        try await store.save(
            messages: [dto(id: "m-1", seq: 1, content: "раньше", editedAt: edited.addingTimeInterval(-60))],
            chatID: "c-1"
        )
        var stored = try await database.reader.read { db in try MessageRecord.fetchOne(db, key: "m-1") }
        XCTAssertEqual(stored?.content, "новое")
        XCTAssertEqual(stored?.editedAt, edited)

        try await store.save(
            messages: [dto(id: "m-1", seq: 1, content: "свежее", editedAt: edited.addingTimeInterval(60))],
            chatID: "c-1"
        )
        stored = try await database.reader.read { db in try MessageRecord.fetchOne(db, key: "m-1") }
        XCTAssertEqual(stored?.content, "свежее")
    }

    // MARK: - Прочтение по видимому

    /// Строка под шапкой и за полем ввода не видна; краешек — тоже.
    func testLowestVisibleRespectsBand() {
        let frames = [
            ReadVisibility.Frame(id: "a", minY: 0, maxY: 100),
            ReadVisibility.Frame(id: "b", minY: 100, maxY: 300),
            ReadVisibility.Frame(id: "c", minY: 300, maxY: 400),
            ReadVisibility.Frame(id: "d", minY: 400, maxY: 500),
        ]
        // Полоса 120…410: «d» торчит на 10 pt — не в счёт.
        XCTAssertEqual(ReadVisibility.lowestVisible(frames, band: 120...410), "c")
        XCTAssertEqual(ReadVisibility.lowestVisible(frames, band: 120...500), "d")
        XCTAssertNil(ReadVisibility.lowestVisible([], band: 0...100))
    }

    /// Отметка — последнее чужое подтверждённое не ниже видимого; своё и неотправленное
    /// не в счёт.
    func testReadMarkStopsAtLowestVisible() {
        let rows = [
            row(id: "m-1", sender: "u-1"),
            row(id: "m-2", sender: "u-me"),
            row(id: "m-3", sender: "u-1"),
            row(id: "local", sender: "u-me", remote: false),
        ]
        XCTAssertEqual(ReadVisibility.readMark(in: rows, lowestVisible: "m-2", viewerID: "u-me"), "m-1")
        XCTAssertEqual(ReadVisibility.readMark(in: rows, lowestVisible: "local", viewerID: "u-me"), "m-3")
        XCTAssertNil(ReadVisibility.readMark(in: rows, lowestVisible: nil, viewerID: "u-me"))
        XCTAssertNil(ReadVisibility.readMark(in: rows, lowestVisible: "нет", viewerID: "u-me"))
    }

    // MARK: - Сверка страницы (9.3.12)

    /// Сообщение с номером внутри страницы, которого в ней нет, удалено на сервере —
    /// помечается мягко. Вне диапазона страницы и пришедшее во время запроса не трогается.
    func testPageReconcilesOnlyCoveredRangeAndRowsKnownBeforeRequest() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database, syncSeq: 0)
        let store = MessageStore(database: database)
        try await store.save(
            messages: [2, 3, 4, 5, 9].map { dto(id: "m-\($0)", seq: $0) },
            chatID: "c-1"
        )
        let mark = try await store.reconcileMark()
        // Пока страница в пути, сокет принёс m-6: его в ответе нет, но сверке он не по зубам.
        try await store.save(messages: [dto(id: "m-6", seq: 6)], chatID: "c-1")

        try await store.save(
            messages: [dto(id: "m-3", seq: 3), dto(id: "m-7", seq: 7)],
            chatID: "c-1",
            reconcilingUpTo: mark
        )

        let rows = try await database.reader.read { db in
            try MessageRecord.fetchAll(db).reduce(into: [String: Bool]()) { $0[$1.id] = $1.deletedAt != nil }
        }
        XCTAssertEqual(rows["m-2"], false, "ниже страницы — не покрыто")
        XCTAssertEqual(rows["m-3"], false)
        XCTAssertEqual(rows["m-4"], true)
        XCTAssertEqual(rows["m-5"], true)
        XCTAssertEqual(rows["m-6"], false, "пришло во время запроса")
        XCTAssertEqual(rows["m-7"], false)
        XCTAssertEqual(rows["m-9"], false, "выше страницы — не покрыто")
    }

    /// Неотправленное и своё подтверждённое (локальный ключ) сверка не трогает.
    func testPageReconcileSkipsOwnRows() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database, syncSeq: 0)
        try await database.writer.write { [self] db in
            try pending(id: "local-1", at: 1_800_000_000).insert(db)
            var own = pending(id: "local-2", at: 1_800_000_000)
            own.remoteId = "srv-own"
            own.seq = 4
            own.sendState = .sent
            try own.insert(db)
        }
        let store = MessageStore(database: database)
        let mark = try await store.reconcileMark()

        try await store.save(messages: [dto(id: "m-3", seq: 3), dto(id: "m-5", seq: 5)], chatID: "c-1", reconcilingUpTo: mark)

        let deleted = try await database.reader.read { db in
            try MessageRecord.filter(Column("deletedAt") != nil).fetchCount(db)
        }
        XCTAssertEqual(deleted, 0)
    }

    // MARK: - Живое состояние карточки (9.8.17)

    func testChecklistUpdateIsWrittenIntoStoredMessage() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database, syncSeq: 0)
        let old = MessageExtras.Checklist(id: "cl-1", title: "Покупки", items: [
            .init(id: "i-1", text: "хлеб", done: false),
        ])
        try await database.writer.write { db in
            var row = MessageRecord(
                id: "m-1", remoteId: "m-1", chatId: "c-1", seq: 1, senderId: "u-1", content: "",
                replyToId: nil, replyQuote: nil, systemType: nil, editedAt: nil, deletedAt: nil,
                pinnedAt: nil, createdAt: Date(timeIntervalSince1970: 1_800_000_000), sendState: .sent
            )
            var extras = MessageExtras()
            extras.checklist = old
            row.extras = extras
            try row.insert(db)
        }
        let fresh = MessageExtras.Checklist(id: "cl-1", title: "Покупки", items: [
            .init(id: "i-1", text: "хлеб", done: true),
        ])

        try await MessageStore(database: database).save(checklist: fresh, chatID: "c-1")

        let stored = try await database.reader.read { db in try MessageRecord.fetchOne(db, key: "m-1") }
        XCTAssertEqual(stored?.extras?.checklist, fresh)
    }

    // MARK: - Помощники

    private func row(id: String, sender: String, remote: Bool = true) -> MessageRecord {
        MessageRecord(
            id: id, remoteId: remote ? id : nil, chatId: "c-1", seq: nil, senderId: sender, content: "текст",
            replyToId: nil, replyQuote: nil, systemType: nil, editedAt: nil, deletedAt: nil,
            pinnedAt: nil, createdAt: Date(timeIntervalSince1970: 1_800_000_000), sendState: remote ? .sent : .pending
        )
    }

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

    private func deletedFlags(_ database: AppDatabase) async throws -> [String: Bool] {
        try await database.reader.read { db in
            try MessageRecord.fetchAll(db).reduce(into: [String: Bool]()) { $0[$1.id] = $1.deletedAt != nil }
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
