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
                    AcademicSummaryCard(
                        profile: viewer.profile,
                        averagePercent: grades.flatMap(AcademicSummary.averagePercent),
                        attendanceRate: attendance?.rate
                    )
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                }

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
                    .listRowBackground(Palette.card)
                }
            }

            Section {
                NavigationLink(value: AppRoute.section(.subjects)) {
                    IconRow(
                        title: String(localized: "more.subjects", defaultValue: "Дисциплины"),
                        symbol: "book",
                        tint: TileTint.indigo
                    )
                }
                .accessibilityIdentifier("study.subjects")
                // Оценки и посещаемость здесь — свои, студенческие (`/gradebook/me`,
                // `/attendance/me`): преподавателю они отвечают 403. Отметка у него —
                // с пары в расписании, журнал — в вебе.
                if !isTeacher {
                    NavigationLink(value: AppRoute.section(.grades)) {
                        IconRow(
                            title: String(localized: "study.grades", defaultValue: "Оценки"),
                            symbol: "graduationcap",
                            tint: TileTint.green,
                            value: grades.flatMap(AcademicSummary.averagePercent).map { "\($0)%" }
                        )
                    }
                    NavigationLink(value: AppRoute.section(.attendance)) {
                        IconRow(
                            title: String(localized: "study.attendance", defaultValue: "Посещаемость"),
                            symbol: "checkmark.circle",
                            tint: TileTint.teal,
                            value: attendance.map { "\($0.rate)%" }
                        )
                    }
                }
                NavigationLink(value: AppRoute.section(.assignments)) {
                    IconRow(
                        title: String(localized: "study.assignments", defaultValue: "Задания"),
                        symbol: "list.clipboard",
                        tint: TileTint.orange
                    )
                }
                NavigationLink(value: AppRoute.section(.materials)) {
                    IconRow(
                        title: String(localized: "study.materials", defaultValue: "Материалы"),
                        symbol: "folder",
                        tint: TileTint.blue
                    )
                }
                NavigationLink(value: AppRoute.section(.events)) {
                    IconRow(
                        title: String(localized: "study.events", defaultValue: "События и календарь"),
                        symbol: "calendar.badge.clock",
                        tint: TileTint.red
                    )
                }
            }
            .listRowBackground(Palette.card)

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
                .listRowBackground(Palette.card)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(AppTab.study.title))
        .refreshable { await load() }
        .task { await load() }
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

/// Курс, группа, специальность, статус и две главные цифры — компактно, без
/// таблиц веба.
private struct AcademicSummaryCard: View {
    let profile: UserProfileDTO?
    let averagePercent: Int?
    let attendanceRate: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(Typography.cardTitle)
                    .foregroundStyle(Palette.foreground)
                if let specialty = profile?.specialty, !specialty.isEmpty {
                    Text(specialty)
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
                if let status = profile?.academicStatus, !status.isEmpty {
                    Label(status, systemImage: "checkmark.seal.fill")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Palette.success)
                }
            }
            HStack(spacing: Spacing.lg) {
                if let gpa = profile?.gpa {
                    metric(gpa.formatted(.number.precision(.fractionLength(2))), String(localized: "study.gpa", defaultValue: "GPA"))
                }
                if let averagePercent {
                    metric("\(averagePercent)%", String(localized: "study.average", defaultValue: "Средний результат"))
                }
                if let attendanceRate {
                    metric("\(attendanceRate)%", String(localized: "study.attendance", defaultValue: "Посещаемость"))
                }
            }
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardSurface()
    }

    private var title: String {
        if let course = profile?.course {
            return String(localized: "study.summary.course", defaultValue: "\(course) курс")
        }
        return String(localized: "study.summary", defaultValue: "Моя учёба")
    }

    private func metric(_ value: String, _ title: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: value)
                .font(Typography.metric)
                .foregroundStyle(Palette.foreground)
            Text(title)
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

