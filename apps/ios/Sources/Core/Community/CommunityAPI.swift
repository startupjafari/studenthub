import Foundation

// Соцчасть и личные разделы сверх ленты: друзья, статьи, медиа и альбомы профиля,
// актуальное историй, страница вуза, события, заявки, документы и запросы документов,
// привязка Telegram, состояние платформы, чаты для «поделиться». Контракты —
// `apps/api/src/modules/{friends,profile-content,stories,universities,events,applications,
// documents,mini,platform,chats,groups,faculties}`.

// MARK: - Общее

/// Человек в коротком виде: автор комментария, организатор, друг.
struct CommunityPersonDTO: Decodable, Equatable, Identifiable {
    let id: String
    let firstName: String?
    let lastName: String?
    var middleName: String? = nil
    var avatarUrl: String? = nil
    var avatarThumbUrl: String? = nil
    var role: String? = nil
    var headline: String? = nil

    var name: String {
        let value = [lastName, firstName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
        return value.isEmpty ? "—" : value
    }

    var avatar: String? { avatarUrl ?? avatarThumbUrl }
}

/// Подпись на языке интерфейса из трёх вариантов сервера (`nameRu/nameKk/nameEn`).
enum CommunityLocalized {
    static func pick(ru: String?, kk: String?, en: String?) -> String? {
        let code = Locale.current.language.languageCode?.identifier ?? "ru"
        let ordered: [String?]
        switch code {
        case "kk": ordered = [kk, ru, en]
        case "en": ordered = [en, ru, kk]
        default: ordered = [ru, kk, en]
        }
        return ordered.compactMap { $0 }.first { !$0.isEmpty }
    }
}

// MARK: - Лента

struct CommunityGroupDTO: Decodable, Equatable, Identifiable {
    let id: String
    let name: String
    var year: Int? = nil
    var facultyId: String? = nil
}

struct CommunityFacultyDTO: Decodable, Equatable, Identifiable {
    let id: String
    let name: String
}

/// Новая публикация со всеми полями `CreatePostSchema`.
struct CommunityPostInput: Encodable, Equatable {
    var audience: String
    var title: String?
    var content: String
    var facultyId: String?
    var groupId: String?
    var targetUserId: String?
    var subject: String?
    var mediaIds: [String]?
    /// `DRAFT` — сохранить без публикации; `PUBLISHED` — сразу или к `scheduledAt`.
    var status: String?
    var scheduledAt: Date?
}

/// Чат в списке «Отправить в чат».
struct CommunityChatDTO: Decodable, Equatable, Identifiable {
    let id: String
    let type: String
    let title: String?
    var avatarUrl: String? = nil
    var memberCount: Int? = nil
    var archived: Bool? = nil
    var pinned: Bool? = nil
    var blocked: Bool? = nil
}

struct CommunityJoinedChatDTO: Decodable, Equatable {
    let id: String
    var type: String? = nil
    var title: String? = nil
}

// MARK: - Статьи

struct CommunityArticleDTO: Decodable, Equatable, Identifiable {
    struct Organization: Decodable, Equatable {
        let id: String
        let name: String
        var logoUrl: String? = nil
    }

    let id: String
    let userId: String?
    let title: String
    let description: String?
    let coverUrl: String?
    var coverGradient: String? = nil
    var category: String? = nil
    var tags: [String]? = nil
    var visibility: String? = nil
    var allowComments: Bool? = nil
    var status: String? = nil
    var readingMinutes: Int? = nil
    var views: Int? = nil
    var publishedAt: Date? = nil
    let createdAt: Date
    var updatedAt: Date? = nil
    /// Markdown. В карточке (`view=card`) его нет.
    var content: String? = nil
    var commentCount: Int? = nil
    var bookmarksCount: Int? = nil
    var bookmarked: Bool? = nil
    var likesCount: Int? = nil
    var liked: Bool? = nil
    var company: Organization? = nil
    var universityPage: Organization? = nil

    var isDraft: Bool { status == "DRAFT" }
}

struct CommunityArticleCommentDTO: Decodable, Equatable, Identifiable {
    let id: String
    let content: String
    let createdAt: Date
    var authorId: String? = nil
    var author: CommunityPersonDTO? = nil
}

/// Тело создания и правки статьи. PATCH на сервере не частичный: уходит весь объект.
struct CommunityArticleInput: Encodable, Equatable {
    var title: String
    var description: String?
    var content: String
    var coverUrl: String?
    var category: String?
    var tags: [String]?
    var visibility: String
    var allowComments: Bool
    var status: String
}

// MARK: - Друзья

struct CommunityFriendDTO: Decodable, Equatable, Identifiable {
    let friendshipId: String
    var since: Date? = nil
    var createdAt: Date? = nil
    let user: CommunityPersonDTO

    var id: String { friendshipId }
}

struct CommunityFriendCountsDTO: Decodable, Equatable {
    let friends: Int
    var incomingRequests: Int? = nil
}

// MARK: - Медиа и альбомы профиля

struct CommunityAlbumDTO: Decodable, Equatable, Identifiable {
    let id: String
    let title: String
    var coverUrl: String? = nil
    var count: Int? = nil
    var createdAt: Date? = nil
}

// MARK: - Истории

struct CommunityStoryViewerDTO: Decodable, Equatable, Identifiable {
    let id: String
    let createdAt: Date
    let user: CommunityPersonDTO
    var reactions: [String]? = nil
}

struct CommunityHighlightDTO: Decodable, Equatable, Identifiable {
    struct Cover: Decodable, Equatable {
        var itemId: String? = nil
        var text: String? = nil
        var background: String? = nil
        var media: StoryDTO.Media? = nil
    }

