import Foundation

/// Общие разделы учебных ролей во вкладке «Разделы».
///
/// Здесь роль и решает состав: студенту — деканат и его заявки, старосте к ним —
/// его группа, преподавателю — дисциплины и группы. Список один и тот же и для
/// экрана, и для разбора диплинка — иначе ссылка открывала бы раздел, которого у
/// роли нет.
enum MoreSection: String, CaseIterable, Identifiable, Hashable {
    case profile
    case applications
    case events
    case documents
    case settings
    /// Расписание: у учебных ролей — своё, у декана — расписание факультета.
    case schedule
    /// Староста.
    case classmates
    /// Преподаватель.
    case subjects
    case groups
    /// Учёба: группа «Учёба» в «Разделах».
    case grades
    case attendance
    case assignments
    case materials
    case notifications
    case serviceCatalog
    /// Библиотека вуза: студент и староста. Пункт за модулем — см. `modules(for:)`.
    case library
    /// Консультации преподавателей: студент записывается, преподаватель открывает окна.
    case consultations
    /// Запись в деканат — только студент и староста (`/deanery-appointments`).
    case deanery
    case portfolio
    case campusMap

    var id: String { rawValue }

    /// Общие для всех ролей MVP.
    static let common: [MoreSection] = [
        .profile, .applications, .serviceCatalog, .events, .documents, .consultations, .portfolio, .campusMap,
        .settings,
    ]

    /// Сотрудники и работодатель: общий аккаунт, документы, события и карта.
    private static let staff: [MoreSection] = [.profile, .settings, .documents, .events, .campusMap, .applications]

    static func sections(for role: Role) -> [MoreSection] {
        switch role {
        case .student:
            return common + [.schedule, .deanery]
        case .starosta:
            return common + [.schedule, .deanery, .classmates]
        case .teacher:
            return common + [.schedule, .subjects, .groups]
        case .securityGuard, .librarian:
            // Роли с запретом по умолчанию: только свой аккаунт и карта (у охраны).
            return role == .securityGuard ? [.profile, .settings, .campusMap] : [.profile, .settings]
        case .unknown:
            return []
        case .dean:
            // Расписание факультета — раздел «Разделов», а не вкладка.
            return staff + [.schedule]
        default:
            return staff
        }
    }

    /// Разделы за модулем вуза: роль даёт право, а пункт в списке появляется, только
    /// когда вуз модуль включил. Диплинк в такой раздел роль пропускает — выключенный
    /// модуль экран объяснит сам, а не браузер.
    static func modules(for role: Role) -> [MoreSection] {
        switch role {
        case .student, .starosta:
            return [.library]
        default:
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
        case .schedule:
            return String(localized: "tab.schedule", defaultValue: "Расписание")
        case .classmates:
            return String(localized: "more.classmates", defaultValue: "Одногруппники")
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
        case .notifications:
            return String(localized: "home.notifications", defaultValue: "Уведомления")
        case .serviceCatalog:
            return String(localized: "applications.catalog", defaultValue: "Каталог услуг")
        case .library:
            return String(localized: "library.title", defaultValue: "Библиотека")
        case .consultations:
            return String(localized: "services.consultations", defaultValue: "Консультации")
        case .deanery:
            return String(localized: "services.deanery", defaultValue: "Деканат")
        case .portfolio:
            return String(localized: "services.portfolio", defaultValue: "Портфолио")
        case .campusMap:
            return String(localized: "services.campusMap", defaultValue: "Карта кампуса")
        }
    }

    var symbol: String {
        switch self {
        case .profile: return "person.crop.circle"
        case .applications: return "doc.text"
        case .events: return "calendar.badge.clock"
        case .documents: return "folder"
        case .settings: return "gearshape"
        case .schedule: return "calendar"
        case .classmates: return "person.3"
        case .subjects: return "book"
        case .groups: return "person.2"
        case .grades: return "graduationcap"
        case .attendance: return "checkmark.circle"
        case .assignments: return "list.clipboard"
        case .materials: return "folder"
        case .notifications: return "bell"
        case .serviceCatalog: return "square.grid.2x2"
        case .library: return "books.vertical"
        case .consultations: return "person.2.wave.2"
        case .deanery: return "building.columns"
        case .portfolio: return "briefcase"
        case .campusMap: return "map"
        }
    }
}
