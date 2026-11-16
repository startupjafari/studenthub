import SwiftUI

// Группы факультета и карточка группы: состав, староста, посещаемость, кто требует
// внимания, дисциплины и расписание группы. Создание и удаление групп — права админа
// вуза; декан назначает старост своего факультета.

/// Список групп факультета с поиском на сервере. Строки — как список чатов: инициалы
/// группы, название, год набора справа, староста строкой ниже.
struct DeanGroupsView: View {
    @State private var search = ""
    @State private var loader: PagedLoader<DeanGroup>

    private let api = DeanAPI()

    init() {
        let api = DeanAPI()
        _loader = State(initialValue: PagedLoader(limit: 50) { request in
            try await api.groups(request, search: nil)
        })
    }

    var body: some View {
        PagedList(loader: loader, empty: emptyState) { group in
            NavigationLink(value: AppRoute.dean(.group(id: group.id))) {
                DeanGroupRow(group: group)
            }
            .contextMenu {
                NavigationLink(value: AppRoute.dean(.groupSchedule(id: group.id))) {
                    Label(String(localized: "dean.group.editSchedule", defaultValue: "Редактировать расписание"), systemImage: "calendar")
                }
            }
        }
        .navigationTitle(Text(DeanScreen.groups.title))
        .deanDebouncedSearch($search, prompt: String(localized: "dean.groups.search", defaultValue: "Название группы")) { needle in
            await loader.replace { request in try await api.groups(request, search: needle) }
        }
    }

    private var emptyState: EmptyStateView {
        if search.isEmpty {
            return EmptyStateView(
                title: String(localized: "dean.groups.empty", defaultValue: "Групп пока нет"),
                symbol: "person.3",
                hint: String(localized: "dean.groups.emptyHint", defaultValue: "Группы факультета заводит администратор вуза")
            )
        }
        return EmptyStateView(
            title: String(localized: "dean.picker.empty", defaultValue: "Ничего не найдено"),
            symbol: "magnifyingglass"
        )
    }
}

/// Группа строкой списка: инициалы, название, год набора, есть ли староста.
private struct DeanGroupRow: View {
    let group: DeanGroup

    var body: some View {
        TelegramStyleRow(title: group.name, subtitle: subtitle, meta: meta) {
            AvatarView(url: nil, name: group.name, size: 48)
        } accessory: {
            if group.starostaId == nil {
                StatusBadge(text: String(localized: "dean.groups.noStarosta", defaultValue: "Без старосты"), tint: Palette.warning)
            }
        }
    }

    private var meta: String? {
        guard let year = group.year else { return nil }
        return String(year)
    }

    private var subtitle: String {
        group.starostaId == nil
            ? String(localized: "dean.group.noStarosta", defaultValue: "Староста не назначен")
            : String(localized: "dean.groups.hasStarosta", defaultValue: "Есть староста")
    }
}

/// Карточка группы в духе профиля Telegram: инициалы и название по центру, ряд круглых
/// кнопок (расписание, посещаемость, староста), ниже — состав, кто требует внимания,
/// посещаемость, дисциплины и неделя группы.
struct DeanGroupView: View {
    let groupID: String

    @State private var reload = 0
    @State private var actionFailure: String?
    @State private var pendingStarosta: StarostaChange?
    @State private var isSaving = false

    private let api = DeanAPI()

    var body: some View {
        RemoteContent(reloadToken: reload, load: { try await load() }) { data in
            content(data)
        }
        .navigationTitle(Text(DeanScreen.group(id: groupID).title))
        .navigationBarTitleDisplayMode(.inline)
        .actionFailureAlert($actionFailure)
        .alert(
            pendingStarosta?.title ?? "",
            isPresented: Binding(get: { pendingStarosta != nil }, set: { if !$0 { pendingStarosta = nil } }),
            presenting: pendingStarosta
        ) { change in
            Button(change.actionTitle, role: change.studentID == nil ? .destructive : nil) {
                Task { await apply(change) }
            }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
        } message: { change in
            Text(change.message)
        }
    }

    private struct Snapshot {
        var group: DeanGroup
        var members: [DeanGroupMember]
        var attendance: DeanGroupAttendance?
        var risk: [DeanAtRisk.Student]
        var courses: [DeanCourse]
        var pairs: [DeanPair]
        /// Сбой сводки показывается в её секции, а не пустотой («не отмечали», «нет
        /// дисциплин», «нет расписания») и не пропавшим блоком «Требуют внимания».
        var attendanceFailure: String?
        var riskFailure: String?
        var coursesFailure: String?
        var scheduleFailure: String?

