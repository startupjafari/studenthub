import Foundation
import Observation

/// Вкладки профиля — те же, что в вебе (`widgets/user-profile`). Фото и видео —
/// один запрос, разделённый по типу: сервер отдаёт их вместе.
enum ProfileTab: String, CaseIterable, Identifiable {
    case posts
    case photos
    case videos
    case articles
    case polls

    var id: String { rawValue }

    var title: String {
        switch self {
        case .posts: return String(localized: "profile.tab.posts", defaultValue: "Посты")
        case .photos: return String(localized: "profile.tab.photos", defaultValue: "Фото")
        case .videos: return String(localized: "profile.tab.videos", defaultValue: "Видео")
        case .articles: return String(localized: "profile.tab.articles", defaultValue: "Статьи")
        case .polls: return String(localized: "profile.tab.polls", defaultValue: "Опросы")
        }
    }

    var symbol: String {
        switch self {
        case .posts: return "text.below.photo"
        case .photos: return "photo.on.rectangle"
        case .videos: return "play.rectangle"
        case .articles: return "doc.richtext"
        case .polls: return "chart.bar.xaxis"
        }
    }
}

/// Данные профиля: карточка, итоги вкладок, содержимое вкладок и дружба.
///
/// Вкладки грузятся лениво — при первом открытии: человек, зашедший посмотреть
/// группу и курс, не должен тянуть сотню фото.
@Observable
final class ProfileModel {
    let userID: String?

    private(set) var profile: UserProfileDTO?
    private(set) var counts: ProfileCountsDTO?
    private(set) var friendsCount: Int?
    private(set) var friendship: FriendshipStatusDTO?
    private(set) var media: [ProfileMediaDTO]?
    private(set) var articles: [ArticleCardDTO]?
    private(set) var polls: [ProfilePollDTO]?
    private(set) var failure: String?
    private(set) var isOffline = false
    private(set) var actionFailure: String?
    private(set) var tabFailure: [ProfileTab: String] = [:]

    private let feed: FeedFetching
    private let content: ProfileContentFetching

    init(userID: String?, feed: FeedFetching = FeedAPI(), content: ProfileContentFetching = ProfileContentAPI()) {
        self.userID = userID
        self.feed = feed
        self.content = content
    }

    var isMine: Bool { userID == nil }
    var resolvedID: String? { userID ?? profile?.id }

    var photos: [ProfileMediaDTO]? { media?.filter { !$0.isVideo } }
    var videos: [ProfileMediaDTO]? { media?.filter(\.isVideo) }

    @MainActor
    func load() async {
        do {
            let value: UserProfileDTO
            if let userID {
                value = try await feed.user(id: userID)
            } else {
                value = try await feed.me()
            }
            profile = value
            failure = nil
            isOffline = false
        } catch {
            failure = error.userMessage
            if case .transport = error as? APIError { isOffline = true }
            return
        }
        guard let id = resolvedID else { return }
        async let counts = try? content.counts(userID: id)
        async let friendship: FriendshipStatusDTO? = isMine ? nil : try? content.friendship(with: id)
        async let friends: Int? = isMine ? try? content.friendsCount() : nil
        self.counts = await counts
        self.friendship = await friendship
        self.friendsCount = await friends
    }

    /// Свой профиль поменяли на экране правки — шапка обновляется без запроса.
    @MainActor
    func adopt(_ profile: UserProfileDTO) {
        self.profile = profile
    }

    @MainActor
    func loadTab(_ tab: ProfileTab, force: Bool = false) async {
        guard let id = resolvedID else { return }
        do {
            switch tab {
            case .posts:
                return
            case .photos, .videos:
                guard force || media == nil else { return }
                media = try await content.media(userID: id)
            case .articles:
                guard force || articles == nil else { return }
                articles = try await content.articles(userID: id)
            case .polls:
                guard force || polls == nil else { return }
                polls = try await content.polls(userID: id)
            }
            tabFailure[tab] = nil
        } catch {
            tabFailure[tab] = error.userMessage
        }
    }

    @MainActor
    func vote(poll: ProfilePollDTO, optionIDs: [String]) async {
        do {
            try await content.vote(pollID: poll.id, optionIDs: optionIDs)
            await loadTab(.polls, force: true)
        } catch {
            actionFailure = error.userMessage
        }
    }

    // MARK: Дружба

    @MainActor
    func friendshipAction() async {
        guard let id = userID, let current = friendship else { return }
        do {
            switch current.status {
            case "NONE":
                try await content.requestFriendship(with: id)
            case "PENDING_INCOMING":
                if let friendshipID = current.friendshipId { try await content.acceptFriendship(id: friendshipID) }
            default:
                // Друзья или исходящая заявка: действие — убрать (отозвать).
                if let friendshipID = current.friendshipId { try await content.removeFriendship(id: friendshipID) }
            }
            friendship = try await content.friendship(with: id)
        } catch {
            actionFailure = error.userMessage
        }
    }

    /// Ошибка действия, сделанного с экрана мимо модели (открыть чат).
    @MainActor
    func report(_ error: Error) {
        actionFailure = error.userMessage
    }

    @MainActor
    func dismissActionFailure() {
        actionFailure = nil
    }
}
