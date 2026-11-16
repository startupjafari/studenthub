import XCTest

@testable import StudentHub

/// Итерация 8: общие форматтеры дня и ISO, ленивая база бейджа чатов.
final class DayStringTests: XCTestCase {
    func testDayInGivenTimeZone() throws {
        // 2026-11-12 20:30 UTC — в Алматы (UTC+5) уже 13-е.
        let moment = Date(timeIntervalSince1970: 1_794_515_400)
        let almaty = try XCTUnwrap(TimeZone(identifier: "Asia/Almaty"))
        let utc = try XCTUnwrap(TimeZone(identifier: "UTC"))

        XCTAssertEqual(DayString.string(from: moment, timeZone: utc), "2026-11-12")
        XCTAssertEqual(DayString.string(from: moment, timeZone: almaty), "2026-11-13")
    }

    /// Разбор — начало дня в поясе; хвост ISO-момента не мешает.
    func testParsesDayPrefix() throws {
        let utc = try XCTUnwrap(TimeZone(identifier: "UTC"))

        let day = DayString.date(from: "2025-09-01T08:00:00.000Z", timeZone: utc)

        XCTAssertEqual(day, Date(timeIntervalSince1970: 1_756_684_800))
    }

    /// С разных потоков одновременно — одинаковый ответ (форматтеры общие).
    func testConcurrentUseIsConsistent() throws {
        let moment = Date(timeIntervalSince1970: 1_794_515_400)
        let utc = try XCTUnwrap(TimeZone(identifier: "UTC"))
        let results = ResultBox()

        DispatchQueue.concurrentPerform(iterations: 200) { _ in
            results.append(DayString.string(from: moment, timeZone: utc))
        }

        XCTAssertEqual(Set(results.values), ["2026-11-12"])
    }

    /// ISO-момент — тем же разбором, что у декодера API, с долями секунды и без.
    func testISODateMatchesDecoder() throws {
        let fractional = "2026-10-06T12:34:56.789Z"
        let plain = "2026-10-06T12:34:56Z"

        let decoded = try JSONCoding.decoder.decode(Date.self, from: Data("\"\(fractional)\"".utf8))

        XCTAssertEqual(JSONCoding.isoDate(fractional), decoded)
        XCTAssertEqual(JSONValue.string(fractional).date, decoded)
        XCTAssertNotNil(JSONCoding.isoDate(plain))
        XCTAssertNil(JSONCoding.isoDate("вчера"))
    }
}

final class ChatBadgeModelTests: XCTestCase {
    /// Лишний экземпляр, который SwiftUI создаёт при пересчёте оболочки, базу не трогает
    /// (п. 19): она нужна только по `start()`.
    func testInitDoesNotTouchDatabase() throws {
        let database = try AppDatabase.inMemory()
        let touched = Flag()

        _ = ChatBadgeModel(database: touched.mark(returning: database))

        XCTAssertFalse(touched.value)
    }
}

private final class ResultBox: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [String] = []

    var values: [String] { lock.withLock { stored } }

    func append(_ value: String) {
        lock.withLock { stored.append(value) }
    }
}

private final class Flag {
    private(set) var value = false

    func mark(returning database: AppDatabase) -> AppDatabase {
        value = true
        return database
    }
}