        var students: [DeanGroupMember] {
            members.filter { $0.roleValue == .student || $0.roleValue == .starosta }
        }

        var starosta: DeanGroupMember? {
            members.first { $0.id == group.starostaId }
        }
    }

    private struct StarostaChange: Identifiable {
        let studentID: String?
        let title: String
        let message: String
        let actionTitle: String
        var id: String { studentID ?? "none" }
    }

    private enum Anchor: Hashable { case attendance, schedule }

    @MainActor
    private func load() async throws -> Snapshot {
        async let group = api.group(id: groupID)
        async let members = api.groupMembers(id: groupID)
        // Сводки — дополнение к карточке: их сбой не должен прятать состав, но и не
        // выдаёт себя за пустоту — у каждой секции свой «Повторить».
        async let attendance = DeanPart<DeanGroupAttendance>.load { try await api.groupAttendance(groupID: groupID) }
        async let risk = DeanPart<DeanAtRisk>.load { try await api.atRisk() }
        async let courses = DeanPart<Page<DeanCourse>>.load {
            try await api.courses(PageRequest(cursor: nil, page: 1, limit: 100), sort: "subject", ascending: true, groupID: groupID)
        }
        async let schedule = DeanPart<[DeanPair]>.load { try await api.schedule(groupID: groupID).pairs }
        let (attendancePart, riskPart, coursesPart, schedulePart) = await (attendance, risk, courses, schedule)
        // Экран ушёл посреди загрузки — снимок с пустыми частями не должен лечь поверх
        // показанного как «сбой».
        try Task.checkCancellation()
        return Snapshot(
            group: try await group,
            members: try await members,
            attendance: attendancePart.value,
            risk: riskPart.value?.students.filter { $0.groupId == groupID } ?? [],
            courses: coursesPart.value?.items ?? [],
            pairs: schedulePart.value ?? [],
            attendanceFailure: attendancePart.failure,
            riskFailure: riskPart.failure,
            coursesFailure: coursesPart.failure,
            scheduleFailure: schedulePart.failure
        )
    }

    @ViewBuilder
    private func content(_ data: Snapshot) -> some View {
        ScrollViewReader { proxy in
            List {
                header(data, proxy: proxy)
                starostaSection(data)
                membersSection(data)
                if !data.risk.isEmpty || data.riskFailure != nil {
                    riskSection(data)
                }
                attendanceSection(data)
                    .id(Anchor.attendance)
                coursesSection(data)
                scheduleSection(data)
                    .id(Anchor.schedule)
            }
            .listStyle(.insetGrouped)
            .listSectionSpacing(.compact)
            .pullToRefresh { reload += 1 }
        }
    }

    // MARK: Шапка

    private func header(_ data: Snapshot, proxy: ScrollViewProxy) -> some View {
        HeroHeader(
            visual: .avatar(url: nil, name: data.group.name),
            title: data.group.name,
            subtitle: headerSubtitle(data),
            actions: [
                HeroAction(
                    title: String(localized: "dean.group.scheduleShort", defaultValue: "Расписание"),
                    symbol: "calendar"
                ) {
                    DeanNav.push(.dean(.groupSchedule(id: groupID)))
                },
                HeroAction(
                    title: String(localized: "dean.group.attendanceShort", defaultValue: "Посещаемость"),
                    symbol: "chart.bar"
                ) {
                    withMotion { proxy.scrollTo(Anchor.attendance, anchor: .top) }
                },
            ],
            badges: { headerBadges(data) },
            moreMenu: { starostaMenu(data) }
        )
    }

    private func headerSubtitle(_ data: Snapshot) -> String {
        let count = data.students.count.formatted()
        let students = String(localized: "dean.group.studentsCount", defaultValue: "Студентов: \(count)")
        guard let year = data.group.year else { return students }
        let yearText = String(year)
        return String(localized: "dean.group.yearShort", defaultValue: "Набор \(yearText)") + " · " + students
    }

    @ViewBuilder
    private func headerBadges(_ data: Snapshot) -> some View {
        if data.group.starostaId == nil || !data.risk.isEmpty {
            HStack(spacing: Spacing.sm) {
                if data.group.starostaId == nil {
                    StatusBadge(text: String(localized: "dean.groups.noStarosta", defaultValue: "Без старосты"), tint: Palette.warning)
                }
                if !data.risk.isEmpty {
                    StatusBadge(text: riskBadge(data.risk.count), tint: Palette.destructive)
                }
            }
        }
    }

