import Foundation
import GRDB

/// Чтения расписания из локальной базы — для экранов расписания и занятия.
///
/// Запросы строит `ScheduleStore` (тот же фильтр по дню и по полуночи UTC, что и при
/// записи), здесь — только их исполнение: экрану не нужно знать о GRDB.
struct ScheduleQueries: Sendable {
    let database: AppDatabase
    let store: ScheduleStore

    init(database: AppDatabase = AppServices.database, store: ScheduleStore? = nil) {
        self.database = database
        self.store = store ?? ScheduleStore(database: database)
    }

    /// Пары дня недели в порядке занятий — живым потоком.
    func observePairs(dayOfWeek: Int) -> AsyncStream<[PairRecord]> {
        let request = store.pairs(dayOfWeek: dayOfWeek)
        let observation = ValueObservation.tracking { db in try request.fetchAll(db) }
        return AsyncValues.stream(of: observation, in: database.reader)
    }

    /// Разовые изменения календарного дня — живым потоком.
    func observeChanges(on date: Date, calendar: Calendar) -> AsyncStream<[PairChangeRecord]> {
        let request = store.changes(on: date, calendar: calendar)
        let observation = ValueObservation.tracking { db in try request.fetchAll(db) }
        return AsyncValues.stream(of: observation, in: database.reader)
    }

    /// Пары и изменения нескольких дней одним чтением — для режима «Неделя».
    func fetchDays(
        _ days: [(Int, Date)],
        calendar: Calendar
    ) async throws -> [(Int, Date, [PairRecord], [PairChangeRecord])] {
        let requests = days.map { day, date in (day, date, store.pairs(dayOfWeek: day), store.changes(on: date, calendar: calendar)) }
        return try await database.reader.read { db in
            try requests.map { day, date, pairs, changes in
                (day, date, try pairs.fetchAll(db), try changes.fetchAll(db))
            }
        }
    }

    /// Пара и её изменение на дату — для экрана занятия. Изменения дня — тем же
    /// запросом, что у расписания: даты в базе — полночь UTC.
    func fetchLesson(pairID: String, on date: Date) async throws -> (PairRecord?, PairChangeRecord?) {
        let changesOfDay = store.changes(on: date)
            .filter(PairChangeRecord.Columns.pairId == pairID)
        return try await database.reader.read { db -> (PairRecord?, PairChangeRecord?) in
            (try PairRecord.fetchOne(db, key: pairID), try changesOfDay.fetchOne(db))
        }
    }
}
