import SwiftUI

/// «Экзамены и сессия» (веб `/exams`): предстоящие и прошедшие, у каждого — дисциплина,
/// формат, дата, аудитория (с переходом на карту), экзаменатор, допуск, балл и итог.
struct StudentExamsView: View {
    @State private var reloadToken = 0
    @State private var tab: Tab = .upcoming

    private enum Tab: Hashable { case upcoming, past }

    private static func tabOptions(upcoming: Int, past: Int) -> [(value: Tab?, title: String)] {
        [
            (value: .upcoming, title: String(localized: "student.exams.upcoming", defaultValue: "Предстоящие · \(String(upcoming))")),
            (value: .past, title: String(localized: "student.exams.past", defaultValue: "Прошедшие · \(String(past))")),
        ]
    }

    private var tabSelection: Binding<Tab?> {
        Binding(get: { tab }, set: { tab = $0 ?? .upcoming })
    }

    var body: some View {
        RemoteContent(reloadToken: reloadToken, load: { try await StudentStudyAPI().exams() }) { exams in
            let now = Date()
            let upcoming = exams.filter { $0.date >= now }.sorted { $0.date < $1.date }
            let past = exams.filter { $0.date < now }.sorted { $0.date > $1.date }
            let current = tab == .upcoming ? upcoming : past
            List {
                if !exams.isEmpty {
                    FilterChipsRow(options: Self.tabOptions(upcoming: upcoming.count, past: past.count), selection: tabSelection)

                    ForEach(current) { exam in
                        Section {
                            StudentExamCard(exam: exam)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .screenState(current.isEmpty) {
                if exams.isEmpty {
                    EmptyStateView(
                        title: String(localized: "student.exams.empty", defaultValue: "Экзаменов пока нет"),
                        symbol: "graduationcap",
                        hint: String(localized: "student.exams.emptyHint", defaultValue: "Расписание сессии появится здесь.")
                    )
                } else {
                    EmptyStateView(
                        title: tab == .upcoming
                            ? String(localized: "student.exams.upcomingEmpty", defaultValue: "Предстоящих экзаменов нет")
                            : String(localized: "student.exams.pastEmpty", defaultValue: "Прошедших экзаменов нет"),
                        symbol: "calendar"
                    )
                }
            }
            .refreshable { reloadToken += 1 }
        }
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "student.exams.title", defaultValue: "Экзамены и сессия")))
    }
}

/// Экзамен карточкой-секцией: листок календаря с датой слева, дисциплина, время и
/// формат, экзаменатор; плашки допуска и итога; аудитория — строкой с переходом на карту.
private struct StudentExamCard: View {
    let exam: StudentExamDTO

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(alignment: .top, spacing: Spacing.lg) {
                StudentExamDateTile(date: exam.date)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                        Text(exam.course.subject.name)
                            .font(.body.weight(.semibold))
                            .foregroundStyle(Palette.foreground)
                            .lineLimit(3)
                        Spacer(minLength: Spacing.sm)
                        if let score = exam.myResult?.score {
                            Text(verbatim: StudentExamFormat.score(score, max: exam.maxScore))
                                .font(Typography.tabular(.headline))
                                .foregroundStyle(Palette.foreground)
                        }
                    }
                    Text(verbatim: [
                        exam.date.formatted(date: .omitted, time: .shortened),
                        StudentExamFormat.formatTitle(exam.format),
                    ].joined(separator: " · "))
                    .font(.subheadline)
                    .foregroundStyle(Palette.mutedForeground)
                    if let examiner = exam.examiner, !examiner.name.isEmpty {
                        Label(examiner.name, systemImage: "person")
                            .font(.subheadline)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    if exam.date > Date() {
                        Text(exam.date, format: .relative(presentation: .named))
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(Palette.primary)
                    }
                }
            }
            if let note = exam.note, !note.isEmpty {
                Text(note)
                    .font(.subheadline)
                    .foregroundStyle(Palette.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }
            badges
        }
        .padding(.vertical, Spacing.xs)
        .accessibilityElement(children: .combine)

        if let room = exam.room {
            NavigationLink(value: AppRoute.campusRoom(roomID: room.id)) {
                DetailRow(title: String(localized: "student.exams.room", defaultValue: "Аудитория"), value: room.name, symbol: "mappin.and.ellipse")
            }
        }
    }

    private var badges: some View {
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
}

/// Листок календаря: месяц сверху цветом, число крупно — как значок «Календаря».
struct StudentExamDateTile: View {
    let date: Date

    @ScaledMetric(relativeTo: .title2) private var side: CGFloat = 52

    var body: some View {
        VStack(spacing: 0) {
            Text(date, format: .dateTime.month(.abbreviated))
                .font(.caption2.weight(.bold))
                .textCase(.uppercase)
                .foregroundStyle(Palette.destructive)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(date, format: .dateTime.day())
                .font(Typography.tabular(.title2.weight(.semibold)))
                .foregroundStyle(Palette.foreground)
                .lineLimit(1)
        }
        .frame(width: min(side, 72), height: min(side, 72))
        .background(Palette.muted, in: RoundedRectangle(cornerRadius: Radius.xl, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(date, format: .dateTime.day().month(.wide).year()))
    }
}
