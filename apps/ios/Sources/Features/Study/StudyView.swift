import SwiftUI

/// Вкладка «Учёба».
///
/// Состав зависит от роли: студент видит свои оценки, посещаемость, задания и
/// материалы; преподаватель — те же материалы, но вместо своей успеваемости у него
/// отметка посещаемости и проверка работ. Структура при этом одна, как и всюду в
/// оболочке.
struct StudyView: View {
    let role: Role

    private var isTeacher: Bool { role == .teacher }

    var body: some View {
        List {
            Section {
                // Оценки и посещаемость здесь — свои, студенческие (`/gradebook/me`,
                // `/attendance/me`): преподавателю они отвечают 403. Отметка у него —
                // с пары в расписании, журнал — в вебе.
                if !isTeacher {
                    NavigationLink(value: AppRoute.section(.grades)) {
                        Label(
                            String(localized: "study.grades", defaultValue: "Оценки"),
                            systemImage: "graduationcap"
                        )
                    }
                    NavigationLink(value: AppRoute.section(.attendance)) {
                        Label(
                            String(localized: "study.attendance", defaultValue: "Посещаемость"),
                            systemImage: "checkmark.circle"
                        )
                    }
                }
                NavigationLink(value: AppRoute.section(.assignments)) {
                    Label(
                        String(localized: "study.assignments", defaultValue: "Задания"),
                        systemImage: "list.clipboard"
                    )
                }
                NavigationLink(value: AppRoute.section(.materials)) {
                    Label(
                        String(localized: "study.materials", defaultValue: "Материалы"),
                        systemImage: "folder"
                    )
                }
            } footer: {
                if isTeacher {
                    Text(String(
                        localized: "study.teacherHint",
                        defaultValue: "Посещаемость отмечается с пары в расписании, журнал оценок — в веб-версии."
                    ))
                }
            }
            .listRowBackground(Palette.card)
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(AppTab.study.title))
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
