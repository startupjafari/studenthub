import SwiftUI

/// Вузы платформы: поиск, статус, создание. Город хранится кодом КАТО — названия
/// подтягиваются одним запросом на страницу.
struct AdminUniversitiesView: View {
    @Environment(\.viewerRole) private var viewerRole

    @State private var search = ""
    @State private var status: String?
    @State private var creating = false
    @State private var cities: [String: String] = [:]
    @State private var loader = PagedLoader<AdminUniversityDTO>(limit: 50) { request in
        try await AdminAPI().universities(search: nil, request: request)
    }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: search.isEmpty
                    ? String(localized: "admin.universities.empty", defaultValue: "Университетов нет")
                    : String(localized: "admin.universities.nothing", defaultValue: "Ничего не нашлось"),
                symbol: "building.columns"
            )
        ) {
            FilterChipsRow(
                options: [(value: nil, title: AdminText.all)]
                    + AdminText.universityStatuses.map { (value: Optional($0), title: AdminText.universityStatus($0).text) },
                selection: $status
            )
        } row: { university in
            NavigationLink(value: AppRoute.admin(.university(id: university.id))) {
                AdminUniversityRow(university: university, city: university.city.flatMap { cities[$0] ?? $0 })
            }
        }
        .navigationTitle(Text(AdminScreen.universities.title))
        .debouncedSearch($search, prompt: String(localized: "admin.universities.search", defaultValue: "Поиск по названию")) { _ in
            await refilter()
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if viewerRole == .platformAdmin {
                    Button {
                        creating = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel(Text(String(localized: "admin.universities.add", defaultValue: "Добавить университет")))
                }
            }
        }
        .onChange(of: status) { _, _ in Task { await refilter() } }
        .onAppear { if loader.isLoaded { Task { await loader.reload() } } }
        .task(id: loader.items.count) { await resolveCities() }
        .sheet(isPresented: $creating) {
            AdminUniversityForm(university: nil, cityName: nil) { await loader.reload() }
        }
    }

    private func refilter() async {
        let needle = search.trimmingCharacters(in: .whitespaces)
        let status = status
        await loader.replace { request in
            try await AdminAPI().universities(search: needle.isEmpty ? nil : String(needle.prefix(100)), status: status, request: request)
        }
    }

    private func resolveCities() async {
        let codes = loader.items.compactMap(\.city).filter { cities[$0] == nil }
        guard !codes.isEmpty, let units = try? await AdminAPI().katoResolve(codes) else { return }
        for unit in units { cities[unit.code] = unit.nameRu }
    }
}

struct AdminUniversityRow: View {
    let university: AdminUniversityDTO
    let city: String?

    var body: some View {
        let status = AdminText.universityStatus(university.status)
        ListCardRow(
            title: university.name,
            subtitle: [university.shortName, city].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "),
            status: (text: status.text, tint: status.tint),
            lines: [university.createdAt.map { DisplayFormat.date($0) } ?? ""]
        )
    }
}

/// Карточка вуза: реквизиты, размер, статус. Администратору платформы — правка, смена
/// статуса, приглашение администратора вуза и удаление пустого вуза.
struct AdminUniversityView: View {
    let id: String

    @Environment(\.viewerRole) private var viewerRole
    @Environment(\.dismiss) private var dismiss

    @State private var university: AdminUniversityDTO?
    @State private var stats: AdminUniversityStatsDTO?
    @State private var cityName: String?
    @State private var failure: String?
    @State private var isOffline = false
    @State private var actionFailure: String?
    @State private var editing = false
    @State private var inviting = false
    @State private var confirmBlock = false
    @State private var confirmDelete = false
    @State private var isWorking = false

    private let api = AdminAPI()
    private var canEdit: Bool { viewerRole == .platformAdmin }

