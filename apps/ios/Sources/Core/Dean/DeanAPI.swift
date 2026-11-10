import Foundation

// Деканат: сводки факультета, люди, дисциплины, экзамены, запись на приём, расписание.
// Контракты — `apps/api/src/modules/{analytics,groups,users,courses,exams,appointments,
// schedules,rooms,notifications}`. Область (факультет) сервер берёт из токена декана,
// поэтому ни один запрос здесь `facultyId` не передаёт.

// MARK: - Общие ссылки

struct DeanPersonRef: Decodable, Equatable, Hashable {
    let id: String
    let firstName: String?
    let lastName: String?

    var name: String { DisplayFormat.name(first: firstName, last: lastName) }
}

struct DeanNamedRef: Decodable, Equatable, Hashable {
    let id: String
    let name: String
}

// MARK: - Аналитика

struct DeanFacultyOverview: Decodable, Equatable {
    struct Totals: Decodable, Equatable {
        let groups: Int
        let students: Int
        /// Проценты; `nil` — посещаемость ещё не отмечали.
        let attendanceRate: Double?
        let submissionsPending: Int
        let examsUpcoming: Int
    }

    struct GroupStat: Decodable, Equatable, Identifiable {
        let groupId: String
        let name: String
        let students: Int
        let attendanceRate: Double?
        let attendanceTracked: Int?

        var id: String { groupId }
    }

    let facultyId: String?
    let totals: Totals
    let groups: [GroupStat]
}

struct DeanAtRisk: Decodable, Equatable {
    struct Thresholds: Decodable, Equatable {
        let attendance: Double
        let gradeAvg: Double?
    }

    struct Reason: Decodable, Equatable, Hashable {
        /// `LOW_ATTENDANCE`, `OVERDUE_ASSIGNMENTS`, `LOW_GRADES`.
        let kind: String
        /// Проценты для LOW_*, штуки для просрочек.
        let value: Double
    }

    struct Student: Decodable, Equatable, Identifiable {
        let studentId: String
        let firstName: String?
        let lastName: String?
        let groupId: String?
        let groupName: String?
        let reasons: [Reason]
        let severity: Double?

        var id: String { studentId }
        var name: String { DisplayFormat.name(first: firstName, last: lastName) }

        func value(_ kind: String) -> Double? {
            reasons.first { $0.kind == kind }?.value
        }
    }

    let thresholds: Thresholds
    let students: [Student]
}

struct DeanGroupAttendance: Decodable, Equatable {
    struct Student: Decodable, Equatable, Identifiable {
        let studentId: String
        let firstName: String?
        let lastName: String?
        let attendanceRate: Double?
        let tracked: Int

        var id: String { studentId }
        var name: String { DisplayFormat.name(first: firstName, last: lastName) }
    }

    let groupId: String
    let students: [Student]
}

struct DeanQueueStats: Decodable, Equatable {
    let new: Int
    let inWork: Int
    let actionNeeded: Int
    let ready: Int
    let overdue: Int
}

struct DeanNotification: Decodable, Equatable, Identifiable {
    let id: String
    let type: String
    let title: String
    let body: String?
    let createdAt: Date
}

// MARK: - Группы и люди

struct DeanGroup: Decodable, Equatable, Identifiable, Hashable {
    let id: String
    let name: String
    let year: Int?
    let facultyId: String?
    let starostaId: String?
}

struct DeanGroupMember: Decodable, Equatable, Identifiable {
    let id: String
    let firstName: String?
    let lastName: String?
    let role: String
    let avatarUrl: String?

    var name: String { DisplayFormat.name(first: firstName, last: lastName) }
    var roleValue: Role { Role(rawValue: role) ?? .unknown }
}

/// Строка таблицы пользователей (`GET /users`).
struct DeanUser: Decodable, Equatable, Identifiable {
    let id: String
    let email: String?
    let firstName: String?
    let lastName: String?
    let role: String
    let avatarUrl: String?
    let avatarThumbUrl: String?
    let groupId: String?
    let isBlocked: Bool?

    var name: String { DisplayFormat.name(first: firstName, last: lastName) }
    var roleValue: Role { Role(rawValue: role) ?? .unknown }
}

