import SwiftUI

/// «Учебный план» (веб `/study-plan`): кредиты и прогресс плитками, дисциплины по
/// семестрам — кредиты, результат, статус (правило C-F26: итог только у завершённых).
struct StudentStudyPlanView: View {
    @State private var reloadToken = 0
    @State private var sort: Sort = .term

    private enum Sort: Hashable { case term, subject, credits, result, status }

    /// План и признак полноты: без оценок или экзаменов статусы и «кредитов пройдено»
    /// занижены, и экран об этом говорит, а не выдаёт неполное за итог.
    private struct Loaded {
        let plan: [StudentPlanEntry]
        let isComplete: Bool
    }

    var body: some View {
        RemoteContent(reloadToken: reloadToken, load: Self.load) { loaded in
            let plan = loaded.plan
            List {
                if !loaded.isComplete {
                    StaleDataBanner(
                        message: String(localized: "student.partialFailure", defaultValue: "Часть данных не загрузилась")
                    ) {
                        reloadToken += 1
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
                if !plan.isEmpty {
                    let credits = StudentPlan.credits(plan)
                    let progress = credits.total == 0 ? 0 : Int((Double(credits.done) / Double(credits.total) * 100).rounded())
                    Section {
                        StudentPlanProgressCard(done: credits.done, total: credits.total, progress: progress)
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
            .screenState(plan.isEmpty) {
                EmptyStateView(
                    title: String(localized: "student.plan.empty", defaultValue: "Учебный план пуст"),
                    symbol: "list.bullet.rectangle",
                    hint: String(localized: "student.plan.emptyHint", defaultValue: "Дисциплины появятся после назначения деканатом.")
                )
            }
            .pullToRefresh { reloadToken += 1 }
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

    /// Дисциплина плана строкой как чат: кольцо результата, название, кредиты справа,
    /// ниже — семестр и процент, плашка статуса.
    private func row(_ entry: StudentPlanEntry, showTerm: Bool) -> some View {
        let term: String? = showTerm ? Self.termTitle(entry.course.term) : nil
        let percent: String? = entry.percent.map { String($0) + "%" }
        let credits: String? = entry.course.credits.map { Self.creditsText($0) }
        return TelegramStyleRow(
            title: entry.course.subject.name,
            subtitle: StudyText.join([term, percent]),
            meta: credits
        ) {
            StudentPercentRing(percent: entry.percent, size: 40)
        } accessory: {
            StatusBadge(text: entry.status.title, tint: entry.status.tint)
        }
    }

    private static func creditsText(_ value: Int) -> String {
        String(localized: "student.grades.creditsN", defaultValue: "\(String(value)) кредитов")
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

    /// Дисциплины обязательны; оценки и экзамены — уточнение статуса, их отказ план не
    /// прячет, но помечает неполным.
    private static func load() async throws -> Loaded {
        let api = StudentStudyAPI()
        async let coursesValue = api.courses()
        async let gradesValue = try? StudyAPI().grades()
        async let examsValue = try? api.exams()
        let courses = try await coursesValue
        let grades = await gradesValue
        let exams = await examsValue
        return Loaded(
            plan: StudentPlan.build(courses: courses, grades: grades ?? [], exams: exams ?? []),
            isComplete: grades != nil && exams != nil
        )
    }
}

/// Прогресс плана: пройдено кредитов из всего и полоса — одной карточкой вместо двух плиток.
private struct StudentPlanProgressCard: View {
    let done: Int
    let total: Int
    let progress: Int

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: "\(done) / \(total)")
                        .font(Typography.tabular(.title.weight(.bold)))
                        .foregroundStyle(Palette.foreground)
                    Text(String(localized: "student.plan.credits", defaultValue: "кредитов пройдено"))
                        .font(.subheadline)
                        .foregroundStyle(Palette.mutedForeground)
                }
                Spacer(minLength: Spacing.md)
                Text(verbatim: "\(progress)%")
                    .font(Typography.tabular(.title3.weight(.semibold)))
                    .foregroundStyle(Palette.success)
            }
            ProgressView(value: Double(min(max(progress, 0), 100)), total: 100)
                .tint(Palette.success)
                .accessibilityLabel(Text(String(localized: "student.plan.progress", defaultValue: "Прогресс")))
        }
        .padding(.vertical, Spacing.sm)
        .accessibilityElement(children: .combine)
    }
}