    private func riskBadge(_ count: Int) -> String {
        let value = count.formatted()
        return String(localized: "dean.group.riskCount", defaultValue: "Требуют внимания: \(value)")
    }

    /// Староста — в «Ещё»: меняют его редко, а список студентов длинный.
    @HeroMenuBuilder
    private func starostaMenu(_ data: Snapshot) -> [HeroMenuElement] {
        if !data.students.isEmpty {
            HeroSubmenu(
                data.group.starostaId == nil
                    ? String(localized: "dean.starosta.assign", defaultValue: "Назначить старосту")
                    : String(localized: "dean.starosta.change", defaultValue: "Сменить старосту"),
                symbol: "star"
            ) {
                for member in data.students {
                    HeroMenuItem(member.name, isChecked: member.id == data.group.starostaId) {
                        requestStarosta(member.id, data: data)
                    }
                }
            }
        }
        if data.group.starostaId != nil {
            HeroMenuItem(String(localized: "dean.starosta.clear", defaultValue: "Снять старосту"), symbol: "person.badge.minus", isDestructive: true) {
                requestStarosta(nil, data: data)
            }
        }
        HeroMenuItem(String(localized: "dean.refresh", defaultValue: "Обновить"), symbol: "arrow.clockwise") {
            reload += 1
        }
    }

    // MARK: Секции

