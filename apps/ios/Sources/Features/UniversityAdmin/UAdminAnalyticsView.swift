import SwiftUI

// Аналитика факультета (`views/dean-analytics` в режиме админа вуза): выбор факультета,
// показатели, студенты «требуют внимания» с причинами по колонкам и группы с переходом
// в посещаемость по студентам. Отчёт файлом — по выбранному факультету.

struct UAdminAnalyticsView: View {
    @State private var faculties: [UAdminFacultyDTO]?
    @State private var facultyID: String?
    @State private var overview: UAdminFacultyOverviewDTO?
    @State private var risk: UAdminAtRiskStudentsDTO?
    @State private var riskFailed = false
    @State private var failure: String?
    @State private var isOffline = false
    @State private var tab: AnalyticsTab = .students
    @State private var sort: RiskSort = .risk
    @State private var exporting = false

    private var threshold: Double { risk?.thresholds?.attendance ?? 60 }

    var body: some View {
        List {
            if let faculties {
                if faculties.isEmpty {
                    EmptyStateView(
                        title: String(localized: "uadmin.analytics.noFaculties", defaultValue: "Сначала заведите факультет"),
                        symbol: "building.columns",
                        hint: String(localized: "uadmin.analytics.noFacultiesHint", defaultValue: "Аналитика считается по факультетам, а в вузе их пока нет.")
                    )
                    .listRowBackground(Color.clear)
                    NavigationLink(value: AppRoute.uniAdmin(.faculties)) {
                        Label(String(localized: "uadmin.analytics.openFaculties", defaultValue: "К факультетам"), systemImage: "building.columns")
                    }
                    .listRowBackground(Palette.card)
                } else {
                    Section {
                        Picker(String(localized: "uadmin.faculty", defaultValue: "Факультет"), selection: $facultyID) {
                            ForEach(faculties) { Text($0.name).tag(Optional($0.id)) }
                        }
                    }
                    .listRowBackground(Palette.card)
                    content
                }
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await loadFaculties() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "uadmin.analytics.title", defaultValue: "Аналитика факультета")))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    exporting = true
                } label: {
                    Image(systemName: "square.and.arrow.down")
                }
                .disabled(facultyID == nil)
                .accessibilityLabel(Text(String(localized: "uadmin.report.button", defaultValue: "Выгрузить отчёт")))
            }
        }
        .sheet(isPresented: $exporting) { UAdminReportExportSheet(facultyID: facultyID) }
        .onChange(of: facultyID) { _, _ in Task { await loadFaculty() } }
        .refreshable { await loadFaculty() }
        .task { if faculties == nil { await loadFaculties() } }
    }

    @ViewBuilder
    private var content: some View {
        if let overview, overview.facultyId == facultyID {
            Section {
                StatGrid {
                    StatTile(title: String(localized: "uadmin.analytics.students", defaultValue: "Студентов"), value: overview.totals.students.formatted(), symbol: "person.2")
                    StatTile(title: String(localized: "uadmin.analytics.groups", defaultValue: "Групп"), value: overview.totals.groups.formatted(), symbol: "person.3")
                    StatTile(
                        title: String(localized: "uadmin.analytics.attendance", defaultValue: "Посещаемость"),
                        value: overview.totals.attendanceRate.map { DisplayFormat.percent($0) } ?? UAdminText.empty,
                        symbol: "percent",
                        tint: (overview.totals.attendanceRate ?? 100) < threshold ? Palette.destructive : Palette.info
                    )
                    StatTile(title: String(localized: "uadmin.analytics.submissions", defaultValue: "Работ на проверке"), value: overview.totals.submissionsPending.formatted(), symbol: "tray.full", tint: Palette.warning)
                    StatTile(title: String(localized: "uadmin.analytics.exams", defaultValue: "Экзаменов впереди"), value: overview.totals.examsUpcoming.formatted(), symbol: "calendar.badge.clock")
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }
            Section {
                Picker(String(localized: "uadmin.analytics.slice", defaultValue: "Разрез"), selection: $tab) {
                    Text(String(localized: "uadmin.analytics.tab.students", defaultValue: "Требуют внимания")).tag(AnalyticsTab.students)
                    Text(String(localized: "uadmin.analytics.tab.groups", defaultValue: "Группы")).tag(AnalyticsTab.groups)
                }
                .pickerStyle(.segmented)
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())

            switch tab {
            case .students: riskSection(totalStudents: overview.totals.students)
            case .groups: groupsSection(overview.groups)
            }
        } else if failure != nil {
            EmptyView()
        } else {
            LoadingStateView().listRowBackground(Color.clear)
        }
    }

    @ViewBuilder
    private func riskSection(totalStudents: Int) -> some View {
        if riskFailed {
            ErrorStateView(message: String(localized: "state.failed", defaultValue: "Не удалось загрузить")) { await loadFaculty() }
                .listRowBackground(Color.clear)
        } else if let risk {
            let rows = sorted(risk.students)
            if rows.isEmpty {
                EmptyStateView(
                    title: String(localized: "uadmin.analytics.riskEmpty", defaultValue: "Никто не требует внимания"),
                    symbol: "checkmark.seal",
                    hint: String(localized: "uadmin.analytics.riskEmptyHint", defaultValue: "Ни у одного студента факультета нет низкой посещаемости, просрочек или низких оценок.")
                )
                .listRowBackground(Color.clear)
            } else {
                Section {
                    // Счётчики по причинам — «что именно происходит», до чтения строк.
                    HStack(spacing: Spacing.sm) {
                        StatusBadge(text: String(localized: "uadmin.analytics.countAttendance", defaultValue: "Посещаемость: \(rows.filter { $0.value("LOW_ATTENDANCE") != nil }.count.formatted())"), tint: Palette.destructive)
                        StatusBadge(text: String(localized: "uadmin.analytics.countOverdue", defaultValue: "Просрочки: \(rows.filter { $0.value("OVERDUE_ASSIGNMENTS") != nil }.count.formatted())"), tint: Palette.warning)
                        StatusBadge(text: String(localized: "uadmin.analytics.countGrade", defaultValue: "Оценки: \(rows.filter { $0.value("LOW_GRADES") != nil }.count.formatted())"), tint: Palette.destructive)
                    }
                    ForEach(rows) { student in
                        NavigationLink(value: AppRoute.profile(id: student.studentId)) {
                            RiskRow(student: student)
                        }
                    }
                } header: {
                    HStack {
                        Text(String(localized: "uadmin.analytics.riskCount", defaultValue: "\(rows.count.formatted()) из \(totalStudents.formatted()) студентов"))
                        Spacer()
                        Menu {
                            Picker(String(localized: "uadmin.sort", defaultValue: "Сортировка"), selection: $sort) {
                                ForEach(RiskSort.allCases) { Text($0.title).tag($0) }
                            }
                        } label: {
                            Image(systemName: "arrow.up.arrow.down")
                        }
                        .accessibilityLabel(Text(String(localized: "uadmin.sort", defaultValue: "Сортировка")))
                    }
                } footer: {
                    Text(String(localized: "uadmin.analytics.riskHint", defaultValue: "Сверху — у кого проблем больше; при равном числе вперёд идёт худшее значение."))
                }
                .listRowBackground(Palette.card)
            }
        } else {
            LoadingStateView().listRowBackground(Color.clear)
        }
    }

    private func groupsSection(_ groups: [UAdminFacultyOverviewDTO.GroupStat]) -> some View {
        Section {
            if groups.isEmpty {
                Text(String(localized: "uadmin.analytics.noGroups", defaultValue: "Групп нет")).foregroundStyle(Palette.mutedForeground)
            }
            ForEach(groups) { group in
                NavigationLink(value: AppRoute.uniAdmin(.groupAttendance(groupID: group.groupId, name: group.name))) {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        HStack {
                            Text(group.name).font(Typography.cardTitle).foregroundStyle(Palette.foreground)
                            Spacer()
                            Text(String(localized: "uadmin.analytics.groupStudents", defaultValue: "\(group.students.formatted()) студ."))
                                .font(Typography.meta)
                                .foregroundStyle(Palette.mutedForeground)
                        }
                        if let rate = group.attendanceRate {
                            ShareBar(
                                title: String(localized: "uadmin.analytics.attendance", defaultValue: "Посещаемость"),
                                fraction: rate / 100,
                                valueText: DisplayFormat.percent(rate),
                                tint: rate >= 75 ? Palette.success : rate >= threshold ? Palette.warning : Palette.destructive
                            )
                        } else {
                            Text(String(localized: "uadmin.analytics.notTracked", defaultValue: "Посещаемость ещё не отмечали"))
                                .font(Typography.meta)
                                .foregroundStyle(Palette.mutedForeground)
                        }
                    }
                    .padding(.vertical, Spacing.xs)
                }
            }
        } footer: {
            Text(String(localized: "uadmin.analytics.groupsHint", defaultValue: "Все группы факультета — нажмите, чтобы разобрать по студентам"))
        }
        .listRowBackground(Palette.card)
    }

    /// Порядок по умолчанию — объяснимый словами: больше причин выше, при равенстве — хуже
    /// посещаемость, больше просрочек, ниже балл, затем по алфавиту.
    private func sorted(_ students: [UAdminAtRiskStudentsDTO.Student]) -> [UAdminAtRiskStudentsDTO.Student] {
        switch sort {
        case .risk:
            return students.sorted { a, b in
                if a.reasons.count != b.reasons.count { return a.reasons.count > b.reasons.count }
                let aa = a.value("LOW_ATTENDANCE") ?? 101, ba = b.value("LOW_ATTENDANCE") ?? 101
                if aa != ba { return aa < ba }
                let ao = a.value("OVERDUE_ASSIGNMENTS") ?? 0, bo = b.value("OVERDUE_ASSIGNMENTS") ?? 0
                if ao != bo { return ao > bo }
                let ag = a.value("LOW_GRADES") ?? 101, bg = b.value("LOW_GRADES") ?? 101
                if ag != bg { return ag < bg }
                return a.name.localizedCompare(b.name) == .orderedAscending
            }
        case .name:
            return students.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
        case .group:
            return students.sorted { ($0.groupName ?? "").localizedStandardCompare($1.groupName ?? "") == .orderedAscending }
        case .attendance:
            return students.sorted { ($0.value("LOW_ATTENDANCE") ?? 101) < ($1.value("LOW_ATTENDANCE") ?? 101) }
        case .overdue:
            return students.sorted { ($0.value("OVERDUE_ASSIGNMENTS") ?? 0) > ($1.value("OVERDUE_ASSIGNMENTS") ?? 0) }
        case .grade:
            return students.sorted { ($0.value("LOW_GRADES") ?? 101) < ($1.value("LOW_GRADES") ?? 101) }
        }
    }

    @MainActor
    private func loadFaculties() async {
        do {
            let list = try await UAdminAPI().faculties()
            faculties = list
            failure = nil
            if facultyID == nil {
                facultyID = list.first?.id
            }
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    @MainActor
    private func loadFaculty() async {
        guard let facultyID else { return }
        let api = UAdminAPI()
        async let overviewTask = api.facultyOverview(facultyID: facultyID)
        async let riskTask = api.atRiskStudents(facultyID: facultyID)
        do {
            let loaded = try await overviewTask
            guard facultyID == self.facultyID else { return }
            overview = loaded
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
            overview = nil
        }
        do {
            let loaded = try await riskTask
            guard facultyID == self.facultyID else { return }
            risk = loaded
            riskFailed = false
        } catch is CancellationError {
            return
        } catch {
            riskFailed = true
        }
    }
}

private enum AnalyticsTab: Hashable {
    case students, groups
}

private enum RiskSort: String, CaseIterable, Identifiable {
    case risk, name, group, attendance, overdue, grade

    var id: String { rawValue }

    var title: String {
        switch self {
        case .risk: return String(localized: "uadmin.analytics.sort.risk", defaultValue: "По риску")
        case .name: return String(localized: "uadmin.analytics.sort.name", defaultValue: "По имени")
        case .group: return String(localized: "uadmin.analytics.sort.group", defaultValue: "По группе")
        case .attendance: return String(localized: "uadmin.analytics.sort.attendance", defaultValue: "По посещаемости")
        case .overdue: return String(localized: "uadmin.analytics.sort.overdue", defaultValue: "По просрочкам")
        case .grade: return String(localized: "uadmin.analytics.sort.grade", defaultValue: "По среднему баллу")
        }
    }
}

/// Строка риска: причины разложены по подписям, отсутствующая — не показывается (это не «ноль»).
private struct RiskRow: View {
    let student: UAdminAtRiskStudentsDTO.Student

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(student.name).font(Typography.body).foregroundStyle(Palette.foreground)
            if let group = student.groupName {
                Text(group).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
            }
            HStack(spacing: Spacing.sm) {
                if let value = student.value("LOW_ATTENDANCE") {
                    StatusBadge(text: String(localized: "uadmin.analytics.reason.attendance", defaultValue: "Посещаемость \(DisplayFormat.percent(value))"), tint: Palette.destructive)
                }
                if let value = student.value("OVERDUE_ASSIGNMENTS") {
                    StatusBadge(text: String(localized: "uadmin.analytics.reason.overdue", defaultValue: "Просрочено: \(JSONValue.format(value))"), tint: Palette.warning)
                }
                if let value = student.value("LOW_GRADES") {
                    StatusBadge(text: String(localized: "uadmin.analytics.reason.grade", defaultValue: "Балл \(JSONValue.format(value))"), tint: Palette.destructive)
                }
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Посещаемость группы

/// Разбор группы по студентам: процент и сколько занятий отмечено.
struct UAdminGroupAttendanceView: View {
    let groupID: String
    let name: String

    private static let threshold: Double = 60

    var body: some View {
        RemoteContent(load: { try await UAdminAPI().groupAttendance(groupID: groupID) }) { data in
            List {
                Section {
                    if data.students.isEmpty {
                        Text(String(localized: "uadmin.group.noMembers", defaultValue: "В группе пока нет участников"))
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    ForEach(data.students.sorted { ($0.attendanceRate ?? 101) < ($1.attendanceRate ?? 101) }) { student in
                        NavigationLink(value: AppRoute.profile(id: student.studentId)) {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(student.name).foregroundStyle(Palette.foreground)
                                    Text(String(localized: "uadmin.analytics.tracked", defaultValue: "Отмечено занятий: \(student.tracked.formatted())"))
                                        .font(Typography.meta)
                                        .foregroundStyle(Palette.mutedForeground)
                                }
                                Spacer()
                                if let rate = student.attendanceRate {
                                    StatusBadge(
                                        text: DisplayFormat.percent(rate),
                                        tint: rate < Self.threshold ? Palette.destructive : rate < 75 ? Palette.warning : Palette.success
                                    )
                                } else {
                                    Text(verbatim: UAdminText.empty).foregroundStyle(Palette.mutedForeground)
                                }
                            }
                        }
                    }
                } footer: {
                    Text(String(localized: "uadmin.analytics.groupAttendance", defaultValue: "Посещаемость по студентам: сверху — у кого ниже"))
                }
                .listRowBackground(Palette.card)
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
        }
        .background(Palette.background)
        .navigationTitle(Text(name))
        .navigationBarTitleDisplayMode(.inline)
    }
}
