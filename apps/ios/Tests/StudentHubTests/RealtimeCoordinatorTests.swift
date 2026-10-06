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

    // MARK: - Помощники

    private func make(unread: Int = 0) async throws -> (AppDatabase, RealtimeCoordinator, StubTransport) {
        let database = try AppDatabase.inMemory()
        try await database.writer.write { db in
            try ChatRecord(
                id: "c-1", type: ChatKind.group.rawValue, title: "Чат", avatarUrl: nil,
                chatDescription: nil, subject: nil, memberCount: 3, unreadCount: unread, muted: false,
                mutedImportantOnly: false, pinnedAt: nil, archivedAt: nil, requestIncoming: false,
                requestOutgoing: false, othersReadAt: nil, lastMessageId: nil, lastSeq: 1,
                updatedAt: Date(timeIntervalSince1970: 1_800_000_000)
            ).insert(db)
        }
        let transport = StubTransport()
        let coordinator = RealtimeCoordinator(
            transport: transport,
            session: SessionStore(auth: SilentAuth(), secrets: MemoryKeys(), cookies: MemoryJar()),
            database: database
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
}

private struct SilentAuth: SessionRefreshing {
    func refresh() async throws -> AuthSession { throw APIError.malformedResponse(statusCode: 0) }
    func endSession() async throws {}
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
