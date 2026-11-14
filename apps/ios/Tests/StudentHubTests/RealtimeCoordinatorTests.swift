import GRDB
import XCTest

@testable import StudentHub

@MainActor
final class RealtimeCoordinatorTests: XCTestCase {
    /// Чужое сообщение в закрытом чате поднимает счётчик и двигает чат в списке.
    func testIncomingMessageUpdatesChatAndCounter() async throws {
        let (database, coordinator, transport) = try await make()

        await transport.emit(.messageNew(message(id: "m-2", seq: 2, sender: "u-other")))
        await settle()

        try await database.reader.read { db in
            let chat = try ChatRecord.fetchOne(db, key: "c-1")
            XCTAssertEqual(chat?.unreadCount, 1)
            XCTAssertEqual(chat?.lastSeq, 2)
            XCTAssertEqual(chat?.lastMessageId, "m-2")
            XCTAssertNotNil(try MessageRecord.fetchOne(db, key: "m-2"))
        }
        _ = coordinator
    }

    /// Сообщение по порядку двигает позицию догона, через разрыв — нет: догон пойдёт с
    /// прежней, и пропущенное между не потеряется (IOS_RULES 9.3.2).
    func testPositionMovesOnlyInOrderAndGapSignalsOpenChat() async throws {
        let (database, coordinator, transport) = try await make()
        let signals = coordinator.signals(for: "c-1")

        await transport.emit(.messageNew(message(id: "m-2", seq: 2, sender: "u-other")))
        await settle()
        var chat = try await database.reader.read { db in try ChatRecord.fetchOne(db, key: "c-1") }
        XCTAssertEqual(chat?.syncSeq, 2)
        XCTAssertEqual(signals.gapVersion, 0)

        await transport.emit(.messageNew(message(id: "m-5", seq: 5, sender: "u-other")))
        await settle()
        chat = try await database.reader.read { db in try ChatRecord.fetchOne(db, key: "c-1") }
        XCTAssertEqual(chat?.syncSeq, 2)
        XCTAssertEqual(chat?.lastSeq, 5)
        XCTAssertEqual(chat?.lastMessageId, "m-5")
        XCTAssertEqual(signals.gapVersion, 1)
    }

    /// Отметка прочтения и правка без соединения не теряются: досылаются на `.connected`
    /// (socket.io без соединения событие отбрасывает, IOS_RULES 9.4.16).
    func testReadAndEditWithoutConnectionAreSentOnConnect() async throws {
        let (_, coordinator, transport) = try await make()

        await coordinator.markRead(chatID: "c-1", messageID: "m-1")
        await coordinator.markRead(chatID: "c-1", messageID: "m-2")
        await coordinator.edit(messageID: "m-1", content: "черновик")
        await coordinator.edit(messageID: "m-1", content: "итог")
        var reads = await transport.reads
        XCTAssertEqual(reads, [])

        await transport.emit(.connected)
        await settle()

        reads = await transport.reads
        let edits = await transport.edits
        XCTAssertEqual(reads, ["m-2"])
        XCTAssertEqual(edits, ["итог"])
    }

    /// Повторный `message:new` для уже сохранённой строки счётчик не удваивает.
    func testRepeatedMessageDoesNotCountTwice() async throws {
        let (database, coordinator, transport) = try await make()

        await transport.emit(.messageNew(message(id: "m-2", seq: 2, sender: "u-other")))
        await transport.emit(.messageNew(message(id: "m-2", seq: 2, sender: "u-other")))
        await settle()

        let unread = try await database.reader.read { db in try ChatRecord.fetchOne(db, key: "c-1")?.unreadCount }
        XCTAssertEqual(unread, 1)
        _ = coordinator
    }

