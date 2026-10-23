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

    static func current(_ date: Date = Date(), calendar: Calendar = .iso8601UTC) -> WeekParity {
        weekNumber(of: date, calendar: calendar) % 2 == 1 ? .odd : .even
    }

    /// Номер ISO-недели.
    static func weekNumber(of date: Date, calendar: Calendar = .iso8601UTC) -> Int {
        var calendar = calendar
        calendar.timeZone = TimeZone(identifier: "UTC") ?? calendar.timeZone
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
