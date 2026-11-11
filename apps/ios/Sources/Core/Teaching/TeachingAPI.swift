import Foundation

// Инструменты преподавателя: обзор дня, журнал оценок, задания и проверка работ,
// посещаемость, экзамены, материалы, свои пары. Контракты —
// `apps/api/src/modules/{me,assignments,gradebook,attendance,exams,materials,schedules,rooms,analytics}`,
// тела запросов — `packages/shared-schemas/src/{assignments,gradebook,exams,materials,schedule}.ts`.

// MARK: - Общее

struct TeachingPersonRef: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let firstName: String?
    let lastName: String?
    var avatarUrl: String? = nil

    var name: String { DisplayFormat.name(first: firstName, last: lastName) }
}

struct TeachingNamedRef: Decodable, Equatable, Hashable {
    let id: String
    let name: String
}

/// Ответ «ссылка на файл»: подписанный адрес хранилища живёт минуты.
private struct TeachingSignedURL: Decodable {
    let url: String
}

// MARK: - Обзор дня

/// `GET /me/today` — одна сводка вместо четырёх запросов (форма — по роли на сервере).
struct TeachingTodayDTO: Decodable {
    struct Event: Decodable, Identifiable {
        let id: String
        let title: String
        let startsAt: Date
        let isRegistered: Bool?
    }

    struct Notification: Decodable, Identifiable {
        let id: String
        let type: String
        let title: String?
        let body: String?
        let createdAt: Date?
        let data: JSONValue?
    }

    let date: String?
    let timezone: String?
    let pairs: [PairDTO]
    let scheduleChanges: [TeachingScheduleChangeDTO]
    let events: [Event]?
    let notifications: [Notification]?
}

/// Очередь проверки: сколько работ ждёт оценки и по каким заданиям.
struct TeachingReviewQueueDTO: Decodable {
    struct Item: Decodable, Identifiable {
        let id: String
        let title: String
        let subject: String?
        let dueAt: Date?
        let pending: Int
    }

    let total: Int
    let items: [Item]
}

// MARK: - Задания

struct TeachingCourseRef: Decodable, Equatable, Hashable {
    let id: String
    let groupId: String?
    let teacherId: String?
    let subject: TeachingNamedRef
    let group: TeachingNamedRef?
}

struct TeachingAssignmentDTO: Decodable, Identifiable, Equatable, Hashable {
    let id: String
    let title: String
    let description: String?
    let type: String
    let submissionType: String
    let status: String
    let maxScore: Int?
    let maxAttempts: Int?
    let allowLate: Bool?
    let publishAt: Date?
    let dueAt: Date?
    let createdAt: Date?
    let course: TeachingCourseRef?
}

struct TeachingSubmissionFileDTO: Decodable, Identifiable, Equatable {
    let id: String
    let name: String?
    let mime: String?
    let size: Int?
}

struct TeachingSubmissionDTO: Decodable, Identifiable, Equatable {
    let id: String
    let status: String
    let text: String?
    let linkUrl: String?
    let files: [TeachingSubmissionFileDTO]?
    let attemptNumber: Int?
    let score: Int?
    let feedback: String?
    let submittedAt: Date?
    let gradedAt: Date?
    let student: TeachingPersonRef
    let gradedBy: TeachingPersonRef?
}

// MARK: - Журнал оценок

struct TeachingGradebookDTO: Decodable {
    struct Column: Decodable, Identifiable, Equatable, Hashable {
        let id: String
        let title: String
        let kind: String
        let maxScore: Int?
        let position: Int
        let published: Bool
    }

    struct Cell: Decodable {
        let columnId: String
        let studentId: String
        let score: Double?
    }

    let courseId: String
    let columns: [Column]
    let students: [TeachingPersonRef]
    let grades: [Cell]
}

struct TeachingGradeEntry: Encodable {
    let studentId: String
    let score: Double?

    func encode(to encoder: Encoder) throws {
        enum Keys: String, CodingKey { case studentId, score }
        var container = encoder.container(keyedBy: Keys.self)
        try container.encode(studentId, forKey: .studentId)
        // `null` — очистить оценку: ключ обязан уйти, иначе zod сочтёт поле пропущенным.
        if let score { try container.encode(score, forKey: .score) } else { try container.encodeNil(forKey: .score) }
    }
}

// MARK: - Экзамены

struct TeachingExamDTO: Decodable, Identifiable, Equatable, Hashable {
    struct Course: Decodable, Equatable, Hashable {
        let id: String
        let teacherId: String?
        let subject: TeachingNamedRef
    }

