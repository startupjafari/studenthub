import Foundation

// Администрирование и модерация: жалобы, журнал, пользователи, приглашения, поддержка,
// вузы и заявки на демо, аналитика платформы, спец-доступ к документам, модерация постов.
// Контракты — `apps/api/src/modules/{complaints,users,invites,chats/support,universities,
// onboarding,analytics,documents,posts,kato}` и `common/audit`.

// MARK: - Общие ссылки

/// Человек в ответах админских ручек: автор жалобы, разбирающий, автор обращения.
struct AdminPersonDTO: Decodable, Equatable, Hashable {
    let id: String
    let firstName: String?
    let lastName: String?
    var role: String? = nil
    var avatarUrl: String? = nil
    var avatarThumbUrl: String? = nil
    /// Короткое название вуза автора обращения; у платформенных ролей — `nil`.
    var university: String? = nil

    var name: String { DisplayFormat.name(first: firstName, last: lastName) }
}

/// Пара «id — название»: факультет, вуз в карточке модератора.
struct AdminNamedRefDTO: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let name: String
}

struct AdminKeyValueDTO: Decodable, Equatable, Hashable {
    let key: String
    let value: Double
}

// MARK: - Жалобы

struct AdminComplaintDTO: Decodable, Equatable, Identifiable {
    struct Preview: Decodable, Equatable {
        let title: String?
        let text: String?
        let mediaCount: Int?
        let deleted: Bool?
    }

    let id: String
    let targetType: String
    let targetId: String
    let reason: String?
    let status: String
    let priority: String?
    let resolution: String?
    let resolvedAt: Date?
    let createdAt: Date
    let reporter: AdminPersonDTO?
    let resolvedBy: AdminPersonDTO?
    let reviewingBy: AdminPersonDTO?
    /// Только в карточке: сколько разных людей жаловались на ту же цель.
    var targetReports: Int? = nil
    /// Только в карточке: кто отвечает за цель (автор поста, отправитель сообщения).
    var targetOwnerId: String? = nil
    var targetPreview: Preview? = nil

    var isOpen: Bool { status == "PENDING" || status == "REVIEWING" }

    /// Приоритет приходит с сервера; у старых записей его нет — тогда по категории цели,
    /// тем же правилом, что у сервера (`COMPLAINT_PRIORITY_BY_TARGET`).
    var effectivePriority: String {
        if let priority { return priority }
        switch targetType {
        case "USER", "MESSAGE": return "HIGH"
        case "COMMENT": return "LOW"
        default: return "MEDIUM"
        }
    }
}

/// Сообщение из окна переписки вокруг обжалованного.
struct AdminComplaintMessageDTO: Decodable, Equatable, Identifiable {
    let id: String
    let senderId: String?
    let content: String?
    let createdAt: Date
    let deletedAt: Date?
    let sender: AdminPersonDTO?
}

// MARK: - Журнал

struct AdminAuditEntryDTO: Decodable, Equatable, Identifiable {
    let id: String
    let userId: String?
    let action: String
    let entity: String?
    let entityId: String?
    let metadata: JSONValue?
    let ip: String?
    let userAgent: String?
    let createdAt: Date
}

// MARK: - Пользователи

struct AdminUserDTO: Decodable, Equatable, Identifiable {
    let id: String
    let email: String?
    let firstName: String?
    let lastName: String?
    let role: String
    let avatarUrl: String?
    let avatarThumbUrl: String?
    let universityId: String?
    let facultyId: String?
    let groupId: String?
    let isBlocked: Bool?
    let twoFactorEnabled: Bool?
    let createdAt: Date?

    var name: String { DisplayFormat.name(first: firstName, last: lastName) }
}

/// Карточка человека для модератора: роль, вуз, доступ, история нарушений.
struct AdminModerationCardDTO: Decodable, Equatable {
    struct Complaints: Decodable, Equatable {
        let total: Int
        let upheld: Int
    }

    let id: String
    let firstName: String?
    let lastName: String?
    let role: String
    let isBlocked: Bool
    let blockedUntil: Date?
    let createdAt: Date?
    let university: AdminNamedRefDTO?
    let warnings: Int?
    let complaints: Complaints?
}

// MARK: - Приглашения

struct AdminInviteDTO: Decodable, Equatable, Identifiable {
    let id: String
    let role: String
    let email: String?
    let status: String
    let universityId: String?
    let facultyId: String?
    let groupId: String?
    let expiresAt: Date?
    let createdAt: Date?
    let createdBy: AdminPersonDTO?
}

