import Foundation

/// Календарный день «ГГГГ-ММ-ДД» — общие форматтеры вместо нового `DateFormatter` на
/// каждый вызов (п. 49 аудита): его создание стоит дороже самого форматирования, а
/// звали его и внутри `filter`/`Dictionary(grouping:)`.
///
/// Календарь — григорианский, локаль — `en_US_POSIX`: так было во всех прежних местах
/// (где календарь не задавался, его задавала локаль POSIX), и так ждёт сервер.
/// Форматтер — на пояс и создаётся один раз. `DateFormatter` потокобезопасен, пока его не
/// меняют после создания; здесь его не меняют. Пояс берётся в момент вызова: сменил
/// человек пояс — получит другой форматтер, а не застрявший в старом.
enum DayString {
    /// День момента `date` в поясе `timeZone`.
    static func string(from date: Date, timeZone: TimeZone = .current) -> String {
        storage.formatter(for: timeZone).string(from: date)
    }

    /// Начало дня из строки «ГГГГ-ММ-ДД» (лишнее после десяти символов не читается).
    static func date(from day: String, timeZone: TimeZone = .current) -> Date? {
        storage.formatter(for: timeZone).date(from: String(day.prefix(10)))
    }

    /// Готовые форматтеры под замком: зовутся с любых потоков.
    private final class Storage: @unchecked Sendable {
        private let lock = NSLock()
        private var formatters: [String: DateFormatter] = [:]

        func formatter(for timeZone: TimeZone) -> DateFormatter {
            lock.withLock {
                if let known = formatters[timeZone.identifier] { return known }
                let formatter = DateFormatter()
                formatter.calendar = Calendar(identifier: .gregorian)
                formatter.locale = Locale(identifier: "en_US_POSIX")
                formatter.timeZone = timeZone
                formatter.dateFormat = "yyyy-MM-dd"
                formatters[timeZone.identifier] = formatter
                return formatter
            }
        }
    }

    private static let storage = Storage()
}
