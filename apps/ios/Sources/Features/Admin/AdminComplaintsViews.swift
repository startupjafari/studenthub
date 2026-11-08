import SwiftUI

/// Очередь жалоб: статус вкладками, приоритет — меню. Сервер сам режет по охвату роли:
/// модератор и админ вуза видят свой вуз, платформа — все.
struct AdminComplaintsView: View {
    @State private var status: String? = "PENDING"
    @State private var priority: String?
    @State private var loader = PagedLoader<AdminComplaintDTO>(limit: 30) { request in
        try await AdminAPI().complaints(status: "PENDING", priority: nil, request: request)
    }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: String(localized: "admin.complaints.empty", defaultValue: "Жалоб нет"),
                symbol: "checkmark.shield"
            )
        ) {
            FilterChipsRow(
                options: AdminText.complaintStatuses.map { (value: Optional($0), title: AdminText.complaintStatus($0).text) }
                    + [(value: nil, title: AdminText.all)],
                selection: $status
            )
        } row: { complaint in
            NavigationLink(value: AppRoute.admin(.complaint(id: complaint.id))) {
                AdminComplaintRow(complaint: complaint)
            }
        }
        .navigationTitle(Text(AdminScreen.complaints.title))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker(String(localized: "admin.complaints.priority", defaultValue: "Приоритет"), selection: $priority) {
                        Text(String(localized: "admin.complaints.anyPriority", defaultValue: "Любой приоритет")).tag(String?.none)
                        ForEach(AdminText.priorities, id: \.self) { value in
                            Text(AdminText.priority(value).text).tag(Optional(value))
                        }
                    }
                } label: {
                    Image(systemName: priority == nil
                        ? "line.3.horizontal.decrease.circle"
                        : "line.3.horizontal.decrease.circle.fill")
                }
                .accessibilityLabel(Text(String(localized: "admin.complaints.priority", defaultValue: "Приоритет")))
            }
        }
        .onChange(of: status) { _, _ in Task { await refilter() } }
        .onChange(of: priority) { _, _ in Task { await refilter() } }
        // Очередь меняется, пока модератор разбирает жалобу: по возвращении — свежая.
        .onAppear { if loader.isLoaded { Task { await loader.reload() } } }
    }

    private func refilter() async {
        let status = status
        let priority = priority
        await loader.replace { request in
            try await AdminAPI().complaints(status: status, priority: priority, request: request)
        }
    }
}

struct AdminComplaintRow: View {
    let complaint: AdminComplaintDTO

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(spacing: Spacing.sm) {
                let priority = AdminText.priority(complaint.effectivePriority)
                StatusBadge(text: priority.text, tint: priority.tint)
                Text(AdminText.target(complaint.targetType))
                    .font(Typography.meta.weight(.medium))
                    .foregroundStyle(Palette.foreground)
                Spacer(minLength: Spacing.md)
                let status = AdminText.complaintStatus(complaint.status)
                StatusBadge(text: status.text, tint: status.tint)
            }
            if let reason = complaint.reason, !reason.isEmpty {
                Text(reason)
                    .font(Typography.body)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(3)
            }
            Text(verbatim: [complaint.reporter?.name, DisplayFormat.dateTime(complaint.createdAt)]
                .compactMap { $0 }
                .joined(separator: " · "))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
        }
        .padding(.vertical, Spacing.xs)
        .accessibilityElement(children: .combine)
    }
}

/// Разбор жалобы: что обжаловано, кто жалуется, решение. Меры идут от мягкой к жёсткой —
/// модератор останавливается на первой достаточной; жёсткие спрашивают подтверждение.
struct AdminComplaintView: View {
    let id: String

    @Environment(\.viewerRole) private var role
    @Environment(\.viewerID) private var viewerID
    @Environment(\.dismiss) private var dismiss

    @State private var complaint: AdminComplaintDTO?
    @State private var failure: String?
    @State private var isOffline = false
    @State private var actionFailure: String?
    @State private var isWorking = false

