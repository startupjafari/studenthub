import Foundation

// Пост охраны (PROJECT.md §3.10, §3.12): журналы проходов и посетителей, камеры вуза,
// справочник помещений и проверка студенческого. Контракты — `packages/shared-schemas/src/
// {security,cameras,rooms,student-id}.ts` и контроллеры `security-journal`, `cameras`,
// `rooms`, `student-id`. Поля, которых может не быть, — необязательные: охрана открывает
// экран на входе, и новое поле на сервере не должно ронять его разбор.

// MARK: - Журналы поста

/// Сводка поста за день по часам вуза (`GET /security/summary`).
struct SecuritySummaryDTO: Decodable, Equatable {
    struct Passes: Decodable, Equatable {
        var total: Int = 0
        var allowed: Int = 0
        var denied: Int = 0
    }

    struct Visitors: Decodable, Equatable {
        var today: Int = 0
        var inside: Int = 0
    }

    let date: String?
    let passes: Passes
    let visitors: Visitors
}

/// Проход студента: каждая проверка студенческого охраной.
struct SecurityPassDTO: Decodable, Equatable, Identifiable {
    struct Student: Decodable, Equatable {
        let id: String?
        let name: String
        let group: String?
    }

    let id: String
    let createdAt: Date
    let allowed: Bool
    /// `STATUS`, `BLOCKED`, `OTHER_UNIVERSITY`, `INVALID_QR`, `EXPIRED_QR`, `REUSED_QR`.
    let denyReason: String?
    /// Пусто, если код недействителен или студент чужого вуза.
    let student: Student?
    let guardName: String?
}

/// Посетитель на входе. Документ — только тип и четыре последние цифры.
struct SecurityVisitorDTO: Decodable, Equatable, Identifiable {
    let id: String
    let fullName: String
    let purpose: String
    let documentType: String?
    let documentLast4: String?
    let phone: String?
    let enteredAt: Date
    let exitedAt: Date?
    let createdByName: String?
}

/// Новый посетитель. Пустые необязательные поля не отправляются: схема строгая.
struct SecurityNewVisitor: Encodable {
    var fullName: String
    var purpose: String
    var documentType: String?
    var documentLast4: String?
    var phone: String?
}

// MARK: - Камеры

/// Камера глазами охраны: без адреса потока и агента.
struct SecurityCameraDTO: Decodable, Equatable, Identifiable, Hashable {
    struct Room: Decodable, Equatable, Hashable {
        let id: String
        let name: String
    }

    let id: String
    let name: String
    let room: Room?
    let enabled: Bool
    /// `UNKNOWN`, `ONLINE`, `OFFLINE`, `AUTH_FAILED`.
    let status: String
    let lastSeenAt: Date?
}

struct SecurityCameraSettingsDTO: Decodable, Equatable {
    let enabled: Bool
}

/// Пропуск на просмотр: адрес LL-HLS ретранслятора и токен к нему. Токен живёт
/// `expiresInSec`, продлевать — каждые `heartbeatInSec`.
struct SecurityCameraTicketDTO: Decodable, Equatable {
    let sessionId: String
    let cameraId: String?
    let hlsUrl: String
    let token: String
    let expiresInSec: Int
    let heartbeatInSec: Int
}

/// ФИО смотрящего — для водяного знака поверх видео.
struct SecurityViewerDTO: Decodable, Equatable {
    let firstName: String?
    let lastName: String?

    var name: String { DisplayFormat.name(first: firstName, last: lastName) }
}

// MARK: - Помещения

/// Помещение из справочника вуза (`GET /rooms`).
struct SecurityRoomDTO: Decodable, Equatable, Identifiable {
    let id: String
    let name: String
    let capacity: Int?
    let kind: String
    let building: String?
    let floor: Int?
    let openHours: String?
    let phone: String?
    let info: String?
    /// Выдан ли печатный QR: по коду открывается страница «что сейчас идёт».
    let qrCode: String?
}

/// Преподаватель и аудитория пары — снимок в расписании.
struct SecurityPairTeacherDTO: Decodable, Equatable {
    let id: String?
    let firstName: String?
    let lastName: String?

    var name: String { DisplayFormat.name(first: firstName, last: lastName) }
}

struct SecurityPairRoomDTO: Decodable, Equatable {
    let id: String
    let name: String?
}

