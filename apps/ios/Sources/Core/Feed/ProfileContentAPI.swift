import Foundation

// Содержимое профиля: вкладки фото, видео, статьи, опросы (`/profile/:userId/*`,
// `/polls/by-user/:userId`) и дружба для кнопки в шапке. Посты автора — та же лента,
// `FeedAPI(scope: .author)`.

/// Итоги вкладок. Закрытый для смотрящего профиль — нули, а не ошибка.
struct ProfileCountsDTO: Decodable, Equatable {
    let photos: Int
    let videos: Int
    let articles: Int
    let polls: Int
}

/// Фото или видео профиля. Варианты размеров — те же `sources`, что у медиа постов.
struct ProfileMediaDTO: Decodable, Equatable, Identifiable {
    let id: String
    let type: String
    let mime: String?
    let url: String
    let posterUrl: String?
    var sources: [MediaSource]? = nil
    var poster: [MediaSource]? = nil
    var hls: String? = nil
    let createdAt: Date

    var isVideo: Bool { type == "VIDEO" }

    /// Тот же вид, что у медиа поста, — чтобы открыть общий полноэкранный просмотр.
    var asPostMedia: PostDTO.Media {
        PostDTO.Media(id: id, url: url, mime: mime, sources: sources, poster: poster, hls: hls)
    }

    /// Плитка сетки: превью видео или самый узкий вариант фото не уже плитки.
    var thumbnailURL: URL? {
        if isVideo { return posterUrl.flatMap(URL.init(string:)) }
        let candidate = sources?.sorted { $0.width < $1.width }.first { $0.width >= 320 } ?? sources?.last
        return URL(string: candidate?.url ?? url)
    }
}

/// Карточка статьи (`view=card` — без текста).
struct ArticleCardDTO: Decodable, Equatable, Identifiable {
    struct Counts: Decodable, Equatable {
        let comments: Int?
        let likes: Int?
    }

    let id: String
    let title: String
    let description: String?
    let coverUrl: String?
    let readingMinutes: Int?
    let views: Int?
    let publishedAt: Date?
    let createdAt: Date
    var counts: Counts? = nil

    enum CodingKeys: String, CodingKey {
        case id, title, description, coverUrl, readingMinutes, views, publishedAt, createdAt
        case counts = "_count"
    }
}

/// Опрос профиля (`PollView` сервера).
struct ProfilePollDTO: Decodable, Equatable, Identifiable {
    struct Option: Decodable, Equatable, Identifiable {
        let id: String
        let text: String
        let votes: Int
    }

    let id: String
    let question: String
    let multiple: Bool
    let closed: Bool
    let options: [Option]
    let totalVotes: Int
    let participants: Int?
    let myVotes: [String]
    let canSeeResults: Bool
    let canVote: Bool
    let createdAt: Date
}

/// Дружба со смотрящим — для кнопки в шапке чужого профиля.
struct FriendshipStatusDTO: Decodable, Equatable {
    /// `NONE`, `ACCEPTED`, `PENDING_OUTGOING`, `PENDING_INCOMING`.
    let status: String
    let friendshipId: String?
}

protocol ProfileContentFetching: Sendable {
    func counts(userID: String) async throws -> ProfileCountsDTO
    func media(userID: String) async throws -> [ProfileMediaDTO]
    func articles(userID: String) async throws -> [ArticleCardDTO]
    func polls(userID: String) async throws -> [ProfilePollDTO]
    func vote(pollID: String, optionIDs: [String]) async throws
    func friendship(with userID: String) async throws -> FriendshipStatusDTO
    func friendsCount() async throws -> Int
    func requestFriendship(with userID: String) async throws
    func acceptFriendship(id: String) async throws
    func removeFriendship(id: String) async throws
}

struct ProfileContentAPI: ProfileContentFetching {
    private let client: APIClient

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    func counts(userID: String) async throws -> ProfileCountsDTO {
        try await client.send(.get("profile/\(userID)/counts"), as: ProfileCountsDTO.self)
    }

    /// Список с потолком на сервере и без страниц — так же его читает веб.
    func media(userID: String) async throws -> [ProfileMediaDTO] {
        try await client.send(.get("profile/\(userID)/media"), as: [ProfileMediaDTO].self)
    }

    func articles(userID: String) async throws -> [ArticleCardDTO] {
        try await client.send(
            .get("profile/\(userID)/articles", query: [URLQueryItem(name: "view", value: "card")]),
            as: [ArticleCardDTO].self
        )
    }

    func polls(userID: String) async throws -> [ProfilePollDTO] {
        try await client.send(.get("polls/by-user/\(userID)"), as: [ProfilePollDTO].self)
    }

    /// Итоги после голоса перечитываем списком: так счётчики и «мой голос» приходят
    /// из одного места, а не собираются из двух ответов.
    func vote(pollID: String, optionIDs: [String]) async throws {
        struct Body: Encodable { let optionIds: [String] }
        try await client.send(.post("polls/\(pollID)/vote", json: Body(optionIds: optionIDs)))
    }

    func friendship(with userID: String) async throws -> FriendshipStatusDTO {
        try await client.send(.get("friends/status/\(userID)"), as: FriendshipStatusDTO.self)
    }

    func friendsCount() async throws -> Int {
        struct Counts: Decodable { let friends: Int }
        return try await client.send(.get("friends/count"), as: Counts.self).friends
    }

    func requestFriendship(with userID: String) async throws {
        struct Body: Encodable { let userId: String }
        try await client.send(.post("friends/requests", json: Body(userId: userID)))
    }

    func acceptFriendship(id: String) async throws {
        try await client.send(.post("friends/requests/\(id)/accept"))
    }

    func removeFriendship(id: String) async throws {
        try await client.send(Endpoint(method: .delete, path: "friends/\(id)"))
    }
}
