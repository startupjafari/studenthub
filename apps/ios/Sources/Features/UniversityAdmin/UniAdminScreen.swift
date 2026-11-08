import SwiftUI

/// Администратор вуза: обзор, аналитика, мастер настройки, оргструктура, аудитории и кампус, камеры, расписание, дисциплины.
///
/// Маршрут — `AppRoute.uniAdmin(_:)`. Перечень случаев — контракт с каталогами
/// других ролей: случаи можно добавлять, но не переименовывать и не удалять.
enum UniAdminScreen: Hashable {
    case dashboard
    case analytics
    case setup
    case faculties
    case specialties
    case groups
    case group(id: String)
    case rooms
    case campuses
    case cameras
    case schedule
    case courses

    var title: String {
        switch self {
        case .dashboard: return String(localized: "uadmin.screen.dashboard", defaultValue: "Обзор вуза")
        case .analytics: return String(localized: "uadmin.screen.analytics", defaultValue: "Аналитика")
        case .setup: return String(localized: "uadmin.screen.setup", defaultValue: "Настройка вуза")
        case .faculties: return String(localized: "uadmin.screen.faculties", defaultValue: "Факультеты")
        case .specialties: return String(localized: "uadmin.screen.specialties", defaultValue: "Специальности")
        case .groups: return String(localized: "uadmin.screen.groups", defaultValue: "Группы")
        case .group: return String(localized: "uadmin.screen.group", defaultValue: "Группа")
        case .rooms: return String(localized: "uadmin.screen.rooms", defaultValue: "Аудитории")
        case .campuses: return String(localized: "uadmin.screen.campuses", defaultValue: "Кампусы")
        case .cameras: return String(localized: "uadmin.screen.cameras", defaultValue: "Камеры")
        case .schedule: return String(localized: "uadmin.screen.schedule", defaultValue: "Расписание")
        case .courses: return String(localized: "uadmin.screen.courses", defaultValue: "Дисциплины")
        }
    }

    var symbol: String {
        switch self {
        case .dashboard: return "rectangle.3.group"
        case .analytics: return "chart.bar"
        case .setup: return "wand.and.stars"
        case .faculties: return "building.columns"
        case .specialties: return "list.bullet.indent"
        case .groups: return "person.3"
        case .group: return "person.3"
        case .rooms: return "door.left.hand.open"
        case .campuses: return "map"
        case .cameras: return "video"
        case .schedule: return "calendar"
        case .courses: return "book"
        }
    }

    @MainActor @ViewBuilder
    var destination: some View {
        PendingScreen(title: title, symbol: symbol)
    }

    /// «Разделы» администратора вуза — по группам меню веба (`UNIVERSITY_ADMIN_NAV`).
    static var workspace: [WorkspaceGroup] {
        func item(_ screen: UniAdminScreen, _ tint: Color) -> WorkspaceItem {
            WorkspaceItem(title: screen.title, symbol: screen.symbol, tint: tint, route: .uniAdmin(screen))
        }
        func admin(_ screen: AdminScreen, _ tint: Color) -> WorkspaceItem {
            WorkspaceItem(title: screen.title, symbol: screen.symbol, tint: tint, route: .admin(screen))
        }
        func staff(_ screen: StaffScreen, _ tint: Color) -> WorkspaceItem {
            WorkspaceItem(title: screen.title, symbol: screen.symbol, tint: tint, route: .staff(screen))
        }
        return [
            WorkspaceGroup(
                title: String(localized: "workspace.group.main", defaultValue: "Главное"),
                items: [item(.analytics, TileTint.green), item(.setup, TileTint.purple)]
            ),
            WorkspaceGroup(
                title: String(localized: "workspace.group.structure", defaultValue: "Структура"),
                items: [
                    item(.faculties, TileTint.indigo), item(.specialties, TileTint.blue), item(.groups, TileTint.teal),
                    item(.rooms, TileTint.orange), item(.campuses, TileTint.green), item(.cameras, TileTint.gray),
                ]
            ),
            WorkspaceGroup(
                title: String(localized: "workspace.group.study", defaultValue: "Учёба"),
                items: [item(.schedule, TileTint.red), item(.courses, TileTint.indigo)]
            ),
            WorkspaceGroup(
                title: String(localized: "workspace.group.people", defaultValue: "Люди"),
                items: [
                    admin(.invites, TileTint.green),
                    admin(.users(role: nil), TileTint.blue),
                    admin(.users(role: "STUDENT"), TileTint.teal),
                    admin(.users(role: "TEACHER"), TileTint.indigo),
                    admin(.users(role: "DEAN"), TileTint.purple),
                ]
            ),
            WorkspaceGroup(
                title: String(localized: "workspace.group.applications", defaultValue: "Заявки и документы"),
                items: [
                    staff(.applicationsQueue, TileTint.blue), staff(.serviceCatalog, TileTint.teal),
                    staff(.documentTypes, TileTint.orange), staff(.documentTemplates, TileTint.yellow),
                ]
            ),
            WorkspaceGroup(
                title: String(localized: "workspace.group.library", defaultValue: "Библиотека"),
                items: [
                    staff(.librarySettings, TileTint.yellow), staff(.libraryCatalog, TileTint.indigo),
                    staff(.libraryReports, TileTint.green), staff(.libraryJournal, TileTint.gray),
                ]
            ),
            WorkspaceGroup(
                title: String(localized: "workspace.group.communication", defaultValue: "Коммуникации"),
                items: [staff(.posts, TileTint.gray), staff(.events, TileTint.red)]
            ),
            WorkspaceGroup(
                title: String(localized: "workspace.group.control", defaultValue: "Контроль"),
                items: [
                    admin(.complaints, TileTint.red), admin(.audit, TileTint.gray),
                    staff(.documentJournal, TileTint.orange), staff(.securityJournals, TileTint.indigo),
                ]
            ),
            WorkspaceGroup(
                title: String(localized: "services.group.career", defaultValue: "Карьера"),
                items: CareerScreen.items(for: .universityAdmin)
            ),
        ]
    }
}