    var body: some View {
        Group {
            if let university {
                content(university)
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .background(Palette.background)
        .navigationTitle(Text(university?.shortName ?? university?.name ?? AdminScreen.university(id: id).title))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if canEdit, university != nil {
                    Button(String(localized: "admin.university.edit", defaultValue: "Изменить")) { editing = true }
                }
            }
        }
        .task { await load() }
        .actionFailureAlert($actionFailure)
        .sheet(isPresented: $editing) {
            if let university {
                AdminUniversityForm(university: university, cityName: cityName) { await load() }
            }
        }
        .sheet(isPresented: $inviting) {
            if let university {
                AdminCreateInviteSheet(
                    roles: ["UNIVERSITY_ADMIN"],
                    presetUniversity: AdminPickItem(id: university.id, title: university.name, subtitle: university.shortName)
                ) {}
            }
        }
        .confirmationDialog(
            String(localized: "admin.university.blockTitle", defaultValue: "Заблокировать вуз?"),
            isPresented: $confirmBlock,
            titleVisibility: .visible
        ) {
            Button(String(localized: "admin.university.block", defaultValue: "Заблокировать"), role: .destructive) {
                Task { await setStatus("BLOCKED") }
            }
        } message: {
            Text(String(localized: "admin.university.blockMessage", defaultValue: "Все пользователи «\((university?.name).orEmpty)» будут сразу отключены и не смогут войти, пока вуз не разблокируют."))
        }
        .confirmationDialog(
            String(localized: "admin.university.deleteTitle", defaultValue: "Удалить вуз?"),
            isPresented: $confirmDelete,
            titleVisibility: .visible
        ) {
            Button(String(localized: "admin.university.delete", defaultValue: "Удалить вуз"), role: .destructive) {
                Task { await delete() }
            }
        } message: {
            Text(String(localized: "admin.university.deleteMessage", defaultValue: "«\((university?.name).orEmpty)» будет удалён вместе с неиспользованными приглашениями. Действие нельзя отменить."))
        }
    }

