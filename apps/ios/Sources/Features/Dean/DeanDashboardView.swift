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
            DashboardMetricsSection(
                metrics: todayMetrics,
                title: Date().formatted(.dateTime.weekday(.wide).day().month(.wide)).capitalized
            )
            issuesSection
            recentSection
            facultySection
            attendanceSection
            riskSection
            queueSection
        }
        .dashboardListStyle()
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

    private var todayMetrics: [DashboardMetric] {
        let todayPending = model.today == nil && model.todayFailure == nil
        let queuePending = model.queue == nil && model.queueFailure == nil
        let issues = model.today?.issues.count
        return [
            DashboardMetric(
                title: String(localized: "dean.today.classes", defaultValue: "Пар сегодня"),
                value: model.today.map { $0.classes.formatted() },
                symbol: "calendar",
                tint: TileTint.blue,
                route: .dean(.schedule),
                isPending: todayPending
            ),
            DashboardMetric(
                title: String(localized: "dean.today.issues", defaultValue: "Проблем расписания"),
                value: issues.map { $0.formatted() },
                symbol: "exclamationmark.triangle",
                tint: (issues ?? 0) > 0 ? Palette.warning : TileTint.gray,
                route: .dean(.schedule),
                isPending: todayPending
            ),
            DashboardMetric(
                title: String(localized: "dean.today.newApplications", defaultValue: "Новые заявки"),
                value: model.queue.map { $0.new.formatted() },
                symbol: "doc.text",
                tint: Palette.info,
                route: .staff(.applicationsQueue),
                isPending: queuePending
            ),
            DashboardMetric(
                title: String(localized: "dean.today.overdue", defaultValue: "Просрочено"),
                value: model.queue.map { $0.overdue.formatted() },
                symbol: "clock.badge.exclamationmark",
                tint: Palette.destructive,
                route: .staff(.applicationsQueue),
                isPending: queuePending
            ),
        ]
    }

    @ViewBuilder
    private var issuesSection: some View {
        Section {
            if let today = model.today {
                if today.issues.isEmpty {
                    DashboardEmptyRow(
                        text: String(localized: "dean.today.noIssues", defaultValue: "Сегодня без отмен, переносов и замен"),
                        tint: Palette.success
                    )
                } else {
                    ForEach(today.issues) { change in
                        let kind = DeanText.changeType(change.type)
                        HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                            Text(verbatim: change.newStartTime ?? change.pair.startTime)
                                .font(.subheadline.monospacedDigit())
                                .foregroundStyle(Palette.mutedForeground)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(change.pair.subject).font(Typography.body)
                                if let note = change.note, !note.isEmpty {
                                    Text(note).font(.footnote).foregroundStyle(Palette.mutedForeground)
                                }
                            }
                            Spacer(minLength: Spacing.md)
                            StatusBadge(text: kind.0, tint: kind.1)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            } else if let failure = model.todayFailure {
                DashboardFailurePlaceholder(message: failure) { await model.load() }
            } else {
                DashboardLoadingPlaceholder(height: 60)
            }
        } header: {
            DashboardSectionHeader(title: String(localized: "dean.today.issuesTitle", defaultValue: "Проблемы расписания сегодня"))
        }
    }

    @ViewBuilder
    private var recentSection: some View {
        Section {
            if let recent = model.recent, !recent.isEmpty {
                ForEach(recent) { item in
                    NavigationLink(value: AppRoute.section(.notifications)) {
                        DashboardRow(
                            title: item.title,
                            subtitle: item.body,
                            symbol: Self.notificationSymbol(item.type),
                            tint: TileTint.gray,
                            value: DisplayFormat.dateTime(item.createdAt)
                        )
                    }
                }
            } else if model.recent != nil {
                DashboardEmptyRow(text: String(localized: "dean.recent.empty", defaultValue: "Важных изменений нет"), symbol: "bell")
            } else if let failure = model.recentFailure {
                // Уведомления не загрузились — не «Важных изменений нет».
                DashboardFailurePlaceholder(message: failure) { await model.load() }
            } else {
                DashboardLoadingPlaceholder(height: 60)
            }
        } header: {
            DashboardSectionHeader(title: String(localized: "dean.recent.title", defaultValue: "Последние изменения"))
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
        let title = String(localized: "dean.faculty.title", defaultValue: "Факультет")
        if let failure = model.overviewFailure, model.overview == nil {
            Section {
                DashboardFailurePlaceholder(message: failure) { await model.load() }
            } header: {
                DashboardSectionHeader(title: title)
            }
        } else {
            DashboardMetricsSection(metrics: facultyMetrics, title: title)
        }
    }

    private var facultyMetrics: [DashboardMetric] {
        let totals = model.overview?.totals
        let pending = totals == nil
        let low = model.risk?.thresholds.attendance ?? 60
        return [
            DashboardMetric(
                title: String(localized: "dean.kpi.students", defaultValue: "Студенты"),
                value: totals.map { $0.students.formatted() },
                symbol: "person.2",
                tint: TileTint.teal,
                route: .dean(.students),
                isPending: pending
            ),
            DashboardMetric(
                title: String(localized: "dean.kpi.groups", defaultValue: "Группы"),
                value: totals.map { $0.groups.formatted() },
                symbol: "person.3",
                tint: TileTint.orange,
                route: .dean(.groups),
                isPending: pending
            ),
            DashboardMetric(
                title: String(localized: "dean.kpi.attendance", defaultValue: "Посещаемость"),
                value: totals?.attendanceRate.map { DeanText.percent($0) },
                symbol: "percent",
                tint: (totals?.attendanceRate).map { $0 < low ? Palette.destructive : Palette.info } ?? Palette.info,
                route: .dean(.analytics),
                isPending: pending
            ),
            DashboardMetric(
                title: String(localized: "dean.kpi.submissions", defaultValue: "Работ на проверке"),
                value: totals.map { $0.submissionsPending.formatted() },
                symbol: "tray.full",
                tint: Palette.warning,
                isPending: pending
            ),
            DashboardMetric(
                title: String(localized: "dean.kpi.exams", defaultValue: "Экзамены впереди"),
                value: totals.map { $0.examsUpcoming.formatted() },
                symbol: "graduationcap",
                tint: TileTint.purple,
                route: .dean(.exams),
                isPending: pending
            ),
        ]
    }

    @ViewBuilder
    private var attendanceSection: some View {
        // Сбой сводки уже показан в блоке «Факультет» — вторую ошибку не дублируем.
        if model.overview != nil || model.overviewFailure == nil {
            DashboardCardSection(
                title: String(localized: "dean.chart.attendance", defaultValue: "Посещаемость по группам"),
                subtitle: String(localized: "dean.chart.attendanceHint", defaultValue: "Худшие группы сверху; без отметок — не показаны")
            ) {
                if let overview = model.overview {
                    let worst = overview.groups
                        .compactMap { group in group.attendanceRate.map { (group, $0) } }
                        .sorted { $0.1 < $1.1 }
                        .prefix(12)
                    if worst.isEmpty {
                        DashboardEmptyPlaceholder(
                            text: String(localized: "dean.chart.noAttendance", defaultValue: "Посещаемость ещё не отмечали"),
                            symbol: "checklist"
                        )
                    } else {
                        Chart(worst.map { DeanBar(id: $0.0.groupId, label: $0.0.name, value: $0.1) }) { bar in
                            BarMark(
                                x: .value(String(localized: "dean.chart.percent", defaultValue: "%"), bar.value),
                                y: .value(String(localized: "dean.chart.group", defaultValue: "Группа"), bar.label)
                            )
                            .foregroundStyle(DeanText.rateTint(bar.value))
                            .cornerRadius(4)
                            .annotation(position: .trailing) {
                                Text(verbatim: DeanText.percent(bar.value))
                                    .font(.caption2.monospacedDigit())
                                    .foregroundStyle(Palette.mutedForeground)
                            }
                        }
                        .chartXScale(domain: 0...100)
                        .frame(height: CGFloat(max(160, worst.count * 28 + 30)))
                    }
                } else {
                    DashboardLoadingPlaceholder()
                }
            }
        }
    }

    private var riskSection: some View {
        DashboardCardSection(
            title: String(localized: "dean.chart.risk", defaultValue: "Требуют внимания"),
            subtitle: String(localized: "dean.chart.riskHint", defaultValue: "Сколько студентов по каждой причине")
        ) {
            if let risk = model.risk {
                if risk.students.isEmpty {
                    DashboardEmptyPlaceholder(
                        text: String(localized: "dean.chart.noRisk", defaultValue: "Никто не требует внимания"),
                        symbol: "checkmark.circle"
                    )
                } else {
                    let bars = ["LOW_ATTENDANCE", "OVERDUE_ASSIGNMENTS", "LOW_GRADES"].map { kind in
                        (DeanText.riskReason(kind), risk.students.filter { $0.value(kind) != nil }.count)
                    }
                    DeanCountChart(bars: bars, tint: Palette.destructive)
                }
            } else if let failure = model.riskFailure {
                DashboardFailurePlaceholder(message: failure) { await model.load() }
            } else {
                DashboardLoadingPlaceholder(height: 120)
            }
        } footer: {
            if let risk = model.risk, !risk.students.isEmpty {
                NavigationLink(value: AppRoute.dean(.analytics)) {
                    DashboardMoreLabel(title: String(localized: "dean.chart.openAnalytics", defaultValue: "Кто именно — в аналитике"))
                }
            }
        }
    }

    private var queueSection: some View {
        DashboardCardSection(title: String(localized: "dean.queue.title", defaultValue: "Очередь заявок")) {
            if let queue = model.queue {
                let bars = [
                    (String(localized: "dean.queue.new", defaultValue: "Новые"), queue.new),
                    (String(localized: "dean.queue.inWork", defaultValue: "В работе"), queue.inWork),
                    (String(localized: "dean.queue.actionNeeded", defaultValue: "Ждут действия"), queue.actionNeeded),
                    (String(localized: "dean.queue.ready", defaultValue: "Готовы"), queue.ready),
                    (String(localized: "dean.queue.overdue", defaultValue: "Просрочены"), queue.overdue),
                ]
                if bars.allSatisfy({ $0.1 == 0 }) {
                    DashboardEmptyPlaceholder(text: String(localized: "dean.queue.empty", defaultValue: "Очередь заявок пуста"), symbol: "tray")
                } else {
                    DeanCountChart(bars: bars, tint: Palette.primary)
                }
            } else if let failure = model.queueFailure {
                DashboardFailurePlaceholder(message: failure) { await model.load() }
            } else {
                DashboardLoadingPlaceholder(height: 120)
            }
        } footer: {
            if model.queue != nil {
                NavigationLink(value: AppRoute.staff(.applicationsQueue)) {
                    DashboardMoreLabel(title: String(localized: "dean.queue.open", defaultValue: "Открыть очередь"))
                }
            }
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
            .cornerRadius(4)
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
    var recentFailure: String?
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
        let important: Set<String> = ["SCHEDULE_CHANGE", "APP_UPDATE", "EVENT", "POST"]
        apply(
            (await recentTask).map { items in Array(items.filter { important.contains($0.type) }.prefix(5)) },
            to: \.recent,
            failure: \.recentFailure
        )
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
