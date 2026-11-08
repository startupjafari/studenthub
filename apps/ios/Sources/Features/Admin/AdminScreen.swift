import SwiftUI

/// Администрирование и модерация: обзоры платформы и модераторов, жалобы, журнал аудита, пользователи, приглашения, поддержка, статистика, вузы, заявки на демо, доступ к документам, каталог услуг платформы, события платформы, модерация публикаций и кампуса.
///
/// Маршрут — `AppRoute.admin(_:)`. Перечень случаев — контракт с каталогами
/// других ролей: случаи можно добавлять, но не переименовывать и не удалять.
enum AdminScreen: Hashable {
    case platformDashboard
    case platformModeratorDashboard
    case universityModeratorDashboard
    case complaints
    case complaint(id: String)
    case audit
    case users(role: String?)
    case user(id: String)
    case invites
    case support
    case supportTicket(id: String)
    case stats
    case postsModeration
    case universities
    case university(id: String)
    case demoRequests
    case documentAccess
    case platformServices
    case platformEvents
    case campusModeration
    /// Карточка заявки вуза на демо.
    case demoRequest(id: String)

    var title: String {
        switch self {
        case .platformDashboard: return String(localized: "admin.screen.platformDashboard", defaultValue: "Обзор платформы")
        case .platformModeratorDashboard: return String(localized: "admin.screen.platformModeratorDashboard", defaultValue: "Обзор модератора")
        case .universityModeratorDashboard: return String(localized: "admin.screen.universityModeratorDashboard", defaultValue: "Обзор модератора вуза")
        case .complaints: return String(localized: "admin.screen.complaints", defaultValue: "Жалобы")
        case .complaint: return String(localized: "admin.screen.complaint", defaultValue: "Жалоба")
        case .audit: return String(localized: "admin.screen.audit", defaultValue: "Журнал аудита")
        case .users(let role):
            switch role {
            case "STUDENT": return String(localized: "admin.screen.users.students", defaultValue: "Студенты")
            case "TEACHER": return String(localized: "admin.screen.users.teachers", defaultValue: "Преподаватели")
            case "DEAN": return String(localized: "admin.screen.users.deans", defaultValue: "Деканы")
            default: return String(localized: "admin.screen.users", defaultValue: "Пользователи")
            }
        case .user: return String(localized: "admin.screen.user", defaultValue: "Пользователь")
        case .invites: return String(localized: "admin.screen.invites", defaultValue: "Приглашения")
        case .support: return String(localized: "admin.screen.support", defaultValue: "Поддержка")
        case .supportTicket: return String(localized: "admin.screen.supportTicket", defaultValue: "Обращение")
        case .stats: return String(localized: "admin.screen.stats", defaultValue: "Статистика")
        case .postsModeration: return String(localized: "admin.screen.postsModeration", defaultValue: "Публикации")
        case .universities: return String(localized: "admin.screen.universities", defaultValue: "Вузы")
        case .university: return String(localized: "admin.screen.university", defaultValue: "Вуз")
        case .demoRequests: return String(localized: "admin.screen.demoRequests", defaultValue: "Заявки на демо")
        case .documentAccess: return String(localized: "admin.screen.documentAccess", defaultValue: "Доступ к документам")
        case .platformServices: return String(localized: "admin.screen.platformServices", defaultValue: "Каталог услуг")
        case .platformEvents: return String(localized: "admin.screen.platformEvents", defaultValue: "События")
        case .campusModeration: return String(localized: "admin.screen.campusModeration", defaultValue: "Кампус")
        case .demoRequest: return String(localized: "admin.screen.demoRequest", defaultValue: "Заявка вуза")
        }
    }

    var symbol: String {
        switch self {
        case .platformDashboard: return "rectangle.3.group"
        case .platformModeratorDashboard: return "rectangle.3.group"
        case .universityModeratorDashboard: return "rectangle.3.group"
        case .complaints: return "exclamationmark.bubble"
        case .complaint: return "exclamationmark.bubble"
        case .audit: return "scroll"
        case .users: return "person.2"
        case .user: return "person"
        case .invites: return "paperplane"
        case .support: return "lifepreserver"
        case .supportTicket: return "lifepreserver"
        case .stats: return "chart.bar"
        case .postsModeration: return "newspaper"
        case .universities: return "building.columns"
        case .university: return "building.columns"
        case .demoRequests: return "envelope.open"
        case .documentAccess: return "lock.doc"
        case .platformServices: return "square.grid.2x2"
        case .platformEvents: return "calendar.badge.clock"
        case .campusModeration: return "map"
        case .demoRequest: return "envelope.open"
        }
    }

