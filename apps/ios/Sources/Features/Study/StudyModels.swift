import Foundation
import Observation

/// Общий скелет экранов «Учёбы».
///
/// Четыре раздела устроены одинаково: сходить в сеть, показать данные, показать
/// отказ. Один тип вместо четырёх почти одинаковых — меньше мест, где состояние
/// загрузки окажется обработано по-разному.
@Observable
final class StudySectionModel<Value> {
    private(set) var value: Value?
    private(set) var isLoading = false
    private(set) var failure: String?

    private let load: @Sendable () async throws -> Value

    init(load: @escaping @Sendable () async throws -> Value) {
        self.load = load
    }

    var isEmptyAfterLoad: Bool { value == nil && !isLoading && failure == nil }

    @MainActor
    func refresh() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            value = try await load()
            failure = nil
        } catch {
            // Данные с прошлого раза не стираем: пустой экран с ошибкой хуже, чем
            // вчерашние оценки с пометкой об ошибке обновления.
            failure = (error as? APIError)?.displayMessage
                ?? String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
        }
    }
}

/// Отметка посещаемости преподавателем.
///
/// Отдельная модель, а не раздел-список: здесь человек меняет данные, и у экрана
/// есть несохранённое состояние, которое нельзя потерять при обновлении.
@Observable
final class AttendanceMarkingModel {
    private(set) var students: [RosterDTO.Student] = []
    private(set) var statuses: [String: String] = [:]
    private(set) var isLoading = false
    private(set) var isSaving = false
    private(set) var failure: String?
    private(set) var savedAt: Date?

    private let api: StudyFetching
    private let pairID: String
    private let date: Date

    init(pairID: String, date: Date = Date(), api: StudyFetching = StudyAPI()) {
        self.pairID = pairID
        self.date = date
        self.api = api
    }

    @MainActor
    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let roster = try await api.roster(pairID: pairID, date: date)
            students = roster.students
            // Уже проставленные отметки подставляем: преподаватель чаще исправляет
            // одну-две, чем отмечает группу заново.
            statuses = Dictionary(
                roster.students.compactMap { student in student.status.map { (student.id, $0) } },
                uniquingKeysWith: { first, _ in first }
            )
            failure = nil
        } catch {
            failure = (error as? APIError)?.displayMessage
                ?? String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
        }
    }

    @MainActor
    func set(_ status: String, for studentID: String) {
        statuses[studentID] = status
    }

    /// По умолчанию отмечаем всех присутствующими: так короче путь в самом частом
    /// случае — пришли все, кроме двоих.
    @MainActor
    func markAllPresent() {
        for student in students {
            statuses[student.id] = "PRESENT"
        }
    }

    @MainActor
    func save() async {
        guard !isSaving, !statuses.isEmpty else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            try await api.mark(
                pairID: pairID,
                date: date,
                entries: statuses.map { AttendanceEntry(studentId: $0.key, status: $0.value, note: nil) }
            )
            savedAt = Date()
            failure = nil
        } catch {
            failure = (error as? APIError)?.displayMessage
                ?? String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
        }
    }
}

/// Состояние сдачи работы — то, что видит студент на карточке задания.
enum SubmissionState: Equatable {
    case notSubmitted
    case submitted
    case graded(score: Int, max: Int?)
    case returned

    static func of(_ assignment: AssignmentDTO) -> SubmissionState {
        guard let submission = assignment.mySubmission else { return .notSubmitted }
        if let score = submission.score, submission.status == "GRADED" {
            return .graded(score: score, max: assignment.maxScore)
        }
        switch submission.status {
        case "RETURNED": return .returned
        case "SUBMITTED": return .submitted
        default: return .notSubmitted
        }
    }

    var title: String {
        switch self {
        case .notSubmitted:
            return String(localized: "study.notSubmitted", defaultValue: "Не сдано")
        case .submitted:
            return String(localized: "study.submitted", defaultValue: "На проверке")
        case .graded(let score, let max):
            let maxPart = max.map { " / \($0)" } ?? ""
            return String(localized: "study.graded", defaultValue: "Оценка \(score)\(maxPart)")
        case .returned:
            return String(localized: "study.returned", defaultValue: "Вернули на доработку")
        }
    }
}
