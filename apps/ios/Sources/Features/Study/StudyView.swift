import SwiftUI

/// Вкладка «Учёба».
///
/// Состав зависит от роли: студент видит свои оценки, посещаемость, задания и
/// материалы; преподаватель — те же материалы, но вместо своей успеваемости у него
/// отметка посещаемости и проверка работ. Структура при этом одна, как и всюду в
/// оболочке.
struct StudyView: View {
    let role: Role

    var body: some View {
        List {
            Section {
                NavigationLink(value: AppRoute.section(.grades)) {
                    Label(
                        role == .teacher
                            ? String(localized: "study.gradebook", defaultValue: "Журнал")
                            : String(localized: "study.grades", defaultValue: "Оценки"),
                        systemImage: "graduationcap"
                    )
                }
                NavigationLink(value: AppRoute.section(.attendance)) {
                    Label(
                        String(localized: "study.attendance", defaultValue: "Посещаемость"),
                        systemImage: "checkmark.circle"
                    )
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
                                Text(verbatim: column.kind)
                                    .font(Typography.meta)
                                    .foregroundStyle(Palette.mutedForeground)
                            }
                            Spacer()
                            Text(verbatim: column.score.map { "\(Int($0)) / \(column.maxScore)" }
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
                        Text(verbatim: summary.rate.map { "\(Int($0 * 100))%" } ?? "—")
                            .font(Typography.tabular(Typography.metric))
                            .foregroundStyle(Palette.primary)
                    }
                    ForEach(["PRESENT", "LATE", "ABSENT", "EXCUSED"], id: \.self) { status in
                        HStack {
                            Text(AttendanceStatus.title(status))
                                .font(Typography.body)
                            Spacer()
                            Text(verbatim: String(summary.counts[status] ?? 0))
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
