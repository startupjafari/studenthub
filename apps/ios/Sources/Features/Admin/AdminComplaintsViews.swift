import SwiftUI

/// Очередь жалоб: статус капсулами, приоритет — меню. Сервер сам режет по охвату роли:
/// модератор и админ вуза видят свой вуз, платформа — все. Строка — как строка чата:
/// значок цели в цвете приоритета, причина двумя строками, время справа.
struct AdminComplaintsView: View {
    @State private var status: String? = "PENDING"
    @State private var priority: String?
    @State private var actionFailure: String?
    @State private var loader = PagedLoader<AdminComplaintDTO>(limit: 30) { request in
        try await AdminAPI().complaints(status: "PENDING", priority: nil, request: request)
    }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: String(localized: "admin.complaints.empty", defaultValue: "Жалоб нет"),
                symbol: "checkmark.shield",
                hint: String(localized: "admin.complaints.emptyHint", defaultValue: "Новые жалобы появятся здесь сразу, как их отправят")
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
            .swipeActions(edge: .trailing) {
                if complaint.isOpen, complaint.reviewingBy == nil {
                    Button {
                        Task { await take(complaint) }
                    } label: {
                        Label(String(localized: "admin.complaint.takeShort", defaultValue: "Взять"), systemImage: "hand.raised")
                    }
                    .tint(Palette.primary)
                }
            }
            .contextMenu {
                if complaint.isOpen, complaint.reviewingBy == nil {
                    Button {
                        Task { await take(complaint) }
                    } label: {
                        Label(String(localized: "admin.complaint.take", defaultValue: "Взять в разбор"), systemImage: "hand.raised")
                    }
                }
                if let reporter = complaint.reporter {
                    Button {
                        AdminNav.push(reporter.profileRoute)
                    } label: {
                        Label(String(localized: "admin.complaint.reporter", defaultValue: "Автор жалобы"), systemImage: "person.crop.circle")
                    }
                }
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
        .actionFailureAlert($actionFailure)
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

    @MainActor
    private func take(_ complaint: AdminComplaintDTO) async {
        do {
            try await AdminAPI().takeComplaint(id: complaint.id)
        } catch {
            actionFailure = (error as? APIError)?.code == .conflict
                ? String(localized: "admin.complaint.takenConflict", defaultValue: "Жалобу уже разбирает другой модератор")
                : error.userMessage
        }
        await loader.reload()
    }
}

/// Значок цели жалобы: по нему очередь читается глазами раньше подписи.
enum AdminComplaintVisual {
    static func symbol(_ targetType: String) -> String {
        switch targetType {
        case "POST": return "newspaper.fill"
        case "STORY": return "circle.dashed.inset.filled"
        case "COMMENT": return "text.bubble.fill"
        case "MESSAGE": return "bubble.left.and.bubble.right.fill"
        case "USER": return "person.fill"
        default: return "exclamationmark.bubble.fill"
        }
    }

    /// Цвет значка — по приоритету: высокий красный, средний оранжевый, низкий серый.
    static func tint(_ complaint: AdminComplaintDTO) -> Color {
        guard complaint.isOpen else { return TileTint.gray }
        switch complaint.effectivePriority {
        case "HIGH": return TileTint.red
        case "MEDIUM": return TileTint.orange
        default: return TileTint.blue
        }
    }
}

struct AdminComplaintRow: View {
    let complaint: AdminComplaintDTO

    var body: some View {
        TelegramStyleRow(
            title: title,
            subtitle: subtitle,
            meta: DisplayFormat.relative(complaint.createdAt)
        ) {
            RowSymbol(symbol: AdminComplaintVisual.symbol(complaint.targetType), tint: AdminComplaintVisual.tint(complaint))
        } accessory: {
            let status = AdminText.complaintStatus(complaint.status)
            StatusBadge(text: status.text, tint: status.tint)
        }
    }

