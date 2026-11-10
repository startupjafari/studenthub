import Charts
import SwiftUI

// Обзор вуза (`widgets/stats-dashboard`): живые показатели дня, структура и панели-агрегаты,
// каждая из которых отвечает на один управленческий вопрос. Всё считает сервер; панели
// грузятся независимо, и сбой одной не прячет остальные.

///
/// На экране — показатели, главный график (динамика посещаемости) и панели одной темы.
/// Семь панелей подряд телефон превращал в ленту, которую листают не читая; темы
/// переключаются в одно касание, и панель темы грузится, только когда её открыли.
struct UAdminDashboardView: View {
    private enum Topic: Hashable { case attendance, study, services }

    @State private var topic: Topic = .attendance
    @State private var stats: UAdminUniversityStatsDTO?
    @State private var overview: UAdminUniversityOverviewDTO?
    @State private var overviewFailed = false
    @State private var onboarding: UAdminOnboardingDTO?
    @State private var exporting = false
    @State private var reloadToken = 0
    /// Первая загрузка завершилась: пустое значение после неё — «нет данных», а не загрузка.
    @State private var loaded = false

    var body: some View {
        List {
            if let onboarding, onboarding.university.status != "ACTIVE" {
                setupBanner(onboarding)
            }
            DashboardMetricsSection(metrics: metrics)

            Section { TrendPanel(reloadToken: reloadToken) }

            DashboardPeriodPicker(
                title: String(localized: "admin.dash.topic", defaultValue: "Тема"),
                selection: $topic,
                options: [
                    (Topic.attendance, String(localized: "uadmin.dash.topic.attendance", defaultValue: "Посещаемость")),
                    (Topic.study, String(localized: "uadmin.dash.topic.study", defaultValue: "Учёба")),
                    (Topic.services, String(localized: "uadmin.dash.topic.services", defaultValue: "Сервисы")),
                ]
            )

            switch topic {
            case .attendance:
                Section { BreakdownPanel(reloadToken: reloadToken) }
                Section { worstGroupsPanel }
                atRiskSection
            case .study:
                Section { ExamResultsPanel(reloadToken: reloadToken) }
                Section { RoomLoadPanel(reloadToken: reloadToken) }
            case .services:
                Section { ApplicationsFlowPanel(reloadToken: reloadToken) }
                Section { InvitesPanel(reloadToken: reloadToken) }
            }
        }
        .dashboardListStyle()
        .navigationTitle(Text(UniAdminScreen.dashboard.title))
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    exporting = true
                } label: {
                    Image(systemName: "square.and.arrow.down")
                }
                .accessibilityLabel(Text(String(localized: "uadmin.report.button", defaultValue: "Выгрузить отчёт")))
            }
        }
        .sheet(isPresented: $exporting) { UAdminReportExportSheet(facultyID: nil) }
        .refreshable {
            reloadToken += 1
            await load()
        }
        .task { await load() }
    }

    private var metrics: [DashboardMetric] {
        let overviewPending = overview == nil && !overviewFailed && !loaded
        let statsPending = stats == nil && !loaded
        return [
            DashboardMetric(
                title: String(localized: "uadmin.dash.attendance", defaultValue: "Посещаемость"),
                value: overview?.attendanceRate.map { DisplayFormat.percent($0) },
                symbol: "percent",
                tint: Palette.info,
                route: .uniAdmin(.analytics),
                isPending: overviewPending
            ),
            DashboardMetric(
                title: String(localized: "uadmin.dash.submissions", defaultValue: "Работ на проверке"),
                value: overview?.submissionsPending.map { $0.formatted() },
                symbol: "tray.full",
                tint: Palette.warning,
                isPending: overviewPending
            ),
            DashboardMetric(
                title: String(localized: "uadmin.dash.exams", defaultValue: "Экзамены впереди"),
                value: overview?.examsUpcoming.map { $0.formatted() },
                symbol: "calendar.badge.clock",
                tint: TileTint.purple,
                isPending: overviewPending
            ),
            DashboardMetric(
                title: String(localized: "uadmin.dash.faculties", defaultValue: "Факультеты"),
                value: stats?.faculties.map { $0.formatted() },
                symbol: "building.columns",
                tint: TileTint.indigo,
                route: .uniAdmin(.faculties),
                isPending: statsPending
            ),
            DashboardMetric(
                title: String(localized: "uadmin.dash.groups", defaultValue: "Группы"),
                value: stats?.groups.map { $0.formatted() },
                symbol: "person.3",
                tint: TileTint.orange,
                route: .uniAdmin(.groups),
                isPending: statsPending
            ),
            DashboardMetric(
                title: String(localized: "uadmin.dash.students", defaultValue: "Студенты"),
                value: stats?.students.map { $0.formatted() },
                symbol: "graduationcap",
                tint: TileTint.teal,
                isPending: statsPending
            ),
            DashboardMetric(
                title: String(localized: "uadmin.dash.teachers", defaultValue: "Преподаватели"),
                value: stats?.teachers.map { $0.formatted() },
                symbol: "book",
                tint: TileTint.green,
                isPending: statsPending
            ),
            DashboardMetric(
                title: String(localized: "uadmin.dash.rooms", defaultValue: "Аудитории"),
                value: stats?.rooms.map { $0.formatted() },
                symbol: "door.left.hand.open",
                tint: TileTint.blue,
                route: .uniAdmin(.rooms),
                isPending: statsPending
            ),
        ]
    }

    private func setupBanner(_ state: UAdminOnboardingDTO) -> some View {
        let done = state.steps.filter { $0.done || $0.skipped }.count
        return Section {
            NavigationLink(value: AppRoute.uniAdmin(.setup)) {
                HStack(alignment: .top, spacing: Spacing.lg) {
                    DashboardIconBadge(symbol: "wand.and.stars", tint: TileTint.purple)
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(String(localized: "uadmin.dash.setupTitle", defaultValue: "Настройка вуза не закончена"))
                            .font(.headline)
                            .foregroundStyle(Palette.foreground)
                        Text(String(localized: "uadmin.dash.setupText", defaultValue: "Пройдено \(done.formatted()) из \(state.steps.count.formatted()) шагов. Пока вуз не запущен, платформа закрыта даже для приглашённых."))
                            .font(.footnote)
                            .foregroundStyle(Palette.mutedForeground)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(String(localized: "uadmin.dash.setupAction", defaultValue: "Продолжить"))
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Palette.primary)
                    }
                }
                .padding(.vertical, Spacing.xs)
            }
        }
    }

    private var worstGroupsPanel: some View {
        let groups = Array((overview?.groups ?? []).prefix(12))
        return DashPanel(
            title: String(localized: "uadmin.dash.byGroup", defaultValue: "Посещаемость по группам"),
            hint: String(localized: "uadmin.dash.byGroupHint", defaultValue: "Худшие группы вуза — им нужно внимание в первую очередь")
        ) {
            if overviewFailed {
                DashboardFailurePlaceholder { await load() }
            } else if overview == nil {
                DashboardLoadingPlaceholder()
            } else if groups.isEmpty {
                DashboardEmptyPlaceholder(text: String(localized: "uadmin.dash.noAttendance", defaultValue: "Посещаемость ещё не отмечали"), symbol: "checklist")
            } else {
                Chart(groups) { group in
                    BarMark(x: .value("%", group.attendanceRate), y: .value("group", group.name))
                        .foregroundStyle(Palette.chart1)
                        .cornerRadius(4)
                        .annotation(position: .trailing) {
                            Text(verbatim: DisplayFormat.percent(group.attendanceRate))
                                .font(.caption2.monospacedDigit())
                                .foregroundStyle(Palette.mutedForeground)
                        }
                }
                .chartXScale(domain: 0...100)
                .frame(height: CGFloat(max(160, groups.count * 28)))
            }
        }
    }

    /// Группы ниже порога — строками со ссылкой на группу, как список «требует внимания».
    private var atRiskSection: some View {
        Section {
            if overviewFailed {
                DashboardFailurePlaceholder { await load() }
            } else if let overview {
                let risky = overview.atRisk ?? []
                if risky.isEmpty {
                    DashboardEmptyRow(text: String(localized: "uadmin.dash.atRiskEmpty", defaultValue: "Все группы в норме"), tint: Palette.success)
                } else {
                    ForEach(risky) { group in
                        NavigationLink(value: AppRoute.uniAdmin(.group(id: group.groupId))) {
                            DashboardRow(
                                title: group.name,
                                symbol: "exclamationmark.triangle",
                                tint: Palette.warning,
                                badge: (DisplayFormat.percent(group.attendanceRate), Palette.warning)
                            )
                        }
                    }
                }
            } else {
                DashboardLoadingPlaceholder(height: 80)
            }
        } header: {
            DashboardSectionHeader(
                title: String(localized: "uadmin.dash.atRisk", defaultValue: "Требует внимания"),
                subtitle: String(localized: "uadmin.dash.atRiskHint", defaultValue: "Группы с посещаемостью ниже порога")
            )
        }
    }

    @MainActor
    private func load() async {
        let api = UAdminAPI()
        async let statsTask = api.universityStats()
        async let overviewTask = api.overview()
        async let onboardingTask = api.onboarding()
        stats = (try? await statsTask) ?? stats
        do {
            overview = try await overviewTask
            overviewFailed = false
        } catch is CancellationError {
            return
        } catch {
            overviewFailed = overview == nil
        }
        onboarding = (try? await onboardingTask) ?? onboarding
        loaded = true
    }
}