    private func content(_ university: AdminUniversityDTO) -> some View {
        List {
            Section {
                DetailRow(title: String(localized: "admin.university.name", defaultValue: "Название"), value: university.name)
                if let short = university.shortName {
                    DetailRow(title: String(localized: "admin.university.shortName", defaultValue: "Аббревиатура"), value: short)
                }
                if let city = cityName ?? university.city {
                    DetailRow(title: String(localized: "admin.university.city", defaultValue: "Город"), value: city)
                }
                if let country = university.country {
                    DetailRow(title: String(localized: "admin.university.country", defaultValue: "Страна"), value: country)
                }
                if let timezone = university.timezone {
                    DetailRow(title: String(localized: "admin.university.timezone", defaultValue: "Часовой пояс"), value: timezone)
                }
                if let created = university.createdAt {
                    DetailRow(title: String(localized: "admin.university.createdAt", defaultValue: "Создан"), value: DisplayFormat.date(created))
                }
            }

            Section {
                if canEdit {
                    Picker(String(localized: "admin.university.status", defaultValue: "Статус"), selection: Binding(
                        get: { university.status },
                        set: { next in
                            guard next != university.status else { return }
                            if next == "BLOCKED" { confirmBlock = true } else { Task { await setStatus(next) } }
                        }
                    )) {
                        ForEach(AdminText.universityStatuses, id: \.self) { Text(AdminText.universityStatus($0).text).tag($0) }
                    }
                    .disabled(isWorking)
                } else {
                    let status = AdminText.universityStatus(university.status)
                    HStack {
                        Text(String(localized: "admin.university.status", defaultValue: "Статус")).foregroundStyle(Palette.mutedForeground)
                        Spacer()
                        StatusBadge(text: status.text, tint: status.tint)
                    }
                }
            } footer: {
                Text(String(localized: "admin.university.statusHint", defaultValue: "Заблокированный вуз отключается целиком: его люди не могут войти."))
            }

            if let stats {
                Section {
                    StatGrid {
                        StatTile(title: String(localized: "admin.university.students", defaultValue: "Студенты"), value: (stats.students ?? 0).formatted(), symbol: "graduationcap", tint: TileTint.blue)
                        StatTile(title: String(localized: "admin.university.teachers", defaultValue: "Преподаватели"), value: (stats.teachers ?? 0).formatted(), symbol: "person.crop.rectangle", tint: TileTint.indigo)
                        StatTile(title: String(localized: "admin.university.faculties", defaultValue: "Факультеты"), value: (stats.faculties ?? 0).formatted(), symbol: "building.columns", tint: TileTint.teal)
                        StatTile(title: String(localized: "admin.university.groups", defaultValue: "Группы"), value: (stats.groups ?? 0).formatted(), symbol: "person.3", tint: TileTint.green)
                        StatTile(title: String(localized: "admin.university.rooms", defaultValue: "Аудитории"), value: (stats.rooms ?? 0).formatted(), symbol: "door.left.hand.open", tint: TileTint.orange)
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                } header: {
                    Text(String(localized: "admin.university.size", defaultValue: "Размер"))
                }
            }

            if canEdit {
                Section {
                    Button {
                        inviting = true
                    } label: {
                        Label(String(localized: "admin.university.inviteAdmin", defaultValue: "Пригласить администратора вуза"), systemImage: "person.badge.plus")
                    }
                    Button(role: .destructive) {
                        confirmDelete = true
                    } label: {
                        Label(String(localized: "admin.university.delete", defaultValue: "Удалить вуз"), systemImage: "trash")
                    }
                } footer: {
                    Text(String(localized: "admin.university.deleteHint", defaultValue: "Удалить можно только пустой вуз — без факультетов, аудиторий и пользователей."))
                }
                .disabled(isWorking)
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await load() }
    }

    @MainActor
    private func load() async {
        do {
            let value = try await api.university(id: id)
            university = value
            failure = nil
            if let city = value.city, let unit = try? await api.katoResolve([city]).first {
                cityName = unit.nameRu
            }
            stats = try? await api.universityStats(id: id)
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    @MainActor
    private func setStatus(_ status: String) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await api.setUniversityStatus(id: id, status: status)
            await load()
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func delete() async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await api.deleteUniversity(id: id)
            dismiss()
        } catch {
            if (error as? APIError)?.code == .conflict {
                actionFailure = String(localized: "admin.university.deleteConflict", defaultValue: "Удалить можно только пустой вуз — без факультетов, аудиторий и пользователей")
            } else {
                actionFailure = error.userMessage
            }
        }
    }
}

/// Реквизиты вуза: название, аббревиатура, город (КАТО или текстом — для зарубежного) и
/// часовой пояс, по которому считаются журнал, расписание и сводки.
struct AdminUniversityForm: View {
    let university: AdminUniversityDTO?
    let cityName: String?
    let saved: () async -> Void

    @State private var name: String
    @State private var shortName: String
    @State private var city: AdminPickItem?
    @State private var cityText: String
    @State private var timezone: AdminPickItem?

    init(university: AdminUniversityDTO?, cityName: String?, saved: @escaping () async -> Void) {
        self.university = university
        self.cityName = cityName
        self.saved = saved
        _name = State(initialValue: university?.name ?? "")
        _shortName = State(initialValue: university?.shortName ?? "")
        let code = university?.city
        let isCode = code.map { $0.count == 9 && $0.allSatisfy(\.isNumber) } ?? false
        _city = State(initialValue: isCode ? code.map { AdminPickItem(id: $0, title: cityName ?? $0) } : nil)
        _cityText = State(initialValue: isCode ? "" : (code ?? ""))
        let zone = university?.timezone ?? "Asia/Almaty"
        _timezone = State(initialValue: AdminPickItem(id: zone, title: zone))
    }

    var body: some View {
        FormSheet(
            title: university == nil
                ? String(localized: "admin.universities.add", defaultValue: "Добавить университет")
                : String(localized: "admin.university.editTitle", defaultValue: "Университет"),
            saveTitle: university == nil
                ? String(localized: "admin.universities.create", defaultValue: "Создать")
                : String(localized: "common.save", defaultValue: "Сохранить"),
            canSave: !name.trimmingCharacters(in: .whitespaces).isEmpty,
            save: save,
            saved: saved
        ) {
            Section {
                TextField(String(localized: "admin.university.name", defaultValue: "Название"), text: $name, axis: .vertical)
                TextField(String(localized: "admin.university.shortName", defaultValue: "Аббревиатура"), text: $shortName)
            }

            Section {
                NavigationLink {
                    AdminSearchPicker(
                        title: String(localized: "admin.university.city", defaultValue: "Город"),
                        selection: $city
                    ) { needle in
                        guard !needle.isEmpty else { return [] }
                        return try await AdminAPI().katoSearch(String(needle.prefix(100)))
                            .map { AdminPickItem(id: $0.code, title: $0.nameRu, subtitle: $0.regionNameRu) }
                    }
                } label: {
                    LabeledContent(
                        String(localized: "admin.university.city", defaultValue: "Город"),
                        value: city?.title ?? String(localized: "admin.university.cityNone", defaultValue: "Не выбран")
                    )
                }
                if city != nil {
                    Button(String(localized: "admin.university.cityClear", defaultValue: "Убрать город"), role: .destructive) {
                        city = nil
                    }
                }
                if city == nil {
                    TextField(String(localized: "admin.university.cityText", defaultValue: "Город текстом (зарубежный вуз)"), text: $cityText)
                }
            } footer: {
                Text(String(localized: "admin.university.cityHint", defaultValue: "Хранится код справочника КАТО: город переименуют — запись не устареет. Текстом — только для вуза за рубежом."))
            }

            Section {
                NavigationLink {
                    AdminSearchPicker(
                        title: String(localized: "admin.university.timezone", defaultValue: "Часовой пояс"),
                        selection: $timezone
                    ) { needle in
                        let all = TimeZone.knownTimeZoneIdentifiers
                        let filtered = needle.isEmpty ? all : all.filter { $0.localizedCaseInsensitiveContains(needle) }
                        return filtered.map { AdminPickItem(id: $0, title: $0) }
                    }
                } label: {
                    LabeledContent(
                        String(localized: "admin.university.timezone", defaultValue: "Часовой пояс"),
                        value: timezone?.title ?? "—"
                    )
                }
            } footer: {
                Text(String(localized: "admin.university.timezoneHint", defaultValue: "По нему считаются день журнала, расписание и ежедневные сводки вуза"))
            }
        }
    }

    private func save() async throws {
        let trimmedText = cityText.trimmingCharacters(in: .whitespaces)
        var fields: [String: JSONValue] = [
            "name": .string(String(name.trimmingCharacters(in: .whitespaces).prefix(200))),
        ]
        let short = shortName.trimmingCharacters(in: .whitespaces)
        let cityValue = city?.id ?? (trimmedText.isEmpty ? nil : String(trimmedText.prefix(100)))
        if let university {
            // Правка: пустое поле не отправляем — схема требует непустых строк.
            if !short.isEmpty { fields["shortName"] = .string(String(short.prefix(50))) }
            if let cityValue { fields["city"] = .string(cityValue) }
            if let zone = timezone?.id { fields["timezone"] = .string(zone) }
            try await AdminAPI().updateUniversity(id: university.id, fields: fields)
        } else {
            if !short.isEmpty { fields["shortName"] = .string(String(short.prefix(50))) }
            if let cityValue { fields["city"] = .string(cityValue) }
            if let zone = timezone?.id { fields["timezone"] = .string(zone) }
            _ = try await AdminAPI().createUniversity(fields)
        }
    }
}

// MARK: - Заявки на демо

/// Заявки вузов на тестирование: новые, одобренные, отклонённые. Одобрение заводит вуз и
/// высылает приглашение администратору.
struct AdminDemoRequestsView: View {
    @State private var status: String? = "NEW"
    @State private var search = ""
    @State private var loader = PagedLoader<AdminDemoRequestDTO>(limit: 30) { request in
        try await AdminAPI().demoRequests(status: "NEW", search: nil, request: request)
    }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(title: emptyTitle, symbol: "envelope.open")
        ) {
            FilterChipsRow(
                options: AdminText.demoStatuses.map { (value: Optional($0), title: AdminText.demoTab($0)) },
                selection: $status
            )
        } row: { request in
            NavigationLink(value: AppRoute.admin(.demoRequest(id: request.id))) {
                let status = AdminText.demoStatus(request.status)
                ListCardRow(
                    title: request.universityName,
                    subtitle: "\(request.contactName) · \(request.email)",
                    status: (text: status.text, tint: status.tint),
                    lines: [DisplayFormat.dateTime(request.createdAt)]
                )
            }
        }
        .navigationTitle(Text(AdminScreen.demoRequests.title))
        .debouncedSearch($search, prompt: String(localized: "admin.demo.search", defaultValue: "Вуз, контакт или почта")) { _ in
            await refilter()
        }
        .onChange(of: status) { _, _ in Task { await refilter() } }
        .onAppear { if loader.isLoaded { Task { await loader.reload() } } }
    }

