import SwiftUI

// Правила учёбы, общие для нескольких экранов области: статус задания глазами студента,
// процент по дисциплине, статус дисциплины в учебном плане, подписи экзаменов. Считаются
// ровно как в вебе (`entities/assignment/lib/status.ts`, `entities/course/lib/plan-status.ts`):
// разойдись правило — и в приложении и в браузере окажутся разные цифры.

// MARK: - Статус задания

/// Статус задания для студента: статус сдачи плюс срок.
enum StudentAssignmentStatus: String, CaseIterable, Hashable {
    case notStarted, draft, submitted, graded, returned, overdue, closed

    static func of(_ assignment: AssignmentDTO, now: Date = Date()) -> StudentAssignmentStatus {
        let submission = assignment.mySubmission
        if submission?.status == "SUBMITTED" { return .submitted }
        if submission?.status == "GRADED" { return .graded }
        // Закрытое задание работ больше не принимает: сдать его уже нельзя (409).
        if assignment.status == "CLOSED" { return .closed }
        if submission?.status == "RETURNED" { return .returned }
        let overdue = assignment.dueAt.map { $0 < now } == true && assignment.allowLate != true
        if submission != nil { return overdue ? .overdue : .draft }
        return overdue ? .overdue : .notStarted
    }

    var title: String {
        switch self {
        case .notStarted: return String(localized: "student.assignment.status.notStarted", defaultValue: "Не начато")
        case .draft: return String(localized: "student.assignment.status.draft", defaultValue: "Черновик")
        case .submitted: return String(localized: "student.assignment.status.submitted", defaultValue: "На проверке")
        case .graded: return String(localized: "student.assignment.status.graded", defaultValue: "Проверено")
        case .returned: return String(localized: "student.assignment.status.returned", defaultValue: "Требуются исправления")
        case .overdue: return String(localized: "student.assignment.status.overdue", defaultValue: "Просрочено")
        case .closed: return String(localized: "student.assignment.status.closed", defaultValue: "Приём закрыт")
        }
    }

    var tint: Color {
        switch self {
        case .notStarted, .closed: return Palette.mutedForeground
        case .draft: return Palette.foreground
        case .submitted: return Palette.info
        case .graded: return Palette.success
        case .returned: return Palette.warning
        case .overdue: return Palette.destructive
        }
    }

    /// Можно ли править и отправлять работу. Срок держит только первую сдачу:
    /// возвращённую на доработку сервер принимает и после него.
    static func canEdit(_ assignment: AssignmentDTO, now: Date = Date()) -> Bool {
        if let status = assignment.status, status != "PUBLISHED" { return false }
        let submission = assignment.mySubmission?.status
        if submission == "RETURNED" { return true }
        if let submission, submission != "DRAFT" { return false }
        let late = assignment.dueAt.map { $0 < now } == true && assignment.allowLate != true
        return !late
    }
}

// MARK: - Проценты

enum StudentGradeMath {
    /// Процент по дисциплине: среднее «балл / максимум» по точкам с баллом и максимумом.
    static func percent(_ columns: [CourseGradesDTO.Column]) -> Int? {
        let ratios = columns.compactMap { column -> Double? in
            guard let score = column.score, let max = column.maxScore, max > 0 else { return nil }
            return score / Double(max)
        }
        guard !ratios.isEmpty else { return nil }
        return Int((ratios.reduce(0, +) / Double(ratios.count) * 100).rounded())
    }

    /// Средний процент по дисциплинам с весом кредитов (без кредитов — вес 1).
    static func overall(_ courses: [CourseGradesDTO]) -> Int? {
        var weight = 0.0
        var sum = 0.0
        for course in courses {
            guard let percent = percent(course.columns) else { continue }
            let credits = Double(course.credits ?? 1)
            sum += Double(percent) * credits
            weight += credits
        }
        return weight == 0 ? nil : Int((sum / weight).rounded())
    }

