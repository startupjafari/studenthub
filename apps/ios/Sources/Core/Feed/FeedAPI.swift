import Foundation

// Контракты ленты, событий, уведомлений и профиля (PROJECT.md §8.3).

struct PostDTO: Decodable, Equatable, Identifiable {
    struct Author: Decodable, Equatable {
        let id: String
        let firstName: String?
        let lastName: String?
        let avatarUrl: String?
        /// Роль автора — подпись под именем («Преподаватель», «Староста»).
        var role: String? = nil

        var name: String {
            [lastName, firstName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
        }
    }

    struct Media: Decodable, Equatable, Identifiable {
        let id: String
        let url: String?
        let mime: String?
        /// Размеры оригинала — по ним карточка держит пропорции до загрузки.
        var width: Int? = nil
        var height: Int? = nil
        /// Размытое превью (LQIP) data-URI: показывается, пока грузится картинка.
        var placeholder: String? = nil
        var durationMs: Int? = nil
        /// Копии WebP по ширине 320/640/1280/2048, по возрастанию.
        var sources: [MediaSource]? = nil
        /// Кадр-обложка видео.
        var poster: [MediaSource]? = nil
        /// Путь HLS от корня API (`/api/v1/media/…/master.m3u8?t=…`); доступ — по токену `t`.
        var hls: String? = nil
        /// `READY`, `PROCESSING`, `FAILED`, …
        var status: String? = nil
    }

    /// Организация вместо человека: пост страницы вуза или компании.
    struct Organization: Decodable, Equatable {
        let id: String
        let name: String
        var logoUrl: String? = nil
    }

    /// Исходная публикация репоста — в том объёме, в каком её отдаёт лента.
    struct Original: Decodable, Equatable {
        let id: String
        var title: String? = nil
        var content: String? = nil
        var author: Author? = nil
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

    var authorId: String? = nil
    var title: String? = nil
    /// Кому адресован пост: `ALL`, `UNIVERSITY`, `FACULTY`, `GROUP`, `PERSONAL`, …
    var audience: String? = nil
    var publishedAt: Date? = nil
    var pinnedAt: Date? = nil
    var views: Int? = nil
    /// Репост: `originalPostId` есть, а `original` пуст — исходник удалён или скрыт.
    var originalPostId: String? = nil
    var original: Original? = nil
    var bookmarked: Bool? = nil
    var canDelete: Bool? = nil
    var universityPage: Organization? = nil
    var company: Organization? = nil
    /// `PUBLISHED`, `DRAFT`, `SCHEDULED`. Черновики и отложенные видит только автор.
    var status: String? = nil
    var scheduledAt: Date? = nil
    /// Может ли смотрящий закрепить пост (роль выше автора в его области).
    var canPin: Bool? = nil

    enum CodingKeys: String, CodingKey {
        case id, content, createdAt, author, media, reactionSummary
        case counts = "_count"
        case authorId, title, audience, publishedAt, pinnedAt, views, originalPostId, original
        case bookmarked, canDelete, universityPage, company, status, scheduledAt, canPin
    }

    var isDraft: Bool { status == "DRAFT" }
    var isScheduled: Bool { status == "SCHEDULED" }

    /// Чей голос в шапке: страница вуза и компания говорят от себя, а не от сотрудника.
    var speaker: Organization? { universityPage ?? company }
    var isRepost: Bool { originalPostId != nil }

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
    /// Ответ — на корневой комментарий: вложенность у сервера одна.
    var parentId: String? = nil
    var canDelete: Bool? = nil
}

/// Копия медиа определённой ширины.
struct MediaSource: Decodable, Equatable {
    let width: Int
    let height: Int
    let url: String
}

/// Запись о загруженном файле (`POST /files/upload`, `/files/confirm`).
struct UploadedFileDTO: Decodable, Equatable {
    let id: String
    let mime: String?
}

/// Ответ поиска верхней панели. Приложению нужны люди и события — остальные разделы
/// поиска ведут в экраны, которых в приложении нет.
struct SearchResultsDTO: Decodable, Equatable {
    struct Person: Decodable, Equatable, Identifiable {
        let id: String
        let firstName: String?
        let lastName: String?
        let username: String?
        let avatarUrl: String?
        let role: String?

