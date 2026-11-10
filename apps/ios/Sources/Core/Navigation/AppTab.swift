import Foundation

/// Вкладки оболочки.
///
/// Устройство одно на все роли: «Главная» — личная точка входа роли, «Чаты», «Разделы» —
/// весь каталог функций роли с поиском, «Лента» — соцчасть вуза, «Поиск» людей и событий.
/// Роль решает только, какие из них у неё есть (`tabs(for:)`), и что лежит на «Главной».
///
/// Расписание, учёба и сервисы — не вкладки, а группы «Разделов»: пять вкладок — предел
/// панели iPhone, а шестая уезжала бы в системное «Ещё». Ближайшие пары при этом на
/// «Главной», в одном касании от запуска.
enum AppTab: String, CaseIterable, Identifiable, Hashable {
    /// Личная главная роли: у студента — день, сроки, заявки; у преподавателя — его
    /// рабочий день; у сотрудников — обзор роли, как `ROLE_HOME` в вебе.
    case home
    case chats
    /// Все разделы роли, сгруппированные как в боковом меню веба.
    case workspace
    /// Лента вуза: истории, публикации, заявки в друзья.
    case feed
    /// Поиск людей и событий. На iOS 18+ — отдельная кнопка у края панели вкладок
    /// (`Tab(role: .search)`), на iOS 26 — стеклянный круг, в который превращается поле
    /// поиска. На iOS 17 вкладки нет: поиск открывается из верхней панели ленты.
    case search

    var id: AppTab { self }

    /// Вкладки роли по порядку. Роли с запретом по умолчанию — без чатов и ленты, как
    /// в вебе (`hasChats`, `RESTRICTED_ROLE_PATHS`).
    static func tabs(for role: Role) -> [AppTab] {
        let base = baseTabs(for: role)
        // Поиск — у ролей с лентой: люди и события вуза. Роли платформы и работодатель
        // своего вуза не имеют, охране и библиотеке поиск не открыт.
        guard base.contains(.feed), #available(iOS 18, *) else { return base }
        return base + [.search]
    }

    private static func baseTabs(for role: Role) -> [AppTab] {
        switch role {
        case .student, .starosta, .teacher, .dean, .universityAdmin, .universityModerator:
            return [.home, .chats, .workspace, .feed]
        case .platformAdmin, .platformModerator, .employer:
            return [.home, .chats, .workspace]
        case .securityGuard, .librarian:
            return [.home, .workspace]
        case .unknown:
            return [.home]
        }
    }

    /// Куда открыть ссылку, если у роли нет нужной вкладки: ленты у администратора
    /// платформы нет, и пост из пуша откроется поверх «Главной».
    static func resolve(_ tab: AppTab, for role: Role) -> AppTab {
        let available = tabs(for: role)
        if available.contains(tab) { return tab }
        if tab == .search, available.contains(.feed) { return .feed }
        return available.first ?? .home
    }

    var title: String {
        switch self {
        case .home:
            return String(localized: "tab.home", defaultValue: "Главная")
        case .chats:
            return String(localized: "tab.chats", defaultValue: "Чаты")
        case .workspace:
            return String(localized: "tab.workspace", defaultValue: "Разделы")
        case .feed:
            return String(localized: "tab.feed", defaultValue: "Лента")
        case .search:
            return String(localized: "tab.search", defaultValue: "Поиск")
        }
    }

    /// Системные символы, а не свои иконки: в панели вкладок они совпадают по весу
    /// и оптическому размеру с остальной системой и живут во всех кеглях.
    var symbol: String {
        switch self {
        case .home: return "house"
        case .chats: return "bubble.left.and.bubble.right"
        case .workspace: return "square.grid.2x2"
        case .feed: return "newspaper"
        case .search: return "magnifyingglass"
        }
    }
}
