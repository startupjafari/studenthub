import SwiftUI

/// Соцчасть сверх ленты: друзья, статьи, актуальное историй, страница вуза, запросы документов, привязка Telegram.
///
/// Маршрут — `AppRoute.community(_:)`. Перечень случаев — контракт с каталогами
/// других ролей: случаи можно добавлять, но не переименовывать и не удалять.
enum CommunityScreen: Hashable {
    case friends(userID: String?)
    case articles(userID: String?)
    case article(id: String)
    case highlights(userID: String)
    case university(id: String)
    case documentRequests
    case telegramLink

    var title: String {
        switch self {
        case .friends: return String(localized: "community.screen.friends", defaultValue: "Друзья")
        case .articles: return String(localized: "community.screen.articles", defaultValue: "Статьи")
        case .article: return String(localized: "community.screen.article", defaultValue: "Статья")
        case .highlights: return String(localized: "community.screen.highlights", defaultValue: "Актуальное")
        case .university: return String(localized: "community.screen.university", defaultValue: "Университет")
        case .documentRequests: return String(localized: "community.screen.documentRequests", defaultValue: "Запросы документов")
        case .telegramLink: return String(localized: "community.screen.telegramLink", defaultValue: "Telegram")
        }
    }

    var symbol: String {
        switch self {
        case .friends: return "person.2"
        case .articles: return "doc.richtext"
        case .article: return "doc.richtext"
        case .highlights: return "sparkles"
        case .university: return "building.columns"
        case .documentRequests: return "tray.and.arrow.up"
        case .telegramLink: return "paperplane"
        }
    }

    @MainActor @ViewBuilder
    var destination: some View {
        PendingScreen(title: title, symbol: symbol)
    }

    /// Пункты вкладки «Сервисы».
    static func serviceItems(for role: Role) -> [WorkspaceItem] {
        [
            WorkspaceItem(title: CommunityScreen.friends(userID: nil).title, symbol: "person.2", tint: TileTint.teal, route: .community(.friends(userID: nil))),
            WorkspaceItem(title: CommunityScreen.documentRequests.title, symbol: "tray.and.arrow.up", tint: TileTint.orange, route: .community(.documentRequests)),
        ]
    }
}