        var name: String {
            [lastName, firstName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
        }
    }

    struct Event: Decodable, Equatable, Identifiable {
        let id: String
        let title: String
        let startsAt: Date
    }

    let people: [Person]?
    let events: [Event]?
}

/// Куда направлена жалоба (`ComplaintTargetType`).
enum ComplaintTarget: String {
    case post = "POST"
    case comment = "COMMENT"
    case story = "STORY"
    case message = "MESSAGE"
}

/// Бакет хранилища (`FileBucketKind`).
enum UploadBucket: String {
    case posts = "POSTS"
    case stories = "STORIES"
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
    var isOnline: Bool? = nil
    var canManage: Bool? = nil
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
    var universityName: String? = nil
    /// Учебный статус — свободная строка из карточки студента.
    var academicStatus: String? = nil

    // Поля карточки `PROFILE_SELECT`. Все необязательны: чужую карточку сервер режет
    // по правам смотрящего (`access: limited` — только визитка), и отсутствие поля —
    // норма, а не ошибка разбора.
    var middleName: String? = nil
    var coverUrl: String? = nil
    /// Короткая строка под именем — ближайшее к «статусу», что есть в профиле.
    var headline: String? = nil
    var phone: String? = nil
    var telegram: String? = nil
    var instagram: String? = nil
    var website: String? = nil
    var skills: [String]? = nil
    var interests: [String]? = nil
    var languages: [String]? = nil
    var course: Int? = nil
    var specialty: String? = nil
    var gpa: Double? = nil
    var groupId: String? = nil
    var facultyId: String? = nil
    var universityId: String? = nil
    var twoFactorEnabled: Bool? = nil
    var profileVisibility: String? = nil
    var showEmail: Bool? = nil
    var showPhone: Bool? = nil
    var locale: String? = nil
    var position: String? = nil
    var department: String? = nil
    var academicDegree: String? = nil
    var officeRoom: String? = nil
    var officeHours: String? = nil
    /// `limited` — профиль закрыт настройкой приватности, видна только визитка.
    var access: String? = nil

    var isLimited: Bool { access == "limited" }

    var name: String {
        [lastName, firstName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
    }
}

protocol FeedFetching: Sendable {
    func posts(cursor: String?) async throws -> Page<PostDTO>
    func post(id: String) async throws -> PostDTO
    func comments(postID: String, cursor: String?) async throws -> Page<PostCommentDTO>
    func comment(postID: String, text: String, parentID: String?) async throws -> PostCommentDTO
    func deleteComment(postID: String, commentID: String) async throws
    func react(postID: String, emoji: String, on: Bool) async throws
    func toggleBookmark(postID: String) async throws -> Bool
    func repost(postID: String, note: String?) async throws -> PostDTO
    func editPost(id: String, content: String) async throws -> PostDTO
    func deletePost(id: String) async throws
    func markViewed(postID: String) async throws
    func createPost(content: String, mediaIDs: [String], targetUserID: String?) async throws -> PostDTO
    func upload(_ data: Data, mime: String, filename: String, bucket: UploadBucket) async throws -> UploadedFileDTO
    func report(_ target: ComplaintTarget, id: String, reason: String) async throws
    func upcomingEvents() async throws -> [EventDTO]
    func unreadNotifications() async throws -> Int
    func search(_ query: String) async throws -> SearchResultsDTO
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

/// Срез ленты. Один и тот же `GET /posts` отдаёт и общую ленту, и посты автора на
/// вкладке профиля, и сохранённое — различаются только параметры.
enum FeedScope: Equatable {
    case all
    case author(id: String)
    case saved
    /// Раздел ленты (`FeedFilterSchema`): `GROUP`, `UNIVERSITY`, `TEACHERS`, `IMPORTANT`, `MODERATION`.
    case filter(String)
    /// Свои посты по статусу: `DRAFT`, `SCHEDULED`, `PUBLISHED`.
    case authorStatus(id: String, status: String)
    /// Посты страницы вуза.
    case universityPage(id: String)