    let id: String
    let title: String
    var cover: Cover? = nil
    var itemsCount: Int? = nil
}

/// Актуальное целиком. Элемент — та же история (без опроса и реакций), поэтому
/// разбирается в `StoryDTO` и показывается тем же холстом.
struct CommunityHighlightDetailDTO: Decodable, Equatable, Identifiable {
    let id: String
    let title: String
    var coverItemId: String? = nil
    let owner: CommunityPersonDTO
    var items: [StoryDTO]
    var canEdit: Bool? = nil
}

/// Опрос истории: один ответ, 2–4 варианта.
struct CommunityStoryPollInput: Encodable, Equatable {
    var question: String
    var options: [String]
}

/// Наклейка-упоминание в новой истории. Координаты — центр в долях кадра.
struct CommunityStoryMentionInput: Encodable, Equatable {
    var type = "mention"
    var userId: String
    var x: Double
    var y: Double
    var scale: Double = 1
    var rotation: Double = 0
}

/// Интерактивные части новой истории сверх файла и текста.
struct CommunityStoryExtras: Equatable {
    var linkUrl: String?
    var linkLabel: String?
    var poll: CommunityStoryPollInput?
    var mentions: [CommunityStoryMentionInput] = []

    var isEmpty: Bool { linkUrl == nil && poll == nil && mentions.isEmpty }
}

// MARK: - Вуз

struct CommunityUniversityPageDTO: Decodable, Equatable, Identifiable {
    let id: String
    let name: String
    var shortName: String? = nil
    var country: String? = nil
    var city: String? = nil
    var logoUrl: String? = nil
    var coverUrl: String? = nil
    var description: String? = nil
    var website: String? = nil
    var foundedYear: Int? = nil
    var contactEmail: String? = nil
    var contactPhone: String? = nil
    var address: String? = nil
    var telegram: String? = nil
    var instagram: String? = nil
    var linkedin: String? = nil
    var canPublish: Bool? = nil
    var canEdit: Bool? = nil
}

// MARK: - Telegram

struct CommunityTelegramLinkDTO: Decodable, Equatable {
    let linked: Bool
    var username: String? = nil
    var linkedAt: Date? = nil
    var lastSeenAt: Date? = nil
}

struct CommunityTelegramCodeDTO: Decodable, Equatable {
    let code: String
    let expiresIn: Int
}

// MARK: - Платформа

struct CommunityPlatformStateDTO: Decodable, Equatable {
    var disabledSections: [String]? = nil
}

// MARK: - События

struct CommunityEventDTO: Decodable, Equatable, Identifiable {
    struct Counts: Decodable, Equatable {
        let participants: Int?
    }

    let id: String
    var audience: String? = nil
    let title: String
    var description: String? = nil
    var location: String? = nil
    var isOnline: Bool? = nil
    var meetingProvider: String? = nil
    let startsAt: Date
    var endsAt: Date? = nil
    var organizerId: String? = nil
    var organizer: CommunityPersonDTO? = nil
    var counts: Counts? = nil
    var isRegistered: Bool? = nil
    var canManage: Bool? = nil

    enum CodingKeys: String, CodingKey {
        case id, audience, title, description, location, isOnline, meetingProvider, startsAt, endsAt
        case organizerId, organizer, isRegistered, canManage
        case counts = "_count"
    }

    /// Конец события по правилу сервера: без `endsAt` — начало плюс два часа.
    var effectiveEnd: Date { endsAt ?? startsAt.addingTimeInterval(120 * 60) }
    var isOver: Bool { effectiveEnd < Date() }
}

struct CommunityEventMeetingDTO: Decodable, Equatable {
    var provider: String? = nil
    let url: String
    var passcode: String? = nil
    var joinableFrom: Date? = nil
    var joinableUntil: Date? = nil
    var joinable: Bool? = nil
}

struct CommunityEventCommentDTO: Decodable, Equatable, Identifiable {
    struct Media: Decodable, Equatable, Identifiable {
        let id: String
        var mime: String? = nil
        var name: String? = nil
        var size: Int? = nil
    }

    struct Reply: Decodable, Equatable {
        let id: String
        var author: CommunityPersonDTO? = nil
        var content: String? = nil
        var deleted: Bool? = nil
    }

    struct Reaction: Decodable, Equatable {
        let emoji: String
        let userId: String
    }

    let id: String
    var content: String? = nil
    let createdAt: Date
    var replyToId: String? = nil
    var author: CommunityPersonDTO? = nil
    var media: [Media]? = nil
    var replyTo: Reply? = nil
    var reactions: [Reaction]? = nil
    var canDelete: Bool? = nil
}

struct CommunityEventInput: Encodable, Equatable {
    var audience: String
    var title: String
    var description: String
    var location: String?
    var isOnline: Bool?
    var meetingUrl: String?
    var meetingPasscode: String?
    var startsAt: Date
    var endsAt: Date?
    var groupId: String?
    var facultyId: String?
}

struct CommunityEventParticipantDTO: Decodable, Equatable, Identifiable {
    let userId: String
    var createdAt: Date? = nil
    let user: CommunityPersonDTO

    var id: String { userId }
}

// MARK: - Заявки

struct CommunityApplicationDTO: Decodable, Equatable, Identifiable {
    struct Service: Decodable, Equatable {
        struct Requirement: Decodable, Equatable, Identifiable {
            let id: String
            var documentType: String? = nil
            var titleRu: String? = nil
            var titleKk: String? = nil
            var titleEn: String? = nil
            var required: Bool? = nil

            var title: String { CommunityLocalized.pick(ru: titleRu, kk: titleKk, en: titleEn) ?? "—" }
        }