/// Только что выданное приглашение: токен приходит ровно один раз.
struct AdminCreatedInviteDTO: Decodable, Equatable {
    let id: String
    let token: String
    let role: String
    let expiresAt: Date?
}

struct AdminBulkPreviewDTO: Decodable, Equatable {
    struct Row: Decodable, Equatable, Identifiable {
        let line: Int
        let email: String
        let groupName: String?
        let role: String
        let groupId: String?
        let facultyName: String?
        let facultyId: String?
        let status: String
        let error: String?

        var id: Int { line }
    }

    struct Summary: Decodable, Equatable {
        let total: Int
        let ready: Int
        let duplicate: Int
        let error: Int
    }

    let rows: [Row]
    let summary: Summary
}

struct AdminBulkResultDTO: Decodable, Equatable {
    let created: Int
    let skipped: Int
    let failed: Int
}

struct AdminGroupDTO: Decodable, Equatable, Identifiable, Hashable {
    let id: String
    let name: String
    let year: Int?
}

// MARK: - Вузы и заявки

struct AdminUniversityDTO: Decodable, Equatable, Identifiable, Hashable {
    let id: String
    let name: String
    let shortName: String?
    let status: String
    let country: String?
    let city: String?
    let timezone: String?
    let createdAt: Date?
}

struct AdminUniversityStatsDTO: Decodable, Equatable {
    let faculties: Int?
    let groups: Int?
    let rooms: Int?
    let students: Int?
    let teachers: Int?
}

/// Населённый пункт справочника КАТО: у вуза хранится код, а показывается название.
struct AdminKatoUnitDTO: Decodable, Equatable, Identifiable, Hashable {
    let code: String
    let kind: String?
    let nameRu: String
    let regionNameRu: String?

    var id: String { code }
}

struct AdminDemoRequestDTO: Decodable, Equatable, Identifiable {
    let id: String
    let universityName: String
    let city: String?
    let country: String?
    let website: String?
    let studentsEstimate: Int?
    let contactName: String
    let contactRole: String?
    let email: String
    let phone: String?
    let comment: String?
    let status: String
    let consentAt: Date?
    let consentVersion: String?
    let reviewedAt: Date?
    let rejectionReason: String?
    let reviewNote: String?
    let universityId: String?
    let createdAt: Date
}

// MARK: - Поддержка

struct AdminSupportTicketDTO: Decodable, Equatable, Identifiable {
    struct LastMessage: Decodable, Equatable {
        let text: String?
        let createdAt: Date
        let fromAuthor: Bool?
    }

    let id: String
    let author: AdminPersonDTO?
    let lastMessage: LastMessage?
    let closedAt: Date?
    let assigneeId: String?
    let assignee: AdminPersonDTO?
    let firstReplyAt: Date?
    let tags: [String]?
    let createdAt: Date
    let updatedAt: Date?
}

struct AdminSupportMessageDTO: Decodable, Equatable, Identifiable {
    struct Attachment: Decodable, Equatable, Identifiable {
        let id: String
        let mime: String?
        let size: Int?
        let name: String?
    }

    let id: String
    let content: String?
    let createdAt: Date
    let sender: AdminPersonDTO?
    let media: [Attachment]?
}

struct AdminSupportThreadDTO: Decodable, Equatable {
    struct Sibling: Decodable, Equatable, Identifiable {
        let id: String
        let createdAt: Date
        let closed: Bool?
    }

    let ticket: AdminSupportTicketDTO
    let messages: [AdminSupportMessageDTO]
    let earlierCursor: String?
    let mergedCount: Int?
    let siblings: [Sibling]?
}

struct AdminSupportTagCountDTO: Decodable, Equatable {
    let tag: String
    let count: Int
}

// MARK: - Аналитика платформы

struct AdminPlatformOverviewDTO: Decodable, Equatable {
    struct Universities: Decodable, Equatable {
        let active: Int
        let pending: Int
        let blocked: Int
    }

    struct Users: Decodable, Equatable {
        let total: Int
        let spark: [Double]?
    }

    struct Complaints: Decodable, Equatable {
        let pending: Int
        let spark: [Double]?
    }

    struct Resolution: Decodable, Equatable {
        let median: Double?
        let previousMedian: Double?
    }

    struct Active: Decodable, Equatable {
        let dau: Int
        let wau: Int
        let spark: [Double]?
    }