// MARK: - Каркас панели

/// Карточка панели — общая карточка обзора (`DashboardCard`) в строке своей секции.
private struct DashPanel<Content: View>: View {
    let title: String
    var hint: String?
    @ViewBuilder let content: () -> Content

    var body: some View {
        DashboardCard(title: title, subtitle: hint, content: content)
    }
}

private struct PanelEmpty: View {
    let text: String

    var body: some View {
        DashboardEmptyPlaceholder(text: text)
    }
}

/// Панель со своей загрузкой.
private struct LoadingPanel<Value, Content: View>: View {
    let title: String
    var hint: String?
    let reloadToken: Int
    let load: () async throws -> Value
    @ViewBuilder let content: (Value) -> Content

    @State private var value: Value?
    @State private var failed = false

    var body: some View {
        DashPanel(title: title, hint: hint) {
            if let value {
                content(value)
            } else if failed {
                DashboardFailurePlaceholder { await run() }
            } else {
                DashboardLoadingPlaceholder()
            }
        }
        .task(id: reloadToken) { await run() }
    }

    @MainActor
    private func run() async {
        do {
            value = try await load()
            failed = false
        } catch is CancellationError {
            return
        } catch {
            failed = value == nil
        }
    }
}

private struct ChartPoint: Identifiable {
    let id = UUID()
    let x: String
    let y: Double
    let series: String
}

