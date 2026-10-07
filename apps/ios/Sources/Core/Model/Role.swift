import Foundation

/// Роли платформы (PROJECT.md §2). Источник — реестр в `packages/shared-types`.
///
/// `unknown` нужен для совместимости со старыми сборками: роль на сервере может
/// появиться раньше, чем человек обновит приложение, и неизвестное значение не
/// должно ронять разбор токена — приложение просто не покажет чужие разделы.
enum Role: String, Decodable, Equatable {
    case platformAdmin = "PLATFORM_ADMIN"
    case platformModerator = "PLATFORM_MODERATOR"
    case universityAdmin = "UNIVERSITY_ADMIN"
    case universityModerator = "UNIVERSITY_MODERATOR"
    case dean = "DEAN"
    case teacher = "TEACHER"
    case starosta = "STAROSTA"
    case student = "STUDENT"
    case employer = "EMPLOYER"
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Role(rawValue: raw) ?? .unknown
    }

    /// Роли, ради которых делается приложение (план, раздел «Область и границы»).
    /// Остальные продолжают работать в вебе.
    var isSupportedOnPhone: Bool {
        self == .student || self == .starosta || self == .teacher
    }
}
