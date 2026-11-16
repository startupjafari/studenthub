import Charts
import SwiftUI

// Карьерный центр вуза: обзор с очередью, допуск компаний, модерация вакансий, метрики
// за период и страница компании. Решения принимают не все, кто видит разделы: допуск
// компании — админ вуза и платформы, вакансии — ещё и модераторы; декан только смотрит.

private extension Role {
    var careerDecidesAccess: Bool { self == .platformAdmin || self == .universityAdmin }
    var careerDecidesVacancies: Bool {
        self == .platformAdmin || self == .platformModerator || self == .universityAdmin || self == .universityModerator
    }
}

private let careerFunnelStages = ["SUBMITTED", "VIEWED", "SHORTLISTED", "INTERVIEW", "OFFER", "HIRED"]

private func careerFunnelLabel(_ stage: String) -> String {
    switch stage {
    case "SUBMITTED": return String(localized: "career.funnel.submitted", defaultValue: "Отправлено")
    case "VIEWED": return String(localized: "career.funnel.viewed", defaultValue: "Просмотрено")
    case "SHORTLISTED": return String(localized: "career.funnel.shortlisted", defaultValue: "В подборке")
    case "INTERVIEW": return String(localized: "career.funnel.interview", defaultValue: "Интервью")
    case "OFFER": return String(localized: "career.funnel.offer", defaultValue: "Оффер")
    case "HIRED": return String(localized: "career.funnel.hired", defaultValue: "Найм")
    default: return stage
    }
}

private func careerPercent(_ value: Double?) -> String {
    guard let value else { return "—" }
    // Доли приходят процентами (0…100), а не долями единицы.
    return "\(Int(value.rounded()))%"
}

// MARK: - Обзор карьерного центра

struct CareerStaffHomeView: View {
    var body: some View {
        CareerScopeGate { universityID in
            CareerStaffOverview(universityID: universityID)
        }
        .navigationTitle(Text(String(localized: "career.staff.title", defaultValue: "Карьерный центр")))
    }
}

private struct CareerStaffOverview: View {
    let universityID: String?
    @State private var token = 0

    var body: some View {
        RemoteContent(reloadToken: token, load: { try await CareerAPI().universityAnalytics(universityID: universityID) }) { data in
            List {
                DashboardMetricsSection(metrics: [
                    DashboardMetric(
                        title: String(localized: "career.staff.companiesApproved", defaultValue: "Допущено компаний"),
                        value: CareerJSON.int(data, "companies", "APPROVED").formatted(),
                        symbol: "building.2",
                        tint: TileTint.indigo,
                        route: .career(.companies)
                    ),
                    DashboardMetric(
                        title: String(localized: "career.review.pending", defaultValue: "На модерации"),
                        value: CareerJSON.int(data, "vacancies", "PENDING").formatted(),
                        symbol: "hourglass",
                        tint: Palette.warning,
                        route: .career(.vacancyReview)
                    ),
                    DashboardMetric(
                        title: String(localized: "career.staff.vacanciesApproved", defaultValue: "Показывается вакансий"),
                        value: CareerJSON.int(data, "vacancies", "APPROVED").formatted(),
                        symbol: "briefcase",
                        tint: Palette.success,
                        route: .career(.vacancies)
                    ),
                    DashboardMetric(
                        title: String(localized: "career.staff.applications", defaultValue: "Откликов"),
                        value: CareerJSON.int(data, "reached", "SUBMITTED").formatted(),
                        symbol: "paperplane",
                        tint: Palette.info,
                        route: .career(.analytics)
                    ),
                ])

                queueSection(data)

                Section {
                    ForEach(CareerStaffLink.all, id: \.screen) { link in
                        NavigationLink(value: AppRoute.career(link.screen)) {
                            DashboardRow(title: link.title, subtitle: link.hint, symbol: link.screen.symbol, tint: TileTint.purple)
                        }
                    }
                } header: {
                    DashboardSectionHeader(title: String(localized: "career.staff.sections", defaultValue: "Разделы"))
                }

                ratesSection(data)
                funnelSection(data)
                weeklySection(data)
                skillsSection(data)
            }
            .dashboardListStyle()
            .pullToRefresh { token += 1 }
        }
    }

    /// Очередь решений строками: число справа, пояснение под названием.
    private func queueSection(_ data: JSONValue) -> some View {
        let queue = data["queue"]
        let oldest = queue?["oldestPendingDays"]?.int
        let median = CareerJSON.optional(queue, "medianDecisionHours")
        let staleDays = CareerJSON.int(queue, "staleDays").formatted()
        let expiringDays = CareerJSON.int(queue, "expiringDays").formatted()
        let pending = CareerJSON.int(queue, "vacanciesPending")
        let requested = CareerJSON.int(queue, "companiesRequested")
        let expiring = CareerJSON.int(queue, "accessExpiringSoon")
        let stale = CareerJSON.int(queue, "staleApplications")
        return Section {
            NavigationLink(value: AppRoute.career(.vacancyReview)) {
                DashboardRow(
                    title: String(localized: "career.review.pending", defaultValue: "На модерации"),
                    subtitle: oldest.map { days in
                        let value = days.formatted()
                        return String(localized: "career.staff.oldest", defaultValue: "старейшая ждёт дней: \(value)")
                    } ?? String(localized: "career.staff.queueEmpty", defaultValue: "очередь пуста"),
                    symbol: "hourglass",
                    tint: pending > 0 ? Palette.warning : TileTint.gray,
                    value: pending.formatted()
                )
            }
            NavigationLink(value: AppRoute.career(.companies)) {
                DashboardRow(
                    title: String(localized: "career.staff.requests", defaultValue: "Заявки компаний"),
                    subtitle: String(localized: "career.staff.requestsHint", defaultValue: "ждут решения вуза"),
                    symbol: "building.2",
                    tint: requested > 0 ? Palette.info : TileTint.gray,
                    value: requested.formatted()
                )
            }
            NavigationLink(value: AppRoute.career(.companies)) {
                DashboardRow(
                    title: String(localized: "career.staff.expiring", defaultValue: "Допуски истекают"),
                    subtitle: String(localized: "career.staff.expiringHint", defaultValue: "в ближайшие \(expiringDays) дн."),
                    symbol: "calendar.badge.exclamationmark",
                    tint: expiring > 0 ? Palette.warning : TileTint.gray,
                    value: expiring.formatted()
                )
            }
            DashboardRow(
                title: String(localized: "career.staff.stale", defaultValue: "Откликов без ответа"),
                subtitle: String(localized: "career.staff.staleHint", defaultValue: "компания молчит дольше \(staleDays) дн."),
                symbol: "bubble.left.and.exclamationmark.bubble.right",
                tint: stale > 0 ? Palette.destructive : TileTint.gray,
                value: stale.formatted()
            )
        } header: {
            DashboardSectionHeader(
                title: String(localized: "career.staff.queue", defaultValue: "Требует внимания"),
                subtitle: median.map { hours in
                    let value = JSONValue.format(hours)
                    return String(localized: "career.staff.median", defaultValue: "медиана решения — \(value) ч")
                }
            )
        }
    }