/// Профиль человека (`GET /users/:id`) — поля, которые нужны карточке студента.
struct DeanUserProfile: Decodable, Equatable {
    let id: String
    let email: String?
    let phone: String?
    let firstName: String?
    let lastName: String?
    let middleName: String?
    let avatarUrl: String?
    let role: String
    let groupId: String?
    let course: Int?
    let enrollmentYear: Int?
    let graduationYear: Int?
    let educationLevel: String?
    let studyForm: String?
    let fundingType: String?
    let specialty: String?
    let academicStatus: String?
    let gpa: Double?
    let studentCardNumber: String?
    let dormitory: String?
    let starostaSince: Date?

    var name: String { DisplayFormat.name(first: firstName, last: lastName, middle: middleName) }
    var roleValue: Role { Role(rawValue: role) ?? .unknown }
}

struct DeanLibraryDebts: Decodable, Equatable {
    struct Loan: Decodable, Equatable, Identifiable {
        struct Book: Decodable, Equatable { let title: String }
        struct Copy: Decodable, Equatable { let inventoryNumber: String? }

        let id: String
        let status: String?
        let overdue: Bool?
        let book: Book?
        let copy: Copy?
    }

    let clear: Bool
    let loans: [Loan]
}

struct DeanSpecialty: Decodable, Equatable, Identifiable {
    let id: String
    let name: String
}

// MARK: - Дисциплины

struct DeanCourse: Decodable, Equatable, Identifiable {
    struct Subject: Decodable, Equatable {
        let id: String
        let name: String
        let code: String?
    }

    struct Term: Decodable, Equatable {
        let id: String
        let name: String
        let isActive: Bool?
    }

    let id: String
    let credits: Int?
    let subject: Subject
    let group: DeanNamedRef
    let teacher: DeanPersonRef?
    let term: Term?
}

struct DeanSubject: Decodable, Equatable, Identifiable {
    let id: String
    let name: String
    let code: String?
}

struct DeanTerm: Decodable, Equatable, Identifiable {
    let id: String
    let name: String
    let number: Int?
    /// Строкой: дата семестра может прийти и днём, и моментом — разбирает экран.
    let startsOn: String?
    let endsOn: String?
    let isActive: Bool
}

// MARK: - Экзамены

struct DeanExam: Decodable, Equatable, Identifiable {
    struct Course: Decodable, Equatable {
        let id: String
        let teacherId: String?
        let subject: DeanNamedRef
    }

    let id: String
    let date: Date
    let format: String
    let maxScore: Int?
    let note: String?
    let groupId: String?
    let course: Course
    let group: DeanNamedRef
    let room: DeanNamedRef?
    let examiner: DeanPersonRef?
}

struct DeanExamRoster: Decodable, Equatable {
    struct Entry: Decodable, Equatable, Identifiable {
        let studentId: String
        let firstName: String?
        let lastName: String?
        let admitted: Bool
        let status: String
        let score: Double?
        let attempt: Int?
        let note: String?

        var id: String { studentId }
        var name: String { DisplayFormat.name(first: firstName, last: lastName) }
    }

    let examId: String
    let students: [Entry]
}

struct DeanExamResultEntry: Encodable, Equatable {
    let studentId: String
    let admitted: Bool
    let status: String
    let score: Double?

    enum CodingKeys: String, CodingKey { case studentId, admitted, status, score }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(studentId, forKey: .studentId)
        try container.encode(admitted, forKey: .admitted)
        try container.encode(status, forKey: .status)
        // `null` — «балл снят»: без ключа сервер оставил бы прежний.
        if let score { try container.encode(score, forKey: .score) } else { try container.encodeNil(forKey: .score) }
    }
}

// MARK: - Запись на приём

struct DeanAppointment: Decodable, Equatable, Identifiable {
    let id: String
    let type: String
    let status: String
    let topic: String?
    let requestedAt: Date
    let scheduledAt: Date?
    let staffNote: String?
    let createdAt: Date?
    let student: DeanPersonRef
    let assignedTo: DeanPersonRef?

    /// Время приёма: назначенное, а пока его нет — желаемое студентом.
    var when: Date { scheduledAt ?? requestedAt }

    /// Допустимые переходы — та же таблица, что проверяет сервер (`APPOINTMENT_TRANSITIONS`).
    func can(_ target: String) -> Bool {
        let table: [String: [String]] = [
            "REQUESTED": ["CONFIRMED", "RESCHEDULED", "CANCELLED"],
            "CONFIRMED": ["RESCHEDULED", "COMPLETED", "CANCELLED"],
            "RESCHEDULED": ["CONFIRMED", "RESCHEDULED", "COMPLETED", "CANCELLED"],
        ]
        return table[status]?.contains(target) ?? false
    }

