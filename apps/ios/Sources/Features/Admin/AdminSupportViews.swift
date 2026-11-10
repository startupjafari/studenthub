import SwiftUI

/// Обращения в поддержку платформы: очередь — сначала те, где ждут ответа. Фильтры по
/// статусу, теме и тому, кто разбирает; поиск по тексту и фамилии автора.
struct AdminSupportView: View {
    @State private var status: String? = "open"
    @State private var assignee = "any"
    @State private var tag: String?
    @State private var search = ""
    @State private var tagCounts: [String: Int] = [:]
    @State private var actionFailure: String?
    @State private var loader = PagedLoader<AdminSupportTicketDTO>(limit: 30) { request in
        try await AdminAPI().supportQueue(status: "open", assignee: "any", search: nil, tag: nil, request: request)
    }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: status == "closed"
                    ? String(localized: "admin.support.emptyClosed", defaultValue: "Закрытых обращений нет")
                    : String(localized: "admin.support.emptyOpen", defaultValue: "Открытых обращений нет"),
                symbol: "lifepreserver"
            )
        ) {
            FilterChipsRow(
                options: [
                    (value: Optional("open"), title: String(localized: "admin.support.statusOpen", defaultValue: "Открытые")),
                    (value: Optional("closed"), title: String(localized: "admin.support.statusClosed", defaultValue: "Закрытые")),
                ],
                selection: $status
            )
        } row: { ticket in
            NavigationLink(value: AppRoute.admin(.supportTicket(id: ticket.id))) {
                AdminSupportTicketRow(ticket: ticket)
            }
            .swipeActions(edge: .leading) {
                if ticket.assigneeId == nil, ticket.closedAt == nil {
                    Button {
                        Task { await take(ticket) }
                    } label: {
                        Label(String(localized: "admin.support.take", defaultValue: "Взять себе"), systemImage: "hand.raised.fill")
                    }
                    .tint(Palette.primary)
                }
            }
            .contextMenu {
                if ticket.assigneeId == nil, ticket.closedAt == nil {
                    Button {
                        Task { await take(ticket) }
                    } label: {
                        Label(String(localized: "admin.support.take", defaultValue: "Взять себе"), systemImage: "hand.raised")
                    }
                }
                if let author = ticket.author {
                    Button {
                        AdminNav.push(author.profileRoute)
                    } label: {
                        Label(String(localized: "admin.support.openAuthor", defaultValue: "Профиль автора"), systemImage: "person.crop.circle")
                    }
                }
            }
        }
        .navigationTitle(Text(AdminScreen.support.title))
        .actionFailureAlert($actionFailure)
        .adminPinnedSearch($search, prompt: String(localized: "admin.support.search", defaultValue: "Текст или фамилия")) { _ in
            await refilter()
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker(String(localized: "admin.support.assignee", defaultValue: "Кто разбирает"), selection: $assignee) {
                        Text(String(localized: "admin.support.assigneeAny", defaultValue: "Все")).tag("any")
                        Text(String(localized: "admin.support.assigneeMine", defaultValue: "Мои")).tag("mine")
                        Text(String(localized: "admin.support.assigneeFree", defaultValue: "Свободные")).tag("free")
                    }
                    Picker(String(localized: "admin.support.tag", defaultValue: "Тема обращения"), selection: $tag) {
                        Text(String(localized: "admin.support.tagAll", defaultValue: "Все темы")).tag(String?.none)
                        ForEach(AdminText.supportTags, id: \.self) { value in
                            Text(tagTitle(value)).tag(Optional(value))
                        }
                    }
                } label: {
                    Image(systemName: assignee == "any" && tag == nil
                        ? "line.3.horizontal.decrease.circle"
                        : "line.3.horizontal.decrease.circle.fill")
                }
                .accessibilityLabel(Text(String(localized: "admin.support.filters", defaultValue: "Фильтры")))
            }
        }
        .onChange(of: status) { _, _ in Task { await refilter() } }
        .onChange(of: assignee) { _, _ in Task { await refilter() } }
        .onChange(of: tag) { _, _ in Task { await refilter() } }
        .onAppear { if loader.isLoaded { Task { await loader.reload() } } }
        .task { await loadTagCounts() }
    }

    private func tagTitle(_ value: String) -> String {
        guard let count = tagCounts[value], count > 0 else { return AdminText.supportTag(value) }
        return "\(AdminText.supportTag(value)) · \(count.formatted())"
    }

    @MainActor
    private func take(_ ticket: AdminSupportTicketDTO) async {
        do {
            try await AdminAPI().supportAssign(id: ticket.id, take: true)
        } catch {
            actionFailure = (error as? APIError)?.code == .conflict
                ? String(localized: "admin.support.conflict", defaultValue: "Обращение уже изменил другой сотрудник — обновите экран")
                : error.userMessage
        }
        await loader.reload()
    }

    private func loadTagCounts() async {
        guard let counts = try? await AdminAPI().supportTagCounts() else { return }
        tagCounts = Dictionary(counts.map { ($0.tag, $0.count) }, uniquingKeysWith: +)
    }

    private func refilter() async {
        let status = status ?? "open"
        let assignee = assignee
        let tag = tag
        let needle = search.trimmingCharacters(in: .whitespaces)
        // Сервер ищет от двух символов: одна буква — не запрос.
        let query: String? = needle.count >= 2 ? String(needle.prefix(100)) : nil
        await loader.replace { request in
            try await AdminAPI().supportQueue(status: status, assignee: assignee, search: query, tag: tag, request: request)
        }
    }
}