    let universities: Universities
    let users: Users
    let complaints: Complaints
    let resolutionHours: Resolution
    let activeUsers: Active
}

/// Несколько рядов по корзинам времени: рост пользователей, DAU/WAU, поток жалоб.
struct AdminSeriesDTO: Decodable, Equatable {
    struct Point: Decodable, Equatable {
        let at: Date
        let value: Double
    }

    struct Line: Decodable, Equatable {
        let key: String
        let points: [Point]
    }

    let interval: String?
    let series: [Line]
}

struct AdminUniversitiesSizeDTO: Decodable, Equatable {
    struct Item: Decodable, Equatable, Identifiable {
        let id: String
        let name: String
        let shortName: String?
        let status: String
        let city: String?
        let students: Int
        let teachers: Int
        let total: Int
        let faculties: Int
        let groups: Int
        let rooms: Int
    }

    struct Totals: Decodable, Equatable {
        let universities: Int
        let active: Int
        let faculties: Int
        let groups: Int
        let rooms: Int
        let students: Int
        let teachers: Int
        let total: Int
    }

    let items: [Item]
    let totals: Totals
}

struct AdminLatencyDTO: Decodable, Equatable {
    let medianHours: Double?
    let buckets: [AdminKeyValueDTO]
}

struct AdminInvitesFunnelDTO: Decodable, Equatable {
    let total: Int
    let used: Int
    let conversion: Double
    let byStatus: [AdminKeyValueDTO]
}

struct AdminHeatmapDTO: Decodable, Equatable {
    /// `cells[dow][hour]`, dow: 0 — понедельник.
    let cells: [[Double]]
    /// Сколько дат каждого дня недели попало в период — делитель для среднего.
    let days: [Int]
    let max: Double?
}

struct AdminTopActionsDTO: Decodable, Equatable {
    struct Item: Decodable, Equatable {
        let action: String
        let value: Double
    }

    let items: [Item]
}

/// Период дашборда платформы: полуинтервал [from, to) и шаг корзин.
struct AdminPlatformRange: Equatable, Hashable {
    let from: Date
    let to: Date
    let interval: String

    var params: [String: String?] {
        ["from": JSONCoding.isoString(from), "to": JSONCoding.isoString(to), "interval": interval]
    }

    /// Последние `days` дней, выровненные по корзинам: неделя — с понедельника, как у
    /// `date_trunc('week')` на сервере, иначе первая корзина обрезана и выглядит провалом.
    static func last(days: Int) -> AdminPlatformRange {
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
        let weekly = days > 31
        let today = calendar.startOfDay(for: Date())
        let to = calendar.date(byAdding: .day, value: 1, to: today) ?? Date()
        var from = calendar.date(byAdding: .day, value: -days + 1, to: today) ?? today
        if weekly, let monday = calendar.dateInterval(of: .weekOfYear, for: from)?.start {
            from = monday
        }
        return AdminPlatformRange(from: from, to: to, interval: weekly ? "week" : "day")
    }
}

// MARK: - Документы (спец-доступ платформы)

struct AdminPlatformDocumentDTO: Decodable, Equatable, Identifiable {
    struct File: Decodable, Equatable, Identifiable {
        let id: String
        let mime: String?
        let size: Int?
        let order: Int?
    }

    let id: String
    let category: String?
    let type: String?
    let title: String
    let numberMasked: String?
    let issuedBy: String?
    let issuedAt: Date?
    let expiresAt: Date?
    let comment: String?
    let status: String?
    let files: [File]?
    let fileCount: Int?
}

// MARK: - Роли

enum AdminRoles {
    /// Порядок ролей сверху вниз — как `ROLE_HIERARCHY` в shared-types. Действие над
    /// человеком (блокировка, сброс 2FA, отзыв приглашения) — только строго младшему.
    static let hierarchy: [String] = [
        "PLATFORM_ADMIN", "PLATFORM_MODERATOR", "UNIVERSITY_ADMIN", "UNIVERSITY_MODERATOR", "DEAN",
        "TEACHER", "STAROSTA", "STUDENT", "SECURITY_GUARD", "LIBRARIAN", "EMPLOYER",
    ]

    static func isHigher(_ viewer: Role, than other: String) -> Bool {
        guard
            let mine = hierarchy.firstIndex(of: viewer.rawValue),
            let theirs = hierarchy.firstIndex(of: other)
        else { return false }
        return mine < theirs
    }