// MARK: - Панели

/// Стало лучше или хуже: посещаемость по неделям, три худших факультета линиями.
private struct TrendPanel: View {
    let reloadToken: Int

    var body: some View {
        LoadingPanel(
            title: String(localized: "uadmin.dash.trend", defaultValue: "Динамика посещаемости"),
            hint: String(localized: "uadmin.dash.trendHint", defaultValue: "Три факультета с худшей посещаемостью, по неделям семестра"),
            reloadToken: reloadToken,
            load: { try await UAdminAPI().attendanceTrend(weeks: 12) }
        ) { trend in
            // Худшие — по последней известной неделе: просевший только что факультет не прячется.
            let ranked = trend.series.filter { $0.lastValue != nil }
                .sorted { ($0.lastValue ?? 0) < ($1.lastValue ?? 0) }
                .prefix(3)
            if ranked.isEmpty {
                PanelEmpty(text: String(localized: "uadmin.dash.noAttendance", defaultValue: "Посещаемость ещё не отмечали"))
            } else {
                Chart {
                    ForEach(Array(ranked)) { series in
                        ForEach(Array(series.points.enumerated()), id: \.offset) { _, point in
                            if let value = point.value {
                                LineMark(x: .value("week", point.at, unit: .weekOfYear), y: .value("%", value))
                                    .foregroundStyle(by: .value("faculty", series.name))
                                    .symbol(by: .value("faculty", series.name))
                            }
                        }
                    }
                }
                .chartYScale(domain: 0...100)
                .chartLegend(position: .bottom, alignment: .leading)
                .frame(height: 220)
            }
        }
    }
}

/// Прогул и опоздание — разные проблемы: структура посещаемости по факультетам.
private struct BreakdownPanel: View {
    let reloadToken: Int