    var isOpen: Bool { ["REQUESTED", "CONFIRMED", "RESCHEDULED"].contains(status) }
}

// MARK: - Расписание

struct DeanPair: Decodable, Equatable, Identifiable {
    let id: String
    let scheduleId: String?
    let groupId: String?
    let subject: String
    let dayOfWeek: Int
    let startTime: String
    let endTime: String
    let weekType: String
    let teacher: DeanPersonRef?
    let room: DeanNamedRef?
}

struct DeanScheduleResponse: Decodable, Equatable {
    let timezone: String?
    let pairs: [DeanPair]
    let nextCursor: String?
}

struct DeanScheduleContainer: Decodable, Equatable, Identifiable, Hashable {
    let id: String
    let groupId: String
    let name: String
    let isActive: Bool
    let createdAt: Date?
}

struct DeanScheduleContainerDetail: Decodable, Equatable {
    let id: String
    let groupId: String
    let name: String
    let isActive: Bool
    let timezone: String?
    let pairs: [DeanPair]
}

struct DeanScheduleChange: Decodable, Equatable, Identifiable {
    struct PairInfo: Decodable, Equatable {
        let groupId: String?
        let subject: String
        let dayOfWeek: Int?
        let startTime: String
        let endTime: String?
    }

    let id: String
    let pairId: String
    /// `MOVED`, `ROOM_CHANGED`, `CANCELLED`, `SUBSTITUTED`.
    let type: String
    let date: Date
    let newStartTime: String?
    let newEndTime: String?
    let note: String?
    let newRoom: DeanNamedRef?
    let newTeacher: DeanPersonRef?
    let pair: PairInfo
}

/// Поля пары для создания и правки. `nil` у преподавателя и аудитории — «снять».
struct DeanPairDraft: Equatable {
    var subject = ""
    var dayOfWeek = 1
    var startTime = "08:00"
    var endTime = "09:30"
    var weekType = "BOTH"
    var roomId: String?
    var teacherId: String?
}

struct DeanScheduleChangeDraft: Equatable {
    var type = "CANCELLED"
    /// День `YYYY-MM-DD` по календарю вуза.
    var date: String
    var newRoomId: String?
    var newTeacherId: String?
    var newStartTime: String?
    var newEndTime: String?
    var note: String?
}

struct DeanRoom: Decodable, Equatable, Identifiable {
    let id: String
    let name: String
    let building: String?
    let capacity: Int?
}

// MARK: - Выгрузки

enum DeanReportPeriod: String, CaseIterable, Identifiable {
    case month, quarter, year
    var id: String { rawValue }
}

enum DeanExportFormat: String, CaseIterable, Identifiable {
    case xlsx, csv
    var id: String { rawValue }
}

// MARK: - API

struct DeanAPI {
    private let client: APIClient

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    private static var locale: String {
        let code = Locale.current.language.languageCode?.identifier ?? "ru"
        return ["ru", "kk", "en"].contains(code) ? code : "ru"
    }

    // MARK: Сводки

    func facultyOverview() async throws -> DeanFacultyOverview {
        try await client.send(.get("analytics/faculty"), as: DeanFacultyOverview.self)
    }

    func atRisk() async throws -> DeanAtRisk {
        try await client.send(.get("analytics/at-risk"), as: DeanAtRisk.self)
    }

    func groupAttendance(groupID: String) async throws -> DeanGroupAttendance {
        try await client.send(.get("analytics/group/\(groupID)/attendance"), as: DeanGroupAttendance.self)
    }

    func queueStats() async throws -> DeanQueueStats {
        try await client.send(.get("applications/queue-stats"), as: DeanQueueStats.self)
    }

    func notifications(limit: Int = 20) async throws -> [DeanNotification] {
        try await client.page(
            .get("notifications", query: [URLQueryItem(name: "limit", value: String(limit))]),
            of: DeanNotification.self
        ).items
    }

    /// Отчёт факультета файлом: строка на группу, «Итого», лист происхождения.
    func exportReport(period: DeanReportPeriod, format: DeanExportFormat) async throws -> Data {
        try await client.data(
            .get(
                "analytics/report/export",
                params: ["period": period.rawValue, "format": format.rawValue, "locale": Self.locale]
            )
        )
    }

    // MARK: Группы

