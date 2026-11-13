import Foundation
import Observation

/// Шаг внутри вкладки. Hashable — требование `NavigationStack`: путь он хранит
/// значениями, а не экранами.
enum AppRoute: Hashable {
    case section(MoreSection)
    case chat(id: String)
    case post(id: String)
    case application(id: String)
    case event(id: String)
    /// Занятие. `date` — день, выбранный в расписании: отметка посещаемости ставится
    /// на него, а не на сегодня. Без даты (ссылка из пуша, «ближайшая пара») — сегодня.
    case lesson(id: String, date: Date? = nil)
    case assignment(id: String)
    case profile(id: String)
    case service(id: String)
    case myBooks
    /// Справка «задолженностей в библиотеке нет» — из «Моих книг».
    case libraryClearance
    case book(id: String)
    case bookCopy(code: String)
    /// Поиск людей и событий из верхней панели ленты (iOS 17: без вкладки поиска).
    case search
    /// Информация о чате: участники, содержимое, управление.
    case chatInfo(id: String)
    /// Аудитория на карте кампуса — из занятия в расписании.
    case campusRoom(roomID: String)
    /// Политика конфиденциальности или пользовательское соглашение.
    case legal(LegalDocument)

    // Экраны областей. Каждая область описывает свои экраны сама (`Features/<Область>`).
    case student(StudentScreen)
    case community(CommunityScreen)
    case teacher(TeacherScreen)
    case starosta(StarostaScreen)
    case career(CareerScreen)
    case dean(DeanScreen)
    case uniAdmin(UniAdminScreen)
    case staff(StaffScreen)
    case admin(AdminScreen)
    case security(SecurityScreen)
    case librarian(LibrarianScreen)
}

/// Навигация оболочки: выбранная вкладка и путь внутри каждой.
///
/// У каждой вкладки свой стек, а не один общий. Так устроен iOS: человек уходит из
/// чата в расписание и возвращается ровно в тот чат, а не к списку. Общий стек это
/// поведение теряет, и его потом не вернуть — путь уже затёрт.
@Observable
final class AppRouter {
    /// Выбранная вкладка переживает выгрузку приложения системой: вернулся человек из
    /// переключателя — он во вкладке, где был (в чатах), а не на главной, как после
    /// холодного старта. Поиск — мимолётный, его не восстанавливаем.
    var selectedTab: AppTab = AppRouter.restoredTab() {
        didSet { UserDefaults.standard.set(selectedTab.rawValue, forKey: Self.selectedTabKey) }
    }
    /// Путь каждой вкладки — свой наблюдаемый объект: переход в одной вкладке
    /// пересчитывает только её `NavigationStack`, а не стеки всех вкладок (P1-7 аудита).
    @ObservationIgnored private var paths: [AppTab: TabPath] = [:]

    /// Путь вкладки. Создаётся по первому запросу.
    @MainActor
    func path(for tab: AppTab) -> TabPath {
        if let known = paths[tab] { return known }
        let made = TabPath()
        paths[tab] = made
        return made
    }

    /// Все пути разом — для совместимости и тестов. Экраны берут `path(for:)` и методы
    /// ниже: чтение этого свойства подписывает на пути всех вкладок.
    @MainActor
    var stacks: [AppTab: [AppRoute]] {
        get { paths.compactMapValues { $0.routes.isEmpty ? nil : $0.routes } }
        set {
            for tab in Set(paths.keys).union(newValue.keys) {
                path(for: tab).routes = newValue[tab] ?? []
            }
        }
    }

    /// Открыть экран поверх текущей вкладки.
    @MainActor
    func push(_ route: AppRoute) {
        path(for: selectedTab).routes.append(route)
    }

    /// Открыть экран поверх стека указанной вкладки, не переключаясь на неё.
    @MainActor
    func push(_ route: AppRoute, in tab: AppTab) {
        path(for: tab).routes.append(route)
    }

    /// Вкладка чатов, сразу переписка — как «Написать» в профиле.
    @MainActor
    func openChat(id: String) {
        select(.chats)
        path(for: .chats).routes = [.chat(id: id)]
    }

    /// Вернуть вкладку к её корню.
    @MainActor
    func popToRoot(_ tab: AppTab) {
        path(for: tab).routes = []
    }

    /// Ссылка из уведомления, нажатого на холодном старте: роль ещё неизвестна (сессия
    /// поднимается), и открыть её сейчас значило бы отказать в разделах, которые у
    /// человека есть, — документах, библиотеке, событиях. Открывается, когда оболочка
    /// узнает роль (`openPending`).
    @ObservationIgnored private var pending: DeepLink?