    private func ratesSection(_ data: JSONValue) -> some View {
        let rates = data["rates"]
        let visible = CareerJSON.int(data, "profiles", "visible")
        let total = CareerJSON.int(data, "profiles", "total")
        return DashboardCardSection(
            title: String(localized: "career.staff.rates", defaultValue: "Конверсия воронки"),
            subtitle: String(
                localized: "career.staff.ratesHintNoData",
                defaultValue: "Доли считаются от числа отправленных откликов. «Нет данных» — считать пока не от чего."
            )
        ) {
            DashboardBarList(bars: [
                rateBar(String(localized: "career.staff.rateInterview", defaultValue: "До интервью"), CareerJSON.optional(rates, "interview")),
                rateBar(String(localized: "career.staff.rateOffer", defaultValue: "До оффера"), CareerJSON.optional(rates, "offer")),
                rateBar(String(localized: "career.staff.rateHired", defaultValue: "До найма"), CareerJSON.optional(rates, "hired"), tint: Palette.success),
                DashboardBar(
                    label: String(localized: "career.staff.profiles", defaultValue: "Открытые профили"),
                    fraction: total > 0 ? Double(visible) / Double(total) : 0,
                    valueText: "\(visible.formatted()) / \(total.formatted())",
                    tint: Palette.info
                ),
            ])
        }
    }

    private func rateBar(_ title: String, _ value: Double?, tint: Color? = nil) -> DashboardBar {
        // Доли приходят процентами (0…100), а не долями единицы.
        DashboardBar(
            label: title,
            fraction: (value ?? 0) / 100,
            valueText: value.map { "\(Int($0.rounded()))%" } ?? DashboardText.noData,
            tint: tint
        )
    }

    private func funnelSection(_ data: JSONValue) -> some View {
        let reached = data["reached"]
        let top = max(CareerJSON.int(reached, "SUBMITTED"), 1)
        let vacancies = data["vacancies"]
        return DashboardCardSection(
            title: String(localized: "career.staff.funnel", defaultValue: "Воронка откликов"),
            subtitle: String(localized: "career.staff.funnelHint", defaultValue: "Сколько откликов дошло до каждого шага")
        ) {
            DashboardBarList(bars: careerFunnelStages.map { stage in
                let value = CareerJSON.int(reached, stage)
                return DashboardBar(
                    label: careerFunnelLabel(stage),
                    fraction: Double(value) / Double(top),
                    valueText: value.formatted(),
                    tint: stage == "HIRED" ? Palette.success : nil
                )
            })
            Divider()
            VStack(spacing: Spacing.sm) {
                ForEach(["PENDING", "APPROVED", "REJECTED"], id: \.self) { status in
                    HStack {
                        Text(CareerText.reviewStatus(status).text).foregroundStyle(Palette.mutedForeground)
                        Spacer(minLength: Spacing.md)
                        Text(verbatim: CareerJSON.int(vacancies, status).formatted())
                            .monospacedDigit()
                            .foregroundStyle(Palette.foreground)
                    }
                    .font(.subheadline)
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    /// Отклики по неделям линиями: итог за всё время не показывает, стало ли лучше.
    @ViewBuilder
    private func weeklySection(_ data: JSONValue) -> some View {
        let weekly = data["weekly"]
        let weeks = weekly?["weeks"]?.array ?? []
        if !weeks.isEmpty {
            let points = Self.weeklyPoints(weekly, weeks: weeks)
            DashboardCardSection(
                title: String(localized: "career.staff.weekly", defaultValue: "Отклики по неделям"),
                subtitle: String(localized: "career.staff.weeklyHint", defaultValue: "Итог за всё время не показывает, стало ли лучше")
            ) {
                if points.allSatisfy({ $0.value == 0 }) {
                    DashboardEmptyPlaceholder(text: DashboardText.periodNoData, symbol: "chart.xyaxis.line")
                } else {
                    Chart(points) { point in
                        LineMark(
                            x: .value(String(localized: "career.staff.week", defaultValue: "Неделя"), point.week, unit: .weekOfYear),
                            y: .value(String(localized: "career.staff.count", defaultValue: "Количество"), point.value)
                        )
                        .foregroundStyle(by: .value(String(localized: "career.staff.stage", defaultValue: "Шаг"), point.series))
                        .interpolationMethod(.monotone)
                        .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
                    }
                    .chartLegend(position: .bottom, alignment: .leading)
                    .frame(height: DashboardMetrics.chartHeight)
                }
            }
        }
    }

    private struct WeeklyPoint: Identifiable {
        let id: String
        let week: Date
        let value: Int
        let series: String
    }

    private static func weeklyPoints(_ weekly: JSONValue?, weeks: [JSONValue]) -> [WeeklyPoint] {
        let series = [
            ("submitted", careerFunnelLabel("SUBMITTED")),
            ("interview", careerFunnelLabel("INTERVIEW")),
            ("hired", careerFunnelLabel("HIRED")),
        ]
        // Последние 12 недель: дальше линии сливаются на ширине телефона.
        let indices = Array(weeks.indices.suffix(12))
        return series.flatMap { key, label in
            indices.compactMap { index -> WeeklyPoint? in
                guard let week = weeks[index].date else { return nil }
                return WeeklyPoint(id: "\(key)-\(index)", week: week, value: weekly?[key]?[index]?.int ?? 0, series: label)
            }
        }
    }

    @ViewBuilder
    private func skillsSection(_ data: JSONValue) -> some View {
        let skills = data["skills"]?.array ?? []
        if !skills.isEmpty {
            DashboardCardSection(
                title: String(localized: "career.staff.skills", defaultValue: "Дефицит навыков"),
                subtitle: String(
                    localized: "career.staff.skillsHint",
                    defaultValue: "Доля вакансий вуза, где навык требуют, против доли студентов, которые его указали"
                )
            ) {
                HStack(spacing: Spacing.lg) {
                    CareerSkillLegend(title: String(localized: "career.staff.demand", defaultValue: "Требуют в вакансиях"), tint: Palette.warning)
                    CareerSkillLegend(title: String(localized: "career.staff.supply", defaultValue: "Указали студенты"), tint: Palette.info)
                }
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    ForEach(Array(skills.prefix(12).enumerated()), id: \.offset) { _, skill in
                        CareerSkillGapRow(
                            skill: skill["skill"]?.string ?? DashboardText.noData,
                            demand: CareerJSON.optional(skill, "demandShare"),
                            supply: CareerJSON.optional(skill, "supplyShare")
                        )
                    }
                }
            }
        }
    }
}

/// Отметка легенды: цветная точка и подпись.
private struct CareerSkillLegend: View {
    let title: String
    let tint: Color

    var body: some View {
        HStack(spacing: Spacing.xs) {
            Circle().fill(tint).frame(width: 8, height: 8).accessibilityHidden(true)
            Text(title).font(.caption).foregroundStyle(Palette.mutedForeground)
        }
    }
}

/// Навык: спрос и предложение двумя тонкими полосами одна под другой.
private struct CareerSkillGapRow: View {
    let skill: String
    let demand: Double?
    let supply: Double?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text(skill).font(.subheadline.weight(.medium)).foregroundStyle(Palette.foreground)
                Spacer(minLength: Spacing.md)
                Text(verbatim: "\(percent(demand)) / \(percent(supply))")
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(Palette.mutedForeground)
            }
            DashboardCapsuleBar(fraction: (demand ?? 0) / 100, tint: Palette.warning)
            DashboardCapsuleBar(fraction: (supply ?? 0) / 100, tint: Palette.info)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(skill))
        .accessibilityValue(Text(String(
            localized: "career.staff.skillGapValue",
            defaultValue: "требуют: \(percent(demand)), указали: \(percent(supply))"
        )))
    }

