import GRDB
import XCTest

@testable import StudentHub

final class WeekParityTests: XCTestCase {
    /// Правило чётности должно совпадать с вебом до дня: разойдись оно — и у
    /// человека в приложении и в браузере разные пары.
    func testParityFollowsIsoWeekNumber() {
        let calendar = Calendar.iso8601UTC
        // 5 января 2026 — понедельник первой ISO-недели года.
        let firstWeek = calendar.date(from: DateComponents(year: 2026, month: 1, day: 5))!
        let secondWeek = calendar.date(byAdding: .day, value: 7, to: firstWeek)!

        XCTAssertEqual(WeekParity.current(firstWeek), .odd)
        XCTAssertEqual(WeekParity.current(secondWeek), .even)
    }

    /// `BOTH` идёт каждую неделю — это самый частый случай в расписании.
    func testBothRunsEveryWeek() {
        XCTAssertTrue(WeekParity.odd.includes(weekType: "BOTH"))
        XCTAssertTrue(WeekParity.even.includes(weekType: "BOTH"))
        XCTAssertTrue(WeekParity.odd.includes(weekType: "ODD"))
        XCTAssertFalse(WeekParity.odd.includes(weekType: "EVEN"))
    }
}

final class ScheduleStoreTests: XCTestCase {
    /// Расписание заменяется целиком: убранная пара обязана исчезнуть, иначе
    /// человек придёт на отменённое занятие.
    func testScheduleIsReplacedWholesale() async throws {
        let database = try AppDatabase.inMemory()
        let store = ScheduleStore(database: database)
        try await store.save(ScheduleDTO(timezone: "Asia/Almaty", pairs: [pair(id: "p-1"), pair(id: "p-2")]))

        try await store.save(ScheduleDTO(timezone: "Asia/Almaty", pairs: [pair(id: "p-2")]))

        let ids = try await database.reader.read { db in try PairRecord.fetchAll(db).map(\.id) }
        XCTAssertEqual(ids, ["p-2"])
    }

    /// Имя преподавателя склеивается один раз при записи: на экране его показывают
    /// в каждой строке, и собирать его там заново незачем.
    func testTeacherNameIsStoredReady() async throws {
        let database = try AppDatabase.inMemory()
        let store = ScheduleStore(database: database)

        try await store.save(ScheduleDTO(timezone: nil, pairs: [pair(id: "p-1")]))

        let stored = try await database.reader.read { db in try PairRecord.fetchOne(db) }
        XCTAssertEqual(stored?.teacherName, "Ахметов Руслан")
    }

    /// Старые изменения чистятся: перенос недельной давности никому не нужен, а
    /// база иначе растёт вечно.
    func testOldChangesAreDropped() async throws {
        let database = try AppDatabase.inMemory()
        let store = ScheduleStore(database: database)
        let now = Date()
        let old = now.addingTimeInterval(-10 * 86_400)

        try await store.save(changes: [change(id: "c-old", date: old)], from: old)
        try await store.save(changes: [change(id: "c-new", date: now)], from: now)

        let ids = try await database.reader.read { db in try PairChangeRecord.fetchAll(db).map(\.id) }
        XCTAssertEqual(ids, ["c-new"])
    }

    private func pair(id: String) -> PairDTO {
        PairDTO(
            id: id,
            scheduleId: "s-1",
            groupId: "g-1",
            subject: "Алгоритмы",
            dayOfWeek: 2,
            startTime: "10:00",
            endTime: "11:30",
            weekType: "BOTH",
            teacher: PairDTO.Person(id: "t-1", firstName: "Руслан", lastName: "Ахметов"),
            room: PairDTO.Room(id: "r-1", name: "312")
        )
    }

    private func change(id: String, date: Date) -> ScheduleChangeDTO {
        ScheduleChangeDTO(
            id: id, pairId: "p-1", type: "CANCELLED", date: date,
            newStartTime: nil, newEndTime: nil, note: nil
        )
    }
}

final class SchedulePairTests: XCTestCase {
    /// Перенос показывает новое время, а не старое: иначе человек приходит к
    /// прежнему началу.
    func testMovedPairShowsNewTime() {
        let item = SchedulePair(
            pair: PairRecord(
                id: "p-1", subject: "Алгоритмы", dayOfWeek: 2, startTime: "10:00", endTime: "11:30",
                weekType: "BOTH", teacherName: nil, roomName: nil, groupId: nil
            ),
            change: PairChangeRecord(
                id: "c-1", pairId: "p-1", type: "MOVED", date: Date(),
                newStartTime: "14:00", newEndTime: "15:30", note: nil
            )
        )

        XCTAssertEqual(item.startTime, "14:00")
        XCTAssertEqual(item.endTime, "15:30")
        XCTAssertFalse(item.isCancelled)
    }
}
