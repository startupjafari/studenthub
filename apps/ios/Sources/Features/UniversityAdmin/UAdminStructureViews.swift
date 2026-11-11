import SwiftUI

// Оргструктура вуза: факультеты, специальности, группы и карточка группы со старостой.
// Как в вебе (`views/university-admin`): создать, переименовать, удалить; у групп ещё
// год, поиск, состав и назначение старосты.

// MARK: - Факультеты и специальности

struct UAdminFacultiesView: View {
    var body: some View {
        NameCatalogView(
            kind: NameCatalogKind(
                title: UniAdminScreen.faculties.title,
                symbol: "building.columns",
                addTitle: String(localized: "uadmin.faculty.add", defaultValue: "Добавить факультет"),
                fieldTitle: String(localized: "uadmin.faculty.name", defaultValue: "Название факультета"),
                placeholder: String(localized: "uadmin.faculty.placeholder", defaultValue: "Например, Факультет информационных технологий"),
                renameTitle: String(localized: "uadmin.faculty.rename", defaultValue: "Новое название факультета"),
                emptyTitle: String(localized: "uadmin.faculty.empty", defaultValue: "Факультетов пока нет"),
                emptyHint: String(localized: "uadmin.faculty.emptyHint", defaultValue: "Факультет — верхний уровень структуры: на нём держатся группы, деканы и права доступа."),
                deleteConfirm: { String(localized: "uadmin.faculty.deleteConfirm", defaultValue: "Удалить факультет «\($0)»?") },
                blockedTitle: String(localized: "uadmin.faculty.deleteBlocked", defaultValue: "Факультет нельзя удалить"),
                blockers: [
                    "groups": String(localized: "uadmin.faculty.blocker.groups", defaultValue: "группы"),
                    "users": String(localized: "uadmin.faculty.blocker.users", defaultValue: "пользователи"),
                ],
                load: { try await UAdminAPI().faculties().map { NameItem(id: $0.id, name: $0.name) } },
                create: { try await UAdminAPI().createFaculty(name: $0) },
                rename: { try await UAdminAPI().renameFaculty(id: $0, name: $1) },
                delete: { try await UAdminAPI().deleteFaculty(id: $0) }
            ),
            facultyLinks: true
        )
    }
}

struct UAdminSpecialtiesView: View {
    var body: some View {
        NameCatalogView(
            kind: NameCatalogKind(
                title: UniAdminScreen.specialties.title,
                symbol: "list.bullet.indent",
                addTitle: String(localized: "uadmin.specialty.add", defaultValue: "Добавить специальность"),
                fieldTitle: String(localized: "uadmin.specialty.name", defaultValue: "Название специальности"),
                placeholder: String(localized: "uadmin.specialty.placeholder", defaultValue: "Например, Программная инженерия"),
                renameTitle: String(localized: "uadmin.specialty.rename", defaultValue: "Новое название специальности"),
                emptyTitle: String(localized: "uadmin.specialty.empty", defaultValue: "Специальностей пока нет"),
                emptyHint: String(localized: "uadmin.specialty.emptyHint", defaultValue: "Справочник, из которого студент выбирает специальность в профиле."),
                deleteConfirm: { String(localized: "uadmin.specialty.deleteConfirm", defaultValue: "Удалить специальность «\($0)»?") },
                blockedTitle: String(localized: "uadmin.specialty.deleteBlocked", defaultValue: "Специальность нельзя удалить"),
                blockers: [:],
                load: { try await UAdminAPI().specialties().map { NameItem(id: $0.id, name: $0.name) } },
                create: { try await UAdminAPI().createSpecialty(name: $0) },
                rename: { try await UAdminAPI().renameSpecialty(id: $0, name: $1) },
                delete: { try await UAdminAPI().deleteSpecialty(id: $0) }
            ),
            facultyLinks: false
        )
    }
}

private struct NameItem: Identifiable, Hashable {
    let id: String
    let name: String
}

private struct NameCatalogKind {
    let title: String
    let symbol: String
    let addTitle: String
    let fieldTitle: String
    let placeholder: String
    let renameTitle: String
    let emptyTitle: String
    let emptyHint: String
    let deleteConfirm: (String) -> String
    let blockedTitle: String
    let blockers: [String: String]
    let load: () async throws -> [NameItem]
    let create: (String) async throws -> Void
    let rename: (String, String) async throws -> Void
    let delete: (String) async throws -> Void
}

