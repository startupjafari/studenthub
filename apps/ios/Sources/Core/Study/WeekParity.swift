import Foundation

/// Чётность учебной недели.
///
/// Считается по номеру ISO-недели — ровно так же, как в вебе
/// (`shared/lib/tz-date.ts`). Это важнее, чем кажется: разойдись правило на день,
/// и у человека в приложении и в браузере будут разные пары, а доверие к
/// расписанию теряется с первого такого случая.
enum WeekParity: String, Equatable {
    case odd = "ODD"
    case even = "EVEN"

    static func current(_ date: Date = Date(), calendar: Calendar = .iso8601UTC) -> WeekParity {
        let week = calendar.component(.weekOfYear, from: date)
        return week % 2 == 1 ? .odd : .even
    }

    /// Идёт ли пара на этой неделе. `BOTH` — каждую.
    func includes(weekType: String) -> Bool {
        weekType == "BOTH" || weekType == rawValue
    }
}

extension Calendar {
    /// Календарь для номера недели: ISO-8601, недели с понедельника, первая неделя
    /// года — та, где четверг.
    static let iso8601UTC: Calendar = {
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
        return calendar
    }()
}