        struct Field: Decodable, Equatable, Identifiable {
            let id: String
            let code: String
            let type: String
            var labelRu: String? = nil
            var labelKk: String? = nil
            var labelEn: String? = nil
            var required: Bool? = nil
            var options: JSONValue? = nil
            var active: Bool? = nil

            var label: String { CommunityLocalized.pick(ru: labelRu, kk: labelKk, en: labelEn) ?? code }

            /// Варианты выбора: сервер хранит их JSON-ом — строками или объектами
            /// `{ value, labelRu… }`.
            var choices: [(value: String, title: String)] {
                guard let array = options?.array else { return [] }
                return array.compactMap { item in
                    if let text = item.string, item.object == nil { return (text, text) }
                    guard let object = item.object else { return nil }
                    let value = object["value"]?.string ?? object["code"]?.string ?? ""
                    let title = CommunityLocalized.pick(
                        ru: object["labelRu"]?.string ?? object["label"]?.string,
                        kk: object["labelKk"]?.string,
                        en: object["labelEn"]?.string
                    ) ?? value
                    return value.isEmpty ? nil : (value, title)
                }
            }
        }

        let id: String
        var code: String? = nil
        var nameRu: String? = nil
        var nameKk: String? = nil
        var nameEn: String? = nil
        var descriptionRu: String? = nil
        var descriptionKk: String? = nil
        var descriptionEn: String? = nil
        var slaHours: Int? = nil
        var deliveryModes: [String]? = nil
        var requirements: [Requirement]? = nil
        var formFields: [Field]? = nil

        var name: String { CommunityLocalized.pick(ru: nameRu, kk: nameKk, en: nameEn) ?? "—" }
        var details: String? { CommunityLocalized.pick(ru: descriptionRu, kk: descriptionKk, en: descriptionEn) }
    }

    struct Event: Decodable, Equatable, Identifiable {
        let id: String
        let action: String
        var fromStatus: String? = nil
        var toStatus: String? = nil
        var comment: String? = nil
        let createdAt: Date
    }

    struct Document: Decodable, Equatable, Identifiable {
        struct File: Decodable, Equatable, Identifiable {
            let id: String
            var mime: String? = nil
        }

        let id: String
        let requirementId: String
        var documentId: String? = nil
        var source: String? = nil
        let status: String
        var reviewComment: String? = nil
        var snapshotTitle: String? = nil
        var files: [File]? = nil
    }

    struct Result: Decodable, Equatable, Identifiable {
        let id: String
        let type: String
        var documentId: String? = nil
        var documentNumber: String? = nil
        var note: String? = nil
        let createdAt: Date
        var revoked: Bool? = nil
    }

    let id: String
    var number: String? = nil
    let status: String
    var deliveryType: String? = nil
    var formData: JSONValue? = nil
    var submittedAt: Date? = nil
    var dueAt: Date? = nil
    var readyAt: Date? = nil
    var issuedAt: Date? = nil
    let createdAt: Date
    var service: Service? = nil
    var rejectionReason: String? = nil
    var pickupLocation: String? = nil
    var pickupInstructions: String? = nil
    var pickupCode: String? = nil
    var events: [Event]? = nil
    var documents: [Document]? = nil
    var results: [Result]? = nil

    var serviceName: String {
        service?.name ?? String(localized: "applications.service", defaultValue: "Услуга")
    }
}

// MARK: - Документы

struct CommunityDocumentDTO: Decodable, Equatable, Identifiable {
    struct File: Decodable, Equatable, Identifiable {
        let id: String
        var mime: String? = nil
        var size: Int? = nil
        var order: Int? = nil
    }

    let id: String
    var category: String? = nil
    let type: String
    let title: String
    var numberMasked: String? = nil
    var issuedBy: String? = nil
    var issuedAt: Date? = nil
    var expiresAt: Date? = nil
    var comment: String? = nil
    var status: String? = nil
    var rejectionReason: String? = nil
    var issuedByUniversity: Bool? = nil
    var archivedAt: Date? = nil
    var createdAt: Date? = nil
    var files: [File]? = nil
    var fileCount: Int? = nil
    var accessCount: Int? = nil
}

struct CommunityDocumentAccessDTO: Decodable, Equatable, Identifiable {
    let id: String
    let granteeType: String
    var granteeId: String? = nil
    var reason: String? = nil
    var grantedAt: Date? = nil
    var expiresAt: Date? = nil
    var revokedAt: Date? = nil
    var active: Bool? = nil
}

struct CommunitySharedDocumentDTO: Decodable, Equatable, Identifiable {
    struct Owner: Decodable, Equatable {
        let id: String
        var name: String? = nil
    }

    let accessId: String
    var granteeType: String? = nil
    var reason: String? = nil
    var grantedAt: Date? = nil
    var expiresAt: Date? = nil
    var owner: Owner? = nil
    let document: CommunityDocumentDTO

    var id: String { accessId }
}

struct CommunityDocumentTypeDTO: Decodable, Equatable, Identifiable {
    let typeId: String
    let category: String
    var fields: [String]? = nil
    var enabled: Bool? = nil
    var label: String? = nil

