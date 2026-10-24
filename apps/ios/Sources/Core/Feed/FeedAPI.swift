import Foundation

// Контракты ленты, событий, уведомлений и профиля (PROJECT.md §8.3).

struct PostDTO: Decodable, Equatable, Identifiable {
    struct Author: Decodable, Equatable {
        let id: String
        let firstName: String?
        let lastName: String?
        let avatarUrl: String?

        var name: String {
            [lastName, firstName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
        }
    }

    struct Media: Decodable, Equatable, Identifiable {
        let id: String
        let url: String?
        let mime: String?
    }

    /// Одна строка сводки реакций (`PostReactionSummary`): сколько и стоит ли своя.
    struct ReactionSummary: Decodable, Equatable {
        let emoji: String
        let count: Int
        let mine: Bool
    }

    struct Counts: Decodable, Equatable {
        let comments: Int?
    }

    let id: String
    let content: String?
    let createdAt: Date
    let author: Author?
    let media: [Media]?
    /// Сводка реакций. Устаревшее поле `reactions` сервер отдаёт массивом строк
    /// `{ emoji, userId }`, а клиент ждал словарь — typeMismatch ронял всю ленту.
    let reactionSummary: [ReactionSummary]?
    /// Счётчики Prisma: `_count.comments` — число комментариев.
    let counts: Counts?

    enum CodingKeys: String, CodingKey {
        case id, content, createdAt, author, media, reactionSummary
        case counts = "_count"
    }

    var commentsCount: Int { counts?.comments ?? 0 }

    /// Реакции: эмодзи → сколько раз поставили.
    var reactions: [String: Int] {
        Dictionary((reactionSummary ?? []).map { ($0.emoji, $0.count) }, uniquingKeysWith: +)
    }

    /// Что поставил я — по нему кнопка показывает нажатое состояние.
    var myReactions: [String] {
        (reactionSummary ?? []).filter(\.mine).map(\.emoji)
    }
}

struct PostCommentDTO: Decodable, Equatable, Identifiable {
    let id: String
    let content: String
    let createdAt: Date
    let author: PostDTO.Author?
}

struct EventDTO: Decodable, Equatable, Identifiable {
    let id: String
    let title: String
    let description: String?
    let startsAt: Date
    let endsAt: Date?
    let location: String?
    let isRegistered: Bool?
    let participantsCount: Int?
}

struct NotificationDTO: Decodable, Equatable, Identifiable {
    let id: String
    let type: String
    let title: String
    let body: String
    let isRead: Bool
    let createdAt: Date
    /// Идентификаторы перехода: chatId, postId, applicationId, url. `data` на сервере —
    /// произвольный JSON, поэтому берутся только строковые поля: число в одном из них
    /// не должно ронять всю ленту колокольчика.
    let data: [String: String]?

    enum CodingKeys: String, CodingKey {
        case id, type, title, body, isRead, createdAt, data
    }

    init(
        id: String, type: String, title: String, body: String, isRead: Bool, createdAt: Date,
        data: [String: String]?
    ) {
        self.id = id
        self.type = type
        self.title = title
        self.body = body
        self.isRead = isRead
        self.createdAt = createdAt
        self.data = data
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        type = try container.decode(String.self, forKey: .type)
        title = try container.decode(String.self, forKey: .title)
        body = try container.decode(String.self, forKey: .body)
        isRead = try container.decode(Bool.self, forKey: .isRead)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        data = (try? container.decodeIfPresent(StringFields.self, forKey: .data))?.values
    }

    /// Куда ведёт уведомление — тот же адрес, что кладётся в пуш (`data.url`).
    var link: DeepLink? {
        guard let url = data?["url"] else { return nil }
        return PushRouting.link(from: ["url": url])
    }

    /// Строковые поля JSON-объекта; остальные пропускаются.
    private struct StringFields: Decodable {
        let values: [String: String]

        private struct Key: CodingKey {
            let stringValue: String
            var intValue: Int? { nil }
            init(stringValue: String) { self.stringValue = stringValue }
            init?(intValue: Int) { nil }
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: Key.self)
            var values: [String: String] = [:]
            for key in container.allKeys {
                if let value = try? container.decode(String.self, forKey: key) {
                    values[key.stringValue] = value
                }
            }
            self.values = values
        }
    }
}

/// Каналы доставки. Имена полей — как в контракте API (`UpdateNotificationSettingsSchema`):
/// схема строгая, и чужое поле в PATCH — это `400`. В колокольчик уведомления
/// приходят всегда, отдельного флага у него нет.
struct NotificationSettingsDTO: Codable, Equatable {
    let pushEnabled: Bool?
    let emailEnabled: Bool?
}

struct UserProfileDTO: Decodable, Equatable {
    let id: String
    let firstName: String?
    let lastName: String?
    let email: String?
    let username: String?
    let avatarUrl: String?
    let bio: String?
    let role: String?
    let groupName: String?
    let facultyName: String?

