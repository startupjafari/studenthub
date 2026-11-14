import Charts
import SwiftUI

// MARK: - Обзор платформы

/// Обзор администратора и модератора платформы: плитки состояния и графики за период.
/// Период один на все графики — иначе плитки и графики показывали бы разные срезы.
///
/// Порядок — от главного к частностям: период, показатели, графики одной темы, детализация
/// по вузам. Восемь графиков подряд на телефоне не читаются — их листают, не глядя.
/// Поэтому графики разложены по темам («Пользователи», «Жалобы», «Активность»): на экране
/// одна тема, остальные в одном касании переключателя.
struct AdminPlatformDashboardView: View {
    private enum Topic: Hashable { case users, complaints, activity }

    @State private var days = 30
    @State private var topic: Topic = .users
    /// Сводка, графики периода и размер вузов — три независимых значения
    /// (`RemoteValue`): падение одного не прячет остальные.
    @State private var overviewRemote = RemoteValue<AdminPlatformOverviewDTO>()
    @State private var rangeRemote = RemoteValue<RangeData>()
    @State private var sizesRemote = RemoteValue<AdminUniversitiesSizeDTO>()

    private let api = AdminAPI()

    /// Графики периода. Каждый — сам по себе: не пришёл — `nil`, остальные на месте.
    private struct RangeData {
        var growth: AdminSeriesDTO?
        var active: AdminSeriesDTO?
        var flow: AdminSeriesDTO?
        var latency: AdminLatencyDTO?
        var invites: AdminInvitesFunnelDTO?
        var heatmap: AdminHeatmapDTO?
        var actions: AdminTopActionsDTO?
    }

    private var overview: AdminPlatformOverviewDTO? { overviewRemote.value }
    private var growth: AdminSeriesDTO? { rangeRemote.value?.growth }
    private var active: AdminSeriesDTO? { rangeRemote.value?.active }
    private var flow: AdminSeriesDTO? { rangeRemote.value?.flow }
    private var latency: AdminLatencyDTO? { rangeRemote.value?.latency }
    private var invites: AdminInvitesFunnelDTO? { rangeRemote.value?.invites }
    private var heatmap: AdminHeatmapDTO? { rangeRemote.value?.heatmap }
    private var actions: AdminTopActionsDTO? { rangeRemote.value?.actions }
    private var sizes: AdminUniversitiesSizeDTO? { sizesRemote.value }
    /// Запросы периода уже отвечали: пустой график после этого — сбой, а не загрузка.
    private var rangeLoaded: Bool { rangeRemote.value != nil }
    private var sizesTried: Bool { sizesRemote.failure != nil }

    var body: some View {
        List {
            DashboardPeriodPicker(
                title: String(localized: "admin.dash.range", defaultValue: "Период"),
                selection: $days,
                options: [7, 30, 90].map { value in
                    (value, String(localized: "admin.dash.rangeDays", defaultValue: "\(value.formatted()) дней"))
                }
            )

            if overview == nil, let overviewFailure = overviewRemote.failure {
                Section {
                    ErrorStateView(message: overviewFailure, isOffline: overviewRemote.isOffline) { await loadOverview() }
                }
                .listRowBackground(Color.clear)
            } else {
                DashboardMetricsSection(metrics: kpis(overview))
            }

            DashboardPeriodPicker(
                title: String(localized: "admin.dash.topic", defaultValue: "Тема"),
                selection: $topic,
                options: [
                    (Topic.users, String(localized: "admin.dash.topic.users", defaultValue: "Пользователи")),
                    (Topic.complaints, String(localized: "admin.dash.topic.complaints", defaultValue: "Жалобы")),
                    (Topic.activity, String(localized: "admin.dash.topic.activity", defaultValue: "Активность")),
                ]
            )

            switch topic {
            case .users: usersCharts
            case .complaints: complaintsCharts
            case .activity: activityCharts
            }

            DashboardCardSection(
                title: String(localized: "admin.dash.size", defaultValue: "Размер вузов"),
                subtitle: String(localized: "admin.dash.sizeHint", defaultValue: "Крупнейшие вузы по числу пользователей")
            ) {
                if let sizes {
                    let top = Array(sizes.items.prefix(8))
                    if top.isEmpty {
                        DashboardEmptyPlaceholder(text: String(localized: "admin.stats.nothing", defaultValue: "Ничего не найдено"), symbol: "building.columns")
                    } else {
                        let largest = Double(max(top.first?.total ?? 1, 1))
                        DashboardBarList(bars: top.map { item in
                            DashboardBar(label: item.shortName ?? item.name, fraction: Double(item.total) / largest, valueText: item.total.formatted())
                        })
                    }
                } else if sizesTried {
                    DashboardFailurePlaceholder { await loadSizes() }
                } else {
                    DashboardLoadingPlaceholder()
                }
            } footer: {
                if let sizes {
                    NavigationLink(value: AppRoute.admin(.stats)) {
                        DashboardMoreLabel(title: String(localized: "admin.dash.showAll", defaultValue: "Все вузы (\(sizes.totals.universities.formatted()))"))
                    }
                }
            }
        }
        .dashboardListStyle()
        .navigationTitle(Text(AdminScreen.platformDashboard.title))
        .pullToRefresh {
            await loadOverview()
            await loadRange()
        }
        // Возврат приложения из фона после долгой паузы — повод перечитать (`AppLifecycle`).
        .task(id: AppLifecycle.shared.foregroundEpoch) { await loadOverview() }
        .task(id: [days, AppLifecycle.shared.foregroundEpoch]) { await loadRange() }
    }