    var id: String { typeId }
}

struct CommunityUploadedFileDTO: Decodable, Equatable {
    let id: String
    var mime: String? = nil
    var size: Int? = nil
}

struct CommunityDocumentInput: Encodable, Equatable {
    var category: String
    var type: String
    var title: String
    var number: String?
    var issuedBy: String?
    var issuedAt: Date?
    var expiresAt: Date?
    var comment: String?
}

// MARK: - Запросы документов

struct CommunityDocumentRequestDTO: Decodable, Equatable, Identifiable {
    let id: String
    let title: String
    var dueAt: Date? = nil
    var status: String? = nil
    var createdAt: Date? = nil
    var itemCount: Int? = nil
    var requiredCount: Int? = nil
    var filledRequired: Int? = nil
    var submissionStatus: String? = nil
    var acceptsSubmissions: Bool? = nil
}

struct CommunityDocumentRequestDetailDTO: Decodable, Equatable, Identifiable {
    struct Item: Decodable, Equatable, Identifiable {
        let id: String
        let documentType: String
        let title: String
        var required: Bool? = nil
        var order: Int? = nil
    }

    struct Submission: Decodable, Equatable {
        struct Entry: Decodable, Equatable {
            struct Linked: Decodable, Equatable {
                let id: String
                var title: String? = nil
                var type: String? = nil
            }

            let requestItemId: String
            var status: String? = nil
            var rejectionReason: String? = nil
            var document: Linked? = nil
        }

        let id: String
        var status: String? = nil
        var submittedAt: Date? = nil
        var items: [Entry]? = nil
    }

    let id: String
    let title: String
    var description: String? = nil
    var dueAt: Date? = nil
    var status: String? = nil
    var acceptsSubmissions: Bool? = nil
    var items: [Item]
    var submission: Submission? = nil
}

// MARK: - API

struct CommunityAPI: Sendable {
    private let client: APIClient

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    // MARK: Лента

    /// Пост целиком, со всеми полями `CreatePostSchema`: аудитория, заголовок, черновик,
    /// отложенная публикация.
    func createPost(_ input: CommunityPostInput) async throws -> PostDTO {
        try await client.send(try .post("posts", json: input), as: PostDTO.self)
    }

    func publishDraft(postID: String) async throws -> PostDTO {
        try await client.send(.post("posts/\(postID)/publish"), as: PostDTO.self)
    }

    func setPinned(postID: String, pinned: Bool) async throws {
        try await client.send(try .patch("posts/\(postID)/pin", json: ["pinned": pinned]))
    }

    /// Свои посты по статусу: черновики и отложенные видит только автор.
    func myPosts(authorID: String, status: String, cursor: String?) async throws -> Page<PostDTO> {
        try await client.page(
            .get("posts", params: [
                "authorId": authorID, "status": status, "cursor": cursor, "limit": "20", "reactions": "summary",
            ]),
            of: PostDTO.self
        )
    }

    func groups(search: String? = nil) async throws -> [CommunityGroupDTO] {
        try await client.page(
            .get("groups", params: ["page": "1", "limit": "100", "search": search]),
            of: CommunityGroupDTO.self
        ).items
    }

    func faculties() async throws -> [CommunityFacultyDTO] {
        try await client.page(
            .get("faculties", params: ["page": "1", "limit": "100"]),
            of: CommunityFacultyDTO.self
        ).items
    }

    /// Чаты для «Отправить в чат» — первая сотня по свежести, как список в вебе.
    func chats() async throws -> [CommunityChatDTO] {
        try await client.page(.get("chats", params: ["limit": "100"]), of: CommunityChatDTO.self).items
    }

    func sharePost(postID: String, chatID: String, comment: String?) async throws {
        struct Body: Encodable {
            let postId: String
            let comment: String?
        }
        try await client.send(try .post("chats/\(chatID)/share-post", json: Body(postId: postID, comment: comment)))
    }

    /// Вступление в группу по ссылке-приглашению (`/join-chat/<id>?k=<код>`).
    func joinChat(id: String, code: String) async throws -> CommunityJoinedChatDTO {
        try await client.send(try .post("chats/\(id)/join", json: ["code": code]), as: CommunityJoinedChatDTO.self)
    }

    // MARK: Статьи

    func articles(userID: String) async throws -> [CommunityArticleDTO] {
        try await client.send(
            .get("profile/\(userID)/articles", params: ["view": "card"]),
            as: [CommunityArticleDTO].self
        )
    }

    func universityArticles(universityID: String) async throws -> [CommunityArticleDTO] {
        try await client.send(
            .get("profile/university/\(universityID)/articles", params: ["view": "card"]),
            as: [CommunityArticleDTO].self
        )
    }

    func bookmarkedArticles() async throws -> [CommunityArticleDTO] {
        try await client.send(.get("profile/bookmarks"), as: [CommunityArticleDTO].self)
    }

    func article(id: String) async throws -> CommunityArticleDTO {
        try await client.send(.get("profile/articles/\(id)"), as: CommunityArticleDTO.self)
    }

    func relatedArticles(id: String) async throws -> [CommunityArticleDTO] {
        try await client.send(.get("profile/articles/\(id)/related"), as: [CommunityArticleDTO].self)
    }

    func markArticleViewed(id: String) async throws {
        try await client.send(.post("profile/articles/\(id)/view"))
    }

    func setArticleLiked(id: String, liked: Bool) async throws -> Int {
        struct Answer: Decodable { let likesCount: Int }
        let endpoint: Endpoint = liked ? .post("profile/articles/\(id)/like") : .delete("profile/articles/\(id)/like")
        return try await client.send(endpoint, as: Answer.self).likesCount
    }

    func toggleArticleBookmark(id: String) async throws -> Bool {
        struct Answer: Decodable { let bookmarked: Bool }
        return try await client.send(.post("profile/articles/\(id)/bookmark"), as: Answer.self).bookmarked
    }

    /// Комментарии от новых к старым страницами по курсору.
    func articleComments(id: String, cursor: String?) async throws -> Page<CommunityArticleCommentDTO> {
        try await client.page(
            .get("profile/articles/\(id)/comments", params: ["limit": "30", "cursor": cursor]),
            of: CommunityArticleCommentDTO.self
        )
    }

