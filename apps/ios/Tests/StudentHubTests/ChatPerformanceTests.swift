import GRDB
import XCTest

@testable import StudentHub

/// Замеры ленты на тестовом чате (план аудита, шаги 0.2 и 0.5).
///
/// Числа XCTest сравнивает с базовой линией схемы: регресс виден в отчёте прогона. Сами
/// тесты падают только на нарушенных инвариантах фикстуры, а не на времени — порог
/// времени ставится базовой линией после первого замера на CI-машине.
final class ChatPerformanceTests: XCTestCase {
    private let viewer = "perf-viewer"
    private let now = Date(timeIntervalSince1970: 1_794_515_400)

    /// Фикстура одинакова от прогона к прогону: замеры сравнимы между собой.
    func testFixtureIsDeterministic() {
        let first = PerfFixture.makeMessages(count: 300, viewerID: viewer, now: now)
        let second = PerfFixture.makeMessages(count: 300, viewerID: viewer, now: now)

        XCTAssertEqual(first.map(\.message), second.map(\.message))
        XCTAssertEqual(first.compactMap(\.photo), second.compactMap(\.photo))
    }

    /// Состав похож на настоящую переписку: свои и чужие, ответы, фото, несколько дней.
    func testFixtureShape() {
        let items = PerfFixture.makeMessages(count: PerfFixture.defaultCount, viewerID: viewer, now: now)
        let own = items.filter { $0.message.senderId == viewer }.count
        let photos = items.compactMap(\.photo).count
        let replies = items.filter { $0.message.replyToId != nil }.count
        let days = MessageTimeline.build(from: items.map(\.message), viewerID: viewer).count

        XCTAssertEqual(items.count, PerfFixture.defaultCount)
        XCTAssertEqual(items.map(\.message.seq), Array(1...PerfFixture.defaultCount).map(Optional.some))
        XCTAssertGreaterThan(own, PerfFixture.defaultCount / 5)
        XCTAssertLessThan(own, PerfFixture.defaultCount / 2)
        XCTAssertGreaterThan(photos, PerfFixture.defaultCount / 5)
        XCTAssertEqual(replies, PerfFixture.defaultCount / 10 - 1)
        XCTAssertGreaterThan(days, 20)
    }

    /// Засев кладёт чат, сообщения и вложения; повторный засев заменяет, а не дублирует.
    func testSeedReplacesFixture() async throws {
        let database = try AppDatabase.inMemory()

        try await PerfFixture.seed(count: 200, viewerID: viewer, database: database, now: now)
        try await PerfFixture.seed(count: 100, viewerID: viewer, database: database, now: now)

        let (chat, messages) = try await database.reader.read { db in
            (
                try ChatRecord.fetchOne(db, key: PerfFixture.chatID),
                try MessageRecord.filter(MessageRecord.Columns.chatId == PerfFixture.chatID).fetchCount(db)
            )
        }
        XCTAssertEqual(chat?.lastSeq, 100)
        XCTAssertEqual(messages, 100)
    }

    /// Чтение всего чата из базы — то, что сейчас делает наблюдение ленты на каждое
    /// изменение (`ThreadSnapshotRead`, пункт P0-4 аудита).
    func testMeasureFullHistoryRead() async throws {
        let database = try AppDatabase.inMemory()
        try await PerfFixture.seed(viewerID: viewer, database: database, now: now)
        let request = MessageStore(database: database).messages(chatID: PerfFixture.chatID)

        measure(metrics: [XCTClockMetric()]) {
            let count = (try? database.reader.read { db in try request.fetchCount(db) }) ?? 0
            let rows = (try? database.reader.read { db in try request.fetchAll(db) }) ?? []
            XCTAssertEqual(rows.count, count)
        }
    }

    /// Полная сборка ленты по всем сообщениям (`TimelineBuild`).
    func testMeasureTimelineBuild() {
        let items = PerfFixture.makeMessages(count: PerfFixture.defaultCount, viewerID: viewer, now: now)
        let messages = items.map(\.message)
        let attachments = Dictionary(grouping: items.compactMap(\.photo), by: \.messageId)

        measure(metrics: [XCTClockMetric()]) {
            let days = MessageTimeline.build(from: messages, attachments: attachments, viewerID: viewer)
            XCTAssertFalse(days.isEmpty)
        }
    }
}
