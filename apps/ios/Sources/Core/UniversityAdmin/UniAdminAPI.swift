import Foundation

// Администратор вуза: оргструктура, аудитории, кампус, камеры, расписание, дисциплины,
// мастер настройки и аналитика. Контракты — `apps/api/src/modules/{faculties,specialties,
// groups,rooms,campus,cameras,schedules,courses,onboarding,analytics,universities}`.
// Вуз берётся из токена: в тело он уходит только там, где схема сервера его требует
// (факультет, дисциплина справочника, семестр).

// MARK: - Общие ссылки

struct UAdminRefDTO: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
}

struct UAdminPersonRefDTO: Decodable, Hashable, Identifiable {
    let id: String
    let firstName: String?
    let lastName: String?

    var name: String { DisplayFormat.name(first: firstName, last: lastName) }
}

// MARK: - Оргструктура

struct UAdminFacultyDTO: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let universityId: String?
}

struct UAdminSpecialtyDTO: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
}

struct UAdminGroupDTO: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let year: Int?
    let facultyId: String
    let starostaId: String?
}

struct UAdminGroupMemberDTO: Decodable, Hashable, Identifiable {
    let id: String
    let firstName: String?
    let lastName: String?
    let role: String
    let avatarUrl: String?

    var name: String { DisplayFormat.name(first: firstName, last: lastName) }
}

/// Человек из `GET /users` — для выбора преподавателя пары и дисциплины.
struct UAdminUserDTO: Decodable, Hashable, Identifiable {
    let id: String
    let firstName: String?
    let lastName: String?
    let role: String?
    let avatarUrl: String?
    let email: String?

    var name: String { DisplayFormat.name(first: firstName, last: lastName) }
}

struct UAdminCreatedInviteDTO: Decodable, Equatable {
    let id: String
    let token: String
}

// MARK: - Сводка вуза и аналитика

struct UAdminUniversityStatsDTO: Decodable, Equatable {
    let faculties: Int?
    let groups: Int?
    let rooms: Int?
    let students: Int?
    let teachers: Int?
}

struct UAdminAtRiskGroupDTO: Decodable, Hashable, Identifiable {
    let groupId: String
    let name: String
    let attendanceRate: Double

    var id: String { groupId }
}

struct UAdminUniversityOverviewDTO: Decodable, Equatable {
    struct GroupRate: Decodable, Hashable, Identifiable {
        let groupId: String
        let name: String
        let attendanceRate: Double
        let attendanceTracked: Int?

        var id: String { groupId }
    }

    let attendanceRate: Double?
    let submissionsPending: Int?
    let examsUpcoming: Int?
    let groups: [GroupRate]?
    let atRisk: [UAdminAtRiskGroupDTO]?
}

struct UAdminAttendanceTrendDTO: Decodable, Equatable {
    struct Point: Decodable, Hashable {
        let at: Date
        let value: Double?
    }

    struct Series: Decodable, Hashable, Identifiable {
        let facultyId: String
        let name: String
        let points: [Point]

        var id: String { facultyId }
        /// Последнее известное значение: недели без отметок пропускаются.
        var lastValue: Double? { points.last(where: { $0.value != nil })?.value }
    }

    let series: [Series]
}

struct UAdminAttendanceBreakdownDTO: Decodable, Equatable {
    struct Item: Decodable, Hashable, Identifiable {
        let facultyId: String
        let name: String
        let present: Double
        let late: Double
        let absent: Double
        let excused: Double

        var id: String { facultyId }
    }

    let items: [Item]
}

struct UAdminRoomLoadDTO: Decodable, Equatable {
    /// `grid[день][час]`, день 0 — понедельник.
    let grid: [[Double]]
    let peak: Double
    let rooms: Int
}

struct UAdminExamResultsDTO: Decodable, Equatable {
    struct Item: Decodable, Hashable, Identifiable {
        let facultyId: String
        let name: String
        let passed: Double
        let failed: Double
        let absent: Double
        let retake: Double

        var id: String { facultyId }
    }