    var name: String {
        [lastName, firstName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
    }
}

protocol FeedFetching: Sendable {
    func posts(cursor: String?) async throws -> Page<PostDTO>
    func post(id: String) async throws -> PostDTO
    func comments(postID: String) async throws -> [PostCommentDTO]
    func comment(postID: String, text: String) async throws -> PostCommentDTO
    func react(postID: String, emoji: String, on: Bool) async throws
    func events(onlyMine: Bool) async throws -> Page<EventDTO>
    func register(eventID: String, on: Bool) async throws
    func notifications(cursor: String?) async throws -> Page<NotificationDTO>
    func markRead(notificationID: String) async throws
    func markAllRead() async throws
    func notificationSettings() async throws -> NotificationSettingsDTO
    func updateNotificationSettings(_ settings: NotificationSettingsDTO) async throws
    func me() async throws -> UserProfileDTO
    func user(id: String) async throws -> UserProfileDTO
    func updateProfile(firstName: String, lastName: String, bio: String?) async throws
    func uploadAvatar(_ data: Data, mime: String) async throws
}

struct FeedAPI: FeedFetching {
    private let client: APIClient

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    func posts(cursor: String?) async throws -> Page<PostDTO> {
        // `reactions=summary` — без построчного списка «кто что поставил»: приложению
        // нужна только сводка, а список растёт с каждой реакцией.
        var query = [URLQueryItem(name: "limit", value: "20"), URLQueryItem(name: "reactions", value: "summary")]
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await client.page(.get("posts", query: query), of: PostDTO.self)
    }

    /// Сам пост — для карточки, открытой из уведомления: в ленте его может не быть.
    func post(id: String) async throws -> PostDTO {
        try await client.send(.get("posts/\(id)"), as: PostDTO.self)
    }

    func comments(postID: String) async throws -> [PostCommentDTO] {
        try await client.send(.get("posts/\(postID)/comments"), as: [PostCommentDTO].self)
    }

    func comment(postID: String, text: String) async throws -> PostCommentDTO {
        try await client.send(
            try .post("posts/\(postID)/comments", json: ["content": text]),
            as: PostCommentDTO.self
        )
    }

    /// Реакция ставится и снимается разными маршрутами — так на сервере, и свой
    /// «тоггл» клиенту придумывать незачем.
    func react(postID: String, emoji: String, on: Bool) async throws {
        if on {
            try await client.send(try .post("posts/\(postID)/reactions", json: ["emoji": emoji]))
        } else {
            let escaped = emoji.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? emoji
            try await client.send(Endpoint(method: .delete, path: "posts/\(postID)/reactions/\(escaped)"))
        }
    }

    func events(onlyMine: Bool) async throws -> Page<EventDTO> {
        try await client.page(
            .get(
                "events",
                query: [
                    URLQueryItem(name: "limit", value: "30"),
                    URLQueryItem(name: "onlyMine", value: onlyMine ? "true" : "false"),
                ]
            ),
            of: EventDTO.self
        )
    }

    func register(eventID: String, on: Bool) async throws {
        if on {
            try await client.send(.post("events/\(eventID)/register"))
        } else {
            try await client.send(Endpoint(method: .delete, path: "events/\(eventID)/register"))
        }
    }

    func notifications(cursor: String?) async throws -> Page<NotificationDTO> {
        var query = [URLQueryItem(name: "limit", value: "30")]
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await client.page(.get("notifications", query: query), of: NotificationDTO.self)
    }

    func markRead(notificationID: String) async throws {
        try await client.send(Endpoint(method: .patch, path: "notifications/\(notificationID)/read"))
    }

    func markAllRead() async throws {
        try await client.send(Endpoint(method: .patch, path: "notifications/read-all"))
    }

    func notificationSettings() async throws -> NotificationSettingsDTO {
        try await client.send(.get("notifications/settings"), as: NotificationSettingsDTO.self)
    }

    func updateNotificationSettings(_ settings: NotificationSettingsDTO) async throws {
        try await client.send(
            Endpoint(
                method: .patch,
                path: "notifications/settings",
                body: try JSONCoding.encoder.encode(settings)
            )
        )
    }

    func me() async throws -> UserProfileDTO {
        try await client.send(.get("users/me"), as: UserProfileDTO.self)
    }

    func user(id: String) async throws -> UserProfileDTO {
        try await client.send(.get("users/\(id)"), as: UserProfileDTO.self)
    }

    func updateProfile(firstName: String, lastName: String, bio: String?) async throws {
        struct Body: Encodable {
            let firstName: String
            let lastName: String
            let bio: String?
        }
        try await client.send(
            Endpoint(
                method: .patch,
                path: "users/me",
                body: try JSONCoding.encoder.encode(Body(firstName: firstName, lastName: lastName, bio: bio))
            )
        )
    }

    /// Аватар уходит multipart: маршрут на сервере принимает файл, а не ссылку.
    func uploadAvatar(_ data: Data, mime: String) async throws {
        var form = MultipartForm()
        form.append(data, name: "file", filename: "avatar.jpg", mime: mime)
        try await client.send(.multipart("users/me/avatar", form: form))
    }
}