/// Пара в помещении: как в расписании, но с именем группы.
struct SecurityRoomPairDTO: Decodable, Equatable, Identifiable {
    struct Group: Decodable, Equatable {
        let id: String
        let name: String
    }

    let id: String
    let subject: String
    let dayOfWeek: Int
    let startTime: String
    let endTime: String
    /// `ODD`, `EVEN`, `BOTH`.
    let weekType: String
    let teacher: SecurityPairTeacherDTO?
    let room: SecurityPairRoomDTO?
    let group: Group?
}

/// Изменение пары на дату: перенос, замена аудитории, отмена, замена преподавателя.
struct SecurityRoomChangeDTO: Decodable, Equatable, Identifiable {
    struct Pair: Decodable, Equatable {
        let subject: String?
        let startTime: String?
        let endTime: String?
        let room: SecurityPairRoomDTO?
    }

    let id: String
    let pairId: String
    /// `MOVED`, `ROOM_CHANGED`, `CANCELLED`, `SUBSTITUTED`.
    let type: String
    let date: String
    let newStartTime: String?
    let newEndTime: String?
    let note: String?
    let newRoom: SecurityPairRoomDTO?
    let newTeacher: SecurityPairTeacherDTO?
    let pair: Pair?
}

/// Помещение по коду с наклейки (`GET /rooms/qr/:code`) — «свободно или занято».
struct SecurityRoomStatusDTO: Decodable, Equatable {
    struct Room: Decodable, Equatable {
        let id: String
        let name: String
        let kind: String
        let building: String?
        let floor: Int?
        let capacity: Int?
        let openHours: String?
        let phone: String?
        let info: String?
        let university: String?
        let universityShort: String?
    }

    /// «Сейчас» по часам сервера в поясе вуза: часы телефона могут врать.
    struct Now: Decodable, Equatable {
        let date: String
        let time: String
        let dayOfWeek: Int
    }

    let room: Room
    /// Учебное помещение (есть расписание пар) или нет.
    let academic: Bool
    let timezone: String?
    let now: Now
    let pairs: [SecurityRoomPairDTO]
    let changes: [SecurityRoomChangeDTO]

    private enum CodingKeys: String, CodingKey {
        case room, academic, timezone, now, pairs, changes
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        room = try container.decode(Room.self, forKey: .room)
        academic = try container.decodeIfPresent(Bool.self, forKey: .academic) ?? false
        timezone = try container.decodeIfPresent(String.self, forKey: .timezone)
        now = try container.decode(Now.self, forKey: .now)
        pairs = try container.decodeIfPresent([SecurityRoomPairDTO].self, forKey: .pairs) ?? []
        changes = try container.decodeIfPresent([SecurityRoomChangeDTO].self, forKey: .changes) ?? []
    }
}

// MARK: - Студенческий

/// Результат проверки студенческого (`GET /student-id/verify`). Охране сервер добавляет
/// решение о проходе: карта бывает настоящей, а пропускать по ней нельзя.
struct SecurityVerifiedCardDTO: Decodable, Equatable {
    struct Entry: Decodable, Equatable {
        let allowed: Bool
        let denyReason: String?
    }

    let id: String
    let firstName: String
    let lastName: String
    let middleName: String?
    let avatarUrl: String?
    let studentCardNumber: String?
    let academicStatus: String?
    let educationLevel: String?
    let studyForm: String?
    let specialty: String?
    let fundingType: String?
    let dormitory: String?
    /// Дата строкой: формат выбирает клиент.
    let birthDate: String?
    let course: Int?
    let enrollmentYear: Int?
    let graduationYear: Int?
    let group: String?
    let faculty: String?
    let university: String?
    let universityShort: String?
    let valid: Bool?
    let verifiedAt: Date?
    /// Поля, заполненные студентом самим (сейчас — дата рождения).
    let selfDeclared: [String]?
    let entry: Entry?

    var fullName: String { DisplayFormat.name(first: firstName, last: lastName, middle: middleName) }
}

// MARK: - Клиент

struct SecurityAPI {
    private let client: APIClient

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    // MARK: Журналы

    func summary() async throws -> SecuritySummaryDTO {
        try await client.send(.get("security/summary"), as: SecuritySummaryDTO.self)
    }

