import SwiftUI

/// Обзор преподавателя — рабочий экран дня: ближайшая пара и расписание сегодня,
/// что нужно сделать (отметить посещаемость, проверить работы), ближайшие
/// консультации и события, последние изменения, отчёт по своим группам.
struct TeachingDashboardView: View {
    @Environment(\.viewerID) private var viewerID

    @State private var today: TeachingTodayDTO?
    @State private var failure: String?
    @State private var isOffline = false
    @State private var marked: Set<String> = []
    @State private var queue: TeachingReviewQueueDTO?
    @State private var consultations: [ConsultationSlotDTO] = []
    /// Блоки обзора падают по отдельности. Сбой — не «работ нет» и не «всё отмечено»:
    /// иначе он выглядел бы хорошей новостью.
    @State private var reviewFailed = false
    @State private var consultationsFailed = false
    @State private var markedFailed = false
    @State private var exported: ExportedFile?
    @State private var isExporting = false
    @State private var actionFailure: String?

    private let api = TeachingAPI()

    var body: some View {
        List {
            if let today {
                content(today)
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .dashboardListStyle()
        .navigationTitle(Text(TeacherScreen.dashboard.title))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if isExporting {
                    ProgressView()
                } else {
                    reportMenu
                }
            }
        }
        .sheet(item: $exported) { file in
            ShareSheet(items: [file.url])
        }
        .actionFailureAlert($actionFailure)
        .refreshable { await load() }
        .task { await load() }
        // Отметили посещаемость и вернулись — список «отметить» должен сократиться.
        .onAppear { if today != nil { Task { await loadMarked() } } }
    }

    // MARK: Содержимое

    @ViewBuilder
    private func content(_ today: TeachingTodayDTO) -> some View {
        let now = Date()
        let day = teachingDayPairs(pairs: today.pairs, changes: today.scheduleChanges, date: now, viewerID: viewerID)
        let clock = currentTime(in: today.timezone)

        nextPairSection(day, clock: clock, date: now)
        attendanceTodoSection(day, clock: clock)
        reviewSection
        quickActions
        consultationsSection
        attentionSection(today)
        if !day.isEmpty { timelineSection(day, clock: clock) }
        recentChangesSection(today)
    }

    @ViewBuilder
    private func nextPairSection(_ day: [TeachingDayPair], clock: String, date: Date) -> some View {
        let open = day.filter { !$0.isCancelled }
        let current = open.first { $0.start <= clock && clock < $0.end }
        let next = current ?? open.first { $0.start > clock }
        Section {
            if let next {
                NavigationLink(value: AppRoute.lesson(id: next.pair.id, date: Date())) {
                    HStack(alignment: .top, spacing: Spacing.lg) {
                        DashboardIconBadge(
                            symbol: current != nil ? "play.fill" : "clock",
                            tint: current != nil ? Palette.success : Palette.primary
                        )
                        VStack(alignment: .leading, spacing: 2) {
                            Text(current != nil
                                ? String(localized: "teaching.dashboard.now", defaultValue: "Сейчас идёт")
                                : String(localized: "teaching.dashboard.next", defaultValue: "Следующая пара"))
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(current != nil ? Palette.success : Palette.mutedForeground)
                            Text(next.pair.subject)
                                .font(.headline)
                                .foregroundStyle(Palette.foreground)
                                .fixedSize(horizontal: false, vertical: true)
                            Text(verbatim: [ "\(next.start)–\(next.end)", next.room ].compactMap { $0 }.joined(separator: " · "))
                                .font(.subheadline.monospacedDigit())
                                .foregroundStyle(Palette.mutedForeground)
                        }
                    }
                    .padding(.vertical, Spacing.xs)
                    .accessibilityElement(children: .combine)
                }
            } else {
                HStack(alignment: .top, spacing: Spacing.lg) {
                    DashboardIconBadge(symbol: "cup.and.saucer", tint: TileTint.gray)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(day.isEmpty
                            ? String(localized: "teaching.dashboard.noPairsToday", defaultValue: "На сегодня пар нет")
                            : String(localized: "teaching.dashboard.noMorePairs", defaultValue: "На сегодня пар больше нет"))
                            .font(.headline)
                        Text(String(localized: "teaching.dashboard.noMorePairs.hint", defaultValue: "Загляните в расписание, чтобы спланировать неделю."))
                            .font(.footnote)
                            .foregroundStyle(Palette.mutedForeground)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.vertical, Spacing.xs)
                .accessibilityElement(children: .combine)
            }
        } header: {
            DashboardSectionHeader(title: date.formatted(.dateTime.weekday(.wide).day().month(.wide)).capitalized)
        }
    }