    private func percent(_ value: Double?) -> String {
        value.map { "\(Int($0.rounded()))%" } ?? DashboardText.noData
    }
}

private struct CareerStaffLink {
    let screen: CareerScreen
    let title: String
    let hint: String

    static var all: [CareerStaffLink] {
        [
            CareerStaffLink(
                screen: .companies, title: CareerScreen.companies.title,
                hint: String(localized: "career.staff.goCompanies", defaultValue: "Заявки на допуск и действующие разрешения")
            ),
            CareerStaffLink(
                screen: .vacancyReview, title: CareerScreen.vacancyReview.title,
                hint: String(localized: "career.staff.goReview", defaultValue: "Очередь решений: показать студентам или отклонить")
            ),
            CareerStaffLink(
                screen: .vacancies, title: CareerScreen.vacancies.title,
                hint: String(localized: "career.staff.goVacancies", defaultValue: "Витрина того, что уже одобрено")
            ),
            CareerStaffLink(
                screen: .events, title: CareerScreen.events.title,
                hint: String(localized: "career.staff.goEvents", defaultValue: "Ярмарки, воркшопы, дни собеседований")
            ),
            CareerStaffLink(
                screen: .analytics, title: CareerScreen.analytics.title,
                hint: String(localized: "career.staff.goAnalytics", defaultValue: "Разрезы по компаниям, вакансиям и откликам за период")
            ),
        ]
    }
}

// MARK: - Компании: допуск к студентам вуза

struct CareerCompaniesView: View {
    var body: some View {
        CareerScopeGate { universityID in
            CareerCompanyAccessList(universityID: universityID)
        }
        .navigationTitle(Text(CareerScreen.companies.title))
    }
}

private struct CareerCompanyAccessList: View {
    let universityID: String?

    @Environment(\.viewerRole) private var role
    @State private var loader: PagedLoader<CareerAccess>
    @State private var status: String? = "REQUESTED"
    @State private var search = ""
    @State private var approving: CareerAccess?
    @State private var asking: (row: CareerAccess, status: String)?
    @State private var reason = ""
    @State private var failure: String?

    init(universityID: String?) {
        self.universityID = universityID
        _loader = State(initialValue: PagedLoader(limit: 20) { request in
            try await CareerAPI().universityAccess(request, params: ["status": "REQUESTED", "universityId": universityID])
        })
    }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: String(localized: "career.companies.empty", defaultValue: "Заявок нет"),
                symbol: "building.2",
                hint: String(localized: "career.companies.emptyHint", defaultValue: "Компании подают заявки сами — здесь появятся новые.")
            ),
            header: {
                FilterChipsRow(
                    options: [
                        (value: Optional("REQUESTED"), title: String(localized: "career.access.requested", defaultValue: "На рассмотрении")),
                        (value: Optional("APPROVED"), title: String(localized: "career.companies.approved", defaultValue: "Допущены")),
                        (value: String?.none, title: CareerText.allTitle),
                    ],
                    selection: $status
                )
            },
            row: { row in
                NavigationLink(value: AppRoute.career(.company(id: row.company?.id ?? ""))) {
                    CareerCompanyAccessRow(row: row)
                }
                .disabled(row.company == nil)
                .contextMenu { actions(row) }
                .swipeActions { actions(row) }
            }
        )
        .debouncedSearch($search, prompt: String(localized: "career.companies.search", defaultValue: "Название компании")) { _ in
            await refilter()
        }
        .onChange(of: status) { Task { await refilter() } }
        .sheet(item: $approving) { row in
            CareerApproveAccessSheet(row: row, universityID: universityID) { await loader.reload() }
        }
        .reasonPrompt(
            Binding(get: { asking != nil }, set: { if !$0 { asking = nil } }),
            title: asking?.status == "REVOKED"
                ? String(localized: "career.companies.revoke", defaultValue: "Отозвать доступ")
                : String(localized: "career.companies.reject", defaultValue: "Отклонить"),
            message: String(localized: "career.companies.reasonHint", defaultValue: "Причина — её увидит компания"),
            actionTitle: asking?.status == "REVOKED"
                ? String(localized: "career.companies.revoke", defaultValue: "Отозвать доступ")
                : String(localized: "career.companies.reject", defaultValue: "Отклонить"),
            text: $reason
        ) {
            guard let asking else { return }
            await decide(asking.row, status: asking.status, reason: reason)
        }
        .actionFailureAlert($failure)
    }

    @ViewBuilder
    private func actions(_ row: CareerAccess) -> some View {
        if role.careerDecidesAccess {
            if row.status == "REQUESTED" {
                Button {
                    approving = row
                } label: {
                    Label(String(localized: "career.companies.approve", defaultValue: "Одобрить"), systemImage: "checkmark")
                }
                .tint(Palette.success)
                Button(role: .destructive) {
                    reason = ""
                    asking = (row, "REJECTED")
                } label: {
                    Label(String(localized: "career.companies.reject", defaultValue: "Отклонить"), systemImage: "xmark")
                }
            }
            if row.status == "APPROVED" {
                Button(role: .destructive) {
                    reason = ""
                    asking = (row, "REVOKED")
                } label: {
                    Label(String(localized: "career.companies.revoke", defaultValue: "Отозвать доступ"), systemImage: "hand.raised")
                }
            }
        }
    }

    private func refilter() async {
        let params: [String: String?] = [
            "status": status,
            "search": search.trimmingCharacters(in: .whitespaces),
            "universityId": universityID,
        ]
        await loader.replace { request in
            try await CareerAPI().universityAccess(request, params: params)
        }
    }

    @MainActor
    private func decide(_ row: CareerAccess, status: String, reason: String) async {
        let text = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            failure = String(localized: "career.reasonRequired", defaultValue: "Укажите причину")
            return
        }
        do {
            try await CareerAPI().decideAccess(id: row.id, status: status, reason: text, expiresAt: nil, universityID: universityID)
            await loader.reload()
        } catch {
            failure = error.userMessage
        }
    }
}

/// Заявка компании — как строка чата: логотип, название, день заявки справа, сайт и
/// город, сообщение или причина ниже, статус — плашкой.
private struct CareerCompanyAccessRow: View {
    let row: CareerAccess
    @State private var kato = CareerKatoNames.shared

