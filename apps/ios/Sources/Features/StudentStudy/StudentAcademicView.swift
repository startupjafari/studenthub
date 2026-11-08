import SwiftUI

/// «Академический профиль» (веб `/academic`): средний балл, посещаемость, кредиты и
/// статус, успеваемость по дисциплинам, разбивка посещаемости, сессия и задания.
struct StudentAcademicView: View {
    @State private var reloadToken = 0

    var body: some View {
        RemoteContent(reloadToken: reloadToken, load: Self.load) { summary in
            List {
                Section {
                    StatGrid {
                        StatTile(
                            title: String(localized: "student.academic.gpa", defaultValue: "Средний балл"),
                            value: summary.gpa.map { "\($0)%" } ?? "—",
                            symbol: "chart.line.uptrend.xyaxis",
                            tint: summary.gpa.map(StudentGradeMath.tint) ?? Palette.primary
                        )
                        StatTile(
                            title: String(localized: "student.academic.attendance", defaultValue: "Посещаемость"),
                            value: summary.attendance.map { $0.total == 0 ? "—" : "\($0.rate)%" } ?? "—",
                            symbol: "checklist.checked",
                            tint: Palette.info
                        )
                        StatTile(
                            title: String(localized: "student.academic.credits", defaultValue: "Кредиты"),
                            value: summary.credits.total > 0 ? "\(summary.credits.done) / \(summary.credits.total)" : String(summary.credits.done),
                            symbol: "flag.checkered",
                            tint: Palette.warning
                        )
                        StatTile(
                            title: summary.statusCaption,
                            value: StudentAcademicStatus.title(summary.academicStatus),
                            symbol: "graduationcap",
                            tint: Palette.success
                        )
                    }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                }

                Section {
                    if summary.bySubject.isEmpty {
                        Text(String(localized: "student.academic.noGrades", defaultValue: "Оценок пока нет"))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    } else {
                        ForEach(summary.bySubject, id: \.name) { row in
                            ShareBar(
                                title: row.name,
                                fraction: Double(row.percent) / 100,
                                valueText: "\(row.percent)%",
                                tint: StudentGradeMath.tint(row.percent)
                            )
                            .padding(.vertical, 2)
                        }
                    }
                } header: {
                    Text(String(localized: "student.academic.bySubject", defaultValue: "Успеваемость по дисциплинам"))
                } footer: {
                    Text(String(localized: "student.academic.bySubjectHint", defaultValue: "Средний процент по опубликованным оценкам каждой дисциплины"))
                }

                if let attendance = summary.attendance {
                    Section {
                        StatGrid {
                            StatTile(title: AttendanceStatus.title("PRESENT"), value: String(attendance.present), symbol: "checkmark", tint: Palette.success)
                            StatTile(title: AttendanceStatus.title("LATE"), value: String(attendance.late), symbol: "clock", tint: Palette.warning)
                            StatTile(title: AttendanceStatus.title("ABSENT"), value: String(attendance.absent), symbol: "xmark", tint: Palette.destructive)
                            StatTile(title: AttendanceStatus.title("EXCUSED"), value: String(attendance.excused), symbol: "doc.badge.checkmark", tint: Palette.info)
                        }
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                    } header: {
                        Text(String(localized: "student.academic.attendanceBreakdown", defaultValue: "Посещаемость по отметкам"))
                    }
                }

                Section {
                    StatGrid {
                        StatTile(
                            title: String(localized: "student.academic.examsPassed", defaultValue: "Экзаменов сдано"),
                            value: String(summary.examsPassed),
                            symbol: "rosette",
                            tint: Palette.success
                        )
                        StatTile(
                            title: String(localized: "student.academic.examsUpcoming", defaultValue: "Впереди экзаменов"),
                            value: String(summary.examsUpcoming),
                            symbol: "graduationcap",
                            tint: Palette.info
                        )
                        StatTile(
                            title: String(localized: "student.academic.submitted", defaultValue: "Работ на проверке"),
                            value: String(summary.submitted),
                            symbol: "paperplane"
                        )
                        StatTile(
                            title: String(localized: "student.academic.overdue", defaultValue: "Просрочено работ"),
                            value: String(summary.overdue),
                            symbol: "exclamationmark.triangle",
                            tint: Palette.destructive
                        )
                    }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                } header: {
                    Text(String(localized: "student.academic.session", defaultValue: "Сессия и задания"))
                }

                Section {
                    link(.student(.grades), StudentScreen.grades)
                    link(.student(.attendance), StudentScreen.attendance)
                    link(.student(.studyPlan), StudentScreen.studyPlan)
                    link(.student(.exams), StudentScreen.exams)
                    NavigationLink(value: AppRoute.section(.subjects)) {
                        IconRow(title: String(localized: "student.academic.courses", defaultValue: "Дисциплины"), symbol: "book", tint: TileTint.indigo)
                    }
                } header: {
                    Text(String(localized: "student.academic.sections", defaultValue: "Разделы"))
                }
            }
            .listStyle(.insetGrouped)
            .refreshable { reloadToken += 1 }
        }
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "student.academic.title", defaultValue: "Академический профиль")))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func link(_ route: AppRoute, _ screen: StudentScreen) -> some View {
        NavigationLink(value: route) {
            IconRow(title: screen.title, symbol: screen.symbol, tint: TileTint.blue)
        }
    }

    private struct Summary {
        let gpa: Int?
        let attendance: AttendanceSummaryDTO?
        let credits: (total: Int, done: Int)
        let academicStatus: String?
        let enrollmentYear: Int?
        let bySubject: [(name: String, percent: Int)]
        let examsPassed: Int
        let examsUpcoming: Int
        let submitted: Int
        let overdue: Int

        var statusCaption: String {
            let status = String(localized: "student.academic.status", defaultValue: "Статус")
            guard let enrollmentYear else { return status }
            let since = String(localized: "student.academic.since", defaultValue: "с \(String(enrollmentYear))")
            return "\(status) · \(since)"
        }
    }

    /// Профиль, оценки, посещаемость и дисциплины обязательны, как в вебе; экзамены и
    /// задания — только счётчики, их отказ сводку не ломает.
    private static func load() async throws -> Summary {
        let study = StudyAPI()
        let api = StudentStudyAPI()
        async let meValue = api.me()
        async let gradesValue = study.grades()
        async let attendanceValue = study.attendance()
        async let coursesValue = api.courses()
        async let examsValue = try? api.exams()
        async let assignmentsValue = try? api.assignments().items
        let me = try await meValue
        let grades = try await gradesValue
        let attendance = try await attendanceValue
        let courses = try await coursesValue
        let exams = await examsValue ?? []
        let assignments = await assignmentsValue ?? []

        let now = Date()
        let statuses = assignments.map { StudentAssignmentStatus.of($0, now: now) }
        let bySubject = grades
            .compactMap { course in StudentGradeMath.percent(course.columns).map { (name: course.subject.name, percent: $0) } }
            .sorted { $0.percent < $1.percent }
        return Summary(
            gpa: StudentGradeMath.overall(grades),
            attendance: attendance,
            credits: StudentPlan.credits(StudentPlan.build(courses: courses, grades: grades, exams: exams)),
            academicStatus: me["academicStatus"]?.string,
            enrollmentYear: me["enrollmentYear"]?.int,
            bySubject: bySubject,
            examsPassed: exams.filter { $0.myResult?.status == "PASSED" }.count,
            examsUpcoming: exams.filter { $0.date >= now }.count,
            submitted: statuses.filter { $0 == .submitted }.count,
            overdue: statuses.filter { $0 == .overdue }.count
        )
    }
}