struct AdminSupportTicketRow: View {
    let ticket: AdminSupportTicketDTO

    var body: some View {
        let name = ticket.author?.name ?? String(localized: "admin.support.deletedAuthor", defaultValue: "Удалённый пользователь")
        TelegramStyleRow(
            title: name,
            subtitle: subtitle,
            meta: DisplayFormat.relative(ticket.lastMessage?.createdAt ?? ticket.updatedAt ?? ticket.createdAt),
            metaTint: isWaiting ? Palette.primary : Palette.mutedForeground
        ) {
            AvatarView(url: ticket.author?.avatarThumbUrl ?? ticket.author?.avatarUrl, name: name, size: 52)
        } accessory: {
            if ticket.closedAt != nil {
                StatusBadge(text: String(localized: "admin.support.closed", defaultValue: "Закрыто"), tint: Palette.mutedForeground)
            } else if isWaiting {
                StatusBadge(text: String(localized: "admin.support.waiting", defaultValue: "Ждёт ответа"), tint: Palette.warning)
            }
        }
    }

    private var isWaiting: Bool { ticket.closedAt == nil && ticket.lastMessage?.fromAuthor == true }

    /// Как превью чата: последняя реплика (ответ поддержки — с «Вы:»), ниже — темы и кто
    /// разбирает.
    private var subtitle: String {
        var last = ticket.lastMessage?.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if last.isEmpty { last = String(localized: "admin.support.noText", defaultValue: "Вложение") }
        if ticket.lastMessage?.fromAuthor == false {
            last = String(localized: "admin.support.replyPrefix", defaultValue: "Поддержка: \(last)")
        }
        let tags = (ticket.tags ?? []).map(AdminText.supportTag).joined(separator: ", ")
        let assignee = ticket.assignee?.name ?? String(localized: "admin.support.free", defaultValue: "Свободно")
        let meta = [ticket.author?.university ?? "", tags, assignee].filter { !$0.isEmpty }.joined(separator: " · ")
        return [last, meta].filter { !$0.isEmpty }.joined(separator: "\n")
    }
}

/// Обращение: переписка, ответ и действия поддержки — взять себе или отдать, темы,
/// склейка с другим обращением того же человека, эскалация, жалоба, закрытие.
struct AdminSupportTicketView: View {
    let id: String