    /// Пользователи: главный график — рост; ниже — доходят ли приглашения до регистрации.
    @ViewBuilder
    private var usersCharts: some View {
        chart(
            String(localized: "admin.dash.growth", defaultValue: "Рост пользователей"),
            hint: String(localized: "admin.dash.growthHint", defaultValue: "Новые регистрации за период, по группам ролей"),
            growth
        ) { AdminSeriesChart(series: $0, label: Self.seriesLabel) }
        chart(
            String(localized: "admin.dash.invites", defaultValue: "Воронка приглашений"),
            hint: invites.map {
                String(localized: "admin.dash.invitesConversion", defaultValue: "Конверсия в регистрацию: \(DisplayFormat.percent($0.conversion)) · выдано \($0.total.formatted())")
            } ?? String(localized: "admin.dash.invitesHint", defaultValue: "Доходят ли приглашения до регистрации"),
            invites
        ) { invites in
            AdminBarChart(bars: ["USED", "PENDING", "EXPIRED", "REVOKED"].map { key in
                (AdminText.inviteStatus(key).text, invites.byStatus.first { $0.key == key }?.value ?? 0)
            })
        }
    }

    /// Жалобы: сколько пришло и разобрано, и как быстро.
    @ViewBuilder
    private var complaintsCharts: some View {
        chart(
            String(localized: "admin.dash.flow", defaultValue: "Поток жалоб"),
            hint: String(localized: "admin.dash.flowHint", defaultValue: "Поступило и разобрано за период"),
            flow
        ) { AdminSeriesChart(series: $0, label: Self.seriesLabel) }
        chart(
            String(localized: "admin.dash.latency", defaultValue: "Время разбора жалоб"),
            hint: latency?.medianHours.map {
                String(localized: "admin.dash.latencyMedian", defaultValue: "Медиана: \(Self.hours($0))")
            } ?? String(localized: "admin.dash.latencyHint", defaultValue: "Распределение по времени от подачи до решения"),
            latency
        ) { latency in
            AdminBarChart(bars: Self.latencyOrder.map { key in
                (Self.latencyLabel(key), latency.buckets.first { $0.key == key }?.value ?? 0)
            })
        }
    }

