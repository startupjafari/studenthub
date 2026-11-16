import Foundation

// Сервисы вуза из вкладки «Сервисы»: консультации преподавателей, запись в деканат,
// портфолио. Контракты — `apps/api/src/modules/{consultations,appointments,portfolio}`.

struct PersonRefDTO: Decodable, Equatable {
    let id: String
    let firstName: String?
    let lastName: String?
    var avatarUrl: String? = nil

    var name: String {
        [lastName, firstName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
    }
}

/// Окно консультации. `OPEN` — свободно, `BOOKED` — занято (студентом в `student`).
struct ConsultationSlotDTO: Decodable, Equatable, Identifiable {
    let id: String
    let startsAt: Date
    let endsAt: Date
    let location: String?
    let isOnline: Bool?
    let status: String
    let topic: String?
    let teacher: PersonRefDTO?
    let student: PersonRefDTO?
}

struct ConsultationTeacherDTO: Decodable, Equatable, Identifiable {
    let teacherId: String
    let firstName: String?
    let lastName: String?
    let avatarUrl: String?
    let openSlots: Int

    var id: String { teacherId }
    var name: String {
        [lastName, firstName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
    }
}

/// Запись в деканат.
struct DeaneryAppointmentDTO: Decodable, Equatable, Identifiable {
    let id: String
    let type: String
    let status: String
    let topic: String?
    let requestedAt: Date
    let scheduledAt: Date?
    let staffNote: String?
    let createdAt: Date
    let assignedTo: PersonRefDTO?

    /// Отменить можно, пока приём не состоялся и не отменён.
    var isCancellable: Bool { ["REQUESTED", "CONFIRMED", "RESCHEDULED"].contains(status) }
}

struct PortfolioItemDTO: Decodable, Equatable, Identifiable {
    let id: String
    let kind: String
    let title: String
    let organization: String?
    let description: String?
    let url: String?
    let startDate: Date?
    let endDate: Date?
    let visibility: String?
}

struct NewPortfolioItem: Encodable, Equatable {
    var kind: String
    var title: String
    var organization: String?
    var description: String?
    var url: String?
    var startDate: Date?
    var endDate: Date?
    var visibility: String?
}

protocol UniversityServicesFetching: Sendable {
    func myConsultations() async throws -> [ConsultationSlotDTO]
    func consultationTeachers() async throws -> [ConsultationTeacherDTO]
    func slots(teacherID: String) async throws -> [ConsultationSlotDTO]
    func book(slotID: String, topic: String?) async throws
    func cancel(slotID: String) async throws
    func createSlot(startsAt: Date, endsAt: Date, location: String?, isOnline: Bool) async throws
    func deleteSlot(id: String) async throws

    func myAppointments() async throws -> [DeaneryAppointmentDTO]
    func requestAppointment(type: String, at date: Date, topic: String?) async throws
    func cancelAppointment(id: String) async throws

    func portfolio() async throws -> [PortfolioItemDTO]
    func addPortfolioItem(_ item: NewPortfolioItem) async throws
    func deletePortfolioItem(id: String) async throws
}

struct UniversityServicesAPI: UniversityServicesFetching {
    private let client: APIClient

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    // MARK: Консультации

    /// Свои записи (студент) или свои окна (преподаватель) — с сегодняшнего дня:
    /// без `from` первая страница — самые старые слоты.
    func myConsultations() async throws -> [ConsultationSlotDTO] {
        let from = Calendar.current.startOfDay(for: Date())
        return try await client.page(
            .get(
                "consultations/mine",
                query: [
                    URLQueryItem(name: "limit", value: "100"),
                    URLQueryItem(name: "from", value: JSONCoding.isoString(from)),
                ]
            ),
            of: ConsultationSlotDTO.self
        ).items
    }

    /// Все свои записи или окна, включая прошедшие, — режим «Все» в вебе.
    func allConsultations() async throws -> [ConsultationSlotDTO] {
        try await client.page(
            .get("consultations/mine", query: [URLQueryItem(name: "limit", value: "100")]),
            of: ConsultationSlotDTO.self
        ).items
        .sorted { $0.startsAt > $1.startsAt }
    }

    func consultationTeachers() async throws -> [ConsultationTeacherDTO] {
        try await client.send(.get("consultations/teachers"), as: [ConsultationTeacherDTO].self)
    }

    func slots(teacherID: String) async throws -> [ConsultationSlotDTO] {
        try await client.send(
            .get("consultations/slots", query: [URLQueryItem(name: "teacherId", value: teacherID)]),
            as: [ConsultationSlotDTO].self
        )
    }

    func book(slotID: String, topic: String?) async throws {
        struct Body: Encodable { let topic: String? }
        try await client.send(.post("consultations/slots/\(slotID)/book", json: Body(topic: topic)))
    }

    func cancel(slotID: String) async throws {
        try await client.send(.post("consultations/slots/\(slotID)/cancel"))
    }

    func createSlot(startsAt: Date, endsAt: Date, location: String?, isOnline: Bool) async throws {
        struct Body: Encodable {
            let startsAt: Date
            let endsAt: Date
            let location: String?
            let isOnline: Bool
        }
        try await client.send(
            .post("consultations/slots", json: Body(startsAt: startsAt, endsAt: endsAt, location: location, isOnline: isOnline))
        )
    }

    func deleteSlot(id: String) async throws {
        try await client.send(Endpoint(method: .delete, path: "consultations/slots/\(id)"))
    }

    // MARK: Деканат

    func myAppointments() async throws -> [DeaneryAppointmentDTO] {
        try await client.send(.get("deanery-appointments/mine"), as: [DeaneryAppointmentDTO].self)
    }

    func requestAppointment(type: String, at date: Date, topic: String?) async throws {
        struct Body: Encodable {
            let type: String
            let requestedAt: Date
            let topic: String?
        }
        try await client.send(.post("deanery-appointments", json: Body(type: type, requestedAt: date, topic: topic)))
    }

    func cancelAppointment(id: String) async throws {
        try await client.send(.post("deanery-appointments/\(id)/cancel"))
    }

    // MARK: Портфолио

    func portfolio() async throws -> [PortfolioItemDTO] {
        try await client.send(.get("portfolio/mine"), as: [PortfolioItemDTO].self)
    }

    func addPortfolioItem(_ item: NewPortfolioItem) async throws {
        try await client.send(.post("portfolio", json: item))
    }

    func deletePortfolioItem(id: String) async throws {
        try await client.send(Endpoint(method: .delete, path: "portfolio/\(id)"))
    }
}

// MARK: - Портфолио: правка и порядок

extension UniversityServicesAPI {
    /// Частичная правка записи: `null` очищает поле (`UpdatePortfolioItemSchema`).
    func updatePortfolioItem(id: String, fields: [String: JSONValue]) async throws -> PortfolioItemDTO {
        try await AppServices.api.send(try .patch("portfolio/\(id)", json: JSONBody(fields)), as: PortfolioItemDTO.self)
    }

    /// Новый порядок записей; не перечисленные встают после. Ответ — весь список.
    func reorderPortfolio(ids: [String]) async throws -> [PortfolioItemDTO] {
        try await AppServices.api.send(try .put("portfolio/order", json: ["ids": ids]), as: [PortfolioItemDTO].self)
    }
}