    /// Начавшиеся сегодня пары без отметок: журнал будущей заполнять нечем.
    @ViewBuilder
    private func attendanceTodoSection(_ day: [TeachingDayPair], clock: String) -> some View {
        let started = day.filter { !$0.isCancelled && $0.start <= clock }
        if !started.isEmpty {
            let todo = started.filter { !marked.contains($0.id) }
            Section {
                if markedFailed {
                    // Без отметок каждая начавшаяся пара выглядела бы неотмеченной.
                    DashboardFailurePlaceholder { await loadMarked() }
                } else {
                    if todo.isEmpty {
                        DashboardEmptyRow(
                            text: String(localized: "teaching.dashboard.allMarked", defaultValue: "Все занятия сегодня отмечены"),
                            tint: Palette.success
                        )
                    }
                    ForEach(todo) { item in
                        NavigationLink(value: AppRoute.lesson(id: item.pair.id, date: Date())) {
                            DashboardRow(
                                title: item.pair.subject,
                                subtitle: "\(item.start)–\(item.end)",
                                symbol: "checklist",
                                tint: TileTint.orange,
                                badge: (String(localized: "teaching.attendance.notMarked", defaultValue: "Не отмечено"), Palette.warning)
                            )
                        }
                    }
                }
            } header: {
                DashboardSectionHeader(title: String(localized: "teaching.dashboard.attendanceTodo", defaultValue: "Отметить посещаемость"))
            }
        }
    }

    @ViewBuilder
    private var reviewSection: some View {
        Section {
            if reviewFailed, queue?.items.isEmpty ?? true {
                DashboardFailurePlaceholder { await load() }
            } else if let queue {
                if queue.items.isEmpty {
                    DashboardEmptyRow(
                        text: String(localized: "teaching.dashboard.reviewEmpty", defaultValue: "Непроверенных работ нет"),
                        tint: Palette.success
                    )
                }
                ForEach(queue.items) { item in
                    NavigationLink(value: AppRoute.teacher(.assignmentSubmissions(assignmentID: item.id))) {
                        DashboardRow(title: item.title, subtitle: item.subject, symbol: "tray.full", tint: TileTint.orange, value: item.pending.formatted())
                    }
                }
                if queue.total > 0 {
                    NavigationLink(value: AppRoute.teacher(.reviews)) {
                        DashboardMoreLabel(title: String(localized: "teaching.dashboard.reviewAll", defaultValue: "Все задания — на проверке \(queue.total.formatted())"))
                    }
                }
            } else {
                DashboardLoadingPlaceholder(height: 60)
            }
        } header: {
            DashboardSectionHeader(title: String(localized: "teaching.dashboard.review", defaultValue: "Работы на проверке"))
        }
    }

    private var quickActions: some View {
        DashboardShortcutsSection(
            shortcuts: [
                shortcut(.attendanceJournal, tint: TileTint.teal),
                shortcut(.reviews, title: String(localized: "teaching.dashboard.newAssignment", defaultValue: "Задания"), tint: TileTint.orange),
                shortcut(.gradebook, tint: TileTint.green),
                shortcut(.materials, tint: TileTint.indigo),
            ],
            title: String(localized: "teaching.dashboard.quick", defaultValue: "Быстрые действия")
        )
    }

    private func shortcut(_ screen: TeacherScreen, title: String? = nil, tint: Color) -> DashboardShortcut {
        DashboardShortcut(title: title ?? screen.title, symbol: screen.symbol, tint: tint, route: .teacher(screen))
    }