    /// Активность: кто действует, в какие дни и что делает чаще всего.
    @ViewBuilder
    private var activityCharts: some View {
        chart(
            String(localized: "admin.dash.active", defaultValue: "Активные пользователи"),
            hint: String(localized: "admin.dash.activeHint", defaultValue: "Уникальные пользователи с действиями в журнале аудита"),
            active
        ) { AdminSeriesChart(series: $0, label: Self.seriesLabel) }
        chart(
            String(localized: "admin.dash.activity", defaultValue: "Активность по дням недели"),
            hint: String(localized: "admin.dash.activityHint", defaultValue: "События аудита в среднем за день недели"),
            heatmap
        ) { AdminBarChart(bars: Self.weekdayAverages($0)) }
        chart(
            String(localized: "admin.dash.actions", defaultValue: "Частые действия"),
            hint: String(localized: "admin.dash.actionsHint", defaultValue: "Топ действий в журнале аудита за период"),
            actions
        ) { actions in
            if actions.items.isEmpty {
                DashboardEmptyPlaceholder(text: DashboardText.periodNoData)
            } else {
                let top = max(actions.items.first?.value ?? 1, 1)
                DashboardBarList(bars: actions.items.map { item in
                    DashboardBar(label: item.action, fraction: item.value / top, valueText: JSONValue.format(item.value))
                })
            }
        }
    }

    /// Карточка графика периода: загрузка, сбой или содержимое.
    private func chart<Value, Content: View>(
        _ title: String,
        hint: String,
        _ value: Value?,
        @ViewBuilder content: @escaping (Value) -> Content
    ) -> some View {
        AdminChartSection(
            title: title,
            hint: hint,
            isLoaded: value != nil,
            failed: rangeLoaded && value == nil,
            retry: { await loadRange() }
        ) {
            if let value { content(value) }
        }
    }

    /// Пока сводка грузится, плитки уже стоят на местах — экран не прыгает.
    private func kpis(_ overview: AdminPlatformOverviewDTO?) -> [DashboardMetric] {
        let pending = overview == nil
        return [
            DashboardMetric(
                title: String(localized: "admin.dash.kpiUniversities", defaultValue: "Вузов активно"),
                value: overview?.universities.active.formatted(),
                symbol: "building.columns",
                tint: TileTint.indigo,
                caption: overview.map {
                    String(localized: "admin.dash.kpiUniversitiesHint", defaultValue: "ожидают активации: \($0.universities.pending.formatted())")
                },
                route: .admin(.stats),
                isPending: pending
            ),
            DashboardMetric(
                title: String(localized: "admin.dash.kpiUsers", defaultValue: "Пользователей"),
                value: overview?.users.total.formatted(),
                symbol: "person.2",
                tint: TileTint.blue,
                isPending: pending
            ),
            DashboardMetric(
                title: String(localized: "admin.dash.kpiComplaints", defaultValue: "Жалоб в очереди"),
                value: overview?.complaints.pending.formatted(),
                symbol: "exclamationmark.bubble",
                tint: TileTint.red,
                route: .admin(.complaints),
                isPending: pending
            ),
            DashboardMetric(
                title: String(localized: "admin.dash.kpiResolution", defaultValue: "Медиана разбора"),
                value: overview?.resolutionHours.median.map(Self.hours),
                symbol: "timer",
                tint: TileTint.orange,
                caption: overview.flatMap { Self.delta($0.resolutionHours) },
                isPending: pending
            ),
            DashboardMetric(
                title: String(localized: "admin.dash.kpiDau", defaultValue: "Активны за сутки"),
                value: overview?.activeUsers.dau.formatted(),
                symbol: "waveform.path.ecg",
                tint: TileTint.green,
                caption: overview.map {
                    String(localized: "admin.dash.kpiWau", defaultValue: "за неделю: \($0.activeUsers.wau.formatted())")
                },
                isPending: pending
            ),
        ]
    }

    // MARK: Загрузка

    private func loadOverview() async {
        await overviewRemote.load(api.platformOverview)
        await loadSizes()
    }

    private func loadSizes() async {
        await sizesRemote.load(api.universitiesSize)
    }

    private func loadRange() async {
        let range = AdminPlatformRange.last(days: days)
        await rangeRemote.load { await Self.rangeData(api, range) }
    }

    /// Графики периода грузятся вместе, а падение одного не прячет остальные.
    private static func rangeData(_ api: AdminAPI, _ range: AdminPlatformRange) async -> RangeData {
        async let growth = try? api.platformSeries("users-growth", range: range)
        async let active = try? api.platformSeries("active-users", range: range)
        async let flow = try? api.platformSeries("complaints-flow", range: range)
        async let latency = try? api.complaintsLatency(range: range)
        async let invites = try? api.invitesFunnel(range: range)
        async let heatmap = try? api.activityHeatmap(range: range)
        async let actions = try? api.topActions(range: range)
        return await RangeData(
            growth: growth, active: active, flow: flow, latency: latency,
            invites: invites, heatmap: heatmap, actions: actions
        )
    }

