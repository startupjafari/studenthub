import SwiftUI

// Группы факультета и карточка группы: состав, староста, посещаемость, кто требует
// внимания, дисциплины и расписание группы. Создание и удаление групп — права админа
// вуза; декан назначает старост своего факультета.

/// Список групп факультета с поиском на сервере.
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
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: search.isEmpty
                    ? String(localized: "dean.groups.empty", defaultValue: "Групп пока нет")
                    : String(localized: "dean.picker.empty", defaultValue: "Ничего не найдено"),
                symbol: search.isEmpty ? "person.3" : "magnifyingglass",
                hint: search.isEmpty
                    ? String(localized: "dean.groups.emptyHint", defaultValue: "Группы факультета заводит администратор вуза")
                    : nil
            )
        ) { group in
            NavigationLink(value: AppRoute.dean(.group(id: group.id))) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(group.name).font(Typography.cardTitle).foregroundStyle(Palette.foreground)
                        Text(group.year.map { String($0) } ?? "—")
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    Spacer(minLength: Spacing.md)
                    if group.starostaId != nil {
                        StatusBadge(text: String(localized: "dean.groups.hasStarosta", defaultValue: "Есть староста"), tint: Palette.info)
                    } else {
                        StatusBadge(text: String(localized: "dean.groups.noStarosta", defaultValue: "Без старосты"), tint: Palette.warning)
                    }
                }
            }
        }
        .navigationTitle(Text(DeanScreen.groups.title))
        .debouncedSearch($search, prompt: String(localized: "dean.groups.search", defaultValue: "Название группы")) { needle in
            await loader.replace { request in try await api.groups(request, search: needle) }
        }
    }
}

