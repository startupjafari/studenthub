import Foundation

/// Роли платформы (PROJECT.md §2). Источник — реестр в `packages/shared-types`.
///
/// `unknown` нужен для совместимости со старыми сборками: роль на сервере может
/// появиться раньше, чем человек обновит приложение, и неизвестное значение не
/// должно ронять разбор токена — приложение просто не покажет чужие разделы.
enum Role: String, Decodable, Equatable, CaseIterable, Sendable {
    case platformAdmin = "PLATFORM_ADMIN"
    case platformModerator = "PLATFORM_MODERATOR"
    case universityAdmin = "UNIVERSITY_ADMIN"
    case universityModerator = "UNIVERSITY_MODERATOR"
    case dean = "DEAN"
    case teacher = "TEACHER"
    case starosta = "STAROSTA"
    case student = "STUDENT"
    case employer = "EMPLOYER"
    /// Роли с запретом по умолчанию (`RESTRICTED_ROLES`): только свои разделы, без
    /// ленты и чатов.
    case securityGuard = "SECURITY_GUARD"
    case librarian = "LIBRARIAN"
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Role(rawValue: raw) ?? .unknown
    }

    /// Приложение ведёт все роли платформы, как и веб. Неизвестную роль — нет: её
    /// разделов сборка не знает, и честнее отправить человека в браузер.
    var isSupportedOnPhone: Bool {
        self != .unknown
    }

    /// Учебные роли: их «Разделы» начинаются с учёбы, «Главная» — их учебный день.
    var isAcademic: Bool {
        self == .student || self == .starosta || self == .teacher
    }

    /// Роли с запретом по умолчанию: ни ленты, ни чатов (`hasChats` в вебе).
    var isRestricted: Bool {
        self == .securityGuard || self == .librarian
    }

    /// Сотрудники вуза и платформы, разбирающие заявки, жалобы и прочие очереди.
    var isStaff: Bool {
        switch self {
        case .platformAdmin, .platformModerator, .universityAdmin, .universityModerator, .dean:
            return true
        default:
            return false
        }
    }

    /// Роль платформы, а не вуза: своего вуза у неё нет.
    var isPlatform: Bool {
        self == .platformAdmin || self == .platformModerator
    }

    var title: String {
        switch self {
        case .platformAdmin: return String(localized: "role.platformAdmin", defaultValue: "Администратор платформы")
        case .platformModerator: return String(localized: "role.platformModerator", defaultValue: "Модератор платформы")
        case .universityAdmin: return String(localized: "role.universityAdmin", defaultValue: "Администратор вуза")
        case .universityModerator: return String(localized: "role.universityModerator", defaultValue: "Модератор вуза")
        case .dean: return String(localized: "role.dean", defaultValue: "Деканат")
        case .teacher: return String(localized: "role.teacher", defaultValue: "Преподаватель")
        case .starosta: return String(localized: "role.starosta", defaultValue: "Староста")
        case .student: return String(localized: "role.student", defaultValue: "Студент")
        case .employer: return String(localized: "role.employer", defaultValue: "Работодатель")
        case .securityGuard: return String(localized: "role.securityGuard", defaultValue: "Охрана")
        case .librarian: return String(localized: "role.librarian", defaultValue: "Библиотекарь")
        case .unknown: return String(localized: "role.unknown", defaultValue: "Пользователь")
        }
    }
}
