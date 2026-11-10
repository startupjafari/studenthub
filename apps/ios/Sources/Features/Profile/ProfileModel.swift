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

    /// Заголовок пустой вкладки — про то, чего именно нет, а не общее «пусто».
    var emptyTitle: String {
        switch self {
        case .posts: return String(localized: "profile.noPosts", defaultValue: "Публикаций пока нет")
        case .photos: return String(localized: "profile.empty.photos", defaultValue: "Фото пока нет")
        case .videos: return String(localized: "profile.empty.videos", defaultValue: "Видео пока нет")
        case .articles: return String(localized: "profile.empty.articles", defaultValue: "Статей пока нет")
        case .polls: return String(localized: "profile.empty.polls", defaultValue: "Опросов пока нет")
        }
    }

    /// Подсказка в своём профиле: что сюда попадёт. В чужом подсказки нет — там
    /// человеку нечего с этим делать.
    var emptyHint: String {
        switch self {
        case .posts: return String(localized: "profile.empty.postsHint", defaultValue: "Ваши публикации появятся здесь")
        case .photos: return String(localized: "profile.empty.photosHint", defaultValue: "Загруженные фото появятся здесь")
        case .videos: return String(localized: "profile.empty.videosHint", defaultValue: "Загруженные видео появятся здесь")
        case .articles: return String(localized: "profile.empty.articlesHint", defaultValue: "Ваши статьи появятся здесь")
        case .polls: return String(localized: "profile.empty.pollsHint", defaultValue: "Ваши опросы появятся здесь")
        }
    }

    /// Что грузит вкладка. Фото и видео — один запрос: открыв одну из них, вторую
    /// второй раз не спрашиваем.
    fileprivate var source: ProfileTab {
        self == .videos ? .photos : self
    }

    /// Вкладки, которые делят запрос с этой.
    fileprivate var sharing: [ProfileTab] {
        source == .photos ? [.photos, .videos] : [self]
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
    /// Вкладки, чей сбой — из-за связи.
    private(set) var offlineTabs: Set<ProfileTab> = []

    private let feed: FeedFetching
    private let content: ProfileContentFetching

    init(userID: String?, feed: FeedFetching = FeedAPI(), content: ProfileContentFetching = ProfileContentAPI()) {
        self.userID = userID
        self.feed = feed
        self.content = content
    }

    var isMine: Bool { userID == nil }
    var resolvedID: String? { userID ?? profile?.id }

    /// Фото и видео разделяются один раз, при загрузке, а не при каждой отрисовке сетки.
    private(set) var photos: [ProfileMediaDTO]?
    private(set) var videos: [ProfileMediaDTO]?

    /// Вкладки, чей запрос уже в пути. Вкладку спрашивают и смена выбора, и появление
    /// её заглушки — без этого уходило два одинаковых запроса.
    private var loadingTabs: Set<ProfileTab> = []

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
        guard let id = resolvedID, tab != .posts else { return }
        let source = tab.source
        guard force || !loadingTabs.contains(source) else { return }
        loadingTabs.insert(source)
        defer { loadingTabs.remove(source) }
        do {
            switch tab {
            case .posts:
                return
            case .photos, .videos:
                guard force || media == nil else { return }
                let loaded = try await content.media(userID: id)
                media = loaded
                photos = loaded.filter { !$0.isVideo }
                videos = loaded.filter(\.isVideo)
            case .articles:
                guard force || articles == nil else { return }
                articles = try await content.articles(userID: id)
            case .polls:
                guard force || polls == nil else { return }
                polls = try await content.polls(userID: id)
            }
            for affected in tab.sharing {
                tabFailure[affected] = nil
                offlineTabs.remove(affected)
            }
        } catch {
            // Сбой общего запроса — сбой обеих вкладок: открытая, пока он шёл, иначе
            // так и крутила бы загрузку.
            for affected in tab.sharing {
                tabFailure[affected] = error.userMessage
                if error.isOffline { offlineTabs.insert(affected) } else { offlineTabs.remove(affected) }
            }
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

    /// Запрос дружбы в пути: второе касание не шлёт вторую заявку.
    private(set) var isChangingFriendship = false

    @MainActor
    func friendshipAction() async {
        guard let id = userID, let current = friendship, !isChangingFriendship else { return }
        isChangingFriendship = true
        defer { isChangingFriendship = false }
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