    func groups(_ request: PageRequest, search: String?) async throws -> Page<DeanGroup> {
        var query = request.pageQuery
        if let search, !search.isEmpty { query.append(URLQueryItem(name: "search", value: String(search.prefix(100)))) }
        return try await client.page(.get("groups", query: query), of: DeanGroup.self)
    }

    func group(id: String) async throws -> DeanGroup {
        try await client.send(.get("groups/\(id)"), as: DeanGroup.self)
    }

    func groupMembers(id: String) async throws -> [DeanGroupMember] {
        try await client.send(.get("groups/\(id)/members"), as: [DeanGroupMember].self)
    }

    /// Назначить старосту (`nil` — снять). Сервер меняет роли одной транзакцией.
    func assignStarosta(groupID: String, studentID: String?) async throws {
        try await client.send(.patch("groups/\(groupID)/starosta", json: JSONBody(["starostaId": .text(studentID)])))
    }

    // MARK: Люди

    struct UserQuery: Equatable {
        var role: Role?
        var search = ""
        var groupID: String?
        /// `name`, `email`, `role`, `blocked`, `createdAt`.
        var sort: String?
        var ascending = true

        var params: [String: String?] {
            [
                "role": role?.rawValue,
                "search": search.isEmpty ? nil : String(search.prefix(100)),
                "groupId": groupID,
                "sort": sort,
                "order": sort == nil ? nil : (ascending ? "asc" : "desc"),
            ]
        }
    }

    func users(_ request: PageRequest, query: UserQuery) async throws -> Page<DeanUser> {
        var params = query.params
        params["page"] = String(request.page)
        params["limit"] = String(request.limit)
        return try await client.page(.get("users", params: params), of: DeanUser.self)
    }

    func exportUsers(query: UserQuery, format: DeanExportFormat) async throws -> Data {
        var params = query.params
        params["format"] = format.rawValue
        params["locale"] = Self.locale
        return try await client.data(.get("users/export", params: params))
    }

    func user(id: String) async throws -> DeanUserProfile {
        try await client.send(.get("users/\(id)"), as: DeanUserProfile.self)
    }

    /// Учебные данные студента — только изменённые поля.
    func updateAcademic(userID: String, fields: [String: JSONValue]) async throws {
        try await client.send(.patch("users/\(userID)/academic", json: JSONBody(fields)))
    }

    /// Книги на руках и утерянные — перед переводом студента в «Отчислен»/«Выпускник».
    func libraryDebts(userID: String) async throws -> DeanLibraryDebts {
        try await client.send(.get("library/readers/\(userID)/debts"), as: DeanLibraryDebts.self)
    }

    func specialties() async throws -> [DeanSpecialty] {
        try await client.send(.get("specialties"), as: [DeanSpecialty].self)
    }

    /// Преподаватели и деканы вуза — их ставят ведущими, экзаменаторами и заменяющими.
    /// Фильтр роли у `GET /users` одиночный, поэтому два запроса.
    func teachingStaff(search: String) async throws -> [DeanUser] {
        async let teachers = client.page(
            .get("users", params: ["role": "TEACHER", "search": search.isEmpty ? nil : search, "limit": "30", "page": "1"]),
            of: DeanUser.self
        )
        async let deans = client.page(
            .get("users", params: ["role": "DEAN", "search": search.isEmpty ? nil : search, "limit": "30", "page": "1"]),
            of: DeanUser.self
        )
        let all = try await teachers.items + deans.items
        return all.filter { $0.isBlocked != true }.sorted { $0.name < $1.name }
    }

    // MARK: Дисциплины

    func courses(_ request: PageRequest, sort: String?, ascending: Bool, groupID: String? = nil) async throws -> Page<DeanCourse> {
        var params: [String: String?] = [
            "page": String(request.page), "limit": String(request.limit), "groupId": groupID,
        ]
        if let sort {
            params["sort"] = sort
            params["order"] = ascending ? "asc" : "desc"
        }
        return try await client.page(.get("courses", params: params), of: DeanCourse.self)
    }

    /// Все дисциплины факультета — для выбора в форме экзамена. Предел страниц —
    /// чтобы цикл не верил `total` бесконечно.
    func allCourses() async throws -> [DeanCourse] {
        var result: [DeanCourse] = []
        var seen = Set<String>()
        for page in 1...20 {
            let chunk = try await client.page(
                .get("courses", params: ["page": String(page), "limit": "100", "sort": "subject", "order": "asc"]),
                of: DeanCourse.self
            )
            for course in chunk.items where !seen.contains(course.id) {
                seen.insert(course.id)
                result.append(course)
            }
            let total = chunk.meta?.total ?? 0
            if chunk.items.count < 100 || result.count >= total { break }
        }
        return result
    }