    let items: [Item]
}

struct UAdminApplicationsFlowDTO: Decodable, Equatable {
    struct Point: Decodable, Hashable {
        let at: Date
        let submitted: Double
        let closed: Double
        let overdue: Double
    }

    let points: [Point]
}

struct UAdminInvitesFunnelDTO: Decodable, Equatable {
    let total: Int
    let pending: Int
    let used: Int
    let expired: Int
    let revoked: Int
    let conversion: Double
}

struct UAdminFacultyOverviewDTO: Decodable, Equatable {
    struct Totals: Decodable, Equatable {
        let groups: Int
        let students: Int
        let attendanceRate: Double?
        let submissionsPending: Int
        let examsUpcoming: Int
    }

    struct GroupStat: Decodable, Hashable, Identifiable {
        let groupId: String
        let name: String
        let students: Int
        let attendanceRate: Double?
        let attendanceTracked: Int

        var id: String { groupId }
    }

    let facultyId: String
    let totals: Totals
    let groups: [GroupStat]
}

struct UAdminAtRiskStudentsDTO: Decodable, Equatable {
    struct Reason: Decodable, Hashable {
        let kind: String
        let value: Double
    }

    struct Student: Decodable, Hashable, Identifiable {
        let studentId: String
        let firstName: String?
        let lastName: String?
        let groupName: String?
        let reasons: [Reason]

        var id: String { studentId }
        var name: String { DisplayFormat.name(first: firstName, last: lastName) }
        func value(_ kind: String) -> Double? { reasons.first(where: { $0.kind == kind })?.value }
    }

    struct Thresholds: Decodable, Equatable {
        let attendance: Double
        let gradeAvg: Double?
    }

    let thresholds: Thresholds?
    let students: [Student]
}

struct UAdminGroupAttendanceDTO: Decodable, Equatable {
    struct Student: Decodable, Hashable, Identifiable {
        let studentId: String
        let firstName: String?
        let lastName: String?
        let attendanceRate: Double?
        let tracked: Int

        var id: String { studentId }
        var name: String { DisplayFormat.name(first: firstName, last: lastName) }
    }

    let students: [Student]
}

// MARK: - Мастер настройки

struct UAdminOnboardingDTO: Decodable, Equatable {
    struct University: Decodable, Equatable {
        let id: String
        let name: String
        let shortName: String?
        let city: String?
        let timezone: String?
        let status: String
    }

    struct Step: Decodable, Hashable, Identifiable {
        let step: String
        let done: Bool
        let skipped: Bool
        let skippable: Bool
        let count: Int?

        var id: String { step }
    }

    let university: University
    let steps: [Step]
    let currentStep: String
    let blocking: [String]
    let canLaunch: Bool
}

struct UAdminKatoUnitDTO: Decodable, Equatable {
    let code: String
    let nameRu: String
}

// MARK: - Помещения

struct UAdminRoomDTO: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let capacity: Int?
    let kind: String
    let building: String?
    let floor: Int?
    let openHours: String?
    let phone: String?
    let info: String?
    let qrCode: String?
}

/// Наклейка помещения: картинка QR приходит готовой, `data:image/png;base64,…`.
struct UAdminRoomQrDTO: Decodable, Hashable, Identifiable {
    let roomId: String
    let name: String
    let kind: String
    let building: String?
    let floor: Int?
    let university: String?
    let code: String
    let url: String?
    let qr: String

    var id: String { roomId }
}

// MARK: - Кампус

struct UAdminCampusSummaryDTO: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let description: String?
    let publishedVersionId: String?
    let buildingsCount: Int
}

struct UAdminCampusFloorDTO: Decodable, Hashable, Identifiable {
    struct Plan: Decodable, Hashable {
        let revision: Int
    }

    let id: String
    let buildingId: String
    let level: Int
    let label: String
    let kind: String
    let elevationMm: Int?
    let heightMm: Int?
    let plan: Plan?
}

struct UAdminCampusPointDTO: Codable, Hashable {
    let x: Int
    let y: Int
}