    /// Открытый чат читают прямо сейчас — непрочитанным его сообщение не бывает.
    func testMessageInOpenChatDoesNotRaiseCounter() async throws {
        let (database, coordinator, transport) = try await make()
        await coordinator.open(chatID: "c-1")

        await transport.emit(.messageNew(message(id: "m-2", seq: 2, sender: "u-other")))
        await settle()

        let unread = try await database.reader.read { db in try ChatRecord.fetchOne(db, key: "c-1")?.unreadCount }
        XCTAssertEqual(unread, 0)
    }

    /// Прочтение на другом устройстве гасит счётчик и здесь.
    func testChatReadClearsCounter() async throws {
        let (database, coordinator, transport) = try await make(unread: 5)

        await transport.emit(.chatRead(chatID: "c-1", readAt: Date()))
        await settle()

        let unread = try await database.reader.read { db in try ChatRecord.fetchOne(db, key: "c-1")?.unreadCount }
        XCTAssertEqual(unread, 0)
        _ = coordinator
    }

    /// Удаление помечает строку, а не стирает: в ленте остаётся «сообщение удалено».
    func testDeletionIsSoft() async throws {
        let (database, coordinator, transport) = try await make()
        await transport.emit(.messageNew(message(id: "m-2", seq: 2, sender: "u-other")))
        await settle()

        await transport.emit(.messageDeleted(messageID: "m-2", chatID: "c-1"))
        await settle()

        let stored = try await database.reader.read { db in try MessageRecord.fetchOne(db, key: "m-2") }
        XCTAssertNotNil(stored?.deletedAt)
        _ = coordinator
    }

    /// Переподключение увеличивает счётчик эпох: по нему открытый чат понимает,
    /// что пора догнать пропущенное.
    func testReconnectBumpsEpochAndRejoinsRoom() async throws {
        let (_, coordinator, transport) = try await make()
        await coordinator.open(chatID: "c-1")
        let joinsBefore = await transport.joins.count

        await transport.emit(.connected)
        await settle()

        XCTAssertEqual(coordinator.connectionEpoch, 1)
        XCTAssertTrue(coordinator.isConnected)
        let joinsAfter = await transport.joins.count
        XCTAssertEqual(joinsAfter, joinsBefore + 1)
    }

    /// Подпись «печатает…» держится в памяти и снимается явным «закончил».
    func testActionAppearsAndClears() async throws {
        let (_, coordinator, transport) = try await make()

        await transport.emit(.action(chatID: "c-1", userID: "u-other", action: "TYPING"))
        await settle()
        XCTAssertEqual(coordinator.actions["c-1"]?["u-other"], "TYPING")

        await transport.emit(.action(chatID: "c-1", userID: "u-other", action: nil))
        await settle()
        XCTAssertNil(coordinator.actions["c-1"])
    }

    func testPresenceIsTracked() async throws {
        let (_, coordinator, transport) = try await make()

        await transport.emit(.presence(userID: "u-other", online: true))
        await settle()
        XCTAssertTrue(coordinator.onlineUsers.contains("u-other"))

        await transport.emit(.presence(userID: "u-other", online: false))
        await settle()
        XCTAssertFalse(coordinator.onlineUsers.contains("u-other"))
    }

    /// Выход и вход без перезапуска: поток событий переживает выход, а между ними
    /// запоздалые события прежнего сокета в базу не пишутся.
    func testEventsFlowAgainAfterSignOutAndSignIn() async throws {
        let (database, coordinator, transport) = try await make()

        await coordinator.stop()
        await transport.emit(.messageNew(message(id: "m-2", seq: 2, sender: "u-other")))
        await settle()
        let ignored = try await database.reader.read { db in try MessageRecord.fetchOne(db, key: "m-2") }
        XCTAssertNil(ignored)

        coordinator.start()
        await transport.emit(.messageNew(message(id: "m-3", seq: 3, sender: "u-other")))
        await settle()
        let stored = try await database.reader.read { db in try MessageRecord.fetchOne(db, key: "m-3") }
        XCTAssertNotNil(stored)
    }

