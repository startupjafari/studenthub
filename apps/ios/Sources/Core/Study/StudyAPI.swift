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
        let maxScore: Int
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
    var ratio: Double? {
        let graded = columns.filter { $0.score != nil }
        guard !graded.isEmpty else { return nil }
        let max = graded.reduce(0.0) { $0 + Double($1.maxScore) }
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

    let counts: [String: Int]
    let total: Int
    /// Доля не-пропусков: присутствовал, опоздал, уважительная.
    let rate: Double?
    let records: [Record]
}

struct RosterDTO: Decodable, Equatable {
    struct Student: Decodable, Equatable, Identifiable {
        let id: String
        let firstName: String?
        let lastName: String?
        let status: String?
        let note: String?

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
    }

    let id: String
    let title: String
    let description: String?
    let dueAt: Date?
    let maxScore: Int?
    let subject: String?
    let mySubmission: Submission?
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
    let files: [File]?
}

// MARK: - Маршруты

protocol StudyFetching: Sendable {
    func grades() async throws -> [CourseGradesDTO]
    func attendance() async throws -> AttendanceSummaryDTO
    func assignments() async throws -> Page<AssignmentDTO>
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

    func submit(assignmentID: String) async throws {
        try await client.send(.post("assignments/\(assignmentID)/submit"))
    }

    func saveSubmissionDraft(assignmentID: String, text: String?, linkURL: String?) async throws {
        struct Body: Encodable {
            let text: String?
            let linkUrl: String?
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