    @ViewBuilder
    private var consultationsSection: some View {
        Section {
            if consultationsFailed, consultations.isEmpty {
                DashboardFailurePlaceholder { await load() }
            } else if consultations.isEmpty {
                DashboardEmptyRow(
                    text: String(localized: "teaching.dashboard.consultationsEmpty", defaultValue: "Записей пока нет"),
                    symbol: "calendar"
                )
            }
            ForEach(consultations) { slot in
                NavigationLink(value: AppRoute.section(.consultations)) {
                    DashboardRow(
                        title: slot.student?.name ?? String(localized: "teaching.dashboard.freeSlot", defaultValue: "Свободный слот"),
                        subtitle: [DisplayFormat.dateTime(slot.startsAt), slot.topic].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "),
                        symbol: "person.crop.circle.badge.clock",
                        tint: TileTint.purple
                    )
                }
            }
        } header: {
            DashboardSectionHeader(title: String(localized: "teaching.dashboard.consultations", defaultValue: "Ближайшие консультации"))
        }
    }

    /// События, на которые он записан, — в ближайшую неделю.
    @ViewBuilder
    private func attentionSection(_ today: TeachingTodayDTO) -> some View {
        let start = Calendar.current.startOfDay(for: Date())
        let limit = Calendar.current.date(byAdding: .day, value: 8, to: start) ?? start
        let events = (today.events ?? [])
            .filter { $0.isRegistered == true && $0.startsAt >= start && $0.startsAt < limit }
            .sorted { $0.startsAt < $1.startsAt }
        if !events.isEmpty {
            Section {
                ForEach(events) { event in
                    NavigationLink(value: AppRoute.event(id: event.id)) {
                        DashboardRow(
                            title: event.title,
                            subtitle: Calendar.current.isDateInToday(event.startsAt)
                                ? String(localized: "teaching.dashboard.eventToday", defaultValue: "Событие сегодня")
                                : String(localized: "teaching.dashboard.eventSoon", defaultValue: "Скоро событие"),
                            symbol: "calendar.badge.clock",
                            tint: Calendar.current.isDateInToday(event.startsAt) ? TileTint.red : TileTint.blue,
                            value: DisplayFormat.dateTime(event.startsAt)
                        )
                    }
                }
            } header: {
                DashboardSectionHeader(title: String(localized: "teaching.dashboard.attention", defaultValue: "Требует внимания"))
            }
        }
    }

