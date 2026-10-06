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
    case lesson(id: String)
    case assignment(id: String)
    case service(id: String)
}

/// Навигация оболочки: выбранная вкладка и путь внутри каждой.
///
/// У каждой вкладки свой стек, а не один общий. Так устроен iOS: человек уходит из
/// чата в расписание и возвращается ровно в тот чат, а не к списку. Общий стек это
/// поведение теряет, и его потом не вернуть — путь уже затёрт.
@Observable
final class AppRouter {
    var selectedTab: AppTab = .home
    var stacks: [AppTab: [AppRoute]] = [:]

    /// Открыть ссылку. `false` означает «не наше»: ссылка либо незнакомая, либо
    /// ведёт в раздел, которого у этой роли нет, — и тогда её открывает браузер.
    @MainActor
    @discardableResult
    func open(_ url: URL, for role: Role) -> Bool {
        guard let link = DeepLink(url: url) else { return false }
        return open(link, for: role)
    }

    @MainActor
    @discardableResult
    func open(_ link: DeepLink, for role: Role) -> Bool {
        switch link {
        case .tab(let tab):
            select(tab)
        case .section(let section):
            // Ссылка на чужой раздел не должна открывать пустой экран: у студента
            // нет обращений группы, и показать их ему нечем.
            guard MoreSection.sections(for: role).contains(section) else { return false }
            push(.more, [.section(section)])
        case .chat(let id):
            push(.chats, [.chat(id: id)])
        case .post(let id):
            push(.home, [.post(id: id)])
        case .lesson(let id):
            push(.schedule, [.lesson(id: id)])
        case .application(let id):
            // Под карточкой оставляем список: «назад» из заявки, открытой пушем,
            // должно вести к заявкам, а не выбрасывать на главную.
            push(.more, [.section(.applications), .application(id: id)])
        case .event(let id):
            push(.more, [.section(.events), .event(id: id)])
        }
        return true
    }

    /// Выбрать вкладку и вернуть её к корню — поведение повторного тапа по вкладке.
    @MainActor
    func select(_ tab: AppTab) {
        selectedTab = tab
        stacks[tab] = []
    }

    @MainActor
    func stack(for tab: AppTab) -> [AppRoute] {
        stacks[tab] ?? []
    }

    @MainActor
    private func push(_ tab: AppTab, _ routes: [AppRoute]) {
        selectedTab = tab
        stacks[tab] = routes
    }
}