private struct DeadlineRow: View {
    let assignment: AssignmentDTO

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(assignment.title)
                .font(Typography.body)
                .foregroundStyle(Palette.foreground)
            HStack(spacing: Spacing.md) {
                if let subject = assignment.subject, !subject.isEmpty {
                    Text(subject).lineLimit(1)
                }
                if let due = assignment.dueAt {
                    let overdue = due < Date()
                    Label {
                        Text(due, format: .relative(presentation: .named))
                    } icon: {
                        Image(systemName: overdue ? "exclamationmark.circle.fill" : "clock")
                    }
                    .foregroundStyle(overdue ? Palette.destructive : Palette.mutedForeground)
                }
            }
            .font(Typography.meta)
            .foregroundStyle(Palette.mutedForeground)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Оценки студента: дисциплины с долей набранного и раскрытием по точкам.
struct GradesView: View {
    @State private var model = StudySectionModel<[CourseGradesDTO]> {
        try await StudyAPI().grades()
    }

    var body: some View {
        List {
            if let failure = model.failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            ForEach(model.value ?? []) { course in
                Section {
                    ForEach(course.columns) { column in
                        HStack {
                            VStack(alignment: .leading, spacing: 0) {
                                Text(column.title)
                                    .font(Typography.body)
                                    .foregroundStyle(Palette.foreground)
                                if let kind = GradeFormat.kindTitle(column.kind) {
                                    Text(kind)
                                        .font(Typography.meta)
                                        .foregroundStyle(Palette.mutedForeground)
                                }
                            }
                            Spacer()
                            Text(verbatim: column.score.map { GradeFormat.score($0, max: column.maxScore) }
                                ?? String(localized: "study.noScore", defaultValue: "—"))
                                .font(Typography.tabular(Typography.body))
                                .foregroundStyle(column.score == nil ? Palette.mutedForeground : Palette.foreground)
                        }
                    }
                } header: {
                    HStack {
                        Text(course.subject.name)
                        Spacer()
                        if let ratio = course.ratio {
                            Text(verbatim: "\(Int(ratio * 100))%")
                                .font(Typography.tabular(Typography.meta))
                        }
                    }
                }
                .listRowBackground(Palette.card)
            }

            if model.value?.isEmpty ?? false {
                EmptyRow(text: String(localized: "study.noGrades", defaultValue: "Оценок пока нет"))
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "study.grades", defaultValue: "Оценки")))
        .refreshable { await model.refresh() }
        .task { await model.refresh() }
    }
}

/// Посещаемость студента: доля сверху, журнал занятий ниже.
struct AttendanceView: View {
    @State private var model = StudySectionModel<AttendanceSummaryDTO> {
        try await StudyAPI().attendance()
    }

    var body: some View {
        List {
            if let failure = model.failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            if let summary = model.value {
                Section {
                    HStack {
                        Text(String(localized: "study.attendanceRate", defaultValue: "Посещаемость"))
                            .font(Typography.body)
                        Spacer()
                        Text(verbatim: summary.total == 0 ? "—" : "\(summary.rate)%")
                            .font(Typography.tabular(Typography.metric))
                            .foregroundStyle(Palette.primary)
                    }
                    ForEach(["PRESENT", "LATE", "ABSENT", "EXCUSED"], id: \.self) { status in
                        HStack {
                            Text(AttendanceStatus.title(status))
                                .font(Typography.body)
                            Spacer()
                            Text(verbatim: String(summary.count(status)))
                                .font(Typography.tabular(Typography.body))
                                .foregroundStyle(Palette.mutedForeground)
                        }
                    }
                }
                .listRowBackground(Palette.card)

                Section {
                    ForEach(summary.records) { record in
                        HStack {
                            VStack(alignment: .leading, spacing: 0) {
                                Text(record.pair?.subject ?? String(localized: "study.lesson", defaultValue: "Занятие"))
                                    .font(Typography.body)
                                Text(verbatim: record.date.formatted(date: .abbreviated, time: .omitted))
                                    .font(Typography.meta)
                                    .foregroundStyle(Palette.mutedForeground)
                            }
                            Spacer()
                            Text(AttendanceStatus.title(record.status))
                                .font(Typography.meta)
                                .foregroundStyle(AttendanceStatus.color(record.status))
                        }
                    }
                } header: {
                    Text(String(localized: "study.attendanceLog", defaultValue: "Занятия"))
                }
                .listRowBackground(Palette.card)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "study.attendance", defaultValue: "Посещаемость")))
        .refreshable { await model.refresh() }
        .task { await model.refresh() }
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
