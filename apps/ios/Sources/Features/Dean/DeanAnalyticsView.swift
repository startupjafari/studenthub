import SwiftUI

/// Аналитика факультета: показатели, «требуют внимания» поимённо с причинами по
/// колонкам и группы по посещаемости с переходом в карточку группы. Факультет декана
/// задаёт токен — выбора факультета здесь нет.
struct DeanAnalyticsView: View {
    private enum Tab: Hashable { case students, groups }
    private enum RiskSort: Hashable { case risk, name, attendance, overdue, grades }

    /// Сводка факультета и «требуют внимания» — независимо (`RemoteValue`): список
    /// риска не пришёл — сводка всё равно на экране.
    @State private var overviewRemote = RemoteValue<DeanFacultyOverview>()
    @State private var riskRemote = RemoteValue<DeanAtRisk>()
    @State private var tab: Tab? = .students
    @State private var riskSort: RiskSort = .risk
    @State private var reasonFilter: String?
    @State private var exportOptions = false
    @State private var exporter = DeanFileExporter()

    private let api = DeanAPI()

    private var overview: DeanFacultyOverview? { overviewRemote.value }
    private var risk: DeanAtRisk? { riskRemote.value }
    private var failure: String? { overviewRemote.failure }
    private var isOffline: Bool { overviewRemote.isOffline }
    private var riskFailure: String? { riskRemote.failure }
    private var riskOffline: Bool { riskRemote.isOffline }

