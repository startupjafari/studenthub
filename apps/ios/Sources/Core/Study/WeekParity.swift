import Foundation

/// Чётность учебной недели.
///
/// Считается ровно так же, как в вебе (`apps/web/src/shared/lib/tz-date.ts`,
/// `isoWeekParity`) и в Android, и это главное требование: разойдись правило на неделю —
/// и у человека в приложении и в браузере окажутся разные пары. Доверие к расписанию
/// теряется с первого такого случая.
///
/// Номер недели — по ISO 8601 (недели с понедельника, первая — с первым четвергом года).
/// Раньше все клиенты повторяли формулу веба без поправки на день недели 4 января и в
/// таких годах (весь 2026-й) отставали на неделю; исправлено во всех трёх местах разом.
enum WeekParity: String, Equatable {
    case odd = "ODD"
    case even = "EVEN"

    /// Чётность недели, в которую попадает `date` по календарю пояса `timeZone` — пояса
    /// вуза (`ScheduleDTO.timezone`), как в вебе и Android. По UTC с 00:00 до 05:00
    /// понедельника в Казахстане показывалась бы чётность прошлой недели.
    static func current(_ date: Date = Date(), in timeZone: TimeZone = .current) -> WeekParity {
        weekNumber(of: date, in: timeZone) % 2 == 1 ? .odd : .even
    }

    /// Номер ISO-недели календарной даты `date` в поясе `timeZone`.
    static func weekNumber(
        of date: Date,
        in timeZone: TimeZone = .current,
        calendar: Calendar = Calendar(identifier: .iso8601)
    ) -> Int {
        var calendar = calendar
        calendar.timeZone = timeZone
        // Правила ISO задаём явно: переданный календарь мог быть и не `.iso8601`.
        calendar.firstWeekday = 2
        calendar.minimumDaysInFirstWeek = 4
        return calendar.component(.weekOfYear, from: date)
    }

    /// Идёт ли пара на этой неделе. `BOTH` — каждую.
    func includes(weekType: String) -> Bool {
        weekType == "BOTH" || weekType == rawValue
    }
}

extension Calendar {
    /// Календарь для номера недели: ISO-8601, недели с понедельника.
    static let iso8601UTC: Calendar = {
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
        return calendar
    }()
}