    static func title(_ raw: String) -> String {
        let role = Role(rawValue: raw) ?? .unknown
        return role == .unknown ? raw : role.title
    }

    /// Кого роль вправе приглашать — зеркало `ALLOWED_ISSUERS` (веб: `INVITABLE_ROLES`).
    static func invitable(by role: Role) -> [String] {
        switch role {
        case .platformAdmin: return ["PLATFORM_MODERATOR", "UNIVERSITY_ADMIN"]
        case .universityAdmin: return ["UNIVERSITY_MODERATOR", "DEAN", "TEACHER", "SECURITY_GUARD", "LIBRARIAN"]
        case .dean: return ["TEACHER", "STAROSTA", "STUDENT"]
        case .starosta: return ["STUDENT"]
        default: return []
        }
    }

    /// Роли фильтра списка людей: платформа видит и свои роли, и работодателей.
    static func filterRoles(for viewer: Role) -> [String] {
        let university = [
            "UNIVERSITY_ADMIN", "UNIVERSITY_MODERATOR", "DEAN", "TEACHER", "STAROSTA", "STUDENT",
            "SECURITY_GUARD", "LIBRARIAN",
        ]
        if viewer.isPlatform {
            return ["PLATFORM_ADMIN", "PLATFORM_MODERATOR"] + university + ["EMPLOYER"]
        }
        return university
    }
}

// MARK: - API

struct AdminAPI {
    private let client: APIClient

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    private func paged(_ request: PageRequest, _ params: [String: String?]) -> [String: String?] {
        var all = params
        all["page"] = String(request.page)
        all["limit"] = String(request.limit)
        return all
    }

    // MARK: Жалобы

    func complaints(status: String?, priority: String?, request: PageRequest) async throws -> Page<AdminComplaintDTO> {
        try await client.page(
            .get("complaints", params: paged(request, ["status": status, "priority": priority])),
            of: AdminComplaintDTO.self
        )
    }

    /// Выборка для сводки модератора: сортировка и фильтр задаются целиком.
    func complaintsSample(params: [String: String?]) async throws -> Page<AdminComplaintDTO> {
        try await client.page(.get("complaints", params: params), of: AdminComplaintDTO.self)
    }

    func complaint(id: String) async throws -> AdminComplaintDTO {
        try await client.send(.get("complaints/\(id)"), as: AdminComplaintDTO.self)
    }

    /// Окно переписки вокруг обжалованного сообщения. Каждое открытие пишется в аудит.
    func complaintMessages(id: String) async throws -> [AdminComplaintMessageDTO] {
        try await client.send(.get("complaints/\(id)/messages"), as: [AdminComplaintMessageDTO].self)
    }

    func resolveComplaint(id: String, action: String, comment: String?, applyToDuplicates: Bool, blockDays: Int?) async throws {
        var body: [String: JSONValue] = ["action": .string(action)]
        if let comment = comment?.trimmingCharacters(in: .whitespacesAndNewlines), !comment.isEmpty {
            body["comment"] = .string(String(comment.prefix(2000)))
        }
        if applyToDuplicates { body["applyToDuplicates"] = true }
        if let blockDays { body["blockDays"] = .int(blockDays) }
        try await client.send(.patch("complaints/\(id)/resolve", json: JSONBody(body)))
    }

    func takeComplaint(id: String) async throws {
        try await client.send(.patch("complaints/\(id)/take"))
    }

    func reopenComplaint(id: String) async throws {
        try await client.send(.patch("complaints/\(id)/reopen"))
    }

    func complaintFromSupport(chatID: String, targetID: String) async throws {
        try await client.send(.post("complaints/from-support", json: JSONBody(["chatId": .string(chatID), "targetId": .string(targetID)])))
    }

    // MARK: Журнал

    func audit(action: String?, userID: String? = nil, request: PageRequest) async throws -> Page<AdminAuditEntryDTO> {
        try await client.page(
            .get("audit", params: paged(request, ["action": action, "userId": userID])),
            of: AdminAuditEntryDTO.self
        )
    }

    func auditSample(params: [String: String?]) async throws -> Page<AdminAuditEntryDTO> {
        try await client.page(.get("audit", params: params), of: AdminAuditEntryDTO.self)
    }

    // MARK: Пользователи