    private var emptyTitle: String {
        switch status {
        case "APPROVED": return String(localized: "admin.demo.emptyApproved", defaultValue: "Одобренных заявок пока нет")
        case "REJECTED": return String(localized: "admin.demo.emptyRejected", defaultValue: "Отклонённых заявок нет")
        default: return String(localized: "admin.demo.emptyNew", defaultValue: "Новых заявок нет")
        }
    }

    private func refilter() async {
        let status = status
        let needle = search.trimmingCharacters(in: .whitespaces)
        let query: String? = needle.count >= 2 ? String(needle.prefix(100)) : nil
        await loader.replace { request in
            try await AdminAPI().demoRequests(status: status, search: query, request: request)
        }
    }
}

/// Заявка вуза целиком и решение по ней.
struct AdminDemoRequestView: View {
    let id: String

    @State private var request: AdminDemoRequestDTO?
    @State private var cityName: String?
    @State private var failure: String?
    @State private var isOffline = false
    @State private var actionFailure: String?
    @State private var approving = false
    @State private var rejecting = false
    @State private var confirmReissue = false
    @State private var inviteLink: String?
    @State private var isWorking = false

    private let api = AdminAPI()

    var body: some View {
        Group {
            if let request {
                content(request)
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .background(Palette.background)
        .navigationTitle(Text(AdminScreen.demoRequest(id: id).title))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .actionFailureAlert($actionFailure)
        .sheet(isPresented: $approving) {
            if let request {
                AdminDemoApproveForm(request: request, cityName: cityName) { await load() }
            }
        }
        .sheet(isPresented: $rejecting) {
            if let request {
                AdminDemoRejectForm(requestID: request.id) { await load() }
            }
        }
        .confirmationDialog(
            String(localized: "admin.demo.reissueTitle", defaultValue: "Выписать приглашение заново?"),
            isPresented: $confirmReissue,
            titleVisibility: .visible
        ) {
            Button(String(localized: "admin.demo.reissue", defaultValue: "Выписать приглашение заново")) {
                Task { await reissue() }
            }
        } message: {
            Text(String(localized: "admin.demo.reissueMessage", defaultValue: "Прежняя ссылка перестанет работать. Новое письмо уйдёт на \((request?.email).orEmpty)."))
        }
    }

    private func content(_ request: AdminDemoRequestDTO) -> some View {
        List {
            Section {
                HStack {
                    Text(request.universityName)
                        .font(Typography.cardTitle)
                        .foregroundStyle(Palette.foreground)
                    Spacer(minLength: Spacing.md)
                    let status = AdminText.demoStatus(request.status)
                    StatusBadge(text: status.text, tint: status.tint)
                }
                DetailRow(title: String(localized: "admin.demo.createdAt", defaultValue: "Подана"), value: DisplayFormat.dateTime(request.createdAt))
            }

            Section {
                DetailRow(title: String(localized: "admin.demo.contact", defaultValue: "Контакт"), value: request.contactName)
                DetailRow(title: String(localized: "admin.demo.role", defaultValue: "Должность"), value: request.contactRole ?? "—")
                DetailRow(title: String(localized: "admin.demo.email", defaultValue: "Почта"), value: request.email)
                DetailRow(title: String(localized: "admin.demo.phone", defaultValue: "Телефон"), value: request.phone ?? "—")
                DetailRow(title: String(localized: "admin.demo.city", defaultValue: "Город"), value: cityName ?? request.city ?? "—")
                DetailRow(title: String(localized: "admin.demo.students", defaultValue: "Студентов"), value: request.studentsEstimate.map { $0.formatted() } ?? "—")
                DetailRow(title: String(localized: "admin.demo.website", defaultValue: "Сайт"), value: request.website ?? "—")
                DetailRow(
                    title: String(localized: "admin.demo.consent", defaultValue: "Согласие на ПД"),
                    value: [request.consentAt.map { DisplayFormat.dateTime($0) }, request.consentVersion].compactMap { $0 }.joined(separator: " · ")
                )
            }
            .textSelection(.enabled)

            if let comment = request.comment, !comment.isEmpty {
                Section {
                    Text(comment).font(Typography.body).foregroundStyle(Palette.foreground)
                } header: {
                    Text(String(localized: "admin.demo.comment", defaultValue: "Комментарий"))
                }
            }

            if request.status == "REJECTED" {
                Section {
                    if let reason = request.rejectionReason {
                        Text(AdminText.demoReason(reason)).font(Typography.body)
                    }
                    if let note = request.reviewNote, !note.isEmpty {
                        DetailRow(title: String(localized: "admin.demo.note", defaultValue: "Заметка"), value: note)
                    }
                } header: {
                    Text(String(localized: "admin.demo.reason", defaultValue: "Причина отказа"))
                }
            }

            if let inviteLink {
                AdminInviteLinkSection(link: inviteLink)
            }

            Section {
                if request.status == "NEW" {
                    Button {
                        approving = true
                    } label: {
                        Label(String(localized: "admin.demo.approve", defaultValue: "Одобрить"), systemImage: "checkmark.seal")
                    }
                    Button(role: .destructive) {
                        rejecting = true
                    } label: {
                        Label(String(localized: "admin.demo.reject", defaultValue: "Отклонить"), systemImage: "xmark.seal")
                    }
                }
                if request.status == "APPROVED" {
                    if let universityID = request.universityId {
                        NavigationLink(value: AppRoute.admin(.university(id: universityID))) {
                            Label(String(localized: "admin.demo.openUniversity", defaultValue: "Карточка вуза"), systemImage: "building.columns")
                        }
                    }
                    if inviteLink == nil {
                        Button {
                            confirmReissue = true
                        } label: {
                            Label(String(localized: "admin.demo.reissue", defaultValue: "Выписать приглашение заново"), systemImage: "arrow.clockwise")
                        }
                    }
                }
            }
            .disabled(isWorking)
        }
        .listStyle(.insetGrouped)
        .refreshable { await load() }
    }

    @MainActor
    private func load() async {
        do {
            let value = try await api.demoRequest(id: id)
            request = value
            failure = nil
            if let city = value.city, let unit = try? await api.katoResolve([city]).first {
                cityName = unit.nameRu
            }
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    @MainActor
    private func reissue() async {
        isWorking = true
        defer { isWorking = false }
        do {
            inviteLink = try await api.reissueDemoInvite(id: id)
        } catch {
            actionFailure = error.userMessage
        }
    }
}

/// Одобрение: реквизиты вуза можно поправить — в форме их писал человек снаружи. Адрес
/// приглашения не меняется: он подтверждён письмом.
private struct AdminDemoApproveForm: View {
    let request: AdminDemoRequestDTO
    let saved: () async -> Void

    @State private var name: String
    @State private var shortName = ""
    @State private var city: AdminPickItem?
    @State private var timezone: AdminPickItem? = AdminPickItem(id: "Asia/Almaty", title: "Asia/Almaty")
    @State private var note = ""

    init(request: AdminDemoRequestDTO, cityName: String?, saved: @escaping () async -> Void) {
        self.request = request
        self.saved = saved
        _name = State(initialValue: request.universityName)
        _city = State(initialValue: request.city.map { AdminPickItem(id: $0, title: cityName ?? $0) })
    }

    var body: some View {
        FormSheet(
            title: String(localized: "admin.demo.approve", defaultValue: "Одобрить"),
            saveTitle: String(localized: "admin.demo.approveConfirm", defaultValue: "Завести вуз"),
            canSave: name.trimmingCharacters(in: .whitespaces).count >= 3,
            save: save,
            saved: saved
        ) {
            Section {
                TextField(String(localized: "admin.demo.universityName", defaultValue: "Название вуза"), text: $name, axis: .vertical)
                TextField(String(localized: "admin.university.shortName", defaultValue: "Аббревиатура"), text: $shortName)
                NavigationLink {
                    AdminSearchPicker(
                        title: String(localized: "admin.university.city", defaultValue: "Город"),
                        selection: $city
                    ) { needle in
                        guard !needle.isEmpty else { return [] }
                        return try await AdminAPI().katoSearch(String(needle.prefix(100)))
                            .map { AdminPickItem(id: $0.code, title: $0.nameRu, subtitle: $0.regionNameRu) }
                    }
                } label: {
                    LabeledContent(
                        String(localized: "admin.university.city", defaultValue: "Город"),
                        value: city?.title ?? String(localized: "admin.university.cityNone", defaultValue: "Не выбран")
                    )
                }
                NavigationLink {
                    AdminSearchPicker(
                        title: String(localized: "admin.university.timezone", defaultValue: "Часовой пояс"),
                        selection: $timezone
                    ) { needle in
                        let all = TimeZone.knownTimeZoneIdentifiers
                        return (needle.isEmpty ? all : all.filter { $0.localizedCaseInsensitiveContains(needle) })
                            .map { AdminPickItem(id: $0, title: $0) }
                    }
                } label: {
                    LabeledContent(String(localized: "admin.university.timezone", defaultValue: "Часовой пояс"), value: timezone?.title ?? "—")
                }
            } footer: {
                Text(String(localized: "admin.demo.approveExplain", defaultValue: "Мы заведём вуз и вышлем приглашение администратора на \(request.email). Вуз будет создан неактивным — запустит его сам вуз, когда заполнит структуру."))
            }

            Section {
                TextField(String(localized: "admin.demo.note", defaultValue: "Заметка"), text: $note, axis: .vertical)
                    .lineLimit(2...5)
            } footer: {
                Text(String(localized: "admin.demo.noteInternal", defaultValue: "Видна только нам, в письмо не уходит."))
            }
        }
    }

    private func save() async throws {
        var fields: [String: JSONValue] = ["name": .string(String(name.trimmingCharacters(in: .whitespaces).prefix(200)))]
        let short = shortName.trimmingCharacters(in: .whitespaces)
        if !short.isEmpty { fields["shortName"] = .string(String(short.prefix(50))) }
        if let city { fields["city"] = .string(city.id) }
        if let zone = timezone?.id { fields["timezone"] = .string(zone) }
        let trimmedNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedNote.isEmpty { fields["note"] = .string(String(trimmedNote.prefix(1000))) }
        try await AdminAPI().approveDemoRequest(id: request.id, fields: fields)
    }
}

/// Отказ: причина из списка уходит заявителю письмом, заметка остаётся внутри.
private struct AdminDemoRejectForm: View {
    let requestID: String
    let saved: () async -> Void

    @State private var reason = "NO_CAPACITY"
    @State private var note = ""

    var body: some View {
        FormSheet(
            title: String(localized: "admin.demo.reject", defaultValue: "Отклонить"),
            saveTitle: String(localized: "admin.demo.rejectConfirm", defaultValue: "Отклонить"),
            save: { try await AdminAPI().rejectDemoRequest(id: requestID, reason: reason, note: note) },
            saved: saved
        ) {
            Section {
                Picker(String(localized: "admin.demo.reason", defaultValue: "Причина отказа"), selection: $reason) {
                    ForEach(AdminText.demoReasons, id: \.self) { Text(AdminText.demoReason($0)).tag($0) }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            } header: {
                Text(String(localized: "admin.demo.reason", defaultValue: "Причина отказа"))
            }

            Section {
                TextField(String(localized: "admin.demo.note", defaultValue: "Заметка"), text: $note, axis: .vertical)
                    .lineLimit(2...5)
            } footer: {
                Text(String(localized: "admin.demo.noteInternal", defaultValue: "Видна только нам, в письмо не уходит."))
            }
        }
    }
}
