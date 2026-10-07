import Foundation

/// Чётность учебной недели.
///
/// Считается ровно так же, как в вебе (`apps/web/src/shared/lib/tz-date.ts`,
/// `isoWeekParity`), и это главное требование: разойдись правило на неделю — и у
/// человека в приложении и в браузере окажутся разные пары. Доверие к расписанию
/// теряется с первого такого случая.
///
/// ВАЖНО. Формула веба **не совпадает** с ISO 8601: в ней опущена поправка на день
/// недели 4 января, поэтому в годах, где 4 января не четверг, номер недели на
/// единицу меньше стандартного — в 2026-м расхождение сплошное. Здесь это
/// воспроизведено намеренно: приложение обязано показывать то же, что веб. Чинить
/// надо оба места сразу и только после того, как вуз подтвердит, какие недели у
/// него считаются нечётными, — иначе у всех разом сдвинется расписание.
enum WeekParity: String, Equatable {
    case odd = "ODD"
    case even = "EVEN"

    static func current(_ date: Date = Date(), calendar: Calendar = .iso8601UTC) -> WeekParity {
        weekNumber(of: date, calendar: calendar) % 2 == 1 ? .odd : .even
    }

    /// Номер недели по формуле веба.
    static func weekNumber(of date: Date, calendar: Calendar = .iso8601UTC) -> Int {
        var calendar = calendar
        calendar.timeZone = TimeZone(identifier: "UTC") ?? calendar.timeZone

        // Четверг той же недели: от него считают номер во всех вариантах алгоритма.
        let weekday = calendar.component(.weekday, from: date)
        let mondayBased = (weekday + 5) % 7
        guard
            let thursday = calendar.date(byAdding: .day, value: 3 - mondayBased, to: date),
            let anchor = calendar.date(
                from: DateComponents(year: calendar.component(.year, from: thursday), month: 1, day: 4)
            )
        else { return 1 }

        let days = calendar.dateComponents([.day], from: anchor, to: thursday).day ?? 0
        return 1 + Int(((Double(days) - 3) / 7).rounded())
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
