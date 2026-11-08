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
    /// Карточка события (`/events/[id]`): запись, онлайн-встреча, обсуждение.
    case event(id: String)
    /// Один запрос документов: пункты и привязка своих документов.
    case documentRequest(id: String)
    /// Альбомы профиля; `nil` — свои.
    case albums(userID: String?)
    case album(id: String, userID: String)
    /// Свои черновики и отложенные публикации.
    case myPosts
    /// Вступление в группу по ссылке-приглашению (`/join-chat/<id>?k=<код>`).
    case joinChat(id: String, code: String)
    /// Раздел выключен платформой (`GET /platform/state`, `disabledSections`).
    case disabledSection(String)
    /// Логин (`@username`).
    case username
    /// Язык писем и пушей.
    case notificationLanguage

    var title: String {
        switch self {
        case .friends: return String(localized: "community.screen.friends", defaultValue: "Друзья")
        case .articles: return String(localized: "community.screen.articles", defaultValue: "Статьи")
        case .article: return String(localized: "community.screen.article", defaultValue: "Статья")
        case .highlights: return String(localized: "community.screen.highlights", defaultValue: "Актуальное")
        case .university: return String(localized: "community.screen.university", defaultValue: "Университет")
        case .documentRequests: return String(localized: "community.screen.documentRequests", defaultValue: "Запросы документов")
        case .telegramLink: return String(localized: "community.screen.telegramLink", defaultValue: "Telegram")
        case .event: return String(localized: "community.screen.event", defaultValue: "Событие")
        case .documentRequest: return String(localized: "community.screen.documentRequest", defaultValue: "Запрос документов")
        case .albums: return String(localized: "community.screen.albums", defaultValue: "Альбомы")
        case .album: return String(localized: "community.screen.album", defaultValue: "Альбом")
        case .myPosts: return String(localized: "community.screen.myPosts", defaultValue: "Черновики и отложенные")
        case .joinChat: return String(localized: "community.screen.joinChat", defaultValue: "Приглашение в чат")
        case .disabledSection: return String(localized: "community.screen.disabled", defaultValue: "Раздел недоступен")
        case .username: return String(localized: "community.screen.username", defaultValue: "Логин")
        case .notificationLanguage: return String(localized: "community.screen.language", defaultValue: "Язык писем и уведомлений")
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
        case .event: return "calendar"
        case .documentRequest: return "tray.and.arrow.up"
        case .albums, .album: return "photo.stack"
        case .myPosts: return "clock.badge"
        case .joinChat: return "person.3"
        case .disabledSection: return "nosign"
        case .username: return "at"
        case .notificationLanguage: return "globe"
        }
    }

    @MainActor @ViewBuilder
    var destination: some View {
        switch self {
        case .friends(let userID):
            CommunityFriendsView(userID: userID)
        case .articles(let userID):
            CommunityArticlesView(userID: userID)
        case .article(let id):
            CommunityArticleView(articleID: id)
        case .highlights(let userID):
            CommunityHighlightsView(userID: userID)
        case .university(let id):
            CommunityUniversityView(universityID: id)
        case .documentRequests:
            CommunitySectionGate(section: "documents") { CommunityDocumentRequestsView() }
        case .telegramLink:
            CommunityTelegramLinkView()
        case .event(let id):
            CommunitySectionGate(section: "events") { CommunityEventView(eventID: id) }
        case .documentRequest(let id):
            CommunitySectionGate(section: "documents") { CommunityDocumentRequestView(requestID: id) }
        case .albums(let userID):
            CommunityAlbumsView(userID: userID)
        case .album(let id, let userID):
            CommunityAlbumView(albumID: id, userID: userID)
        case .myPosts:
            CommunityMyPostsView()
        case .joinChat(let id, let code):
            CommunitySectionGate(section: "chats") { CommunityJoinChatView(chatID: id, code: code) }
        case .disabledSection(let section):
            CommunityDisabledSectionView(section: section)
        case .username:
            CommunityUsernameView()
        case .notificationLanguage:
            CommunityLanguageView()
        }
    }

    /// Пункты вкладки «Сервисы».
    @MainActor
    static func serviceItems(for role: Role) -> [WorkspaceItem] {
        var items = [
            WorkspaceItem(title: CommunityScreen.friends(userID: nil).title, symbol: "person.2", tint: TileTint.teal, route: .community(.friends(userID: nil))),
        ]
        // Запросы документов адресованы студентам; выключенные документы прячут и их.
        if role == .student || role == .starosta, !CommunityPlatformState.shared.isDisabled("documents") {
            items.append(WorkspaceItem(title: CommunityScreen.documentRequests.title, symbol: "tray.and.arrow.up", tint: TileTint.orange, route: .community(.documentRequests)))
        }
        items.append(WorkspaceItem(title: CommunityScreen.articles(userID: nil).title, symbol: "doc.richtext", tint: TileTint.indigo, route: .community(.articles(userID: nil))))
        return items
    }
}
