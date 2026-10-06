import Foundation

/// Разделы вкладки «Ещё».
///
/// Здесь роль и решает состав: у студента пять пунктов, у старосты к ним добавляется
/// его группа, у преподавателя — предметы и группы. Список один и тот же и для
/// экрана, и для разбора диплинка — иначе ссылка открывала бы раздел, которого у
/// роли нет.
enum MoreSection: String, CaseIterable, Identifiable, Hashable {
    case profile
    case applications
    case events
    case documents
    case settings
    /// Староста.
    case classmates
    case groupRequests
    /// Преподаватель.
    case subjects
    case groups
    /// Разделы вкладки «Учёба». В списке «Ещё» их нет — там они были бы вторым
    /// входом в то же место, но маршрут им нужен такой же.
    case grades
    case attendance
    case assignments
    case materials

    var id: String { rawValue }

    /// Общие для всех ролей MVP.
    static let common: [MoreSection] = [.profile, .applications, .events, .documents, .settings]

    static func sections(for role: Role) -> [MoreSection] {
        switch role {
        case .student:
            return common
        case .starosta:
            return common + [.classmates, .groupRequests]
        case .teacher:
            return common + [.subjects, .groups]
        default:
            // Роли вне MVP приложение не ведёт — им остаётся веб.
            return []
        }
    }

    var title: String {
        switch self {
        case .profile:
            return String(localized: "more.profile", defaultValue: "Профиль")
        case .applications:
            return String(localized: "more.applications", defaultValue: "Заявки")
        case .events:
            return String(localized: "more.events", defaultValue: "События")
        case .documents:
            return String(localized: "more.documents", defaultValue: "Документы")
        case .settings:
            return String(localized: "more.settings", defaultValue: "Настройки")
        case .classmates:
            return String(localized: "more.classmates", defaultValue: "Одногруппники")
        case .groupRequests:
            return String(localized: "more.groupRequests", defaultValue: "Обращения группы")
        case .subjects:
            return String(localized: "more.subjects", defaultValue: "Дисциплины")
        case .groups:
            return String(localized: "more.groups", defaultValue: "Группы")
        case .grades:
            return String(localized: "study.grades", defaultValue: "Оценки")
        case .attendance:
            return String(localized: "study.attendance", defaultValue: "Посещаемость")
        case .assignments:
            return String(localized: "study.assignments", defaultValue: "Задания")
        case .materials:
            return String(localized: "study.materials", defaultValue: "Материалы")
        }
    }

    var symbol: String {
        switch self {
        case .profile: return "person.crop.circle"
        case .applications: return "doc.text"
        case .events: return "calendar.badge.clock"
        case .documents: return "folder"
        case .settings: return "gearshape"
        case .classmates: return "person.3"
        case .groupRequests: return "tray.full"
        case .subjects: return "book"
        case .groups: return "person.2"
        case .grades: return "graduationcap"
        case .attendance: return "checkmark.circle"
        case .assignments: return "list.clipboard"
        case .materials: return "folder"
        }
    }
}
