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
    /// Изменения с дня `from` по день `to` включительно — календарные дни в поясе
    /// `timeZone` (пояс вуза, §3.1).
    func changes(from: Date, to: Date, timeZone: TimeZone) async throws -> [ScheduleChangeDTO]
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

    /// Период — датами `YYYY-MM-DD`, как требует `ScheduleChangeQuerySchema`. Метка
    /// времени (`…T00:00:00.000Z`) получала `422` на каждом обновлении, и разовые
    /// изменения на телефоне не показывались вовсе.
    func changes(from: Date, to: Date, timeZone: TimeZone) async throws -> [ScheduleChangeDTO] {
        try await client.send(
            .get(
                "schedule/changes",
                query: [
                    URLQueryItem(name: "from", value: Self.day(from, in: timeZone)),
                    URLQueryItem(name: "to", value: Self.day(to, in: timeZone)),
                ]
            ),
            as: [ScheduleChangeDTO].self
        )
    }

    /// Календарная дата момента в поясе вуза.
    static func day(_ date: Date, in timeZone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}