    var body: some View {
        let status = CareerText.accessStatus(row.status, expired: row.status == "APPROVED" && !row.isActive)
        let until: String? = {
            guard row.status == "APPROVED", let expires = row.expiresAt else { return nil }
            let date = DisplayFormat.date(expires)
            return String(localized: "career.companies.until", defaultValue: "Допуск до \(date)")
        }()
        let place = [row.company?.website, kato.name(row.company?.city)].compactMap { $0 }.joined(separator: " · ")
        let note = row.reason.map { "\(String(localized: "common.reason", defaultValue: "Причина")): \($0)" } ?? until ?? row.message
        TelegramStyleRow(
            title: row.company?.name ?? "—",
            subtitle: [place.isEmpty ? nil : place, note].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: "\n"),
            meta: DisplayFormat.date(row.requestedAt)
        ) {
            AvatarView(url: row.company?.logoUrl, name: row.company?.name ?? "—", size: 44)
        } accessory: {
            StatusBadge(text: status.text, tint: status.tint)
        }
        .task(id: row.id) { kato.request([row.company?.city]) }
    }
}

/// Одобрение заявки со сроком допуска: допуск действует до конца выбранного дня.
private struct CareerApproveAccessSheet: View {
    let row: CareerAccess
    let universityID: String?
    let saved: () async -> Void

    @State private var limited = false
    @State private var until = Calendar.current.date(byAdding: .year, value: 1, to: Date()) ?? Date()

    var body: some View {
        FormSheet(
            title: String(localized: "career.companies.approve", defaultValue: "Одобрить"),
            saveTitle: String(localized: "career.companies.approve", defaultValue: "Одобрить"),
            save: {
                let end = limited ? Calendar.current.date(bySettingHour: 23, minute: 59, second: 59, of: until) : nil
                try await CareerAPI().decideAccess(id: row.id, status: "APPROVED", reason: nil, expiresAt: end, universityID: universityID)
            },
            saved: saved
        ) {
            Section {
                PersonRow(name: row.company?.name ?? "—", subtitle: row.message, avatarURL: row.company?.logoUrl)
            }
            Section {
                Toggle(String(localized: "career.companies.limit", defaultValue: "Ограничить срок допуска"), isOn: $limited)
                if limited {
                    DatePicker(
                        String(localized: "career.companies.untilField", defaultValue: "Срок допуска"),
                        selection: $until,
                        in: Date()...,
                        displayedComponents: .date
                    )
                }
            } footer: {
                Text(String(
                    localized: "career.companies.untilHint",
                    defaultValue: "Необязательно. Допуск действует до конца выбранного дня, после — закрывается сам."
                ))
            }
        }
    }
}

// MARK: - Модерация вакансий

struct CareerVacancyReviewView: View {
    var body: some View {
        CareerScopeGate { universityID in
            CareerReviewList(universityID: universityID)
        }
        .navigationTitle(Text(CareerScreen.vacancyReview.title))
    }
}

private struct CareerReviewList: View {
    let universityID: String?

    @State private var loader: PagedLoader<CareerReviewRow>
    @State private var status: String? = "PENDING"
    @State private var opened: CareerReviewRow?

    init(universityID: String?) {
        self.universityID = universityID
        _loader = State(initialValue: PagedLoader(limit: 20) { request in
            try await CareerAPI().reviewQueue(request, params: ["status": "PENDING", "universityId": universityID])
        })
    }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: String(localized: "career.review.empty", defaultValue: "Вакансий на модерации нет"),
                symbol: "checkmark.shield",
                hint: String(localized: "career.review.emptyHint", defaultValue: "Здесь появятся вакансии компаний, которым вы открыли доступ.")
            ),
            header: {
                FilterChipsRow(
                    options: [
                        (value: Optional("PENDING"), title: String(localized: "career.review.pending", defaultValue: "На модерации")),
                        (value: Optional("APPROVED"), title: String(localized: "career.review.approved", defaultValue: "Допущены")),
                        (value: String?.none, title: CareerText.allTitle),
                    ],
                    selection: $status
                )
                Section {
                } footer: {
                    Text(String(
                        localized: "career.review.subtitle",
                        defaultValue: "Решение действует только на студентов вашего университета"
                    ))
                }
            },
            row: { row in
                Button {
                    opened = row
                } label: {
                    let status = CareerText.reviewStatus(row.status)
                    let terms = [row.vacancy.employmentType.map(CareerText.employment), row.vacancy.workFormat.map(CareerText.format), CareerText.salary(row.vacancy)]
                        .compactMap { $0 }
                        .joined(separator: " · ")
                    TelegramStyleRow(
                        title: row.vacancy.title,
                        subtitle: [
                            row.vacancy.company?.name,
                            row.reason.map { "\(String(localized: "common.reason", defaultValue: "Причина")): \($0)" } ?? (terms.isEmpty ? nil : terms),
                        ]
                        .compactMap { $0 }
                        .joined(separator: "\n"),
                        meta: DisplayFormat.date(row.createdAt)
                    ) {
                        if let company = row.vacancy.company {
                            AvatarView(url: company.logoUrl, name: company.name, size: 44)
                        } else {
                            RowSymbol(symbol: "briefcase.fill", tint: TileTint.purple)
                        }
                    } accessory: {
                        StatusBadge(text: status.text, tint: status.tint)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        )
        .onChange(of: status) {
            let params: [String: String?] = ["status": status, "universityId": universityID]
            Task {
                await loader.replace { request in
                    try await CareerAPI().reviewQueue(request, params: params)
                }
            }
        }
        .sheet(item: $opened) { row in
            CareerReviewSheet(row: row, universityID: universityID) { await loader.reload() }
        }
    }
}

