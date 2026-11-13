import SwiftUI
import UniformTypeIdentifiers

/// Приглашения одногруппников: выданные (статус, срок), новое приглашение со
/// ссылкой, отзыв, массовый импорт из CSV/XLSX. Староста приглашает только
/// студентов в свою группу.
struct StarostaInvitesView: View {
    @Environment(ViewerProfileModel.self) private var viewer

    @State private var loader = PagedLoader<StarostaInviteDTO>(limit: 20) { request in
        try await StarostaAPI().invites(request)
    }
    @State private var creating = false
    @State private var created: StarostaCreatedInviteDTO?
    @State private var revoking: StarostaInviteDTO?
    @State private var importing = false
    @State private var preview: StarostaBulkPreview?
    @State private var isChecking = false
    @State private var actionFailure: String?
    @State private var bulkResult: String?

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: String(localized: "starosta.invites.empty", defaultValue: "Приглашений пока нет"),
                symbol: "paperplane",
                hint: String(localized: "starosta.invites.empty.hint", defaultValue: "Пригласите одногруппника — он зарегистрируется по ссылке и сразу попадёт в группу."),
                actionTitle: String(localized: "starosta.invites.create", defaultValue: "Создать приглашение"),
                action: { creating = true }
            )
        ) { invite in
            StarostaInviteRow(invite: invite)
                .swipeActions {
                    if invite.status == "PENDING" {
                        Button(role: .destructive) {
                            revoking = invite
                        } label: {
                            Label(String(localized: "starosta.invites.revoke", defaultValue: "Отозвать"), systemImage: "xmark.circle")
                        }
                    }
                }
                .contextMenu {
                    if invite.status == "PENDING" {
                        Button(role: .destructive) {
                            revoking = invite
                        } label: {
                            Label(String(localized: "starosta.invites.revoke", defaultValue: "Отозвать"), systemImage: "xmark.circle")
                        }
                    }
                }
        }
        .navigationTitle(Text(StarostaScreen.invites.title))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if isChecking {
                    ProgressView()
                } else {
                    Button {
                        importing = true
                    } label: {
                        Image(systemName: "doc.badge.plus")
                    }
                    .accessibilityLabel(Text(String(localized: "starosta.invites.bulk", defaultValue: "Импорт из файла")))
                }
            }
        }
        .floatingAction(String(localized: "starosta.invites.create", defaultValue: "Создать приглашение")) {
            creating = true
        }
        .sheet(isPresented: $creating) {
            StarostaInviteForm(groupID: viewer.profile?.groupId) { invite in
                created = invite
                await loader.reload()
            }
        }
        .sheet(item: $created) { invite in
            StarostaInviteLinkView(invite: invite)
        }
        .sheet(item: $preview) { preview in
            StarostaBulkPreviewView(preview: preview.value) { result in
                if let result {
                    bulkResult = String(
                        localized: "starosta.invites.bulk.done",
                        defaultValue: "Создано \(result.created.formatted()), пропущено \(result.skipped.formatted()), ошибок \(result.failed.formatted())"
                    )
                }
                await loader.reload()
            }
        }
        .fileImporter(
            isPresented: $importing,
            allowedContentTypes: [.commaSeparatedText, UTType(filenameExtension: "xlsx") ?? .spreadsheet]
        ) { result in
            Task { await check(result) }
        }
        .confirmDestructive(
            $revoking,
            title: { _ in String(localized: "starosta.invites.revoke.confirm", defaultValue: "Отозвать это приглашение?") },
            actionTitle: String(localized: "starosta.invites.revoke", defaultValue: "Отозвать")
        ) { invite in
            do {
                try await StarostaAPI().revokeInvite(id: invite.id)
            } catch {
                actionFailure = error.userMessage
            }
            await loader.reload()
        }
        .actionFailureAlert($actionFailure)
        .alert(
            String(localized: "starosta.invites.bulk.title", defaultValue: "Массовый импорт приглашений"),
            isPresented: Binding(get: { bulkResult != nil }, set: { if !$0 { bulkResult = nil } })
        ) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        } message: {
            Text(bulkResult ?? "")
        }
        .task { if viewer.profile == nil { await viewer.refresh() } }
    }

    @MainActor
    private func check(_ result: Result<URL, Error>) async {
        isChecking = true
        defer { isChecking = false }
        do {
            let url = try result.get()
            let data = try await PickedFile.read(url)
            let mime = url.pathExtension.lowercased() == "csv"
                ? "text/csv"
                : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            let value = try await StarostaAPI().bulkPreview(data: data, filename: url.lastPathComponent, mime: mime)
            preview = StarostaBulkPreview(value: value)
        } catch {
            actionFailure = error.userMessage
        }
    }
}

