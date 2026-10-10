import Foundation
import GRDB

/// Расписание в локальной базе.
struct ScheduleStore: Sendable {
    private let database: AppDatabase

    init(database: AppDatabase = AppServices.database) {
        self.database = database
    }

    /// Сохранить расписание целиком.
    ///
    /// Замена полная, а не слияние: пара, которую убрали из расписания, обязана
    /// исчезнуть и здесь — иначе человек придёт на отменённое занятие.
    func save(_ schedule: ScheduleDTO) async throws {
        try await database.writer.write { db in
            try PairRecord.deleteAll(db)
            for pair in schedule.pairs {
                try PairRecord(
                    id: pair.id,
                    subject: pair.subject,
                    dayOfWeek: pair.dayOfWeek,
                    startTime: pair.startTime,
                    endTime: pair.endTime,
                    weekType: pair.weekType,
                    teacherName: Self.name(of: pair.teacher),
                    roomName: pair.room?.name,
                    groupId: pair.groupId
                ).insert(db)
            }
        }
    }

    /// Изменения за период. Старые чистим: показывать перенос недельной давности
    /// незачем, а база иначе растёт вечно.
    func save(changes: [ScheduleChangeDTO], from: Date) async throws {
        try await database.writer.write { db in
            try PairChangeRecord
                .filter(PairChangeRecord.Columns.date < from)
                .deleteAll(db)
            for change in changes {
                try PairChangeRecord(
                    id: change.id,
                    pairId: change.pairId,
                    type: change.type,
                    date: change.date,
                    newStartTime: change.newStartTime,
                    newEndTime: change.newEndTime,
                    note: change.note
                ).upsert(db)
            }
        }
    }

    /// Пары одного дня недели в порядке занятий.
    func pairs(dayOfWeek: Int) -> QueryInterfaceRequest<PairRecord> {
        PairRecord
            .filter(PairRecord.Columns.dayOfWeek == dayOfWeek)
            .order(PairRecord.Columns.startTime.asc)
    }

    func allPairs() -> QueryInterfaceRequest<PairRecord> {
        PairRecord.order(PairRecord.Columns.dayOfWeek.asc, PairRecord.Columns.startTime.asc)
    }

    func changes(on day: Date, calendar: Calendar = .current) -> QueryInterfaceRequest<PairChangeRecord> {
        let start = calendar.startOfDay(for: day)
        let end = calendar.date(byAdding: .day, value: 1, to: start) ?? start
        return PairChangeRecord
            .filter(PairChangeRecord.Columns.date >= start && PairChangeRecord.Columns.date < end)
    }

    private static func name(of person: PairDTO.Person?) -> String? {
        guard let person else { return nil }
        let parts = [person.lastName, person.firstName].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " ")
    }
}