    var query: [URLQueryItem] {
        switch self {
        case .all: return []
        case .author(let id): return [URLQueryItem(name: "authorId", value: id)]
        case .saved: return [URLQueryItem(name: "filter", value: "SAVED")]
        case .filter(let value): return [URLQueryItem(name: "filter", value: value)]
        case .authorStatus(let id, let status):
            return [URLQueryItem(name: "authorId", value: id), URLQueryItem(name: "status", value: status)]
        case .universityPage(let id): return [URLQueryItem(name: "universityPageId", value: id)]
        }
    }
}

struct FeedAPI: FeedFetching {
    private let client: APIClient
    private let scope: FeedScope

    init(client: APIClient = AppServices.api, scope: FeedScope = .all) {
        self.client = client
        self.scope = scope
    }

    func posts(cursor: String?) async throws -> Page<PostDTO> {
        // `reactions=summary` — без построчного списка «кто что поставил»: приложению
        // нужна только сводка, а список растёт с каждой реакцией.
        var query = [URLQueryItem(name: "limit", value: "20"), URLQueryItem(name: "reactions", value: "summary")]
        query += scope.query
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await client.page(.get("posts", query: query), of: PostDTO.self)
    }

    /// Сам пост — для карточки, открытой из уведомления: в ленте его может не быть.
    func post(id: String) async throws -> PostDTO {
        try await client.send(.get("posts/\(id)"), as: PostDTO.self)
    }

    /// Комментарии страницами, от новых к старым: курсор ведёт в прошлое.
    func comments(postID: String, cursor: String?) async throws -> Page<PostCommentDTO> {
        var query = [URLQueryItem(name: "limit", value: "20")]
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await client.page(.get("posts/\(postID)/comments", query: query), of: PostCommentDTO.self)
    }

    func comment(postID: String, text: String, parentID: String?) async throws -> PostCommentDTO {
        struct Body: Encodable {
            let content: String
            let parentId: String?
        }
        return try await client.send(
            try .post("posts/\(postID)/comments", json: Body(content: text, parentId: parentID)),
            as: PostCommentDTO.self
        )
    }

    func deleteComment(postID: String, commentID: String) async throws {
        try await client.send(Endpoint(method: .delete, path: "posts/\(postID)/comments/\(commentID)"))
    }

    /// Закладка — переключатель на сервере: ответ говорит, чем всё кончилось.
    func toggleBookmark(postID: String) async throws -> Bool {
        struct Result: Decodable { let bookmarked: Bool }
        return try await client.send(.post("posts/\(postID)/bookmark"), as: Result.self).bookmarked
    }

    /// Репост студента — в свою группу: это единственная общая аудитория, которую
    /// ему разрешает сервер (`PERSONAL` требует адресата).
    func repost(postID: String, note: String?) async throws -> PostDTO {
        struct Body: Encodable {
            let audience: String
            let content: String?
        }
        return try await client.send(
            try .post("posts/\(postID)/repost", json: Body(audience: "GROUP", content: note)),
            as: PostDTO.self
        )
    }

    /// Правится только текст: аудиторию и медиа сервер менять не даёт.
    func editPost(id: String, content: String) async throws -> PostDTO {
        try await client.send(
            Endpoint(
                method: .patch,
                path: "posts/\(id)",
                body: try JSONCoding.encoder.encode(["content": content])
            ),
            as: PostDTO.self
        )
    }

    func deletePost(id: String) async throws {
        try await client.send(Endpoint(method: .delete, path: "posts/\(id)"))
    }