    // MARK: Подписи

    private static let latencyOrder = ["lt1h", "lt4h", "lt1d", "lt3d", "lt7d", "gte7d"]

    private static func latencyLabel(_ key: String) -> String {
        switch key {
        case "lt1h": return String(localized: "admin.dash.lt1h", defaultValue: "до 1 ч")
        case "lt4h": return String(localized: "admin.dash.lt4h", defaultValue: "1–4 ч")
        case "lt1d": return String(localized: "admin.dash.lt1d", defaultValue: "4–24 ч")
        case "lt3d": return String(localized: "admin.dash.lt3d", defaultValue: "1–3 дн.")
        case "lt7d": return String(localized: "admin.dash.lt7d", defaultValue: "3–7 дн.")
        case "gte7d": return String(localized: "admin.dash.gte7d", defaultValue: "больше 7 дн.")
        default: return key
        }
    }

    static func seriesLabel(_ key: String) -> String {
        switch key {
        case "students": return String(localized: "admin.dash.series.students", defaultValue: "Студенты")
        case "teachers": return String(localized: "admin.dash.series.teachers", defaultValue: "Преподаватели")
        case "staff": return String(localized: "admin.dash.series.staff", defaultValue: "Сотрудники")
        case "dau": return String(localized: "admin.dash.series.dau", defaultValue: "За сутки")
        case "wau": return String(localized: "admin.dash.series.wau", defaultValue: "За неделю")
        case "created": return String(localized: "admin.dash.series.created", defaultValue: "Поступило")
        case "resolved": return String(localized: "admin.dash.series.resolved", defaultValue: "Разобрано")
        default: return key
        }
    }

    private static func hours(_ value: Double) -> String {
        let rounded = value < 10 ? (value * 10).rounded() / 10 : value.rounded()
        return String(localized: "admin.dash.hours", defaultValue: "\(JSONValue.format(rounded)) ч")
    }

    private static func delta(_ resolution: AdminPlatformOverviewDTO.Resolution) -> String? {
        guard let now = resolution.median, let before = resolution.previousMedian else {
            return String(localized: "admin.dash.kpiResolutionHint", defaultValue: "жалобы за 30 дней")
        }
        let diff = now - before
        guard abs(diff) >= 0.1 else { return nil }
        return diff < 0
            ? String(localized: "admin.dash.faster", defaultValue: "быстрее на \(hours(abs(diff)))")
            : String(localized: "admin.dash.slower", defaultValue: "медленнее на \(hours(diff))")
    }

    /// Среднее событий за день недели: понедельников в окне бывает больше, чем суббот.
    private static func weekdayAverages(_ heatmap: AdminHeatmapDTO) -> [(String, Double)] {
        let names = [
            String(localized: "admin.weekday.mon", defaultValue: "Пн"), String(localized: "admin.weekday.tue", defaultValue: "Вт"),
            String(localized: "admin.weekday.wed", defaultValue: "Ср"), String(localized: "admin.weekday.thu", defaultValue: "Чт"),
            String(localized: "admin.weekday.fri", defaultValue: "Пт"), String(localized: "admin.weekday.sat", defaultValue: "Сб"),
            String(localized: "admin.weekday.sun", defaultValue: "Вс"),
        ]
        return names.enumerated().map { index, name in
            let total = heatmap.cells.indices.contains(index) ? heatmap.cells[index].reduce(0, +) : 0
            let count = heatmap.days.indices.contains(index) ? heatmap.days[index] : 0
            return (name, count > 0 ? total / Double(count) : 0)
        }
    }
}

/// Секция-карточка графика: заголовок, пояснение, загрузка или сбой.
struct AdminChartSection<Content: View>: View {
    let title: String
    var hint: String?
    let isLoaded: Bool
    var failed = false
    var retry: (() async -> Void)?
    @ViewBuilder let content: () -> Content