    func users(role: String?, search: String?, blocked: Bool? = nil, request: PageRequest) async throws -> Page<AdminUserDTO> {
        try await client.page(
            .get("users", params: paged(request, [
                "role": role, "search": search, "blocked": blocked.map { $0 ? "true" : "false" },
            ])),
            of: AdminUserDTO.self
        )
    }

    /// Профиль человека как его видит смотрящий — широким JSON: состав полей зависит от роли.
    func userProfile(id: String) async throws -> JSONValue {
        try await client.send(.get("users/\(id)"), as: JSONValue.self)
    }

    func moderationCard(id: String) async throws -> AdminModerationCardDTO {
        try await client.send(.get("users/\(id)/moderation"), as: AdminModerationCardDTO.self)
    }

    func block(userID: String, days: Int?) async throws {
        var body: [String: JSONValue] = [:]
        if let days { body["blockDays"] = .int(days) }
        try await client.send(.patch("users/\(userID)/block", json: JSONBody(body)))
    }

    func unblock(userID: String) async throws {
        try await client.send(.patch("users/\(userID)/unblock"))
    }

    func endSessions(userID: String) async throws {
        try await client.send(.patch("users/\(userID)/logout"))
    }

    /// Сброс 2FA — только с кодом СВОЕЙ двухфакторной аутентификации.
    func resetTwoFactor(userID: String, code: String) async throws {
        try await client.send(.post("users/\(userID)/2fa/reset", json: JSONBody(["code": .string(code)])))
    }

    func updateAcademic(userID: String, fields: [String: JSONValue]) async throws {
        try await client.send(.patch("users/\(userID)/academic", json: JSONBody(fields)))
    }

    /// Выгрузка списка файлом — те же фильтры, что у списка.
    func exportUsers(role: String?, search: String?, format: String) async throws -> Data {
        try await client.data(.get("users/export", params: [
            "role": role, "search": search, "format": format, "locale": "ru",
        ]))
    }

    // MARK: Приглашения

    func invites(scope: String?, request: PageRequest) async throws -> Page<AdminInviteDTO> {
        try await client.page(.get("invites", params: paged(request, ["scope": scope])), of: AdminInviteDTO.self)
    }

    func createInvite(role: String, email: String?, universityID: String?, facultyID: String?, groupID: String?) async throws -> AdminCreatedInviteDTO {
        var body: [String: JSONValue] = ["role": .string(role)]
        if let email = email?.trimmingCharacters(in: .whitespaces).lowercased(), !email.isEmpty {
            body["email"] = .string(email)
        }
        if let universityID { body["universityId"] = .string(universityID) }
        if let facultyID { body["facultyId"] = .string(facultyID) }
        if let groupID { body["groupId"] = .string(groupID) }
        return try await client.send(.post("invites", json: JSONBody(body)), as: AdminCreatedInviteDTO.self)
    }

    func revokeInvite(id: String) async throws {
        try await client.send(.patch("invites/\(id)/revoke"))
    }

    func bulkInvitePreview(file: Data, filename: String) async throws -> AdminBulkPreviewDTO {
        var form = MultipartForm()
        let mime = filename.lowercased().hasSuffix(".csv")
            ? "text/csv"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        form.append(file, name: "file", filename: filename, mime: mime)
        return try await client.send(.multipart("invites/bulk/preview", form: form), as: AdminBulkPreviewDTO.self)
    }

    func bulkInviteCreate(rows: [AdminBulkPreviewDTO.Row]) async throws -> AdminBulkResultDTO {
        let items: [JSONValue] = rows.map { row in
            var item: [String: JSONValue] = ["email": .string(row.email), "role": .string(row.role)]
            if let group = row.groupId { item["groupId"] = .string(group) }
            if let faculty = row.facultyId { item["facultyId"] = .string(faculty) }
            return .object(item)
        }
        return try await client.send(.post("invites/bulk", json: JSONBody(["rows": .array(items)])), as: AdminBulkResultDTO.self)
    }

    func faculties(universityID: String? = nil) async throws -> [AdminNamedRefDTO] {
        try await client.send(
            .get("faculties", params: ["page": "1", "limit": "100", "universityId": universityID]),
            as: [AdminNamedRefDTO].self
        )
    }

    func groups(search: String?) async throws -> [AdminGroupDTO] {
        try await client.page(
            .get("groups", params: ["page": "1", "limit": "30", "search": search]),
            of: AdminGroupDTO.self
        ).items
    }

    // MARK: Вузы

