import Charts
import SwiftUI

// MARK: - Обзор платформы

/// Обзор администратора и модератора платформы: плитки состояния и графики за период.
/// Период один на все графики — иначе плитки и графики показывали бы разные срезы.
struct AdminPlatformDashboardView: View {
    @State private var days = 30
    @State private var overview: AdminPlatformOverviewDTO?
    @State private var overviewFailure: String?
    @State private var isOffline = false
    @State private var growth: AdminSeriesDTO?
    @State private var active: AdminSeriesDTO?
    @State private var flow: AdminSeriesDTO?
    @State private var latency: AdminLatencyDTO?
    @State private var invites: AdminInvitesFunnelDTO?
    @State private var heatmap: AdminHeatmapDTO?
    @State private var actions: AdminTopActionsDTO?
    @State private var sizes: AdminUniversitiesSizeDTO?

    private let api = AdminAPI()

    var body: some View {
        List {
            Section {
                Picker(String(localized: "admin.dash.range", defaultValue: "Период"), selection: $days) {
                    ForEach([7, 30, 90], id: \.self) { value in
                        Text(String(localized: "admin.dash.rangeDays", defaultValue: "\(value.formatted()) дней")).tag(value)
                    }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }

            Section {
                if let overview {
                    kpis(overview)
                } else if let overviewFailure {
                    ErrorStateView(message: overviewFailure, isOffline: isOffline) { await loadOverview() }
                } else {
                    LoadingStateView()
                }
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())

            AdminChartSection(
                title: String(localized: "admin.dash.growth", defaultValue: "Рост пользователей"),
                hint: String(localized: "admin.dash.growthHint", defaultValue: "Новые регистрации за период, по группам ролей"),
                isLoaded: growth != nil
            ) {
                if let growth { AdminSeriesChart(series: growth, label: Self.seriesLabel) }
            }
            AdminChartSection(
                title: String(localized: "admin.dash.active", defaultValue: "Активные пользователи"),
                hint: String(localized: "admin.dash.activeHint", defaultValue: "Уникальные пользователи с действиями в журнале аудита"),
                isLoaded: active != nil
            ) {
                if let active { AdminSeriesChart(series: active, label: Self.seriesLabel) }
            }
            AdminChartSection(
                title: String(localized: "admin.dash.flow", defaultValue: "Поток жалоб"),
                hint: String(localized: "admin.dash.flowHint", defaultValue: "Поступило и разобрано за период"),
                isLoaded: flow != nil
            ) {
                if let flow { AdminSeriesChart(series: flow, label: Self.seriesLabel) }
            }
            AdminChartSection(
                title: String(localized: "admin.dash.latency", defaultValue: "Время разбора жалоб"),
                hint: latency?.medianHours.map {
                    String(localized: "admin.dash.latencyMedian", defaultValue: "Медиана: \(Self.hours($0))")
                } ?? String(localized: "admin.dash.latencyHint", defaultValue: "Распределение по времени от подачи до решения"),
                isLoaded: latency != nil
            ) {
                if let latency {
                    AdminBarChart(bars: Self.latencyOrder.map { key in
                        (Self.latencyLabel(key), latency.buckets.first { $0.key == key }?.value ?? 0)
                    })
                }
            }
            AdminChartSection(
                title: String(localized: "admin.dash.invites", defaultValue: "Воронка приглашений"),
                hint: invites.map {
                    String(localized: "admin.dash.invitesConversion", defaultValue: "Конверсия в регистрацию: \(DisplayFormat.percent($0.conversion)) · выдано \($0.total.formatted())")
                } ?? String(localized: "admin.dash.invitesHint", defaultValue: "Доходят ли приглашения до регистрации"),
                isLoaded: invites != nil
            ) {
                if let invites {
                    AdminBarChart(bars: ["USED", "PENDING", "EXPIRED", "REVOKED"].map { key in
                        (AdminText.inviteStatus(key).text, invites.byStatus.first { $0.key == key }?.value ?? 0)
                    })
                }
            }
            AdminChartSection(
                title: String(localized: "admin.dash.activity", defaultValue: "Активность по дням недели"),
                hint: String(localized: "admin.dash.activityHint", defaultValue: "События аудита в среднем за день недели"),
                isLoaded: heatmap != nil
            ) {
                if let heatmap { AdminBarChart(bars: Self.weekdayAverages(heatmap)) }
            }
            AdminChartSection(
                title: String(localized: "admin.dash.actions", defaultValue: "Частые действия"),
                hint: String(localized: "admin.dash.actionsHint", defaultValue: "Топ действий в журнале аудита за период"),
                isLoaded: actions != nil
            ) {
                if let actions {
                    ForEach(Array(actions.items.enumerated()), id: \.offset) { _, item in
                        ShareBar(
                            title: item.action,
                            fraction: item.value / max(actions.items.first?.value ?? 1, 1),
                            valueText: JSONValue.format(item.value)
                        )
                    }
                }
            }
            AdminChartSection(
                title: String(localized: "admin.dash.size", defaultValue: "Размер вузов"),
                hint: String(localized: "admin.dash.sizeHint", defaultValue: "Крупнейшие вузы по числу пользователей"),
                isLoaded: sizes != nil
            ) {
                if let sizes {
                    let top = Array(sizes.items.prefix(8))
                    ForEach(top) { item in
                        ShareBar(
                            title: item.shortName ?? item.name,
                            fraction: Double(item.total) / Double(max(top.first?.total ?? 1, 1)),
                            valueText: item.total.formatted()
                        )
                    }
                    NavigationLink(value: AppRoute.admin(.stats)) {
                        Text(String(localized: "admin.dash.showAll", defaultValue: "Все вузы (\(sizes.totals.universities.formatted()))"))
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(AdminScreen.platformDashboard.title))
        .refreshable {
            await loadOverview()
            await loadRange()
        }
        .task { await loadOverview() }
        .task(id: days) { await loadRange() }
    }

    private func kpis(_ overview: AdminPlatformOverviewDTO) -> some View {
        StatGrid {
            StatTile(
                title: String(localized: "admin.dash.kpiUniversities", defaultValue: "Вузов активно"),
                value: overview.universities.active.formatted(),
                symbol: "building.columns",
                tint: TileTint.indigo,
                caption: String(localized: "admin.dash.kpiUniversitiesHint", defaultValue: "ожидают активации: \(overview.universities.pending.formatted())")
            )
            StatTile(
                title: String(localized: "admin.dash.kpiUsers", defaultValue: "Пользователей"),
                value: overview.users.total.formatted(),
                symbol: "person.2",
                tint: TileTint.blue
            )
            StatTile(
                title: String(localized: "admin.dash.kpiComplaints", defaultValue: "Жалоб в очереди"),
                value: overview.complaints.pending.formatted(),
                symbol: "exclamationmark.bubble",
                tint: TileTint.red
            )
            StatTile(
                title: String(localized: "admin.dash.kpiResolution", defaultValue: "Медиана разбора"),
                value: overview.resolutionHours.median.map(Self.hours) ?? "—",
                symbol: "timer",
                tint: TileTint.orange,
                caption: Self.delta(overview.resolutionHours)
            )
            StatTile(
                title: String(localized: "admin.dash.kpiDau", defaultValue: "Активны за сутки"),
                value: overview.activeUsers.dau.formatted(),
                symbol: "waveform.path.ecg",
                tint: TileTint.green,
                caption: String(localized: "admin.dash.kpiWau", defaultValue: "за неделю: \(overview.activeUsers.wau.formatted())")
            )
        }
    }

    // MARK: Загрузка

    @MainActor
    private func loadOverview() async {
        do {
            overview = try await api.platformOverview()
            overviewFailure = nil
        } catch is CancellationError {
            return
        } catch {
            overviewFailure = error.userMessage
            isOffline = error.isOffline
        }
        if sizes == nil { sizes = try? await api.universitiesSize() }
    }

    /// Графики периода грузятся вместе, а падение одного не прячет остальные.
    @MainActor
    private func loadRange() async {
        let range = AdminPlatformRange.last(days: days)
        async let growth = try? api.platformSeries("users-growth", range: range)
        async let active = try? api.platformSeries("active-users", range: range)
        async let flow = try? api.platformSeries("complaints-flow", range: range)
        async let latency = try? api.complaintsLatency(range: range)
        async let invites = try? api.invitesFunnel(range: range)
        async let heatmap = try? api.activityHeatmap(range: range)
        async let actions = try? api.topActions(range: range)
        let results = await (growth, active, flow, latency, invites, heatmap, actions)
        guard !Task.isCancelled else { return }
        self.growth = results.0
        self.active = results.1
        self.flow = results.2
        self.latency = results.3
        self.invites = results.4
        self.heatmap = results.5
        self.actions = results.6
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

/// Секция графика: заголовок, пояснение, загрузка.
struct AdminChartSection<Content: View>: View {
    let title: String
    var hint: String?
    let isLoaded: Bool
    @ViewBuilder let content: () -> Content

    var body: some View {
        Section {
            if isLoaded {
                content()
            } else {
                HStack {
                    Spacer()
                    ProgressView()
                    Spacer()
                }
            }
        } header: {
            Text(title)
        } footer: {
            if let hint { Text(hint) }
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
            Text(String(localized: "admin.chart.empty", defaultValue: "За период данных нет"))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
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
                    }
                }
            }
            .chartLegend(position: .bottom)
            .frame(height: 180)
            .padding(.vertical, Spacing.sm)
        }
    }
}

/// Столбцы по категориям: корзины времени, статусы, дни недели.
struct AdminBarChart: View {
    let bars: [(String, Double)]

    var body: some View {
        if bars.allSatisfy({ $0.1 == 0 }) {
            Text(String(localized: "admin.chart.empty", defaultValue: "За период данных нет"))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
        } else {
            Chart {
                ForEach(Array(bars.enumerated()), id: \.offset) { _, bar in
                    BarMark(
                        x: .value(String(localized: "admin.chart.category", defaultValue: "Категория"), bar.0),
                        y: .value(String(localized: "admin.chart.value", defaultValue: "Значение"), bar.1)
                    )
                    .foregroundStyle(Palette.primary)
                }
            }
            .frame(height: 170)
            .padding(.vertical, Spacing.sm)
        }
    }
}

// MARK: - Статистика платформы

/// Показатели по каждому вузу платформы: люди, факультеты, группы, аудитории.
struct AdminPlatformStatsView: View {
    @State private var data: AdminUniversitiesSizeDTO?
    @State private var failure: String?
    @State private var isOffline = false
    @State private var search = ""
    @State private var cities: [String: String] = [:]

    var body: some View {
        List {
            if let data {
                Section {
                    StatGrid {
                        StatTile(title: String(localized: "admin.stats.universities", defaultValue: "Университеты"), value: data.totals.universities.formatted(), symbol: "building.columns", tint: TileTint.indigo, caption: String(localized: "admin.stats.active", defaultValue: "активных: \(data.totals.active.formatted())"))
                        StatTile(title: String(localized: "admin.stats.people", defaultValue: "Всего людей"), value: data.totals.total.formatted(), symbol: "person.2", tint: TileTint.blue)
                        StatTile(title: String(localized: "admin.stats.students", defaultValue: "Студенты"), value: data.totals.students.formatted(), symbol: "graduationcap", tint: TileTint.teal)
                        StatTile(title: String(localized: "admin.stats.teachers", defaultValue: "Преподаватели"), value: data.totals.teachers.formatted(), symbol: "person.crop.rectangle", tint: TileTint.purple)
                        StatTile(title: String(localized: "admin.stats.faculties", defaultValue: "Факультеты"), value: data.totals.faculties.formatted(), symbol: "building.2", tint: TileTint.green)
                        StatTile(title: String(localized: "admin.stats.groups", defaultValue: "Группы"), value: data.totals.groups.formatted(), symbol: "person.3", tint: TileTint.orange)
                    }
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())

                let items = filtered(data.items)
                Section {
                    if items.isEmpty {
                        Text(String(localized: "admin.stats.nothing", defaultValue: "Ничего не найдено"))
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    ForEach(items) { item in
                        NavigationLink(value: AppRoute.admin(.university(id: item.id))) {
                            AdminUniversitySizeRow(item: item, city: item.city.flatMap { cities[$0] })
                        }
                    }
                } footer: {
                    if data.items.count < data.totals.universities {
                        Text(String(localized: "admin.stats.shown", defaultValue: "Показано вузов: \(data.items.count.formatted()) из \(data.totals.universities.formatted()), крупнейшие первыми"))
                    }
                }
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(AdminScreen.stats.title))
        .searchable(text: $search, prompt: Text(String(localized: "admin.stats.search", defaultValue: "Поиск вуза")))
        .refreshable { await load() }
        .task { await load() }
    }

    private func filtered(_ items: [AdminUniversitiesSizeDTO.Item]) -> [AdminUniversitiesSizeDTO.Item] {
        let needle = search.trimmingCharacters(in: .whitespaces)
        guard !needle.isEmpty else { return items }
        return items.filter {
            $0.name.localizedCaseInsensitiveContains(needle) || ($0.shortName?.localizedCaseInsensitiveContains(needle) ?? false)
        }
    }

    @MainActor
    private func load() async {
        do {
            let value = try await AdminAPI().universitiesSize()
            data = value
            failure = nil
            let codes = value.items.compactMap(\.city)
            if let units = try? await AdminAPI().katoResolve(codes) {
                for unit in units { cities[unit.code] = unit.nameRu }
            }
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
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
    @State private var recent: [AdminComplaintDTO] = []
    @State private var blocked: Int?
    @State private var audit: [AdminAuditEntryDTO] = []
    @State private var failure: String?
    @State private var isOffline = false

    private static let scan = 200
    private static let flowDays = 14

    var body: some View {
        List {
            if let pending {
                Section {
                    kpis(pending)
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())

                AdminChartSection(
                    title: String(localized: "admin.mod.flow", defaultValue: "Поток жалоб"),
                    hint: String(localized: "admin.mod.flowHint", defaultValue: "Поступило и разобрано по дням за две недели: успеваете ли за потоком"),
                    isLoaded: true
                ) {
                    AdminSeriesChart(series: flowSeries, label: AdminPlatformDashboardView.seriesLabel)
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
                        Text(String(localized: "admin.complaints.empty", defaultValue: "Жалоб нет"))
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    ForEach(pending.items.prefix(5)) { complaint in
                        NavigationLink(value: AppRoute.admin(.complaint(id: complaint.id))) {
                            AdminComplaintRow(complaint: complaint)
                        }
                    }
                    NavigationLink(value: AppRoute.admin(.complaints)) {
                        Text(String(localized: "admin.mod.openQueue", defaultValue: "Открыть очередь"))
                    }
                } header: {
                    Text(String(localized: "admin.mod.oldest", defaultValue: "Старейшие в очереди"))
                } footer: {
                    Text(String(localized: "admin.mod.oldestHint", defaultValue: "С них начинают разбор: ждут дольше всех"))
                }

                Section {
                    if audit.isEmpty {
                        Text(String(localized: "admin.audit.empty", defaultValue: "Записей нет"))
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    ForEach(audit.prefix(5)) { entry in
                        AdminAuditRow(entry: entry)
                    }
                    NavigationLink(value: AppRoute.admin(.audit)) {
                        Text(String(localized: "admin.mod.openAudit", defaultValue: "Открыть журнал"))
                    }
                } header: {
                    Text(String(localized: "admin.mod.myActions", defaultValue: "Мои последние действия"))
                } footer: {
                    Text(String(localized: "admin.mod.myActionsHint", defaultValue: "Журнал показывает модератору только его собственные действия"))
                }
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(AdminScreen.universityModeratorDashboard.title))
        .refreshable { await load() }
        .task { await load() }
    }

    private func kpis(_ pending: Page<AdminComplaintDTO>) -> some View {
        let total = pending.meta?.total ?? pending.items.count
        let aging = Self.aging(pending.items)
        let overdue = aging.1 + aging.2
        // Вся страница старых просрочена, а очередь длиннее — точнее «не меньше» не сказать.
        let saturated = !pending.items.isEmpty && overdue == pending.items.count && total > pending.items.count
        let weekAgo = Date().addingTimeInterval(-7 * 86_400)
        let resolvedWeek = audit.filter { $0.action == "complaint_resolved" && $0.createdAt >= weekAgo }.count
        return StatGrid {
            StatTile(title: String(localized: "admin.mod.kpiQueue", defaultValue: "В очереди"), value: total.formatted(), symbol: "tray.full", tint: TileTint.blue)
            StatTile(title: String(localized: "admin.mod.kpiHigh", defaultValue: "Высокий приоритет"), value: high.map { $0.formatted() } ?? "—", symbol: "flame", tint: TileTint.red)
            StatTile(title: String(localized: "admin.mod.kpiOverdue", defaultValue: "Ждут дольше суток"), value: saturated ? "\(overdue.formatted())+" : overdue.formatted(), symbol: "clock.badge.exclamationmark", tint: TileTint.orange)
            StatTile(title: String(localized: "admin.mod.kpiResolvedWeek", defaultValue: "Разобрано за 7 дней"), value: resolvedWeek.formatted(), symbol: "checkmark.seal", tint: TileTint.green)
            StatTile(title: String(localized: "admin.mod.kpiBlocked", defaultValue: "Заблокировано"), value: blocked.map { $0.formatted() } ?? "—", symbol: "nosign", tint: TileTint.gray)
        }
    }

    /// Поступило (`createdAt`) против разобрано (`resolvedAt`) по дням за две недели.
    private var flowSeries: AdminSeriesDTO {
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
        async let recentPage = try? api.complaintsSample(params: ["sort": "createdAt", "order": "desc", "limit": limit])
        async let blockedPage = try? api.users(role: nil, search: nil, blocked: true, request: PageRequest(cursor: nil, page: 1, limit: 1))
        async let auditPage = try? api.auditSample(params: ["sort": "createdAt", "order": "desc", "limit": "100"])
        let (h, r, b, a) = await (highPage, recentPage, blockedPage, auditPage)
        high = h?.meta?.total ?? h?.items.count
        recent = r?.items ?? []
        blocked = b?.meta?.total ?? b?.items.count
        audit = a?.items ?? []
    }
}