    func commentArticle(id: String, text: String) async throws -> CommunityArticleCommentDTO {
        try await client.send(
            try .post("profile/articles/\(id)/comments", json: ["content": text]),
            as: CommunityArticleCommentDTO.self
        )
    }

    func deleteArticleComment(articleID: String, commentID: String) async throws {
        try await client.send(.delete("profile/articles/\(articleID)/comments/\(commentID)"))
    }

    func createArticle(_ input: CommunityArticleInput) async throws -> CommunityArticleDTO {
        try await client.send(try .post("profile/articles", json: input), as: CommunityArticleDTO.self)
    }

    func updateArticle(id: String, _ input: CommunityArticleInput) async throws -> CommunityArticleDTO {
        try await client.send(try .patch("profile/articles/\(id)", json: input), as: CommunityArticleDTO.self)
    }

    func deleteArticle(id: String) async throws {
        try await client.send(.delete("profile/articles/\(id)"))
    }

    func uploadArticleCover(_ data: Data, mime: String) async throws -> String {
        struct Answer: Decodable { let url: String }
        var form = MultipartForm()
        form.append(data, name: "file", filename: "cover.jpg", mime: mime)
        return try await client.send(.multipart("profile/articles/cover", form: form), as: Answer.self).url
    }

    // MARK: Друзья

    func friends(cursor: String?) async throws -> Page<CommunityFriendDTO> {
        try await client.page(
            .get("friends", params: ["limit": "30", "cursor": cursor]),
            of: CommunityFriendDTO.self
        )
    }

    /// `incoming` — мне, `outgoing` — мои.
    func friendRequests(direction: String, cursor: String?) async throws -> Page<CommunityFriendDTO> {
        try await client.page(
            .get("friends/requests", params: ["direction": direction, "limit": "30", "cursor": cursor]),
            of: CommunityFriendDTO.self
        )
    }

    func friendCounts() async throws -> CommunityFriendCountsDTO {
        try await client.send(.get("friends/count"), as: CommunityFriendCountsDTO.self)
    }

    func requestFriendship(userID: String) async throws {
        try await client.send(try .post("friends/requests", json: ["userId": userID]))
    }

    func acceptFriendship(id: String) async throws {
        try await client.send(.post("friends/requests/\(id)/accept"))
    }

    func removeFriendship(id: String) async throws {
        try await client.send(.delete("friends/\(id)"))
    }

    // MARK: Медиа и альбомы профиля

    /// Фото или видео в профиль: до 10 МБ — одним multipart, крупнее — по подписи.
    func uploadProfileMedia(_ data: Data, mime: String, filename: String) async throws -> ProfileMediaDTO {
        if data.count <= 10 * 1024 * 1024 {
            var form = MultipartForm()
            form.append(data, name: "file", filename: filename, mime: mime)
            return try await client.send(.multipart("profile/media", form: form), as: ProfileMediaDTO.self)
        }
        struct Presign: Encodable {
            let mime: String
            let size: Int
        }
        struct Confirm: Encodable {
            let key: String
            let mime: String
        }
        let ticket = try await client.send(
            try .post("profile/media/presign", json: Presign(mime: mime, size: data.count)),
            as: AttachmentUploadTicket.self
        )
        do {
            try await ChatsAPI(client: client).upload(data, to: ticket.url, mime: mime)
        } catch let error as URLError {
            throw APIError.transport(error)
        }
        return try await client.send(
            try .post("profile/media/confirm", json: Confirm(key: ticket.key, mime: mime)),
            as: ProfileMediaDTO.self
        )
    }

    func deleteProfileMedia(fileID: String) async throws {
        try await client.send(.delete("profile/media/\(fileID)"))
    }

    func albums(userID: String) async throws -> [CommunityAlbumDTO] {
        try await client.send(.get("profile/\(userID)/albums"), as: [CommunityAlbumDTO].self)
    }

    func universityAlbums(universityID: String) async throws -> [CommunityAlbumDTO] {
        try await client.send(.get("profile/university/\(universityID)/albums"), as: [CommunityAlbumDTO].self)
    }

    func createAlbum(title: String) async throws -> CommunityAlbumDTO {
        try await client.send(try .post("profile/albums", json: ["title": title]), as: CommunityAlbumDTO.self)
    }

    func renameAlbum(id: String, title: String) async throws -> CommunityAlbumDTO {
        try await client.send(try .patch("profile/albums/\(id)", json: ["title": title]), as: CommunityAlbumDTO.self)
    }

    func setAlbumCover(id: String, fileID: String) async throws -> CommunityAlbumDTO {
        try await client.send(try .patch("profile/albums/\(id)", json: ["coverFileId": fileID]), as: CommunityAlbumDTO.self)
    }

    func deleteAlbum(id: String) async throws {
        try await client.send(.delete("profile/albums/\(id)"))
    }

    func addToAlbum(id: String, fileIDs: [String]) async throws {
        try await client.send(try .post("profile/albums/\(id)/media", json: ["fileIds": fileIDs]))
    }

    func removeFromAlbum(id: String, fileID: String) async throws {
        try await client.send(.delete("profile/albums/\(id)/media/\(fileID)"))
    }

    func universityMedia(universityID: String) async throws -> [ProfileMediaDTO] {
        try await client.send(.get("profile/university/\(universityID)/media"), as: [ProfileMediaDTO].self)
    }

    // MARK: Истории

    func storyViewers(storyID: String, cursor: String?) async throws -> Page<CommunityStoryViewerDTO> {
        try await client.page(
            .get("stories/\(storyID)/viewers", params: ["limit": "30", "cursor": cursor]),
            of: CommunityStoryViewerDTO.self
        )
    }