struct UAdminCampusBuildingDTO: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let code: String?
    let floors: [UAdminCampusFloorDTO]
}

struct UAdminCampusTreeDTO: Decodable, Equatable {
    struct PublishedVersion: Decodable, Equatable {
        let id: String
        let number: Int
        let publishedAt: Date
    }

    let id: String
    let name: String
    let description: String?
    let buildings: [UAdminCampusBuildingDTO]
    let publishedVersion: PublishedVersion?
}

struct UAdminCampusVersionDTO: Decodable, Hashable, Identifiable {
    let id: String
    let number: Int
    let note: String?
    let publishedAt: Date
    let spaces: Int
    let current: Bool
}

struct UAdminCampusPublishedDTO: Decodable, Equatable {
    let id: String
    let number: Int
    let spaces: Int
}

// MARK: - Камеры

struct UAdminCameraAgentDTO: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let connection: String
    let ready: Bool?
    let version: String?
    let lastSeenAt: Date?
    let cameraCount: Int
}

struct UAdminCameraDTO: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let room: UAdminRefDTO?
    let enabled: Bool
    let status: String
    let lastSeenAt: Date?
    let agent: UAdminRefDTO?
    let streamUrl: String?
    let hasCredentials: Bool?
}

struct UAdminAgentTokenDTO: Decodable, Equatable {
    let agent: UAdminCameraAgentDTO
    let token: String
}

/// Пропуск на просмотр: адрес LL-HLS и токен к нему. Токен живёт `expiresInSec`,
/// продлевать — каждые `heartbeatInSec`.
struct UAdminCameraViewTicketDTO: Decodable, Equatable {
    let sessionId: String
    let cameraId: String
    let hlsUrl: String
    let token: String
    let expiresInSec: Int
    let heartbeatInSec: Int
}

// MARK: - Расписание

struct UAdminScheduleContainerDTO: Decodable, Hashable, Identifiable {
    let id: String
    let groupId: String
    let name: String
    let isActive: Bool
}

struct UAdminPairDTO: Decodable, Hashable, Identifiable {
    let id: String
    let scheduleId: String
    let groupId: String
    let subject: String
    let dayOfWeek: Int
    let startTime: String
    let endTime: String
    let weekType: String
    let teacher: UAdminPersonRefDTO?
    let room: UAdminRefDTO?
}

struct UAdminScheduleDetailDTO: Decodable, Equatable {
    let id: String
    let groupId: String
    let name: String
    let isActive: Bool
    let timezone: String?
    let pairs: [UAdminPairDTO]
}

struct UAdminScheduleChangeDTO: Decodable, Hashable, Identifiable {
    let id: String
    let pairId: String
    let type: String
    /// «2026-10-12» или полная ISO-строка — берём первые десять символов.
    let date: String
    let newStartTime: String?
    let newEndTime: String?
    let note: String?
    let newRoom: UAdminRefDTO?
    let newTeacher: UAdminPersonRefDTO?
}

// MARK: - Дисциплины

struct UAdminSubjectDTO: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let code: String?
}

struct UAdminTermDTO: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let number: Int?
    let startsOn: String
    let endsOn: String
    let isActive: Bool
}

struct UAdminCourseDTO: Decodable, Hashable, Identifiable {
    struct TermRef: Decodable, Hashable {
        let id: String
        let name: String
        let isActive: Bool?
    }

    let id: String
    let credits: Int?
    let subject: UAdminSubjectDTO
    let group: UAdminRefDTO
    let teacher: UAdminPersonRefDTO?
    let term: TermRef?
}

// MARK: - Запросы

/// Вызовы раздела администратора вуза. Динамические тела форм — через `JSONBody`.
struct UAdminAPI {
    let client: APIClient

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    /// Вуз из токена: его требуют тела «создать факультет / дисциплину / семестр».
    func universityID() async -> String? {
        await AppServices.session.currentToken?.universityID
    }

    // MARK: Оргструктура

