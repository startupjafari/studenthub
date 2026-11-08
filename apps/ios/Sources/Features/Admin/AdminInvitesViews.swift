import SwiftUI
import UniformTypeIdentifiers

/// Приглашения: выданные списком, выдача по одному и массовый импорт из файла. Роли и
/// охват — по праву выдающего (`ALLOWED_ISSUERS`): платформа зовёт админов вузов, вуз —
/// сотрудников, деканат — преподавателей, старост и студентов своего факультета.
struct AdminInvitesView: View {
    @Environment(\.viewerRole) private var viewerRole

    @State private var scope: String?
    @State private var loader = PagedLoader<AdminInviteDTO>(limit: 30) { request in
        try await AdminAPI().invites(scope: nil, request: request)
    }
    @State private var creating = false
    @State private var importing = false
    @State private var preview: AdminBulkPreviewDTO?
    @State private var isParsing = false
    @State private var revoking: AdminInviteDTO?
    @State private var actionFailure: String?

    private var invitable: [String] { AdminRoles.invitable(by: viewerRole) }

    var body: some View {
        Group {
            if invitable.isEmpty {
                EmptyStateView(
                    title: String(localized: "admin.invites.cannot", defaultValue: "У вашей роли нет прав выдавать приглашения"),
                    symbol: "paperplane"
                )
            } else {
                list
            }
        }
        .navigationTitle(Text(AdminScreen.invites.title))
    }

    private var list: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: String(localized: "admin.invites.empty", defaultValue: "Приглашений пока нет"),
                symbol: "paperplane",
                hint: String(localized: "admin.invites.emptyHint", defaultValue: "Выдайте первое приглашение — ссылка придёт сразу"),
                actionTitle: String(localized: "admin.invites.create", defaultValue: "Выдать приглашение"),
                action: { creating = true }
            )
        ) {
            if viewerRole == .universityAdmin {
                FilterChipsRow(
                    options: [
                        (value: nil, title: String(localized: "admin.invites.scopeMine", defaultValue: "Мои")),
                        (value: Optional("university"), title: String(localized: "admin.invites.scopeUniversity", defaultValue: "Весь вуз")),
                    ],
                    selection: $scope
                )
            }
        } row: { invite in
            AdminInviteRow(invite: invite, showIssuer: scope == "university")
                .swipeActions {
                    if canRevoke(invite) {
                        Button(role: .destructive) {
                            revoking = invite
                        } label: {
                            Label(String(localized: "admin.invites.revoke", defaultValue: "Отозвать"), systemImage: "xmark.circle")
                        }
                    }
                }
                .contextMenu {
                    if canRevoke(invite) {
                        Button(role: .destructive) {
                            revoking = invite
                        } label: {
                            Label(String(localized: "admin.invites.revoke", defaultValue: "Отозвать"), systemImage: "xmark.circle")
                        }
                    }
                }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        creating = true
                    } label: {
                        Label(String(localized: "admin.invites.create", defaultValue: "Выдать приглашение"), systemImage: "plus")
                    }
                    // У файла импорта нет колонки вуза, а платформа приглашает именно админов
                    // вузов — каждая строка падала бы с «обязателен вуз».
                    if viewerRole != .platformAdmin {
                        Button {
                            importing = true
                        } label: {
                            Label(String(localized: "admin.invites.import", defaultValue: "Импорт из файла"), systemImage: "doc.badge.plus")
                        }
                    }
                } label: {
                    if isParsing {
                        ProgressView()
                    } else {
                        Image(systemName: "plus")
                    }
                }
                .accessibilityLabel(Text(String(localized: "admin.invites.create", defaultValue: "Выдать приглашение")))
            }
        }
        .onChange(of: scope) { _, value in
            Task {
                await loader.replace { request in
                    try await AdminAPI().invites(scope: value, request: request)
                }
            }
        }
        .sheet(isPresented: $creating) {
            AdminCreateInviteSheet(roles: invitable) { await loader.reload() }
        }
        .fileImporter(
            isPresented: $importing,
            allowedContentTypes: Self.importTypes,
            allowsMultipleSelection: false
        ) { result in
            Task { await parse(result) }
        }
        .sheet(isPresented: Binding(get: { preview != nil }, set: { if !$0 { preview = nil } })) {
            if let preview {
                AdminBulkPreviewSheet(preview: preview) { await loader.reload() }
            }
        }
        .confirmDestructive(
            $revoking,
            title: { _ in String(localized: "admin.invites.revokeConfirm", defaultValue: "Отозвать это приглашение?") },
            actionTitle: String(localized: "admin.invites.revoke", defaultValue: "Отозвать")
        ) { invite in
            await revoke(invite)
        }
        .actionFailureAlert($actionFailure)
    }

    private static let importTypes: [UTType] = [
        .commaSeparatedText,
        UTType(filenameExtension: "xlsx") ?? .spreadsheet,
        UTType(filenameExtension: "xls") ?? .spreadsheet,
    ]

    /// Отзывать можно только живое приглашение и только роль ниже своей.
    private func canRevoke(_ invite: AdminInviteDTO) -> Bool {
        invite.status == "PENDING" && AdminRoles.isHigher(viewerRole, than: invite.role)
    }

    @MainActor
    private func revoke(_ invite: AdminInviteDTO) async {
        do {
            try await AdminAPI().revokeInvite(id: invite.id)
            await loader.reload()
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func parse(_ result: Result<[URL], Error>) async {
        guard case .success(let urls) = result, let url = urls.first else {
            if case .failure(let error) = result { actionFailure = error.localizedDescription }
            return
        }
        isParsing = true
        defer { isParsing = false }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: url)
            preview = try await AdminAPI().bulkInvitePreview(file: data, filename: url.lastPathComponent)
        } catch {
            actionFailure = error.userMessage
        }
    }
}

