import Foundation

// Разделы старосты: прогресс группы по запросам документов и приглашения
// одногруппников. Контракты — `apps/api/src/modules/documents/document-requests.controller.ts`
// (`group-progress`) и `apps/api/src/modules/invites`; тела — `packages/shared-schemas/src/invites.ts`.

/// Прогресс группы по одному запросу документов. Поимённо — только учебные запросы;
/// по запросам с личными документами сервер отдаёт лишь счётчики (`members == nil`).
struct StarostaGroupProgressDTO: Decodable, Identifiable, Equatable {
    struct Counts: Decodable, Equatable {
        let total: Int
        let notSubmitted: Int
        let submitted: Int
        /// `nil` — по личным документам этот счётчик не раскрывается.
        let needsFix: Int?
        let accepted: Int
    }

    struct Member: Decodable, Identifiable, Equatable {
        let id: String
        let name: String
        let status: String
    }

    let id: String
    let title: String
    let dueAt: Date?
    let acceptsSubmissions: Bool
    let kind: String
    let counts: Counts
    let members: [Member]?

    var acceptedShare: Double {
        counts.total > 0 ? Double(counts.accepted) / Double(counts.total) : 0
    }
}

struct StarostaInviteDTO: Decodable, Identifiable, Equatable {
    let id: String
    let role: String
    let email: String?
    let status: String
    let groupId: String?
    let expiresAt: Date
    let createdAt: Date
}

/// Ответ создания: одноразовый `token` приходит только здесь — в списке его нет.
struct StarostaCreatedInviteDTO: Decodable, Identifiable, Equatable {
    let id: String
    let token: String
    let role: String
    let expiresAt: Date
}

struct StarostaBulkPreviewDTO: Decodable, Equatable {
    struct Row: Decodable, Identifiable, Equatable {
        let line: Int
        let email: String
        let groupName: String
        let role: String
        let groupId: String?
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

struct StarostaBulkResultDTO: Decodable, Equatable {
    let created: Int
    let skipped: Int
    let failed: Int
}

struct StarostaAPI {
    private let client: APIClient

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    func groupProgress() async throws -> [StarostaGroupProgressDTO] {
        try await client.send(.get("document-requests/group-progress"), as: [StarostaGroupProgressDTO].self)
    }

    func invites(_ request: PageRequest) async throws -> Page<StarostaInviteDTO> {
        try await client.page(.get("invites", query: request.pageQuery), of: StarostaInviteDTO.self)
    }

    /// Староста приглашает только студентов в свою группу — сервер проверяет то же.
    func createInvite(email: String?, groupID: String) async throws -> StarostaCreatedInviteDTO {
        var fields: [String: JSONValue] = ["role": "STUDENT", "groupId": .string(groupID)]
        if let email { fields["email"] = .string(email) }
        return try await client.send(.post("invites", json: JSONBody(fields)), as: StarostaCreatedInviteDTO.self)
    }

    func revokeInvite(id: String) async throws {
        try await client.send(.patch("invites/\(id)/revoke"))
    }

    /// Проверка файла импорта (CSV/XLSX) без записи.
    func bulkPreview(data: Data, filename: String, mime: String) async throws -> StarostaBulkPreviewDTO {
        var form = MultipartForm()
        form.append(data, name: "file", filename: filename, mime: mime)
        return try await client.send(.multipart("invites/bulk/preview", form: form), as: StarostaBulkPreviewDTO.self)
    }

    func bulkCreate(rows: [StarostaBulkPreviewDTO.Row]) async throws -> StarostaBulkResultDTO {
        let body = JSONBody([
            "rows": .array(rows.map { row in
                var fields: [String: JSONValue] = ["email": .string(row.email), "role": .string(row.role)]
                if let groupId = row.groupId { fields["groupId"] = .string(groupId) }
                if let facultyId = row.facultyId { fields["facultyId"] = .string(facultyId) }
                return .object(fields)
            }),
        ])
        return try await client.send(.post("invites/bulk", json: body), as: StarostaBulkResultDTO.self)
    }
}
