import SwiftUI

/// Вкладка «Учёба».
///
/// Состав зависит от роли: студент видит свои оценки, посещаемость, задания и
/// материалы; преподаватель — те же материалы, но вместо своей успеваемости у него
/// отметка посещаемости и проверка работ. Структура при этом одна, как и всюду в
/// оболочке.
struct StudyView: View {
    let role: Role

    @Environment(ViewerProfileModel.self) private var viewer
    @State private var grades: [CourseGradesDTO]?
    @State private var attendance: AttendanceSummaryDTO?
    @State private var assignments: [AssignmentDTO]?

    private var isTeacher: Bool { role == .teacher }

    var body: some View {
        List {
            if !isTeacher {
                Section {
                    AcademicSummaryHeader(profile: viewer.profile)
                }
                DashboardMetricsSection(metrics: metrics)

                let upcoming = AcademicSummary.upcoming(assignments ?? [])
                if !upcoming.isEmpty {
                    Section {
                        ForEach(upcoming) { assignment in
                            NavigationLink(value: AppRoute.assignment(id: assignment.id)) {
                                DeadlineRow(assignment: assignment)
                            }
                        }
                    } header: {
                        Text(String(localized: "study.deadlines", defaultValue: "Ближайшие сроки"))
                    }
                }
            }

            Section {
                NavigationLink(value: AppRoute.section(.subjects)) {
                    IconRow(
                        title: String(localized: "more.subjects", defaultValue: "Дисциплины"),
                        symbol: "book.fill",
                        tint: TileTint.indigo
                    )
                }
                .accessibilityIdentifier("study.subjects")
                NavigationLink(value: AppRoute.section(.assignments)) {
                    IconRow(
                        title: String(localized: "study.assignments", defaultValue: "Задания"),
                        symbol: "list.clipboard.fill",
                        tint: TileTint.orange,
                        value: pendingText
                    )
                }
                NavigationLink(value: AppRoute.section(.materials)) {
                    IconRow(
                        title: String(localized: "study.materials", defaultValue: "Материалы"),
                        symbol: "folder.fill",
                        tint: TileTint.blue
                    )
                }
                NavigationLink(value: AppRoute.section(.events)) {
                    IconRow(
                        title: String(localized: "study.events", defaultValue: "События и календарь"),
                        symbol: "calendar",
                        tint: TileTint.red
                    )
                }
            }

            // Оценки и посещаемость здесь — свои, студенческие (`/gradebook/me`,
            // `/attendance/me`): преподавателю они отвечают 403. Отметка у него —
            // с пары в расписании, журнал — в разделе «Преподавателю».
            if !isTeacher {
                Section {
                    NavigationLink(value: AppRoute.section(.grades)) {
                        IconRow(
                            title: String(localized: "study.grades", defaultValue: "Оценки"),
                            symbol: "graduationcap.fill",
                            tint: TileTint.green,
                            value: grades.flatMap(AcademicSummary.averagePercent).map { "\($0)%" }
                        )
                    }
                    NavigationLink(value: AppRoute.section(.attendance)) {
                        IconRow(
                            title: String(localized: "study.attendance", defaultValue: "Посещаемость"),
                            symbol: "checkmark.circle.fill",
                            tint: TileTint.teal,
                            value: attendance.map { "\($0.rate)%" }
                        )
                    }
                }
            }

            let extras = Workspace.studyExtras(for: role)
            if !extras.isEmpty {
                Section {
                    ForEach(extras) { item in
                        NavigationLink(value: item.route) {
                            IconRow(title: item.title, symbol: item.symbol, tint: item.tint, subtitle: item.hint)
                        }
                    }
                } header: {
                    Text(isTeacher
                        ? String(localized: "study.teacherTools", defaultValue: "Преподавателю")
                        : String(localized: "study.more", defaultValue: "Ещё по учёбе"))
                }
            }
        }
        .dashboardListStyle()
        .navigationTitle(Text(AppTab.study.title))
        .refreshable { await load() }
        .task { await load() }
    }

    /// Три главные цифры плитками, как на обзорах: GPA, средний результат, посещаемость.
    private var metrics: [DashboardMetric] {
        let isPending = grades == nil && attendance == nil
        var items: [DashboardMetric] = []
        if let gpa = viewer.profile?.gpa {
            items.append(DashboardMetric(
                title: String(localized: "study.gpa", defaultValue: "GPA"),
                value: gpa.formatted(.number.precision(.fractionLength(2))),
                symbol: "star.fill",
                tint: TileTint.yellow
            ))
        }
        items.append(DashboardMetric(
            title: String(localized: "study.average", defaultValue: "Средний результат"),
            value: grades.flatMap(AcademicSummary.averagePercent).map { "\($0)%" },
            symbol: "graduationcap.fill",
            tint: TileTint.green,
            route: .section(.grades),
            isPending: isPending
        ))
        items.append(DashboardMetric(
            title: String(localized: "study.attendance", defaultValue: "Посещаемость"),
            value: attendance.map { "\($0.rate)%" },
            symbol: "checkmark.circle.fill",
            tint: TileTint.teal,
            route: .section(.attendance),
            isPending: isPending
        ))
        return items
    }

    private var pendingText: String? {
        guard let count = pendingCount, count > 0 else { return nil }
        return count.formatted()
    }

    /// Сколько заданий ещё не сдано — счётчиком у строки «Задания».
    private var pendingCount: Int? {
        assignments.map { $0.filter { SubmissionState.of($0) == .notSubmitted }.count }
    }