/// Вакансия на модерации целиком и решение по ней.
private struct CareerReviewSheet: View {
    let row: CareerReviewRow
    let universityID: String?
    let decided: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.viewerRole) private var role
    @State private var kato = CareerKatoNames.shared
    @State private var asking = false
    @State private var reason = ""
    @State private var failure: String?
    @State private var busy = false

    var body: some View {
        let vacancy = row.vacancy
        NavigationStack {
            List {
                Section {
                    let status = CareerText.reviewStatus(row.status)
                    HeroHeader(
                        visual: vacancy.company.map { HeroVisual.avatar(url: $0.logoUrl, name: $0.name) } ?? .symbol("briefcase.fill", tint: TileTint.purple),
                        title: vacancy.title,
                        subtitle: vacancy.company?.name,
                        actions: decisionActions
                    ) {
                        StatusBadge(text: status.text, tint: status.tint)
                    }
                }
                if let reason = row.reason, !reason.isEmpty {
                    Section {
                        DetailRow(title: String(localized: "common.reason", defaultValue: "Причина"), value: reason, symbol: "text.bubble")
                    }
                }
                Section {
                    DetailRow(title: String(localized: "career.vacancy.employment", defaultValue: "Занятость"), value: CareerText.employment(vacancy.employmentType))
                    DetailRow(title: String(localized: "career.vacancy.format", defaultValue: "Формат работы"), value: CareerText.format(vacancy.workFormat))
                    DetailRow(title: String(localized: "career.vacancy.experience", defaultValue: "Опыт"), value: CareerText.experience(vacancy.experienceLevel))
                    DetailRow(
                        title: String(localized: "career.vacancy.city", defaultValue: "Город"),
                        value: kato.name(vacancy.city) ?? String(localized: "career.notSet", defaultValue: "Не указано")
                    )
                    DetailRow(
                        title: String(localized: "career.profile.salary", defaultValue: "Зарплата"),
                        value: CareerText.salary(vacancy) ?? String(localized: "career.notSet", defaultValue: "Не указано")
                    )
                    DetailRow(
                        title: String(localized: "career.vacancy.deadline", defaultValue: "Принимать отклики до"),
                        value: vacancy.deadline.map(DisplayFormat.date) ?? String(localized: "career.notSet", defaultValue: "Не указано")
                    )
                    DetailRow(
                        title: String(localized: "career.vacancy.languages", defaultValue: "Языки"),
                        value: CareerText.list(vacancy.languages).isEmpty
                            ? String(localized: "career.notSet", defaultValue: "Не указано")
                            : CareerText.list(vacancy.languages).joined(separator: ", ")
                    )
                    if !CareerText.list(vacancy.skills).isEmpty {
                        CareerTags(items: CareerText.list(vacancy.skills))
                    }
                }
                if let description = vacancy.description, !description.isEmpty {
                    Section {
                        Text(description).textSelection(.enabled)
                    } header: {
                        Text(String(localized: "career.vacancy.description", defaultValue: "Описание"))
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(Text(String(localized: "career.review.one", defaultValue: "Вакансия на модерации")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
            }
            .task(id: vacancy.id) { kato.request([vacancy.city]) }
            .reasonPrompt(
                $asking,
                title: row.status == "APPROVED"
                    ? String(localized: "career.review.unpublish", defaultValue: "Снять с витрины")
                    : String(localized: "career.companies.reject", defaultValue: "Отклонить"),
                message: String(localized: "career.companies.reasonHint", defaultValue: "Причина — её увидит компания"),
                actionTitle: row.status == "APPROVED"
                    ? String(localized: "career.review.unpublish", defaultValue: "Снять с витрины")
                    : String(localized: "career.companies.reject", defaultValue: "Отклонить"),
                text: $reason
            ) {
                await decide(approve: false, reason: reason)
            }
            .actionFailureAlert($failure)
        }
    }

    /// Решение — кругами под шапкой: одобрить, отклонить или снять с витрины.
    private var decisionActions: [HeroAction] {
        guard role.careerDecidesVacancies else { return [] }
        var actions: [HeroAction] = []
        if row.status == "PENDING" {
            actions.append(HeroAction(title: String(localized: "career.companies.approve", defaultValue: "Одобрить"), symbol: "checkmark") {
                guard !busy else { return }
                Task { await decide(approve: true, reason: nil) }
            })
            actions.append(HeroAction(title: String(localized: "career.companies.reject", defaultValue: "Отклонить"), symbol: "xmark", role: .destructive) {
                guard !busy else { return }
                reason = ""
                asking = true
            })
        }
        if row.status == "APPROVED" {
            actions.append(HeroAction(title: String(localized: "career.review.unpublish", defaultValue: "Снять с витрины"), symbol: "eye.slash", role: .destructive) {
                guard !busy else { return }
                reason = ""
                asking = true
            })
        }
        return actions
    }

    @MainActor
    private func decide(approve: Bool, reason: String?) async {
        let text = reason?.trimmingCharacters(in: .whitespacesAndNewlines)
        if !approve, text?.isEmpty ?? true {
            failure = String(localized: "career.reasonRequired", defaultValue: "Укажите причину")
            return
        }
        busy = true
        defer { busy = false }
        do {
            try await CareerAPI().decideVacancy(reviewID: row.id, approve: approve, reason: text, universityID: universityID)
            await decided()
            dismiss()
        } catch {
            failure = error.userMessage
        }
    }
}

// MARK: - Метрики за период

struct CareerAnalyticsView: View {
    var body: some View {
        CareerScopeGate { universityID in
            CareerReportView(universityID: universityID)
        }
        .navigationTitle(Text(CareerScreen.analytics.title))
    }
}

/// Отчёт карьерного центра: период, четыре главные цифры с изменением к прошлому
/// периоду, затем разрезы одной темы. Девять таблиц подряд телефон превращал в простыню;
/// темы переключаются в одно касание, данные у них общие — запрос один.
private struct CareerReportView: View {
    private enum Topic: Hashable { case funnel, graduates, market }

    let universityID: String?

    @State private var period = "quarter"
    @State private var topic: Topic = .funnel
    @State private var export = CareerFileExport()

    var body: some View {
        RemoteContent(reloadToken: period.hashValue, load: { try await CareerAPI().report(period: period, universityID: universityID) }) { data in
            List {
                // Общий селектор обзоров, а не свой сегмент в строке списка: свой стоял
                // в строке с отступами, а даты периода — второй строкой под разделителем.
                DashboardPeriodPicker(
                    title: String(localized: "career.report.period", defaultValue: "Период"),
                    selection: $period,
                    options: [
                        ("month", String(localized: "career.report.month", defaultValue: "Месяц")),
                        ("quarter", String(localized: "career.report.quarter", defaultValue: "Квартал")),
                        ("year", String(localized: "career.report.year", defaultValue: "Учебный год")),
                    ]
                )

                // Границы периода — пояснением к итогам, которые за него посчитаны.
                DashboardMetricsSection(
                    metrics: [
                        totalMetric(data, "applications", String(localized: "career.staff.applications", defaultValue: "Откликов"), "paperplane"),
                        totalMetric(data, "hired", String(localized: "career.report.hired", defaultValue: "Трудоустроено"), "checkmark.seal"),
                        totalMetric(data, "vacancies", String(localized: "career.report.newVacancies", defaultValue: "Новых вакансий"), "briefcase"),
                        totalMetric(data, "companies", String(localized: "career.staff.companiesApproved", defaultValue: "Допущено компаний"), "building.2"),
                    ],
                    title: String(localized: "career.report.totals", defaultValue: "Итоги периода"),
                    subtitle: periodRange(data)
                )

                DashboardPeriodPicker(
                    title: String(localized: "admin.dash.topic", defaultValue: "Тема"),
                    selection: $topic,
                    options: [
                        (Topic.funnel, String(localized: "career.report.topic.funnel", defaultValue: "Воронка")),
                        (Topic.graduates, String(localized: "career.report.topic.graduates", defaultValue: "Выпускники")),
                        (Topic.market, String(localized: "career.report.topic.market", defaultValue: "Рынок")),
                    ]
                )

                switch topic {
                case .funnel:
                    funnelSection(data)
                    timingSection(data)
                    outcomesSection(data)
                case .graduates:
                    graduatesSection(data)
                    facultiesSection(data)
                    studentsSection(data)
                case .market:
                    companiesSection(data)
                    marketSection(data)
                    salarySection(data)
                }
            }
            .dashboardListStyle()
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("XLSX") { Task { await runExport("xlsx") } }
                    Button("CSV") { Task { await runExport("csv") } }
                } label: {
                    Image(systemName: "square.and.arrow.up")
                }
                .accessibilityLabel(Text(String(localized: "career.report.export", defaultValue: "Выгрузить")))
            }
        }
        .modifier(CareerFileExportModifier(export: export))
    }

    private func runExport(_ format: String) async {
        let name = String(localized: "career.report.fileName", defaultValue: "Отчёт карьерного центра") + ".\(format)"
        await export.run(name: name) {
            try await CareerAPI().exportReport(period: period, format: format, universityID: universityID)
        }
    }

    /// Даты периода отчёта: «01.08.2026 — 31.10.2026». Нет дат — нет пояснения.
    private func periodRange(_ data: JSONValue) -> String? {
        guard let from = data["from"]?.date, let to = data["to"]?.date else { return nil }
        return "\(DisplayFormat.date(from)) — \(DisplayFormat.date(to))"
    }

    /// Цифра периода и её изменение к прошлому: рост — зелёным, спад — красным.
    private func totalMetric(_ data: JSONValue, _ key: String, _ title: String, _ symbol: String) -> DashboardMetric {
        let value = CareerJSON.int(data, "totals", key, "value")
        let previous = CareerJSON.int(data, "totals", key, "previous")
        let delta = value - previous
        let caption = delta == 0 ? nil : (delta > 0 ? "+\(delta.formatted())" : delta.formatted())
        return DashboardMetric(
            title: title,
            value: value.formatted(),
            symbol: symbol,
            caption: caption,
            captionTint: delta > 0 ? Palette.success : Palette.destructive
        )
    }

    private func timingSection(_ data: JSONValue) -> some View {
        let timing = data["timing"]
        let hours = CareerJSON.optional(timing, "firstResponseHours")
        let days = CareerJSON.optional(timing, "hireDays")
        let silent = CareerJSON.int(timing, "silent").formatted()
        let total = CareerJSON.int(timing, "total").formatted()
        let hoursUnit = String(localized: "career.report.hours", defaultValue: "ч")
        let daysUnit = String(localized: "career.report.days", defaultValue: "дн.")
        return Section {
            DetailRow(
                title: String(localized: "career.report.firstResponse", defaultValue: "До первого ответа компании"),
                value: hours.map { "\(JSONValue.format($0)) \(hoursUnit)" } ?? "—"
            )
            DetailRow(
                title: String(localized: "career.report.timeToHire", defaultValue: "От отклика до найма"),
                value: days.map { "\(JSONValue.format($0)) \(daysUnit)" } ?? "—"
            )
            DetailRow(
                title: String(localized: "career.report.silent", defaultValue: "Откликов без ответа вовсе"),
                value: "\(careerPercent(CareerJSON.optional(timing, "silentShare"))) · \(silent) / \(total)"
            )
        } header: {
            CareerSectionHeader(
                title: String(localized: "career.report.speed", defaultValue: "Скорость процесса"),
                hint: String(localized: "career.report.speedHint", defaultValue: "Сколько студент ждёт реакции")
            )
        }
    }

    private func funnelSection(_ data: JSONValue) -> some View {
        let stages = data["funnel"]?["stages"]
        let top = max(CareerJSON.int(stages, "SUBMITTED"), 1)
        let dropoff = data["funnel"]?["dropoff"]?.array ?? []
        return Section {
            ForEach(careerFunnelStages, id: \.self) { stage in
                let value = CareerJSON.int(stages, stage)
                ShareBar(title: careerFunnelLabel(stage), fraction: Double(value) / Double(top), valueText: value.formatted())
            }
            ForEach(Array(dropoff.enumerated()), id: \.offset) { _, item in
                let from = careerFunnelLabel(item["from"]?.string ?? "")
                DetailRow(
                    title: "\(String(localized: "career.report.lost", defaultValue: "Потеряно")): \(from)",
                    value: CareerJSON.int(item, "lost").formatted()
                )
            }
        } header: {
            CareerSectionHeader(
                title: String(localized: "career.report.dropoff", defaultValue: "Где теряются отклики"),
                hint: String(localized: "career.report.dropoffHint", defaultValue: "Сколько откликов не перешло с шага на следующий")
            )
        }
    }

    private func outcomesSection(_ data: JSONValue) -> some View {
        let outcomes = data["outcomes"]
        let total = max(CareerJSON.int(outcomes, "total"), 1)
        let rows: [(String, String, Color)] = [
            ("hired", String(localized: "career.report.hired", defaultValue: "Трудоустроено"), Palette.success),
            ("rejected", String(localized: "career.report.rejected", defaultValue: "Отказ компании"), Palette.destructive),
            ("withdrawn", String(localized: "career.report.withdrawn", defaultValue: "Отозвал студент"), Palette.mutedForeground),
            ("active", String(localized: "career.report.active", defaultValue: "Ещё в работе"), Palette.info),
        ]
        return Section {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                let value = CareerJSON.int(outcomes, row.0)
                ShareBar(title: row.1, fraction: Double(value) / Double(total), valueText: value.formatted(), tint: row.2)
            }
        } header: {
            CareerSectionHeader(
                title: String(localized: "career.report.outcomes", defaultValue: "Чем закончились отклики"),
                hint: String(localized: "career.report.outcomesHint", defaultValue: "Доли считаются от откликов, поданных за период")
            )
        }
    }

    @ViewBuilder
    private func facultiesSection(_ data: JSONValue) -> some View {
        let faculties = data["faculties"]
        let items = faculties?["items"]?.array ?? []
        let suppressed = CareerJSON.int(faculties, "suppressed")
        if !items.isEmpty || suppressed > 0 {
            Section {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    let hired = CareerJSON.int(item, "hired").formatted()
                    let students = CareerJSON.int(item, "students").formatted()
                    ShareBar(
                        title: item["name"]?.string ?? "—",
                        fraction: (CareerJSON.optional(item, "hiredShare") ?? 0) / 100,
                        valueText: "\(careerPercent(CareerJSON.optional(item, "hiredShare"))) · \(hired)/\(students)",
                        tint: Palette.success
                    )
                }
            } header: {
                CareerSectionHeader(
                    title: String(localized: "career.report.faculties", defaultValue: "Трудоустройство по факультетам"),
                    hint: suppressed > 0
                        ? {
                            let count = suppressed.formatted()
                            let min = CareerJSON.int(faculties, "minCell").formatted()
                            return String(
                                localized: "career.report.suppressed",
                                defaultValue: "Скрыто факультетов: \(count) — в них меньше \(min) студентов"
                            )
                        }()
                        : String(localized: "career.report.facultiesHint", defaultValue: "Сколько студентов факультета получили найм за период")
                )
            }
        }
    }

    @ViewBuilder
    private func graduatesSection(_ data: JSONValue) -> some View {
        if let graduates = data["graduates"], graduates.object != nil {
            let year = String(CareerJSON.int(graduates, "year"))
            let hired = CareerJSON.int(graduates, "hired").formatted()
            let students = CareerJSON.int(graduates, "students").formatted()
            Section {
                ShareBar(
                    title: String(localized: "career.report.graduatesShare", defaultValue: "Трудоустроено выпускников \(year)"),
                    fraction: (CareerJSON.optional(graduates, "share") ?? 0) / 100,
                    valueText: "\(careerPercent(CareerJSON.optional(graduates, "share"))) · \(hired)/\(students)",
                    tint: Palette.success
                )
            } header: {
                CareerSectionHeader(
                    title: String(localized: "career.report.graduates", defaultValue: "Выпускной курс"),
                    hint: String(localized: "career.report.graduatesHint", defaultValue: "Те, кто выпускается в этом учебном году")
                )
            }
        }
    }

    @ViewBuilder
    private func companiesSection(_ data: JSONValue) -> some View {
        let companies = data["companies"]?.array ?? []
        if !companies.isEmpty {
            Section {
                ForEach(Array(companies.enumerated()), id: \.offset) { _, company in
                    let hired = CareerJSON.int(company, "hired").formatted()
                    let applications = CareerJSON.int(company, "applications").formatted()
                    let title = company["name"]?.string ?? "—"
                    if let id = company["id"]?.string {
                        NavigationLink(value: AppRoute.career(.company(id: id))) {
                            DetailRow(title: title, value: "\(String(localized: "career.funnel.hired", defaultValue: "Найм")): \(hired) · \(String(localized: "career.staff.applications", defaultValue: "Откликов")): \(applications)")
                        }
                    }
                }
            } header: {
                CareerSectionHeader(
                    title: String(localized: "career.report.companies", defaultValue: "Кто действительно нанимает"),
                    hint: String(localized: "career.report.companiesHint", defaultValue: "Топ компаний по найму за период")
                )
            }
        }
    }

    private func marketSection(_ data: JSONValue) -> some View {
        let cuts = data["vacancyCuts"]
        let cities = cuts?["cities"]?.array ?? []
        return Section {
            cutRows(String(localized: "career.vacancy.employment", defaultValue: "Занятость"), cuts?["employment"], CareerText.employment)
            cutRows(String(localized: "career.vacancy.format", defaultValue: "Формат работы"), cuts?["format"], CareerText.format)
            cutRows(String(localized: "career.vacancy.experience", defaultValue: "Опыт"), cuts?["experience"], CareerText.experience)
            if !cities.isEmpty {
                DetailRow(
                    title: String(localized: "career.report.cities", defaultValue: "География"),
                    value: cities.prefix(8).map { city in
                        "\(CareerKatoNames.shared.name(city["city"]?.string) ?? "—"): \(CareerJSON.int(city, "count").formatted())"
                    }.joined(separator: ", ")
                )
                .task { CareerKatoNames.shared.request(cities.map { $0["city"]?.string }) }
            }
            let dead = CareerJSON.int(data, "deadVacancies", "dead").formatted()
            let shown = CareerJSON.int(data, "deadVacancies", "shown").formatted()
            Text(String(localized: "career.report.dead", defaultValue: "Без единого отклика: \(dead) из \(shown) показываемых вакансий"))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
        } header: {
            CareerSectionHeader(
                title: String(localized: "career.report.market", defaultValue: "Что предлагают студентам"),
                hint: String(localized: "career.report.marketHint", defaultValue: "Срез витрины на сегодня: вакансия живёт дольше отклика")
            )
        }
    }

    private func cutRows(_ title: String, _ value: JSONValue?, _ label: @escaping (String?) -> String) -> some View {
        let entries = (value?.object ?? [:]).sorted { ($0.value.int ?? 0) > ($1.value.int ?? 0) }
        return DetailRow(
            title: title,
            value: entries.isEmpty ? "—" : entries.map { "\(label($0.key)): \(($0.value.int ?? 0).formatted())" }.joined(separator: ", ")
        )
    }

    private func salarySection(_ data: JSONValue) -> some View {
        let salary = data["salary"]
        let currency = salary?["currency"]?.string
        return Section {
            DetailRow(
                title: String(localized: "career.report.offered", defaultValue: "Предлагают"),
                value: CareerText.salary(min: salary?["offeredMin"]?.int, max: salary?["offeredMax"]?.int, currency: currency) ?? "—"
            )
            DetailRow(
                title: String(localized: "career.report.desired", defaultValue: "Ожидают студенты"),
                value: CareerText.salary(min: salary?["desiredMin"]?.int, max: salary?["desiredMax"]?.int, currency: currency) ?? "—"
            )
        } header: {
            CareerSectionHeader(
                title: String(localized: "career.profile.salary", defaultValue: "Зарплата"),
                hint: String(localized: "career.report.salaryHint", defaultValue: "Медианы: что предлагают вакансии вуза и чего ждут студенты")
            )
        }
    }

    private func studentsSection(_ data: JSONValue) -> some View {
        let students = data["students"]
        let buckets = students?["readiness"]?["buckets"]?.array ?? []
        let edges = students?["readiness"]?["edges"]?.array ?? []
        let totalBuckets = max(buckets.reduce(0) { $0 + ($1.int ?? 0) }, 1)
        let seekers = students?["seekers"]
        let profiles = students?["profiles"]
        return Section {
            ForEach(Array(buckets.enumerated()), id: \.offset) { index, bucket in
                let from = careerElement(edges, index)?.int ?? 0
                let to = careerElement(edges, index + 1)?.int ?? 100
                let range = "\(from)–\(to)"
                let count = bucket.int ?? 0
                ShareBar(
                    title: String(localized: "career.report.bucket", defaultValue: "\(range) баллов"),
                    fraction: Double(count) / Double(totalBuckets),
                    valueText: count.formatted()
                )
            }
            ForEach(CareerText.employmentStatuses, id: \.self) { status in
                DetailRow(title: CareerText.employmentStatus(status), value: CareerJSON.int(seekers, status).formatted())
            }
            DetailRow(
                title: String(localized: "career.report.profilesOpen", defaultValue: "Открыли профиль"),
                value: "\(CareerJSON.int(profiles, "visible").formatted()) / \(CareerJSON.int(profiles, "total").formatted()) · \(careerPercent(CareerJSON.optional(profiles, "share")))"
            )
            DetailRow(
                title: String(localized: "career.report.profilesOpened", defaultValue: "Открыли за период"),
                value: CareerJSON.int(profiles, "openedInPeriod").formatted()
            )
            DetailRow(
                title: String(localized: "career.report.resumes", defaultValue: "Резюме опубликовано"),
                value: CareerJSON.int(students, "resumesPublished").formatted()
            )
        } header: {
            CareerSectionHeader(
                title: String(localized: "career.report.students", defaultValue: "Готовность и настрой студентов"),
                hint: String(localized: "career.report.studentsHint", defaultValue: "Открыть профиль и заполнить его — разные вещи")
            )
        }
    }
}

