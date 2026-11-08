import SwiftUI

/// «Учебный план» (веб `/study-plan`): кредиты и прогресс плитками, дисциплины по
/// семестрам — кредиты, результат, статус (правило C-F26: итог только у завершённых).
struct StudentStudyPlanView: View {
    @State private var reloadToken = 0
    @State private var sort: Sort = .term

    private enum Sort: Hashable { case term, subject, credits, result, status }

    var body: some View {
        RemoteContent(reloadToken: reloadToken, load: Self.load) { plan in
            List {
                if plan.isEmpty {
                    EmptyStateView(
                        title: String(localized: "student.plan.empty", defaultValue: "Учебный план пуст"),
                        symbol: "list.bullet.rectangle",
                        hint: String(localized: "student.plan.emptyHint", defaultValue: "Дисциплины появятся после назначения деканатом.")
                    )
                    .listRowBackground(Color.clear)
                } else {
                    let credits = StudentPlan.credits(plan)
                    let progress = credits.total == 0 ? 0 : Int((Double(credits.done) / Double(credits.total) * 100).rounded())
                    Section {
                        StatGrid {
                            StatTile(
                                title: String(localized: "student.plan.credits", defaultValue: "кредитов пройдено"),
                                value: "\(credits.done) / \(credits.total)",
                                symbol: "flag.checkered",
                                tint: Palette.warning
                            )
                            StatTile(
                                title: String(localized: "student.plan.progress", defaultValue: "Прогресс"),
                                value: "\(progress)%",
                                symbol: "chart.line.uptrend.xyaxis",
                                tint: Palette.success
                            )
                        }
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                    }

                    if sort == .term {
                        ForEach(Self.terms(plan), id: \.title) { term in
                            Section {
                                ForEach(term.entries) { row($0, showTerm: false) }
                            } header: {
                                Text(term.title)
                            }
                        }
                    } else {
                        Section {
                            ForEach(sorted(plan)) { row($0, showTerm: true) }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .refreshable { reloadToken += 1 }
        }
        .background(Palette.background)
        .navigationTitle(Text(StudentScreen.studyPlan.title))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker(String(localized: "student.sort", defaultValue: "Сортировка"), selection: $sort) {
                        Text(String(localized: "student.plan.colTerm", defaultValue: "Семестр")).tag(Sort.term)
                        Text(String(localized: "student.grades.colSubject", defaultValue: "Дисциплина")).tag(Sort.subject)
                        Text(String(localized: "student.grades.colCredits", defaultValue: "Кредиты")).tag(Sort.credits)
                        Text(String(localized: "student.grades.colResult", defaultValue: "Результат")).tag(Sort.result)
                        Text(String(localized: "student.plan.colStatus", defaultValue: "Статус")).tag(Sort.status)
                    }
                } label: {
                    Image(systemName: "arrow.up.arrow.down")
                        .accessibilityLabel(Text(String(localized: "student.sort", defaultValue: "Сортировка")))
                }
            }
        }
    }

    private func row(_ entry: StudentPlanEntry, showTerm: Bool) -> some View {
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.course.subject.name)
                    .font(Typography.cardTitle)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(3)
                Text(verbatim: [
                    showTerm ? Self.termTitle(entry.course.term) : nil,
                    entry.course.credits.map { String(localized: "student.grades.creditsN", defaultValue: "\(String($0)) кредитов") },
                    entry.percent.map { "\($0)%" },
                ].compactMap { $0 }.joined(separator: " · "))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
            }
            Spacer(minLength: Spacing.md)
            StatusBadge(text: entry.status.title, tint: entry.status.tint)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    private func sorted(_ plan: [StudentPlanEntry]) -> [StudentPlanEntry] {
        switch sort {
        case .term, .subject:
            return plan.sorted { $0.course.subject.name.localizedStandardCompare($1.course.subject.name) == .orderedAscending }
        case .credits:
            return plan.sorted { ($0.course.credits ?? -1) > ($1.course.credits ?? -1) }
        case .result:
            return plan.sorted { ($0.percent ?? -1) > ($1.percent ?? -1) }
        case .status:
            return plan.sorted { $0.status.title.localizedStandardCompare($1.status.title) == .orderedAscending }
        }
    }

    private static func termTitle(_ term: StudentCourseDTO.Term?) -> String {
        term?.name ?? String(localized: "student.plan.noTerm", defaultValue: "Без семестра")
    }

    /// Семестры в учебном порядке (по номеру), дисциплины внутри — по алфавиту.
    private static func terms(_ plan: [StudentPlanEntry]) -> [(title: String, entries: [StudentPlanEntry])] {
        struct Term {
            let order: Int
            let title: String
            let entries: [StudentPlanEntry]
        }
        let groups = Dictionary(grouping: plan) { termTitle($0.course.term) }
        var terms: [Term] = []
        for (title, entries) in groups {
            let sorted = entries.sorted { lhs, rhs in
                lhs.course.subject.name.localizedStandardCompare(rhs.course.subject.name) == .orderedAscending
            }
            let order: Int = entries.first?.course.term?.number ?? 9999
            terms.append(Term(order: order, title: title, entries: sorted))
        }
        terms.sort { lhs, rhs in
            lhs.order == rhs.order ? lhs.title < rhs.title : lhs.order < rhs.order
        }
        return terms.map { (title: $0.title, entries: $0.entries) }
    }

    /// Дисциплины обязательны; оценки и экзамены — уточнение статуса, их отказ план не прячет.
    private static func load() async throws -> [StudentPlanEntry] {
        let api = StudentStudyAPI()
        async let coursesValue = api.courses()
        async let gradesValue = try? StudyAPI().grades()
        async let examsValue = try? api.exams()
        let courses = try await coursesValue
        return StudentPlan.build(courses: courses, grades: await gradesValue ?? [], exams: await examsValue ?? [])
    }
}