/// Справочник «только название»: у факультетов и специальностей одинаковые действия.
private struct NameCatalogView: View {
    let kind: NameCatalogKind
    /// Факультет открывает свои группы.
    let facultyLinks: Bool

    @State private var items: [NameItem]?
    @State private var failure: String?
    @State private var isOffline = false
    @State private var actionFailure: String?
    @State private var creating = false
    @State private var renaming: NameItem?
    @State private var deleting: NameItem?
    @State private var query = ""

    private var visible: [NameItem] {
        let needle = query.trimmingCharacters(in: .whitespaces)
        guard let items else { return [] }
        return needle.isEmpty ? items : items.filter { $0.name.localizedCaseInsensitiveContains(needle) }
    }

    var body: some View {
        List {
            if let items {
                if items.isEmpty {
                    EmptyStateView(
                        title: kind.emptyTitle,
                        symbol: kind.symbol,
                        hint: kind.emptyHint,
                        actionTitle: kind.addTitle,
                        action: { creating = true }
                    )
                    .listRowBackground(Color.clear)
                } else if visible.isEmpty {
                    EmptyStateView(
                        title: String(localized: "uadmin.picker.nothing", defaultValue: "Ничего не найдено"),
                        symbol: "magnifyingglass"
                    )
                    .listRowBackground(Color.clear)
                } else {
                    Section {
                        ForEach(visible) { item in
                            row(item)
                                .swipeActions {
                                    Button(role: .destructive) {
                                        deleting = item
                                    } label: {
                                        Label(String(localized: "uadmin.delete", defaultValue: "Удалить"), systemImage: "trash")
                                    }
                                    Button {
                                        renaming = item
                                    } label: {
                                        Label(String(localized: "uadmin.rename", defaultValue: "Переименовать"), systemImage: "pencil")
                                    }
                                    .tint(Palette.primary)
                                }
                                .contextMenu {
                                    Button {
                                        renaming = item
                                    } label: {
                                        Label(String(localized: "uadmin.rename", defaultValue: "Переименовать"), systemImage: "pencil")
                                    }
                                    Button(role: .destructive) {
                                        deleting = item
                                    } label: {
                                        Label(String(localized: "uadmin.delete", defaultValue: "Удалить"), systemImage: "trash")
                                    }
                                }
                        }
                    } footer: {
                        Text(String(localized: "common.totalCount", defaultValue: "Всего: \(items.count.formatted())"))
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
        .navigationTitle(Text(kind.title))
        .uadminSearchable($query, prompt: String(localized: "uadmin.searchByName", defaultValue: "Поиск по названию"))
        .floatingAction(kind.addTitle) { creating = true }
        .sheet(isPresented: $creating) {
            NameFormSheet(title: kind.addTitle, fieldTitle: kind.fieldTitle, placeholder: kind.placeholder, initial: "") { name in
                try await kind.create(name)
            } saved: {
                await load()
            }
        }
        .sheet(item: $renaming) { item in
            NameFormSheet(title: kind.renameTitle, fieldTitle: kind.fieldTitle, placeholder: kind.placeholder, initial: item.name) { name in
                try await kind.rename(item.id, name)
            } saved: {
                await load()
            }
        }
        .confirmDestructive(
            $deleting,
            title: { kind.deleteConfirm($0.name) },
            actionTitle: String(localized: "uadmin.delete", defaultValue: "Удалить")
        ) { item in
            await remove(item)
        }
        .actionFailureAlert($actionFailure)
        .refreshable { await load() }
        .task { await load() }
    }

    @ViewBuilder
    private func row(_ item: NameItem) -> some View {
        if facultyLinks {
            NavigationLink(value: AppRoute.uniAdmin(.facultyGroups(facultyID: item.id, name: item.name))) {
                TelegramStyleRow(
                    title: item.name,
                    subtitle: String(localized: "uadmin.faculty.openGroups", defaultValue: "Группы факультета")
                ) {
                    RowSymbol(symbol: kind.symbol, tint: TileTint.indigo)
                }
            }
        } else {
            TelegramStyleRow(title: item.name) {
                RowSymbol(symbol: kind.symbol, tint: TileTint.blue)
            }
        }
    }

    @MainActor
    private func load() async {
        do {
            items = try await kind.load().sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    @MainActor
    private func remove(_ item: NameItem) async {
        do {
            try await kind.delete(item.id)
            items?.removeAll { $0.id == item.id }
        } catch {
            actionFailure = UAdminFailure.blocked(error, title: kind.blockedTitle, labels: kind.blockers)
        }
    }
}

/// Одно поле «название»: создание и переименование. Занятое название сервер отклоняет
/// конфликтом — показываем это словами, а не кодом.
private struct NameFormSheet: View {
    let title: String
    let fieldTitle: String
    let placeholder: String
    let initial: String
    let save: (String) async throws -> Void
    let saved: () async -> Void

    @State private var name = ""

    var body: some View {
        FormSheet(
            title: title,
            canSave: !trimmed.isEmpty && trimmed != initial,
            save: {
                do {
                    try await save(trimmed)
                } catch where UAdminFailure.isConflict(error) {
                    throw UAdminFailure.message(String(localized: "uadmin.nameTaken", defaultValue: "Такое название уже есть"))
                }
            },
            saved: saved
        ) {
            Section(fieldTitle) {
                TextField(placeholder, text: $name)
                    .textInputAutocapitalization(.sentences)
            }
        }
        .onAppear { if name.isEmpty { name = initial } }
    }

    private var trimmed: String { String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200)) }
}

// MARK: - Группы

struct UAdminGroupsView: View {
    /// Задан — группы одного факультета (переход из списка факультетов).
    var facultyID: String?
    var facultyName: String?

    @State private var loader: PagedLoader<UAdminGroupDTO>?
    @State private var faculties: [UAdminFacultyDTO] = []
    /// Факультеты пришли — только тогда пустой список значит «создайте факультет».
    /// Сбой — не «факультетов нет»: подсказка и запрет добавления вводили бы в заблуждение.
    @State private var facultiesLoaded = false
    @State private var facultiesFailure: String?
    @State private var facultiesOffline = false
    @State private var filterFaculty: String?
    @State private var query = ""
    @State private var creating = false
    @State private var editing: UAdminGroupDTO?
    @State private var deleting: UAdminGroupDTO?
    @State private var actionFailure: String?

    var body: some View {
        Group {
            if let loader {
                PagedList(
                    loader: loader,
                    empty: EmptyStateView(
                        title: query.isEmpty
                            ? String(localized: "uadmin.group.empty", defaultValue: "Групп пока нет")
                            : String(localized: "uadmin.picker.nothing", defaultValue: "Ничего не найдено"),
                        symbol: query.isEmpty ? "person.3" : "magnifyingglass",
                        hint: facultiesLoaded && faculties.isEmpty && query.isEmpty
                            ? String(localized: "uadmin.group.needFaculty", defaultValue: "Сначала создайте факультет — группа привязывается к нему.")
                            : nil
                    )
                ) {
                    if let facultiesFailure, loader.failure == nil {
                        StaleDataBanner(message: facultiesFailure, isOffline: facultiesOffline) { await loadFaculties() }
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets())
                    }
                    if facultyID == nil, faculties.count > 1 {
                        FilterChipsRow(
                            options: [(value: String?.none, title: String(localized: "uadmin.allFaculties", defaultValue: "Все факультеты"))]
                                + faculties.map { (value: Optional($0.id), title: $0.name) },
                            selection: $filterFaculty
                        )
                    }
                } row: { group in
                    NavigationLink(value: AppRoute.uniAdmin(.group(id: group.id))) {
                        GroupRow(group: group, facultyName: facultyID == nil ? facultyName(group.facultyId) : nil)
                    }
                    .swipeActions {
                        Button(role: .destructive) {
                            deleting = group
                        } label: {
                            Label(String(localized: "uadmin.delete", defaultValue: "Удалить"), systemImage: "trash")
                        }
                        Button {
                            editing = group
                        } label: {
                            Label(String(localized: "uadmin.edit", defaultValue: "Изменить"), systemImage: "pencil")
                        }
                        .tint(Palette.primary)
                    }
                    .contextMenu {
                        Button {
                            editing = group
                        } label: {
                            Label(String(localized: "uadmin.edit", defaultValue: "Изменить"), systemImage: "pencil")
                        }
                        Button {
                            UAdminNav.push(.uniAdmin(.groupSchedule(groupID: group.id)))
                        } label: {
                            Label(String(localized: "uadmin.group.schedule", defaultValue: "Расписание группы"), systemImage: "calendar")
                        }
                        Button(role: .destructive) {
                            deleting = group
                        } label: {
                            Label(String(localized: "uadmin.delete", defaultValue: "Удалить"), systemImage: "trash")
                        }
                    }
                }
            } else {
                LoadingStateView()
            }
        }
        .navigationTitle(Text(facultyName ?? UniAdminScreen.groups.title))
        .uadminDebouncedSearch($query, prompt: String(localized: "uadmin.searchByName", defaultValue: "Поиск по названию")) { _ in
            await reload()
        }
        .floatingAction(String(localized: "uadmin.group.add", defaultValue: "Добавить группу")) {
            // Без факультета группу не создать — говорим, что сделать сначала. Но только
            // когда факультетов правда нет: при сбое загрузки — пробуем ещё раз.
            if !faculties.isEmpty {
                creating = true
            } else if facultiesLoaded {
                actionFailure = String(localized: "uadmin.group.needFaculty", defaultValue: "Сначала создайте факультет — группа привязывается к нему.")
            } else {
                Task {
                    await loadFaculties()
                    if !faculties.isEmpty {
                        creating = true
                    } else if facultiesLoaded {
                        actionFailure = String(localized: "uadmin.group.needFaculty", defaultValue: "Сначала создайте факультет — группа привязывается к нему.")
                    } else {
                        actionFailure = facultiesFailure
                    }
                }
            }
        }
        .sheet(isPresented: $creating) {
            UAdminGroupForm(group: nil, faculties: faculties, facultyID: facultyID ?? filterFaculty) {
                await loader?.reload()
            }
        }
        .sheet(item: $editing) { group in
            UAdminGroupForm(group: group, faculties: faculties, facultyID: group.facultyId) {
                await loader?.reload()
            }
        }
        .confirmDestructive(
            $deleting,
            title: { String(localized: "uadmin.group.deleteConfirm", defaultValue: "Удалить группу «\($0.name)»? Удалить можно только пустую группу.") },
            actionTitle: String(localized: "uadmin.delete", defaultValue: "Удалить")
        ) { group in
            do {
                try await UAdminAPI().deleteGroup(id: group.id)
                loader?.remove(id: group.id)
            } catch {
                actionFailure = UAdminGroupDelete.message(error)
            }
        }
        .actionFailureAlert($actionFailure)
        .onChange(of: filterFaculty) { _, _ in Task { await reload() } }
        .task {
            if loader == nil { makeLoader() }
            if !facultiesLoaded { await loadFaculties() }
        }
    }

    @MainActor
    private func loadFaculties() async {
        do {
            faculties = try await UAdminAPI().faculties()
            facultiesLoaded = true
            facultiesFailure = nil
        } catch is CancellationError {
            return
        } catch {
            facultiesFailure = error.userMessage
            facultiesOffline = error.isOffline
        }
    }

    private func facultyName(_ id: String) -> String? {
        faculties.first(where: { $0.id == id })?.name
    }

    private func makeLoader() {
        let search = query.trimmingCharacters(in: .whitespaces)
        let faculty = facultyID ?? filterFaculty
        loader = PagedLoader(limit: 30) { request in
            try await UAdminAPI().groups(request, search: search.isEmpty ? nil : String(search.prefix(100)), facultyID: faculty)
        }
    }

    @MainActor
    private func reload() async {
        let search = query.trimmingCharacters(in: .whitespaces)
        let faculty = facultyID ?? filterFaculty
        guard let loader else { return makeLoader() }
        await loader.replace { request in
            try await UAdminAPI().groups(request, search: search.isEmpty ? nil : String(search.prefix(100)), facultyID: faculty)
        }
    }
}

private struct GroupRow: View {
    let group: UAdminGroupDTO
    let facultyName: String?

    private var year: String? {
        guard let year = group.year else { return nil }
        return String(year)
    }

    var body: some View {
        TelegramStyleRow(
            title: group.name,
            subtitle: facultyName,
            meta: year
        ) {
            AvatarView(url: nil, name: group.name, size: 48)
        } accessory: {
            if group.starostaId == nil {
                StatusBadge(text: String(localized: "uadmin.group.noStarosta", defaultValue: "Без старосты"), tint: Palette.warning)
            } else {
                StatusBadge(text: String(localized: "uadmin.group.hasStarosta", defaultValue: "Есть староста"), tint: Palette.info)
            }
        }
    }
}

enum UAdminGroupDelete {
    static func message(_ error: Error) -> String {
        UAdminFailure.blocked(
            error,
            title: String(localized: "uadmin.group.deleteBlocked", defaultValue: "Группу нельзя удалить"),
            labels: [
                "students": String(localized: "uadmin.group.blocker.students", defaultValue: "студенты"),
                "schedule": String(localized: "uadmin.group.blocker.schedule", defaultValue: "расписание"),
                "courses": String(localized: "uadmin.group.blocker.courses", defaultValue: "курсы"),
                "exams": String(localized: "uadmin.group.blocker.exams", defaultValue: "экзамены"),
                "materials": String(localized: "uadmin.group.blocker.materials", defaultValue: "материалы"),
            ]
        )
    }
}

/// Создание и правка группы. Факультет задаётся только при создании: перенос группы между
/// факультетами сервер не поддерживает.
struct UAdminGroupForm: View {
    let group: UAdminGroupDTO?
    let faculties: [UAdminFacultyDTO]
    var facultyID: String?
    let saved: () async -> Void

    @State private var name = ""
    @State private var year = ""
    @State private var faculty = ""
    @State private var prepared = false

    var body: some View {
        FormSheet(
            title: group == nil
                ? String(localized: "uadmin.group.add", defaultValue: "Добавить группу")
                : String(localized: "uadmin.group.edit", defaultValue: "Изменить группу"),
            canSave: canSave,
            save: save,
            saved: saved
        ) {
            Section {
                TextField(String(localized: "uadmin.group.namePlaceholder", defaultValue: "Название, например ИТ-24-1"), text: $name)
                TextField(String(localized: "uadmin.group.year", defaultValue: "Год набора"), text: $year)
                    .keyboardType(.numberPad)
                if group == nil {
                    Picker(String(localized: "uadmin.faculty", defaultValue: "Факультет"), selection: $faculty) {
                        ForEach(faculties) { Text($0.name).tag($0.id) }
                    }
                }
            } footer: {
                if !yearValid {
                    Text(String(localized: "uadmin.group.yearInvalid", defaultValue: "Год — целое число от 1900 до 2200"))
                        .foregroundStyle(Palette.destructive)
                }
            }
        }
        .onAppear {
            guard !prepared else { return }
            prepared = true
            name = group?.name ?? ""
            year = group?.year.map { String($0) } ?? ""
            faculty = facultyID ?? faculties.first?.id ?? ""
        }
    }

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var yearValue: Int? { Int(year.trimmingCharacters(in: .whitespaces)) }
    private var yearValid: Bool {
        let raw = year.trimmingCharacters(in: .whitespaces)
        guard !raw.isEmpty else { return true }
        guard let value = yearValue else { return false }
        return (1900...2200).contains(value)
    }

    private var canSave: Bool {
        !trimmed.isEmpty && trimmed.count <= 100 && yearValid && (group != nil || !faculty.isEmpty)
    }

    private func save() async throws {
        let api = UAdminAPI()
        do {
            if let group {
                try await api.updateGroup(id: group.id, name: trimmed, year: yearValue)
            } else {
                try await api.createGroup(name: trimmed, year: yearValue, facultyID: faculty)
            }
        } catch where UAdminFailure.isConflict(error) {
            throw UAdminFailure.message(String(localized: "uadmin.nameTaken", defaultValue: "Такое название уже есть"))
        }
    }
}

// MARK: - Карточка группы

struct UAdminGroupDetailView: View {
    let groupID: String

    @Environment(\.dismiss) private var dismiss
    @State private var group: UAdminGroupDTO?
    @State private var members: [UAdminGroupMemberDTO] = []
    @State private var facultyName: String?
    @State private var faculties: [UAdminFacultyDTO] = []
    @State private var failure: String?
    @State private var isOffline = false
    @State private var actionFailure: String?
    @State private var editing = false
    @State private var deleting = false
    @State private var starostaChange: StarostaChange?

    var body: some View {
        Group {
            if let group {
                content(group)
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .navigationTitle(Text(UniAdminScreen.group(id: groupID).title))
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $editing) {
            if let group {
                UAdminGroupForm(group: group, faculties: faculties, facultyID: group.facultyId) { await load() }
            }
        }
        .alert(
            String(localized: "uadmin.group.deleteConfirm.short", defaultValue: "Удалить группу? Удалить можно только пустую группу, удаление необратимо."),
            isPresented: $deleting
        ) {
            Button(String(localized: "uadmin.delete", defaultValue: "Удалить"), role: .destructive) {
                Task { await remove() }
            }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
        }
        .alert(
            starostaChange?.title ?? "",
            isPresented: Binding(get: { starostaChange != nil }, set: { if !$0 { starostaChange = nil } }),
            presenting: starostaChange
        ) { change in
            Button(change.actionTitle, role: change.userID == nil ? .destructive : nil) {
                Task { await assign(change.userID) }
            }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
        } message: { change in
            Text(change.message)
        }
        .actionFailureAlert($actionFailure)
        .refreshable { await load() }
        .task { await load() }
    }

    private func content(_ group: UAdminGroupDTO) -> some View {
        let starosta = members.first(where: { $0.id == group.starostaId })
        let candidates = members.filter { $0.role == "STUDENT" || $0.role == "STAROSTA" }
        let subtitle = Self.subtitle(faculty: facultyName, year: group.year)
        return List {
            Section {
                HeroHeader(
                    visual: .avatar(url: nil, name: group.name),
                    title: group.name,
                    subtitle: subtitle,
                    actions: [
                        HeroAction(
                            title: String(localized: "uadmin.group.scheduleShort", defaultValue: "Расписание"),
                            symbol: "calendar"
                        ) { UAdminNav.push(.uniAdmin(.groupSchedule(groupID: groupID))) },
                        HeroAction(
                            title: String(localized: "uadmin.group.attendanceShort", defaultValue: "Посещаемость"),
                            symbol: "chart.bar"
                        ) { UAdminNav.push(.uniAdmin(.groupAttendance(groupID: groupID, name: group.name))) },
                        HeroAction(
                            title: String(localized: "uadmin.edit", defaultValue: "Изменить"),
                            symbol: "pencil"
                        ) { editing = true },
                    ]
                ) {
                    HStack(spacing: Spacing.sm) {
                        StatusBadge(
                            text: String(localized: "uadmin.group.membersCount", defaultValue: "Участников: \(members.count.formatted())"),
                            tint: Palette.mutedForeground
                        )
                        if group.starostaId == nil {
                            StatusBadge(text: String(localized: "uadmin.group.noStarosta", defaultValue: "Без старосты"), tint: Palette.warning)
                        }
                    }
                }
            }

            Section {
                DetailRow(title: String(localized: "uadmin.faculty", defaultValue: "Факультет"), value: facultyName ?? UAdminText.empty, symbol: "building.columns")
                DetailRow(title: String(localized: "uadmin.group.year", defaultValue: "Год набора"), value: group.year.map { String($0) } ?? UAdminText.empty, symbol: "calendar")
            }

            Section {
                if let starosta {
                    NavigationLink(value: AppRoute.profile(id: starosta.id)) {
                        PersonRow(name: starosta.name, subtitle: UAdminText.role("STAROSTA"), avatarURL: starosta.avatarUrl)
                    }
                } else {
                    Text(String(localized: "uadmin.group.noStarostaYet", defaultValue: "Староста не назначен"))
                        .foregroundStyle(Palette.mutedForeground)
                }
                if !candidates.isEmpty {
                    Menu {
                        ForEach(candidates) { member in
                            Button {
                                guard member.id != group.starostaId else { return }
                                starostaChange = StarostaChange(
                                    userID: member.id,
                                    name: member.name,
                                    previous: starosta?.name
                                )
                            } label: {
                                if member.id == group.starostaId {
                                    Label(member.name, systemImage: "checkmark")
                                } else {
                                    Text(member.name)
                                }
                            }
                        }
                    } label: {
                        Label(
                            starosta == nil
                                ? String(localized: "uadmin.starosta.assign", defaultValue: "Назначить старосту")
                                : String(localized: "uadmin.starosta.change", defaultValue: "Сменить старосту"),
                            systemImage: "person.badge.plus"
                        )
                    }
                    if let starosta {
                        Button(role: .destructive) {
                            starostaChange = StarostaChange(userID: nil, name: starosta.name, previous: nil)
                        } label: {
                            Label(String(localized: "uadmin.starosta.clear", defaultValue: "Снять старосту"), systemImage: "person.badge.minus")
                        }
                    }
                }
            } header: {
                Text(String(localized: "uadmin.starosta", defaultValue: "Староста"))
            } footer: {
                if !candidates.isEmpty {
                    Text(String(localized: "uadmin.starosta.footer", defaultValue: "Староста — роль: выбранный студент получает права старосты, прежний возвращается в студенты."))
                }
            }

            Section {
                if members.isEmpty {
                    Text(String(localized: "uadmin.group.noMembers", defaultValue: "В группе пока нет участников"))
                        .foregroundStyle(Palette.mutedForeground)
                }
                ForEach(members) { member in
                    NavigationLink(value: AppRoute.profile(id: member.id)) {
                        PersonRow(
                            name: member.name,
                            subtitle: UAdminText.role(member.role),
                            avatarURL: member.avatarUrl,
                            trailing: member.id == group.starostaId ? String(localized: "uadmin.starosta", defaultValue: "Староста") : nil
                        )
                    }
                }
            } header: {
                Text(String(localized: "uadmin.group.members", defaultValue: "Состав группы"))
            } footer: {
                if !members.isEmpty {
                    Text(String(localized: "common.totalCount", defaultValue: "Всего: \(members.count.formatted())"))
                }
            }

            Section {
                Button(role: .destructive) {
                    deleting = true
                } label: {
                    Label(String(localized: "uadmin.group.delete", defaultValue: "Удалить группу"), systemImage: "trash")
                        .foregroundStyle(Palette.destructive)
                }
            } footer: {
                Text(String(localized: "uadmin.group.deleteFooter", defaultValue: "Удалить можно только пустую группу: без студентов, расписания, курсов и экзаменов."))
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
    }

    @MainActor
    private func load() async {
        let api = UAdminAPI()
        do {
            async let groupTask = api.group(id: groupID)
            async let membersTask = api.groupMembers(id: groupID)
            let loaded = try await groupTask
            members = try await membersTask.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
            if faculties.isEmpty { faculties = (try? await api.faculties()) ?? [] }
            facultyName = faculties.first(where: { $0.id == loaded.facultyId })?.name
            group = loaded
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    /// «ФИТ · набор 2024».
    private static func subtitle(faculty: String?, year: Int?) -> String {
        var parts: [String] = []
        if let faculty { parts.append(faculty) }
        if let year {
            let value = String(year)
            parts.append(String(localized: "uadmin.group.yearShort", defaultValue: "набор \(value)"))
        }
        return parts.joined(separator: " · ")
    }

    @MainActor
    private func assign(_ userID: String?) async {
        do {
            try await UAdminAPI().assignStarosta(groupID: groupID, userID: userID)
            await load()
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func remove() async {
        do {
            try await UAdminAPI().deleteGroup(id: groupID)
            dismiss()
        } catch {
            actionFailure = UAdminGroupDelete.message(error)
        }
    }
}

/// Смена старосты — смена ролей: подтверждение называет, кто получит права, а кто их потеряет.
private struct StarostaChange {
    let userID: String?
    let name: String
    let previous: String?

    var title: String {
        userID == nil
            ? String(localized: "uadmin.starosta.clearTitle", defaultValue: "Снять старосту?")
            : String(localized: "uadmin.starosta.assignTitle", defaultValue: "Назначить старосту?")
    }

    var message: String {
        if userID == nil {
            return String(localized: "uadmin.starosta.clearMessage", defaultValue: "\(name) вернётся в студенты и выйдет из аккаунта на всех устройствах.")
        }
        if let previous {
            return String(localized: "uadmin.starosta.replaceMessage", defaultValue: "\(name) получит права старосты, а \(previous) вернётся в студенты и выйдет из аккаунта на всех устройствах.")
        }
        return String(localized: "uadmin.starosta.assignMessage", defaultValue: "\(name) получит права старосты группы.")
    }

    var actionTitle: String {
        userID == nil
            ? String(localized: "uadmin.starosta.clear", defaultValue: "Снять старосту")
            : String(localized: "uadmin.starosta.assignAction", defaultValue: "Назначить")
    }
}
