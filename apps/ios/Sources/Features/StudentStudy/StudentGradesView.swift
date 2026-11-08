import SwiftUI

/// «Мои оценки» (веб `/grades`): средний балл и кредиты плитками, дисциплины с
/// результатом и сортировкой, разбор по работам — в карточке дисциплины.
struct StudentGradesView: View {
    @State private var reloadToken = 0
    @State private var sort: Sort = .server

    private enum Sort: Hashable { case server, subject, credits, works, result }

    var body: some View {
        RemoteContent(reloadToken: reloadToken, load: { try await StudyAPI().grades() }) { courses in
            List {
                if courses.isEmpty {
                    EmptyStateView(
                        title: String(localized: "student.grades.empty", defaultValue: "Оценок пока нет"),
                        symbol: "graduationcap",
                        hint: String(localized: "student.grades.emptyHint", defaultValue: "Опубликованные оценки появятся здесь.")
                    )
                    .listRowBackground(Color.clear)
                } else {
                    if let overall = StudentGradeMath.overall(courses) {
                        Section {
                            StatGrid {
                                StatTile(
                                    title: String(localized: "student.grades.overall", defaultValue: "Средний балл"),
                                    value: "\(overall)%",
                                    symbol: "chart.line.uptrend.xyaxis",
                                    tint: StudentGradeMath.tint(overall)
                                )
                                let credits = courses.reduce(0) { $0 + (StudentGradeMath.percent($1.columns) != nil ? ($1.credits ?? 0) : 0) }
                                if credits > 0 {
                                    StatTile(
                                        title: String(localized: "student.grades.colCredits", defaultValue: "Кредиты"),
                                        value: String(credits),
                                        symbol: "flag.checkered",
                                        tint: Palette.warning
                                    )
                                }
                            }
                            .listRowInsets(EdgeInsets())
                            .listRowBackground(Color.clear)
                        }
                    }

                    Section {
                        ForEach(sorted(courses)) { course in
                            NavigationLink {
                                StudentCourseGradesView(course: course)
                            } label: {
                                row(course)
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .refreshable { reloadToken += 1 }
        }
        .background(Palette.background)
        .navigationTitle(Text(StudentScreen.grades.title))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker(String(localized: "student.sort", defaultValue: "Сортировка"), selection: $sort) {
                        Text(String(localized: "student.sort.default", defaultValue: "По умолчанию")).tag(Sort.server)
                        Text(String(localized: "student.grades.colSubject", defaultValue: "Дисциплина")).tag(Sort.subject)
                        Text(String(localized: "student.grades.colCredits", defaultValue: "Кредиты")).tag(Sort.credits)
                        Text(String(localized: "student.grades.colWorks", defaultValue: "Работ")).tag(Sort.works)
                        Text(String(localized: "student.grades.colResult", defaultValue: "Результат")).tag(Sort.result)
                    }
                } label: {
                    Image(systemName: "arrow.up.arrow.down")
                        .accessibilityLabel(Text(String(localized: "student.sort", defaultValue: "Сортировка")))
                }
            }
        }
    }

    private func sorted(_ courses: [CourseGradesDTO]) -> [CourseGradesDTO] {
        switch sort {
        case .server: return courses
        case .subject: return courses.sorted { $0.subject.name.localizedStandardCompare($1.subject.name) == .orderedAscending }
        case .credits: return courses.sorted { ($0.credits ?? -1) > ($1.credits ?? -1) }
        case .works: return courses.sorted { $0.columns.count > $1.columns.count }
        case .result: return courses.sorted { (StudentGradeMath.percent($0.columns) ?? -1) > (StudentGradeMath.percent($1.columns) ?? -1) }
        }
    }

    private func row(_ course: CourseGradesDTO) -> some View {
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(course.subject.name)
                    .font(Typography.cardTitle)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(3)
                Text(subtitle(course))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            }
            Spacer(minLength: Spacing.md)
            if let percent = StudentGradeMath.percent(course.columns) {
                Text(verbatim: "\(percent)%")
                    .font(Typography.tabular(Typography.body.weight(.semibold)))
                    .foregroundStyle(StudentGradeMath.tint(percent))
            } else {
                StatusBadge(text: String(localized: "student.grades.noGrades", defaultValue: "Нет оценок"), tint: Palette.mutedForeground)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    private func subtitle(_ course: CourseGradesDTO) -> String {
        var parts: [String] = []
        if let credits = course.credits {
            parts.append(String(localized: "student.grades.creditsN", defaultValue: "\(String(credits)) кредитов"))
        }
        parts.append(String(localized: "student.grades.worksN", defaultValue: "Работ: \(String(course.columns.count))"))
        return parts.joined(separator: " · ")
    }
}

/// Разбор дисциплины по работам: процент, полоса, каждая точка с баллом.
private struct StudentCourseGradesView: View {
    let course: CourseGradesDTO

    var body: some View {
        List {
            Section {
                let percent = StudentGradeMath.percent(course.columns)
                HStack {
                    if let credits = course.credits {
                        Text(String(localized: "student.grades.creditsN", defaultValue: "\(String(credits)) кредитов"))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    Spacer()
                    if let percent {
                        Text(verbatim: "\(percent)%")
                            .font(Typography.tabular(Typography.metric))
                            .foregroundStyle(Palette.foreground)
                    } else {
                        StatusBadge(text: String(localized: "student.grades.noGrades", defaultValue: "Нет оценок"), tint: Palette.mutedForeground)
                    }
                }
                if let percent {
                    ProgressView(value: Double(min(max(percent, 0), 100)), total: 100)
                        .tint(StudentGradeMath.tint(percent))
                }
            }

            if !course.columns.isEmpty {
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
                                ?? (column.maxScore.map { "— / \($0)" } ?? "—"))
                                .font(Typography.tabular(Typography.body))
                                .foregroundStyle(column.score == nil ? Palette.mutedForeground : Palette.foreground)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(course.subject.name))
        .navigationBarTitleDisplayMode(.inline)
    }
}