    /// Эхо своего сообщения с ключом повтора подтверждает неотправленную строку, а не
    /// вставляет вторую (P0-1 аудита).
    func testEchoWithNonceConfirmsPendingRow() async throws {
        let (database, coordinator, transport) = try await make()
        let own = MessageRecord(
            id: "local-1", remoteId: nil, chatId: "c-1", seq: nil, senderId: "u-me", content: "текст",
            replyToId: nil, replyQuote: nil, systemType: nil, editedAt: nil, deletedAt: nil,
            pinnedAt: nil, createdAt: Date(timeIntervalSince1970: 1_800_000_400), sendState: .pending
        )
        try await database.writer.write { db in try own.insert(db) }

        await transport.emit(.messageNew(message(id: "m-2", seq: 2, sender: "u-me"), nonce: "local-1"))
        await settle()

        try await database.reader.read { db in
            let rows = try MessageRecord.fetchAll(db)
            XCTAssertEqual(rows.map(\.id), ["local-1"])
            XCTAssertEqual(rows.first?.remoteId, "m-2")
            XCTAssertEqual(rows.first?.sendState, .sent)
        }
        _ = coordinator
    }

    /// Переподключение догоняет список чатов (события за время обрыва никто не
    /// переприсылает), а первое подключение — нет: список и так грузится при входе.
    func testReconnectRefreshesChatListOnce() async throws {
        let api = CountingChats()
        let (_, coordinator, transport) = try await make(api: api)

        await transport.emit(.connected)
        await transport.emit(.disconnected)
        await transport.emit(.connected)
        // Обновление списка ждёт пачку событий 0,7 с.
        try? await Task.sleep(for: .milliseconds(1_000))

        let calls = await api.calls
        XCTAssertEqual(calls, 1)
        _ = coordinator
    }

    /// События пишутся в объекты своего ключа: прочтение в одном чате и «в сети» одного
    /// человека не трогают сигналы других (P1-4 аудита).
    func testKeyedSignalsChangeOnlyForTheirKey() async throws {
        let (_, coordinator, transport) = try await make()
        let mine = coordinator.signals(for: "c-1")
        let other = coordinator.signals(for: "c-2")
        let alice = coordinator.presence(of: "u-alice")
        let bob = coordinator.presence(of: "u-bob")
        let readAt = Date(timeIntervalSince1970: 1_800_000_900)

        await transport.emit(.messageRead(chatID: "c-1", userID: "u-alice", readAt: readAt))
        await transport.emit(.presence(userID: "u-alice", online: true))
        await transport.emit(.chatPinned(chatID: "c-1"))
        await settle()

        XCTAssertEqual(mine.memberReads["u-alice"], readAt)
        XCTAssertEqual(mine.pinnedVersion, 1)
        XCTAssertTrue(other.memberReads.isEmpty)
        XCTAssertEqual(other.pinnedVersion, 0)
        XCTAssertTrue(alice.isOnline)
        XCTAssertNil(bob.mark)
    }

    /// Объект, созданный после событий, начинает с уже известного.
    func testLateSignalStartsFromKnownState() async throws {
        let (_, coordinator, transport) = try await make()

        await transport.emit(.presence(userID: "u-alice", online: true))
        await transport.emit(.pollUpdated(pollID: "p-1", chatID: "c-1"))
        await settle()

        XCTAssertTrue(coordinator.presence(of: "u-alice").isOnline)
        XCTAssertEqual(coordinator.pollSignal("p-1").version, 1)
    }

    // MARK: - Помощники

