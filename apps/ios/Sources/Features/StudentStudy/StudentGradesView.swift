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
                if !courses.isEmpty {
                    if let overall = StudentGradeMath.overall(courses) {
                        let credits = courses.reduce(0) { $0 + (StudentGradeMath.percent($1.columns) != nil ? ($1.credits ?? 0) : 0) }
                        DashboardMetricsSection(metrics: [
                            DashboardMetric(
                                title: String(localized: "student.grades.overall", defaultValue: "Средний балл"),
                                value: "\(overall)%",
                                symbol: "chart.line.uptrend.xyaxis",
                                tint: StudentGradeMath.tint(overall)
                            ),
                            DashboardMetric(
                                title: String(localized: "student.grades.colCredits", defaultValue: "Кредиты"),
                                value: credits > 0 ? credits.formatted() : nil,
                                symbol: "flag.checkered",
                                tint: Palette.warning
                            ),
                        ])
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
            .screenState(courses.isEmpty) {
                EmptyStateView(
                    title: String(localized: "student.grades.empty", defaultValue: "Оценок пока нет"),
                    symbol: "graduationcap",
                    hint: String(localized: "student.grades.emptyHint", defaultValue: "Опубликованные оценки появятся здесь.")
                )
            }
            .pullToRefresh { reloadToken += 1 }
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

    /// Дисциплина строкой как чат: слева кольцо результата, справа — процент цветом.
    private func row(_ course: CourseGradesDTO) -> some View {
        let percent = StudentGradeMath.percent(course.columns)
        let percentText: String? = percent.map { String($0) + "%" }
        let tint: Color = percent.map { StudentGradeMath.tint($0) } ?? Palette.mutedForeground
        return TelegramStyleRow(
            title: course.subject.name,
            subtitle: subtitle(course),
            meta: percentText,
            metaTint: tint
        ) {
            StudentPercentRing(percent: percent, size: 44)
        } accessory: {
            if percent == nil {
                StatusBadge(text: String(localized: "student.grades.noGrades", defaultValue: "Нет оценок"), tint: Palette.mutedForeground)
            }
        }
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
                VStack(spacing: Spacing.md) {
                    StudentPercentRing(percent: percent, size: 112, lineWidth: 10, showsValue: true)
                    Text(course.subject.name)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Palette.foreground)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: Spacing.sm) {
                        if let credits = course.credits {
                            StatusBadge(text: String(localized: "student.grades.creditsN", defaultValue: "\(String(credits)) кредитов"), tint: Palette.primary)
                        }
                        StatusBadge(text: String(localized: "student.grades.worksN", defaultValue: "Работ: \(String(course.columns.count))"), tint: Palette.mutedForeground)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, Spacing.sm)
                .listRowBackground(Color.clear)
                .accessibilityElement(children: .combine)
            }

            if !course.columns.isEmpty {
                Section(String(localized: "student.grades.works", defaultValue: "Работы")) {
                    ForEach(course.columns) { column in
                        HStack(spacing: Spacing.lg) {
                            RowSymbol(
                                symbol: Self.kindSymbol(column.kind),
                                tint: column.score == nil ? Color.gray : TileTint.indigo,
                                size: 36
                            )
                            VStack(alignment: .leading, spacing: 0) {
                                Text(column.title)
                                    .font(.body.weight(.medium))
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
                                .font(Typography.tabular(.body.weight(.semibold)))
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

    private static func kindSymbol(_ kind: String) -> String {
        switch kind {
        case "LAB": return "flask.fill"
        case "CONTROL": return "checkmark.seal.fill"
        case "EXAM": return "rosette"
        default: return "doc.text.fill"
        }
    }
}

/// Кольцо результата, как в «Активности»: доля от 100 цветом успеваемости. Без
/// оценок — серое пустое кольцо.
struct StudentPercentRing: View {
    let percent: Int?
    var size: CGFloat = 44
    var lineWidth: CGFloat = 4
    var showsValue = false

    var body: some View {
        let tint: Color = percent.map(StudentGradeMath.tint) ?? Palette.mutedForeground
        let fraction: CGFloat = CGFloat(min(max(percent ?? 0, 0), 100)) / 100
        let label: String = percent.map { "\($0)%" } ?? "—"
        let iconSize: CGFloat = size * 0.36
        let inset: CGFloat = lineWidth + Spacing.sm
        ZStack {
            Circle().stroke(tint.opacity(0.18), lineWidth: lineWidth)
            if percent != nil {
                Circle()
                    .trim(from: 0, to: fraction)
                    .stroke(tint, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
            if showsValue {
                Text(verbatim: label)
                    .font(Typography.tabular(.title.weight(.bold)))
                    .foregroundStyle(Palette.foreground)
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                    .padding(inset)
            } else {
                Image(systemName: "graduationcap.fill")
                    .font(.system(size: iconSize, weight: .semibold))
                    .foregroundStyle(tint)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(!showsValue)
    }
}