    var body: some View {
        List {
            if let overview {
                if let failure {
                    StaleDataBanner(message: failure, isOffline: isOffline) { await load() }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                summary(overview)
                FilterChipsRow(
                    options: [
                        (Tab.students, String(localized: "dean.analytics.tabStudents", defaultValue: "Требуют внимания") + " · \((risk?.students.count ?? 0).formatted())"),
                        (Tab.groups, String(localized: "dean.analytics.tabGroups", defaultValue: "Группы") + " · \(overview.groups.count.formatted())"),
                    ],
                    selection: $tab
                )
                if tab == .groups {
                    groups(overview)
                } else {
                    students(total: overview.totals.students)
                }
            }
        }
        .dashboardListStyle()
        .screenState(overview == nil) {
            if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .navigationTitle(Text(DeanScreen.analytics.title))
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if tab != .groups, !(risk?.students.isEmpty ?? true) {
                    Menu {
                        Picker(String(localized: "dean.sort.by", defaultValue: "Сортировать"), selection: $riskSort) {
                            Text(String(localized: "dean.analytics.sortRisk", defaultValue: "Сначала тяжёлые")).tag(RiskSort.risk)
                            Text(String(localized: "dean.sort.name", defaultValue: "По имени")).tag(RiskSort.name)
                            Text(String(localized: "dean.analytics.sortAttendance", defaultValue: "По посещаемости")).tag(RiskSort.attendance)
                            Text(String(localized: "dean.analytics.sortOverdue", defaultValue: "По просрочкам")).tag(RiskSort.overdue)
                            Text(String(localized: "dean.analytics.sortGrades", defaultValue: "По оценкам")).tag(RiskSort.grades)
                        }
                    } label: {
                        Image(systemName: "arrow.up.arrow.down")
                    }
                    .accessibilityLabel(Text(String(localized: "dean.sort.by", defaultValue: "Сортировать")))
                }
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
                .presentationDetents([.medium, .large])
        }
        .deanExportSheet(exporter)
        .pullToRefresh { await load() }
        // Показ, возврат на экран и возврат приложения из фона — сохранённое на месте,
        // сеть обновляет фоном.
        .task(id: AppLifecycle.shared.foregroundEpoch) { await load() }
    }

    private var threshold: Double { risk?.thresholds.attendance ?? 60 }

    // MARK: Показатели

    /// Главные цифры факультета — теми же плитками, что на обзорах всех ролей.
    private func summary(_ overview: DeanFacultyOverview) -> some View {
        let totals = overview.totals
        let lowAttendance = (totals.attendanceRate ?? 100) < threshold
        return DashboardMetricsSection(metrics: [
            DashboardMetric(
                title: String(localized: "dean.kpi.attendance", defaultValue: "Посещаемость"),
                value: totals.attendanceRate.map { DeanText.percent($0) },
                symbol: "percent",
                tint: lowAttendance ? Palette.destructive : Palette.info
            ),
            DashboardMetric(
                title: String(localized: "dean.kpi.submissions", defaultValue: "Работ на проверке"),
                value: totals.submissionsPending.formatted(),
                symbol: "tray.full",
                tint: Palette.warning
            ),
            DashboardMetric(
                title: String(localized: "dean.kpi.students", defaultValue: "Студенты"),
                value: totals.students.formatted(),
                symbol: "person.2"
            ),
            DashboardMetric(
                title: String(localized: "dean.kpi.groups", defaultValue: "Группы"),
                value: totals.groups.formatted(),
                symbol: "person.3",
                tint: TileTint.teal
            ),
            DashboardMetric(
                title: String(localized: "dean.kpi.exams", defaultValue: "Экзамены впереди"),
                value: totals.examsUpcoming.formatted(),
                symbol: "graduationcap",
                tint: TileTint.purple
            ),
        ])
    }

    // MARK: Студенты в риске

    @ViewBuilder
    private func students(total: Int) -> some View {
        if let riskFailure, risk == nil {
            ErrorStateView(message: riskFailure, isOffline: riskOffline) { await load() }
                .listRowBackground(Color.clear)
        } else if let risk {
            if risk.students.isEmpty {
                EmptyStateView(
                    title: String(localized: "dean.chart.noRisk", defaultValue: "Никто не требует внимания"),
                    symbol: "checkmark.seal",
                    hint: String(localized: "dean.analytics.noRiskHint", defaultValue: "Посещаемость, сроки и оценки у всех в норме")
                )
                .listRowBackground(Color.clear)
            } else {
                let counts = ["LOW_ATTENDANCE", "OVERDUE_ASSIGNMENTS", "LOW_GRADES"].map { kind in
                    (kind, risk.students.filter { $0.value(kind) != nil }.count)
                }
                Section {
                    DeanCountChart(
                        bars: counts.map { (DeanText.riskReason($0.0), $0.1) },
                        tint: Palette.destructive
                    )
                } header: {
                    Text(String(localized: "dean.analytics.riskCount", defaultValue: "\(risk.students.count.formatted()) из \(total.formatted()) студентов"))
                } footer: {
                    Text(String(localized: "dean.analytics.riskHint", defaultValue: "Сначала те, у кого больше причин; при равном числе — у кого хуже само значение."))
                }

                FilterChipsRow(options: reasonOptions(counts), selection: $reasonFilter)

                Section {
                    ForEach(sortedRisk(risk.students)) { student in
                        NavigationLink(value: AppRoute.dean(.student(id: student.studentId))) {
                            DeanRiskRow(student: student)
                        }
                    }
                }
            }
        } else {
            LoadingStateView().listRowBackground(Color.clear)
        }
    }

    private func reasonOptions(_ counts: [(String, Int)]) -> [(value: String?, title: String)] {
        var options: [(value: String?, title: String)] = [
            (nil, String(localized: "dean.analytics.allReasons", defaultValue: "Все причины")),
        ]
        for item in counts where item.1 > 0 {
            options.append((item.0, DeanText.riskReason(item.0) + " · " + item.1.formatted()))
        }
        return options
    }

    private func sortedRisk(_ list: [DeanAtRisk.Student]) -> [DeanAtRisk.Student] {
        let filtered = reasonFilter.map { kind in list.filter { $0.value(kind) != nil } } ?? list
        switch riskSort {
        case .name: return filtered.sorted { $0.name < $1.name }
        case .attendance: return filtered.sorted { ($0.value("LOW_ATTENDANCE") ?? 101) < ($1.value("LOW_ATTENDANCE") ?? 101) }
        case .overdue: return filtered.sorted { ($0.value("OVERDUE_ASSIGNMENTS") ?? 0) > ($1.value("OVERDUE_ASSIGNMENTS") ?? 0) }
        case .grades: return filtered.sorted { ($0.value("LOW_GRADES") ?? 101) < ($1.value("LOW_GRADES") ?? 101) }
        case .risk:
            // Не взвешенный балл, а объяснимый порядок: число причин, потом сами значения.
            return filtered.sorted { a, b in
                if a.reasons.count != b.reasons.count { return a.reasons.count > b.reasons.count }
                let att = (a.value("LOW_ATTENDANCE") ?? 101, b.value("LOW_ATTENDANCE") ?? 101)
                if att.0 != att.1 { return att.0 < att.1 }
                let overdue = (a.value("OVERDUE_ASSIGNMENTS") ?? 0, b.value("OVERDUE_ASSIGNMENTS") ?? 0)
                if overdue.0 != overdue.1 { return overdue.0 > overdue.1 }
                let grade = (a.value("LOW_GRADES") ?? 101, b.value("LOW_GRADES") ?? 101)
                if grade.0 != grade.1 { return grade.0 < grade.1 }
                return a.name < b.name
            }
        }
    }

    // MARK: Группы

    @ViewBuilder
    private func groups(_ overview: DeanFacultyOverview) -> some View {
        if overview.groups.isEmpty {
            EmptyStateView(title: String(localized: "dean.groups.empty", defaultValue: "Групп пока нет"), symbol: "person.3")
                .listRowBackground(Color.clear)
        } else {
            Section {
                ForEach(overview.groups) { group in
                    NavigationLink(value: AppRoute.dean(.group(id: group.groupId))) {
                        HStack(spacing: Spacing.lg) {
                            AvatarView(url: nil, name: group.name, size: 40)
                            DeanRateRow(
                                title: group.name,
                                subtitle: String(localized: "dean.analytics.groupStudents", defaultValue: "Студентов: \(group.students.formatted())"),
                                rate: group.attendanceRate,
                                badge: (group.attendanceRate.map { $0 < threshold } ?? false) ? String(localized: "dean.risk.badge", defaultValue: "Риск") : nil
                            )
                        }
                    }
                }
            } footer: {
                Text(String(localized: "dean.analytics.groupsHint", defaultValue: "«Риск» — посещаемость ниже порога \(DeanText.percent(threshold)). Группа открывается поимённо."))
            }
        }
    }

    private func load() async {
        async let overview: Void = overviewRemote.load(api.facultyOverview)
        async let risk: Void = riskRemote.load(api.atRisk)
        _ = await (overview, risk)
    }
}

/// Студент в риске: причины по отдельным строкам, отсутствующая — не показана.
private struct DeanRiskRow: View {
    let student: DeanAtRisk.Student