    /// Сводка — подсказка, а не экран: отказ любого запроса прячет свою цифру, не
    /// ломая остальное.
    @MainActor
    private func load() async {
        guard !isTeacher else { return }
        let api = StudyAPI()
        async let gradesValue = try? api.grades()
        async let attendanceValue = try? api.attendance()
        async let tasks = try? api.assignments().items
        async let me: Void = viewer.refresh()
        grades = await gradesValue ?? grades
        attendance = await attendanceValue ?? attendance
        assignments = await tasks ?? assignments
        _ = await me
    }
}

/// Курс, специальность и академический статус — строкой профиля с аватаром, как
/// шапка «Настроек».
private struct AcademicSummaryHeader: View {
    let profile: UserProfileDTO?

    var body: some View {
        HStack(spacing: Spacing.lg) {
            AvatarView(url: profile?.avatarUrl, name: DisplayFormat.name(first: profile?.firstName, last: profile?.lastName), size: 56)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Palette.foreground)
                if let specialty = profile?.specialty, !specialty.isEmpty {
                    Text(specialty)
                        .font(.subheadline)
                        .foregroundStyle(Palette.mutedForeground)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let status = profile?.academicStatus, !status.isEmpty {
                    StatusBadge(text: status, tint: Palette.success)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, Spacing.xs)
        .accessibilityElement(children: .combine)
    }

    private var title: String {
        if let course = profile?.course {
            return String(localized: "study.summary.course", defaultValue: "\(course) курс")
        }
        return String(localized: "study.summary", defaultValue: "Моя учёба")
    }
}

/// Срок задания строкой как в списке чатов: значок, название, дисциплина, срок справа.
private struct DeadlineRow: View {
    let assignment: AssignmentDTO

    var body: some View {
        let overdue: Bool = StudyDue.isPast(assignment.dueAt)
        TelegramStyleRow(
            title: assignment.title,
            subtitle: assignment.subject,
            meta: assignment.dueAt.map { DisplayFormat.relative($0) },
            metaTint: overdue ? Palette.destructive : Palette.mutedForeground
        ) {
            RowSymbol(
                symbol: overdue ? "exclamationmark" : "clock.fill",
                tint: overdue ? TileTint.red : ScheduleSubjectTint.color(for: assignment.subject ?? assignment.title),
                size: 40
            )
        }
    }
}

/// Как показать точку журнала: балл бывает дробным, тип приходит кодом из
/// `GRADE_COLUMN_KINDS`.
enum GradeFormat {
    /// «8,5 / 10» или «8,5», если у точки нет максимума. Дробь не обрезаем: 8,5 — не 8.
    static func score(_ score: Double, max: Int?, locale: Locale = .current) -> String {
        let shown = score.formatted(.number.precision(.fractionLength(0...2)).locale(locale))
        guard let max else { return shown }
        return "\(shown) / \(max)"
    }

    /// Название типа точки — как в вебе (`Gradebook.kind_*`). Незнакомый тип — без подписи.
    static func kindTitle(_ kind: String) -> String? {
        switch kind {
        case "LAB": return String(localized: "study.kindLab", defaultValue: "Лабораторная")
        case "CONTROL": return String(localized: "study.kindControl", defaultValue: "Контрольная")
        case "EXAM": return String(localized: "study.kindExam", defaultValue: "Экзамен")
        case "OTHER": return String(localized: "study.kindOther", defaultValue: "Другое")
        default: return nil
        }
    }
}

enum AttendanceStatus {
    static func title(_ status: String) -> String {
        switch status {
        case "PRESENT": return String(localized: "study.present", defaultValue: "Был")
        case "LATE": return String(localized: "study.late", defaultValue: "Опоздал")
        case "ABSENT": return String(localized: "study.absent", defaultValue: "Пропуск")
        case "EXCUSED": return String(localized: "study.excused", defaultValue: "Уважительная")
        default: return status
        }
    }

    static func symbol(_ status: String) -> String {
        switch status {
        case "ABSENT": return "xmark.circle"
        case "LATE": return "clock"
        case "EXCUSED": return "doc.text"
        default: return "checkmark.circle"
        }
    }

    static func color(_ status: String) -> Color {
        switch status {
        case "ABSENT": return Palette.destructive
        case "LATE": return Palette.warning
        case "EXCUSED": return Palette.info
        default: return Palette.success
        }
    }
}

struct EmptyRow: View {
    let text: String

    var body: some View {
        Text(text)
            .font(Typography.body)
            .foregroundStyle(Palette.mutedForeground)
            .frame(maxWidth: .infinity)
            .padding(.vertical, Spacing.xxl)
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
    }
}

/// Склейка подписей строки: пустые и отсутствующие части пропускаются. Отдельной
/// функцией с явным типом — литерал массива опционалов внутри обобщённого вызова
/// проверяется долго.
enum StudyText {
    static func join(_ parts: [String?], separator: String = " · ") -> String {
        parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: separator)
    }

    /// «Срок: 12 нояб., 18:00».
    static func due(_ date: Date?) -> String? {
        guard let date else { return nil }
        let text: String = date.formatted(date: .abbreviated, time: .shortened)
        return String(localized: "courses.due", defaultValue: "Срок: \(text)")
    }

    static func dateTime(_ date: Date?) -> String? {
        guard let date else { return nil }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}

/// Срок задания: прошёл ли и каким цветом его показать. Отдельно, а не выражением в
/// строке: `??` с `.distantFuture` и сравнением внутри обобщённого инициализатора
/// заметно тормозит проверку типов.
enum StudyDue {
    static func isPast(_ date: Date?, now: Date = Date()) -> Bool {
        guard let date else { return false }
        return date < now
    }

    static func tint(_ date: Date?) -> Color {
        isPast(date) ? Palette.destructive : Palette.mutedForeground
    }
}