    private func starostaSection(_ data: Snapshot) -> some View {
        Section {
            if let starosta = data.starosta {
                NavigationLink(value: AppRoute.dean(.student(id: starosta.id))) {
                    PersonRow(name: starosta.name, subtitle: Role.starosta.title, avatarURL: starosta.avatarUrl)
                }
            } else {
                IconRow(
                    title: String(localized: "dean.group.noStarosta", defaultValue: "Староста не назначен"),
                    symbol: "star",
                    tint: TileTint.gray
                )
            }
            if !data.students.isEmpty {
                let title = data.group.starostaId == nil
                    ? String(localized: "dean.starosta.assign", defaultValue: "Назначить старосту")
                    : String(localized: "dean.starosta.change", defaultValue: "Сменить старосту")
                // Меню UIKit, как «Ещё» в шапке: то же меню старосты из одного места.
                Group {
                    if isSaving {
                        ProgressView()
                    } else {
                        Label(title, systemImage: "star")
                            .foregroundStyle(Palette.primary)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: ControlHeight.xl, alignment: .leading)
                .accessibilityHidden(true)
                .overlay {
                    if !isSaving {
                        MenuOverlay(menu: starostaMenu(data).uiMenu, accessibilityLabel: title)
                    }
                }
            }
        } header: {
            Text(Role.starosta.title)
        } footer: {
            Text(String(localized: "dean.starosta.hint", defaultValue: "Выбранный студент получает права старосты, прежний возвращается в студенты."))
        }
    }

    private func membersSection(_ data: Snapshot) -> some View {
        Section {
            if data.members.isEmpty {
                EmptyStateView(
                    title: String(localized: "dean.group.noMembers", defaultValue: "В группе никого нет"),
                    symbol: "person.2"
                )
                .listRowBackground(Color.clear)
            }
            ForEach(data.members) { member in
                NavigationLink(value: memberRoute(member)) {
                    DeanMemberRow(member: member, isStarosta: member.id == data.group.starostaId)
                }
                .swipeActions(edge: .leading) {
                    Button {
                        Task { await openChat(member.id) }
                    } label: {
                        Label(String(localized: "dean.contact.message", defaultValue: "Написать"), systemImage: "bubble.left.fill")
                    }
                    .tint(Palette.primary)
                }
                .contextMenu {
                    Button {
                        Task { await openChat(member.id) }
                    } label: {
                        Label(String(localized: "dean.contact.message", defaultValue: "Написать"), systemImage: "bubble.left")
                    }
                    NavigationLink(value: AppRoute.profile(id: member.id)) {
                        Label(String(localized: "dean.contact.profile", defaultValue: "Открыть профиль"), systemImage: "person.crop.circle")
                    }
                }
            }
        } header: {
            Text(String(localized: "dean.group.members", defaultValue: "Состав"))
        }
    }

    private func riskSection(_ data: Snapshot) -> some View {
        Section {
            if let failure = data.riskFailure {
                DashboardFailurePlaceholder(message: failure) { reload += 1 }
            }
            ForEach(data.risk) { student in
                NavigationLink(value: AppRoute.dean(.student(id: student.studentId))) {
                    DeanRiskMemberRow(student: student)
                }
            }
        } header: {
            Text(String(localized: "dean.chart.risk", defaultValue: "Требуют внимания"))
        }
    }

    private func attendanceSection(_ data: Snapshot) -> some View {
        Section {
            if let attendance = data.attendance, !attendance.students.isEmpty {
                ForEach(attendance.students) { student in
                    NavigationLink(value: AppRoute.dean(.student(id: student.studentId))) {
                        DeanRateRow(
                            title: student.name,
                            subtitle: trackedLine(student.tracked),
                            rate: student.attendanceRate,
                            badge: (student.attendanceRate ?? 100) < 60 ? String(localized: "dean.risk.badge", defaultValue: "Риск") : nil
                        )
                    }
                }
            } else if let failure = data.attendanceFailure {
                DashboardFailurePlaceholder(message: failure) { reload += 1 }
            } else {
                IconRow(
                    title: String(localized: "dean.chart.noAttendance", defaultValue: "Посещаемость ещё не отмечали"),
                    symbol: "chart.bar",
                    tint: TileTint.gray
                )
            }
        } header: {
            Text(String(localized: "dean.attendance.byStudent", defaultValue: "Посещаемость по студентам"))
        }
    }

    private func trackedLine(_ tracked: Int) -> String {
        let value = tracked.formatted()
        return String(localized: "dean.attendance.tracked", defaultValue: "Отмечено занятий: \(value)")
    }

    private func coursesSection(_ data: Snapshot) -> some View {
        Section {
            if let failure = data.coursesFailure {
                DashboardFailurePlaceholder(message: failure) { reload += 1 }
            } else if data.courses.isEmpty {
                IconRow(
                    title: String(localized: "dean.courses.emptyGroup", defaultValue: "Группе ещё не назначены дисциплины"),
                    symbol: "book",
                    tint: TileTint.gray
                )
            }
            ForEach(data.courses) { course in
                DeanGroupCourseRow(course: course)
            }
        } header: {
            Text(String(localized: "dean.group.courses", defaultValue: "Дисциплины"))
        }
    }

    private func scheduleSection(_ data: Snapshot) -> some View {
        Section {
            if let failure = data.scheduleFailure {
                DashboardFailurePlaceholder(message: failure) { reload += 1 }
            } else if data.pairs.isEmpty {
                IconRow(
                    title: String(localized: "dean.group.noSchedule", defaultValue: "Действующего расписания нет"),
                    symbol: "calendar",
                    tint: TileTint.gray
                )
            }
            ForEach(1...7, id: \.self) { day in
                let pairs = data.pairs.filter { $0.dayOfWeek == day }.sorted { $0.startTime < $1.startTime }
                if !pairs.isEmpty {
                    DeanGroupDayRow(day: day, pairs: pairs)
                }
            }
            NavigationLink(value: AppRoute.dean(.groupSchedule(id: groupID))) {
                Label(String(localized: "dean.group.editSchedule", defaultValue: "Редактировать расписание"), systemImage: "calendar.badge.plus")
            }
        } header: {
            Text(String(localized: "dean.group.schedule", defaultValue: "Расписание группы"))
        }
    }

    private func memberRoute(_ member: DeanGroupMember) -> AppRoute {
        member.roleValue == .student || member.roleValue == .starosta
            ? .dean(.student(id: member.id))
            : .profile(id: member.id)
    }

    @MainActor
    private func openChat(_ userID: String) async {
        do {
            try await DeanNav.openChat(userID: userID)
        } catch {
            actionFailure = error.userMessage
        }
    }

    private func requestStarosta(_ studentID: String?, data: Snapshot) {
        guard studentID != data.group.starostaId else { return }
        let name = { (id: String?) in data.members.first { $0.id == id }?.name ?? "" }
        if let studentID {
            let message = data.group.starostaId == nil
                ? String(localized: "dean.starosta.assignConfirm", defaultValue: "\(name(studentID)) получит права старосты группы.")
                : String(localized: "dean.starosta.replaceConfirm", defaultValue: "\(name(studentID)) станет старостой, \(name(data.group.starostaId)) вернётся в студенты и выйдет из всех сессий.")
            pendingStarosta = StarostaChange(
                studentID: studentID,
                title: String(localized: "dean.starosta.assignTitle", defaultValue: "Назначить старостой?"),
                message: message,
                actionTitle: String(localized: "dean.starosta.assignAction", defaultValue: "Назначить")
            )
        } else {
            pendingStarosta = StarostaChange(
                studentID: nil,
                title: String(localized: "dean.starosta.clearTitle", defaultValue: "Снять старосту?"),
                message: String(localized: "dean.starosta.clearConfirm", defaultValue: "\(name(data.group.starostaId)) вернётся в студенты и выйдет из всех сессий."),
                actionTitle: String(localized: "dean.starosta.clear", defaultValue: "Снять старосту")
            )
        }
    }

    @MainActor
    private func apply(_ change: StarostaChange) async {
        isSaving = true
        defer { isSaving = false }
        do {
            try await api.assignStarosta(groupID: groupID, studentID: change.studentID)
            reload += 1
        } catch {
            actionFailure = error.userMessage
        }
    }
}

/// Участник группы: аватар, ФИО, роль; у старосты — звезда.
private struct DeanMemberRow: View {
    let member: DeanGroupMember
    let isStarosta: Bool