    private var title: String {
        let target = AdminText.target(complaint.targetType)
        guard complaint.isOpen, complaint.effectivePriority == "HIGH" else { return target }
        return "\(target) · \(AdminText.priority("HIGH").text)"
    }

    private var subtitle: String {
        let reason = complaint.reason?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let reporter = complaint.reporter?.name ?? ""
        return [reporter, reason].filter { !$0.isEmpty }.joined(separator: ": ")
    }
}

/// Разбор жалобы: шапка с целью и статусом, ряд кнопок (взять, открыть цель, автор),
/// ниже — что обжаловано, переписка, решение. Меры идут от мягкой к жёсткой —
/// модератор останавливается на первой достаточной; жёсткие спрашивают подтверждение.
struct AdminComplaintView: View {
    let id: String

    @Environment(\.viewerRole) private var role
    @Environment(\.viewerID) private var viewerID
    @Environment(\.dismiss) private var dismiss

    @State private var remote = RemoteValue<AdminComplaintDTO>()
    @State private var actionFailure: String?
    @State private var isWorking = false

    @State private var decision: String?
    @State private var blockDays = 0
    @State private var comment = ""
    @State private var applyToDuplicates = false
    @State private var confirming: String?
    @State private var showingTranscript = false

    private let api = AdminAPI()

    private var complaint: AdminComplaintDTO? { remote.value }

    var body: some View {
        RemoteValueContent(remote: remote, load: fetch) { complaint in content(complaint) }
        .navigationTitle(Text(AdminScreen.complaint(id: id).title))
        .navigationBarTitleDisplayMode(.inline)
        .actionFailureAlert($actionFailure)
        .sheet(isPresented: $showingTranscript) {
            if let complaint {
                AdminComplaintTranscriptSheet(complaint: complaint)
            }
        }
        .alert(
            confirming.map(confirmTitle) ?? "",
            isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
            presenting: confirming
        ) { action in
            Button(decisionTitle(action), role: action == "WARN_USER" ? nil : .destructive) {
                Task { await resolve(action) }
            }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
        }
    }

    // MARK: Содержимое