    let id: String
    let date: Date
    let format: String
    let maxScore: Int?
    let note: String?
    let groupId: String?
    let course: Course
    let group: TeachingNamedRef
    let room: TeachingNamedRef?
    let examiner: TeachingPersonRef?
}

struct TeachingExamRosterDTO: Decodable {
    struct Entry: Decodable, Identifiable, Equatable {
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

struct TeachingExamResultEntry: Encodable {
    let studentId: String
    let admitted: Bool
    let status: String
    let score: Double?
    let note: String?

    func encode(to encoder: Encoder) throws {
        enum Keys: String, CodingKey { case studentId, admitted, status, score, note }
        var container = encoder.container(keyedBy: Keys.self)
        try container.encode(studentId, forKey: .studentId)
        try container.encode(admitted, forKey: .admitted)
        try container.encode(status, forKey: .status)
        if let score { try container.encode(score, forKey: .score) } else { try container.encodeNil(forKey: .score) }
        if let note { try container.encode(note, forKey: .note) } else { try container.encodeNil(forKey: .note) }
    }
}

// MARK: - Материалы

struct TeachingMaterialDTO: Decodable, Identifiable, Equatable {
    struct File: Decodable, Identifiable, Equatable {
        let id: String
        let name: String?
        let mime: String?
        let size: Int?
    }

    let id: String
    let groupId: String?
    let subject: String?
    let title: String
    let description: String?
    let url: String?
    let createdAt: Date?
    let teacher: TeachingPersonRef?
    let media: [File]?
}

// MARK: - Расписание

struct TeachingScheduleContainerDTO: Decodable, Identifiable, Equatable, Hashable {
    let id: String
    let groupId: String
    let name: String
    let isActive: Bool
}

struct TeachingScheduleDetailDTO: Decodable {
    let id: String
    let groupId: String
    let name: String
    let isActive: Bool
    let timezone: String?
    let pairs: [PairDTO]
}

/// Разовое изменение пары. `pair` — сама пара: заменяющий не видит её в своём
/// расписании, и строка изменения строится из неё.
struct TeachingScheduleChangeDTO: Decodable, Identifiable, Equatable {
    struct Pair: Decodable, Equatable {
        let groupId: String?
        let subject: String
        let dayOfWeek: Int?
        let startTime: String
        let endTime: String
        let weekType: String?
        let teacher: TeachingPersonRef?
        let room: TeachingNamedRef?
    }

    let id: String
    let pairId: String
    let type: String
    let date: Date
    let newStartTime: String?
    let newEndTime: String?
    let note: String?
    let newRoom: TeachingNamedRef?
    let newTeacher: TeachingPersonRef?
    let pair: Pair?
}

struct TeachingRoomDTO: Decodable, Identifiable, Equatable, Hashable {
    let id: String
    let name: String
    let building: String?
}

// MARK: - Посещаемость

struct TeachingAttendanceRosterDTO: Decodable {
    struct Student: Decodable, Identifiable, Equatable {
        let studentId: String
        let firstName: String?
        let lastName: String?
        let avatarUrl: String?
        let status: String?
        let note: String?

        var id: String { studentId }
        var name: String { DisplayFormat.name(first: firstName, last: lastName) }
    }