    var body: some View {
        HStack(spacing: Spacing.lg) {
            AvatarView(url: member.avatarUrl, name: member.name, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(member.name)
                    .font(Typography.body)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(2)
                Text(member.roleValue.title)
                    .font(Typography.meta)
                    .foregroundStyle(isStarosta ? Palette.warning : Palette.mutedForeground)
            }
            Spacer(minLength: Spacing.md)
            if isStarosta {
                Image(systemName: "star.fill")
                    .foregroundStyle(Palette.warning)
                    .accessibilityHidden(true)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// Студент из «требуют внимания»: аватар и причины строкой ниже.
private struct DeanRiskMemberRow: View {
    let student: DeanAtRisk.Student

    var body: some View {
        TelegramStyleRow(title: student.name, subtitle: reasons) {
            AvatarView(url: nil, name: student.name, size: 40)
        } accessory: {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Palette.destructive)
                .accessibilityHidden(true)
        }
    }

    private var reasons: String {
        student.reasons.map { DeanRiskText.line($0) }.joined(separator: "\n")
    }
}

/// Дисциплина группы: предмет, ведущий, семестр и кредиты.
private struct DeanGroupCourseRow: View {
    let course: DeanCourse

    var body: some View {
        TelegramStyleRow(title: course.subject.name, subtitle: subtitle, meta: course.term?.name) {
            RowSymbol(symbol: "book.fill", tint: TileTint.indigo, size: 36)
        }
    }

    private var subtitle: String {
        course.teacher?.name ?? String(localized: "dean.courses.noTeacher", defaultValue: "Преподаватель не назначен")
    }
}

/// День недели группы: короткое имя дня слева, пары строками справа.
private struct DeanGroupDayRow: View {
    let day: Int
    let pairs: [DeanPair]

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.lg) {
            Text(DeanText.dayShort(day))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Palette.primary)
                .frame(width: 32, alignment: .leading)
            VStack(alignment: .leading, spacing: Spacing.sm) {
                ForEach(pairs) { pair in
                    DeanGroupPairLine(pair: pair)
                }
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(DeanText.day(day)))
    }
}

private struct DeanGroupPairLine: View {
    let pair: DeanPair

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
            Text(verbatim: pair.startTime)
                .font(Typography.meta.monospacedDigit().weight(.semibold))
                .foregroundStyle(Palette.foreground)
            VStack(alignment: .leading, spacing: 1) {
                Text(pair.subject)
                    .font(Typography.body)
                    .foregroundStyle(Palette.foreground)
                if let meta {
                    Text(meta)
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
            }
        }
    }

    private var meta: String? {
        var parts: [String] = []
        if let room = pair.room?.name { parts.append(room) }
        if pair.weekType != "BOTH" { parts.append(DeanText.weekType(pair.weekType)) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

/// Причина риска строкой: «Низкая посещаемость: 42 %».
enum DeanRiskText {
    static func line(_ reason: DeanAtRisk.Reason) -> String {
        let value = reason.kind == "OVERDUE_ASSIGNMENTS"
            ? Int(reason.value).formatted()
            : DeanText.percent(reason.value)
        return "\(DeanText.riskReason(reason.kind)): \(value)"
    }
}
