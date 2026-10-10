import XCTest

@testable import StudentHub

final class CourseGradesTests: XCTestCase {
    /// Долю считаем только по выставленным оценкам: иначе первая контрольная в
    /// семестре показывала бы «5 из 100» и выглядела бы провалом.
    func testRatioIgnoresUngradedColumns() {
        let course = course(columns: [
            column(id: "1", max: 10, score: 8),
            column(id: "2", max: 90, score: nil),
        ])

        XCTAssertEqual(course.ratio ?? 0, 0.8, accuracy: 0.001)
    }

    func testRatioIsNilWithoutAnyGrade() {
        XCTAssertNil(course(columns: [column(id: "1", max: 10, score: nil)]).ratio)
    }

    func testRatioIsNilWhenMaximumIsZero() {
        XCTAssertNil(course(columns: [column(id: "1", max: 0, score: 0)]).ratio)
    }

    private func course(columns: [CourseGradesDTO.Column]) -> CourseGradesDTO {
        CourseGradesDTO(
            courseId: "c-1",
            subject: CourseGradesDTO.Subject(id: "s-1", name: "Алгоритмы"),
            credits: 5,
            columns: columns
        )
    }

    private func column(id: String, max: Int, score: Double?) -> CourseGradesDTO.Column {
        CourseGradesDTO.Column(id: id, title: "РК\(id)", kind: "CONTROL", maxScore: max, score: score)
    }
}

final class SubmissionStateTests: XCTestCase {
    /// Состояние сдачи — это то, что студент ищет в списке глазами, и оно должно
    /// читаться однозначно.
    func testStatesFollowServerStatus() {
        XCTAssertEqual(SubmissionState.of(assignment(submission: nil)), .notSubmitted)
        XCTAssertEqual(
            SubmissionState.of(assignment(submission: submission(status: "SUBMITTED", score: nil))),
            .submitted
        )
        XCTAssertEqual(
            SubmissionState.of(assignment(submission: submission(status: "RETURNED", score: nil))),
            .returned
        )
        XCTAssertEqual(
            SubmissionState.of(assignment(submission: submission(status: "GRADED", score: 85))),
            .graded(score: 85, max: 100)
        )
    }

    /// Оценка без статуса «проверено» — ещё не оценка: так бывает у возвращённых
    /// работ с предварительным баллом.
    func testScoreWithoutGradedStatusIsNotAGrade() {
        XCTAssertEqual(
            SubmissionState.of(assignment(submission: submission(status: "RETURNED", score: 40))),
            .returned
        )
    }

    private func assignment(submission: AssignmentDTO.Submission?) -> AssignmentDTO {
        AssignmentDTO(
            id: "a-1", title: "Лабораторная 1", description: nil, dueAt: nil,
            maxScore: 100, subject: "Алгоритмы", mySubmission: submission
        )
    }

    private func submission(status: String, score: Int?) -> AssignmentDTO.Submission {
        AssignmentDTO.Submission(
            id: "s-1", status: status, score: score, feedback: nil,
            text: nil, linkUrl: nil, submittedAt: nil
        )
    }
}

@MainActor
final class AttendanceMarkingTests: XCTestCase {
    /// Уже проставленные отметки подставляются: преподаватель чаще исправляет
    /// одну-две, чем отмечает группу заново.
    func testExistingMarksArePrefilled() async {
        let api = StubStudy()
        api.roster = RosterDTO(students: [
            RosterDTO.Student(id: "u-1", firstName: "Аян", lastName: "Серик", status: "ABSENT", note: nil),
            RosterDTO.Student(id: "u-2", firstName: "Дана", lastName: "Ким", status: nil, note: nil),
        ])
        let model = AttendanceMarkingModel(pairID: "p-1", api: api)

        await model.load()

        XCTAssertEqual(model.statuses["u-1"], "ABSENT")
        XCTAssertNil(model.statuses["u-2"])
    }

    /// «Все присутствуют» — самый частый случай, и он должен быть одним нажатием.
    func testMarkAllPresentFillsEveryone() async {
        let api = StubStudy()
        api.roster = RosterDTO(students: [
            RosterDTO.Student(id: "u-1", firstName: nil, lastName: nil, status: "ABSENT", note: nil),
            RosterDTO.Student(id: "u-2", firstName: nil, lastName: nil, status: nil, note: nil),
        ])
        let model = AttendanceMarkingModel(pairID: "p-1", api: api)
        await model.load()

        model.markAllPresent()

        XCTAssertEqual(model.statuses, ["u-1": "PRESENT", "u-2": "PRESENT"])
    }

    func testSaveSendsEveryMark() async {
        let api = StubStudy()
        api.roster = RosterDTO(students: [
            RosterDTO.Student(id: "u-1", firstName: nil, lastName: nil, status: nil, note: nil)
        ])
        let model = AttendanceMarkingModel(pairID: "p-1", api: api)
        await model.load()
        model.set("LATE", for: "u-1")

        await model.save()

        XCTAssertEqual(api.marked.map(\.studentId), ["u-1"])
        XCTAssertEqual(api.marked.map(\.status), ["LATE"])
        XCTAssertNotNil(model.savedAt)
    }
}

private final class StubStudy: StudyFetching, @unchecked Sendable {
    private let lock = NSLock()
    var roster = RosterDTO(students: [])
    private(set) var marked: [AttendanceEntry] = []

    func grades() async throws -> [CourseGradesDTO] { [] }
    func attendance() async throws -> AttendanceSummaryDTO {
        AttendanceSummaryDTO(counts: [:], total: 0, rate: nil, records: [])
    }
    func assignments() async throws -> Page<AssignmentDTO> { Page(items: [], meta: nil) }
    func submit(assignmentID: String) async throws {}
    func saveSubmissionDraft(assignmentID: String, text: String?, linkURL: String?) async throws {}
    func materials() async throws -> Page<MaterialDTO> { Page(items: [], meta: nil) }
    func roster(pairID: String, date: Date) async throws -> RosterDTO { lock.withLock { roster } }
    func mark(pairID: String, date: Date, entries: [AttendanceEntry]) async throws {
        lock.withLock { marked = entries }
    }
}