    /// История с интерактивом: ссылка, опрос, упоминания.
    func createStory(
        fileID: String?, text: String?, background: String?, audience: StoryAudience, extras: CommunityStoryExtras
    ) async throws {
        struct Body: Encodable {
            let audience: String
            let fileId: String?
            let text: String?
            let background: String?
            let linkUrl: String?
            let linkLabel: String?
            let poll: CommunityStoryPollInput?
            let elements: [CommunityStoryMentionInput]?
        }
        let body = Body(
            audience: audience.rawValue,
            fileId: fileID,
            text: text,
            background: background,
            linkUrl: extras.linkUrl,
            linkLabel: extras.linkUrl == nil ? nil : extras.linkLabel,
            poll: extras.poll,
            elements: extras.mentions.isEmpty ? nil : extras.mentions
        )
        try await client.send(try .post("stories", json: body))
    }

    func highlights(ownerID: String) async throws -> [CommunityHighlightDTO] {
        try await client.send(.get("stories/highlights", params: ["ownerId": ownerID]), as: [CommunityHighlightDTO].self)
    }

    func highlight(id: String) async throws -> CommunityHighlightDetailDTO {
        try await client.send(.get("stories/highlights/\(id)"), as: CommunityHighlightDetailDTO.self)
    }

    func createHighlight(title: String, storyID: String) async throws -> CommunityHighlightDetailDTO {
        try await client.send(
            try .post("stories/highlights", json: ["title": title, "storyId": storyID]),
            as: CommunityHighlightDetailDTO.self
        )
    }

    func renameHighlight(id: String, title: String) async throws -> CommunityHighlightDetailDTO {
        try await client.send(
            try .patch("stories/highlights/\(id)", json: ["title": title]),
            as: CommunityHighlightDetailDTO.self
        )
    }

    func setHighlightCover(id: String, itemID: String) async throws -> CommunityHighlightDetailDTO {
        try await client.send(
            try .patch("stories/highlights/\(id)", json: ["coverItemId": itemID]),
            as: CommunityHighlightDetailDTO.self
        )
    }

    func deleteHighlight(id: String) async throws {
        try await client.send(.delete("stories/highlights/\(id)"))
    }

    func addToHighlight(id: String, storyID: String) async throws -> CommunityHighlightDetailDTO {
        try await client.send(
            try .post("stories/highlights/\(id)/items", json: ["storyId": storyID]),
            as: CommunityHighlightDetailDTO.self
        )
    }

    /// `true` — это был последний элемент, и сервер удалил актуальное целиком.
    func removeFromHighlight(id: String, itemID: String) async throws -> Bool {
        struct Answer: Decodable { let deleted: Bool }
        return try await client.send(.delete("stories/highlights/\(id)/items/\(itemID)"), as: Answer.self).deleted
    }

    func reorderHighlights(ids: [String]) async throws {
        try await client.send(try .put("stories/highlights/order", json: ["ids": ids]))
    }

    func reorderHighlightItems(id: String, ids: [String]) async throws {
        try await client.send(try .put("stories/highlights/\(id)/items/order", json: ["ids": ids]))
    }

    // MARK: Вуз

    func universityPage(id: String) async throws -> CommunityUniversityPageDTO {
        try await client.send(.get("universities/\(id)/page"), as: CommunityUniversityPageDTO.self)
    }

    func universityCounts(id: String) async throws -> ProfileCountsDTO {
        try await client.send(.get("profile/university/\(id)/counts"), as: ProfileCountsDTO.self)
    }

    /// Посты страницы вуза — та же лента с параметром `universityPageId`.
    func universityPosts(id: String, cursor: String?) async throws -> Page<PostDTO> {
        try await client.page(
            .get("posts", params: ["universityPageId": id, "cursor": cursor, "limit": "20", "reactions": "summary"]),
            of: PostDTO.self
        )
    }

    // MARK: Аккаунт

    /// Язык писем и пушей: `ru`, `kk`, `en`.
    func setLocale(_ locale: String) async throws -> UserProfileDTO {
        try await client.send(try .patch("users/me", json: ["locale": locale]), as: UserProfileDTO.self)
    }

    func telegramLink() async throws -> CommunityTelegramLinkDTO {
        try await client.send(.get("mini/link"), as: CommunityTelegramLinkDTO.self)
    }

    func telegramCode() async throws -> CommunityTelegramCodeDTO {
        try await client.send(.post("mini/link-code"), as: CommunityTelegramCodeDTO.self)
    }

    func revokeTelegramLink() async throws {
        try await client.send(.delete("mini/link"))
    }

    func platformState() async throws -> CommunityPlatformStateDTO {
        try await client.send(.get("platform/state"), as: CommunityPlatformStateDTO.self)
    }

    // MARK: События

    /// `filter`: `upcoming` или `past`; `mine` — только те, куда я записан.
    func events(filter: String, mine: Bool, page: PageRequest) async throws -> Page<CommunityEventDTO> {
        try await client.page(
            .get("events", query: page.pageQuery + [
                URLQueryItem(name: "filter", value: filter),
                URLQueryItem(name: "mine", value: mine ? "true" : "false"),
            ]),
            of: CommunityEventDTO.self
        )
    }

    func event(id: String) async throws -> CommunityEventDTO {
        try await client.send(.get("events/\(id)"), as: CommunityEventDTO.self)
    }

    func createEvent(_ input: CommunityEventInput) async throws -> CommunityEventDTO {
        try await client.send(try .post("events", json: input), as: CommunityEventDTO.self)
    }

