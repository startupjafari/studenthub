import Charts
import SwiftUI

/// Обзор деканата — стартовый экран роли. Сверху операционный блок «сегодня» (пары,
/// проблемы расписания, новые и просроченные заявки, последние изменения), ниже —
/// показатели факультета и три разреза: посещаемость по группам, причины риска, очередь
/// заявок. Каждый блок грузится отдельно: упавшая очередь не прячет посещаемость.
struct DeanDashboardView: View {
    @State private var model = DeanDashboardModel()
    @State private var exporter = DeanFileExporter()
    @State private var exportOptions = false

    var body: some View {
        List {
            Section {
                Text(Date(), format: .dateTime.weekday(.wide).day().month(.wide))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 0, leading: Spacing.lg, bottom: 0, trailing: Spacing.lg))
            }

            todaySection
            issuesSection
            recentSection
            facultySection
            attendanceSection
            riskSection
            queueSection
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(DeanScreen.dashboard.title))
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    exportOptions = true
                } label: {
                    Image(systemName: "square.and.arrow.up")
                }
                .accessibilityLabel(Text(String(localized: "dean.report.export", defaultValue: "Отчёт факультета")))
            }
        }
        .sheet(isPresented: $exportOptions) {
            DeanReportExportSheet(exporter: exporter)
        }
        .deanExportSheet(exporter)
        .refreshable { await model.load() }
        .task { if !model.isLoaded { await model.load() } }
    }

    // MARK: Сегодня

    private var todaySection: some View {
        Section {
            StatGrid {
                NavigationLink(value: AppRoute.dean(.schedule)) {
                    StatTile(
                        title: String(localized: "dean.today.classes", defaultValue: "Пар сегодня"),
                        value: model.today.map { $0.classes.formatted() } ?? "—",
                        symbol: "calendar"
                    )
                }
                NavigationLink(value: AppRoute.dean(.schedule)) {
                    StatTile(
                        title: String(localized: "dean.today.issues", defaultValue: "Проблем расписания"),
                        value: model.today.map { $0.issues.count.formatted() } ?? "—",
                        symbol: "exclamationmark.triangle",
                        tint: (model.today?.issues.isEmpty ?? true) ? Palette.mutedForeground : Palette.warning
                    )
                }
                NavigationLink(value: AppRoute.staff(.applicationsQueue)) {
                    StatTile(
                        title: String(localized: "dean.today.newApplications", defaultValue: "Новые заявки"),
                        value: model.queue.map { $0.new.formatted() } ?? "—",
                        symbol: "doc.text",
                        tint: Palette.info
                    )
                }
                NavigationLink(value: AppRoute.staff(.applicationsQueue)) {
                    StatTile(
                        title: String(localized: "dean.today.overdue", defaultValue: "Просрочено"),
                        value: model.queue.map { $0.overdue.formatted() } ?? "—",
                        symbol: "clock.badge.exclamationmark",
                        tint: Palette.destructive
                    )
                }
            }
            .buttonStyle(.plain)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
        }
    }

    @ViewBuilder
    private var issuesSection: some View {
        Section {
            if let today = model.today {
                if today.issues.isEmpty {
                    Text(String(localized: "dean.today.noIssues", defaultValue: "Сегодня без отмен, переносов и замен"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                } else {
                    ForEach(today.issues) { change in
                        let kind = DeanText.changeType(change.type)
                        HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                            Text(verbatim: change.newStartTime ?? change.pair.startTime)
                                .font(Typography.meta.monospacedDigit())
                                .foregroundStyle(Palette.mutedForeground)
                                .frame(width: 48, alignment: .leading)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(change.pair.subject).font(Typography.body)
                                if let note = change.note, !note.isEmpty {
                                    Text(note).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                                }
                            }
                            Spacer(minLength: Spacing.md)
                            StatusBadge(text: kind.0, tint: kind.1)
                        }
                    }
                }
            } else if let failure = model.todayFailure {
                DeanPanelError(message: failure) { await model.load() }
            } else {
                LoadingStateView()
            }
        } header: {
            Text(String(localized: "dean.today.issuesTitle", defaultValue: "Проблемы расписания сегодня"))
        }
    }

    @ViewBuilder
    private var recentSection: some View {
        Section {
            if let recent = model.recent {
                if recent.isEmpty {
                    Text(String(localized: "dean.recent.empty", defaultValue: "Важных изменений нет"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                } else {
                    ForEach(recent) { item in
                        NavigationLink(value: AppRoute.section(.notifications)) {
                            IconRow(
                                title: item.title,
                                symbol: Self.notificationSymbol(item.type),
                                tint: TileTint.gray,
                                subtitle: item.body,
                                value: DisplayFormat.dateTime(item.createdAt)
                            )
                        }
                    }
                }
            } else if model.isLoaded {
                Text(String(localized: "dean.recent.empty", defaultValue: "Важных изменений нет"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            } else {
                LoadingStateView()
            }
        } header: {
            Text(String(localized: "dean.recent.title", defaultValue: "Последние изменения"))
        }
    }

    private static func notificationSymbol(_ type: String) -> String {
        switch type {
        case "SCHEDULE_CHANGE": return "calendar"
        case "APP_UPDATE": return "doc.text"
        case "EVENT": return "calendar.badge.clock"
        case "POST": return "newspaper"
        default: return "bell"
        }
    }

    // MARK: Факультет

    @ViewBuilder
    private var facultySection: some View {
        Section {
            if let failure = model.overviewFailure, model.overview == nil {
                DeanPanelError(message: failure) { await model.load() }
            } else {
                let totals = model.overview?.totals
                let low = model.risk?.thresholds.attendance ?? 60
                StatGrid {
                    NavigationLink(value: AppRoute.dean(.students)) {
                        StatTile(
                            title: String(localized: "dean.kpi.students", defaultValue: "Студенты"),
                            value: totals.map { $0.students.formatted() } ?? "—",
                            symbol: "person.2"
                        )
                    }
                    NavigationLink(value: AppRoute.dean(.groups)) {
                        StatTile(
                            title: String(localized: "dean.kpi.groups", defaultValue: "Группы"),
                            value: totals.map { $0.groups.formatted() } ?? "—",
                            symbol: "person.3"
                        )
                    }
                    NavigationLink(value: AppRoute.dean(.analytics)) {
                        StatTile(
                            title: String(localized: "dean.kpi.attendance", defaultValue: "Посещаемость"),
                            value: DeanText.percent(totals?.attendanceRate),
                            symbol: "percent",
                            tint: (totals?.attendanceRate).map { $0 < low ? Palette.destructive : Palette.info } ?? Palette.info
                        )
                    }
                    StatTile(
                        title: String(localized: "dean.kpi.submissions", defaultValue: "Работ на проверке"),
                        value: totals.map { $0.submissionsPending.formatted() } ?? "—",
                        symbol: "tray.full",
                        tint: Palette.warning
                    )
                    NavigationLink(value: AppRoute.dean(.exams)) {
                        StatTile(
                            title: String(localized: "dean.kpi.exams", defaultValue: "Экзамены впереди"),
                            value: totals.map { $0.examsUpcoming.formatted() } ?? "—",
                            symbol: "graduationcap"
                        )
                    }
                }
                .buttonStyle(.plain)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
        } header: {
            Text(String(localized: "dean.faculty.title", defaultValue: "Факультет"))
        }
    }

    @ViewBuilder
    private var attendanceSection: some View {
        Section {
            if let overview = model.overview {
                let worst = overview.groups
                    .compactMap { group in group.attendanceRate.map { (group, $0) } }
                    .sorted { $0.1 < $1.1 }
                    .prefix(12)
                if worst.isEmpty {
                    Text(String(localized: "dean.chart.noAttendance", defaultValue: "Посещаемость ещё не отмечали"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                } else {
                    Chart(worst.map { DeanBar(id: $0.0.groupId, label: $0.0.name, value: $0.1) }) { bar in
                        BarMark(
                            x: .value(String(localized: "dean.chart.percent", defaultValue: "%"), bar.value),
                            y: .value(String(localized: "dean.chart.group", defaultValue: "Группа"), bar.label)
                        )
                        .foregroundStyle(DeanText.rateTint(bar.value))
                        .annotation(position: .trailing) {
                            Text(verbatim: DeanText.percent(bar.value))
                                .font(.caption2.monospacedDigit())
                                .foregroundStyle(Palette.mutedForeground)
                        }
                    }
                    .chartXScale(domain: 0...100)
                    .frame(height: CGFloat(max(160, worst.count * 28 + 30)))
                    .padding(.vertical, Spacing.sm)
                }
            } else if model.overviewFailure == nil {
                LoadingStateView()
            }
        } header: {
            Text(String(localized: "dean.chart.attendance", defaultValue: "Посещаемость по группам"))
        } footer: {
            Text(String(localized: "dean.chart.attendanceHint", defaultValue: "Худшие группы сверху; без отметок — не показаны"))
        }
    }

    @ViewBuilder
    private var riskSection: some View {
        Section {
            if let risk = model.risk {
                if risk.students.isEmpty {
                    Text(String(localized: "dean.chart.noRisk", defaultValue: "Никто не требует внимания"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                } else {
                    let bars = ["LOW_ATTENDANCE", "OVERDUE_ASSIGNMENTS", "LOW_GRADES"].map { kind in
                        (DeanText.riskReason(kind), risk.students.filter { $0.value(kind) != nil }.count)
                    }
                    DeanCountChart(bars: bars, tint: Palette.destructive)
                    NavigationLink(value: AppRoute.dean(.analytics)) {
                        Text(String(localized: "dean.chart.openAnalytics", defaultValue: "Кто именно — в аналитике"))
                    }
                }
            } else if let failure = model.riskFailure {
                DeanPanelError(message: failure) { await model.load() }
            } else {
                LoadingStateView()
            }
        } header: {
            Text(String(localized: "dean.chart.risk", defaultValue: "Требуют внимания"))
        } footer: {
            Text(String(localized: "dean.chart.riskHint", defaultValue: "Сколько студентов по каждой причине"))
        }
    }

    @ViewBuilder
    private var queueSection: some View {
        Section {
            if let queue = model.queue {
                let bars = [
                    (String(localized: "dean.queue.new", defaultValue: "Новые"), queue.new),
                    (String(localized: "dean.queue.inWork", defaultValue: "В работе"), queue.inWork),
                    (String(localized: "dean.queue.actionNeeded", defaultValue: "Ждут действия"), queue.actionNeeded),
                    (String(localized: "dean.queue.ready", defaultValue: "Готовы"), queue.ready),
                    (String(localized: "dean.queue.overdue", defaultValue: "Просрочены"), queue.overdue),
                ]
                if bars.allSatisfy({ $0.1 == 0 }) {
                    Text(String(localized: "dean.queue.empty", defaultValue: "Очередь заявок пуста"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                } else {
                    DeanCountChart(bars: bars, tint: Palette.primary)
                }
                NavigationLink(value: AppRoute.staff(.applicationsQueue)) {
                    Text(String(localized: "dean.queue.open", defaultValue: "Открыть очередь"))
                }
            } else if let failure = model.queueFailure {
                DeanPanelError(message: failure) { await model.load() }
            } else {
                LoadingStateView()
            }
        } header: {
            Text(String(localized: "dean.queue.title", defaultValue: "Очередь заявок"))
        }
    }
}

/// Сбой одной панели: без него упавший запрос выглядел бы пустым состоянием —
/// «очередь пуста», — и выдавал сбой за хорошую новость.
struct DeanPanelError: View {
    let message: String
    let retry: () async -> Void

    var body: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: "exclamationmark.triangle").foregroundStyle(Palette.warning)
            Text(message).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
            Spacer(minLength: Spacing.md)
            RetryButton(action: retry)
        }
    }
}

/// Горизонтальные полосы «подпись — число».
struct DeanCountChart: View {
    let bars: [(String, Int)]
    var tint: Color = Palette.primary

    var body: some View {
        Chart(bars.enumerated().map { DeanBar(id: String($0.offset), label: $0.element.0, value: Double($0.element.1)) }) { bar in
            BarMark(
                x: .value(String(localized: "dean.chart.count", defaultValue: "Количество"), bar.value),
                y: .value(String(localized: "dean.chart.category", defaultValue: "Категория"), bar.label)
            )
            .foregroundStyle(tint)
            .annotation(position: .trailing) {
                Text(verbatim: Int(bar.value).formatted())
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(Palette.mutedForeground)
            }
        }
        .frame(height: CGFloat(bars.count * 34 + 20))
        .padding(.vertical, Spacing.sm)
    }
}

/// Столбик графика: подпись и значение.
struct DeanBar: Identifiable {
    let id: String
    let label: String
    let value: Double
}

/// Отчёт факультета файлом: период и формат, как окно выгрузки в вебе.
struct DeanReportExportSheet: View {
    let exporter: DeanFileExporter

    @Environment(\.dismiss) private var dismiss
    @State private var period: DeanReportPeriod = .quarter
    @State private var format: DeanExportFormat = .xlsx

    private let api = DeanAPI()

    var body: some View {
        FormSheet(
            title: String(localized: "dean.report.export", defaultValue: "Отчёт факультета"),
            saveTitle: String(localized: "dean.report.download", defaultValue: "Выгрузить"),
            save: {
                await exporter.run(name: DeanFileExporter.fileName("analytics-report", format: format)) {
                    try await api.exportReport(period: period, format: format)
                }
            }
        ) {
            Section {
                Picker(String(localized: "dean.report.period", defaultValue: "Период"), selection: $period) {
                    Text(String(localized: "dean.report.month", defaultValue: "Месяц")).tag(DeanReportPeriod.month)
                    Text(String(localized: "dean.report.quarter", defaultValue: "Квартал")).tag(DeanReportPeriod.quarter)
                    Text(String(localized: "dean.report.year", defaultValue: "Учебный год")).tag(DeanReportPeriod.year)
                }
                Picker(String(localized: "dean.report.format", defaultValue: "Формат"), selection: $format) {
                    Text(verbatim: "Excel (XLSX)").tag(DeanExportFormat.xlsx)
                    Text(verbatim: "CSV").tag(DeanExportFormat.csv)
                }
            } footer: {
                Text(String(localized: "dean.report.hint", defaultValue: "Строка на группу и «Итого»: посещаемость, успеваемость, экзамены, заявки. Группы меньше 5 студентов — без чисел."))
            }
        }
    }
}

// MARK: - Данные

@MainActor
@Observable
private final class DeanDashboardModel {
    struct Today {
        var classes: Int
        var issues: [DeanScheduleChange]
    }

    var overview: DeanFacultyOverview?
    var overviewFailure: String?
    var risk: DeanAtRisk?
    var riskFailure: String?
    var queue: DeanQueueStats?
    var queueFailure: String?
    var today: Today?
    var todayFailure: String?
    var recent: [DeanNotification]?
    var isLoaded = false

    private let api = DeanAPI()

    func load() async {
        let api = self.api
        async let overviewTask = Self.result { try await api.facultyOverview() }
        async let riskTask = Self.result { try await api.atRisk() }
        async let queueTask = Self.result { try await api.queueStats() }
        async let todayTask = Self.result { try await Self.loadToday(api) }
        async let recentTask = Self.result { try await api.notifications(limit: 20) }

        apply(await overviewTask, to: \.overview, failure: \.overviewFailure)
        apply(await riskTask, to: \.risk, failure: \.riskFailure)
        apply(await queueTask, to: \.queue, failure: \.queueFailure)
        apply(await todayTask, to: \.today, failure: \.todayFailure)
        // Только важные типы — это не копия страницы уведомлений.
        if case .success(let items) = await recentTask {
            let important: Set<String> = ["SCHEDULE_CHANGE", "APP_UPDATE", "EVENT", "POST"]
            recent = Array(items.filter { important.contains($0.type) }.prefix(5))
        }
        isLoaded = true
    }

    private nonisolated static func loadToday(_ api: DeanAPI) async throws -> Today {
        let schedule = try await api.schedule(groupID: nil)
        let zone = schedule.timezone.flatMap(TimeZone.init(identifier:)) ?? .current
        let now = Date()
        let day = DeanTime.day(now, timeZone: zone)
        let weekday = DeanTime.isoWeekday(now, timeZone: zone)
        let parity = WeekParity.current(now, in: zone)
        let changes = try await api.scheduleChanges(from: day, to: day)
        // Изменения пар черновиков и архива группа не видит — в проблемы их не берём.
        let active = Set(schedule.pairs.map(\.id))
        let issues = changes.filter { active.contains($0.pairId) }
        let cancelled = Set(issues.filter { $0.type == "CANCELLED" }.map(\.pairId))
        let classes = schedule.pairs.filter {
            $0.dayOfWeek == weekday && parity.includes(weekType: $0.weekType) && !cancelled.contains($0.id)
        }.count
        return Today(classes: classes, issues: issues.sorted { ($0.newStartTime ?? $0.pair.startTime) < ($1.newStartTime ?? $1.pair.startTime) })
    }

    private nonisolated static func result<T>(_ body: () async throws -> T) async -> Result<T, Error> {
        do { return .success(try await body()) } catch { return .failure(error) }
    }

    private func apply<T>(
        _ result: Result<T, Error>,
        to value: ReferenceWritableKeyPath<DeanDashboardModel, T?>,
        failure: ReferenceWritableKeyPath<DeanDashboardModel, String?>
    ) {
        switch result {
        case .success(let data):
            self[keyPath: value] = data
            self[keyPath: failure] = nil
        case .failure(let error):
            if error is CancellationError { return }
            self[keyPath: failure] = error.userMessage
        }
    }
}
