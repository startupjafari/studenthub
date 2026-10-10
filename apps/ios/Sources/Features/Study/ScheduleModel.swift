import Foundation
import GRDB
import Observation

/// Расписание на экране.
///
/// Читает базу, как и чаты: расписание смотрят в коридоре и в метро, где связи
/// нет, и экран, который в этот момент показывает спиннер, бесполезен.
@Observable
final class ScheduleModel {
    /// День недели, выбранный человеком (1 — понедельник).
    private(set) var selectedDay: Int
    private(set) var parity: WeekParity
    private(set) var pairs: [PairRecord] = []
    private(set) var changes: [String: PairChangeRecord] = [:]
    private(set) var isRefreshing = false
    private(set) var failure: String?
    /// Когда последний раз удалось обновиться. Нужно на экране: «расписание от
    /// вторника» честнее, чем молча показанное старое.
    private(set) var syncedAt: Date?

    private let database: AppDatabase
    private let api: ScheduleFetching
    private let store: ScheduleStore
    private let calendar: Calendar

    private var pairsTask: Task<Void, Never>?
    private var changesTask: Task<Void, Never>?

    init(
        database: AppDatabase = AppServices.database,
        api: ScheduleFetching = ScheduleAPI(),
        store: ScheduleStore? = nil,
        calendar: Calendar = .current,
        now: Date = Date()
    ) {
        self.database = database
        self.api = api
        self.store = store ?? ScheduleStore(database: database)
        self.calendar = calendar
        selectedDay = Self.isoDay(of: now, calendar: calendar)
        parity = WeekParity.current(now)
        syncedAt = UserDefaults.standard.object(forKey: Self.syncedKey) as? Date
    }

    deinit {
        pairsTask?.cancel()
        changesTask?.cancel()
    }

    @MainActor
    func start() {
        observe()
    }

    @MainActor
    func select(day: Int) {
        guard day != selectedDay else { return }
        selectedDay = day
        observe()
    }

    /// Переключить чётность вручную: человек смотрит «следующую неделю» чаще, чем
    /// кажется, и ради этого не должен ждать понедельника.
    @MainActor
    func toggleParity() {
        parity = parity == .odd ? .even : .odd
        observe()
    }

    @MainActor
    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        do {
            try await store.save(try await api.schedule())
            let from = calendar.startOfDay(for: Date())
            let to = calendar.date(byAdding: .day, value: 14, to: from) ?? from
            try await store.save(changes: try await api.changes(from: from, to: to), from: from)
            syncedAt = Date()
            UserDefaults.standard.set(syncedAt, forKey: Self.syncedKey)
            failure = nil
        } catch {
            // Сеть недоступна — экран остаётся рабочим: он читает базу.
            failure = (error as? APIError)?.displayMessage
                ?? String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
        }
    }

    /// Пары выбранного дня с учётом чётности и разовых изменений.
    var visiblePairs: [SchedulePair] {
        pairs
            .filter { parity.includes(weekType: $0.weekType) }
            .map { SchedulePair(pair: $0, change: changes[$0.id]) }
            .sorted { $0.startTime < $1.startTime }
    }

    private static let syncedKey = "schedule.synced-at"

    @MainActor
    private func observe() {
        pairsTask?.cancel()
        changesTask?.cancel()

        let day = selectedDay
        let pairsRequest = store.pairs(dayOfWeek: day)
        let pairsObservation = ValueObservation.tracking { db in try pairsRequest.fetchAll(db) }
        pairsTask = Task { @MainActor [weak self, database] in
            for await rows in AsyncValues.stream(of: pairsObservation, in: database.reader) {
                self?.pairs = rows
            }
        }

        let date = dateOfSelectedDay()
        let changesRequest = store.changes(on: date, calendar: calendar)
        let changesObservation = ValueObservation.tracking { db in try changesRequest.fetchAll(db) }
        changesTask = Task { @MainActor [weak self, database] in
            for await rows in AsyncValues.stream(of: changesObservation, in: database.reader) {
                self?.changes = Dictionary(rows.map { ($0.pairId, $0) }, uniquingKeysWith: { first, _ in first })
            }
        }
    }

    /// Дата выбранного дня внутри текущей недели — по ней ищутся разовые изменения.
    private func dateOfSelectedDay() -> Date {
        let today = Date()
        let todayIndex = Self.isoDay(of: today, calendar: calendar)
        let shift = selectedDay - todayIndex
        return calendar.date(byAdding: .day, value: shift, to: calendar.startOfDay(for: today)) ?? today
    }

    /// Понедельник — 1, воскресенье — 7, как в контракте API.
    static func isoDay(of date: Date, calendar: Calendar) -> Int {
        let weekday = calendar.component(.weekday, from: date)
        return ((weekday + 5) % 7) + 1
    }
}

/// Пара вместе с разовым изменением, если оно есть.
struct SchedulePair: Identifiable, Equatable {
    let pair: PairRecord
    let change: PairChangeRecord?

    var id: String { pair.id }
    var isCancelled: Bool { change?.type == "CANCELLED" }
    var startTime: String { change?.newStartTime ?? pair.startTime }
    var endTime: String { change?.newEndTime ?? pair.endTime }
    /// Чем пара отличается от обычной: перенос, замена, другая аудитория.
    var changeNote: String? {
        guard let change else { return nil }
        if let note = change.note, !note.isEmpty { return note }
        switch change.type {
        case "CANCELLED": return String(localized: "schedule.cancelled", defaultValue: "Отменена")
        case "MOVED": return String(localized: "schedule.moved", defaultValue: "Перенесена")
        case "ROOM_CHANGED": return String(localized: "schedule.roomChanged", defaultValue: "Другая аудитория")
        case "SUBSTITUTED": return String(localized: "schedule.substituted", defaultValue: "Замена")
        default: return nil
        }
    }
}
