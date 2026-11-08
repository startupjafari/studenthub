import Foundation

// Контракты раздела «Учёба» (PROJECT.md §8.3). Поля — только те, что показывает
// приложение: лишнее обязательное поле превращает любое изменение на сервере в
// падение разбора у тех, кто не обновился.

// MARK: - Оценки

struct CourseGradesDTO: Decodable, Equatable, Identifiable {
    struct Subject: Decodable, Equatable {
        let id: String
        let name: String
    }

    struct Column: Decodable, Equatable, Identifiable {
        let id: String
        let title: String
        let kind: String
        /// Максимум необязателен — так в журнале (`GradeColumn.maxScore` nullable):
        /// обязательным он ронял разбор всего ответа из-за одной колонки.
        let maxScore: Int?
        let score: Double?
    }

    let courseId: String
    let subject: Subject
    let credits: Int?
    let columns: [Column]

    var id: String { courseId }

    /// Доля набранного от максимума по опубликованным точкам.
    ///
    /// Считаем только там, где оценка уже стоит: иначе первая контрольная в
    /// семестре показывала бы «5 из 100» и выглядела бы провалом.
    /// Точка без максимума в долю не входит: делить её не на что.
    var ratio: Double? {
        let graded = columns.filter { $0.score != nil && $0.maxScore != nil }
        guard !graded.isEmpty else { return nil }
        let max = graded.reduce(0.0) { $0 + Double($1.maxScore ?? 0) }
        guard max > 0 else { return nil }
        return graded.reduce(0.0) { $0 + ($1.score ?? 0) } / max
    }
}

// MARK: - Посещаемость

struct AttendanceSummaryDTO: Decodable, Equatable {
    struct Record: Decodable, Equatable, Identifiable {
        struct Pair: Decodable, Equatable {
            let subject: String?
            let startTime: String?
        }

        let id: String
        let date: Date
        let status: String
        let note: String?
        let pair: Pair?
    }

    let total: Int
    let present: Int
    let late: Int
    let absent: Int
    let excused: Int
    /// Доля не-пропусков в целых процентах (0…100): присутствовал, опоздал, уважительная.
    let rate: Int
    let records: [Record]

    /// Счётчик по статусу: API отдаёт их отдельными полями, а не словарём.
    func count(_ status: String) -> Int {
        switch status {
        case "PRESENT": return present
        case "LATE": return late
        case "ABSENT": return absent
        case "EXCUSED": return excused
        default: return 0
        }
    }
}

struct RosterDTO: Decodable, Equatable {
    struct Student: Decodable, Equatable, Identifiable {
        /// Сервер отдаёт `studentId`, а не `id` (`attendance.service.ts`, roster): с
        /// `id` ростер не разбирался, и отметить посещаемость было нельзя.
        let studentId: String
        let firstName: String?
        let lastName: String?
        let status: String?
        let note: String?

        var id: String { studentId }

        var name: String {
            [lastName, firstName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
        }
    }

    let students: [Student]
}

// MARK: - Задания

struct AssignmentDTO: Decodable, Equatable, Identifiable {
    struct Submission: Decodable, Equatable {
        let id: String
        let status: String
        let score: Int?
        let feedback: String?
        let text: String?
        let linkUrl: String?
        let submittedAt: Date?
        /// Приложенные файлы. Старый сервер поля не отдавал.
        var files: [StudentSubmissionFileDTO]? = nil
        var attemptNumber: Int? = nil
        var gradedAt: Date? = nil
    }

    /// Дисциплина и группа задания — так их отдаёт сервер (`course.subject.name`).
    struct Course: Decodable, Equatable {
        struct Named: Decodable, Equatable {
            let id: String?
            let name: String
        }

        let id: String
        let subject: Named?
        let group: Named?
    }

