import GRDB
import XCTest

@testable import StudentHub

final class WeekParityTests: XCTestCase {
    private let utc = TimeZone(identifier: "UTC")!

    /// Чётность обязана совпадать с вебом день в день: разойдись она — и у человека
    /// в приложении и в браузере разные пары. Значения — по ISO 8601, те же, что в
    /// тесте веба (`tz-date.test.ts`).
    func testParityMatchesIsoWeek() {
        let calendar = Calendar.iso8601UTC
        let cases: [(DateComponents, WeekParity, Int)] = [
            (DateComponents(year: 2026, month: 10, day: 23), .odd, 43),
            (DateComponents(year: 2026, month: 10, day: 26), .even, 44),
            (DateComponents(year: 2026, month: 1, day: 5), .even, 2),
            (DateComponents(year: 2026, month: 1, day: 12), .odd, 3),
            (DateComponents(year: 2026, month: 10, day: 7), .odd, 41),
            (DateComponents(year: 2024, month: 1, day: 4), .odd, 1),
            // Конец декабря — уже 1-я неделя следующего года, начало января — ещё 53-я.
            (DateComponents(year: 2025, month: 12, day: 29), .odd, 1),
            (DateComponents(year: 2027, month: 1, day: 3), .odd, 53),
        ]

        for (components, parity, week) in cases {
            let date = calendar.date(from: components)!
            XCTAssertEqual(WeekParity.weekNumber(of: date, in: utc), week, "неделя для \(components)")
            XCTAssertEqual(WeekParity.current(date, in: utc), parity, "чётность для \(components)")
        }
    }

    /// Не-ISO календарь (неделя с воскресенья) не должен сдвигать номер недели.
    func testNonIsoCalendarStillGivesIsoWeek() {
        let date = Calendar.iso8601UTC.date(from: DateComponents(year: 2026, month: 10, day: 25))!

        XCTAssertEqual(WeekParity.weekNumber(of: date, in: utc, calendar: Calendar(identifier: .gregorian)), 43)
    }

    /// Неделя — по дате в поясе вуза: понедельник 02:00 в Алматы (в UTC ещё
    /// воскресенье) — уже новая неделя, как в вебе и Android.
    func testWeekFollowsUniversityTimeZone() {
        let almaty = TimeZone(identifier: "Asia/Almaty")!
        // 2026-10-25 21:00Z = 2026-10-26 02:00 в Алматы (UTC+5).
        let date = Calendar.iso8601UTC.date(
            from: DateComponents(year: 2026, month: 10, day: 25, hour: 21)
        )!

        XCTAssertEqual(WeekParity.weekNumber(of: date, in: almaty), 44)
        XCTAssertEqual(WeekParity.current(date, in: almaty), .even)
        XCTAssertEqual(WeekParity.weekNumber(of: date, in: utc), 43)
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

    /// «Ближайшая пара» сравнивает конец пары с часами в той же форме «HH:mm»:
    /// 09:05 должно быть раньше 10:00, а не позже из-за отсутствующего нуля.
    func testClockIsZeroPadded() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let date = calendar.date(from: DateComponents(year: 2026, month: 10, day: 24, hour: 9, minute: 5))!

        XCTAssertEqual(ScheduleModel.clock(of: date, calendar: calendar), "09:05")
    }
}