    func faculties() async throws -> [UAdminFacultyDTO] {
        try await client.send(.get("faculties", params: ["page": "1", "limit": "100"]), as: [UAdminFacultyDTO].self)
    }

    func createFaculty(name: String) async throws {
        let university = await universityID()
        try await client.send(.post("faculties", json: JSONBody(["name": .string(name), "universityId": .text(university)])))
    }

    func renameFaculty(id: String, name: String) async throws {
        try await client.send(.patch("faculties/\(id)", json: JSONBody(["name": .string(name)])))
    }

    func deleteFaculty(id: String) async throws {
        try await client.send(.delete("faculties/\(id)"))
    }

    func specialties() async throws -> [UAdminSpecialtyDTO] {
        try await client.send(.get("specialties"), as: [UAdminSpecialtyDTO].self)
    }

    func createSpecialty(name: String) async throws {
        try await client.send(.post("specialties", json: JSONBody(["name": .string(name)])))
    }

    func renameSpecialty(id: String, name: String) async throws {
        try await client.send(.patch("specialties/\(id)", json: JSONBody(["name": .string(name)])))
    }

    func deleteSpecialty(id: String) async throws {
        try await client.send(.delete("specialties/\(id)"))
    }

    func groups(_ request: PageRequest, search: String?, facultyID: String? = nil) async throws -> Page<UAdminGroupDTO> {
        try await client.page(
            .get(
                "groups",
                params: [
                    "page": String(request.page), "limit": String(request.limit), "search": search, "facultyId": facultyID,
                ]
            ),
            of: UAdminGroupDTO.self
        )
    }

    func group(id: String) async throws -> UAdminGroupDTO {
        try await client.send(.get("groups/\(id)"), as: UAdminGroupDTO.self)
    }

    func groupMembers(id: String) async throws -> [UAdminGroupMemberDTO] {
        try await client.send(.get("groups/\(id)/members"), as: [UAdminGroupMemberDTO].self)
    }

    func createGroup(name: String, year: Int?, facultyID: String) async throws {
        var body: [String: JSONValue] = ["name": .string(name), "facultyId": .string(facultyID)]
        if let year { body["year"] = .int(year) }
        try await client.send(.post("groups", json: JSONBody(body)))
    }

    func updateGroup(id: String, name: String, year: Int?) async throws {
        try await client.send(.patch("groups/\(id)", json: JSONBody(["name": .string(name), "year": .int(year)])))
    }

    func assignStarosta(groupID: String, userID: String?) async throws {
        try await client.send(.patch("groups/\(groupID)/starosta", json: JSONBody(["starostaId": .text(userID)])))
    }

    func deleteGroup(id: String) async throws {
        try await client.send(.delete("groups/\(id)"))
    }

    /// Поиск людей по роли — пикер преподавателя. Пустой поиск — первые по алфавиту.
    func users(role: String, search: String?) async throws -> [UAdminUserDTO] {
        try await client.send(
            .get("users", params: ["role": role, "search": search, "page": "1", "limit": "20"]),
            as: [UAdminUserDTO].self
        )
    }

    /// Приглашение декана из мастера: ссылку сервер отдаёт один раз.
    func inviteDean(facultyID: String, email: String?) async throws -> UAdminCreatedInviteDTO {
        try await client.send(
            .post("invites", json: JSONBody(["role": "DEAN", "facultyId": .string(facultyID), "email": .text(email)].uadminCompactNulls())),
            as: UAdminCreatedInviteDTO.self
        )
    }

    // MARK: Обзор и аналитика

    func universityStats() async throws -> UAdminUniversityStatsDTO {
        guard let university = await universityID() else { throw APIError.malformedResponse(statusCode: 0) }
        return try await client.send(.get("universities/\(university)/stats"), as: UAdminUniversityStatsDTO.self)
    }

    func overview() async throws -> UAdminUniversityOverviewDTO {
        try await client.send(.get("analytics/university/overview"), as: UAdminUniversityOverviewDTO.self)
    }