    let id: String
    let title: String
    let description: String?
    let dueAt: Date?
    let maxScore: Int?
    /// Название дисциплины. Сервер отдаёт его внутри `course`; плоское поле `subject`
    /// читается, если оно есть, — иначе берётся `course.subject.name`.
    let subject: String?
    let mySubmission: Submission?
    /// `DRAFT`, `PUBLISHED`, `CLOSED`.
    var status: String? = nil
    /// `HOMEWORK`, `LAB`, `COURSEWORK`, `PROJECT`, `OTHER`.
    var type: String? = nil
    /// `TEXT`, `FILE`, `LINK`, `MIXED`.
    var submissionType: String? = nil
    var allowLate: Bool? = nil
    var maxAttempts: Int? = nil
    var course: Course? = nil
    var createdBy: PersonRefDTO? = nil

    init(
        id: String,
        title: String,
        description: String?,
        dueAt: Date?,
        maxScore: Int?,
        subject: String?,
        mySubmission: Submission?,
        status: String? = nil,
        type: String? = nil,
        submissionType: String? = nil,
        allowLate: Bool? = nil,
        maxAttempts: Int? = nil,
        course: Course? = nil,
        createdBy: PersonRefDTO? = nil
    ) {
        self.id = id
        self.title = title
        self.description = description
        self.dueAt = dueAt
        self.maxScore = maxScore
        self.subject = subject
        self.mySubmission = mySubmission
        self.status = status
        self.type = type
        self.submissionType = submissionType
        self.allowLate = allowLate
        self.maxAttempts = maxAttempts
        self.course = course
        self.createdBy = createdBy
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, description, dueAt, maxScore, subject, mySubmission
        case status, type, submissionType, allowLate, maxAttempts, course, createdBy
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        dueAt = try container.decodeIfPresent(Date.self, forKey: .dueAt)
        maxScore = try container.decodeIfPresent(Int.self, forKey: .maxScore)
        mySubmission = try container.decodeIfPresent(Submission.self, forKey: .mySubmission)
        status = try container.decodeIfPresent(String.self, forKey: .status)
        type = try container.decodeIfPresent(String.self, forKey: .type)
        submissionType = try container.decodeIfPresent(String.self, forKey: .submissionType)
        allowLate = try container.decodeIfPresent(Bool.self, forKey: .allowLate)
        maxAttempts = try container.decodeIfPresent(Int.self, forKey: .maxAttempts)
        // Вложенные части — без права уронить разбор задания: их форма шире, чем
        // нужно экрану, и расхождение в ней не должно прятать само задание.
        course = try? container.decodeIfPresent(Course.self, forKey: .course)
        createdBy = try? container.decodeIfPresent(PersonRefDTO.self, forKey: .createdBy)
        let flat = (try? container.decodeIfPresent(String.self, forKey: .subject)) ?? nil
        subject = flat ?? course?.subject?.name
    }
}

// MARK: - Материалы

struct MaterialDTO: Decodable, Equatable, Identifiable {
    struct File: Decodable, Equatable, Identifiable {
        let id: String
        let name: String?
        let size: Int?
        let mime: String?
    }

    let id: String
    let title: String
    let description: String?
    let subject: String?
    let createdAt: Date?
    /// Файлы материала. Сервер отдаёт их полем `media`; `files` — прежнее имя, читаем оба.
    let files: [File]?
    /// Внешняя ссылка материала.
    var url: String? = nil
    var teacher: PersonRefDTO? = nil

    private enum CodingKeys: String, CodingKey {
        case id, title, description, subject, createdAt, files, media, url, teacher
    }