    var body: some View {
        DashboardCardSection(title: title, subtitle: hint) {
            if isLoaded {
                content()
            } else if failed, let retry {
                DashboardFailurePlaceholder(retry: retry)
            } else {
                DashboardLoadingPlaceholder()
            }
        }
    }
}

/// Линии по корзинам времени — по ряду на ключ.
struct AdminSeriesChart: View {
    let series: AdminSeriesDTO
    let label: (String) -> String

    var body: some View {
        let empty = series.series.allSatisfy { $0.points.allSatisfy { $0.value == 0 } }
        if empty {
            DashboardEmptyPlaceholder(text: DashboardText.periodNoData, symbol: "chart.xyaxis.line")
        } else {
            Chart {
                ForEach(series.series, id: \.key) { line in
                    ForEach(line.points, id: \.at) { point in
                        LineMark(
                            x: .value(String(localized: "admin.chart.date", defaultValue: "Дата"), point.at),
                            y: .value(String(localized: "admin.chart.value", defaultValue: "Значение"), point.value)
                        )
                        .foregroundStyle(by: .value(String(localized: "admin.chart.series", defaultValue: "Ряд"), label(line.key)))
                        .interpolationMethod(.monotone)
                        .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
                    }
                }
            }
            .chartLegend(position: .bottom, alignment: .leading)
            .frame(height: DashboardMetrics.chartHeight)
        }
    }
}

/// Столбцы по категориям: корзины времени, статусы, дни недели.
struct AdminBarChart: View {
    let bars: [(String, Double)]

    var body: some View {
        if bars.allSatisfy({ $0.1 == 0 }) {
            DashboardEmptyPlaceholder(text: DashboardText.periodNoData)
        } else {
            Chart {
                ForEach(Array(bars.enumerated()), id: \.offset) { _, bar in
                    BarMark(
                        x: .value(String(localized: "admin.chart.category", defaultValue: "Категория"), bar.0),
                        y: .value(String(localized: "admin.chart.value", defaultValue: "Значение"), bar.1)
                    )
                    .foregroundStyle(Palette.primary)
                    .cornerRadius(4)
                }
            }
            .frame(height: DashboardMetrics.chartHeight)
        }
    }
}

// MARK: - Статистика платформы

/// Показатели по каждому вузу платформы: люди, факультеты, группы, аудитории.
struct AdminPlatformStatsView: View {
    @State private var reloadToken = 0
    @State private var search = ""

    /// Показатели и названия городов по кодам КАТО — одним значением: из сохранённого
    /// экран встаёт сразу с городами.
    private struct Loaded {
        let data: AdminUniversitiesSizeDTO
        let cities: [String: String]
    }

    var body: some View {
        RemoteContent(reloadToken: reloadToken, load: Self.load) { loaded in
            let data = loaded.data
            List {
                DashboardMetricsSection(metrics: [
                    DashboardMetric(title: String(localized: "admin.stats.universities", defaultValue: "Университеты"), value: data.totals.universities.formatted(), symbol: "building.columns", tint: TileTint.indigo, caption: String(localized: "admin.stats.active", defaultValue: "активных: \(data.totals.active.formatted())")),
                    DashboardMetric(title: String(localized: "admin.stats.people", defaultValue: "Всего людей"), value: data.totals.total.formatted(), symbol: "person.2", tint: TileTint.blue),
                    DashboardMetric(title: String(localized: "admin.stats.students", defaultValue: "Студенты"), value: data.totals.students.formatted(), symbol: "graduationcap", tint: TileTint.teal),
                    DashboardMetric(title: String(localized: "admin.stats.teachers", defaultValue: "Преподаватели"), value: data.totals.teachers.formatted(), symbol: "person.crop.rectangle", tint: TileTint.purple),
                    DashboardMetric(title: String(localized: "admin.stats.faculties", defaultValue: "Факультеты"), value: data.totals.faculties.formatted(), symbol: "building.2", tint: TileTint.green),
                    DashboardMetric(title: String(localized: "admin.stats.groups", defaultValue: "Группы"), value: data.totals.groups.formatted(), symbol: "person.3", tint: TileTint.orange),
                ])

                let items = filtered(data.items)
                Section {
                    if items.isEmpty {
                        DashboardEmptyRow(text: String(localized: "admin.stats.nothing", defaultValue: "Ничего не найдено"), symbol: "magnifyingglass")
                    }
                    ForEach(items) { item in
                        NavigationLink(value: AppRoute.admin(.university(id: item.id))) {
                            AdminUniversitySizeRow(item: item, city: item.city.flatMap { loaded.cities[$0] })
                        }
                    }
                } footer: {
                    if data.items.count < data.totals.universities {
                        Text(String(localized: "admin.stats.shown", defaultValue: "Показано вузов: \(data.items.count.formatted()) из \(data.totals.universities.formatted()), крупнейшие первыми"))
                    }
                }
            }
            .dashboardListStyle()
            .pullToRefresh { reloadToken += 1 }
        }
        .navigationTitle(Text(AdminScreen.stats.title))
        .listSearch(text: $search, prompt: Text(String(localized: "admin.stats.search", defaultValue: "Поиск вуза")))
    }