    func updateEvent(id: String, fields: [String: JSONValue]) async throws -> CommunityEventDTO {
        try await client.send(try .patch("events/\(id)", json: JSONBody(fields)), as: CommunityEventDTO.self)
    }

    func deleteEvent(id: String) async throws {
        try await client.send(.delete("events/\(id)"))
    }

    func setRegistered(eventID: String, _ on: Bool) async throws {
        if on {
            try await client.send(.post("events/\(eventID)/register"))
        } else {
            try await client.send(.delete("events/\(eventID)/register"))
        }
    }

    func eventMeeting(id: String) async throws -> CommunityEventMeetingDTO {
        try await client.send(.get("events/\(id)/meeting"), as: CommunityEventMeetingDTO.self)
    }

    func eventComments(id: String, cursor: String?) async throws -> Page<CommunityEventCommentDTO> {
        try await client.page(
            .get("events/\(id)/comments", params: ["limit": "30", "cursor": cursor]),
            of: CommunityEventCommentDTO.self
        )
    }

    func commentEvent(id: String, text: String, replyTo: String?) async throws -> CommunityEventCommentDTO {
        struct Body: Encodable {
            let content: String
            let replyToId: String?
        }
        return try await client.send(
            try .post("events/\(id)/comments", json: Body(content: text, replyToId: replyTo)),
            as: CommunityEventCommentDTO.self
        )
    }

    func deleteEventComment(eventID: String, commentID: String) async throws {
        try await client.send(.delete("events/\(eventID)/comments/\(commentID)"))
    }

    // MARK: Заявки

    func applications(page: PageRequest, status: String?) async throws -> Page<CommunityApplicationDTO> {
        var query = page.pageQuery
        if let status { query.append(URLQueryItem(name: "status", value: status)) }
        return try await client.page(.get("applications", query: query), of: CommunityApplicationDTO.self)
    }

    func application(id: String) async throws -> CommunityApplicationDTO {
        try await client.send(.get("applications/\(id)"), as: CommunityApplicationDTO.self)
    }

    func updateApplication(id: String, formData: [String: JSONValue]) async throws {
        try await client.send(try .patch("applications/\(id)", json: JSONBody(["formData": .object(formData)])))
    }

    func submitApplication(id: String) async throws {
        try await client.send(.post("applications/\(id)/submit"))
    }

    func resubmitApplication(id: String) async throws {
        try await client.send(.post("applications/\(id)/resubmit"))
    }

    func cancelApplication(id: String, reason: String?) async throws {
        try await client.send(try .post("applications/\(id)/cancel", json: JSONBody(["reason": reason.map(JSONValue.string) ?? .null])))
    }

    func attachDocument(applicationID: String, requirementID: String, documentID: String) async throws {
        try await client.send(
            try .post(
                "applications/\(applicationID)/documents",
                json: ["requirementId": requirementID, "documentId": documentID]
            )
        )
    }

    func detachDocument(applicationID: String, requirementID: String) async throws {
        try await client.send(.delete("applications/\(applicationID)/documents/\(requirementID)"))
    }

    func applicationDocumentURL(applicationID: String, rowID: String, fileID: String?) async throws -> URL {
        try await url(.get("applications/\(applicationID)/documents/\(rowID)/url", params: ["fileId": fileID]))
    }

    func applicationResultURL(applicationID: String, resultID: String) async throws -> URL {
        try await url(.get("applications/\(applicationID)/results/\(resultID)/url", params: ["download": "1"]))
    }

    // MARK: Документы

    /// `view`: `active` или `archived`.
    func documents(view: String, page: PageRequest, search: String?, category: String?) async throws -> Page<CommunityDocumentDTO> {
        try await client.page(
            .get("documents", params: [
                "view": view, "page": String(page.page), "limit": String(page.limit), "search": search, "category": category,
            ]),
            of: CommunityDocumentDTO.self
        )
    }

    /// Все действующие документы одним списком — для выбора в заявку и в запрос.
    func allDocuments() async throws -> [CommunityDocumentDTO] {
        try await client.send(.get("documents", params: ["view": "active"]), as: [CommunityDocumentDTO].self)
    }

    func sharedWithMe(page: PageRequest) async throws -> Page<CommunitySharedDocumentDTO> {
        try await client.page(.get("documents/shared-with-me", query: page.pageQuery), of: CommunitySharedDocumentDTO.self)
    }

    func documentTypes() async throws -> [CommunityDocumentTypeDTO] {
        try await client.send(.get("document-types/effective"), as: [CommunityDocumentTypeDTO].self)
    }

    /// Файл документа: PDF, JPG или PNG. Крупнее 10 МБ — по подписи.
    func uploadDocumentFile(_ data: Data, mime: String, filename: String) async throws -> CommunityUploadedFileDTO {
        if data.count <= 10 * 1024 * 1024 {
            var form = MultipartForm()
            form.append(data, name: "file", filename: filename, mime: mime)
            return try await client.send(.multipart("documents/upload", form: form), as: CommunityUploadedFileDTO.self)
        }
        let ticket = try await client.send(
            try .post("documents/upload/presign", json: ["mime": mime]),
            as: AttachmentUploadTicket.self
        )
        do {
            try await ChatsAPI(client: client).upload(data, to: ticket.url, mime: mime)
        } catch let error as URLError {
            throw APIError.transport(error)
        }
        return try await client.send(
            try .post("documents/upload/confirm", json: ["key": ticket.key, "name": filename]),
            as: CommunityUploadedFileDTO.self
        )
    }

    func createDocument(_ input: CommunityDocumentInput) async throws -> CommunityDocumentDTO {
        try await client.send(try .post("documents", json: input), as: CommunityDocumentDTO.self)
    }