    var body: some View {
        HStack(spacing: Spacing.lg) {
            AvatarView(url: nil, name: student.name, size: 44)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                    Text(student.name)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Palette.foreground)
                        .lineLimit(2)
                    Spacer(minLength: Spacing.sm)
                    if let group = student.groupName {
                        Text(group)
                            .font(.subheadline)
                            .foregroundStyle(Palette.mutedForeground)
                            .lineLimit(1)
                    }
                }
                HStack(spacing: Spacing.lg) {
                    if let value = student.value("LOW_ATTENDANCE") {
                        metric("percent", DeanText.percent(value), Palette.destructive)
                    }
                    if let value = student.value("OVERDUE_ASSIGNMENTS") {
                        metric("clock.badge.exclamationmark", Int(value).formatted(), Palette.warning)
                    }
                    if let value = student.value("LOW_GRADES") {
                        metric("chart.line.downtrend.xyaxis", DeanText.percent(value), Palette.destructive)
                    }
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(([student.name] + student.reasons.map { DeanRiskText.line($0) }).joined(separator: ", ")))
    }

    private func metric(_ symbol: String, _ value: String, _ tint: Color) -> some View {
        Label {
            Text(verbatim: value).monospacedDigit()
        } icon: {
            Image(systemName: symbol)
        }
        .font(Typography.meta)
        .foregroundStyle(tint)
    }
}