private struct StarostaBulkPreview: Identifiable {
    let id = UUID()
    let value: StarostaBulkPreviewDTO
}

private struct StarostaInviteRow: View {
    let invite: StarostaInviteDTO

    var body: some View {
        let status = Self.status(invite.status)
        let pending = invite.status == "PENDING"
        let tint: Color = pending ? TileTint.blue : (invite.status == "USED" ? TileTint.green : Color.gray)
        TelegramStyleRow(
            title: invite.email ?? String(localized: "starosta.invites.noEmail", defaultValue: "Без адреса — по ссылке"),
            subtitle: String(localized: "starosta.invites.expires", defaultValue: "Действует до \(DisplayFormat.date(invite.expiresAt))"),
            meta: DisplayFormat.date(invite.createdAt)
        ) {
            RowSymbol(symbol: invite.email == nil ? "link" : "envelope.fill", tint: tint)
        } accessory: {
            StatusBadge(text: status.text, tint: status.tint)
        }
    }

    static func status(_ raw: String) -> (text: String, tint: Color) {
        switch raw {
        case "PENDING": return (String(localized: "starosta.invites.status.pending", defaultValue: "Ожидает"), Palette.info)
        case "USED": return (String(localized: "starosta.invites.status.used", defaultValue: "Использовано"), Palette.success)
        case "EXPIRED": return (String(localized: "starosta.invites.status.expired", defaultValue: "Истекло"), Palette.mutedForeground)
        case "REVOKED": return (String(localized: "starosta.invites.status.revoked", defaultValue: "Отозвано"), Palette.mutedForeground)
        default: return (raw, Palette.mutedForeground)
        }
    }
}

/// Новое приглашение: роль — студент, группа — своя. Адрес необязателен: без него
/// ссылку староста отправит сам.
private struct StarostaInviteForm: View {
    let groupID: String?
    let created: (StarostaCreatedInviteDTO) async -> Void

    @State private var email = ""
    @State private var result: StarostaCreatedInviteDTO?

    var body: some View {
        FormSheet(
            title: String(localized: "starosta.invites.createTitle", defaultValue: "Выдать приглашение"),
            saveTitle: String(localized: "starosta.invites.createShort", defaultValue: "Создать"),
            canSave: groupID != nil && isEmailValid,
            save: save,
            saved: {
                if let result { await created(result) }
            }
        ) {
            Section {
                DetailRow(title: String(localized: "starosta.invites.role", defaultValue: "Роль"), value: String(localized: "starosta.role.student", defaultValue: "Студент"))
                TextField(String(localized: "starosta.invites.email", defaultValue: "Email (необязательно)"), text: $email)
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            } footer: {
                if groupID == nil {
                    Text(String(localized: "starosta.group.none", defaultValue: "Вы не привязаны к группе"))
                } else if !isEmailValid {
                    Text(String(localized: "starosta.invites.emailInvalid", defaultValue: "Проверьте адрес — похоже, в нём опечатка"))
                        .foregroundStyle(Palette.destructive)
                } else {
                    Text(String(localized: "starosta.invites.footer", defaultValue: "С адресом приглашение придёт письмом. Ссылку покажем один раз — скопируйте её сразу."))
                }
            }
        }
    }

    private var trimmed: String { email.trimmingCharacters(in: .whitespaces).lowercased() }

    private var isEmailValid: Bool {
        guard !trimmed.isEmpty else { return true }
        let parts = trimmed.split(separator: "@")
        return parts.count == 2 && parts[1].contains(".") && !trimmed.contains(" ")
    }

    @MainActor
    private func save() async throws {
        guard let groupID else { return }
        result = try await StarostaAPI().createInvite(email: trimmed.isEmpty ? nil : trimmed, groupID: groupID)
    }
}