    func attendanceTrend(weeks: Int) async throws -> UAdminAttendanceTrendDTO {
        try await client.send(
            .get("analytics/university/attendance-trend", params: ["weeks": String(weeks)]),
            as: UAdminAttendanceTrendDTO.self
        )
    }

    func attendanceBreakdown() async throws -> UAdminAttendanceBreakdownDTO {
        try await client.send(.get("analytics/university/attendance-breakdown"), as: UAdminAttendanceBreakdownDTO.self)
    }

    func roomLoad() async throws -> UAdminRoomLoadDTO {
        try await client.send(.get("analytics/university/room-load"), as: UAdminRoomLoadDTO.self)
    }

    func examResults() async throws -> UAdminExamResultsDTO {
        try await client.send(.get("analytics/university/exam-results"), as: UAdminExamResultsDTO.self)
    }

    func applicationsFlow(weeks: Int) async throws -> UAdminApplicationsFlowDTO {
        try await client.send(
            .get("analytics/university/applications-flow", params: ["weeks": String(weeks)]),
            as: UAdminApplicationsFlowDTO.self
        )
    }

    func invitesFunnel() async throws -> UAdminInvitesFunnelDTO {
        try await client.send(.get("analytics/university/invites-funnel"), as: UAdminInvitesFunnelDTO.self)
    }

    func facultyOverview(facultyID: String) async throws -> UAdminFacultyOverviewDTO {
        try await client.send(.get("analytics/faculty", params: ["facultyId": facultyID]), as: UAdminFacultyOverviewDTO.self)
    }

    func atRiskStudents(facultyID: String) async throws -> UAdminAtRiskStudentsDTO {
        try await client.send(.get("analytics/at-risk", params: ["facultyId": facultyID]), as: UAdminAtRiskStudentsDTO.self)
    }

    func groupAttendance(groupID: String) async throws -> UAdminGroupAttendanceDTO {
        try await client.send(.get("analytics/group/\(groupID)/attendance"), as: UAdminGroupAttendanceDTO.self)
    }

    /// Отчёт файлом (XLSX/CSV). Тело ответа — сам файл, без конверта.
    func exportReport(period: String, format: String, facultyID: String?) async throws -> Data {
        try await client.data(
            .get(
                "analytics/report/export",
                params: ["period": period, "format": format, "locale": "ru", "facultyId": facultyID]
            )
        )
    }

    // MARK: Мастер настройки

    func onboarding() async throws -> UAdminOnboardingDTO {
        try await client.send(.get("onboarding"), as: UAdminOnboardingDTO.self)
    }

    func confirmProfile() async throws -> UAdminOnboardingDTO {
        try await client.send(.post("onboarding/confirm-profile"), as: UAdminOnboardingDTO.self)
    }

    func skip(step: String) async throws -> UAdminOnboardingDTO {
        try await client.send(.post("onboarding/skip", json: JSONBody(["step": .string(step)])), as: UAdminOnboardingDTO.self)
    }

    func launch() async throws -> UAdminOnboardingDTO {
        try await client.send(.post("onboarding/launch"), as: UAdminOnboardingDTO.self)
    }

    func cityName(code: String) async throws -> String? {
        try await client.send(.get("kato/resolve", params: ["codes": code]), as: [UAdminKatoUnitDTO].self).first?.nameRu
    }

    // MARK: Помещения

    func rooms(_ request: PageRequest, sort: String?, order: String?, search: String? = nil) async throws -> Page<UAdminRoomDTO> {
        try await client.page(
            .get(
                "rooms",
                params: [
                    "page": String(request.page), "limit": String(request.limit), "sort": sort, "order": order,
                    "search": search,
                ]
            ),
            of: UAdminRoomDTO.self
        )
    }

    /// Все помещения вуза — для печати пачкой по корпусу и этажу.
    func allRooms() async throws -> [UAdminRoomDTO] {
        var all: [UAdminRoomDTO] = []
        var page = 1
        while true {
            let result = try await rooms(PageRequest(cursor: nil, page: page, limit: 100), sort: "name", order: "asc")
            all += result.items
            let total = result.meta?.total ?? all.count
            if result.items.isEmpty || all.count >= total || page >= 50 { break }
            page += 1
        }
        return all
    }