    /// Счётчик просмотров: сервер сам считает одного зрителя раз в сутки.
    func markViewed(postID: String) async throws {
        try await client.send(.post("posts/\(postID)/view"))
    }

    /// Пост студента — в группу либо лично человеку (`PERSONAL` + `targetUserId`).
    func createPost(content: String, mediaIDs: [String], targetUserID: String?) async throws -> PostDTO {
        struct Body: Encodable {
            let audience: String
            let content: String
            let mediaIds: [String]?
            let targetUserId: String?
        }
        let body = Body(
            audience: targetUserID == nil ? "GROUP" : "PERSONAL",
            content: content,
            mediaIds: mediaIDs.isEmpty ? nil : mediaIDs,
            targetUserId: targetUserID
        )
        return try await client.send(try .post("posts", json: body), as: PostDTO.self)
    }

    /// Файл до 10 МБ — одним multipart через API, крупнее — напрямую в хранилище по
    /// подписи и подтверждением. Больше 50 МБ — загрузка частями (план 21.A4), её в
    /// приложении пока нет, и сервер ответит понятной ошибкой размера.
    func upload(_ data: Data, mime: String, filename: String, bucket: UploadBucket) async throws -> UploadedFileDTO {
        if data.count <= 10 * 1024 * 1024 {
            var form = MultipartForm()
            form.append(data, name: "file", filename: filename, mime: mime)
            var endpoint = Endpoint.multipart("files/upload", form: form)
            endpoint.query = [URLQueryItem(name: "bucket", value: bucket.rawValue)]
            return try await client.send(endpoint, as: UploadedFileDTO.self)
        }
        struct Presign: Encodable {
            let bucket: String
            let mime: String
        }
        struct Confirm: Encodable {
            let bucket: String
            let key: String
            let name: String
        }
        let ticket = try await client.send(
            try .post("files/presign", json: Presign(bucket: bucket.rawValue, mime: mime)),
            as: AttachmentUploadTicket.self
        )
        do {
            try await ChatsAPI(client: client).upload(data, to: ticket.url, mime: mime)
        } catch let error as URLError {
            // Хранилище недоступно с телефона — обычно подпись выдана на адрес, который
            // видит только сервер (`MINIO_PUBLIC_ENDPOINT` не задан). Это ошибка связи, а
            // не «неожиданный ответ»: так человек и разработчик ищут причину там, где она.
            throw APIError.transport(error)
        }
        return try await client.send(
            try .post("files/confirm", json: Confirm(bucket: bucket.rawValue, key: ticket.key, name: filename)),
            as: UploadedFileDTO.self
        )
    }

    /// Жалоба уходит модераторам вуза; своё на себя сервер не принимает.
    func report(_ target: ComplaintTarget, id: String, reason: String) async throws {
        struct Body: Encodable {
            let targetType: String
            let targetId: String
            let reason: String
        }
        try await client.send(
            try .post("complaints", json: Body(targetType: target.rawValue, targetId: id, reason: reason))
        )
    }

    /// Ближайшие события — короткая полоса на главной, как боковая колонка веба.
    func upcomingEvents() async throws -> [EventDTO] {
        try await client.page(
            .get(
                "events",
                query: [
                    URLQueryItem(name: "page", value: "1"),
                    URLQueryItem(name: "limit", value: "4"),
                    URLQueryItem(name: "filter", value: "upcoming"),
                ]
            ),
            of: EventDTO.self
        ).items
    }

    func unreadNotifications() async throws -> Int {
        struct Result: Decodable { let count: Int }
        return try await client.send(.get("notifications/unread-count"), as: Result.self).count
    }

    func search(_ query: String) async throws -> SearchResultsDTO {
        try await client.send(
            .get(
                "search",
                query: [
                    URLQueryItem(name: "q", value: query),
                    URLQueryItem(name: "types", value: "people,events"),
                ]
            ),
            as: SearchResultsDTO.self
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