    @State private var decision: String?
    @State private var blockDays = 0
    @State private var comment = ""
    @State private var applyToDuplicates = false
    @State private var confirming: String?

    @State private var showChat = false
    @State private var messages: [AdminComplaintMessageDTO]?
    @State private var messagesFailure: String?

    private let api = AdminAPI()

    var body: some View {
        Group {
            if let complaint {
                content(complaint)
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .background(Palette.background)
        .navigationTitle(Text(AdminScreen.complaint(id: id).title))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .actionFailureAlert($actionFailure)
        .confirmationDialog(
            confirming.map(confirmTitle) ?? "",
            isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
            titleVisibility: .visible,
            presenting: confirming
        ) { action in
            Button(decisionTitle(action), role: action == "WARN_USER" ? nil : .destructive) {
                Task { await resolve(action) }
            }
        }
    }

    // MARK: Содержимое

    private func content(_ complaint: AdminComplaintDTO) -> some View {
        let reviewer = complaint.reviewingBy
        let takenByOther = reviewer != nil && reviewer?.id != viewerID
        return List {
            Section {
                HStack(spacing: Spacing.sm) {
                    let priority = AdminText.priority(complaint.effectivePriority)
                    StatusBadge(text: priority.text, tint: priority.tint)
                    StatusBadge(text: AdminText.target(complaint.targetType), tint: Palette.primary)
                    Spacer(minLength: Spacing.md)
                    let status = AdminText.complaintStatus(complaint.status)
                    StatusBadge(text: status.text, tint: status.tint)
                }
                if let reason = complaint.reason, !reason.isEmpty {
                    Text(reason)
                        .font(Typography.body)
                        .foregroundStyle(Palette.foreground)
                        .textSelection(.enabled)
                }
            }

            Section {
                if let reporter = complaint.reporter {
                    AdminLinkRow(
                        title: String(localized: "admin.complaint.reporter", defaultValue: "Автор жалобы"),
                        value: reporter.name,
                        route: reporter.profileRoute
                    )
                }
                DetailRow(
                    title: String(localized: "admin.complaint.date", defaultValue: "Дата"),
                    value: DisplayFormat.dateTime(complaint.createdAt)
                )
                if let reports = complaint.targetReports, reports > 1 {
                    DetailRow(
                        title: String(localized: "admin.complaint.reports", defaultValue: "Жалоб от разных людей"),
                        value: reports.formatted()
                    )
                }
                if complaint.isOpen {
                    DetailRow(
                        title: String(localized: "admin.complaint.reviewingBy", defaultValue: "Разбирает"),
                        value: reviewer?.name ?? String(localized: "admin.complaint.nobody", defaultValue: "Никто")
                    )
                } else {
                    if let resolver = complaint.resolvedBy {
                        AdminLinkRow(
                            title: String(localized: "admin.complaint.resolvedBy", defaultValue: "Обработал"),
                            value: resolver.name,
                            route: resolver.profileRoute
                        )
                    }
                    DetailRow(
                        title: String(localized: "admin.complaint.resolution", defaultValue: "Решение"),
                        value: complaint.resolution ?? "—"
                    )
                }
            }

            targetSection(complaint)

            if complaint.targetType == "MESSAGE" {
                chatSection(complaint)
            }

            if complaint.isOpen && !takenByOther {
                decisionSection(complaint)
            }

            Section {
                if complaint.isOpen && takenByOther {
                    Text(String(localized: "admin.complaint.takenByOther", defaultValue: "Жалобу разбирает другой модератор — решение за ним."))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
                if complaint.isOpen && reviewer == nil {
                    Button {
                        Task { await take() }
                    } label: {
                        Label(String(localized: "admin.complaint.take", defaultValue: "Взять в разбор"), systemImage: "hand.raised")
                    }
                    .disabled(isWorking)
                }
                if !complaint.isOpen {
                    Button {
                        Task { await reopen() }
                    } label: {
                        Label(String(localized: "admin.complaint.reopen", defaultValue: "Вернуть в очередь"), systemImage: "arrow.uturn.backward")
                    }
                    .disabled(isWorking)
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await load() }
    }

    @ViewBuilder
    private func targetSection(_ complaint: AdminComplaintDTO) -> some View {
        let hasPreview = complaint.targetType != "MESSAGE" && complaint.targetType != "USER"
        Section {
            if hasPreview {
                if let preview = complaint.targetPreview {
                    if preview.deleted == true {
                        Label(
                            String(localized: "admin.complaint.targetDeleted", defaultValue: "Автор уже удалил это — текст сохранён для разбора."),
                            systemImage: "trash"
                        )
                        .font(Typography.meta)
                        .foregroundStyle(Palette.warning)
                    }
                    if let title = preview.title, !title.isEmpty {
                        Text(title).font(Typography.cardTitle).foregroundStyle(Palette.foreground)
                    }
                    if let text = preview.text, !text.isEmpty {
                        Text(text)
                            .font(Typography.body)
                            .foregroundStyle(Palette.foreground)
                            .textSelection(.enabled)
                    }
                    if let media = preview.mediaCount, media > 0 {
                        Label(
                            String(localized: "admin.complaint.targetMedia", defaultValue: "Вложений: \(media.formatted())"),
                            systemImage: "photo.on.rectangle"
                        )
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                    }
                } else {
                    Text(String(localized: "admin.complaint.targetGone", defaultValue: "Содержимое недоступно — его уже сняли."))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
                if complaint.targetType == "POST", complaint.targetPreview?.deleted != true, complaint.targetPreview != nil {
                    NavigationLink(value: AppRoute.post(id: complaint.targetId)) {
                        Label(String(localized: "admin.complaint.openPost", defaultValue: "Открыть пост"), systemImage: "newspaper")
                    }
                }
            }
            if complaint.targetType == "USER" {
                NavigationLink(value: AppRoute.admin(.user(id: complaint.targetId))) {
                    Label(String(localized: "admin.complaint.openUser", defaultValue: "Карточка пользователя"), systemImage: "person.crop.rectangle")
                }
                NavigationLink(value: AppRoute.profile(id: complaint.targetId)) {
                    Label(String(localized: "admin.complaint.openProfile", defaultValue: "Профиль"), systemImage: "person")
                }
            } else if let owner = complaint.targetOwnerId {
                // Решение принимают про человека: заблокировать — значит его, а не пост.
                NavigationLink(value: AppRoute.admin(.user(id: owner))) {
                    Label(String(localized: "admin.complaint.openOwner", defaultValue: "Карточка автора"), systemImage: "person.crop.rectangle")
                }
            }
        } header: {
            Text(String(localized: "admin.complaint.targetTitle", defaultValue: "Что обжаловано"))
        }
    }

    @ViewBuilder
    private func chatSection(_ complaint: AdminComplaintDTO) -> some View {
        // Админу вуза открыты только официальные чаты: личную переписку по жалобе читают
        // модераторы и платформа (сервер ответит 403 и так).
        let canRead = role != .universityAdmin
        Section {
            if canRead {
                Button {
                    showChat.toggle()
                    if showChat && messages == nil { Task { await loadMessages() } }
                } label: {
                    Label(
                        showChat
                            ? String(localized: "admin.complaint.hideChat", defaultValue: "Скрыть переписку")
                            : String(localized: "admin.complaint.showChat", defaultValue: "Показать переписку"),
                        systemImage: "bubble.left.and.bubble.right"
                    )
                }
                if showChat {
                    if let messages {
                        if messages.isEmpty {
                            Text(String(localized: "admin.complaint.chatEmpty", defaultValue: "Сообщений в переписке нет"))
                                .font(Typography.meta)
                                .foregroundStyle(Palette.mutedForeground)
                        }
                        ForEach(messages) { message in
                            AdminTranscriptRow(
                                message: message,
                                isTarget: message.id == complaint.targetId,
                                isReporter: message.senderId == complaint.reporter?.id
                            )
                        }
                    } else if let messagesFailure {
                        Text(messagesFailure)
                            .font(Typography.meta)
                            .foregroundStyle(Palette.destructive)
                    } else {
                        ProgressView()
                    }
                }
            } else {
                Text(String(localized: "admin.complaint.chatModeratorsOnly", defaultValue: "Переписку по жалобе читают модераторы: администратору вуза открыты только официальные чаты."))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            }
        } header: {
            Text(String(localized: "admin.complaint.chatTitle", defaultValue: "Переписка"))
        } footer: {
            if canRead {
                Text(String(localized: "admin.complaint.chatAudit", defaultValue: "Открытие переписки записывается в журнал аудита"))
            }
        }
    }

    private func decisionSection(_ complaint: AdminComplaintDTO) -> some View {
        let decisions = ["DISMISS", "WARN_USER", "DELETE_CONTENT", "BLOCK_USER"]
            .filter { !($0 == "DELETE_CONTENT" && complaint.targetType == "USER") }
        return Section {
            ForEach(decisions, id: \.self) { action in
                Button {
                    decision = action
                } label: {
                    HStack(alignment: .top, spacing: Spacing.md) {
                        Image(systemName: decision == action ? "largecircle.fill.circle" : "circle")
                            .foregroundStyle(isSevere(action) ? Palette.destructive : Palette.primary)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(decisionTitle(action))
                                .font(Typography.body)
                                .foregroundStyle(Palette.foreground)
                            Text(decisionHint(action))
                                .font(Typography.meta)
                                .foregroundStyle(Palette.mutedForeground)
                        }
                        Spacer(minLength: 0)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(decision == action ? .isSelected : [])
            }
            if decision == "BLOCK_USER" {
                Picker(String(localized: "admin.block.term", defaultValue: "Срок блокировки"), selection: $blockDays) {
                    ForEach(AdminText.blockTerms, id: \.self) { Text(AdminText.blockTerm($0)).tag($0) }
                }
            }
            TextField(
                String(localized: "admin.complaint.commentPlaceholder", defaultValue: "Комментарий к решению (необязательно)"),
                text: $comment,
                axis: .vertical
            )
            .lineLimit(1...4)
            Toggle(String(localized: "admin.complaint.applyToDuplicates", defaultValue: "Применить ко всем жалобам на эту цель"), isOn: $applyToDuplicates)
            Button {
                guard let decision else { return }
                if decision == "DISMISS" {
                    Task { await resolve(decision) }
                } else {
                    confirming = decision
                }
            } label: {
                HStack {
                    Spacer()
                    if isWorking { ProgressView() }
                    Text(decision.map(decisionTitle) ?? String(localized: "admin.complaint.apply", defaultValue: "Применить решение"))
                        .fontWeight(.semibold)
                    Spacer()
                }
            }
            .tint(decision.map(isSevere) == true ? Palette.destructive : Palette.primary)
            .disabled(decision == nil || isWorking)
        } header: {
            Text(String(localized: "admin.complaint.decision", defaultValue: "Решение"))
        }
    }

    // MARK: Подписи

    private func isSevere(_ action: String) -> Bool {
        action == "DELETE_CONTENT" || action == "BLOCK_USER"
    }

    private func decisionTitle(_ action: String) -> String {
        switch action {
        case "DISMISS": return String(localized: "admin.decision.dismiss", defaultValue: "Отклонить жалобу")
        case "WARN_USER": return String(localized: "admin.decision.warn", defaultValue: "Предупредить автора")
        case "DELETE_CONTENT": return String(localized: "admin.decision.delete", defaultValue: "Удалить контент")
        case "BLOCK_USER": return String(localized: "admin.decision.block", defaultValue: "Заблокировать автора")
        default: return action
        }
    }

    private func decisionHint(_ action: String) -> String {
        switch action {
        case "DISMISS": return String(localized: "admin.decision.dismissHint", defaultValue: "Нарушения нет — никаких мер")
        case "WARN_USER": return String(localized: "admin.decision.warnHint", defaultValue: "Придёт уведомление, запись останется в истории модерации")
        case "DELETE_CONTENT": return String(localized: "admin.decision.deleteHint", defaultValue: "Пропадёт у всех, вернуть нельзя")
        case "BLOCK_USER": return String(localized: "admin.decision.blockHint", defaultValue: "Доступ к платформе закроется, все сессии завершатся")
        default: return ""
        }
    }

    private func confirmTitle(_ action: String) -> String {
        switch action {
        case "WARN_USER": return String(localized: "admin.decision.confirmWarn", defaultValue: "Предупредить автора? Ему придёт уведомление, запись останется в истории модерации.")
        case "DELETE_CONTENT": return String(localized: "admin.decision.confirmDelete", defaultValue: "Удалить контент? Он пропадёт у всех, и вернуть его из модерации нельзя.")
        default: return AdminText.blockConfirm(blockDays)
        }
    }

    // MARK: Действия

    @MainActor
    private func load() async {
        do {
            complaint = try await api.complaint(id: id)
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    @MainActor
    private func loadMessages() async {
        do {
            messages = try await api.complaintMessages(id: id)
            messagesFailure = nil
        } catch {
            messagesFailure = error.userMessage
        }
    }

    @MainActor
    private func resolve(_ action: String) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await api.resolveComplaint(
                id: id,
                action: action,
                comment: comment,
                applyToDuplicates: applyToDuplicates,
                blockDays: action == "BLOCK_USER" && blockDays > 0 ? blockDays : nil
            )
            dismiss()
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func take() async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await api.takeComplaint(id: id)
            await load()
        } catch {
            if (error as? APIError)?.code == .conflict {
                actionFailure = String(localized: "admin.complaint.takenConflict", defaultValue: "Жалобу уже разбирает другой модератор")
            } else {
                actionFailure = error.userMessage
            }
            await load()
        }
    }

    @MainActor
    private func reopen() async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await api.reopenComplaint(id: id)
            await load()
        } catch {
            actionFailure = error.userMessage
        }
    }
}

/// Сообщение окна переписки: обжалованное подсвечено, автор жалобы помечен.
private struct AdminTranscriptRow: View {
    let message: AdminComplaintMessageDTO
    let isTarget: Bool
    let isReporter: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                Text(message.sender?.name ?? "—")
                    .font(Typography.meta.weight(.semibold))
                    .foregroundStyle(Palette.foreground)
                if isReporter {
                    Text(String(localized: "admin.complaint.reporterTag", defaultValue: "автор жалобы"))
                        .font(.caption)
                        .foregroundStyle(Palette.primary)
                }
                Spacer(minLength: Spacing.md)
                Text(DisplayFormat.dateTime(message.createdAt))
                    .font(.caption)
                    .foregroundStyle(Palette.mutedForeground)
            }
            if let content = message.content, !content.isEmpty {
                Text(content)
                    .font(Typography.body)
                    .foregroundStyle(Palette.foreground)
            } else {
                Text(String(localized: "admin.complaint.messageDeleted", defaultValue: "Сообщение удалено"))
                    .font(Typography.meta.italic())
                    .foregroundStyle(Palette.mutedForeground)
            }
            if isTarget {
                Label(
                    message.deletedAt == nil
                        ? String(localized: "admin.complaint.reportedMessage", defaultValue: "Обжалованное сообщение")
                        : String(localized: "admin.complaint.reportedDeleted", defaultValue: "Обжалованное сообщение · удалено автором"),
                    systemImage: "flag.fill"
                )
                .font(.caption.weight(.semibold))
                .foregroundStyle(Palette.destructive)
            }
        }
        .padding(.vertical, 2)
        .listRowBackground(isTarget ? Palette.destructive.opacity(0.12) : Palette.card)
        .accessibilityElement(children: .combine)
    }
}
