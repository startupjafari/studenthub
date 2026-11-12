import SwiftUI

/// «Главная» студента и старосты — личная точка входа, а не сводка всего подряд.
///
/// Сверху то, ради чего открывают приложение: пары сегодня и частые действия. Ниже —
/// что требует внимания: сроки заданий, непрочитанное, заявки в работе, ближайшие события.
/// Блок без данных не рисуется вовсе: пустые рамки на главной — шум. Каждый запрос
/// независим: упал один — остальные показываются. Расписание читается из базы и
/// работает без связи.
struct StudentHomeView: View {
    @Environment(ViewerProfileModel.self) private var viewer
    @State private var schedule = ScheduleModel()
    @State private var home = HomeModel()
    @State private var grades: [CourseGradesDTO]?
    @State private var attendance: AttendanceSummaryDTO?
    @State private var assignments: [AssignmentDTO]?
    @State private var applications: [ApplicationDTO]?
    @State private var notifications: [NotificationDTO]?
    @State private var hasLoaded = false
    /// Не ответил ни один сетевой блок: на экране только расписание из базы, и об этом
    /// стоит сказать, а не делать вид, что всё свежее. Не ответила часть — тоже говорим:
    /// иначе упавшие задания выглядели бы как «сроков нет».
    @State private var failure: String?