    /// `allowed`: `nil` — все, `true` — пропущенные, `false` — отказы. `date` — «ГГГГ-ММ-ДД».
    func passes(_ request: PageRequest, date: String? = nil, allowed: Bool? = nil, query: String? = nil) async throws -> Page<SecurityPassDTO> {
        try await client.page(
            .get("security/passes", params: [
                "page": String(request.page),
                "limit": String(request.limit),
                "date": date,
                "allowed": allowed.map { $0 ? "true" : "false" },
                "q": query,
            ]),
            of: SecurityPassDTO.self
        )
    }

    /// `status`: `inside` — кто ещё в здании, `all` — весь журнал.
    func visitors(_ request: PageRequest, status: String, date: String? = nil, query: String? = nil) async throws -> Page<SecurityVisitorDTO> {
        try await client.page(
            .get("security/visitors", params: [
                "page": String(request.page),
                "limit": String(request.limit),
                "status": status,
                "date": date,
                "q": query,
            ]),
            of: SecurityVisitorDTO.self
        )
    }

    func recordVisitor(_ visitor: SecurityNewVisitor) async throws -> SecurityVisitorDTO {
        try await client.send(.post("security/visitors", json: visitor), as: SecurityVisitorDTO.self)
    }

    func markExit(visitorID: String) async throws -> SecurityVisitorDTO {
        try await client.send(.post("security/visitors/\(visitorID)/exit"), as: SecurityVisitorDTO.self)
    }

    // MARK: Камеры

    func cameraSettings() async throws -> SecurityCameraSettingsDTO {
        try await client.send(.get("cameras/settings"), as: SecurityCameraSettingsDTO.self)
    }

    /// Все камеры вуза: сервер отдаёт по 100, за первой страницей догружаются остальные —
    /// охрана видит все камеры своего вуза, а не первую сотню.
    func cameras() async throws -> [SecurityCameraDTO] {
        let limit = 100
        var page = 1
        var result: [SecurityCameraDTO] = []
        var seen = Set<String>()
        while true {
            let chunk = try await client.page(
                .get("cameras", query: PageRequest(cursor: nil, page: page, limit: limit).pageQuery),
                of: SecurityCameraDTO.self
            )
            for camera in chunk.items where !seen.contains(camera.id) {
                seen.insert(camera.id)
                result.append(camera)
            }
            let total = chunk.meta?.total ?? result.count
            if chunk.items.count < limit || result.count >= total || page >= 50 { break }
            page += 1
        }
        return result
    }

    func startView(cameraID: String) async throws -> SecurityCameraTicketDTO {
        try await client.send(.post("cameras/\(cameraID)/views"), as: SecurityCameraTicketDTO.self)
    }

    func heartbeat(sessionID: String) async throws -> SecurityCameraTicketDTO {
        try await client.send(.post("cameras/views/\(sessionID)/heartbeat"), as: SecurityCameraTicketDTO.self)
    }

    func endView(sessionID: String) async throws {
        try await client.send(.post("cameras/views/\(sessionID)/end"))
    }

    func viewer() async throws -> SecurityViewerDTO {
        try await client.send(.get("users/me"), as: SecurityViewerDTO.self)
    }

    // MARK: Помещения

    func rooms(_ request: PageRequest, search: String?, sort: String?, order: String?) async throws -> Page<SecurityRoomDTO> {
        try await client.page(
            .get("rooms", params: [
                "page": String(request.page),
                "limit": String(request.limit),
                "search": search,
                "sort": sort,
                "order": order,
            ]),
            of: SecurityRoomDTO.self
        )
    }

    func roomStatus(code: String) async throws -> SecurityRoomStatusDTO {
        let safe = code.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? code
        return try await client.send(.get("rooms/qr/\(safe)"), as: SecurityRoomStatusDTO.self)
    }

    // MARK: Студенческий

    /// Проверка гасит одноразовый токен: повтор того же токена сервер отклонит как уже
    /// проверенный. Поэтому вызывается один раз на скан и не перезапрашивается.
    func verify(token: String) async throws -> SecurityVerifiedCardDTO {
        try await client.send(
            .get("student-id/verify", query: [URLQueryItem(name: "token", value: token)]),
            as: SecurityVerifiedCardDTO.self
        )
    }
}
