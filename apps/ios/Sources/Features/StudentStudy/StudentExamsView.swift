import SwiftUI

/// «Экзамены и сессия» (веб `/exams`): предстоящие и прошедшие, у каждого — дисциплина,
/// формат, дата, аудитория (с переходом на карту), экзаменатор, допуск, балл и итог.
struct StudentExamsView: View {
    @State private var reloadToken = 0
    @State private var tab: Tab = .upcoming

    private enum Tab: Hashable { case upcoming, past }

    var body: some View {
        RemoteContent(reloadToken: reloadToken, load: { try await StudentStudyAPI().exams() }) { exams in
            let now = Date()
            let upcoming = exams.filter { $0.date >= now }.sorted { $0.date < $1.date }
            let past = exams.filter { $0.date < now }.sorted { $0.date > $1.date }
            let current = tab == .upcoming ? upcoming : past
            List {
                if exams.isEmpty {
                    EmptyStateView(
                        title: String(localized: "student.exams.empty", defaultValue: "Экзаменов пока нет"),
                        symbol: "graduationcap",
                        hint: String(localized: "student.exams.emptyHint", defaultValue: "Расписание сессии появится здесь.")
                    )
                    .listRowBackground(Color.clear)
                } else {
                    Picker(String(localized: "student.exams.period", defaultValue: "Период"), selection: $tab) {
                        Text(String(localized: "student.exams.upcoming", defaultValue: "Предстоящие · \(String(upcoming.count))")).tag(Tab.upcoming)
                        Text(String(localized: "student.exams.past", defaultValue: "Прошедшие · \(String(past.count))")).tag(Tab.past)
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())

                    if current.isEmpty {
                        Text(tab == .upcoming
                            ? String(localized: "student.exams.upcomingEmpty", defaultValue: "Предстоящих экзаменов нет")
                            : String(localized: "student.exams.pastEmpty", defaultValue: "Прошедших экзаменов нет"))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                            .frame(maxWidth: .infinity)
                            .listRowBackground(Color.clear)
                    }
                    ForEach(current) { exam in
                        Section {
                            StudentExamCard(exam: exam)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .refreshable { reloadToken += 1 }
        }
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "student.exams.title", defaultValue: "Экзамены и сессия")))
    }
}

private struct StudentExamCard: View {
    let exam: StudentExamDTO

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(alignment: .firstTextBaseline) {
                Text(exam.course.subject.name)
                    .font(Typography.cardTitle)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(3)
                Spacer(minLength: Spacing.md)
                if let score = exam.myResult?.score {
                    Text(verbatim: StudentExamFormat.score(score, max: exam.maxScore))
                        .font(Typography.tabular(Typography.body.weight(.semibold)))
                }
            }
            Label {
                Text(verbatim: DisplayFormat.dateTime(exam.date))
            } icon: {
                Image(systemName: "calendar")
            }
            .font(Typography.meta)
            .foregroundStyle(Palette.mutedForeground)
            Text(verbatim: "\(String(localized: "student.exams.format", defaultValue: "Формат")): \(StudentExamFormat.formatTitle(exam.format))")
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
            if let examiner = exam.examiner, !examiner.name.isEmpty {
                Label(examiner.name, systemImage: "person")
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            }
            if let note = exam.note, !note.isEmpty {
                Text(note)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            }
            HStack(spacing: Spacing.sm) {
                if let result = exam.myResult {
                    if let admitted = result.admitted {
                        StatusBadge(
                            text: admitted
                                ? String(localized: "student.exams.admitted", defaultValue: "Допущен")
                                : String(localized: "student.exams.notAdmitted", defaultValue: "Не допущен"),
                            tint: admitted ? Palette.success : Palette.destructive
                        )
                    }
                    StatusBadge(text: StudentExamFormat.statusTitle(result.status), tint: StudentExamFormat.statusTint(result.status))
                    if let attempt = result.attempt, attempt > 1 {
                        StatusBadge(
                            text: String(localized: "student.exams.attempt", defaultValue: "Попытка \(String(attempt))"),
                            tint: Palette.info
                        )
                    }
                } else {
                    StatusBadge(text: String(localized: "student.exams.admissionPending", defaultValue: "Допуск не определён"), tint: Palette.mutedForeground)
                }
            }
        }
        .padding(.vertical, Spacing.xs)
        .accessibilityElement(children: .combine)

        if let room = exam.room {
            NavigationLink(value: AppRoute.campusRoom(roomID: room.id)) {
                DetailRow(title: String(localized: "student.exams.room", defaultValue: "Аудитория"), value: room.name, symbol: "mappin.and.ellipse")
            }
        }
    }
}