    func universities(search: String?, status: String? = nil, request: PageRequest) async throws -> Page<AdminUniversityDTO> {
        try await client.page(
            .get("universities", params: paged(request, ["search": search, "status": status])),
            of: AdminUniversityDTO.self
        )
    }

    func university(id: String) async throws -> AdminUniversityDTO {
        try await client.send(.get("universities/\(id)"), as: AdminUniversityDTO.self)
    }

    func universityStats(id: String) async throws -> AdminUniversityStatsDTO {
        try await client.send(.get("universities/\(id)/stats"), as: AdminUniversityStatsDTO.self)
    }

    func createUniversity(_ fields: [String: JSONValue]) async throws -> AdminUniversityDTO {
        try await client.send(.post("universities", json: JSONBody(fields)), as: AdminUniversityDTO.self)
    }

    func updateUniversity(id: String, fields: [String: JSONValue]) async throws {
        try await client.send(.patch("universities/\(id)", json: JSONBody(fields)))
    }

    func setUniversityStatus(id: String, status: String) async throws {
        try await client.send(.patch("universities/\(id)/status", json: JSONBody(["status": .string(status)])))
    }

    func deleteUniversity(id: String) async throws {
        try await client.send(.delete("universities/\(id)"))
    }

    func katoSearch(_ search: String) async throws -> [AdminKatoUnitDTO] {
        try await client.send(
            .get("kato", params: ["scope": "places", "limit": "20", "search": search]),
            as: [AdminKatoUnitDTO].self
        )
    }

    func katoResolve(_ codes: [String]) async throws -> [AdminKatoUnitDTO] {
        let valid = Array(Set(codes.filter { $0.count == 9 && $0.allSatisfy(\.isNumber) })).prefix(100)
        guard !valid.isEmpty else { return [] }
        return try await client.send(
            .get("kato/resolve", params: ["codes": valid.joined(separator: ",")]),
            as: [AdminKatoUnitDTO].self
        )
    }

    // MARK: Заявки на демо

    func demoRequests(status: String?, search: String?, request: PageRequest) async throws -> Page<AdminDemoRequestDTO> {
        try await client.page(
            .get("demo-requests", params: paged(request, ["status": status, "search": search])),
            of: AdminDemoRequestDTO.self
        )
    }

    func demoRequest(id: String) async throws -> AdminDemoRequestDTO {
        try await client.send(.get("demo-requests/\(id)"), as: AdminDemoRequestDTO.self)
    }

    func approveDemoRequest(id: String, fields: [String: JSONValue]) async throws {
        try await client.send(.post("demo-requests/\(id)/approve", json: JSONBody(fields)))
    }

    func rejectDemoRequest(id: String, reason: String, note: String?) async throws {
        var body: [String: JSONValue] = ["reason": .string(reason)]
        if let note = note?.trimmingCharacters(in: .whitespacesAndNewlines), !note.isEmpty {
            body["note"] = .string(String(note.prefix(1000)))
        }
        try await client.send(.post("demo-requests/\(id)/reject", json: JSONBody(body)))
    }

    /// Новое приглашение администратору вуза: прежнее отзывается, ссылка приходит один раз.
    func reissueDemoInvite(id: String) async throws -> String {
        struct Response: Decodable { let inviteUrl: String }
        return try await client.send(.post("demo-requests/\(id)/reissue-invite"), as: Response.self).inviteUrl
    }

    // MARK: Поддержка

    func supportQueue(status: String, assignee: String, search: String?, tag: String?, request: PageRequest) async throws -> Page<AdminSupportTicketDTO> {
        try await client.page(
            .get("support", params: [
                "status": status, "assignee": assignee, "search": search, "tag": tag,
                "page": String(request.page), "limit": String(min(request.limit, 50)),
            ]),
            of: AdminSupportTicketDTO.self
        )
    }

    func supportTagCounts() async throws -> [AdminSupportTagCountDTO] {
        try await client.send(.get("support/tags"), as: [AdminSupportTagCountDTO].self)
    }

    func supportThread(id: String) async throws -> AdminSupportThreadDTO {
        try await client.send(.get("support/\(id)"), as: AdminSupportThreadDTO.self)
    }

    /// Более ранние сообщения обращения — обычной историей чата.
    func supportEarlier(id: String, cursor: String) async throws -> Page<AdminSupportMessageDTO> {
        try await client.page(
            .get("chats/\(id)/messages", params: ["cursor": cursor, "limit": "50"]),
            of: AdminSupportMessageDTO.self
        )
    }