    func subjects(_ request: PageRequest, search: String?) async throws -> Page<DeanSubject> {
        var params: [String: String?] = ["page": String(request.page), "limit": String(request.limit), "sort": "name", "order": "asc"]
        params["search"] = search?.isEmpty == false ? search : nil
        return try await client.page(.get("subjects", params: params), of: DeanSubject.self)
    }

    func terms(_ request: PageRequest) async throws -> Page<DeanTerm> {
        try await client.page(
            .get("terms", params: ["page": String(request.page), "limit": String(request.limit), "sort": "isActive", "order": "desc"]),
            of: DeanTerm.self
        )
    }

    func createCourse(subjectID: String, groupID: String, teacherID: String?, termID: String?, credits: Int?) async throws {
        var fields: [String: JSONValue] = ["subjectId": .string(subjectID), "groupId": .string(groupID)]
        if let teacherID { fields["teacherId"] = .string(teacherID) }
        if let termID { fields["termId"] = .string(termID) }
        if let credits { fields["credits"] = .int(credits) }
        try await client.send(.post("courses", json: JSONBody(fields)))
    }

    /// Правка дисциплины — только изменённые поля: сервер перепроверяет каждого
    /// переданного преподавателя.
    func updateCourse(id: String, fields: [String: JSONValue]) async throws {
        try await client.send(.patch("courses/\(id)", json: JSONBody(fields)))
    }

    func deleteCourse(id: String) async throws {
        try await client.send(.delete("courses/\(id)"))
    }

    // MARK: Экзамены

    func exams(from: Date?, to: Date?) async throws -> [DeanExam] {
        try await client.send(
            .get("exams", params: ["from": from.map(JSONCoding.isoString), "to": to.map(JSONCoding.isoString)]),
            as: [DeanExam].self
        )
    }

    func exam(id: String) async throws -> DeanExam {
        try await client.send(.get("exams/\(id)"), as: DeanExam.self)
    }

    func createExam(fields: [String: JSONValue]) async throws {
        try await client.send(.post("exams", json: JSONBody(fields)))
    }

    func updateExam(id: String, fields: [String: JSONValue]) async throws {
        try await client.send(.patch("exams/\(id)", json: JSONBody(fields)))
    }

    func deleteExam(id: String) async throws {
        try await client.send(.delete("exams/\(id)"))
    }

    func examRoster(id: String) async throws -> DeanExamRoster {
        try await client.send(.get("exams/\(id)/results"), as: DeanExamRoster.self)
    }

    func saveExamResults(examID: String, entries: [DeanExamResultEntry]) async throws {
        struct Body: Encodable {
            let examId: String
            let entries: [DeanExamResultEntry]
        }
        try await client.send(.put("exams/results", json: Body(examId: examID, entries: entries)))
    }

    func rooms(search: String) async throws -> [DeanRoom] {
        try await client.page(
            .get("rooms", params: ["page": "1", "limit": "50", "search": search.isEmpty ? nil : String(search.prefix(100))]),
            of: DeanRoom.self
        ).items
    }

    // MARK: Запись на приём

    /// Очередь факультета: `active` — рабочая, `closed` — архив. Курсор — id последней записи.
    func appointmentQueue(view: String, cursor: String?, limit: Int) async throws -> [DeanAppointment] {
        try await client.send(
            .get("deanery-appointments/queue", params: ["view": view, "cursor": cursor, "limit": String(limit)]),
            as: [DeanAppointment].self
        )
    }

    func confirmAppointment(id: String, at date: Date, note: String?, reschedule: Bool) async throws {
        var fields: [String: JSONValue] = ["scheduledAt": .date(date)]
        if let note = note?.trimmingCharacters(in: .whitespacesAndNewlines), !note.isEmpty { fields["staffNote"] = .string(note) }
        try await client.send(.post("deanery-appointments/\(id)/\(reschedule ? "reschedule" : "confirm")", json: JSONBody(fields)))
    }

    func completeAppointment(id: String) async throws {
        try await client.send(.post("deanery-appointments/\(id)/complete"))
    }

    func cancelAppointment(id: String) async throws {
        try await client.send(.post("deanery-appointments/\(id)/staff-cancel"))
    }

