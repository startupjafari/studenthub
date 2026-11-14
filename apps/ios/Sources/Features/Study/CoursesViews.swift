import SwiftUI

/// Дисциплины: студенту — курсы его группы, преподавателю — свои (`mine`). Поиск по
/// названию, разбивка по семестрам, текущий — первым.
struct CoursesView: View {
    let role: Role

    @State private var remote = RemoteValue<[CourseDTO]>()
    @State private var query = ""

    private var isTeacher: Bool { role == .teacher }
    private var courses: [CourseDTO]? { remote.value }
    private var failure: String? { remote.failure }
    private var isOffline: Bool { remote.isOffline }

    var body: some View {
        List {
            if let courses {
                if !Self.grouped(filtered(courses)).isEmpty, let failure {
                    StaleDataBanner(message: failure, isOffline: isOffline) { await load() }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                ForEach(Self.grouped(filtered(courses)), id: \.title) { term in
                    Section {
                        ForEach(term.courses) { course in
                            NavigationLink {
                                CourseDetailView(course: course, role: role)
                            } label: {
                                CourseRow(course: course, showsGroup: isTeacher)
                            }
                        }
                    } header: {
                        Text(term.title)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .screenState(courses.map { Self.grouped(filtered($0)).isEmpty } ?? true) {
            if courses != nil {
                EmptyStateView(
                    title: query.isEmpty
                        ? String(localized: "courses.empty", defaultValue: "Дисциплин пока нет")
                        : String(localized: "services.notFound", defaultValue: "Ничего не нашлось"),
                    symbol: "book.closed"
                )
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else if remote.checkedCache {
                LoadingStateView()
            }
        }
        .navigationTitle(Text(MoreSection.subjects.title))
        .listSearch(
            text: $query,
            prompt: Text(String(localized: "courses.search", defaultValue: "Найти дисциплину"))
        )
        .pullToRefresh { await load() }
        // Возврат приложения из фона после долгой паузы — повод перечитать (`AppLifecycle`).
        .task(id: AppLifecycle.shared.foregroundEpoch) { await load() }
    }

    private func filtered(_ courses: [CourseDTO]) -> [CourseDTO] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return courses }
        return courses.filter {
            $0.subject.name.lowercased().contains(needle)
                || ($0.subject.code?.lowercased().contains(needle) ?? false)
                || ($0.teacher?.name.lowercased().contains(needle) ?? false)
                || ($0.group?.name.lowercased().contains(needle) ?? false)
        }
    }

    /// Семестры: активный первым, затем по номеру по убыванию — свежее выше.
    static func grouped(_ courses: [CourseDTO]) -> [(title: String, courses: [CourseDTO])] {
        let byTerm = Dictionary(grouping: courses) { $0.term?.id ?? "" }
        return byTerm.values
            .sorted { lhs, rhs in
                let a = lhs.first?.term, b = rhs.first?.term
                if (a?.isActive ?? false) != (b?.isActive ?? false) { return a?.isActive ?? false }
                return (a?.number ?? 0) > (b?.number ?? 0)
            }
            .map { list in
                let term = list.first?.term
                let title = term?.name ?? String(localized: "courses.noTerm", defaultValue: "Без семестра")
                let sorted = list.sorted { $0.subject.name.localizedCompare($1.subject.name) == .orderedAscending }
                return (term?.isActive == true ? String(localized: "courses.currentTerm", defaultValue: "Текущий семестр · \(title)") : title, sorted)
            }
    }

    private func load() async {
        let mine = isTeacher
        await remote.load { try await CoursesAPI().courses(mine: mine) }
    }
}

/// Дисциплина строкой как чат: значок её цвета (тот же, что в расписании), название,
/// кредиты справа, ниже — кто ведёт (или группа у преподавателя) и код.
private struct CourseRow: View {
    let course: CourseDTO
    let showsGroup: Bool

    var body: some View {
        TelegramStyleRow(
            title: course.subject.name,
            subtitle: StudyText.join([showsGroup ? course.group?.name : course.teacher?.name, course.subject.code]),
            meta: course.credits.map(CoursesText.credits)
        ) {
            RowSymbol(symbol: "book.closed.fill", tint: ScheduleSubjectTint.color(for: course.subject.name))
        }
    }
}

/// Дисциплина: кто ведёт, группа, кредиты — и её задания и материалы.
///
/// У задания и материала дисциплина — название, а не id (так их отдаёт сервер),
/// поэтому связываем по названию предмета.
struct CourseDetailView: View {
    let course: CourseDTO
    let role: Role

    /// Задания и материалы — независимо (`RemoteValue`): сбой одного не прячет другой.
    @State private var assignmentsRemote = RemoteValue<[AssignmentDTO]>()
    @State private var materialsRemote = RemoteValue<[MaterialDTO]>()
    @State private var showsGroup = false

    private var isTeacher: Bool { role == .teacher }
    private var assignments: [AssignmentDTO]? { assignmentsRemote.value }
    private var materials: [MaterialDTO]? { materialsRemote.value }
    /// Задания или материалы не пришли и показать нечего — сбой блока, а не «нет».
    private var assignmentsFailed: Bool { assignments == nil && assignmentsRemote.failure != nil }
    private var materialsFailed: Bool { materials == nil && materialsRemote.failure != nil }

    /// Обновление показанного блока не удалось — полосой над экраном.
    private var staleFailure: (message: String, isOffline: Bool)? {
        if assignments != nil, let failure = assignmentsRemote.failure {
            return (failure, assignmentsRemote.isOffline)
        }
        if materials != nil, let failure = materialsRemote.failure {
            return (failure, materialsRemote.isOffline)
        }
        return nil
    }

    var body: some View {
        List {
            if let staleFailure {
                StaleDataBanner(message: staleFailure.message, isOffline: staleFailure.isOffline) { await loadRelated() }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }
            Section {
                HeroHeader(
                    visual: HeroVisual.symbol("book.closed.fill", tint: ScheduleSubjectTint.color(for: course.subject.name)),
                    title: course.subject.name,
                    subtitle: course.teacher?.name,
                    actions: heroActions
                ) {
                    HStack(spacing: Spacing.sm) {
                        if let code = course.subject.code, !code.isEmpty {
                            StatusBadge(text: code, tint: Palette.mutedForeground)
                        }
                        if let credits = course.credits {
                            StatusBadge(text: CoursesText.credits(credits), tint: Palette.primary)
                        }
                        if course.term?.isActive == true {
                            StatusBadge(text: String(localized: "courses.current", defaultValue: "Текущий семестр"), tint: Palette.success)
                        }
                    }
                }
            }

            Section {
                if let teacher = course.teacher {
                    NavigationLink(value: AppRoute.profile(id: teacher.id)) {
                        PersonRow(
                            name: teacher.name,
                            subtitle: String(localized: "role.teacher", defaultValue: "Преподаватель"),
                            avatarURL: teacher.avatarUrl
                        )
                    }
                }
                if let group = course.group {
                    NavigationLink {
                        GroupMembersView(groupID: group.id, title: group.name)
                    } label: {
                        DetailRow(title: String(localized: "profile.group", defaultValue: "Группа"), value: group.name, symbol: "person.3")
                    }
                }
                if let term = course.term?.name {
                    DetailRow(title: String(localized: "courses.term", defaultValue: "Семестр"), value: term, symbol: "calendar")
                }
                if let credits = course.credits {
                    DetailRow(title: String(localized: "courses.creditsTitle", defaultValue: "Кредиты"), value: String(credits), symbol: "rosette")
                }
            }

            Section {
                if assignmentsFailed {
                    DashboardFailurePlaceholder { await loadRelated() }
                } else if let assignments {
                    if assignments.isEmpty {
                        DashboardEmptyRow(
                            text: String(localized: "courses.noAssignments", defaultValue: "Заданий нет"),
                            symbol: "list.clipboard"
                        )
                    }
                    ForEach(assignments) { assignment in
                        NavigationLink(value: AppRoute.assignment(id: assignment.id)) {
                            TelegramStyleRow(
                                title: assignment.title,
                                subtitle: StudyText.due(assignment.dueAt),
                                meta: assignment.dueAt.map { DisplayFormat.relative($0) },
                                metaTint: StudyDue.tint(assignment.dueAt)
                            ) {
                                RowSymbol(symbol: AssignmentDetailView.typeSymbol(assignment.type), tint: TileTint.orange, size: 40)
                            }
                        }
                    }
                } else {
                    ProgressView().frame(maxWidth: .infinity)
                }
            } header: {
                Text(String(localized: "study.assignments", defaultValue: "Задания"))
            }

            Section {
                if materialsFailed {
                    DashboardFailurePlaceholder { await loadRelated() }
                } else if let materials {
                    if materials.isEmpty {
                        DashboardEmptyRow(
                            text: String(localized: "courses.noMaterials", defaultValue: "Материалов нет"),
                            symbol: "doc"
                        )
                    }
                    ForEach(materials) { material in
                        TelegramStyleRow(
                            title: material.title,
                            subtitle: Self.filesText(material.files?.count ?? 0),
                            meta: material.createdAt.map { DisplayFormat.date($0) }
                        ) {
                            RowSymbol(symbol: "doc.fill", tint: TileTint.blue, size: 40)
                        }
                    }
                    if !materials.isEmpty {
                        NavigationLink(value: AppRoute.section(.materials)) {
                            Text(String(localized: "courses.allMaterials", defaultValue: "Все материалы и файлы"))
                                .foregroundStyle(Palette.primary)
                        }
                    }
                } else {
                    ProgressView().frame(maxWidth: .infinity)
                }
            } header: {
                Text(String(localized: "study.materials", defaultValue: "Материалы"))
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(course.subject.name))
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(isPresented: $showsGroup) {
            if let group = course.group {
                GroupMembersView(groupID: group.id, title: group.name)
            }
        }
        // Возврат приложения из фона после долгой паузы — повод перечитать (`AppLifecycle`).
        .task(id: AppLifecycle.shared.foregroundEpoch) { await loadRelated() }
    }

    /// Задания и материалы дисциплины. Каждый блок падает отдельно: сбой одного не
    /// прячет другой.
    private func loadRelated() async {
        let name = course.subject.name.lowercased()
        async let tasks: Void = assignmentsRemote.load {
            try await StudyAPI().assignments().items.filter { $0.subject?.lowercased() == name }
        }
        async let files: Void = materialsRemote.load {
            try await StudyAPI().materials().items.filter { $0.subject?.lowercased() == name }
        }
        _ = await (tasks, files)
    }

    private static func filesText(_ count: Int) -> String? {
        guard count > 0 else { return nil }
        return String(localized: "courses.files", defaultValue: "Файлов: \(count)")
    }

    private var heroActions: [HeroAction] {
        var actions: [HeroAction] = []
        if let teacher = course.teacher {
            actions.append(HeroAction(title: String(localized: "role.teacher", defaultValue: "Преподаватель"), symbol: "person.fill") {
                coursesPush(.profile(id: teacher.id))
            })
        }
        if course.group != nil {
            actions.append(HeroAction(title: String(localized: "profile.group", defaultValue: "Группа"), symbol: "person.3.fill") {
                showsGroup = true
            })
        }
        actions.append(HeroAction(title: String(localized: "study.materials", defaultValue: "Материалы"), symbol: "folder.fill") {
            coursesPush(.section(.materials))
        })
        return actions
    }
}

/// Открыть маршрут в стеке текущей вкладки — для круглых кнопок шапки.
@MainActor
private func coursesPush(_ route: AppRoute) {
    let router = AppServices.router
    router.push(route)
}

/// Участники группы: одногруппники старосты, группа преподавателя.
struct GroupMembersView: View {
    let groupID: String?
    let title: String

    @State private var remote = RemoteValue<[GroupMemberDTO]>()
    @State private var query = ""

    private var members: [GroupMemberDTO]? { remote.value }
    private var failure: String? { remote.failure }
    private var isOffline: Bool { remote.isOffline }

    var body: some View {
        List {
            if groupID != nil, let members {
                let visible = filtered(members)
                if !visible.isEmpty {
                    if let failure {
                        StaleDataBanner(message: failure, isOffline: isOffline) { await load() }
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets())
                    }
                    Section {
                        ForEach(visible) { member in
                            NavigationLink(value: AppRoute.profile(id: member.id)) {
                                HStack(spacing: Spacing.md) {
                                    PersonRow(name: member.name, avatarURL: member.avatarUrl, size: 40)
                                    if member.role == Role.starosta.rawValue {
                                        StatusBadge(text: String(localized: "role.starosta", defaultValue: "Староста"), tint: Palette.primary)
                                    }
                                }
                            }
                        }
                    } footer: {
                        Text(String(localized: "group.count", defaultValue: "Всего: \(members.count)"))
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .screenState(groupID == nil || members.map { filtered($0).isEmpty } ?? true) {
            if groupID == nil {
                EmptyStateView(
                    title: String(localized: "group.none", defaultValue: "Вы не состоите в группе"),
                    symbol: "person.3"
                )
            } else if members != nil {
                EmptyStateView(
                    title: query.isEmpty
                        ? String(localized: "uadmin.group.noMembers", defaultValue: "В группе пока нет участников")
                        : String(localized: "services.notFound", defaultValue: "Ничего не нашлось"),
                    symbol: query.isEmpty ? "person.3" : "magnifyingglass"
                )
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else if remote.checkedCache {
                LoadingStateView()
            }
        }
        .navigationTitle(Text(title))
        .listSearch(
            text: $query,
            prompt: Text(String(localized: "group.search", defaultValue: "Найти по имени"))
        )
        .pullToRefresh { await load() }
        // Возврат приложения из фона после долгой паузы — повод перечитать (`AppLifecycle`).
        .task(id: AppLifecycle.shared.foregroundEpoch) { await load() }
    }

    private func filtered(_ members: [GroupMemberDTO]) -> [GroupMemberDTO] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        return needle.isEmpty ? members : members.filter { $0.name.lowercased().contains(needle) }
    }

    private func load() async {
        guard let groupID else { return }
        await remote.load { try await CoursesAPI().members(groupID: groupID) }
    }
}

/// Группы преподавателя — те, у которых он ведёт дисциплины.
struct TeacherGroupsView: View {
    /// Группа из `GET /groups`: страница с поиском на сервере, как в вебе
    /// (`widgets/groups-list`), а не группы, собранные из своих дисциплин.
    struct Group: Decodable, Identifiable {
        let id: String
        let name: String
        var starostaId: String? = nil
        var year: Int? = nil
        var faculty: Faculty? = nil

        struct Faculty: Decodable {
            let name: String?
        }
    }

    @State private var loader = PagedLoader<Group>(limit: 30) { request in
        try await AppServices.api.page(.get("groups", query: request.pageQuery), of: Group.self)
    }
    @State private var search = ""

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(title: String(localized: "groups.empty", defaultValue: "Групп пока нет"), symbol: "person.2")
        ) { group in
            NavigationLink {
                GroupMembersView(groupID: group.id, title: group.name)
            } label: {
                TelegramStyleRow(
                    title: group.name,
                    subtitle: group.faculty?.name,
                    meta: group.year.map { String($0) }
                ) {
                    RowSymbol(symbol: "person.3.fill", tint: TileTint.teal)
                } accessory: {
                    if group.starostaId != nil {
                        StatusBadge(
                            text: String(localized: "groups.hasStarosta", defaultValue: "Есть староста"),
                            tint: Palette.info
                        )
                    }
                }
            }
        }
        .navigationTitle(Text(MoreSection.groups.title))
        .debouncedSearch($search, prompt: String(localized: "groups.search", defaultValue: "Поиск группы")) { needle in
            // Предел `search` в GroupListQuerySchema — 100 символов: длиннее сервер отвечает 400.
            let query = String(needle.prefix(100))
            await loader.replace { request in
                var items = request.pageQuery
                if !query.isEmpty { items.append(URLQueryItem(name: "search", value: query)) }
                return try await AppServices.api.page(.get("groups", query: items), of: Group.self)
            }
        }
    }
}

/// Подписи дисциплин, общие для списков и карточек.
enum CoursesText {
    /// «5 кр.» — кредиты дисциплины.
    static func credits(_ value: Int) -> String {
        String(localized: "courses.credits", defaultValue: "\(value) кр.")
    }
}