    @MainActor @ViewBuilder
    var destination: some View {
        switch self {
        case .platformDashboard, .platformModeratorDashboard: AdminPlatformDashboardView()
        case .universityModeratorDashboard: AdminUniversityModeratorDashboardView()
        case .stats: AdminPlatformStatsView()
        case .complaints: AdminComplaintsView()
        case .complaint(let id): AdminComplaintView(id: id)
        case .audit: AdminAuditView()
        case .users(let role): AdminUsersView(role: role)
        case .user(let id): AdminUserView(id: id)
        case .invites: AdminInvitesView()
        case .support: AdminSupportView()
        case .supportTicket(let id): AdminSupportTicketView(id: id)
        case .universities: AdminUniversitiesView()
        case .university(let id): AdminUniversityView(id: id)
        case .demoRequests: AdminDemoRequestsView()
        case .demoRequest(let id): AdminDemoRequestView(id: id)
        case .postsModeration: AdminPostsModerationView()
        case .documentAccess: AdminDocumentAccessView()
        // Тот же экран, что у сотрудников вуза (`EventsView`, `ServiceCatalogView`,
        // `CampusListView` в вебе): права и охват решает сервер по роли.
        case .platformEvents: StaffScreen.events.destination
        case .platformServices: StaffScreen.serviceCatalog.destination
        case .campusModeration: UniAdminScreen.campuses.destination
        }
    }

    /// «Разделы» модераторов и администратора платформы — по их меню в вебе.
    static func workspace(for role: Role) -> [WorkspaceGroup] {
        func item(_ screen: AdminScreen, _ tint: Color) -> WorkspaceItem {
            WorkspaceItem(title: screen.title, symbol: screen.symbol, tint: tint, route: .admin(screen))
        }
        switch role {
        case .platformAdmin:
            return [
                WorkspaceGroup(
                    title: String(localized: "workspace.group.platform", defaultValue: "Платформа"),
                    items: [
                        item(.universities, TileTint.indigo), item(.demoRequests, TileTint.teal),
                        item(.users(role: nil), TileTint.blue), item(.invites, TileTint.green),
                        item(.platformEvents, TileTint.red), item(.platformServices, TileTint.teal),
                    ]
                ),
                WorkspaceGroup(
                    title: String(localized: "workspace.group.control", defaultValue: "Контроль"),
                    items: [
                        item(.complaints, TileTint.red), item(.support, TileTint.orange), item(.stats, TileTint.green),
                        item(.audit, TileTint.gray), item(.documentAccess, TileTint.purple),
                    ]
                ),
                WorkspaceGroup(
                    title: String(localized: "services.group.career", defaultValue: "Карьера"),
                    items: CareerScreen.items(for: role)
                ),
            ]
        case .platformModerator:
            return [
                WorkspaceGroup(
                    title: String(localized: "workspace.group.moderation", defaultValue: "Модерация"),
                    items: [
                        item(.complaints, TileTint.red), item(.support, TileTint.orange), item(.postsModeration, TileTint.gray),
                        item(.users(role: nil), TileTint.blue), item(.stats, TileTint.green), item(.audit, TileTint.gray),
                    ]
                ),
                WorkspaceGroup(
                    title: String(localized: "services.group.career", defaultValue: "Карьера"),
                    items: CareerScreen.items(for: role)
                ),
            ]
        default:
            return [
                WorkspaceGroup(
                    title: String(localized: "workspace.group.moderation", defaultValue: "Модерация"),
                    items: [
                        item(.complaints, TileTint.red),
                        WorkspaceItem(title: StaffScreen.applicationsQueue.title, symbol: StaffScreen.applicationsQueue.symbol, tint: TileTint.blue, route: .staff(.applicationsQueue)),
                        item(.postsModeration, TileTint.gray), item(.users(role: nil), TileTint.blue),
                        item(.campusModeration, TileTint.green), item(.audit, TileTint.gray),
                    ]
                ),
                WorkspaceGroup(
                    title: String(localized: "services.group.career", defaultValue: "Карьера"),
                    items: CareerScreen.items(for: role)
                ),
            ]
        }
    }
}
