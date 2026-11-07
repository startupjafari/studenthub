import Foundation

// Истории (PROJECT.md §3.4). Раздел за флагом `FEATURE_STORIES`: выключенный флаг
// отвечает пустым списком, и полоса на главной просто не рисуется.

/// Все истории одного автора — кольцо в полосе.
struct StoryRingDTO: Decodable, Equatable, Identifiable {
    let author: PostDTO.Author
    /// От старых к новым — в этом порядке их и смотрят.
    let stories: [StoryDTO]
    let hasUnseen: Bool

    var id: String { author.id }
}

struct StoryDTO: Decodable, Equatable, Identifiable {
    struct Media: Decodable, Equatable {
        let id: String
        let mime: String?
        let url: String?
        var placeholder: String? = nil
        var width: Int? = nil
        var height: Int? = nil
        var durationMs: Int? = nil
        var sources: [MediaSource]? = nil
        var poster: [MediaSource]? = nil
        var hls: String? = nil
    }

    struct Poll: Decodable, Equatable {
        struct Option: Decodable, Equatable, Identifiable {
            let id: String
            let text: String
            let votes: Int
        }

        let id: String
        let question: String
        let options: [Option]
        let totalVotes: Int
        let myOptionId: String?
    }

    struct Reaction: Decodable, Equatable {
        let emoji: String
        let count: Int
        let mine: Bool
    }

    let id: String
    let text: String?
    /// Фон текстовой истории: `sunset`, `ocean`, `forest`, `grape`, `graphite`, `rose`.
    let background: String?
    let linkUrl: String?
    let linkLabel: String?
    let elements: [StoryElement]?
    let createdAt: Date
    let media: Media?
    let poll: Poll?
    let reactions: [Reaction]?
    let seen: Bool?
    /// Число просмотров — только автору.
    let viewsCount: Int?
    let canDelete: Bool?
}

/// Наклейка поверх кадра. Координаты — центр элемента в долях кадра (0…1).
///
/// Незнакомый тип не роняет разбор истории: сервер добавит наклейку раньше, чем
/// обновятся все телефоны, и такая наклейка просто не рисуется.
struct StoryElement: Decodable, Equatable {
    enum Kind: Equatable {
        case text(String, color: String?, background: String?)
        case emoji(String)
        case mention(userID: String, name: String?)
        case event(id: String, title: String?)
        case post(id: String, title: String?)
        case schedule(subject: String?, time: String?)
        case unknown
    }

    let kind: Kind
    let x: Double
    let y: Double
    let scale: Double
    let rotation: Double

    private enum CodingKeys: String, CodingKey {
        case type, x, y, scale, rotation, text, color, background, emoji, userId, name, eventId, event
        case postId, post, pair
    }

    private struct Titled: Decodable {
        let title: String?
        let excerpt: String?
    }

    private struct Pair: Decodable {
        let subject: String?
        let startTime: String?
        let endTime: String?
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        x = (try? container.decode(Double.self, forKey: .x)) ?? 0.5
        y = (try? container.decode(Double.self, forKey: .y)) ?? 0.5
        scale = (try? container.decode(Double.self, forKey: .scale)) ?? 1
        rotation = (try? container.decode(Double.self, forKey: .rotation)) ?? 0
        let type = (try? container.decode(String.self, forKey: .type)) ?? ""
        switch type {
        case "text":
            kind = .text(
                (try? container.decode(String.self, forKey: .text)) ?? "",
                color: try? container.decode(String.self, forKey: .color),
                background: try? container.decode(String.self, forKey: .background)
            )
        case "emoji":
            kind = .emoji((try? container.decode(String.self, forKey: .emoji)) ?? "")
        case "mention":
            kind = .mention(
                userID: (try? container.decode(String.self, forKey: .userId)) ?? "",
                name: try? container.decode(String.self, forKey: .name)
            )
        case "event":
            let event = try? container.decode(Titled.self, forKey: .event)
            kind = .event(id: (try? container.decode(String.self, forKey: .eventId)) ?? "", title: event?.title)
        case "post":
            let post = try? container.decode(Titled.self, forKey: .post)
            kind = .post(
                id: (try? container.decode(String.self, forKey: .postId)) ?? "",
                title: post?.title ?? post?.excerpt
            )
        case "schedule":
            let pair = try? container.decode(Pair.self, forKey: .pair)
            let time = pair.flatMap { pair in
                pair.startTime.map { start in [start, pair.endTime].compactMap { $0 }.joined(separator: " – ") }
            }
            kind = .schedule(subject: pair?.subject, time: time)
        default:
            kind = .unknown
        }
    }
}

/// Кому видна новая история студента (`StoryAudience`, доступное студенту).
enum StoryAudience: String, CaseIterable, Identifiable {
    case group = "GROUP"
    case friends = "FRIENDS"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .group: return String(localized: "stories.audience.group", defaultValue: "Моя группа")
        case .friends: return String(localized: "stories.audience.friends", defaultValue: "Друзья")
        }
    }
}

/// Реакции на историю — белый список сервера (`STORY_REACTION_EMOJIS`).
enum StoryReactions {
    static let all = ["❤️", "🔥", "👏", "😮", "😢"]
}

protocol StoriesFetching: Sendable {
    func rings() async throws -> [StoryRingDTO]
    func markViewed(storyID: String) async throws
    func react(storyID: String, emoji: String, on: Bool) async throws
    func vote(storyID: String, optionID: String) async throws -> StoryDTO
    func reply(storyID: String, text: String) async throws
    func delete(storyID: String) async throws
    func mute(authorID: String) async throws
    func create(fileID: String?, text: String?, background: String?, audience: StoryAudience) async throws
}

struct StoriesAPI: StoriesFetching {
    private let client: APIClient

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    /// Кольца без страниц: сервер сам ограничивает выдачу двумя сотнями историй.
    func rings() async throws -> [StoryRingDTO] {
        try await client.send(.get("stories"), as: [StoryRingDTO].self)
    }

    func markViewed(storyID: String) async throws {
        try await client.send(.post("stories/\(storyID)/view"))
    }

    func react(storyID: String, emoji: String, on: Bool) async throws {
        if on {
            try await client.send(try .post("stories/\(storyID)/reactions", json: ["emoji": emoji]))
        } else {
            let escaped = emoji.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? emoji
            try await client.send(Endpoint(method: .delete, path: "stories/\(storyID)/reactions/\(escaped)"))
        }
    }

    /// Голос один: повторный заменяет прежний. Ответ — история с пересчитанным опросом.
    func vote(storyID: String, optionID: String) async throws -> StoryDTO {
        try await client.send(try .post("stories/\(storyID)/vote", json: ["optionId": optionID]), as: StoryDTO.self)
    }

    /// Ответ уходит автору в личный чат — так же, как в вебе.
    func reply(storyID: String, text: String) async throws {
        struct Body: Encodable {
            let storyId: String
            let content: String
        }
        try await client.send(try .post("chats/story-reply", json: Body(storyId: storyID, content: text)))
    }

    func delete(storyID: String) async throws {
        try await client.send(Endpoint(method: .delete, path: "stories/\(storyID)"))
    }

    func mute(authorID: String) async throws {
        try await client.send(.post("stories/mutes/\(authorID)"))
    }

    func create(fileID: String?, text: String?, background: String?, audience: StoryAudience) async throws {
        struct Body: Encodable {
            let audience: String
            let fileId: String?
            let text: String?
            let background: String?
        }
        try await client.send(
            try .post(
                "stories",
                json: Body(audience: audience.rawValue, fileId: fileID, text: text, background: background)
            )
        )
    }
}