    var body: some View {
        List {
            if let failure {
                Section {
                    StaleDataBanner(message: failure) { await load() }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
            }
            todaySection
            DashboardShortcutsSection(shortcuts: shortcuts)
            DashboardMetricsSection(
                metrics: metrics,
                title: String(localized: "home.student.progress", defaultValue: "Успеваемость")
            )
            deadlinesSection
            notificationsSection
            applicationsSection
            eventsSection
        }
        .dashboardListStyle()
        .navigationTitle(Text(AppTab.home.title))
        .pullToRefresh {
            async let pairs: Void = schedule.refresh()
            async let rest: Void = load()
            async let me: Void = viewer.refresh()
            _ = await (pairs, rest, me)
        }
        .task {
            schedule.start()
            // Вкладка появляется снова после каждого «назад»: данные главной меняются
            // редко, повторно грузим жестом обновления и при возврате из уведомлений.
            guard !hasLoaded else { return }
            async let pairs: Void = schedule.refresh()
            async let rest: Void = load()
            _ = await (pairs, rest)
        }
        .onAppear {
            // Вернулись из уведомлений или заявки — показанное могло устареть.
            if hasLoaded { Task { await refreshAttention() } }
        }
    }

    // MARK: Сегодня

    /// Пары сегодня, которые ещё не закончились: идущая — первой и с отметкой.
    @ViewBuilder
    private var todaySection: some View {
        let now = Date()
        let clock = ScheduleModel.clock(of: now, calendar: .current)
        let today = schedule.visiblePairs
        let upcoming = today.filter { $0.endTime > clock }
        Section {
            if today.isEmpty, schedule.syncedAt == nil, let failure = schedule.failure {
                // Расписание ни разу не скачивалось, а первая попытка упала: пустая база —
                // не «пар нет».
                DashboardFailurePlaceholder(message: failure) { await schedule.refresh() }
            } else if today.isEmpty, schedule.syncedAt == nil {
                // Первая синхронизация ещё идёт (или вот-вот начнётся из `.task`).
                DashboardLoadingPlaceholder(height: 60)
            } else if upcoming.isEmpty {
                DashboardEmptyRow(
                    text: today.isEmpty
                        ? String(localized: "teaching.dashboard.noPairsToday", defaultValue: "На сегодня пар нет")
                        : String(localized: "teaching.dashboard.noMorePairs", defaultValue: "На сегодня пар больше нет"),
                    symbol: "cup.and.saucer"
                )
            }
            ForEach(upcoming.prefix(4)) { pair in
                NavigationLink(value: AppRoute.lesson(id: pair.id, date: schedule.selectedDate)) {
                    HomePairRow(pair: pair, isNow: pair.startTime <= clock && !pair.isCancelled)
                }
            }
            NavigationLink(value: AppRoute.section(.schedule)) {
                DashboardMoreLabel(title: String(localized: "home.schedule.all", defaultValue: "Всё расписание"))
            }
        } header: {
            DashboardSectionHeader(
                title: now.formatted(.dateTime.weekday(.wide).day().month(.wide)).capitalized,
                subtitle: upcoming.count > 4
                    ? String(localized: "home.schedule.more", defaultValue: "И ещё пар сегодня: \(upcoming.count - 4)")
                    : nil
            )
        }
    }

    // MARK: Быстрые действия

    private var shortcuts: [DashboardShortcut] {
        [
            DashboardShortcut(
                title: StudentScreen.checkin.title, symbol: StudentScreen.checkin.symbol, tint: TileTint.green,
                route: .student(.checkin)
            ),
            DashboardShortcut(
                title: StudentScreen.studentID.title, symbol: StudentScreen.studentID.symbol, tint: TileTint.blue,
                route: .student(.studentID)
            ),
            DashboardShortcut(
                title: String(localized: "home.newApplication", defaultValue: "Новая заявка"),
                symbol: "doc.badge.plus", tint: TileTint.orange,
                route: .section(.serviceCatalog)
            ),
            DashboardShortcut(
                title: MoreSection.grades.title, symbol: "graduationcap.fill", tint: TileTint.purple,
                route: .section(.grades)
            ),
        ]
    }

    // MARK: Успеваемость

    /// Три главные цифры: средний результат, посещаемость, GPA (если вуз его ведёт).
    private var metrics: [DashboardMetric] {
        let isPending = !hasLoaded
        var items = [
            DashboardMetric(
                title: String(localized: "study.average", defaultValue: "Средний результат"),
                value: grades.flatMap(AcademicSummary.averagePercent).map { "\($0)%" },
                symbol: "graduationcap.fill",
                tint: TileTint.green,
                route: .section(.grades),
                isPending: isPending
            ),
            DashboardMetric(
                title: String(localized: "study.attendance", defaultValue: "Посещаемость"),
                value: attendance.map { "\($0.rate)%" },
                symbol: "checkmark.circle.fill",
                tint: TileTint.teal,
                route: .section(.attendance),
                isPending: isPending
            ),
        ]
        if let gpa = viewer.profile?.gpa {
            items.append(DashboardMetric(
                title: String(localized: "study.gpa", defaultValue: "GPA"),
                value: gpa.formatted(.number.precision(.fractionLength(2))),
                symbol: "star.fill",
                tint: TileTint.yellow
            ))
        }
        return items
    }

    // MARK: Требует внимания

    @ViewBuilder
    private var deadlinesSection: some View {
        let upcoming = AcademicSummary.upcoming(assignments ?? [])
        if !upcoming.isEmpty {
            Section {
                ForEach(upcoming) { assignment in
                    NavigationLink(value: AppRoute.assignment(id: assignment.id)) {
                        DeadlineRow(assignment: assignment)
                    }
                }
                NavigationLink(value: AppRoute.section(.assignments)) {
                    DashboardMoreLabel(title: String(localized: "home.assignments.all", defaultValue: "Все задания"))
                }
            } header: {
                DashboardSectionHeader(title: String(localized: "study.deadlines", defaultValue: "Ближайшие сроки"))
            }
        }
    }

    @ViewBuilder
    private var notificationsSection: some View {
        let unread = (notifications ?? []).filter { !$0.isRead }
        if !unread.isEmpty {
            Section {
                ForEach(unread.prefix(3)) { item in
                    NavigationLink(value: AppRoute.section(.notifications)) {
                        DashboardRow(
                            title: item.title,
                            subtitle: item.body,
                            symbol: "bell.fill",
                            tint: TileTint.red,
                            value: DisplayFormat.relative(item.createdAt)
                        )
                    }
                }
                if unread.count > 3 {
                    NavigationLink(value: AppRoute.section(.notifications)) {
                        DashboardMoreLabel(title: String(localized: "home.notifications.all", defaultValue: "Все уведомления"))
                    }
                }
            } header: {
                DashboardSectionHeader(title: String(localized: "home.notifications.unreadTitle", defaultValue: "Непрочитанные уведомления"))
            }
        }
    }

    @ViewBuilder
    private var applicationsSection: some View {
        let open = (applications ?? []).filter { ApplicationStatus.isOpen($0.status) && $0.status != "DRAFT" }
        if !open.isEmpty {
            Section {
                ForEach(open.prefix(3)) { application in
                    NavigationLink(value: AppRoute.application(id: application.id)) {
                        DashboardRow(
                            title: application.serviceName ?? String(localized: "more.applications", defaultValue: "Заявки"),
                            subtitle: application.createdAt.formatted(date: .abbreviated, time: .omitted),
                            symbol: "doc.text.fill",
                            tint: TileTint.blue,
                            badge: (ApplicationStatus.title(application.status), CommunityApplicationText.tint(application.status))
                        )
                    }
                }
                NavigationLink(value: AppRoute.section(.applications)) {
                    DashboardMoreLabel(title: String(localized: "home.applications.all", defaultValue: "Все заявки"))
                }
            } header: {
                DashboardSectionHeader(title: String(localized: "home.applications.active", defaultValue: "Заявки в работе"))
            }
        }
    }

    @ViewBuilder
    private var eventsSection: some View {
        if !home.events.isEmpty, !CommunityPlatformState.shared.isDisabled("events") {
            Section {
                ForEach(home.events.prefix(3)) { event in
                    NavigationLink(value: AppRoute.community(.event(id: event.id))) {
                        DashboardRow(
                            title: event.title,
                            subtitle: event.location,
                            symbol: "calendar",
                            tint: TileTint.purple,
                            value: event.startsAt.formatted(.dateTime.day().month(.abbreviated).hour().minute())
                        )
                    }
                }
                NavigationLink(value: AppRoute.section(.events)) {
                    DashboardMoreLabel(title: String(localized: "home.events.all", defaultValue: "Все события"))
                }
            } header: {
                DashboardSectionHeader(title: String(localized: "home.events", defaultValue: "Ближайшие события"))
            }
        }
    }

    // MARK: Загрузка

    @MainActor
    private func load() async {
        let study = StudyAPI()
        async let gradesValue = try? study.grades()
        async let attendanceValue = try? study.attendance()
        async let tasks = try? study.assignments().items
        async let attention: Int = refreshAttention()
        async let summary: Void = home.refreshSummary()
        let freshGrades = await gradesValue
        let freshAttendance = await attendanceValue
        let freshTasks = await tasks
        grades = freshGrades ?? grades
        attendance = freshAttendance ?? attendance
        assignments = freshTasks ?? assignments
        let attentionAnswered = await attention
        _ = await summary
        let answeredAll = freshGrades != nil && freshAttendance != nil && freshTasks != nil && attentionAnswered == 2
        if attentionAnswered == 0, grades == nil {
            failure = String(localized: "home.offline.schedule", defaultValue: "Нет связи — расписание из сохранённого")
        } else if !answeredAll {
            failure = String(localized: "student.partialFailure", defaultValue: "Часть данных не загрузилась")
        } else {
            failure = nil
        }
        hasLoaded = true
    }

    /// Непрочитанное и заявки — то, что меняется, пока человек ходит по разделам.
    /// Возвращает, сколько из двух запросов ответило.
    @MainActor
    @discardableResult
    private func refreshAttention() async -> Int {
        async let page = try? FeedAPI().notifications(cursor: nil)
        async let mine = try? ApplicationsAPI().applications()
        let (notificationsPage, applicationsPage) = await (page, mine)
        if let notificationsPage { notifications = notificationsPage.items }
        if let applicationsPage { applications = applicationsPage.items }
        return (notificationsPage != nil ? 1 : 0) + (applicationsPage != nil ? 1 : 0)
    }
}

/// Пара на главной: время столбиком, предмет, аудитория. Идущая — с зелёной отметкой,
/// отменённая — зачёркнута: её не убираем, чтобы человек не искал её глазами.
private struct HomePairRow: View {
    let pair: SchedulePair
    let isNow: Bool

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.lg) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: pair.startTime)
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(isNow ? Palette.success : Palette.foreground)
                Text(verbatim: pair.endTime)
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(Palette.mutedForeground)
            }
            .frame(minWidth: 48, alignment: .leading)

            VStack(alignment: .leading, spacing: 2) {
                if isNow {
                    Text(String(localized: "home.nowPair", defaultValue: "Сейчас идёт"))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Palette.success)
                }
                Text(pair.pair.subject)
                    .font(Typography.body.weight(.medium))
                    .foregroundStyle(Palette.foreground)
                    .strikethrough(pair.isCancelled)
                    .fixedSize(horizontal: false, vertical: true)
                if let details, !details.isEmpty {
                    Text(details)
                        .font(.footnote)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(2)
                }
                if let note = pair.changeNote {
                    Label(note, systemImage: "exclamationmark.circle")
                        .font(.footnote)
                        .foregroundStyle(Palette.warning)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    private var details: String? {
        StudyText.join([pair.pair.roomName, pair.pair.teacherName])
    }
}

/// Срок задания строкой как в списке чатов: значок, название, дисциплина, срок справа.
struct DeadlineRow: View {
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