    private func make(
        unread: Int = 0,
        api: ChatsFetching? = nil
    ) async throws -> (AppDatabase, RealtimeCoordinator, StubTransport) {
        let database = try AppDatabase.inMemory()
        try await database.writer.write { db in
            try ChatRecord(
                id: "c-1", type: ChatKind.group.rawValue, title: "Чат", avatarUrl: nil,
                chatDescription: nil, subject: nil, memberCount: 3, unreadCount: unread, muted: false,
                mutedImportantOnly: false, pinnedAt: nil, archivedAt: nil, requestIncoming: false,
                requestOutgoing: false, othersReadAt: nil, lastMessageId: nil, lastSeq: 1,
                updatedAt: Date(timeIntervalSince1970: 1_800_000_000), syncSeq: 1
            ).insert(db)
        }
        let transport = StubTransport()
        let coordinator = RealtimeCoordinator(
            transport: transport,
            session: SessionStore(auth: SilentAuth(), secrets: MemoryKeys(), cookies: MemoryJar()),
            database: database,
            api: api
        )
        coordinator.start()
        return (database, coordinator, transport)
    }

    /// Событие проходит через поток и запись в базу — даём этому завершиться.
    private func settle() async {
        try? await Task.sleep(for: .milliseconds(60))
    }

    private func message(id: String, seq: Int, sender: String) -> ChatMessageDTO {
        ChatMessageDTO(
            id: id, chatId: "c-1", seq: seq, senderId: sender, content: "текст",
            replyToId: nil, replyQuote: nil, systemType: nil, editedAt: nil, deletedAt: nil,
            pinnedAt: nil, createdAt: Date(timeIntervalSince1970: 1_800_000_500),
            media: nil
        )
    }
}

// MARK: - Дублёры

private actor StubTransport: RealtimeTransport {
    nonisolated let events: AsyncStream<RealtimeEvent>
    private let continuation: AsyncStream<RealtimeEvent>.Continuation
    private(set) var joins: [String] = []
    private(set) var leaves: [String] = []
    private(set) var reads: [String] = []
    private(set) var actions: [String?] = []
    private(set) var edits: [String] = []

    init() {
        (events, continuation) = AsyncStream<RealtimeEvent>.makeStream()
    }

    func emit(_ event: RealtimeEvent) {
        continuation.yield(event)
    }

    func connect(token: String) async {}
    func disconnect() async {}
    func refresh(token: String) async {}
    func join(chatID: String) async { joins.append(chatID) }
    func leave(chatID: String) async { leaves.append(chatID) }
    func markRead(chatID: String, messageID: String) async { reads.append(messageID) }
    func send(action: String?, chatID: String) async { actions.append(action) }
    func edit(messageID: String, content: String) async { edits.append(content) }
    func delete(messageID: String) async {}
}

/// Список чатов, который только считает обращения.
private actor CountingChats: ChatsFetching {
    private(set) var calls = 0

    func chats(cursor: String?, limit: Int) async throws -> Page<ChatListItemDTO> {
        calls += 1
        return Page(items: [], meta: nil)
    }

    func folders() async throws -> [ChatFolderDTO] { [] }
    func setPinned(_ pinned: Bool, chatID: String) async throws {}
    func setArchived(_ archived: Bool, chatID: String) async throws {}
    func setMuted(_ muted: Bool, chatID: String) async throws {}
}

private struct SilentAuth: SessionRefreshing {
    func refresh() async throws -> AuthSession { throw APIError.malformedResponse(statusCode: 0) }
    func endSession(deviceToken: String?, refreshToken: String?) async throws {}
}

private final class MemoryKeys: SecretStore, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String: String] = [:]
    func value(for key: SecretKey) -> String? { lock.withLock { storage[key.rawValue] } }
    func set(_ value: String, for key: SecretKey) { lock.withLock { storage[key.rawValue] = value } }
    func remove(_ key: SecretKey) { _ = lock.withLock { storage.removeValue(forKey: key.rawValue) } }
}

private final class MemoryJar: RefreshCookieStore, @unchecked Sendable {
    private let lock = NSLock()
    private var stored: String?
    func value() -> String? { lock.withLock { stored } }
    func restore(_ value: String) { lock.withLock { stored = value } }
    func clear() { lock.withLock { stored = nil } }
}