    func addDocumentFiles(documentID: String, fileIDs: [String]) async throws {
        try await client.send(try .post("documents/\(documentID)/files", json: ["fileIds": fileIDs]))
    }

    func updateDocument(id: String, fields: [String: JSONValue]) async throws -> CommunityDocumentDTO {
        try await client.send(try .patch("documents/\(id)", json: JSONBody(fields)), as: CommunityDocumentDTO.self)
    }

    func deleteDocumentFile(documentID: String, fileID: String) async throws {
        try await client.send(.delete("documents/\(documentID)/files/\(fileID)"))
    }

    func setArchived(documentID: String, _ archived: Bool) async throws {
        try await client.send(.post("documents/\(documentID)/\(archived ? "archive" : "unarchive")"))
    }

    func deleteDocument(id: String) async throws {
        try await client.send(.delete("documents/\(id)"))
    }

    func documentFileURL(documentID: String, fileID: String) async throws -> URL {
        try await url(.get("documents/\(documentID)/files/\(fileID)/url", params: ["download": "1"]))
    }

    func documentAccess(id: String) async throws -> [CommunityDocumentAccessDTO] {
        try await client.send(.get("documents/\(id)/access"), as: [CommunityDocumentAccessDTO].self)
    }

    func grantAccess(documentID: String, granteeType: String, granteeID: String?, reason: String, expiresAt: Date?) async throws {
        struct Body: Encodable {
            let granteeType: String
            let granteeId: String?
            let reason: String
            let expiresAt: Date?
        }
        try await client.send(
            try .post(
                "documents/\(documentID)/access",
                json: Body(granteeType: granteeType, granteeId: granteeID, reason: reason, expiresAt: expiresAt)
            )
        )
    }

    func revokeAccess(documentID: String, accessID: String) async throws {
        try await client.send(.delete("documents/\(documentID)/access/\(accessID)"))
    }

    // MARK: Запросы документов

    func documentRequests() async throws -> [CommunityDocumentRequestDTO] {
        try await client.send(.get("document-requests"), as: [CommunityDocumentRequestDTO].self)
    }

    func documentRequest(id: String) async throws -> CommunityDocumentRequestDetailDTO {
        try await client.send(.get("document-requests/\(id)"), as: CommunityDocumentRequestDetailDTO.self)
    }

    /// Привязать документы к пунктам запроса; `nil` — отвязать.
    func saveSubmission(requestID: String, links: [(itemID: String, documentID: String?)]) async throws -> CommunityDocumentRequestDetailDTO {
        let items: [JSONValue] = links.map { link in
            .object(["requestItemId": .string(link.itemID), "documentId": link.documentID.map(JSONValue.string) ?? .null])
        }
        return try await client.send(
            try .put("document-requests/\(requestID)/submission", json: JSONBody(["items": .array(items)])),
            as: CommunityDocumentRequestDetailDTO.self
        )
    }

    func submitRequest(id: String) async throws -> CommunityDocumentRequestDetailDTO {
        try await client.send(.post("document-requests/\(id)/submit"), as: CommunityDocumentRequestDetailDTO.self)
    }

    // MARK: Внутреннее

    private func url(_ endpoint: Endpoint) async throws -> URL {
        struct Answer: Decodable { let url: URL }
        return try await client.send(endpoint, as: Answer.self).url
    }
}

extension CommunityAPI {
    /// Репост статьи в ленту — пост со ссылкой на статью, в свою группу.
    func repostArticle(id: String, audience: String = "GROUP") async throws {
        try await AppServices.api.send(try .post("posts/articles/\(id)/repost", json: ["audience": audience]))
    }
}

extension CommunityAPI {
    /// Участники — только тем, кто управляет событием.
    func eventParticipants(id: String) async throws -> [CommunityEventParticipantDTO] {
        try await AppServices.api.send(.get("events/\(id)/participants"), as: [CommunityEventParticipantDTO].self)
    }

    /// Реакция на комментарий события — переключатель.
    func reactEventComment(eventID: String, commentID: String, emoji: String) async throws {
        try await AppServices.api.send(
            try .post("events/\(eventID)/comments/\(commentID)/reactions", json: ["emoji": emoji])
        )
    }
}

// MARK: - Каталог услуг

struct CommunityServiceCategoryDTO: Decodable, Equatable, Identifiable {
    let id: String
    var code: String? = nil
    var nameRu: String? = nil
    var nameKk: String? = nil
    var nameEn: String? = nil
    var services: [CommunityApplicationDTO.Service]

    var name: String { CommunityLocalized.pick(ru: nameRu, kk: nameKk, en: nameEn) ?? "—" }
}

extension CommunityAPI {
    func serviceCategories() async throws -> [CommunityServiceCategoryDTO] {
        try await AppServices.api.send(.get("application-categories"), as: [CommunityServiceCategoryDTO].self)
    }

    func service(id: String) async throws -> CommunityApplicationDTO.Service {
        try await AppServices.api.send(.get("application-services/\(id)"), as: CommunityApplicationDTO.Service.self)
    }

    /// Заявка заводится черновиком: анкету и документы заполняют потом.
    func createApplication(serviceID: String) async throws -> CommunityApplicationDTO {
        try await AppServices.api.send(try .post("applications", json: ["serviceId": serviceID]), as: CommunityApplicationDTO.self)
    }

    func updateApplication(id: String, formData: [String: JSONValue], deliveryType: String?) async throws {
        var fields: [String: JSONValue] = ["formData": .object(formData)]
        if let deliveryType { fields["deliveryType"] = .string(deliveryType) }
        try await AppServices.api.send(try .patch("applications/\(id)", json: JSONBody(fields)))
    }
}