    // MARK: Расписание

    /// Действующее расписание факультета (или одной группы) — все страницы.
    func schedule(groupID: String?) async throws -> (timezone: String?, pairs: [DeanPair]) {
        var pairs: [DeanPair] = []
        var timezone: String?
        var cursor: String?
        for _ in 0..<20 {
            let page = try await client.send(
                .get("schedule", params: ["groupId": groupID, "cursor": cursor]),
                as: DeanScheduleResponse.self
            )
            timezone = page.timezone
            pairs += page.pairs
            guard let next = page.nextCursor, !next.isEmpty else { break }
            cursor = next
        }
        return (timezone, pairs)
    }

    /// Разовые изменения за дни `from…to` (`YYYY-MM-DD`), все страницы.
    func scheduleChanges(from: String, to: String, groupID: String? = nil) async throws -> [DeanScheduleChange] {
        var result: [DeanScheduleChange] = []
        var cursor: String?
        for _ in 0..<20 {
            let page = try await client.page(
                .get("schedule/changes", params: ["from": from, "to": to, "groupId": groupID, "cursor": cursor, "limit": "500"]),
                of: DeanScheduleChange.self
            )
            result += page.items
            guard page.meta?.hasNext == true, let next = page.meta?.cursor else { break }
            cursor = next
        }
        return result
    }

    func scheduleContainers(groupID: String) async throws -> [DeanScheduleContainer] {
        try await client.send(.get("schedules", params: ["groupId": groupID]), as: [DeanScheduleContainer].self)
    }

    func scheduleContainer(id: String) async throws -> DeanScheduleContainerDetail {
        try await client.send(.get("schedules/\(id)"), as: DeanScheduleContainerDetail.self)
    }

    /// Новая версия: при действующей — черновиком, иначе сразу активная.
    func createScheduleContainer(groupID: String, name: String, isActive: Bool) async throws -> DeanScheduleContainer {
        try await client.send(
            .post("schedules", json: JSONBody(["groupId": .string(groupID), "name": .string(name), "isActive": .bool(isActive)])),
            as: DeanScheduleContainer.self
        )
    }

    func updateScheduleContainer(id: String, fields: [String: JSONValue]) async throws {
        try await client.send(.patch("schedules/\(id)", json: JSONBody(fields)))
    }

    func deleteScheduleContainer(id: String) async throws {
        try await client.send(.delete("schedules/\(id)"))
    }

    func createPair(scheduleID: String, draft: DeanPairDraft) async throws {
        var fields = Self.pairFields(draft)
        fields["scheduleId"] = .string(scheduleID)
        try await client.send(.post("pairs", json: JSONBody(fields)))
    }

    func updatePair(id: String, draft: DeanPairDraft) async throws {
        try await client.send(.patch("pairs/\(id)", json: JSONBody(Self.pairFields(draft))))
    }

    func deletePair(id: String) async throws {
        try await client.send(.delete("pairs/\(id)"))
    }

    func createScheduleChange(pairID: String, draft: DeanScheduleChangeDraft) async throws {
        var fields: [String: JSONValue] = ["pairId": .string(pairID), "type": .string(draft.type), "date": .string(draft.date)]
        switch draft.type {
        case "ROOM_CHANGED": fields["newRoomId"] = .text(draft.newRoomId)
        case "SUBSTITUTED": fields["newTeacherId"] = .text(draft.newTeacherId)
        case "MOVED":
            fields["newStartTime"] = .text(draft.newStartTime)
            fields["newEndTime"] = .text(draft.newEndTime)
        default: break
        }
        if let note = draft.note?.trimmingCharacters(in: .whitespacesAndNewlines), !note.isEmpty {
            fields["note"] = .string(note)
        }
        try await client.send(.post("schedule/changes", json: JSONBody(fields)))
    }

    func deleteScheduleChange(id: String) async throws {
        try await client.send(.delete("schedule/changes/\(id)"))
    }

    private static func pairFields(_ draft: DeanPairDraft) -> [String: JSONValue] {
        [
            "subject": .string(draft.subject.trimmingCharacters(in: .whitespacesAndNewlines)),
            "dayOfWeek": .int(draft.dayOfWeek),
            "startTime": .string(draft.startTime),
            "endTime": .string(draft.endTime),
            "weekType": .string(draft.weekType),
            "roomId": .text(draft.roomId),
            "teacherId": .text(draft.teacherId),
        ]
    }
}