    func supportReply(id: String, text: String) async throws {
        try await client.send(.post("support/\(id)/reply", json: JSONBody(["text": .string(text)])))
    }

    func supportAssign(id: String, take: Bool) async throws {
        var endpoint = try Endpoint.patch("support/\(id)/assign", json: JSONBody([:]))
        endpoint.query = [URLQueryItem(name: "take", value: take ? "true" : "false")]
        try await client.send(endpoint)
    }

    func supportSetTags(id: String, tags: [String]) async throws {
        try await client.send(.patch("support/\(id)/tags", json: JSONBody(["tags": .strings(tags)])))
    }

    func supportMerge(id: String, into: String) async throws {
        try await client.send(.post("support/\(id)/merge", json: JSONBody(["intoId": .string(into)])))
    }

    func supportEscalate(id: String) async throws {
        try await client.send(.post("support/\(id)/escalate", json: JSONBody([:])))
    }

    func supportClose(id: String) async throws {
        try await client.send(.patch("support/\(id)/close", json: JSONBody([:])))
    }

    // MARK: Аналитика платформы

    func platformOverview() async throws -> AdminPlatformOverviewDTO {
        try await client.send(.get("analytics/platform/overview"), as: AdminPlatformOverviewDTO.self)
    }

    /// Ряды по корзинам: `users-growth`, `active-users`, `complaints-flow`.
    func platformSeries(_ path: String, range: AdminPlatformRange) async throws -> AdminSeriesDTO {
        try await client.send(.get("analytics/platform/\(path)", params: range.params), as: AdminSeriesDTO.self)
    }

    func universitiesSize() async throws -> AdminUniversitiesSizeDTO {
        try await client.send(.get("analytics/platform/universities-size"), as: AdminUniversitiesSizeDTO.self)
    }

    func complaintsLatency(range: AdminPlatformRange) async throws -> AdminLatencyDTO {
        try await client.send(.get("analytics/platform/complaints-latency", params: range.params), as: AdminLatencyDTO.self)
    }

    func invitesFunnel(range: AdminPlatformRange) async throws -> AdminInvitesFunnelDTO {
        try await client.send(.get("analytics/platform/invites-funnel", params: range.params), as: AdminInvitesFunnelDTO.self)
    }

    func activityHeatmap(range: AdminPlatformRange) async throws -> AdminHeatmapDTO {
        var params = range.params
        params["tz"] = TimeZone.current.identifier
        return try await client.send(.get("analytics/platform/activity-heatmap", params: params), as: AdminHeatmapDTO.self)
    }

    func topActions(range: AdminPlatformRange) async throws -> AdminTopActionsDTO {
        var params = range.params
        params["limit"] = "10"
        return try await client.send(.get("analytics/platform/top-actions", params: params), as: AdminTopActionsDTO.self)
    }

    // MARK: Спец-доступ к документам

    func platformDocument(id: String, reason: String) async throws -> AdminPlatformDocumentDTO {
        try await client.send(
            .post("documents/\(id)/platform", json: JSONBody(["reason": .string(reason)])),
            as: AdminPlatformDocumentDTO.self
        )
    }

    /// Ссылки на файлы пачкой: одно обращение — одна строка в журнале спец-доступа.
    func platformDocumentURLs(id: String, fileIDs: [String], reason: String) async throws -> [String: String] {
        struct Response: Decodable { let urls: [String: String] }
        return try await client.send(
            .post("documents/\(id)/platform-access", json: JSONBody([
                "fileIds": .strings(fileIDs), "reason": .string(reason),
            ])),
            as: Response.self
        ).urls
    }

    // MARK: Модерация публикаций

    /// Всё, что роль вправе снимать: платформа — все вузы, вуз — свой (`filter=MODERATION`).
    func moderationPosts(request: PageRequest) async throws -> Page<PostDTO> {
        var params: [String: String?] = ["filter": "MODERATION", "limit": String(request.limit)]
        params["cursor"] = request.cursor
        return try await client.page(.get("posts", params: params), of: PostDTO.self)
    }

    func deletePost(id: String) async throws {
        try await client.send(.delete("posts/\(id)"))
    }

    func pinPost(id: String, pinned: Bool) async throws {
        try await client.send(.patch("posts/\(id)/pin", json: JSONBody(["pinned": .bool(pinned)])))
    }
}
