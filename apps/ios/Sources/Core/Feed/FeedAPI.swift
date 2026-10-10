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

    let id: String
    let content: String?
    let createdAt: Date
    let author: Author?
    let media: [Media]?
    let commentsCount: Int?
    /// Реакции: эмодзи → сколько раз поставили.
    let reactions: [String: Int]?
    /// Что поставил я — по нему кнопка показывает нажатое состояние.
    let myReactions: [String]?
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
    /// Идентификаторы перехода: chatId, postId, applicationId, url.
    let data: [String: String]?
}

struct NotificationSettingsDTO: Codable, Equatable {
    let push: Bool?
    let email: Bool?
    let inApp: Bool?
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
        var query = [URLQueryItem(name: "limit", value: "20")]
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await client.page(.get("posts", query: query), of: PostDTO.self)
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