/// Ссылка-приглашение. Токен приходит ровно один раз — в списке его уже нет.
private struct StarostaInviteLinkView: View {
    let invite: StarostaCreatedInviteDTO

    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    private var link: String {
        if let base = AppConfiguration.webBaseURL {
            var components = URLComponents(url: base.appendingPathComponent("register"), resolvingAgainstBaseURL: false)
            components?.queryItems = [URLQueryItem(name: "token", value: invite.token)]
            if let url = components?.url { return url.absoluteString }
        }
        return invite.token
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(link)
                        .font(.callout.monospaced())
                        .textSelection(.enabled)
                } footer: {
                    Text(String(localized: "starosta.invites.linkHint", defaultValue: "Ссылка показывается один раз — скопируйте её сейчас"))
                }
                Section {
                    Button {
                        UIPasteboard.general.string = link
                        copied = true
                    } label: {
                        Label(
                            copied
                                ? String(localized: "starosta.invites.copied", defaultValue: "Ссылка скопирована")
                                : String(localized: "starosta.invites.copy", defaultValue: "Копировать ссылку"),
                            systemImage: copied ? "checkmark" : "doc.on.doc"
                        )
                    }
                    ShareLink(item: link) {
                        Label(String(localized: "starosta.invites.share", defaultValue: "Отправить"), systemImage: "square.and.arrow.up")
                    }
                    DetailRow(
                        title: String(localized: "starosta.invites.expiresTitle", defaultValue: "Действует до"),
                        value: DisplayFormat.dateTime(invite.expiresAt)
                    )
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(Text(String(localized: "starosta.invites.linkTitle", defaultValue: "Ссылка-приглашение")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "starosta.invites.done", defaultValue: "Готово")) { dismiss() }
                }
            }
        }
    }
}

/// Проверка файла импорта: строки со статусами и сводка. Создаются только готовые.
private struct StarostaBulkPreviewView: View {
    let preview: StarostaBulkPreviewDTO
    let done: (StarostaBulkResultDTO?) async -> Void

    @State private var result: StarostaBulkResultDTO?

    private var ready: [StarostaBulkPreviewDTO.Row] { preview.rows.filter { $0.status == "READY" } }

    var body: some View {
        FormSheet(
            title: String(localized: "starosta.invites.bulk.title", defaultValue: "Массовый импорт приглашений"),
            saveTitle: String(localized: "starosta.invites.bulk.confirm", defaultValue: "Создать (\(ready.count.formatted()))"),
            canSave: !ready.isEmpty && result == nil,
            save: {
                result = try await StarostaAPI().bulkCreate(rows: ready)
            },
            saved: { await done(result) }
        ) {
            Section {
                Text(String(
                    localized: "starosta.invites.bulk.summary",
                    defaultValue: "Всего \(preview.summary.total.formatted()): готово \(preview.summary.ready.formatted()), дублей \(preview.summary.duplicate.formatted()), ошибок \(preview.summary.error.formatted())"
                ))
                if ready.isEmpty {
                    Text(String(localized: "starosta.invites.bulk.nothing", defaultValue: "Нет строк, готовых к созданию"))
                        .foregroundStyle(Palette.destructive)
                }
            } footer: {
                Text(String(localized: "starosta.invites.bulk.hint", defaultValue: "Первая строка файла — заголовки, обязательна колонка «email». Приглашения создаются для студентов вашей группы."))
            }
            Section {
                ForEach(preview.rows) { row in
                    let badge = Self.status(row.status)
                    ListCardRow(
                        title: row.email,
                        subtitle: String(localized: "starosta.invites.bulk.line", defaultValue: "Строка \(row.line.formatted())"),
                        status: (badge.text, badge.tint),
                        lines: [row.status == "DUPLICATE" ? String(localized: "starosta.invites.bulk.duplicate", defaultValue: "Уже приглашён или зарегистрирован") : (row.error ?? "")]
                    )
                }
            }
        }
    }

    static func status(_ raw: String) -> (text: String, tint: Color) {
        switch raw {
        case "READY": return (String(localized: "starosta.invites.bulk.ready", defaultValue: "Готово"), Palette.success)
        case "DUPLICATE": return (String(localized: "starosta.invites.bulk.dup", defaultValue: "Дубль"), Palette.warning)
        default: return (String(localized: "starosta.invites.bulk.error", defaultValue: "Ошибка"), Palette.destructive)
        }
    }
}