private func careerElement(_ array: [JSONValue], _ index: Int) -> JSONValue? {
    array.indices.contains(index) ? array[index] : nil
}

// MARK: - Страница компании

/// Витрина компании: сотрудникам, платформе и ролям вуза с действующим допуском.
struct CareerCompanyView: View {
    let id: String

    @Environment(\.viewerRole) private var role
    @State private var token = 0
    @State private var kato = CareerKatoNames.shared

    private struct Content {
        var company: CareerCompany
        /// `nil` — публикации не загрузились: не «Публикаций пока нет».
        var posts: [PostDTO]?
        var postsFailure: String?
        /// Публикаций этому зрителю не будет по ответу сервера — секции нет вовсе.
        var postsHidden = false
    }

    var body: some View {
        RemoteContent(reloadToken: token, load: load) { content in
            let company = content.company
            List {
                Section {
                    HeroHeader(
                        visual: .avatar(url: company.logoUrl, name: company.name),
                        title: company.name,
                        subtitle: [company.industry, kato.name(company.city), company.size.map(CareerText.companySize)]
                            .compactMap { $0 }
                            .joined(separator: " · "),
                        actions: contactActions(company)
                    )
                }

                if let description = company.description, !description.isEmpty {
                    Section {
                        Text(description).textSelection(.enabled)
                    } header: {
                        Text(String(localized: "career.company.about", defaultValue: "О компании"))
                    }
                }

                CareerCompanyDetailsSection(company: company)

                if !content.postsHidden {
                    postsSection(content)
                }
            }
            .listStyle(.insetGrouped)
            .pullToRefresh { token += 1 }
            .task(id: company.id) { kato.request([company.city]) }
            .toolbar {
                if company.isMember == true, role == .employer {
                    ToolbarItem(placement: .topBarTrailing) {
                        NavigationLink(value: AppRoute.career(.companyProfile)) {
                            Image(systemName: "pencil")
                        }
                        .accessibilityLabel(Text(String(localized: "career.company.edit", defaultValue: "Изменить")))
                    }
                }
            }
        }
        .navigationTitle(Text(CareerScreen.company(id: id).title))
        .navigationBarTitleDisplayMode(.inline)
    }