    func saveRoom(id: String?, body: [String: JSONValue]) async throws {
        if let id {
            try await client.send(.patch("rooms/\(id)", json: JSONBody(body)))
        } else {
            try await client.send(.post("rooms", json: JSONBody(body.uadminCompactNulls())))
        }
    }

    func deleteRoom(id: String) async throws {
        try await client.send(.delete("rooms/\(id)"))
    }

    /// Выдать QR пачкой. Идемпотентно: у помещения с наклейкой код не меняется.
    func issueQr(roomIDs: [String]) async throws -> [UAdminRoomQrDTO] {
        var result: [UAdminRoomQrDTO] = []
        // Сервер принимает до 200 помещений за раз.
        for start in stride(from: 0, to: roomIDs.count, by: 200) {
            let chunk = Array(roomIDs[start..<min(start + 200, roomIDs.count)])
            result += try await client.send(
                .post("rooms/qr/batch", json: JSONBody(["roomIds": .strings(chunk)])),
                as: [UAdminRoomQrDTO].self
            )
        }
        return result
    }

    func rotateQr(roomID: String) async throws -> UAdminRoomQrDTO {
        try await client.send(.post("rooms/\(roomID)/qr/rotate", json: JSONBody([:])), as: UAdminRoomQrDTO.self)
    }

    // MARK: Кампус

    func campuses() async throws -> [UAdminCampusSummaryDTO] {
        try await client.send(.get("campus"), as: [UAdminCampusSummaryDTO].self)
    }

    func createCampus(name: String, description: String?) async throws -> UAdminCampusSummaryDTO {
        try await client.send(
            .post("campus", json: JSONBody(["name": .string(name), "description": .text(description)].uadminCompactNulls())),
            as: UAdminCampusSummaryDTO.self
        )
    }

    func campus(id: String) async throws -> UAdminCampusTreeDTO {
        try await client.send(.get("campus/\(id)"), as: UAdminCampusTreeDTO.self)
    }

    func updateCampus(id: String, name: String, description: String?) async throws {
        try await client.send(.patch("campus/\(id)", json: JSONBody(["name": .string(name), "description": .text(description)])))
    }

    func deleteCampus(id: String) async throws {
        try await client.send(.delete("campus/\(id)"))
    }

    func createBuilding(campusID: String, body: [String: JSONValue]) async throws {
        try await client.send(.post("campus/\(campusID)/buildings", json: JSONBody(body)))
    }

    func updateBuilding(id: String, name: String, code: String?) async throws {
        try await client.send(.patch("campus/buildings/\(id)", json: JSONBody(["name": .string(name), "code": .text(code)])))
    }

    func deleteBuilding(id: String) async throws {
        try await client.send(.delete("campus/buildings/\(id)"))
    }

    func createFloor(buildingID: String, body: [String: JSONValue]) async throws {
        try await client.send(.post("campus/buildings/\(buildingID)/floors", json: JSONBody(body)))
    }

    func updateFloor(id: String, body: [String: JSONValue]) async throws {
        try await client.send(.patch("campus/floors/\(id)", json: JSONBody(body)))
    }

    func deleteFloor(id: String) async throws {
        try await client.send(.delete("campus/floors/\(id)"))
    }

    func publishCampus(id: String, note: String?, floorRevisions: [String: Int]) async throws -> UAdminCampusPublishedDTO {
        var body: [String: JSONValue] = ["floorRevisions": .object(floorRevisions.mapValues { .int($0) })]
        if let note = note?.trimmingCharacters(in: .whitespacesAndNewlines), !note.isEmpty { body["note"] = .string(note) }
        return try await client.send(.post("campus/\(id)/publish", json: JSONBody(body)), as: UAdminCampusPublishedDTO.self)
    }

    func campusVersions(id: String) async throws -> [UAdminCampusVersionDTO] {
        try await client.send(.get("campus/\(id)/versions"), as: [UAdminCampusVersionDTO].self)
    }

