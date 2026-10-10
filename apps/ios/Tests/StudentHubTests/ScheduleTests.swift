import GRDB
import XCTest

@testable import StudentHub

final class WeekParityTests: XCTestCase {
    /// Чётность обязана совпадать с вебом день в день: разойдись она — и у человека
    /// в приложении и в браузере разные пары.
    ///
    /// Значения закреплены по формуле веба (`isoWeekParity`), а не по ISO 8601: в
    /// ней опущена поправка на день недели 4 января, и в 2026 году номер недели на
    /// единицу меньше стандартного. Это расхождение воспроизведено намеренно —
    /// подробности в комментарии к `WeekParity`.
    func testParityMatchesWebFormula() {
        let calendar = Calendar.iso8601UTC
        let cases: [(DateComponents, WeekParity, Int)] = [
            (DateComponents(year: 2026, month: 1, day: 5), .odd, 1),
            (DateComponents(year: 2026, month: 1, day: 12), .even, 2),
            (DateComponents(year: 2026, month: 10, day: 7), .even, 40),
            (DateComponents(year: 2024, month: 1, day: 4), .odd, 1),
        ]

        for (components, parity, week) in cases {
            let date = calendar.date(from: components)!
            XCTAssertEqual(WeekParity.weekNumber(of: date), week, "неделя для \(components)")
            XCTAssertEqual(WeekParity.current(date), parity, "чётность для \(components)")
        }
    }

    /// Расхождение с ISO 8601 — не случайность, а зафиксированное решение: тест
    /// упадёт, если кто-то «починит» формулу в одном месте и забудет про второе.
    func testDivergenceFromIsoIsDeliberate() {
        let date = Calendar.iso8601UTC.date(from: DateComponents(year: 2026, month: 1, day: 5))!

        XCTAssertEqual(WeekParity.weekNumber(of: date), 1)
        XCTAssertEqual(Calendar.iso8601UTC.component(.weekOfYear, from: date), 2)
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