    private func timelineSection(_ day: [TeachingDayPair], clock: String) -> some View {
        Section {
            ForEach(day) { item in
                NavigationLink(value: AppRoute.lesson(id: item.pair.id, date: Date())) {
                    HStack(alignment: .top, spacing: Spacing.lg) {
                        Text(verbatim: item.start)
                            .font(.subheadline.monospacedDigit())
                            .foregroundStyle(Palette.mutedForeground)
                            .strikethrough(item.isCancelled)
                            .frame(width: 52, alignment: .leading)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.pair.subject).font(Typography.cardTitle).lineLimit(2)
                            if let room = item.room {
                                Text(room).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                            }
                        }
                        Spacer(minLength: Spacing.md)
                        let state = pairState(item, clock: clock)
                        StatusBadge(text: state.text, tint: state.tint)
                    }
                }
                .disabled(item.isCancelled)
            }
        } header: {
            DashboardSectionHeader(title: String(localized: "teaching.dashboard.todaySchedule", defaultValue: "Расписание сегодня"))
        }
    }

    private func pairState(_ item: TeachingDayPair, clock: String) -> (text: String, tint: Color) {
        if item.isCancelled { return (String(localized: "teaching.state.cancelled", defaultValue: "Отменено"), Palette.destructive) }
        if item.isSubstituting { return (String(localized: "teaching.state.substituted", defaultValue: "Замена"), Palette.warning) }
        if item.start <= clock && clock < item.end { return (String(localized: "teaching.state.now", defaultValue: "Сейчас"), Palette.success) }
        if item.end <= clock { return (String(localized: "teaching.state.past", defaultValue: "Завершено"), Palette.mutedForeground) }
        if item.isMoved { return (String(localized: "teaching.state.moved", defaultValue: "Перенесено"), Palette.info) }
        if item.newRoom != nil { return (String(localized: "teaching.state.roomChanged", defaultValue: "Смена аудитории"), Palette.info) }
        return (String(localized: "teaching.state.scheduled", defaultValue: "По расписанию"), Palette.mutedForeground)
    }

    /// Важные уведомления: перенос пары, ответ по заявке, событие, объявление.
    @ViewBuilder
    private func recentChangesSection(_ today: TeachingTodayDTO) -> some View {
        let important: Set<String> = ["SCHEDULE_CHANGE", "APP_UPDATE", "EVENT", "POST"]
        let items = (today.notifications ?? []).filter { important.contains($0.type) }.prefix(5)
        Section {
            if items.isEmpty {
                DashboardEmptyRow(
                    text: String(localized: "teaching.dashboard.recentEmpty", defaultValue: "Пока нет новых изменений"),
                    symbol: "bell"
                )
            }
            ForEach(Array(items)) { item in
                Button {
                    open(item)
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.title ?? "").font(Typography.body).foregroundStyle(Palette.foreground)
                        if let body = item.body, !body.isEmpty {
                            Text(body).font(.footnote).foregroundStyle(Palette.mutedForeground).lineLimit(3)
                        }
                        Text(verbatim: DisplayFormat.relative(item.createdAt))
                            .font(.caption)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                }
                .buttonStyle(.plain)
            }
        } header: {
            DashboardSectionHeader(title: String(localized: "teaching.dashboard.recent", defaultValue: "Последние изменения"))
        }
    }

    private var reportMenu: some View {
        Menu {
            ForEach(["month", "quarter", "year"], id: \.self) { period in
                Menu(periodTitle(period)) {
                    Button(String(localized: "teaching.report.xlsx", defaultValue: "Excel (XLSX)")) { Task { await export(period, "xlsx") } }
                    Button(String(localized: "teaching.report.csv", defaultValue: "CSV")) { Task { await export(period, "csv") } }
                }
            }
        } label: {
            Image(systemName: "square.and.arrow.down")
        }
        .accessibilityLabel(Text(String(localized: "teaching.report", defaultValue: "Выгрузить отчёт")))
    }

    private func periodTitle(_ period: String) -> String {
        switch period {
        case "month": return String(localized: "teaching.report.month", defaultValue: "За месяц")
        case "year": return String(localized: "teaching.report.year", defaultValue: "За год")
        default: return String(localized: "teaching.report.quarter", defaultValue: "За квартал")
        }
    }

    // MARK: Данные

    private func currentTime(in timezone: String?) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timezone.flatMap(TimeZone.init(identifier:)) ?? .current
        let parts = calendar.dateComponents([.hour, .minute], from: Date())
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }

    private func open(_ item: TeachingTodayDTO.Notification) {
        guard let path = item.data?["url"]?.string else { return }
        let url = path.hasPrefix("/") ? URL(string: "https://studenthub.local\(path)") : URL(string: path)
        if let url { AppServices.router.open(url, for: .teacher) }
    }

    @MainActor
    private func load() async {
        do {
            async let summary = api.today()
            async let review = try? api.reviewQueue(limit: 5)
            async let slots = try? UniversityServicesAPI().myConsultations()
            today = try await summary
            // Не пришедший блок не затирает показанное — только помечается сбоем.
            let fetchedQueue = await review
            // Ушли с экрана посреди загрузки — это не сбой.
            try Task.checkCancellation()
            reviewFailed = fetchedQueue == nil
            if let fetchedQueue { queue = fetchedQueue }
            let fetchedSlots = await slots
            consultationsFailed = fetchedSlots == nil
            if let fetchedSlots {
                consultations = Array(fetchedSlots.filter { $0.startsAt >= Date() }.prefix(3))
            }
            failure = nil
            await loadMarked()
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    @MainActor
    private func loadMarked() async {
        guard let today else { return }
        let ids = teachingDayPairs(pairs: today.pairs, changes: today.scheduleChanges, date: Date(), viewerID: viewerID)
            .filter { !$0.isCancelled }
            .map(\.id)
        do {
            marked = try await api.markedPairs(date: Date(), pairIDs: ids)
            markedFailed = false
        } catch is CancellationError {
            return
        } catch {
            markedFailed = true
        }
    }

    @MainActor
    private func export(_ period: String, _ format: String) async {
        isExporting = true
        defer { isExporting = false }
        do {
            let data = try await api.exportReport(period: period, format: format)
            let folder = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let file = folder.appending(path: "report-\(TeachingAPI.day(Date())).\(format)")
            try data.write(to: file)
            exported = ExportedFile(url: file)
        } catch {
            actionFailure = error.userMessage
        }
    }
}
