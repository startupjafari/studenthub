import GRDB
import XCTest

@testable import StudentHub

/// Досылка неотправленного на всё приложение (P0-2 аудита).
final class OutboxServiceTests: XCTestCase {
    /// Сбой в одном чате не держит другие: проход идёт по всем.
    func testFailingChatDoesNotBlockOthers() async {
        let log = Log()
        let service = OutboxService(
            flush: { chatID in await log.flushed(chatID); return chatID != "c-1" },
            stuckChats: { ["c-1", "c-2", "c-3"] },
            sleep: { _ in throw CancellationError() }
        )

        await service.kick()

        let flushed = await log.chats
        XCTAssertEqual(flushed, ["c-1", "c-2", "c-3"])
    }

    /// Не дослали — повтор с растущей паузой; новый повод (сеть вернулась) сбрасывает её.
    func testRetryDelayGrowsAndKickResetsIt() async {
        let log = Log()
        let service = OutboxService(
            flush: { _ in false },
            stuckChats: { ["c-1"] },
            sleep: { delay in await log.slept(delay); throw CancellationError() }
        )

        await service.kick()
        let afterFirst = await service.nextRetryDelay
        await service.kick()
        let afterKick = await service.nextRetryDelay

        XCTAssertEqual(afterFirst, .seconds(4))
        XCTAssertEqual(afterKick, .seconds(4))
        // Сама пауза — в отдельной задаче; что успело записаться, то и проверяем.
        for delay in await log.delays {
            XCTAssertGreaterThanOrEqual(delay, .milliseconds(1600))
            XCTAssertLessThanOrEqual(delay, .milliseconds(2400))
        }
    }

    /// Повтор сам доходит до успеха и останавливается: пауза снова минимальная.
    func testRetryRunsUntilDelivered() async {
        let log = Log()
        let service = OutboxService(
            flush: { chatID in await log.flushed(chatID); return await log.chats.count >= 3 },
            stuckChats: { ["c-1"] },
            sleep: { _ in }
        )

        await service.kick()
        var waited = 0
        while await log.chats.count < 3, waited < 100 {
            try? await Task.sleep(for: .milliseconds(5))
            waited += 1
        }

        let attempts = await log.chats.count
        let delay = await service.nextRetryDelay
        XCTAssertEqual(attempts, 3)
        XCTAssertEqual(delay, OutboxService.firstRetryDelay)
    }

    /// Пауза с разбросом ±20%.
    func testJitterBounds() {
        let low = OutboxService.jittered(.seconds(10), unit: 0)
        let high = OutboxService.jittered(.seconds(10), unit: 1)

        // Сравнение с допуском: множитель 0,8 + 0,4 в двоичной арифметике не ровно 1,2.
        XCTAssert((.milliseconds(7_999)...(.milliseconds(8_001))).contains(low))
        XCTAssert((.milliseconds(11_999)...(.milliseconds(12_001))).contains(high))
    }

    /// Чаты для досылки — только с застрявшими текстами: свежее «в пути», подтверждённое
    /// и вложения сюда не попадают.
    func testStuckChatIDsComeFromDatabase() async throws {
        let database = try AppDatabase.inMemory()
        let now = Date()
        let rows = [
            message(id: "a", chat: "c-1", state: .failed, createdAt: now),
            message(id: "b", chat: "c-2", state: .pending, createdAt: now.addingTimeInterval(-120)),
            message(id: "c", chat: "c-3", state: .pending, createdAt: now),
            message(id: "d", chat: "c-4", state: .sent, createdAt: now.addingTimeInterval(-120), remoteId: "s-d"),
        ]
        try await database.writer.write { db in
            for chat in ["c-1", "c-2", "c-3", "c-4"] {
                try ChatRecord(
                    id: chat, type: ChatKind.private.rawValue, title: nil, avatarUrl: nil,
                    chatDescription: nil, subject: nil, memberCount: 2, unreadCount: 0, muted: false,
                    mutedImportantOnly: false, pinnedAt: nil, archivedAt: nil, requestIncoming: false,
                    requestOutgoing: false, othersReadAt: nil, lastMessageId: nil, lastSeq: 0, updatedAt: now
                ).insert(db)
            }
            for row in rows { try row.insert(db) }
        }

        let chats = await MessageOutbox(database: database).stuckChatIDs()

        XCTAssertEqual(Set(chats), ["c-1", "c-2"])
    }

    private func message(
        id: String,
        chat: String,
        state: MessageSendState,
        createdAt: Date,
        remoteId: String? = nil
    ) -> MessageRecord {
        MessageRecord(
            id: id, remoteId: remoteId, chatId: chat, seq: nil, senderId: "u-me", content: "текст",
            replyToId: nil, replyQuote: nil, systemType: nil, editedAt: nil, deletedAt: nil,
            pinnedAt: nil, createdAt: createdAt, sendState: state
        )
    }
}

private actor Log {
    private(set) var chats: [String] = []
    private(set) var delays: [Duration] = []

    func flushed(_ chatID: String) { chats.append(chatID) }
    func slept(_ delay: Duration) { delays.append(delay) }
}
