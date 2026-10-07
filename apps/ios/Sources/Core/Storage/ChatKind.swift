import Foundation

/// Тип чата (PROJECT.md §3.6). Значения те же, что в `ChatType` на сервере.
///
/// `unknown` — не перестраховка: новый тип чата появится на сервере раньше, чем
/// человек обновит приложение, и неизвестная строка не должна ронять разбор списка.
/// Такой чат просто покажется без особого оформления.
///
/// В базе лежит строкой, а не этим типом: в столбце может оказаться значение,
/// которого в сборке ещё нет, и разбор строки обязан это пережить.
enum ChatKind: String, Decodable, Equatable, CaseIterable {
    case `private` = "PRIVATE"
    case group = "GROUP"
    case groupOfficial = "GROUP_OFFICIAL"
    case subject = "SUBJECT"
    case faculty = "FACULTY"
    case dean = "DEAN"
    case support = "SUPPORT"
    case supportPlatform = "SUPPORT_PLATFORM"
    case event = "EVENT"
    case saved = "SAVED"
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ChatKind(rawValue: raw) ?? .unknown
    }

    /// Разбор значения из базы или из ответа API.
    static func from(_ raw: String) -> ChatKind {
        ChatKind(rawValue: raw) ?? .unknown
    }

    /// Официальные чаты заводит система: названия и состава в них не меняют.
    var isOfficial: Bool {
        switch self {
        case .groupOfficial, .subject, .faculty, .dean, .support, .supportPlatform, .event:
            return true
        case .private, .group, .saved, .unknown:
            return false
        }
    }
}
