import Foundation

/// Сводка успеваемости — теми же правилами, что «Учёба» в вебе
/// (`views/academic/ui/academic-view.tsx`): иначе средний балл на телефоне и в
/// браузере расходился бы на пару процентов, и человек не знал бы, какому верить.
enum AcademicSummary {
    /// Процент по дисциплине: среднее долей по точкам, где есть и оценка, и максимум.
    static func coursePercent(_ course: CourseGradesDTO) -> Int? {
        let scored = course.columns.compactMap { column -> Double? in
            guard let score = column.score, let max = column.maxScore, max > 0 else { return nil }
            return score / Double(max)
        }
        guard !scored.isEmpty else { return nil }
        return Int((scored.reduce(0, +) / Double(scored.count) * 100).rounded())
    }

    /// Средний процент, взвешенный кредитами; дисциплина без кредитов весит единицу.
    static func averagePercent(_ courses: [CourseGradesDTO]) -> Int? {
        var weightSum = 0.0
        var accumulated = 0.0
        for course in courses {
            guard let percent = coursePercent(course) else { continue }
            let weight = Double(course.credits ?? 1)
            accumulated += Double(percent) * weight
            weightSum += weight
        }
        return weightSum == 0 ? nil : Int((accumulated / weightSum).rounded())
    }

    /// Ближайшие несданные задания со сроком — от раннего к позднему, просроченные
    /// тоже: их сдать важнее всего.
    static func upcoming(_ assignments: [AssignmentDTO], limit: Int = 3) -> [AssignmentDTO] {
        assignments
            .filter { $0.dueAt != nil && SubmissionState.of($0) == .notSubmitted }
            .sorted { ($0.dueAt ?? .distantFuture) < ($1.dueAt ?? .distantFuture) }
            .prefix(limit)
            .map { $0 }
    }
}