/// Карточка группы.
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
        .actionFailureAlert($actionFailure)
        .confirmationDialog(
            pendingStarosta?.title ?? "",
            isPresented: Binding(get: { pendingStarosta != nil }, set: { if !$0 { pendingStarosta = nil } }),
            titleVisibility: .visible,
            presenting: pendingStarosta
        ) { change in
            Button(change.actionTitle, role: change.studentID == nil ? .destructive : nil) {
                Task { await apply(change) }
            }
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
    }

    private struct StarostaChange: Identifiable {
        let studentID: String?
        let title: String
        let message: String
        let actionTitle: String
        var id: String { studentID ?? "none" }
    }

    @MainActor
    private func load() async throws -> Snapshot {
        async let group = api.group(id: groupID)
        async let members = api.groupMembers(id: groupID)
        // Сводки — дополнение к карточке: их сбой не должен прятать состав.
        async let attendance = try? api.groupAttendance(groupID: groupID)
        async let risk = try? api.atRisk()
        async let courses = try? api.courses(PageRequest(cursor: nil, page: 1, limit: 100), sort: "subject", ascending: true, groupID: groupID)
        async let schedule = try? api.schedule(groupID: groupID)
        return Snapshot(
            group: try await group,
            members: try await members,
            attendance: await attendance,
            risk: (await risk)?.students.filter { $0.groupId == groupID } ?? [],
            courses: (await courses)?.items ?? [],
            pairs: (await schedule)?.pairs ?? []
        )
    }

    @ViewBuilder
    private func content(_ data: Snapshot) -> some View {
        let students = data.members.filter { $0.roleValue == .student || $0.roleValue == .starosta }
        let starosta = data.members.first { $0.id == data.group.starostaId }
        List {
            Section {
                DetailRow(title: String(localized: "dean.group.name", defaultValue: "Группа"), value: data.group.name)
                DetailRow(title: String(localized: "dean.group.year", defaultValue: "Год набора"), value: data.group.year.map { String($0) } ?? "—")
                DetailRow(title: String(localized: "dean.group.students", defaultValue: "Студентов"), value: students.count.formatted())
            }
            .listRowBackground(Palette.card)

            Section {
                if let starosta {
                    NavigationLink(value: AppRoute.dean(.student(id: starosta.id))) {
                        PersonRow(name: starosta.name, subtitle: Role.starosta.title, avatarURL: starosta.avatarUrl)
                    }
                } else {
                    Text(String(localized: "dean.group.noStarosta", defaultValue: "Староста не назначен"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
                if !students.isEmpty {
                    Menu {
                        ForEach(students) { member in
                            Button {
                                requestStarosta(member.id, data: data)
                            } label: {
                                if member.id == data.group.starostaId {
                                    Label(member.name, systemImage: "checkmark")
                                } else {
                                    Text(member.name)
                                }
                            }
                        }
                        if data.group.starostaId != nil {
                            Divider()
                            Button(role: .destructive) {
                                requestStarosta(nil, data: data)
                            } label: {
                                Label(String(localized: "dean.starosta.clear", defaultValue: "Снять старосту"), systemImage: "person.badge.minus")
                            }
                        }
                    } label: {
                        if isSaving {
                            ProgressView()
                        } else {
                            Label(
                                data.group.starostaId == nil
                                    ? String(localized: "dean.starosta.assign", defaultValue: "Назначить старосту")
                                    : String(localized: "dean.starosta.change", defaultValue: "Сменить старосту"),
                                systemImage: "star"
                            )
                        }
                    }
                    .disabled(isSaving)
                }
            } header: {
                Text(Role.starosta.title)
            } footer: {
                Text(String(localized: "dean.starosta.hint", defaultValue: "Выбранный студент получает права старосты, прежний возвращается в студенты."))
            }
            .listRowBackground(Palette.card)

            Section {
                if data.members.isEmpty {
                    Text(String(localized: "dean.group.noMembers", defaultValue: "В группе никого нет"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
                ForEach(data.members) { member in
                    NavigationLink(value: memberRoute(member)) {
                        PersonRow(name: member.name, subtitle: member.roleValue.title, avatarURL: member.avatarUrl)
                    }
                }
            } header: {
                Text(String(localized: "dean.group.members", defaultValue: "Состав"))
            }
            .listRowBackground(Palette.card)

            if !data.risk.isEmpty {
                Section {
                    ForEach(data.risk) { student in
                        NavigationLink(value: AppRoute.dean(.student(id: student.studentId))) {
                            ListCardRow(
                                title: student.name,
                                lines: student.reasons.map { DeanRiskText.line($0) }
                            )
                        }
                    }
                } header: {
                    Text(String(localized: "dean.chart.risk", defaultValue: "Требуют внимания"))
                }
                .listRowBackground(Palette.card)
            }

            Section {
                if let attendance = data.attendance, !attendance.students.isEmpty {
                    ForEach(attendance.students) { student in
                        NavigationLink(value: AppRoute.dean(.student(id: student.studentId))) {
                            DeanRateRow(
                                title: student.name,
                                subtitle: String(localized: "dean.attendance.tracked", defaultValue: "Отмечено занятий: \(student.tracked.formatted())"),
                                rate: student.attendanceRate,
                                badge: (student.attendanceRate ?? 100) < 60 ? String(localized: "dean.risk.badge", defaultValue: "Риск") : nil
                            )
                        }
                    }
                } else {
                    Text(String(localized: "dean.chart.noAttendance", defaultValue: "Посещаемость ещё не отмечали"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
            } header: {
                Text(String(localized: "dean.attendance.byStudent", defaultValue: "Посещаемость по студентам"))
            }
            .listRowBackground(Palette.card)

            Section {
                if data.courses.isEmpty {
                    Text(String(localized: "dean.courses.emptyGroup", defaultValue: "Группе ещё не назначены дисциплины"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
                ForEach(data.courses) { course in
                    ListCardRow(
                        title: course.subject.name,
                        subtitle: course.teacher?.name ?? String(localized: "dean.courses.noTeacher", defaultValue: "Преподаватель не назначен"),
                        lines: [course.term?.name ?? ""]
                    )
                }
            } header: {
                Text(String(localized: "dean.group.courses", defaultValue: "Дисциплины"))
            }
            .listRowBackground(Palette.card)

            Section {
                if data.pairs.isEmpty {
                    Text(String(localized: "dean.group.noSchedule", defaultValue: "Действующего расписания нет"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
                ForEach(1...7, id: \.self) { day in
                    let pairs = data.pairs.filter { $0.dayOfWeek == day }.sorted { $0.startTime < $1.startTime }
                    if !pairs.isEmpty {
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            Text(DeanText.day(day)).font(Typography.cardTitle)
                            ForEach(pairs) { pair in
                                Text(verbatim: "\(pair.startTime)–\(pair.endTime) · \(pair.subject)" + (pair.weekType == "BOTH" ? "" : " · \(DeanText.weekType(pair.weekType))"))
                                    .font(Typography.meta)
                                    .foregroundStyle(Palette.mutedForeground)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
                NavigationLink(value: AppRoute.dean(.groupSchedule(id: groupID))) {
                    Label(String(localized: "dean.group.editSchedule", defaultValue: "Редактировать расписание"), systemImage: "calendar.badge.plus")
                }
            } header: {
                Text(String(localized: "dean.group.schedule", defaultValue: "Расписание группы"))
            }
            .listRowBackground(Palette.card)
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .refreshable { reload += 1 }
    }

    private func memberRoute(_ member: DeanGroupMember) -> AppRoute {
        member.roleValue == .student || member.roleValue == .starosta
            ? .dean(.student(id: member.id))
            : .profile(id: member.id)
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

/// Причина риска строкой: «Низкая посещаемость: 42 %».
enum DeanRiskText {
    static func line(_ reason: DeanAtRisk.Reason) -> String {
        let value = reason.kind == "OVERDUE_ASSIGNMENTS"
            ? Int(reason.value).formatted()
            : DeanText.percent(reason.value)
        return "\(DeanText.riskReason(reason.kind)): \(value)"
    }
}