    let pairId: String?
    let subject: String?
    let students: [Student]
}

struct TeachingAttendanceEntry: Encodable {
    let studentId: String
    let status: String
    let note: String?
}

struct TeachingAttendanceQRDTO: Decodable, Equatable {
    let token: String
    /// `data:image/png;base64,…` — готовая картинка кода.
    let qr: String
    let checkinUrl: String?
    let expiresAt: Date
}

// MARK: - API

struct TeachingAPI {
    private let client: APIClient

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    /// Календарная дата «ГГГГ-ММ-ДД» по часам устройства — как веб берёт дату для журнала.
    static func day(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    // MARK: Обзор

    func today() async throws -> TeachingTodayDTO {
        try await client.send(.get("me/today"), as: TeachingTodayDTO.self)
    }

    func reviewQueue(limit: Int = 5) async throws -> TeachingReviewQueueDTO {
        try await client.send(.get("assignments/review-queue", params: ["limit": String(limit)]), as: TeachingReviewQueueDTO.self)
    }

    /// Какие из пар уже отмечены на дату — уходят только id уже полученных пар.
    func markedPairs(date: Date, pairIDs: [String]) async throws -> Set<String> {
        guard !pairIDs.isEmpty else { return [] }
        struct Result: Decodable { let marked: [String] }
        let result = try await client.send(
            .get("attendance/marked", params: ["date": Self.day(date), "pairIds": pairIDs.joined(separator: ",")]),
            as: Result.self
        )
        return Set(result.marked)
    }

    /// Отчёт преподавателя по своим группам — файл как есть.
    func exportReport(period: String, format: String) async throws -> Data {
        try await client.data(.get("analytics/report/export", params: ["period": period, "format": format, "locale": "ru"]))
    }

    // MARK: Задания

    func assignments(_ request: PageRequest, status: String?) async throws -> Page<TeachingAssignmentDTO> {
        var query = request.pageQuery
        if let status { query.append(URLQueryItem(name: "status", value: status)) }
        return try await client.page(.get("assignments", query: query), of: TeachingAssignmentDTO.self)
    }

    func assignment(id: String) async throws -> TeachingAssignmentDTO {
        try await client.send(.get("assignments/\(id)"), as: TeachingAssignmentDTO.self)
    }

    func createAssignment(_ body: JSONBody) async throws {
        try await client.send(.post("assignments", json: body))
    }

    func updateAssignment(id: String, _ body: JSONBody) async throws {
        try await client.send(.patch("assignments/\(id)", json: body))
    }

    /// Опубликовать черновик или снова открыть закрытое задание.
    func publishAssignment(id: String) async throws {
        try await client.send(.post("assignments/\(id)/publish"))
    }

    func closeAssignment(id: String) async throws {
        try await client.send(.post("assignments/\(id)/close"))
    }

    func deleteAssignment(id: String) async throws {
        try await client.send(.delete("assignments/\(id)"))
    }

    func submissions(assignmentID: String) async throws -> [TeachingSubmissionDTO] {
        try await client.send(.get("assignments/\(assignmentID)/submissions"), as: [TeachingSubmissionDTO].self)
    }

    func grade(submissionID: String, score: Int, feedback: String?) async throws {
        var fields: [String: JSONValue] = ["score": .int(score)]
        if let feedback { fields["feedback"] = .string(feedback) }
        try await client.send(.post("submissions/\(submissionID)/grade", json: JSONBody(fields)))
    }

    func returnSubmission(id: String, feedback: String) async throws {
        try await client.send(.post("submissions/\(id)/return", json: JSONBody(["feedback": .string(feedback)])))
    }

    func submissionFileURL(submissionID: String, fileID: String) async throws -> URL {
        try await signed(.get("submissions/\(submissionID)/files/\(fileID)/presigned"))
    }

    // MARK: Журнал оценок

    func gradebook(courseID: String) async throws -> TeachingGradebookDTO {
        try await client.send(.get("gradebook/course/\(courseID)"), as: TeachingGradebookDTO.self)
    }

    func createColumn(_ body: JSONBody) async throws {
        try await client.send(.post("gradebook/columns", json: body))
    }

    func updateColumn(id: String, _ body: JSONBody) async throws {
        try await client.send(.patch("gradebook/columns/\(id)", json: body))
    }

    func setColumnPublished(id: String, published: Bool) async throws {
        try await client.send(.post("gradebook/columns/\(id)/\(published ? "publish" : "unpublish")"))
    }

    func deleteColumn(id: String) async throws {
        try await client.send(.delete("gradebook/columns/\(id)"))
    }

    func saveGrades(columnID: String, entries: [TeachingGradeEntry]) async throws {
        struct Body: Encodable {
            let columnId: String
            let entries: [TeachingGradeEntry]
        }
        try await client.send(.put("gradebook/grades", json: Body(columnId: columnID, entries: entries)))
    }

    // MARK: Экзамены

    func exams(mine: Bool, from: Date?, to: Date?) async throws -> [TeachingExamDTO] {
        try await client.send(
            .get(
                "exams",
                params: [
                    "mine": mine ? "true" : nil,
                    "from": from.map(JSONCoding.isoString),
                    "to": to.map(JSONCoding.isoString),
                ]
            ),
            as: [TeachingExamDTO].self
        )
    }

    func exam(id: String) async throws -> TeachingExamDTO {
        try await client.send(.get("exams/\(id)"), as: TeachingExamDTO.self)
    }

    func createExam(_ body: JSONBody) async throws {
        try await client.send(.post("exams", json: body))
    }

    func updateExam(id: String, _ body: JSONBody) async throws {
        try await client.send(.patch("exams/\(id)", json: body))
    }

    func deleteExam(id: String) async throws {
        try await client.send(.delete("exams/\(id)"))
    }

    func examResults(id: String) async throws -> TeachingExamRosterDTO {
        try await client.send(.get("exams/\(id)/results"), as: TeachingExamRosterDTO.self)
    }

    func saveExamResults(examID: String, entries: [TeachingExamResultEntry]) async throws {
        struct Body: Encodable {
            let examId: String
            let entries: [TeachingExamResultEntry]
        }
        try await client.send(.put("exams/results", json: Body(examId: examID, entries: entries)))
    }

    // MARK: Материалы

    func materials(_ request: PageRequest, mine: Bool) async throws -> Page<TeachingMaterialDTO> {
        var query = request.pageQuery
        if mine { query.append(URLQueryItem(name: "mine", value: "true")) }
        return try await client.page(.get("materials", query: query), of: TeachingMaterialDTO.self)
    }

    func createMaterial(_ body: JSONBody) async throws -> TeachingMaterialDTO {
        try await client.send(.post("materials", json: body), as: TeachingMaterialDTO.self)
    }

    /// Буферная загрузка через API: на телефоне файлы материалов — документы и
    /// презентации, а не многогигабайтные записи.
    func uploadMaterialFile(materialID: String, data: Data, filename: String, mime: String) async throws {
        var form = MultipartForm()
        form.append(data, name: "file", filename: filename, mime: mime)
        try await client.send(.multipart("materials/\(materialID)/files", form: form))
    }

    func materialFileURL(materialID: String, fileID: String) async throws -> URL {
        try await signed(.get("materials/\(materialID)/files/\(fileID)/presigned"))
    }

    func deleteMaterial(id: String) async throws {
        try await client.send(.delete("materials/\(id)"))
    }

    // MARK: Расписание

    func scheduleContainers(groupID: String) async throws -> [TeachingScheduleContainerDTO] {
        try await client.send(.get("schedules", params: ["groupId": groupID]), as: [TeachingScheduleContainerDTO].self)
    }

    func schedule(id: String) async throws -> TeachingScheduleDetailDTO {
        try await client.send(.get("schedules/\(id)"), as: TeachingScheduleDetailDTO.self)
    }

    func createPair(_ body: JSONBody) async throws {
        try await client.send(.post("pairs", json: body))
    }

    func updatePair(id: String, _ body: JSONBody) async throws {
        try await client.send(.patch("pairs/\(id)", json: body))
    }

    func deletePair(id: String) async throws {
        try await client.send(.delete("pairs/\(id)"))
    }

    /// Изменения своих пар (и пар, где он заменяющий) за дни `from…to` включительно.
    func scheduleChanges(from: Date, to: Date) async throws -> [TeachingScheduleChangeDTO] {
        try await client.send(
            .get("schedule/changes", params: ["from": Self.day(from), "to": Self.day(to), "limit": "500"]),
            as: [TeachingScheduleChangeDTO].self
        )
    }

    func rooms(search: String) async throws -> [TeachingRoomDTO] {
        try await client.page(
            .get("rooms", params: ["page": "1", "limit": "20", "search": search.isEmpty ? nil : String(search.prefix(100))]),
            of: TeachingRoomDTO.self
        ).items
    }

    // MARK: Посещаемость

    func attendanceRoster(pairID: String, date: Date) async throws -> TeachingAttendanceRosterDTO {
        try await client.send(
            .get("attendance/roster", params: ["pairId": pairID, "date": Self.day(date)]),
            as: TeachingAttendanceRosterDTO.self
        )
    }

    func saveAttendance(pairID: String, date: Date, entries: [TeachingAttendanceEntry]) async throws {
        struct Body: Encodable {
            let pairId: String
            let date: String
            let entries: [TeachingAttendanceEntry]
        }
        try await client.send(.put("attendance", json: Body(pairId: pairID, date: Self.day(date), entries: entries)))
    }

    func attendanceQR(pairID: String, date: Date) async throws -> TeachingAttendanceQRDTO {
        try await client.send(
            .get("attendance/qr", params: ["pairId": pairID, "date": Self.day(date)]),
            as: TeachingAttendanceQRDTO.self
        )
    }

    // MARK: Внутреннее

    private func signed(_ endpoint: Endpoint) async throws -> URL {
        let result = try await client.send(endpoint, as: TeachingSignedURL.self)
        guard let url = URL(string: result.url) else { throw APIError.malformedResponse(statusCode: 200) }
        return url
    }
}
