import Foundation

// Заявки и документы (PROJECT.md §3.2, §8.3).

struct ServiceCategoryDTO: Decodable, Equatable, Identifiable {
    let id: String
    let code: String?
    let name: String
    let services: [ServiceDTO]
}

struct ServiceDTO: Decodable, Equatable, Identifiable {
    let id: String
    let name: String
    let description: String?
    /// Сколько рабочих дней обещает вуз.
    let processingDays: Int?
    let deliveryType: String?
    let formFields: [FormFieldDTO]?
}

/// Поле формы услуги. Состав полей задаёт вуз, поэтому экран строится по ответу,
/// а не по захардкоженной форме: иначе каждая новая услуга требовала бы релиза.
struct FormFieldDTO: Decodable, Equatable, Identifiable {
    let key: String
    let label: String
    let type: String
    let required: Bool?
    let options: [String]?

    var id: String { key }
}

struct ApplicationDTO: Decodable, Equatable, Identifiable {
    struct Event: Decodable, Equatable, Identifiable {
        let id: String
        let status: String
        let comment: String?
        let createdAt: Date
    }

    let id: String
    let status: String
    let serviceName: String?
    let createdAt: Date
    let updatedAt: Date?
    let formData: [String: String]?
    let history: [Event]?
    let documentId: String?
}

struct DocumentDTO: Decodable, Equatable, Identifiable {
    struct File: Decodable, Equatable, Identifiable {
        let id: String
        let name: String?
        let mime: String?
        let size: Int?
    }

    let id: String
    let title: String?
    let typeName: String?
    let createdAt: Date?
    let files: [File]?
}

protocol ApplicationsFetching: Sendable {
    func categories() async throws -> [ServiceCategoryDTO]
    func service(id: String) async throws -> ServiceDTO
    func applications() async throws -> Page<ApplicationDTO>
    func application(id: String) async throws -> ApplicationDTO
    func createDraft(serviceID: String) async throws -> ApplicationDTO
    func updateDraft(id: String, formData: [String: String]) async throws
    func submit(id: String) async throws
    func cancel(id: String, reason: String?) async throws
    func documents() async throws -> Page<DocumentDTO>
    func fileURL(documentID: String, fileID: String) async throws -> URL
}

struct ApplicationsAPI: ApplicationsFetching {
    private let client: APIClient

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    func categories() async throws -> [ServiceCategoryDTO] {
        try await client.send(.get("application-categories"), as: [ServiceCategoryDTO].self)
    }

    func service(id: String) async throws -> ServiceDTO {
        try await client.send(.get("application-services/\(id)"), as: ServiceDTO.self)
    }

    func applications() async throws -> Page<ApplicationDTO> {
        try await client.page(
            .get("applications", query: [URLQueryItem(name: "limit", value: "50")]),
            of: ApplicationDTO.self
        )
    }

    func application(id: String) async throws -> ApplicationDTO {
        try await client.send(.get("applications/\(id)"), as: ApplicationDTO.self)
    }

    /// Заявка заводится черновиком, заполняется и только потом подаётся — так на
    /// сервере, и это правильно: человек может уйти с экрана и вернуться.
    func createDraft(serviceID: String) async throws -> ApplicationDTO {
        try await client.send(
            try .post("applications", json: ["serviceId": serviceID]),
            as: ApplicationDTO.self
        )
    }

    func updateDraft(id: String, formData: [String: String]) async throws {
        struct Body: Encodable {
            let formData: [String: String]
        }
        try await client.send(
            Endpoint(
                method: .patch,
                path: "applications/\(id)",
                body: try JSONCoding.encoder.encode(Body(formData: formData))
            )
        )
    }

    func submit(id: String) async throws {
        try await client.send(.post("applications/\(id)/submit"))
    }

    func cancel(id: String, reason: String?) async throws {
        try await client.send(try .post("applications/\(id)/cancel", json: ["reason": reason ?? ""]))
    }

    func documents() async throws -> Page<DocumentDTO> {
        try await client.page(
            .get("documents", query: [URLQueryItem(name: "limit", value: "50")]),
            of: DocumentDTO.self
        )
    }

    /// Ссылка на файл подписанная и короткоживущая: её запрашивают в момент
    /// открытия, а не хранят.
    func fileURL(documentID: String, fileID: String) async throws -> URL {
        struct Answer: Decodable {
            let url: URL
        }
        return try await client.send(
            .get(
                "documents/\(documentID)/files/\(fileID)/url",
                query: [URLQueryItem(name: "download", value: "1")]
            ),
            as: Answer.self
        ).url
    }
}

/// Статусы заявки на языке человека.
enum ApplicationStatus {
    static func title(_ status: String) -> String {
        switch status {
        case "DRAFT": return String(localized: "applications.draft", defaultValue: "Черновик")
        case "SUBMITTED": return String(localized: "applications.submitted", defaultValue: "Подана")
        case "IN_REVIEW": return String(localized: "applications.inReview", defaultValue: "На рассмотрении")
        case "NEEDS_INFO": return String(localized: "applications.needsInfo", defaultValue: "Нужны документы")
        case "APPROVED": return String(localized: "applications.approved", defaultValue: "Одобрена")
        case "READY": return String(localized: "applications.ready", defaultValue: "Готова")
        case "ISSUED": return String(localized: "applications.issued", defaultValue: "Выдана")
        case "REJECTED": return String(localized: "applications.rejected", defaultValue: "Отклонена")
        case "CANCELLED": return String(localized: "applications.cancelled", defaultValue: "Отменена")
        default: return status
        }
    }

    /// Заявка ещё в работе — её нельзя подавать второй раз, и это видно по цвету.
    static func isOpen(_ status: String) -> Bool {
        !["ISSUED", "REJECTED", "CANCELLED"].contains(status)
    }
}