struct AdminInviteRow: View {
    let invite: AdminInviteDTO
    var showIssuer = false

    var body: some View {
        let status = AdminText.inviteStatus(invite.status)
        ListCardRow(
            title: AdminRoles.title(invite.role),
            subtitle: invite.email ?? String(localized: "admin.invites.noEmail", defaultValue: "Без адреса — по ссылке"),
            status: (text: status.text, tint: status.tint),
            lines: [
                invite.expiresAt.map { String(localized: "admin.invites.expires", defaultValue: "Действует до \(DisplayFormat.date($0))") } ?? "",
                invite.createdAt.map { String(localized: "admin.invites.created", defaultValue: "Создано \(DisplayFormat.date($0))") } ?? "",
                showIssuer ? invite.createdBy.map { String(localized: "admin.invites.issuedBy", defaultValue: "Выдал: \($0.name)") } ?? "" : "",
            ]
        )
    }
}

// MARK: - Выдача приглашения

/// Выдача приглашения. После создания лист не закрывается, а показывает ссылку: токен
/// приходит ровно один раз, и закрыть окно, не передав ссылку, — выдать приглашение впустую.
struct AdminCreateInviteSheet: View {
    let roles: [String]
    /// Вуз задан заранее — приглашение администратора из карточки вуза.
    var presetUniversity: AdminPickItem?
    let created: () async -> Void

    @Environment(\.viewerRole) private var viewerRole
    @Environment(\.dismiss) private var dismiss

    @State private var role: String = ""
    @State private var email = ""
    @State private var university: AdminPickItem?
    @State private var faculty: AdminNamedRefDTO?
    @State private var group: AdminPickItem?
    @State private var faculties: [AdminNamedRefDTO] = []
    @State private var failure: String?
    @State private var isSaving = false
    @State private var link: String?

    private var needsUniversity: Bool { role == "UNIVERSITY_ADMIN" }
    /// Декан выдаёт в свой факультет — его выводит сервер из токена.
    private var needsFaculty: Bool { (role == "DEAN" || role == "TEACHER") && viewerRole != .dean }
    private var needsGroup: Bool { role == "STUDENT" || role == "STAROSTA" }

    private var emailValid: Bool {
        let trimmed = email.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty || (trimmed.contains("@") && trimmed.contains(".") && !trimmed.contains(" "))
    }

    private var canSave: Bool {
        !role.isEmpty && emailValid
            && (!needsUniversity || university != nil)
            && (role != "DEAN" || viewerRole == .dean || faculty != nil)
            && (!needsGroup || group != nil)
    }