    @Environment(\.openURL) private var openURL

    /// Публикации страницы: строки постов, «пока нет» или сбой загрузки с повтором.
    private func postsSection(_ content: Content) -> some View {
        let company = content.company
        return Section {
            if let failure = content.postsFailure {
                DashboardFailurePlaceholder(message: failure) { token += 1 }
            } else if content.posts?.isEmpty == true {
                Text(String(localized: "career.company.noPosts", defaultValue: "Публикаций пока нет"))
                    .foregroundStyle(Palette.mutedForeground)
            }
            ForEach(content.posts ?? []) { post in
                NavigationLink(value: AppRoute.post(id: post.id)) {
                    TelegramStyleRow(
                        title: post.title ?? String((post.content ?? "").prefix(120)),
                        subtitle: post.title == nil ? nil : post.content.map { String($0.prefix(160)) },
                        meta: DisplayFormat.date(post.publishedAt ?? post.createdAt)
                    ) {
                        AvatarView(url: company.logoUrl, name: company.name, size: 40)
                    }
                }
            }
        } header: {
            Text(String(localized: "career.company.posts", defaultValue: "Публикации"))
        }
    }

    /// Сайт, почта и звонок — кругами под шапкой, если компания их указала.
    private func contactActions(_ company: CareerCompany) -> [HeroAction] {
        var actions: [HeroAction] = []
        if let site = company.website, let url = URL(string: site) {
            actions.append(HeroAction(title: String(localized: "career.company.siteShort", defaultValue: "Сайт"), symbol: "globe") { openURL(url) })
        }
        if let email = company.contactEmail, let url = URL(string: "mailto:\(email)") {
            actions.append(HeroAction(title: String(localized: "career.candidate.mail", defaultValue: "Почта"), symbol: "envelope.fill") { openURL(url) })
        }
        if let phone = company.contactPhone, let url = URL(string: "tel:\(phone.filter { $0.isNumber || $0 == "+" })") {
            actions.append(HeroAction(title: String(localized: "career.candidate.call", defaultValue: "Позвонить"), symbol: "phone.fill") { openURL(url) })
        }
        return actions
    }