    func activateVersion(campusID: String, versionID: String) async throws {
        try await client.send(.post("campus/\(campusID)/versions/\(versionID)/activate"))
    }

    func restoreVersion(campusID: String, versionID: String) async throws -> Int {
        struct Restored: Decodable { let restored: Int }
        return try await client.send(.post("campus/\(campusID)/versions/\(versionID)/restore"), as: Restored.self).restored
    }

    // MARK: Камеры

    func cameraSettings() async throws -> Bool {
        struct Settings: Decodable { let enabled: Bool }
        return try await client.send(.get("cameras/settings"), as: Settings.self).enabled
    }

    func setCameras(enabled: Bool) async throws {
        try await client.send(.patch("cameras/settings", json: JSONBody(["enabled": .bool(enabled)])))
    }

    func cameraAgents() async throws -> [UAdminCameraAgentDTO] {
        try await client.send(.get("camera-agents"), as: [UAdminCameraAgentDTO].self)
    }

    func createAgent(name: String) async throws -> UAdminAgentTokenDTO {
        try await client.send(.post("camera-agents", json: JSONBody(["name": .string(name)])), as: UAdminAgentTokenDTO.self)
    }

    func rotateAgentToken(id: String) async throws -> UAdminAgentTokenDTO {
        try await client.send(.post("camera-agents/\(id)/token"), as: UAdminAgentTokenDTO.self)
    }

    func deleteAgent(id: String) async throws {
        try await client.send(.delete("camera-agents/\(id)"))
    }

    /// Все камеры вуза: страницы по 100, пока не кончатся.
    func cameras() async throws -> [UAdminCameraDTO] {
        var all: [UAdminCameraDTO] = []
        var page = 1
        while true {
            let result = try await client.page(
                .get("cameras", params: ["page": String(page), "limit": "100"]),
                of: UAdminCameraDTO.self
            )
            let known = Set(all.map(\.id))
            all += result.items.filter { !known.contains($0.id) }
            let total = result.meta?.total ?? all.count
            if result.items.isEmpty || all.count >= total || page >= 100 { break }
            page += 1
        }
        return all
    }

    func saveCamera(id: String?, body: [String: JSONValue]) async throws {
        if let id {
            try await client.send(.patch("cameras/\(id)", json: JSONBody(body)))
        } else {
            try await client.send(.post("cameras", json: JSONBody(body)))
        }
    }

    func deleteCamera(id: String) async throws {
        try await client.send(.delete("cameras/\(id)"))
    }

    func startView(cameraID: String) async throws -> UAdminCameraViewTicketDTO {
        try await client.send(.post("cameras/\(cameraID)/views"), as: UAdminCameraViewTicketDTO.self)
    }

    func heartbeatView(sessionID: String) async throws -> UAdminCameraViewTicketDTO {
        try await client.send(.post("cameras/views/\(sessionID)/heartbeat"), as: UAdminCameraViewTicketDTO.self)
    }

    func endView(sessionID: String) async throws {
        try await client.send(.post("cameras/views/\(sessionID)/end"))
    }

    // MARK: Расписание

    func scheduleContainers(groupID: String) async throws -> [UAdminScheduleContainerDTO] {
        try await client.send(.get("schedules", params: ["groupId": groupID]), as: [UAdminScheduleContainerDTO].self)
    }

    func scheduleContainer(id: String) async throws -> UAdminScheduleDetailDTO {
        try await client.send(.get("schedules/\(id)"), as: UAdminScheduleDetailDTO.self)
    }

    func createContainer(groupID: String, name: String, isActive: Bool) async throws -> UAdminScheduleContainerDTO {
        try await client.send(
            .post(
                "schedules",
                json: JSONBody(["groupId": .string(groupID), "name": .string(name), "isActive": .bool(isActive)])
            ),
            as: UAdminScheduleContainerDTO.self
        )
    }

    func activateContainer(id: String) async throws {
        try await client.send(.patch("schedules/\(id)", json: JSONBody(["isActive": true])))
    }