    var body: some View {
        NavigationStack {
            Form {
                if let link {
                    AdminInviteLinkSection(link: link)
                } else {
                    form
                }
            }
            .navigationTitle(Text(link == nil
                ? String(localized: "admin.invites.createTitle", defaultValue: "Выдать приглашение")
                : String(localized: "admin.invites.createdTitle", defaultValue: "Приглашение создано")))
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(isSaving)
            .toolbar {
                if link == nil {
                    ToolbarItem(placement: .cancellationAction) {
                        SheetCloseButton { dismiss() }
                            .disabled(isSaving)
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        if isSaving {
                            ProgressView()
                        } else {
                            Button(String(localized: "admin.invites.createShort", defaultValue: "Создать")) {
                                Task { await save() }
                            }
                            .disabled(!canSave)
                        }
                    }
                } else {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(String(localized: "admin.invites.done", defaultValue: "Готово")) { dismiss() }
                    }
                }
            }
            .task {
                if roles.count == 1 { role = roles[0] }
                if let presetUniversity, university == nil { university = presetUniversity }
                if viewerRole != .dean, let list = try? await AdminAPI().faculties() { faculties = list }
            }
        }
    }

    @ViewBuilder
    private var form: some View {
        if let failure {
            FormAlert(message: failure)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
        }
        Section {
            Picker(String(localized: "admin.invites.role", defaultValue: "Роль"), selection: $role) {
                Text(String(localized: "admin.invites.selectRole", defaultValue: "Выберите роль")).tag("")
                ForEach(roles, id: \.self) { Text(AdminRoles.title($0)).tag($0) }
            }
            TextField(String(localized: "admin.invites.email", defaultValue: "Email (необязательно)"), text: $email)
                .keyboardType(.emailAddress)
                .textContentType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        } footer: {
            if !emailValid {
                Text(String(localized: "admin.invites.emailInvalid", defaultValue: "Проверьте адрес — похоже, в нём опечатка"))
                    .foregroundStyle(Palette.destructive)
            } else {
                Text(String(localized: "admin.invites.emailHint", defaultValue: "С адресом письмо уйдёт само; без него передайте ссылку человеку."))
            }
        }

        if needsUniversity || needsFaculty || needsGroup {
            Section {
                if needsUniversity {
                    NavigationLink {
                        AdminSearchPicker(
                            title: String(localized: "admin.invites.university", defaultValue: "Университет"),
                            selection: $university
                        ) { needle in
                            try await AdminAPI().universities(
                                search: needle.isEmpty ? nil : needle,
                                request: PageRequest(cursor: nil, page: 1, limit: 30)
                            ).items.map { AdminPickItem(id: $0.id, title: $0.name, subtitle: $0.shortName) }
                        }
                    } label: {
                        LabeledContent(
                            String(localized: "admin.invites.university", defaultValue: "Университет"),
                            value: university?.title ?? String(localized: "admin.invites.selectUniversity", defaultValue: "Выберите")
                        )
                    }
                }
                if needsFaculty {
                    Picker(String(localized: "admin.invites.faculty", defaultValue: "Факультет"), selection: $faculty) {
                        Text(String(localized: "admin.invites.noFaculty", defaultValue: "Не выбран")).tag(AdminNamedRefDTO?.none)
                        ForEach(faculties) { Text(verbatim: $0.name).tag(Optional($0)) }
                    }
                }
                if needsGroup {
                    NavigationLink {
                        AdminSearchPicker(
                            title: String(localized: "admin.invites.group", defaultValue: "Группа"),
                            selection: $group
                        ) { needle in
                            try await AdminAPI().groups(search: needle.isEmpty ? nil : String(needle.prefix(100)))
                                .map { AdminPickItem(id: $0.id, title: $0.name, subtitle: $0.year.map { String($0) }) }
                        }
                    } label: {
                        LabeledContent(
                            String(localized: "admin.invites.group", defaultValue: "Группа"),
                            value: group?.title ?? String(localized: "admin.invites.selectGroup", defaultValue: "Выберите")
                        )
                    }
                }
            } footer: {
                if role == "TEACHER" && needsFaculty {
                    Text(String(localized: "admin.invites.teacherFaculty", defaultValue: "Факультет преподавателя — по желанию."))
                }
            }
        }
    }

    @MainActor
    private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            let invite = try await AdminAPI().createInvite(
                role: role,
                email: email,
                universityID: needsUniversity ? university?.id : nil,
                facultyID: needsFaculty ? faculty?.id : nil,
                groupID: needsGroup ? group?.id : nil
            )
            link = AdminInviteLink.url(token: invite.token)
            failure = nil
            await created()
        } catch {
            failure = error.userMessage
        }
    }
}

// MARK: - Выбор из длинного списка

/// Пункт выбора с поиском на сервере: вуз, группа, человек.
struct AdminPickItem: Identifiable, Hashable {
    let id: String
    let title: String
    var subtitle: String?
}

/// Выбор из списка, который целиком не загрузить: вузов и групп больше страницы, поэтому
/// ищет сервер.
struct AdminSearchPicker: View {
    let title: String
    @Binding var selection: AdminPickItem?
    let search: (String) async throws -> [AdminPickItem]

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var items: [AdminPickItem]?
    @State private var failure: String?