    /// Цвет доли: от 75 — хорошо, от 50 — на грани, ниже — плохо.
    static func tint(_ percent: Int) -> Color {
        percent >= 75 ? Palette.success : (percent >= 50 ? Palette.warning : Palette.destructive)
    }
}

// MARK: - Учебный план

/// Статус дисциплины в учебном плане (правило C-F26 веба).
enum StudentPlanStatus: String, Hashable, CaseIterable {
    case completed, studying, upcoming, notPassed, noResult

    var title: String {
        switch self {
        case .completed: return String(localized: "student.plan.status.completed", defaultValue: "Завершено")
        case .studying: return String(localized: "student.plan.status.studying", defaultValue: "Изучается")
        case .upcoming: return String(localized: "student.plan.status.upcoming", defaultValue: "Предстоит")
        case .notPassed: return String(localized: "student.plan.status.notPassed", defaultValue: "Не зачтено")
        case .noResult: return String(localized: "student.plan.status.noResult", defaultValue: "Нет итога")
        }
    }

    var tint: Color {
        switch self {
        case .completed: return Palette.success
        case .studying: return Palette.info
        case .upcoming, .noResult: return Palette.mutedForeground
        case .notPassed: return Palette.destructive
        }
    }
}

struct StudentPlanEntry: Identifiable, Equatable {
    let course: StudentCourseDTO
    /// Процент справочно — по всем опубликованным оценкам; статус считается отдельно.
    let percent: Int?
    let status: StudentPlanStatus

    var id: String { course.id }
}

enum StudentPlan {
    static let passThreshold = 50

    /// Курсы плана с процентом и статусом на день `today` («ГГГГ-ММ-ДД»).
    static func build(
        courses: [StudentCourseDTO],
        grades: [CourseGradesDTO],
        exams: [StudentExamDTO],
        today: String = StudentPlan.today()
    ) -> [StudentPlanEntry] {
        let gradesByCourse = Dictionary(grades.map { ($0.courseId, $0.columns) }, uniquingKeysWith: { first, _ in first })
        var examsByCourse: [String: [(date: Date, status: String)]] = [:]
        for exam in exams {
            guard let result = exam.myResult else { continue }
            examsByCourse[exam.course.id, default: []].append((exam.date, result.status))
        }
        return courses.map { course in
            let columns = gradesByCourse[course.id] ?? []
            return StudentPlanEntry(
                course: course,
                percent: StudentGradeMath.percent(columns),
                status: status(term: course.term, today: today, columns: columns, exams: examsByCourse[course.id] ?? [])
            )
        }
    }

    /// Кредиты плана: всего и набрано — только по завершённым дисциплинам.
    static func credits(_ plan: [StudentPlanEntry]) -> (total: Int, done: Int) {
        plan.reduce((0, 0)) { acc, entry in
            let credits = entry.course.credits ?? 0
            return (acc.0 + credits, acc.1 + (entry.status == .completed ? credits : 0))
        }
    }

    static func today(_ date: Date = Date()) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    private enum Phase { case current, past, future }

    /// Где семестр относительно сегодня — по датам, а не по одному `isActive`.
    private static func phase(_ term: StudentCourseDTO.Term, today: String) -> Phase {
        if term.isActive == true { return .current }
        guard let starts = term.startsOn?.prefix(10), let ends = term.endsOn?.prefix(10) else { return .past }
        if today < String(starts) { return .future }
        if today > String(ends) { return .past }
        return .current
    }

    private static func status(
        term: StudentCourseDTO.Term?,
        today: String,
        columns: [CourseGradesDTO.Column],
        exams: [(date: Date, status: String)]
    ) -> StudentPlanStatus {
        // Не `phase`: локальное имя совпадало бы с функцией, и Swift 6.1 (Xcode 16)
        // искал `map` у жестов SwiftUI вместо `Optional`.
        let termPhase = term.map { Self.phase($0, today: today) }
        if termPhase == .current { return .studying }
        if termPhase == .future { return .upcoming }
        // Итог экзамена — последний по дате, не «назначен».
        if let final = exams.filter({ $0.status != "SCHEDULED" }).max(by: { $0.date < $1.date }) {
            return final.status == "PASSED" ? .completed : .notPassed
        }
        if let examPercent = StudentGradeMath.percent(columns.filter { $0.kind == "EXAM" }) {
            return examPercent >= passThreshold ? .completed : .notPassed
        }
        let percent = StudentGradeMath.percent(columns)
        if termPhase == nil { return percent == nil ? .upcoming : .studying }
        guard let percent else { return .noResult }
        return percent >= passThreshold ? .completed : .notPassed
    }
}