    func renameContainer(id: String, name: String) async throws {
        try await client.send(.patch("schedules/\(id)", json: JSONBody(["name": .string(name)])))
    }

    func deleteContainer(id: String) async throws {
        try await client.send(.delete("schedules/\(id)"))
    }

    func savePair(id: String?, body: [String: JSONValue]) async throws {
        if let id {
            try await client.send(.patch("pairs/\(id)", json: JSONBody(body)))
        } else {
            try await client.send(.post("pairs", json: JSONBody(body)))
        }
    }

    func deletePair(id: String) async throws {
        try await client.send(.delete("pairs/\(id)"))
    }

    func scheduleChanges(groupID: String, from: String, to: String) async throws -> [UAdminScheduleChangeDTO] {
        try await client.send(
            .get("schedule/changes", params: ["groupId": groupID, "from": from, "to": to]),
            as: [UAdminScheduleChangeDTO].self
        )
    }

    func createChange(body: [String: JSONValue]) async throws {
        try await client.send(.post("schedule/changes", json: JSONBody(body)))
    }

    func deleteChange(id: String) async throws {
        try await client.send(.delete("schedule/changes/\(id)"))
    }

    // MARK: Дисциплины

    func courses(_ request: PageRequest, sort: String?, order: String?) async throws -> Page<UAdminCourseDTO> {
        try await client.page(
            .get(
                "courses",
                params: ["page": String(request.page), "limit": String(request.limit), "sort": sort, "order": order]
            ),
            of: UAdminCourseDTO.self
        )
    }

    func subjects(_ request: PageRequest, search: String?, sort: String? = "name") async throws -> Page<UAdminSubjectDTO> {
        try await client.page(
            .get(
                "subjects",
                params: [
                    "page": String(request.page), "limit": String(request.limit), "search": search, "sort": sort,
                    "order": "asc",
                ]
            ),
            of: UAdminSubjectDTO.self
        )
    }

    func terms(_ request: PageRequest) async throws -> Page<UAdminTermDTO> {
        try await client.page(
            .get(
                "terms",
                params: ["page": String(request.page), "limit": String(request.limit), "sort": "startsOn", "order": "desc"]
            ),
            of: UAdminTermDTO.self
        )
    }

    func saveSubject(id: String?, name: String, code: String?) async throws {
        if let id {
            try await client.send(.patch("subjects/\(id)", json: JSONBody(["name": .string(name), "code": .text(code)])))
        } else {
            let university = await universityID()
            try await client.send(
                .post(
                    "subjects",
                    json: JSONBody(["name": .string(name), "code": .text(code), "universityId": .text(university)].uadminCompactNulls())
                )
            )
        }
    }

    func deleteSubject(id: String) async throws {
        try await client.send(.delete("subjects/\(id)"))
    }

    func saveTerm(id: String?, body: [String: JSONValue]) async throws {
        if let id {
            try await client.send(.patch("terms/\(id)", json: JSONBody(body)))
        } else {
            var fields = body.uadminCompactNulls()
            fields["universityId"] = .text(await universityID())
            try await client.send(.post("terms", json: JSONBody(fields)))
        }
    }

    func deleteTerm(id: String) async throws {
        try await client.send(.delete("terms/\(id)"))
    }

    func saveCourse(id: String?, body: [String: JSONValue]) async throws {
        if let id {
            try await client.send(.patch("courses/\(id)", json: JSONBody(body)))
        } else {
            try await client.send(.post("courses", json: JSONBody(body.uadminCompactNulls())))
        }
    }

    func deleteCourse(id: String) async throws {
        try await client.send(.delete("courses/\(id)"))
    }
}

extension Dictionary where Key == String, Value == JSONValue {
    /// Без `null`: в создании пустое поле — «не задано», и строгая схема сервера
    /// (`.optional()` без `.nullable()`) на `null` ответит ошибкой.
    fileprivate func uadminCompactNulls() -> [String: JSONValue] {
        filter { !$0.value.isNull }
    }
}