    var body: some View {
        List {
            if let items {
                if items.isEmpty {
                    EmptyStateView(
                        title: String(localized: "admin.picker.nothing", defaultValue: "Ничего не нашлось"),
                        symbol: "magnifyingglass"
                    )
                    .listRowBackground(Color.clear)
                }
                ForEach(items) { item in
                    Button {
                        selection = item
                        dismiss()
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(verbatim: item.title).foregroundStyle(Palette.foreground)
                                if let subtitle = item.subtitle, !subtitle.isEmpty {
                                    Text(verbatim: subtitle)
                                        .font(Typography.meta)
                                        .foregroundStyle(Palette.mutedForeground)
                                }
                            }
                            Spacer()
                            if selection?.id == item.id {
                                Image(systemName: "checkmark").foregroundStyle(Palette.primary)
                            }
                        }
                    }
                }
            } else if let failure {
                ErrorStateView(message: failure) { await run(query) }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(title))
        .navigationBarTitleDisplayMode(.inline)
        .debouncedSearch($query, prompt: String(localized: "admin.picker.search", defaultValue: "Поиск")) { needle in
            await run(needle)
        }
        .task { if items == nil { await run("") } }
    }

    @MainActor
    private func run(_ needle: String) async {
        do {
            items = try await search(needle)
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
        }
    }
}

// MARK: - Массовый импорт

/// Предпросмотр файла: сервер разобрал строки и проверил их без записи. Создаются только
/// готовые; дубли и ошибки показаны, чтобы поправить файл.
private struct AdminBulkPreviewSheet: View {
    let preview: AdminBulkPreviewDTO
    let created: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var isSaving = false
    @State private var failure: String?
    @State private var result: AdminBulkResultDTO?

    private var ready: [AdminBulkPreviewDTO.Row] { preview.rows.filter { $0.status == "READY" } }

    var body: some View {
        NavigationStack {
            List {
                if let failure {
                    FormAlert(message: failure)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                if let result {
                    Section {
                        Label(
                            String(localized: "admin.bulk.done", defaultValue: "Создано \(result.created.formatted()), пропущено \(result.skipped.formatted()), ошибок \(result.failed.formatted())"),
                            systemImage: "checkmark.circle"
                        )
                        .foregroundStyle(Palette.success)
                    }
                }
                Section {
                    Text(String(localized: "admin.bulk.summary", defaultValue: "Всего \(preview.summary.total.formatted()): готово \(preview.summary.ready.formatted()), дублей \(preview.summary.duplicate.formatted()), ошибок \(preview.summary.error.formatted())"))
                        .font(Typography.body)
                        .foregroundStyle(Palette.foreground)
                }

                Section {
                    ForEach(preview.rows) { row in
                        AdminBulkRow(row: row)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(Text(String(localized: "admin.bulk.title", defaultValue: "Импорт приглашений")))
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(isSaving)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(result == nil ? String(localized: "common.cancel", defaultValue: "Отмена") : AdminText.close) { dismiss() }
                        .disabled(isSaving)
                }
                if result == nil {
                    ToolbarItem(placement: .confirmationAction) {
                        if isSaving {
                            ProgressView()
                        } else {
                            Button(String(localized: "admin.bulk.confirm", defaultValue: "Создать (\(ready.count.formatted()))")) {
                                Task { await commit() }
                            }
                            .disabled(ready.isEmpty)
                        }
                    }
                }
            }
        }
    }

    @MainActor
    private func commit() async {
        isSaving = true
        defer { isSaving = false }
        do {
            result = try await AdminAPI().bulkInviteCreate(rows: ready)
            failure = nil
            await created()
        } catch {
            failure = error.userMessage
        }
    }
}

private struct AdminBulkRow: View {
    let row: AdminBulkPreviewDTO.Row

    var body: some View {
        let status: (String, Color) = {
            switch row.status {
            case "READY": return (String(localized: "admin.bulk.ready", defaultValue: "Готово"), Palette.success)
            case "DUPLICATE": return (String(localized: "admin.bulk.duplicate", defaultValue: "Дубль"), Palette.warning)
            default: return (String(localized: "admin.bulk.error", defaultValue: "Ошибка"), Palette.destructive)
            }
        }()
        ListCardRow(
            title: row.email.isEmpty ? "—" : row.email,
            subtitle: [
                String(localized: "admin.bulk.line", defaultValue: "Стр. \(row.line.formatted())"),
                AdminRoles.title(row.role),
                [row.groupName, row.facultyName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "),
            ].filter { !$0.isEmpty }.joined(separator: " · "),
            status: (text: status.0, tint: status.1),
            lines: [
                row.status == "DUPLICATE"
                    ? String(localized: "admin.bulk.duplicateReason", defaultValue: "Уже приглашён или зарегистрирован")
                    : (row.error ?? ""),
            ]
        )
    }
}