// MARK: - Экзамены

enum StudentExamFormat {
    static func statusTitle(_ status: String) -> String {
        switch status {
        case "SCHEDULED": return String(localized: "student.exam.status.scheduled", defaultValue: "Запланирован")
        case "PASSED": return String(localized: "student.exam.status.passed", defaultValue: "Сдан")
        case "FAILED": return String(localized: "student.exam.status.failed", defaultValue: "Не сдан")
        case "ABSENT": return String(localized: "student.exam.status.absent", defaultValue: "Неявка")
        case "RETAKE": return String(localized: "student.exam.status.retake", defaultValue: "Пересдача")
        default: return status
        }
    }

    static func statusTint(_ status: String) -> Color {
        switch status {
        case "PASSED": return Palette.success
        case "FAILED": return Palette.destructive
        case "ABSENT": return Palette.warning
        case "RETAKE": return Palette.info
        default: return Palette.mutedForeground
        }
    }

    /// Формат экзамена. Незнакомый — «Другое», как в вебе.
    static func formatTitle(_ format: String?) -> String {
        switch format {
        case "ORAL": return String(localized: "student.exam.format.oral", defaultValue: "Устный")
        case "WRITTEN": return String(localized: "student.exam.format.written", defaultValue: "Письменный")
        case "TEST": return String(localized: "student.exam.format.test", defaultValue: "Тест")
        case "PROJECT": return String(localized: "student.exam.format.project", defaultValue: "Проект")
        default: return String(localized: "student.exam.format.other", defaultValue: "Другое")
        }
    }

    /// «85 / 100» или «85»; дробь не обрезаем.
    static func score(_ score: Double, max: Int?) -> String {
        let shown = score.formatted(.number.precision(.fractionLength(0...2)))
        return max.map { "\(shown) / \($0)" } ?? shown
    }
}

// MARK: - Учебный статус

enum StudentAcademicStatus {
    /// Код статуса из справочника или кода импорта; `nil` — строка вне справочника.
    static func code(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let key = raw.trimmingCharacters(in: .whitespaces).lowercased().replacingOccurrences(of: "переведен", with: "переведён")
        let table: [String: String] = [
            "обучающийся": "ACTIVE", "active": "ACTIVE",
            "академический отпуск": "ACADEMIC_LEAVE", "academic_leave": "ACADEMIC_LEAVE",
            "выпускник": "GRADUATED", "graduated": "GRADUATED",
            "отчислен": "EXPELLED", "expelled": "EXPELLED",
            "переведён": "TRANSFERRED", "transferred": "TRANSFERRED",
        ]
        return table[key]
    }

    /// Подпись статуса: пустой — «Обучается», незнакомый — как пришёл.
    static func title(_ raw: String?) -> String {
        guard let raw, !raw.isEmpty else {
            return String(localized: "student.academicStatus.active", defaultValue: "Обучается")
        }
        switch code(raw) {
        case "ACTIVE": return String(localized: "student.academicStatus.active", defaultValue: "Обучается")
        case "ACADEMIC_LEAVE": return String(localized: "student.academicStatus.leave", defaultValue: "Академический отпуск")
        case "EXPELLED": return String(localized: "student.academicStatus.expelled", defaultValue: "Отчислен")
        case "GRADUATED": return String(localized: "student.academicStatus.graduated", defaultValue: "Выпускник")
        case "TRANSFERRED": return String(localized: "student.academicStatus.transferred", defaultValue: "Переведён")
        default: return raw
        }
    }
}
