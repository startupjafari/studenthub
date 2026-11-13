import GRDB
import XCTest

@testable import StudentHub

final class MessageStoreTests: XCTestCase {
    /// Та же страница второй раз (обновление списка, догон) ничего не пишет: пустая запись
    /// будила бы наблюдения ленты и списка (шаг 2.1 плана аудита).
    func testSameMessagesTwiceWriteNothing() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database)
        let photo = ChatAttachmentDTO(
            id: "f-1", mime: "image/jpeg", size: 1000, name: nil, spoiler: nil, asDocument: nil,
            width: 800, height: 600
        )
        var withPhoto = dto(id: "m-2", seq: 2)
        withPhoto = ChatMessageDTO(
            id: withPhoto.id, chatId: withPhoto.chatId, seq: withPhoto.seq, senderId: withPhoto.senderId,
            content: withPhoto.content, replyToId: nil, replyQuote: nil, systemType: nil, editedAt: nil,
            deletedAt: nil, pinnedAt: nil, createdAt: withPhoto.createdAt, media: [photo]
        )
        let page = [dto(id: "m-1", seq: 1), withPhoto]
        let store = MessageStore(database: database)
        try await store.save(messages: page, chatID: "c-1")

        let before = try await database.writer.write { db in db.totalChangesCount }
        try await store.save(messages: page, chatID: "c-1")
        let after = try await database.writer.write { db in db.totalChangesCount }

        XCTAssertEqual(after, before)
        let attachments = try await database.reader.read { db in try AttachmentRecord.fetchCount(db) }
        XCTAssertEqual(attachments, 1)
    }

    /// Окно ленты: старее границы не читается, неотправленное (без номера) — всегда.
    func testWindowRequestRespectsFloor() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database)
        let store = MessageStore(database: database)
        try await store.save(messages: (1...10).map { dto(id: "m-\($0)", seq: $0) }, chatID: "c-1")
        let own = pending(id: "local-1")
        try await database.writer.write { db in try own.insert(db) }

        let window = try await database.reader.read { db in
            try store.messages(chatID: "c-1", from: 8).fetchAll(db)
        }

        XCTAssertEqual(Set(window.map(\.id)), ["m-8", "m-9", "m-10", "local-1"])
    }

    /// Граница опускается на страницу из того, что уже лежит в базе; ниже ничего нет — `nil`.
    func testLowerFloorUsesLocalHistory() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database)
        let store = MessageStore(database: database)
        try await store.save(messages: (1...10).map { dto(id: "m-\($0)", seq: $0) }, chatID: "c-1")

        let byPage = try await store.lowerFloor(chatID: "c-1", below: 8, by: 3)
        let rest = try await store.lowerFloor(chatID: "c-1", below: 3, by: 5)
        let none = try await store.lowerFloor(chatID: "c-1", below: 1, by: 5)

        XCTAssertEqual(byPage, 5)
        XCTAssertEqual(rest, 1)
        XCTAssertNil(none)
    }

    /// Изменилось одно поле — пишется, и только оно меняет строку.
    func testChangedMessageIsStillWritten() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database)
        let store = MessageStore(database: database)
        try await store.save(messages: [dto(id: "m-1", seq: 1, content: "было")], chatID: "c-1")

        try await store.save(messages: [dto(id: "m-1", seq: 1, content: "стало")], chatID: "c-1")

        let content = try await database.reader.read { db in try MessageRecord.fetchOne(db, key: "m-1")?.content }
        XCTAssertEqual(content, "стало")
    }

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

    /// Повтор того, что уже едет, — не повод отправить второй раз: двойное нажатие
    /// «Повторить» или досылка при входе в чат во время отправки дали бы дубль.
    func testRetryOfPendingMessageSendsNothing() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database)
        let api = StubSender()
        api.failure = .transport(URLError(.notConnectedToInternet))
        let outbox = MessageOutbox(database: database, api: api)
        await outbox.send(text: "привет", chatID: "c-1", senderID: "u-me", replyToID: nil)
        let failed = try await database.reader.read { db in try MessageRecord.fetchOne(db) }
        var pending = try XCTUnwrap(failed)
        pending.sendState = .pending
        try await database.writer.write { [pending] db in try pending.update(db) }
        let attempts = api.sent.count

        let delivered = await outbox.retry(pending)
        await outbox.flush(chatID: "c-1")

        XCTAssertFalse(delivered)
        XCTAssertEqual(api.sent.count, attempts)
    }

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

    /// `message:new` из сокета приходит раньше HTTP-ответа на отправку: строка одна,
    /// подтверждённая, а не две — своя «Не отправлено» и чужая копия.
    func testSocketEchoBeforeResponseDoesNotDuplicate() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database)
        let answer = ChatMessageDTO(
            id: "server-1", chatId: "c-1", seq: 3, senderId: "u-me", content: "привет",
            replyToId: nil, replyQuote: nil, systemType: nil, editedAt: nil, deletedAt: nil,
            pinnedAt: nil, createdAt: Date(timeIntervalSince1970: 1_800_000_100), media: nil
        )
        let outbox = MessageOutbox(database: database, api: EchoFirstSender(database: database, answer: answer))

        let delivered = await outbox.send(text: "привет", chatID: "c-1", senderID: "u-me", replyToID: nil)

        XCTAssertTrue(delivered)
        let stored = try await database.reader.read { db in try MessageRecord.fetchAll(db) }
        XCTAssertEqual(stored.count, 1)
        XCTAssertEqual(stored.first?.remoteId, "server-1")
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

        // Дублёр считает и первые — неудачные — попытки, поэтому смотрим хвост:
        // важен порядок досылки, а не общее число обращений.
        XCTAssertEqual(Array(api.sent.suffix(2)), ["первое", "второе"])
    }

    /// Ключ повтора — локальный id строки, и повтор шлёт тот же ключ: сервер вернёт уже
    /// созданное сообщение, а не второе (P0-1 аудита).
    func testRetrySendsSameNonceAsFirstAttempt() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database)
        let api = StubSender()
        api.failure = .transport(URLError(.timedOut))
        let outbox = MessageOutbox(database: database, api: api)
        await outbox.send(text: "привет", chatID: "c-1", senderID: "u-me", replyToID: nil)
        let local = try await database.reader.read { db in try MessageRecord.fetchOne(db) }
        let row = try XCTUnwrap(local)

        api.failure = nil
        api.answer = echo(id: "server-1", content: "привет")
        let delivered = await outbox.retry(row)

        XCTAssertTrue(delivered)
        XCTAssertEqual(api.nonces, [row.id, row.id])
    }

    /// Два одинаковых «ок» подряд: эхо с ключом подтверждает именно свою строку, а не
    /// самую раннюю с тем же текстом.
    func testEchoWithNonceConfirmsItsOwnRow() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database)
        let first = pending(id: "local-1", content: "ок", at: 1)
        let second = pending(id: "local-2", content: "ок", at: 2)
        let arrived = echo(id: "server-2", content: "ок")
        try await database.writer.write { db in
            try first.insert(db)
            try second.insert(db)
        }

        try await database.writer.write { db in
            try MessageStore.upsert(arrived, nonce: "local-2", in: db)
        }

        let rows = try await database.reader.read { db in
            try MessageRecord.order(MessageRecord.Columns.id).fetchAll(db)
        }
        XCTAssertEqual(rows.map(\.id), ["local-1", "local-2"])
        XCTAssertEqual(rows.map(\.remoteId), [nil, "server-2"])
        XCTAssertEqual(rows.map(\.sendState), [.pending, .sent])
    }

    /// Ключ есть, но строки с ним нет — сообщение ушло с другого устройства: своё
    /// неотправленное с тем же текстом остаётся неотправленным, пришедшее — отдельной строкой.
    func testEchoWithForeignNonceIsNotGluedToPendingRow() async throws {
        let database = try AppDatabase.inMemory()
        try await seedChat(in: database)
        let own = pending(id: "local-1", content: "ок", at: 1)
        let arrived = echo(id: "server-9", content: "ок")
        try await database.writer.write { db in try own.insert(db) }

        try await database.writer.write { db in
            try MessageStore.upsert(arrived, nonce: "web-device-nonce", in: db)
        }

        let rows = try await database.reader.read { db in
            try MessageRecord.order(MessageRecord.Columns.id).fetchAll(db)
        }
        XCTAssertEqual(rows.map(\.id), ["local-1", "server-9"])
        XCTAssertEqual(rows.first?.sendState, .pending)
        XCTAssertNil(rows.first?.remoteId)
    }

    private func echo(id: String, content: String) -> ChatMessageDTO {
        ChatMessageDTO(
            id: id, chatId: "c-1", seq: 1, senderId: "u-me", content: content,
            replyToId: nil, replyQuote: nil, systemType: nil, editedAt: nil, deletedAt: nil,
            pinnedAt: nil, createdAt: Date(timeIntervalSince1970: 1_800_000_100), media: nil
        )
    }

    private func pending(id: String, content: String, at second: TimeInterval) -> MessageRecord {
        MessageRecord(
            id: id, remoteId: nil, chatId: "c-1", seq: nil, senderId: "u-me", content: content,
            replyToId: nil, replyQuote: nil, systemType: nil, editedAt: nil, deletedAt: nil,
            pinnedAt: nil, createdAt: Date(timeIntervalSince1970: 1_800_000_000 + second),
            sendState: .pending
        )
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

/// Сервер, у которого эхо по сокету обгоняет ответ на запрос.
private struct EchoFirstSender: ChatMessageSending {
    let database: AppDatabase
    let answer: ChatMessageDTO

    func send(text: String, chatID: String, replyToID: String?, nonce: String) async throws -> ChatMessageDTO {
        try await database.writer.write { db in try MessageStore.upsert(answer, in: db) }
        return answer
    }
}

private final class StubSender: ChatMessageSending, @unchecked Sendable {
    private let lock = NSLock()
    var answer: ChatMessageDTO?
    var failure: APIError?
    private(set) var sent: [String] = []
    private(set) var nonces: [String] = []

    func send(text: String, chatID: String, replyToID: String?, nonce: String) async throws -> ChatMessageDTO {
        let outcome: (APIError?, ChatMessageDTO?) = lock.withLock {
            sent.append(text)
            nonces.append(nonce)
            return (failure, answer)
        }
        if let error = outcome.0 { throw error }
        guard let answer = outcome.1 else { throw APIError.malformedResponse(statusCode: 0) }
        return answer
    }
}
