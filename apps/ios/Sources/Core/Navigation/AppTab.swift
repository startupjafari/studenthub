import Foundation

/// Вкладки оболочки.
///
/// Учебные роли (студент, староста, преподаватель) живут в пяти вкладках: главная,
/// расписание, чаты, учёба, сервисы. У сотрудников вуза и платформы, работодателя,
/// охраны и библиотеки своя главная — «Обзор» (как дашборд роли в вебе, `ROLE_HOME`),
/// а все разделы меню веба собраны во вкладке «Разделы». Состав решает роль
/// (`tabs(for:)`), устройство одно на всех.
enum AppTab: String, CaseIterable, Identifiable, Hashable {
    case home
    case schedule
    case chats
    case study
    /// Сервисы вуза: каталог разделов веба, сгруппированный по смыслу.
    case services
    /// Обзор роли: дашборд деканата, администратора, модератора, работодателя, поста
    /// охраны, библиотеки.
    case dashboard
    /// Все разделы меню роли, сгруппированные как в боковом меню веба.
    case workspace
    /// Поиск людей и событий. На iOS 18+ — отдельная кнопка у края панели вкладок
    /// (`Tab(role: .search)`), на iOS 26 — стеклянный круг, в который превращается поле
    /// поиска. На iOS 17 вкладки нет: поиск открывается из верхней панели главной.
    case search

    var id: AppTab { self }

    /// Вкладки роли по порядку. Роли с запретом по умолчанию — без чатов и ленты, как
    /// в вебе (`hasChats`, `RESTRICTED_ROLE_PATHS`).
    static func tabs(for role: Role) -> [AppTab] {
        let base = baseTabs(for: role)
        // Поиск — у ролей с лентой: люди и события вуза. Роли платформы и работодатель
        // своего вуза не имеют, охране и библиотеке поиск не открыт.
        guard base.contains(.home), #available(iOS 18, *) else { return base }
        return base + [.search]
    }

    private static func baseTabs(for role: Role) -> [AppTab] {
        switch role {
        case .student, .starosta, .teacher:
            return [.home, .schedule, .chats, .study, .services]
        case .dean:
            return [.dashboard, .schedule, .chats, .workspace, .home]
        case .universityAdmin, .universityModerator:
            return [.dashboard, .chats, .workspace, .home]
        case .platformAdmin, .platformModerator, .employer:
            return [.dashboard, .chats, .workspace]
        case .securityGuard, .librarian:
            return [.dashboard, .workspace]
        case .unknown:
            return [.home]
        }
    }

    /// Куда открыть ссылку, если у роли нет нужной вкладки: лента у администратора
    /// платформы не живёт, и пост из пуша откроется поверх «Разделов».
    static func resolve(_ tab: AppTab, for role: Role) -> AppTab {
        let available = tabs(for: role)
        if available.contains(tab) { return tab }
        switch tab {
        case .services, .study:
            if available.contains(.workspace) { return .workspace }
        case .home:
            if available.contains(.dashboard) { return .dashboard }
        default:
            break
        }
        return available.first ?? .home
    }

    var title: String {
        switch self {
        case .home:
            return String(localized: "tab.home", defaultValue: "Главная")
        case .schedule:
            return String(localized: "tab.schedule", defaultValue: "Расписание")
        case .chats:
            return String(localized: "tab.chats", defaultValue: "Чаты")
        case .study:
            return String(localized: "tab.study", defaultValue: "Учёба")
        case .services:
            return String(localized: "tab.services", defaultValue: "Сервисы")
        case .dashboard:
            return String(localized: "tab.dashboard", defaultValue: "Обзор")
        case .workspace:
            return String(localized: "tab.workspace", defaultValue: "Разделы")
        case .search:
            return String(localized: "tab.search", defaultValue: "Поиск")
        }
    }

    /// Подпись вкладки у роли. Главная сотрудника — это лента вуза, а не его стартовый
    /// экран: стартовый у него «Обзор».
    func title(for role: Role) -> String {
        if self == .home, !role.isAcademic {
            return String(localized: "tab.feed", defaultValue: "Лента")
        }
        return title
    }

    /// Системные символы, а не свои иконки: в панели вкладок они совпадают по весу
    /// и оптическому размеру с остальной системой и живут во всех кеглях.
    var symbol: String {
        switch self {
        case .home: return "house"
        case .schedule: return "calendar"
        case .chats: return "bubble.left.and.bubble.right"
        case .study: return "graduationcap"
        case .services: return "square.grid.2x2"
        case .dashboard: return "rectangle.3.group"
        case .workspace: return "square.grid.2x2"
        case .search: return "magnifyingglass"
        }
    }

    func symbol(for role: Role) -> String {
        if self == .home, !role.isAcademic { return "newspaper" }
        return symbol
    }
}