    private func content(_ complaint: AdminComplaintDTO) -> some View {
        let reviewer = complaint.reviewingBy
        let takenByOther = reviewer != nil && reviewer?.id != viewerID
        return List {
            header(complaint)

            if let reason = complaint.reason?.trimmingCharacters(in: .whitespacesAndNewlines), !reason.isEmpty {
                Section {
                    Text(reason)
                        .font(Typography.body)
                        .foregroundStyle(Palette.foreground)
                        .textSelection(.enabled)
                } header: {
                    Text(String(localized: "admin.complaint.reasonTitle", defaultValue: "Причина"))
                }
            }

            detailsSection(complaint, reviewer: reviewer)
            targetSection(complaint)

            if complaint.targetType == "MESSAGE" {
                chatSection(complaint)
            }

            if complaint.isOpen && !takenByOther {
                decisionSection(complaint)
            } else if complaint.isOpen && takenByOther {
                Section {
                    Label(
                        String(localized: "admin.complaint.takenByOther", defaultValue: "Жалобу разбирает другой модератор — решение за ним."),
                        systemImage: "person.badge.clock"
                    )
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                }
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .pullToRefresh { await load() }
    }

    private func header(_ complaint: AdminComplaintDTO) -> some View {
        let status = AdminText.complaintStatus(complaint.status)
        let priority = AdminText.priority(complaint.effectivePriority)
        let target = AdminText.target(complaint.targetType)
        return Section {
            HeroHeader(
                visual: .symbol(AdminComplaintVisual.symbol(complaint.targetType), tint: AdminComplaintVisual.tint(complaint)),
                title: String(localized: "admin.complaint.heroTitle", defaultValue: "Жалоба: \(target)"),
                subtitle: DisplayFormat.dateTime(complaint.createdAt),
                actions: heroActions(complaint)
            ) {
                HStack(spacing: Spacing.sm) {
                    StatusBadge(text: status.text, tint: status.tint)
                    if complaint.isOpen {
                        StatusBadge(text: priority.text, tint: priority.tint)
                    }
                }
            }
        }
    }

    private func heroActions(_ complaint: AdminComplaintDTO) -> [HeroAction] {
        var actions: [HeroAction] = []
        if complaint.isOpen && complaint.reviewingBy == nil {
            actions.append(HeroAction(
                title: String(localized: "admin.complaint.takeShort", defaultValue: "Взять"),
                symbol: "hand.raised.fill"
            ) { Task { await take() } })
        }
        if !complaint.isOpen {
            actions.append(HeroAction(
                title: String(localized: "admin.complaint.reopenShort", defaultValue: "В очередь"),
                symbol: "arrow.uturn.backward"
            ) { Task { await reopen() } })
        }
        if let route = targetRoute(complaint) {
            actions.append(HeroAction(
                title: String(localized: "admin.complaint.openTargetShort", defaultValue: "Открыть"),
                symbol: complaint.targetType == "POST" ? "newspaper" : "person.crop.rectangle"
            ) { AdminNav.push(route) })
        }
        if complaint.targetType == "MESSAGE", role != .universityAdmin {
            actions.append(HeroAction(
                title: String(localized: "admin.complaint.chatShort", defaultValue: "Переписка"),
                symbol: "bubble.left.and.bubble.right"
            ) { showingTranscript = true })
        }
        if let reporter = complaint.reporter {
            actions.append(HeroAction(
                title: String(localized: "admin.complaint.reporterShort", defaultValue: "Заявитель"),
                symbol: "person.crop.circle"
            ) { AdminNav.push(reporter.profileRoute) })
        }
        return actions
    }

    /// Куда ведёт «Открыть»: пост — в ленту, человек и автор — в карточку пользователя.
    private func targetRoute(_ complaint: AdminComplaintDTO) -> AppRoute? {
        switch complaint.targetType {
        case "POST" where complaint.targetPreview != nil && complaint.targetPreview?.deleted != true:
            return .post(id: complaint.targetId)
        case "USER":
            return .admin(.user(id: complaint.targetId))
        default:
            return complaint.targetOwnerId.map { .admin(.user(id: $0)) }
        }
    }

    private func detailsSection(_ complaint: AdminComplaintDTO, reviewer: AdminPersonDTO?) -> some View {
        Section {
            if let reporter = complaint.reporter {
                NavigationLink(value: reporter.profileRoute) {
                    PersonRow(
                        name: reporter.name,
                        subtitle: String(localized: "admin.complaint.reporter", defaultValue: "Автор жалобы"),
                        avatarURL: reporter.avatarThumbUrl ?? reporter.avatarUrl,
                        size: 36
                    )
                }
            }
            if let reports = complaint.targetReports, reports > 1 {
                DetailRow(
                    title: String(localized: "admin.complaint.reports", defaultValue: "Жалоб от разных людей"),
                    value: reports.formatted(),
                    symbol: "person.3"
                )
            }
            if complaint.isOpen {
                DetailRow(
                    title: String(localized: "admin.complaint.reviewingBy", defaultValue: "Разбирает"),
                    value: reviewer?.name ?? String(localized: "admin.complaint.nobody", defaultValue: "Никто"),
                    symbol: "person.badge.clock"
                )
            } else {
                if let resolver = complaint.resolvedBy {
                    NavigationLink(value: resolver.profileRoute) {
                        PersonRow(
                            name: resolver.name,
                            subtitle: String(localized: "admin.complaint.resolvedBy", defaultValue: "Обработал"),
                            avatarURL: resolver.avatarThumbUrl ?? resolver.avatarUrl,
                            size: 36
                        )
                    }
                }
                DetailRow(
                    title: String(localized: "admin.complaint.resolution", defaultValue: "Решение"),
                    value: complaint.resolution ?? "—",
                    symbol: "checkmark.seal"
                )
                if let resolvedAt = complaint.resolvedAt {
                    DetailRow(
                        title: String(localized: "admin.complaint.resolvedAt", defaultValue: "Решено"),
                        value: DisplayFormat.dateTime(resolvedAt),
                        symbol: "clock"
                    )
                }
            }
        }
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
                    Label(
                        String(localized: "admin.complaint.targetGone", defaultValue: "Содержимое недоступно — его уже сняли."),
                        systemImage: "eye.slash"
                    )
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                }
                if complaint.targetType == "POST", complaint.targetPreview?.deleted != true, complaint.targetPreview != nil {
                    NavigationLink(value: AppRoute.post(id: complaint.targetId)) {
                        IconRow(title: String(localized: "admin.complaint.openPost", defaultValue: "Открыть пост"), symbol: "newspaper", tint: TileTint.blue)
                    }
                }
            }
            if complaint.targetType == "USER" {
                NavigationLink(value: AppRoute.admin(.user(id: complaint.targetId))) {
                    IconRow(title: String(localized: "admin.complaint.openUser", defaultValue: "Карточка пользователя"), symbol: "person.crop.rectangle", tint: TileTint.indigo)
                }
                NavigationLink(value: AppRoute.profile(id: complaint.targetId)) {
                    IconRow(title: String(localized: "admin.complaint.openProfile", defaultValue: "Профиль"), symbol: "person.fill", tint: TileTint.blue)
                }
            } else if let owner = complaint.targetOwnerId {
                // Решение принимают про человека: заблокировать — значит его, а не пост.
                NavigationLink(value: AppRoute.admin(.user(id: owner))) {
                    IconRow(title: String(localized: "admin.complaint.openOwner", defaultValue: "Карточка автора"), symbol: "person.crop.rectangle", tint: TileTint.indigo)
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
                    showingTranscript = true
                } label: {
                    IconRow(
                        title: String(localized: "admin.complaint.showChat", defaultValue: "Показать переписку"),
                        symbol: "bubble.left.and.bubble.right.fill",
                        tint: TileTint.teal
                    )
                }
                .buttonStyle(.plain)
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

    @ViewBuilder
    private func decisionSection(_ complaint: AdminComplaintDTO) -> some View {
        let decisions = ["DISMISS", "WARN_USER", "DELETE_CONTENT", "BLOCK_USER"]
            .filter { !($0 == "DELETE_CONTENT" && complaint.targetType == "USER") }
        Section {
            ForEach(decisions, id: \.self) { action in
                Button {
                    decision = action
                } label: {
                    HStack(spacing: Spacing.lg) {
                        IconTile(symbol: decisionSymbol(action), tint: decisionTint(action))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(decisionTitle(action))
                                .font(Typography.body)
                                .foregroundStyle(Palette.foreground)
                            Text(decisionHint(action))
                                .font(Typography.meta)
                                .foregroundStyle(Palette.mutedForeground)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: Spacing.md)
                        if decision == action {
                            Image(systemName: "checkmark")
                                .font(.body.weight(.semibold))
                                .foregroundStyle(Palette.primary)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(decision == action ? .isSelected : [])
            }
        } header: {
            Text(String(localized: "admin.complaint.decision", defaultValue: "Решение"))
        }

        Section {
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
        }

        Section {
            Button(role: decision.map(isSevere) == true ? .destructive : nil) {
                guard let decision else { return }
                if decision == "DISMISS" {
                    Task { await resolve(decision) }
                } else {
                    confirming = decision
                }
            } label: {
                HStack(spacing: Spacing.sm) {
                    Spacer()
                    if isWorking { ProgressView() }
                    Text(decision.map(decisionTitle) ?? String(localized: "admin.complaint.apply", defaultValue: "Применить решение"))
                        .fontWeight(.semibold)
                    Spacer()
                }
            }
            .disabled(decision == nil || isWorking)
        }
    }

    // MARK: Подписи

    private func isSevere(_ action: String) -> Bool {
        action == "DELETE_CONTENT" || action == "BLOCK_USER"
    }

    private func decisionSymbol(_ action: String) -> String {
        switch action {
        case "DISMISS": return "xmark"
        case "WARN_USER": return "exclamationmark.triangle.fill"
        case "DELETE_CONTENT": return "trash.fill"
        case "BLOCK_USER": return "hand.raised.fill"
        default: return "questionmark"
        }
    }

    private func decisionTint(_ action: String) -> Color {
        switch action {
        case "DISMISS": return TileTint.gray
        case "WARN_USER": return TileTint.orange
        default: return TileTint.red
        }
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

    private func load() async {
        await remote.load(fetch)
    }

    private func fetch() async throws -> AdminComplaintDTO {
        try await api.complaint(id: id)
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

/// Переписка по жалобе на сообщение — как чат: обои, пузыри, капсулы дней. Обжалованное
/// сообщение обведено красным, сообщения автора жалобы — справа.
private struct AdminComplaintTranscriptSheet: View {
    let complaint: AdminComplaintDTO

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            // Чужие личные сообщения — без копии на телефоне модератора.
            RemoteContent(caching: false, load: { try await AdminAPI().complaintMessages(id: complaint.id) }) { messages in
                if messages.isEmpty {
                    EmptyStateView(
                        title: String(localized: "admin.complaint.chatEmpty", defaultValue: "Сообщений в переписке нет"),
                        symbol: "bubble.left.and.bubble.right"
                    )
                } else {
                    transcript(messages)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background { ChatWallpaper().ignoresSafeArea() }
            .navigationTitle(Text(String(localized: "admin.complaint.chatTitle", defaultValue: "Переписка")))
            .navigationBarTitleDisplayMode(.inline)
            .softTopEdge()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
            }
        }
    }

    private func transcript(_ messages: [AdminComplaintMessageDTO]) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: Spacing.xs) {
                    Text(String(localized: "admin.complaint.chatAudit", defaultValue: "Открытие переписки записывается в журнал аудита"))
                        .font(.caption)
                        .foregroundStyle(Palette.mutedForeground)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, Spacing.lg)
                        .padding(.vertical, Spacing.xs)
                        .chatCapsuleSurface()
                        .padding(.bottom, Spacing.sm)
                    ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
                        if AdminDayCapsule.startsDay(message.createdAt, after: index > 0 ? messages[index - 1].createdAt : nil) {
                            AdminDayCapsule(day: message.createdAt)
                        }
                        let isTarget = message.id == complaint.targetId
                        let isReporter = message.senderId != nil && message.senderId == complaint.reporter?.id
                        AdminChatBubble(
                            text: message.content,
                            author: isReporter ? nil : message.sender?.name,
                            time: message.createdAt,
                            isOutgoing: isReporter,
                            isHighlighted: isTarget,
                            footnote: footnote(isTarget: isTarget, isReporter: isReporter, deleted: message.deletedAt != nil)
                        )
                        .id(message.id)
                    }
                }
                .padding(.horizontal, Spacing.md)
                .padding(.vertical, Spacing.md)
            }
            .onAppear {
                // Сразу к обжалованному: ради него переписку и открыли.
                proxy.scrollTo(complaint.targetId, anchor: .center)
            }
        }
    }

    private func footnote(isTarget: Bool, isReporter: Bool, deleted: Bool) -> String? {
        if isTarget {
            return deleted
                ? String(localized: "admin.complaint.reportedDeleted", defaultValue: "Обжалованное сообщение · удалено автором")
                : String(localized: "admin.complaint.reportedMessage", defaultValue: "Обжалованное сообщение")
        }
        return isReporter ? String(localized: "admin.complaint.reporterTag", defaultValue: "автор жалобы") : nil
    }

}
