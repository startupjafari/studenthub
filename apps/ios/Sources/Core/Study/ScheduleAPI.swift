import Foundation

/// Пара расписания (ответ `GET /schedule`).
struct PairDTO: Codable, Equatable {
    struct Person: Codable, Equatable {
        let id: String
        let firstName: String?
        let lastName: String?
    }

    struct Room: Codable, Equatable {
        let id: String
        let name: String
    }

    let id: String
    let scheduleId: String?
    let groupId: String?
    let subject: String
    /// 1 — понедельник, 7 — воскресенье.
    let dayOfWeek: Int
    /// «HH:mm» строкой: сравнима лексикографически и не зависит от часового пояса
    /// устройства, в отличие от даты.
    let startTime: String
    let endTime: String
    /// `ODD`, `EVEN` или `BOTH`.
    let weekType: String
    let teacher: Person?
    let room: Room?
}

struct ScheduleDTO: Decodable, Equatable {
    let timezone: String?
    let pairs: [PairDTO]
}

/// Разовое изменение: перенос, смена аудитории, отмена, замена.
struct ScheduleChangeDTO: Decodable, Equatable {
    let id: String
    let pairId: String
    let type: String
    let date: Date
    let newStartTime: String?
    let newEndTime: String?
    let note: String?
}

protocol ScheduleFetching: Sendable {
    func schedule() async throws -> ScheduleDTO
    func changes(from: Date, to: Date) async throws -> [ScheduleChangeDTO]
}

/// Маршруты расписания. Scope подставляет сервер по роли: студент видит свою
/// группу, преподаватель — свои пары, и просить об этом не нужно.
struct ScheduleAPI: ScheduleFetching {
    private let client: APIClient

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    func schedule() async throws -> ScheduleDTO {
        try await client.send(.get("schedule"), as: ScheduleDTO.self)
    }

    func changes(from: Date, to: Date) async throws -> [ScheduleChangeDTO] {
        let formatter = ISO8601DateFormatter.contract
        return try await client.send(
            .get(
                "schedule/changes",
                query: [
                    URLQueryItem(name: "from", value: formatter.string(from: from)),
                    URLQueryItem(name: "to", value: formatter.string(from: to)),
                ]
            ),
            as: [ScheduleChangeDTO].self
        )
    }
}