    private func filtered(_ items: [AdminUniversitiesSizeDTO.Item]) -> [AdminUniversitiesSizeDTO.Item] {
        let needle = search.trimmingCharacters(in: .whitespaces)
        guard !needle.isEmpty else { return items }
        return items.filter {
            $0.name.localizedCaseInsensitiveContains(needle) || ($0.shortName?.localizedCaseInsensitiveContains(needle) ?? false)
        }
    }

    private static func load() async throws -> Loaded {
        let data = try await AdminAPI().universitiesSize()
        // Города — подпись, не повод для ошибки: не пришли — строки без города.
        let units = (try? await AdminAPI().katoResolve(data.items.compactMap(\.city))) ?? []
        return Loaded(data: data, cities: Dictionary(units.map { ($0.code, $0.nameRu) }, uniquingKeysWith: { first, _ in first }))
    }
}

private struct AdminUniversitySizeRow: View {
    let item: AdminUniversitiesSizeDTO.Item
    let city: String?

    var body: some View {
        let status = AdminText.universityStatus(item.status)
        ListCardRow(
            title: item.name,
            subtitle: [item.shortName, city].compactMap { $0 }.joined(separator: " · "),
            status: (text: status.text, tint: status.tint),
            lines: [
                String(localized: "admin.stats.rowPeople", defaultValue: "Людей: \(item.total.formatted()) · студентов \(item.students.formatted()) · преподавателей \(item.teachers.formatted())"),
                String(localized: "admin.stats.rowStructure", defaultValue: "Факультетов \(item.faculties.formatted()) · групп \(item.groups.formatted()) · аудиторий \(item.rooms.formatted())"),
            ]
        )
    }
}

// MARK: - Обзор модератора вуза

/// Обзор модератора вуза: состояние очереди модерации — сколько ждёт, что горит, на что
/// жалуются и что уже сделано. Отдельной сводной ручки нет: считается по первым 200
/// записям — на объёмах очереди вуза это вся выборка, как и в вебе.
struct AdminUniversityModeratorDashboardView: View {
    @State private var pending: Page<AdminComplaintDTO>?
    @State private var high: Int?
    /// `nil` — ещё не пришло или не загрузилось: график потока не рисует нули вместо сбоя.
    @State private var recent: [AdminComplaintDTO]?
    @State private var recentFailed = false
    @State private var blocked: Int?
    /// `nil` — ещё не пришло или не загрузилось: «Записей нет» только для настоящей пустоты.
    @State private var audit: [AdminAuditEntryDTO]?
    @State private var auditFailure: String?
    @State private var failure: String?
    @State private var isOffline = false

    private static let scan = 200
    private static let flowDays = 14