    var body: some View {
        LoadingPanel(
            title: String(localized: "uadmin.dash.breakdown", defaultValue: "Структура посещаемости"),
            hint: String(localized: "uadmin.dash.breakdownHint", defaultValue: "Прогулы, опоздания и уважительные раздельно: за одним процентом это разные проблемы"),
            reloadToken: reloadToken,
            load: { try await UAdminAPI().attendanceBreakdown() }
        ) { data in
            if data.items.isEmpty {
                PanelEmpty(text: String(localized: "uadmin.dash.noAttendance", defaultValue: "Посещаемость ещё не отмечали"))
            } else {
                let present = String(localized: "uadmin.dash.att.present", defaultValue: "Присутствовал")
                let late = String(localized: "uadmin.dash.att.late", defaultValue: "Опоздал")
                let excused = String(localized: "uadmin.dash.att.excused", defaultValue: "Уважительная")
                let absent = String(localized: "uadmin.dash.att.absent", defaultValue: "Отсутствовал")
                let points = data.items.flatMap { item in
                    [
                        ChartPoint(x: item.name, y: item.present, series: present),
                        ChartPoint(x: item.name, y: item.late, series: late),
                        ChartPoint(x: item.name, y: item.excused, series: excused),
                        ChartPoint(x: item.name, y: item.absent, series: absent),
                    ]
                }
                Chart(points) { point in
                    BarMark(x: .value("count", point.y), y: .value("faculty", point.x))
                        .foregroundStyle(by: .value("status", point.series))
                }
                .chartForegroundStyleScale(
                    domain: [present, late, excused, absent],
                    range: [Palette.success, Palette.warning, Palette.chart5.opacity(0.6), Palette.destructive]
                )
                .chartLegend(position: .bottom, alignment: .leading)
                .frame(height: CGFloat(max(180, data.items.count * 34 + 40)))
            }
        }
    }
}

/// Хватает ли помещений: сколько пар идёт одновременно в каждый час — будни и выходные
/// отдельно, среднее за один такой день.
private struct RoomLoadPanel: View {
    let reloadToken: Int