    private func load() async throws -> Content {
        let api = CareerAPI()
        let company = try await api.company(id: id)
        do {
            let posts = try await api.companyPosts(companyID: id)
            return Content(company: company, posts: posts)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as APIError where Self.hidesPosts(error) {
            // Сервер отказал по существу, а не по сбою: повтор ничего не изменит, и
            // предупреждение с «Повторить» на витрине компании только пугает. Секцию
            // публикаций просто не показываем.
            return Content(company: company, posts: nil, postsHidden: true)
        } catch {
            return Content(company: company, posts: nil, postsFailure: error.userMessage)
        }
    }

    /// Отказ, после которого публикаций этому зрителю не будет: нет прав на ленту
    /// компании или сервер не принял её id. Последнее — сидовые компании с id не в
    /// формате uuid (`seed-co-turan-media`): `FeedQuerySchema.companyId` требует uuid,
    /// и `GET /posts?companyId=…` отвечает VALIDATION_ERROR, хотя саму страницу
    /// (`/career/companies/:id`) сервер отдаёт.
    private static func hidesPosts(_ error: APIError) -> Bool {
        switch error.code {
        case .forbidden?, .wrongScope?, .notFound?, .validationError?, .badRequest?: return true
        default: return false
        }
    }
}

/// Сведения компании: сайт, контакты, адрес, соцсети.
struct CareerCompanyDetailsSection: View {
    let company: CareerCompany

    var body: some View {
        let rows: [(String, String, String, URL?)] = [
            (String(localized: "career.company.website", defaultValue: "Сайт"), company.website ?? "", "globe", company.website.flatMap(URL.init(string:))),
            (String(localized: "career.company.founded", defaultValue: "Год основания"), company.foundedYear.map { String($0) } ?? "", "calendar", nil),
            (String(localized: "career.company.email", defaultValue: "Email"), company.contactEmail ?? "", "envelope", company.contactEmail.flatMap { URL(string: "mailto:\($0)") }),
            (String(localized: "career.company.phone", defaultValue: "Телефон"), company.contactPhone ?? "", "phone", company.contactPhone.flatMap { URL(string: "tel:\($0.filter { $0.isNumber || $0 == "+" })") }),
            (String(localized: "career.company.address", defaultValue: "Адрес"), company.address ?? "", "mappin.and.ellipse", nil),
            ("Telegram", company.telegram ?? "", "paperplane", nil),
            ("Instagram", company.instagram ?? "", "camera", nil),
            ("LinkedIn", company.linkedin ?? "", "link", nil),
        ].filter { !$0.1.isEmpty }
        if !rows.isEmpty {
            Section {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    if let url = row.3 {
                        Link(destination: url) {
                            DetailRow(title: row.0, value: row.1, symbol: row.2)
                        }
                    } else {
                        DetailRow(title: row.0, value: row.1, symbol: row.2)
                    }
                }
            }
        }
    }
}