    init(
        id: String,
        title: String,
        description: String?,
        subject: String?,
        createdAt: Date?,
        files: [File]?,
        url: String? = nil,
        teacher: PersonRefDTO? = nil
    ) {
        self.id = id
        self.title = title
        self.description = description
        self.subject = subject
        self.createdAt = createdAt
        self.files = files
        self.url = url
        self.teacher = teacher
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        subject = try container.decodeIfPresent(String.self, forKey: .subject)
        createdAt = try container.decodeIfPresent(Date.self, forKey: .createdAt)
        let media = try? container.decodeIfPresent([File].self, forKey: .media)
        let legacy = try? container.decodeIfPresent([File].self, forKey: .files)
        files = (media ?? nil) ?? (legacy ?? nil)
        url = try container.decodeIfPresent(String.self, forKey: .url)
        teacher = try? container.decodeIfPresent(PersonRefDTO.self, forKey: .teacher)
    }
}

// MARK: - Маршруты

protocol StudyFetching: Sendable {
    func grades() async throws -> [CourseGradesDTO]
    func attendance() async throws -> AttendanceSummaryDTO
    func assignments() async throws -> Page<AssignmentDTO>
    func assignment(id: String) async throws -> AssignmentDTO
    func submit(assignmentID: String) async throws
    func saveSubmissionDraft(assignmentID: String, text: String?, linkURL: String?) async throws
    func materials() async throws -> Page<MaterialDTO>
    func roster(pairID: String, date: Date) async throws -> RosterDTO
    func mark(pairID: String, date: Date, entries: [AttendanceEntry]) async throws
}

/// Отметка одного студента на занятии.
struct AttendanceEntry: Encodable, Equatable {
    let studentId: String
    let status: String
    let note: String?
}

struct StudyAPI: StudyFetching {
    private let client: APIClient

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    func grades() async throws -> [CourseGradesDTO] {
        try await client.send(.get("gradebook/me"), as: [CourseGradesDTO].self)
    }

    func attendance() async throws -> AttendanceSummaryDTO {
        try await client.send(.get("attendance/me"), as: AttendanceSummaryDTO.self)
    }

    func assignments() async throws -> Page<AssignmentDTO> {
        try await client.page(.get("assignments", query: [URLQueryItem(name: "limit", value: "50")]), of: AssignmentDTO.self)
    }

    /// Одно задание — для карточки. Искать его в первой странице списка нельзя: из
    /// ссылки открывается и пятьдесят первое.
    func assignment(id: String) async throws -> AssignmentDTO {
        try await client.send(.get("assignments/\(id)"), as: AssignmentDTO.self)
    }

    func submit(assignmentID: String) async throws {
        try await client.send(.post("assignments/\(assignmentID)/submit"))
    }

    /// Пустое поле уходит явным `null`: пропущенный ключ сервер оставляет как было,
    /// и стёртый ответ или ссылка возвращались после сохранения.
    func saveSubmissionDraft(assignmentID: String, text: String?, linkURL: String?) async throws {
        struct Body: Encodable {
            enum CodingKeys: String, CodingKey { case text, linkUrl }

            let text: String?
            let linkUrl: String?

            func encode(to encoder: Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)
                try container.encode(text, forKey: .text)
                try container.encode(linkUrl, forKey: .linkUrl)
            }
        }
        try await client.send(
            Endpoint(
                method: .put,
                path: "assignments/\(assignmentID)/submission",
                body: try JSONCoding.encoder.encode(Body(text: text, linkUrl: linkURL))
            )
        )
    }

    func materials() async throws -> Page<MaterialDTO> {
        try await client.page(.get("materials", query: [URLQueryItem(name: "limit", value: "50")]), of: MaterialDTO.self)
    }

    func roster(pairID: String, date: Date) async throws -> RosterDTO {
        try await client.send(
            .get(
                "attendance/roster",
                query: [
                    URLQueryItem(name: "pairId", value: pairID),
                    URLQueryItem(name: "date", value: Self.day(date)),
                ]
            ),
            as: RosterDTO.self
        )
    }

    func mark(pairID: String, date: Date, entries: [AttendanceEntry]) async throws {
        struct Body: Encodable {
            let pairId: String
            let date: String
            let entries: [AttendanceEntry]
        }
        try await client.send(
            Endpoint(
                method: .put,
                path: "attendance",
                body: try JSONCoding.encoder.encode(
                    Body(pairId: pairID, date: Self.day(date), entries: entries)
                )
            )
        )
    }

    /// Дата занятия — «ГГГГ-ММ-ДД» в местном дне, а не в UTC: занятие в 9 утра в
    /// Алматы не должно оказаться вчерашним.
    private static func day(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}