    var body: some View {
        LoadingPanel(
            title: String(localized: "uadmin.dash.roomLoad", defaultValue: "Загрузка аудиторий"),
            hint: nil,
            reloadToken: reloadToken,
            load: { try await UAdminAPI().roomLoad() }
        ) { load in
            if load.peak == 0 {
                DashboardEmptyPlaceholder(text: String(localized: "uadmin.dash.noSchedule", defaultValue: "Расписание не заполнено"), symbol: "calendar")
            } else {
                let peak = JSONValue.format(load.peak)
                let rooms = load.rooms.formatted()
                Text(String(localized: "uadmin.dash.roomLoadHint", defaultValue: "Пик — \(peak) пар одновременно при \(rooms) учебных аудиториях"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                Chart(Self.hourly(load.grid)) { point in
                    LineMark(x: .value("hour", Int(point.x) ?? 0), y: .value("pairs", point.y))
                        .foregroundStyle(by: .value("days", point.series))
                        .interpolationMethod(.monotone)
                }
                .chartXScale(domain: 0...23)
                .chartLegend(position: .bottom, alignment: .leading)
                .frame(height: 200)
                Text(String(localized: "uadmin.dash.byWeekday", defaultValue: "В среднем за день недели"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                Chart(Array(load.grid.prefix(7).enumerated()), id: \.offset) { item in
                    BarMark(x: .value("day", UAdminText.weekdayShort(item.offset + 1)), y: .value("pairs", item.element.reduce(0, +)))
                        .foregroundStyle(Palette.chart2)
                        .cornerRadius(4)
                }
                .frame(height: 140)
            }
        }
    }

    static func hourly(_ grid: [[Double]]) -> [ChartPoint] {
        let weekdays = String(localized: "uadmin.dash.weekdays", defaultValue: "Будни")
        let weekend = String(localized: "uadmin.dash.weekend", defaultValue: "Выходные")
        func average(_ days: Range<Int>, _ name: String) -> [ChartPoint] {
            let rows = days.compactMap { grid.indices.contains($0) ? grid[$0] : nil }
            guard !rows.isEmpty else { return [] }
            let points = (0..<24).map { hour -> ChartPoint in
                let total = rows.reduce(0.0) { $0 + ($1.indices.contains(hour) ? $1[hour] : 0) }
                return ChartPoint(x: String(hour), y: total / Double(rows.count), series: name)
            }
            // Выходные без единой пары — обычное расписание, а не «нет данных».
            return points.allSatisfy { $0.y == 0 } ? [] : points
        }
        return average(0..<5, weekdays) + average(5..<7, weekend)
    }
}

/// Чем кончилась сессия: исход экзаменов по факультетам.
private struct ExamResultsPanel: View {
    let reloadToken: Int

    var body: some View {
        LoadingPanel(
            title: String(localized: "uadmin.dash.exams.title", defaultValue: "Исход сессии"),
            hint: String(localized: "uadmin.dash.exams.hint", defaultValue: "Чем закончились экзамены по факультетам"),
            reloadToken: reloadToken,
            load: { try await UAdminAPI().examResults() }
        ) { data in
            if data.items.isEmpty {
                PanelEmpty(text: String(localized: "uadmin.dash.noExams", defaultValue: "Результатов экзаменов пока нет"))
            } else {
                let passed = String(localized: "uadmin.dash.exam.passed", defaultValue: "Сдал")
                let retake = String(localized: "uadmin.dash.exam.retake", defaultValue: "Пересдача")
                let absent = String(localized: "uadmin.dash.exam.absent", defaultValue: "Не явился")
                let failed = String(localized: "uadmin.dash.exam.failed", defaultValue: "Не сдал")
                let points = data.items.flatMap { item in
                    [
                        ChartPoint(x: item.name, y: item.passed, series: passed),
                        ChartPoint(x: item.name, y: item.retake, series: retake),
                        ChartPoint(x: item.name, y: item.absent, series: absent),
                        ChartPoint(x: item.name, y: item.failed, series: failed),
                    ]
                }
                Chart(points) { point in
                    BarMark(x: .value("count", point.y), y: .value("faculty", point.x))
                        .foregroundStyle(by: .value("result", point.series))
                }
                .chartForegroundStyleScale(
                    domain: [passed, retake, absent, failed],
                    range: [Palette.success, Palette.warning, Palette.chart5.opacity(0.6), Palette.destructive]
                )
                .chartLegend(position: .bottom, alignment: .leading)
                .frame(height: CGFloat(max(180, data.items.count * 34 + 40)))
            }
        }
    }
}

/// Успевает ли деканат: поступление, закрытие и просрочка заявок по неделям.
private struct ApplicationsFlowPanel: View {
    let reloadToken: Int

    var body: some View {
        LoadingPanel(
            title: String(localized: "uadmin.dash.apps", defaultValue: "Заявки на услуги"),
            hint: String(localized: "uadmin.dash.appsHint", defaultValue: "Поступление, закрытие и нарушения срока по неделям"),
            reloadToken: reloadToken,
            load: { try await UAdminAPI().applicationsFlow(weeks: 12) }
        ) { flow in
            if flow.points.allSatisfy({ $0.submitted == 0 && $0.closed == 0 }) {
                PanelEmpty(text: String(localized: "uadmin.dash.noApps", defaultValue: "Заявок за период не было"))
            } else {
                let submitted = String(localized: "uadmin.dash.apps.submitted", defaultValue: "Поступило")
                let closed = String(localized: "uadmin.dash.apps.closed", defaultValue: "Закрыто")
                let overdue = String(localized: "uadmin.dash.apps.overdue", defaultValue: "С просрочкой")
                Chart {
                    ForEach(Array(flow.points.enumerated()), id: \.offset) { _, point in
                        LineMark(x: .value("week", point.at, unit: .weekOfYear), y: .value("n", point.submitted))
                            .foregroundStyle(by: .value("kind", submitted))
                        LineMark(x: .value("week", point.at, unit: .weekOfYear), y: .value("n", point.closed))
                            .foregroundStyle(by: .value("kind", closed))
                        LineMark(x: .value("week", point.at, unit: .weekOfYear), y: .value("n", point.overdue))
                            .foregroundStyle(by: .value("kind", overdue))
                    }
                }
                .chartForegroundStyleScale(domain: [submitted, closed, overdue], range: [Palette.chart1, Palette.chart3, Palette.destructive])
                .chartLegend(position: .bottom, alignment: .leading)
                .frame(height: 200)
            }
        }
    }
}

/// Доходят ли приглашённые до регистрации и куда деваются остальные.
private struct InvitesPanel: View {
    let reloadToken: Int

    var body: some View {
        LoadingPanel(
            title: String(localized: "uadmin.dash.invites", defaultValue: "Приглашения"),
            hint: String(localized: "uadmin.dash.invitesHint", defaultValue: "Доходят ли приглашённые до регистрации и куда деваются остальные"),
            reloadToken: reloadToken,
            load: { try await UAdminAPI().invitesFunnel() }
        ) { funnel in
            if funnel.total == 0 {
                DashboardEmptyPlaceholder(text: String(localized: "uadmin.dash.noInvites", defaultValue: "Приглашений пока нет"), symbol: "envelope")
            } else {
                DashboardBarList(bars: [
                    DashboardBar(
                        label: String(localized: "uadmin.dash.conversion", defaultValue: "Конверсия"),
                        fraction: funnel.conversion / 100,
                        valueText: DisplayFormat.percent(funnel.conversion),
                        tint: Palette.success
                    ),
                ])
                VStack(spacing: Spacing.sm) {
                    row(String(localized: "uadmin.dash.inv.issued", defaultValue: "Выдано"), funnel.total)
                    row(String(localized: "uadmin.dash.inv.used", defaultValue: "Принято"), funnel.used)
                    row(String(localized: "uadmin.dash.inv.pending", defaultValue: "Ждут"), funnel.pending)
                    row(String(localized: "uadmin.dash.inv.expired", defaultValue: "Истекли"), funnel.expired)
                    row(String(localized: "uadmin.dash.inv.revoked", defaultValue: "Отозваны"), funnel.revoked)
                }
            }
        }
    }

    private func row(_ title: String, _ value: Int) -> some View {
        HStack {
            Text(title).foregroundStyle(Palette.mutedForeground)
            Spacer()
            Text(verbatim: value.formatted()).monospacedDigit().foregroundStyle(Palette.foreground)
        }
        .font(.subheadline)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Отчёт файлом

/// Отчёт по сводке за период (XLSX/CSV). Собирает сервер: область — из токена, факультет —
/// когда отчёт по одному факультету.
struct UAdminReportExportSheet: View {
    let facultyID: String?

    @Environment(\.dismiss) private var dismiss
    @State private var period = "quarter"
    @State private var format = "xlsx"
    @State private var isLoading = false
    @State private var failure: String?
    @State private var file: UAdminSharedFile?

    var body: some View {
        NavigationStack {
            Form {
                if let failure {
                    FormAlert(message: failure)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                Section {
                    Picker(String(localized: "uadmin.report.period", defaultValue: "Период"), selection: $period) {
                        Text(String(localized: "uadmin.report.month", defaultValue: "Последние 30 дней")).tag("month")
                        Text(String(localized: "uadmin.report.quarter", defaultValue: "Последние 90 дней")).tag("quarter")
                        Text(String(localized: "uadmin.report.year", defaultValue: "Учебный год")).tag("year")
                    }
                    Picker(String(localized: "uadmin.report.format", defaultValue: "Формат"), selection: $format) {
                        Text(verbatim: "Excel (XLSX)").tag("xlsx")
                        Text(verbatim: "CSV").tag("csv")
                    }
                } footer: {
                    Text(String(localized: "uadmin.report.hint", defaultValue: "Посещаемость, успеваемость, экзамены, заявки и активность по подразделениям. Только агрегаты: подразделение меньше 5 студентов выгружается без чисел."))
                }
            }
            .navigationTitle(Text(String(localized: "uadmin.report.title", defaultValue: "Отчёт по сводке")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isLoading {
                        ProgressView()
                    } else {
                        Button(String(localized: "uadmin.report.submit", defaultValue: "Выгрузить")) { Task { await download() } }
                    }
                }
            }
            .sheet(item: $file) { file in
                UAdminActivitySheet(items: [file.url])
            }
        }
    }

    @MainActor
    private func download() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let data = try await UAdminAPI().exportReport(period: period, format: format, facultyID: facultyID)
            let stamp = UAdminDay.string(Date())
            file = try UAdminSharedFile.write(data, name: "studenthub-report-\(period)-\(stamp).\(format)")
            failure = nil
        } catch {
            failure = error.userMessage
        }
    }
}