    var body: some View {
        List {
            if let pending {
                DashboardMetricsSection(metrics: kpis(pending))

                AdminChartSection(
                    title: String(localized: "admin.mod.flow", defaultValue: "Поток жалоб"),
                    hint: String(localized: "admin.mod.flowHint", defaultValue: "Поступило и разобрано по дням за две недели: успеваете ли за потоком"),
                    isLoaded: recent != nil,
                    failed: recentFailed,
                    retry: { await load() }
                ) {
                    AdminSeriesChart(series: flowSeries(recent ?? []), label: AdminPlatformDashboardView.seriesLabel)
                }
                AdminChartSection(
                    title: String(localized: "admin.mod.targets", defaultValue: "На что жалуются"),
                    hint: String(localized: "admin.mod.targetsHint", defaultValue: "Категории целей в текущей очереди. На людей и личные сообщения — высокий приоритет"),
                    isLoaded: true
                ) {
                    AdminBarChart(bars: ["USER", "MESSAGE", "POST", "STORY", "COMMENT"].map { key in
                        (AdminText.target(key), Double(pending.items.filter { $0.targetType == key }.count))
                    })
                }
                AdminChartSection(
                    title: String(localized: "admin.mod.aging", defaultValue: "Сколько ждут разбора"),
                    hint: String(localized: "admin.mod.agingHint", defaultValue: "Возраст жалоб в очереди. Всё, что старше суток, — просрочка"),
                    isLoaded: true
                ) {
                    let aging = Self.aging(pending.items)
                    AdminBarChart(bars: [
                        (String(localized: "admin.mod.agingDay", defaultValue: "До суток"), Double(aging.0)),
                        (String(localized: "admin.mod.agingThree", defaultValue: "1–3 дня"), Double(aging.1)),
                        (String(localized: "admin.mod.agingOlder", defaultValue: "Больше 3 дней"), Double(aging.2)),
                    ])
                }

                Section {
                    if pending.items.isEmpty {
                        DashboardEmptyRow(text: String(localized: "admin.complaints.empty", defaultValue: "Жалоб нет"), tint: Palette.success)
                    }
                    ForEach(pending.items.prefix(5)) { complaint in
                        NavigationLink(value: AppRoute.admin(.complaint(id: complaint.id))) {
                            AdminComplaintRow(complaint: complaint)
                        }
                    }
                    NavigationLink(value: AppRoute.admin(.complaints)) {
                        DashboardMoreLabel(title: String(localized: "admin.mod.openQueue", defaultValue: "Открыть очередь"))
                    }
                } header: {
                    DashboardSectionHeader(
                        title: String(localized: "admin.mod.oldest", defaultValue: "Старейшие в очереди"),
                        subtitle: String(localized: "admin.mod.oldestHint", defaultValue: "С них начинают разбор: ждут дольше всех")
                    )
                }

                Section {
                    if let audit {
                        if audit.isEmpty {
                            DashboardEmptyRow(text: String(localized: "admin.audit.empty", defaultValue: "Записей нет"), symbol: "list.bullet.rectangle")
                        }
                        ForEach(audit.prefix(5)) { entry in
                            AdminAuditRow(entry: entry)
                        }
                    } else if let auditFailure {
                        DashboardFailurePlaceholder(message: auditFailure) { await load() }
                    } else {
                        DashboardLoadingPlaceholder(height: 80)
                    }
                    NavigationLink(value: AppRoute.admin(.audit)) {
                        DashboardMoreLabel(title: String(localized: "admin.mod.openAudit", defaultValue: "Открыть журнал"))
                    }
                } header: {
                    DashboardSectionHeader(
                        title: String(localized: "admin.mod.myActions", defaultValue: "Мои последние действия"),
                        subtitle: String(localized: "admin.mod.myActionsHint", defaultValue: "Журнал показывает модератору только его собственные действия")
                    )
                }
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .dashboardListStyle()
        .navigationTitle(Text(AdminScreen.universityModeratorDashboard.title))
        .pullToRefresh { await load() }
        .task { await load() }
    }

    private func kpis(_ pending: Page<AdminComplaintDTO>) -> [DashboardMetric] {
        let total = pending.meta?.total ?? pending.items.count
        let aging = Self.aging(pending.items)
        let overdue = aging.1 + aging.2
        // Вся страница старых просрочена, а очередь длиннее — точнее «не меньше» не сказать.
        let saturated = !pending.items.isEmpty && overdue == pending.items.count && total > pending.items.count
        let weekAgo = Date().addingTimeInterval(-7 * 86_400)
        // Журнал не загрузился — прочерк, а не «0 разобрано».
        let resolvedWeek = audit?.filter { $0.action == "complaint_resolved" && $0.createdAt >= weekAgo }.count
        return [
            DashboardMetric(title: String(localized: "admin.mod.kpiQueue", defaultValue: "В очереди"), value: total.formatted(), symbol: "tray.full", tint: TileTint.blue, route: .admin(.complaints)),
            DashboardMetric(title: String(localized: "admin.mod.kpiHigh", defaultValue: "Высокий приоритет"), value: high.map { $0.formatted() }, symbol: "flame", tint: TileTint.red),
            DashboardMetric(title: String(localized: "admin.mod.kpiOverdue", defaultValue: "Ждут дольше суток"), value: saturated ? "\(overdue.formatted())+" : overdue.formatted(), symbol: "clock.badge.exclamationmark", tint: TileTint.orange),
            DashboardMetric(title: String(localized: "admin.mod.kpiResolvedWeek", defaultValue: "Разобрано за 7 дней"), value: resolvedWeek.map { $0.formatted() }, symbol: "checkmark.seal", tint: TileTint.green),
            DashboardMetric(title: String(localized: "admin.mod.kpiBlocked", defaultValue: "Заблокировано"), value: blocked.map { $0.formatted() }, symbol: "nosign", tint: TileTint.gray),
        ]
    }

    /// Поступило (`createdAt`) против разобрано (`resolvedAt`) по дням за две недели.
    private func flowSeries(_ recent: [AdminComplaintDTO]) -> AdminSeriesDTO {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        let days = (0..<Self.flowDays).compactMap { calendar.date(byAdding: .day, value: -(Self.flowDays - 1 - $0), to: today) }
        func count(_ dates: [Date]) -> [AdminSeriesDTO.Point] {
            days.map { day in
                AdminSeriesDTO.Point(at: day, value: Double(dates.filter { calendar.isDate($0, inSameDayAs: day) }.count))
            }
        }
        return AdminSeriesDTO(interval: "day", series: [
            AdminSeriesDTO.Line(key: "created", points: count(recent.map(\.createdAt))),
            AdminSeriesDTO.Line(key: "resolved", points: count(recent.compactMap(\.resolvedAt))),
        ])
    }

    private static func aging(_ items: [AdminComplaintDTO]) -> (Int, Int, Int) {
        let now = Date()
        var fresh = 0, days = 0, older = 0
        for item in items {
            let age = now.timeIntervalSince(item.createdAt)
            if age < 86_400 { fresh += 1 } else if age < 3 * 86_400 { days += 1 } else { older += 1 }
        }
        return (fresh, days, older)
    }

    @MainActor
    private func load() async {
        let api = AdminAPI()
        let limit = String(Self.scan)
        do {
            pending = try await api.complaintsSample(params: ["status": "PENDING", "sort": "createdAt", "order": "asc", "limit": limit])
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
            return
        }
        async let highPage = try? api.complaintsSample(params: ["status": "PENDING", "priority": "HIGH", "limit": "1"])
        async let recentPage = Self.attempt { try await api.complaintsSample(params: ["sort": "createdAt", "order": "desc", "limit": limit]) }
        async let blockedPage = try? api.users(role: nil, search: nil, blocked: true, request: PageRequest(cursor: nil, page: 1, limit: 1))
        async let auditPage = Self.attempt { try await api.auditSample(params: ["sort": "createdAt", "order": "desc", "limit": "100"]) }
        let (h, r, b, a) = await (highPage, recentPage, blockedPage, auditPage)
        high = h?.meta?.total ?? h?.items.count
        blocked = b?.meta?.total ?? b?.items.count
        // Сбой обновления не стирает уже показанное: прежние данные остаются на месте.
        switch r {
        case .success(let page):
            recent = page.items
            recentFailed = false
        case .failure(let error):
            if !(error is CancellationError) { recentFailed = recent == nil }
        }
        switch a {
        case .success(let page):
            audit = page.items
            auditFailure = nil
        case .failure(let error):
            if audit == nil, !(error is CancellationError) { auditFailure = error.userMessage }
        }
    }

    /// Запрос, сбой которого нужно отличить от пустого ответа: `try?` превратил бы его
    /// в «нет данных».
    private nonisolated static func attempt<T>(_ request: () async throws -> T) async -> Result<T, Error> {
        do {
            return .success(try await request())
        } catch {
            return .failure(error)
        }
    }
}