    @Environment(\.viewerID) private var viewerID
    @Environment(\.dismiss) private var dismiss

    @State private var thread: AdminSupportThreadDTO?
    @State private var earlier: [AdminSupportMessageDTO] = []
    @State private var earlierCursor: String?
    /// История уже листалась: курсор берётся из неё, а не из первой порции обращения.
    @State private var earlierStarted = false
    @State private var failure: String?
    @State private var isOffline = false
    @State private var actionFailure: String?
    @State private var notice: String?
    @State private var reply = ""
    @State private var isSending = false
    @State private var isWorking = false

    @State private var editingTags = false
    @State private var confirmClose = false
    @State private var confirmEscalate = false
    @State private var merging: AdminSupportThreadDTO.Sibling?
    @State private var pickingComplaintTarget = false
    @State private var complaintTarget: AdminPickItem?

    private let api = AdminAPI()

    var body: some View {
        Group {
            if let thread {
                content(thread)
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background { ChatWallpaper().ignoresSafeArea() }
        .navigationTitle(Text(thread?.ticket.author?.name ?? AdminScreen.supportTicket(id: id).title))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                if let thread { titleView(thread.ticket) }
            }
            ToolbarItem(placement: .topBarTrailing) {
                if let thread { actionsMenu(thread) }
            }
        }
        .task { await load() }
        .actionFailureAlert($actionFailure)
        .alert(notice ?? "", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        }
        .confirmationDialog(
            String(localized: "admin.support.confirmClose", defaultValue: "Закрыть обращение? Переписка сохранится, новый ответ откроет его снова."),
            isPresented: $confirmClose,
            titleVisibility: .visible
        ) {
            Button(String(localized: "admin.support.close", defaultValue: "Закрыть обращение")) {
                Task { await run { try await api.supportClose(id: id) } done: { dismiss() } }
            }
        }
        .confirmationDialog(
            String(localized: "admin.support.confirmEscalate", defaultValue: "Позвать администраторов? Уведомление придёт им сразу, мимо дежурства и тихих часов."),
            isPresented: $confirmEscalate,
            titleVisibility: .visible
        ) {
            Button(String(localized: "admin.support.escalate", defaultValue: "Позвать администратора")) {
                Task {
                    await run { try await api.supportEscalate(id: id) } done: {
                        notice = String(localized: "admin.support.escalated", defaultValue: "Администраторы уведомлены")
                    }
                }
            }
        }
        .confirmationDialog(
            String(localized: "admin.support.confirmMerge", defaultValue: "Склеить обращения? Переписка этого обращения станет частью выбранного."),
            isPresented: Binding(get: { merging != nil }, set: { if !$0 { merging = nil } }),
            titleVisibility: .visible,
            presenting: merging
        ) { sibling in
            Button(String(localized: "admin.support.merge", defaultValue: "Склеить")) {
                Task { await run { try await api.supportMerge(id: id, into: sibling.id) } done: { dismiss() } }
            }
        }
        .confirmationDialog(
            complaintTarget.map {
                String(localized: "admin.support.confirmComplaint", defaultValue: "Передать жалобу на \($0.title) модерации? Автором жалобы будет автор обращения, текст — его первое сообщение.")
            } ?? "",
            isPresented: Binding(get: { complaintTarget != nil && !pickingComplaintTarget }, set: { if !$0 { complaintTarget = nil } }),
            titleVisibility: .visible,
            presenting: complaintTarget
        ) { target in
            Button(String(localized: "admin.support.complaintSubmit", defaultValue: "Передать в модерацию")) {
                Task { await fileComplaint(target) }
            }
        }
        .sheet(isPresented: $editingTags) {
            if let thread {
                AdminSupportTagsSheet(selected: thread.ticket.tags ?? []) { tags in
                    try await api.supportSetTags(id: id, tags: tags)
                    await load()
                }
            }
        }
        .sheet(isPresented: $pickingComplaintTarget) {
            NavigationStack {
                AdminSearchPicker(
                    title: String(localized: "admin.support.complaintTarget", defaultValue: "На кого жалуется автор"),
                    selection: $complaintTarget
                ) { needle in
                    guard needle.count >= 2 else { return [] }
                    return try await api.users(role: nil, search: String(needle.prefix(100)), request: PageRequest(cursor: nil, page: 1, limit: 20))
                        .items
                        .map { AdminPickItem(id: $0.id, title: $0.name, subtitle: AdminRoles.title($0.role)) }
                }
                .softTopEdge()
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        SheetCloseButton {
                            complaintTarget = nil
                            pickingComplaintTarget = false
                        }
                    }
                }
            }
            .onChange(of: complaintTarget) { _, value in
                if value != nil { pickingComplaintTarget = false }
            }
        }
    }

    // MARK: Содержимое

    private func isMine(_ ticket: AdminSupportTicketDTO) -> Bool { ticket.assigneeId == viewerID }

    private func takenByOther(_ ticket: AdminSupportTicketDTO) -> Bool {
        ticket.assigneeId != nil && !isMine(ticket)
    }

    /// Шапка как у чата: имя автора и под ним — состояние обращения.
    private func titleView(_ ticket: AdminSupportTicketDTO) -> some View {
        VStack(spacing: 0) {
            Text(ticket.author?.name ?? AdminScreen.supportTicket(id: id).title)
                .font(.headline)
                .foregroundStyle(Palette.foreground)
                .lineLimit(1)
            Text(statusLine(ticket))
                .font(.footnote)
                .foregroundStyle(ticket.closedAt == nil && ticket.assigneeId == nil ? Palette.primary : Palette.mutedForeground)
                .lineLimit(1)
        }
        .padding(.horizontal, Spacing.md)
        .accessibilityElement(children: .combine)
    }

    private func statusLine(_ ticket: AdminSupportTicketDTO) -> String {
        if ticket.closedAt != nil {
            return String(localized: "admin.support.closed", defaultValue: "Закрыто")
        }
        if let assignee = ticket.assignee {
            let who = isMine(ticket) ? String(localized: "admin.support.you", defaultValue: "вы") : assignee.name
            return String(localized: "admin.support.handledByLine", defaultValue: "Разбирает: \(who)")
        }
        return String(localized: "admin.support.free", defaultValue: "Свободно")
    }

    private func content(_ thread: AdminSupportThreadDTO) -> some View {
        let ticket = thread.ticket
        let messages = Self.merge(thread.messages, earlier)
        return ScrollView {
            LazyVStack(spacing: Spacing.xs) {
                infoCard(thread)
                    .padding(.bottom, Spacing.md)
                if (earlierStarted ? earlierCursor : thread.earlierCursor) != nil {
                    Button {
                        Task { await loadEarlier(thread) }
                    } label: {
                        Label(String(localized: "admin.support.showEarlier", defaultValue: "Показать более ранние сообщения"), systemImage: "arrow.up")
                            .font(.footnote.weight(.semibold))
                            .padding(.horizontal, Spacing.lg)
                            .padding(.vertical, Spacing.xs)
                            .chatCapsuleSurface()
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Palette.primary)
                    .padding(.bottom, Spacing.sm)
                }
                ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
                    if AdminDayCapsule.startsDay(message.createdAt, after: index > 0 ? messages[index - 1].createdAt : nil) {
                        AdminDayCapsule(day: message.createdAt)
                    }
                    let fromAuthor = message.sender?.id == ticket.author?.id
                    let mine = message.sender?.id == viewerID
                    AdminChatBubble(
                        text: message.content,
                        author: fromAuthor || mine ? nil : message.sender?.name,
                        time: message.createdAt,
                        isOutgoing: !fromAuthor,
                        footnote: (message.media ?? []).isEmpty
                            ? nil
                            : String(localized: "admin.support.attachments", defaultValue: "Вложений: \((message.media ?? []).count.formatted())"),
                        deletedText: String(localized: "admin.support.noText", defaultValue: "Вложение")
                    )
                }
            }
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.md)
        }
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await load() }
        .safeAreaInset(edge: .bottom) {
            composer(ticket)
        }
    }

    /// Карточка над перепиской, как приветствие бота в Telegram: кто пишет, откуда, тема.
    /// Тема — нажатием, имя — в профиль.
    private func infoCard(_ thread: AdminSupportThreadDTO) -> some View {
        let ticket = thread.ticket
        let name = ticket.author?.name ?? String(localized: "admin.support.deletedAuthor", defaultValue: "Удалённый пользователь")
        let place = [ticket.author?.role.map(AdminRoles.title), ticket.author?.university]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
        let tags = (ticket.tags ?? []).map(AdminText.supportTag).joined(separator: ", ")
        return VStack(spacing: Spacing.sm) {
            Button {
                if let author = ticket.author { AdminNav.push(author.profileRoute) }
            } label: {
                VStack(spacing: Spacing.sm) {
                    AvatarView(url: ticket.author?.avatarThumbUrl ?? ticket.author?.avatarUrl, name: name, size: 64)
                    Text(name)
                        .font(.headline)
                        .foregroundStyle(Palette.foreground)
                        .multilineTextAlignment(.center)
                    if !place.isEmpty {
                        Text(place)
                            .font(.footnote)
                            .foregroundStyle(Palette.mutedForeground)
                            .multilineTextAlignment(.center)
                    }
                }
            }
            .buttonStyle(.plain)
            .disabled(ticket.author == nil)
            .accessibilityHint(Text(String(localized: "admin.support.openAuthor", defaultValue: "Профиль автора")))

            Text(String(localized: "admin.support.createdLine", defaultValue: "Создано \(DisplayFormat.dateTime(ticket.createdAt))"))
                .font(.caption)
                .foregroundStyle(Palette.mutedForeground)
            if let merged = thread.mergedCount, merged > 0 {
                Text(String(localized: "admin.support.mergedLine", defaultValue: "Склеено обращений: \(merged.formatted())"))
                    .font(.caption)
                    .foregroundStyle(Palette.mutedForeground)
            }
            Button {
                editingTags = true
            } label: {
                Label(
                    tags.isEmpty ? String(localized: "admin.support.topicSet", defaultValue: "Указать тему") : tags,
                    systemImage: "tag"
                )
                .font(.footnote.weight(.semibold))
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.sm)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Palette.primary)
            .glassSurface(in: Capsule())
            .accessibilityLabel(Text(String(localized: "admin.support.topic", defaultValue: "Тема")))
            .accessibilityValue(Text(tags.isEmpty ? String(localized: "admin.support.topicNone", defaultValue: "Не указана") : tags))
        }
        .frame(maxWidth: 320)
        .padding(Spacing.xl)
        .background(Palette.card.opacity(0.92), in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private func composer(_ ticket: AdminSupportTicketDTO) -> some View {
        if takenByOther(ticket) {
            Text(String(localized: "admin.support.takenByOtherHint", defaultValue: "Обращение разбирает другой сотрудник — отвечает он."))
                .font(.footnote)
                .foregroundStyle(Palette.foreground)
                .multilineTextAlignment(.center)
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.sm)
                .chatCapsuleSurface()
                .frame(maxWidth: .infinity)
                .padding(.horizontal, Spacing.xl)
                .padding(.vertical, Spacing.md)
        } else {
            VStack(spacing: Spacing.xs) {
                if ticket.closedAt != nil {
                    Text(String(localized: "admin.support.replyReopens", defaultValue: "Ответ откроет обращение снова"))
                        .font(.caption)
                        .foregroundStyle(Palette.foreground)
                        .padding(.horizontal, Spacing.lg)
                        .padding(.vertical, Spacing.xs)
                        .chatCapsuleSurface()
                }
                GlassGroup(spacing: Spacing.md) {
                    HStack(alignment: .bottom, spacing: Spacing.md) {
                        TextField(
                            text: $reply,
                            prompt: Text(String(localized: "admin.support.replyPlaceholder", defaultValue: "Ответ пользователю")),
                            axis: .vertical
                        ) {
                            Text(String(localized: "admin.support.replyPlaceholder", defaultValue: "Ответ пользователю"))
                        }
                        .labelsHidden()
                        .lineLimit(1...6)
                        .font(Typography.body)
                        .padding(.horizontal, Spacing.lg)
                        .padding(.vertical, Spacing.md)
                        .frame(minHeight: ControlHeight.lg)
                        .glassSurface(interactive: false, in: RoundedRectangle(cornerRadius: ControlHeight.lg / 2, style: .continuous))

                        Button {
                            Task { await send() }
                        } label: {
                            Group {
                                if isSending {
                                    ProgressView().tint(Palette.primaryForeground)
                                } else {
                                    Image(systemName: "arrow.up")
                                        .font(Typography.body.weight(.bold))
                                }
                            }
                            .foregroundStyle(Palette.primaryForeground)
                            .frame(width: ControlHeight.lg, height: ControlHeight.lg)
                            .glassSurface(tint: Palette.primary, in: Circle())
                        }
                        .buttonStyle(.plain)
                        .disabled(isSending || reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .opacity(reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.5 : 1)
                        .accessibilityLabel(Text(String(localized: "admin.support.send", defaultValue: "Отправить")))
                    }
                }
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.md)
        }
    }

    private func actionsMenu(_ thread: AdminSupportThreadDTO) -> some View {
        let ticket = thread.ticket
        return Menu {
            if !takenByOther(ticket) {
                if isMine(ticket) {
                    Button {
                        Task { await run { try await api.supportAssign(id: id, take: false) } done: { await load() } }
                    } label: {
                        Label(String(localized: "admin.support.release", defaultValue: "Отдать в очередь"), systemImage: "arrow.uturn.backward")
                    }
                } else {
                    Button {
                        Task { await run { try await api.supportAssign(id: id, take: true) } done: { await load() } }
                    } label: {
                        Label(String(localized: "admin.support.take", defaultValue: "Взять себе"), systemImage: "hand.raised")
                    }
                }
                if ticket.closedAt == nil {
                    Button {
                        confirmClose = true
                    } label: {
                        Label(String(localized: "admin.support.close", defaultValue: "Закрыть обращение"), systemImage: "checkmark.circle")
                    }
                }
            }
            if let siblings = thread.siblings, !siblings.isEmpty {
                Menu {
                    ForEach(siblings) { sibling in
                        Button {
                            merging = sibling
                        } label: {
                            Text(verbatim: sibling.closed == true
                                ? "\(DisplayFormat.date(sibling.createdAt)) · \(String(localized: "admin.support.statusClosed", defaultValue: "Закрытые"))"
                                : DisplayFormat.date(sibling.createdAt))
                        }
                    }
                } label: {
                    Label(String(localized: "admin.support.mergeWith", defaultValue: "Склеить с обращением от…"), systemImage: "arrow.triangle.merge")
                }
            }
            Button {
                editingTags = true
            } label: {
                Label(String(localized: "admin.support.tags", defaultValue: "Темы обращения"), systemImage: "tag")
            }
            if let author = ticket.author {
                Button {
                    AdminNav.push(author.profileRoute)
                } label: {
                    Label(String(localized: "admin.support.openAuthor", defaultValue: "Профиль автора"), systemImage: "person.crop.circle")
                }
            }
            Divider()
            Button {
                confirmEscalate = true
            } label: {
                Label(String(localized: "admin.support.escalate", defaultValue: "Позвать администратора"), systemImage: "exclamationmark.bubble")
            }
            if ticket.author != nil {
                Button {
                    complaintTarget = nil
                    pickingComplaintTarget = true
                } label: {
                    Label(String(localized: "admin.support.fileComplaint", defaultValue: "Завести жалобу"), systemImage: "flag")
                }
            }
        } label: {
            if isWorking {
                ProgressView()
            } else {
                Image(systemName: "ellipsis")
            }
        }
        .disabled(isWorking)
        .accessibilityLabel(Text(String(localized: "admin.support.actions", defaultValue: "Действия")))
    }

    /// Свежие сверху приходят и с сервера, и из истории; читается переписка сверху вниз.
    private static func merge(_ first: [AdminSupportMessageDTO], _ second: [AdminSupportMessageDTO]) -> [AdminSupportMessageDTO] {
        var seen = Set<String>()
        return (first + second)
            .filter { seen.insert($0.id).inserted }
            .sorted { $0.createdAt < $1.createdAt }
    }

    // MARK: Загрузка и действия

    @MainActor
    private func load() async {
        do {
            let value = try await api.supportThread(id: id)
            thread = value
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    @MainActor
    private func loadEarlier(_ thread: AdminSupportThreadDTO) async {
        guard let cursor = earlierStarted ? earlierCursor : thread.earlierCursor else { return }
        do {
            let page = try await api.supportEarlier(id: id, cursor: cursor)
            earlier += page.items
            earlierCursor = page.meta?.hasNext == true ? page.meta?.cursor : nil
            earlierStarted = true
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func send() async {
        let text = reply.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        isSending = true
        defer { isSending = false }
        do {
            try await api.supportReply(id: id, text: text)
            reply = ""
            await load()
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func run(_ action: () async throws -> Void, done: () async -> Void) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await action()
            await done()
        } catch {
            if (error as? APIError)?.code == .conflict {
                actionFailure = String(localized: "admin.support.conflict", defaultValue: "Обращение уже изменил другой сотрудник — обновите экран")
            } else {
                actionFailure = error.userMessage
            }
            await load()
        }
    }

    @MainActor
    private func fileComplaint(_ target: AdminPickItem) async {
        complaintTarget = nil
        isWorking = true
        defer { isWorking = false }
        do {
            try await api.complaintFromSupport(chatID: id, targetID: target.id)
            notice = String(localized: "admin.support.complaintCreated", defaultValue: "Жалоба передана модерации")
        } catch {
            if (error as? APIError)?.code == .conflict {
                actionFailure = String(localized: "admin.support.complaintDuplicate", defaultValue: "Жалоба автора на этого человека уже ждёт рассмотрения")
            } else {
                actionFailure = error.userMessage
            }
        }
    }
}

/// Темы обращения — до трёх: по ним работают фильтр очереди и сводка.
private struct AdminSupportTagsSheet: View {
    let save: ([String]) async throws -> Void
    @State private var selected: Set<String>

    init(selected: [String], save: @escaping ([String]) async throws -> Void) {
        self.save = save
        _selected = State(initialValue: Set(selected))
    }

    var body: some View {
        FormSheet(
            title: String(localized: "admin.support.tags", defaultValue: "Темы обращения"),
            save: { try await save(AdminText.supportTags.filter(selected.contains)) }
        ) {
            Section {
                ForEach(AdminText.supportTags, id: \.self) { tag in
                    Button {
                        if selected.contains(tag) {
                            selected.remove(tag)
                        } else if selected.count < 3 {
                            selected.insert(tag)
                        }
                    } label: {
                        HStack {
                            Text(AdminText.supportTag(tag)).foregroundStyle(Palette.foreground)
                            Spacer()
                            if selected.contains(tag) {
                                Image(systemName: "checkmark").foregroundStyle(Palette.primary)
                            }
                        }
                    }
                    .disabled(!selected.contains(tag) && selected.count >= 3)
                }
            } footer: {
                Text(String(localized: "admin.support.tagsHint", defaultValue: "Темы ставит поддержка — по ним работают фильтр очереди и сводка. До трёх."))
            }
        }
    }
}