    /// Отложить ссылку до подъёма сессии.
    @MainActor
    func postpone(_ link: DeepLink) {
        pending = link
    }

    /// Открыть отложенную ссылку — зовёт оболочка, когда роль уже известна.
    @MainActor
    func openPending(for role: Role) {
        guard let link = pending else { return }
        pending = nil
        open(link, for: role)
    }

    /// Выход из аккаунта: следующий человек начинает с главной, а не в открытом чате
    /// прежнего, и не получает его отложенную ссылку.
    @MainActor
    func reset() {
        selectedTab = .home
        for path in paths.values { path.routes = [] }
        pending = nil
    }

    private static let selectedTabKey = "app.selectedTab"

    private static func restoredTab() -> AppTab {
        let stored = UserDefaults.standard.string(forKey: selectedTabKey).flatMap(AppTab.init(rawValue:))
        guard let stored, stored != .search else { return .home }
        return stored
    }

    /// Открыть ссылку. `false` означает «не наше»: ссылка либо незнакомая, либо
    /// ведёт в раздел, которого у этой роли нет, — и тогда её открывает браузер.
    @MainActor
    @discardableResult
    func open(_ url: URL, for role: Role) -> Bool {
        // Сначала ссылки областей: они уже, чем общий разбор, и знают роль.
        if let area = AreaDeepLink(url: url, role: role) {
            currentRole = role
            push(area.tab, area.routes)
            return true
        }
        if let community = CommunityDeepLink(url: url) {
            currentRole = role
            push(community.tab, community.routes)
            return true
        }
        guard let link = DeepLink(url: url) else { return false }
        return open(link, for: role)
    }

    @MainActor
    @discardableResult
    func open(_ link: DeepLink, for role: Role) -> Bool {
        currentRole = role
        switch link {
        case .tab(let tab):
            select(AppTab.resolve(tab, for: role))
        case .section(let section):
            // Ссылка на чужой раздел не должна открывать пустой экран: у студента
            // нет обращений группы, и показать их ему нечем.
            guard
                MoreSection.sections(for: role).contains(section)
                    || MoreSection.modules(for: role).contains(section)
            else { return false }
            push(.workspace, [.section(section)])
        case .chat(let id):
            push(.chats, [.chat(id: id)])
        case .post(let id):
            push(.feed, [.post(id: id)])
        case .profile(let id):
            push(.feed, [.profile(id: id)])
        case .lesson(let id):
            // Под занятием — расписание: «назад» из пары, открытой пушем, ведёт в него.
            push(.workspace, [.section(.schedule), .lesson(id: id)])
        case .application(let id):
            // Под карточкой оставляем список: «назад» из заявки, открытой пушем,
            // должно вести к заявкам, а не выбрасывать на главную.
            push(.workspace, [.section(.applications), .application(id: id)])
        case .event(let id):
            push(.workspace, [.section(.events), .event(id: id)])
        case .myBooks, .book, .bookCopy:
            // Под книгой и «Моими книгами» — каталог: «назад» из уведомления библиотеки
            // ведёт в библиотеку, а не выбрасывает на главную.
            guard MoreSection.modules(for: role).contains(.library) else { return false }
            push(.workspace, [.section(.library), Self.libraryRoute(link)])
        }
        return true
    }

    private static func libraryRoute(_ link: DeepLink) -> AppRoute {
        switch link {
        case .book(let id): return .book(id: id)
        case .bookCopy(let code): return .bookCopy(code: code)
        default: return .myBooks
        }
    }

    /// Выбрать вкладку и вернуть её к корню — поведение повторного тапа по вкладке.
    @MainActor
    func select(_ tab: AppTab) {
        selectedTab = tab
        path(for: tab).routes = []
    }

    @MainActor
    func stack(for tab: AppTab) -> [AppRoute] {
        path(for: tab).routes
    }

    /// Роль, для которой открывалась последняя ссылка: вкладки у ролей разные, и пост
    /// у администратора платформы открывается не в ленте, которой у него нет.
    @ObservationIgnored private var currentRole: Role = .student

    @MainActor
    private func push(_ tab: AppTab, _ routes: [AppRoute]) {
        let target = AppTab.resolve(tab, for: currentRole)
        selectedTab = target
        path(for: target).routes = routes
    }

    /// Первая вкладка роли — при входе и после выхода из аккаунта.
    @MainActor
    func adopt(role: Role) {
        currentRole = role
        let tabs = AppTab.tabs(for: role)
        if !tabs.contains(selectedTab) {
            selectedTab = tabs.first ?? .home
        }
    }
}

/// Путь одной вкладки (`AppRouter.path(for:)`).
@Observable
final class TabPath {
    var routes: [AppRoute] = []
}
