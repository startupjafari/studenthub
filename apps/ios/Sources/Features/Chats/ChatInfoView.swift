import SwiftUI
import UIKit

/// Информация о чате в духе Telegram: крупный аватар по центру, имя и статус, ряд
/// круглых стеклянных кнопок (звук, поиск, добавить, ещё), ниже — сгруппированные
/// списки: описание, участники, содержимое, опасные действия.
///
/// Набор действий зависит от вида чата и роли: группой управляют её админы,
/// официальные чаты заводит система и их не переименовывают.
struct ChatInfoView: View {
    let chatID: String

    @Environment(\.viewerID) private var viewerID
    @Environment(\.dismiss) private var dismiss
    @State private var chat: ChatRecord?
    @State private var members: [ChatMemberDTO] = []
    @State private var membersLoaded = false
    /// Состав не пришёл — это сбой, а не пустой чат.
    @State private var membersFailure: String?
    @State private var section: ChatMediaKindTab = .media
    @State private var editing = false
    @State private var addingMember = false
    @State private var searching = false
    @State private var pickedMessage: String?
    @State private var pickingDay = false
    /// Выбранный в календаре день: переписка откроется на нём, когда лист закроется.
    @State private var pickedDay: Date?
    @State private var confirmingLeave = false
    @State private var confirmingClear = false
    @State private var clearingPeriod = false
    @State private var confirmingBlock = false
    @State private var copiedInvite = 0
    /// «Ссылка скопирована» на месте строки приглашения — пара секунд после копирования.
    @State private var inviteNotice: String?
    @State private var confirmingInviteReset = false
    /// Опасное действие над участником ждёт подтверждения.
    @State private var memberAction: MemberAction?
    @State private var failure: String?
    /// Медиа, файлы, голосовые и ссылки — со своими страницами и проигрывателем.
    @State private var shared: ChatSharedContent
    @ScaledMetric(relativeTo: .largeTitle) private var avatarSize: CGFloat = 100
    private let api: ChatActing = ChatsAPI()
    private var realtime: RealtimeCoordinator { AppServices.realtime }

    init(chatID: String) {
        self.chatID = chatID
        _shared = State(initialValue: ChatSharedContent(chatID: chatID))
    }

    var body: some View {
        withDialogs(list)
            .chatSharedContentDialogs(shared)
            .task {
                await reloadChat()
                await loadMembers()
            }
            .task(id: section) { await shared.load(section) }
            // Голосовое не играет из-под другой вкладки и после выхода из информации.
            .onChange(of: section) { shared.stopVoice() }
            .onDisappear { shared.stopVoice() }
    }

    private var list: some View {
        List {
            header
                .listRowInsets(EdgeInsets(top: 0, leading: Spacing.lg, bottom: Spacing.md, trailing: Spacing.lg))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)

            if let failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            if let chat {
                detailsSection(chat)
                if chat.kind != .private, chat.kind != .saved {
                    membersSection(chat)
                }
                Section {
                    Picker(String(localized: "chats.info.content", defaultValue: "Содержимое"), selection: $section) {
                        ForEach(ChatMediaKindTab.allCases) { tab in
                            Text(tab.title).tag(tab)
                        }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: Spacing.sm, trailing: 0))
                    ChatContentList(shared: shared, tab: section, showInChat: showInChat)
                }
                // Заблокировать, очистить и удалить — в «Ещё» под шапкой, как в Telegram:
                // второй красной карточкой внизу они повторялись.
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .navigationTitle(Text(String(localized: "chats.info.title", defaultValue: "Информация")))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if canManageGroup {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(String(localized: "chats.edit", defaultValue: "Изм.")) { editing = true }
                }
            }
        }
    }

    private var canManageGroup: Bool {
        chat?.kind == .group && (chat?.isAdmin == true || chat?.isOwner == true)
    }

    private var displayTitle: String {
        chat.map { $0.title ?? ChatTitle.fallback(for: $0) } ?? ""
    }

    // MARK: Шапка

    private var header: some View {
        VStack(spacing: Spacing.sm) {
            ChatAvatarView(
                title: displayTitle,
                kind: chat?.kind ?? .unknown,
                avatarURL: chat?.avatarUrl,
                online: chat?.kind == .private && peerOnline,
                size: min(avatarSize, 150)
            )
            .padding(.bottom, Spacing.xs)

            HStack(spacing: Spacing.xs) {
                Text(displayTitle)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(Palette.foreground)
                    .multilineTextAlignment(.center)
                if chat?.kind.isOfficial == true {
                    Image(systemName: "checkmark.seal.fill")
                        .foregroundStyle(Palette.primary)
                        .accessibilityLabel(Text(String(localized: "chats.official", defaultValue: "Официальный чат")))
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)

            if let status {
                Text(status)
                    .font(.subheadline)
                    .foregroundStyle(peerOnline && chat?.kind == .private ? Palette.primary : Palette.mutedForeground)
            }

            if let chat {
                actionButtons(chat)
                    .padding(.top, Spacing.lg)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, Spacing.md)
    }

    /// Ряд круглых стеклянных кнопок под именем, как в Telegram.
    private func actionButtons(_ chat: ChatRecord) -> some View {
        GlassGroup(spacing: Spacing.lg) {
            HStack(alignment: .top, spacing: Spacing.md) {
                if chat.kind != .saved {
                    muteButton(chat)
                }
                ChatInfoActionButton(
                    title: String(localized: "chats.info.search", defaultValue: "Поиск"),
                    symbol: "magnifyingglass"
                ) {
                    searching = true
                }
                if canManageGroup {
                    ChatInfoActionButton(
                        title: String(localized: "chats.info.add", defaultValue: "Добавить"),
                        symbol: "person.badge.plus"
                    ) {
                        addingMember = true
                    }
                }
                HeroMoreButton(menu: moreMenu(chat))
                    .frame(maxWidth: .infinity)
            }
        }
    }

    @ViewBuilder
    private func muteButton(_ chat: ChatRecord) -> some View {
        if chat.muted {
            ChatInfoActionButton(
                title: String(localized: "chats.info.unmute", defaultValue: "Вкл. звук"),
                symbol: "bell.slash.fill"
            ) {
                Task { await setMuted(false, minutes: nil, importantOnly: false) }
            }
        } else {
            HeroMoreButton(
                menu: MuteMenu.heroOptions { minutes, importantOnly in
                    Task { await setMuted(true, minutes: minutes, importantOnly: importantOnly) }
                },
                title: String(localized: "chats.info.sound", defaultValue: "Звук"),
                symbol: "bell.fill"
            )
            .frame(maxWidth: .infinity)
        }
    }

    @HeroMenuBuilder
    private func moreMenu(_ chat: ChatRecord) -> [HeroMenuElement] {
        HeroMenuItem(String(localized: "chats.calendar.title", defaultValue: "Перейти к дате"), symbol: "calendar") {
            pickingDay = true
        }
        if canManageGroup {
            HeroMenuItem(String(localized: "feed.edit", defaultValue: "Редактировать"), symbol: "pencil") {
                editing = true
            }
            HeroMenuItem(String(localized: "chats.invite.copy", defaultValue: "Скопировать ссылку-приглашение"), symbol: "link") {
                Task { await copyInvite() }
            }
        }
        if chat.kind == .private, peer != nil {
            HeroMenuItem(blockTitle(chat), symbol: "hand.raised", isDestructive: !chat.blocked) {
                confirmingBlock = true
            }
        }
        HeroSubmenu(String(localized: "chats.clear", defaultValue: "Очистить историю"), symbol: "eraser") {
            HeroMenuItem(String(localized: "chats.clear.all", defaultValue: "Всю историю"), symbol: "trash", isDestructive: true) {
                confirmingClear = true
            }
            HeroMenuItem(String(localized: "chats.clear.period", defaultValue: "За период…"), symbol: "calendar") {
                clearingPeriod = true
            }
        }
        if chat.kind == .private || chat.kind == .group {
            HeroMenuItem(ChatLeaveTitle.title(for: chat.kind, isOwner: chat.isOwner), symbol: "rectangle.portrait.and.arrow.right", isDestructive: true) {
                confirmingLeave = true
            }
        }
    }

    private var peer: ChatMemberDTO? {
        members.first { $0.id != viewerID }
    }

    private var peerOnline: Bool {
        guard let peer else { return chat?.online == true }
        return realtime.onlineUsers.contains(peer.id) || peer.online == true
    }

    private var status: String? {
        guard let chat else { return nil }
        switch chat.kind {
        case .private:
            return ChatPresence.caption(online: peerOnline, lastSeen: peer?.lastSeenAt, known: peer != nil)
        case .saved:
            return String(localized: "chats.saved.hint", defaultValue: "Заметки и пересланное себе")
        default:
            let count = max(chat.memberCount, members.count)
            return count > 0 ? ChatPlural.members(count) : nil
        }
    }

    private func blockTitle(_ chat: ChatRecord) -> String {
        chat.blocked
            ? String(localized: "chats.unblock", defaultValue: "Разблокировать")
            : String(localized: "chats.block", defaultValue: "Заблокировать")
    }

    // MARK: Списки

    @ViewBuilder
    private func detailsSection(_ chat: ChatRecord) -> some View {
        let description = chat.chatDescription?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let showsProfile = chat.kind == .private && peer != nil
        if !description.isEmpty || showsProfile || canManageGroup {
            Section {
                if !description.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(String(localized: "chats.group.description", defaultValue: "Описание"))
                            .font(.footnote)
                            .foregroundStyle(Palette.mutedForeground)
                        Text(RichText.attributed(description))
                            .font(Typography.body)
                            .foregroundStyle(Palette.foreground)
                            .tint(Palette.primary)
                    }
                    .padding(.vertical, 2)
                }
                if showsProfile, let peer {
                    NavigationLink(value: AppRoute.profile(id: peer.id)) {
                        Label(String(localized: "home.profile.open", defaultValue: "Открыть профиль"), systemImage: "person.crop.circle")
                    }
                }
                if canManageGroup {
                    Button {
                        Task { await copyInvite() }
                    } label: {
                        if let inviteNotice {
                            Label(inviteNotice, systemImage: "checkmark")
                                .foregroundStyle(Palette.success)
                        } else {
                            Label(String(localized: "chats.invite.copy", defaultValue: "Скопировать ссылку-приглашение"), systemImage: "link")
                        }
                    }
                    Button {
                        confirmingInviteReset = true
                    } label: {
                        Label(String(localized: "chats.invite.reset", defaultValue: "Сбросить ссылку"), systemImage: "arrow.counterclockwise")
                    }
                }
            }
        }
    }

    /// Забаненные остаются в составе с отметкой: в общем списке им не место, а снять бан
    /// должно быть с кого — у админов для них своя секция ниже.
    private var activeMembers: [ChatMemberDTO] { members.filter { $0.banned != true } }
    private var bannedMembers: [ChatMemberDTO] { members.filter { $0.banned == true } }

    @ViewBuilder
    private func membersSection(_ chat: ChatRecord) -> some View {
        let canManage = chat.kind == .group && (chat.isAdmin || chat.isOwner)
        Section {
            if canManage {
                Button {
                    addingMember = true
                } label: {
                    Label(String(localized: "chats.member.add", defaultValue: "Добавить участника"), systemImage: "person.badge.plus")
                        .foregroundStyle(Palette.primary)
                }
            }
            ForEach(activeMembers) { member in
                NavigationLink(value: AppRoute.profile(id: member.id)) {
                    MemberRow(member: member, isOnline: realtime.onlineUsers.contains(member.id) || member.online == true)
                }
                .swipeActions(edge: .trailing) {
                    // Без `role: .destructive`: с ним список убирает строку сразу, ещё до
                    // ответа в подтверждении.
                    if canRemove(member, in: chat) {
                        Button {
                            memberAction = .remove(member)
                        } label: {
                            Label(String(localized: "chats.member.remove", defaultValue: "Исключить"), systemImage: "person.badge.minus")
                        }
                        .tint(Palette.destructive)
                    }
                }
                .contextMenu { memberMenu(member, in: chat) }
            }
            if members.isEmpty {
                if let membersFailure {
                    DashboardFailurePlaceholder(message: membersFailure) { await loadMembers() }
                } else if !membersLoaded {
                    ProgressView().frame(maxWidth: .infinity)
                } else {
                    DashboardEmptyRow(
                        text: String(localized: "chats.info.empty", defaultValue: "Здесь пока пусто"),
                        symbol: "person.2"
                    )
                }
            }
        } header: {
            Text(String(localized: "chats.group.members", defaultValue: "Участники"))
        }

        if canManage, !bannedMembers.isEmpty {
            Section {
                ForEach(bannedMembers) { member in
                    NavigationLink(value: AppRoute.profile(id: member.id)) {
                        MemberRow(member: member, isOnline: false)
                            .opacity(0.6)
                    }
                    .swipeActions(edge: .trailing) {
                        if chat.isOwner {
                            Button {
                                Task { await setBanned(false, member) }
                            } label: {
                                Label(String(localized: "chats.member.unban", defaultValue: "Разблокировать"), systemImage: "person.badge.shield.checkmark")
                            }
                            .tint(Palette.primary)
                        }
                    }
                    .contextMenu {
                        Button {
                            AppServices.router.stacks[.chats, default: []].append(.profile(id: member.id))
                        } label: {
                            Label(String(localized: "home.profile.open", defaultValue: "Открыть профиль"), systemImage: "person.crop.circle")
                        }
                        if chat.isOwner {
                            Button {
                                Task { await setBanned(false, member) }
                            } label: {
                                Label(String(localized: "chats.member.unban", defaultValue: "Разблокировать"), systemImage: "person.badge.shield.checkmark")
                            }
                        }
                    }
                }
            } header: {
                Text(String(localized: "chats.member.bannedList", defaultValue: "Заблокированные"))
            } footer: {
                Text(String(localized: "chats.member.bannedHint", defaultValue: "Не видят группу и не могут вернуться даже по ссылке-приглашению."))
            }
        }
    }

    /// Меню участника — по правам, как в вебе: назначать админов, передавать группу и
    /// банить может только создатель, исключать — и админ, но не других админов.
    @ViewBuilder
    private func memberMenu(_ member: ChatMemberDTO, in chat: ChatRecord) -> some View {
        let isMe = member.id == viewerID
        if !isMe {
            Button {
                Task { await openPrivate(with: member) }
            } label: {
                Label(String(localized: "profile.message", defaultValue: "Написать"), systemImage: "message")
            }
        }
        Button {
            AppServices.router.stacks[.chats, default: []].append(.profile(id: member.id))
        } label: {
            Label(String(localized: "home.profile.open", defaultValue: "Открыть профиль"), systemImage: "person.crop.circle")
        }
        if chat.kind == .group, chat.isOwner, !isMe {
            Divider()
            Button {
                Task {
                    await run { try await api.setAdmin(member.isAdmin != true, chatID: chatID, userID: member.id) }
                    await loadMembers()
                }
            } label: {
                Label(
                    member.isAdmin == true
                        ? String(localized: "chats.admin.revoke", defaultValue: "Снять админа")
                        : String(localized: "chats.admin.grant", defaultValue: "Сделать админом"),
                    systemImage: "star"
                )
            }
            Button {
                memberAction = .transfer(member)
            } label: {
                Label(String(localized: "chats.member.transfer", defaultValue: "Передать владение"), systemImage: "crown")
            }
        }
        if chat.kind == .group, chat.isOwner, !isMe {
            Divider()
            Button(role: .destructive) {
                memberAction = .ban(member)
            } label: {
                Label(String(localized: "chats.member.ban", defaultValue: "Заблокировать в группе"), systemImage: "hand.raised")
            }
        }
        if canRemove(member, in: chat) {
            Button(role: .destructive) {
                memberAction = .remove(member)
            } label: {
                Label(String(localized: "chats.member.remove", defaultValue: "Исключить"), systemImage: "person.badge.minus")
            }
        }
    }

    /// Создателя исключить нельзя (он админ), админа исключает только создатель.
    private func canRemove(_ member: ChatMemberDTO, in chat: ChatRecord) -> Bool {
        chat.kind == .group && member.id != viewerID
            && (chat.isOwner || (chat.isAdmin && member.isAdmin != true))
    }

    // MARK: Диалоги

    private func withDialogs<V: View>(_ view: V) -> some View {
        view
            .sheet(isPresented: $editing) {
                if let chat { GroupEditSheet(chat: chat) { await reloadChat() } }
            }
            .sheet(isPresented: $addingMember) {
                MemberPickerSheet(excluded: Set(members.map(\.id))) { userID in
                    do {
                        try await api.addMember(chatID: chatID, userID: userID)
                        await loadMembers()
                    } catch {
                        failure = (error as? APIError)?.displayMessage
                    }
                }
            }
            .sheet(isPresented: $searching, onDismiss: openPickedMessage) {
                ChatInfoSearchSheet(chatID: chatID) { messageID in
                    pickedMessage = messageID
                }
            }
            .sheet(isPresented: $clearingPeriod) {
                ChatClearPeriodSheet(chatID: chatID)
            }
            .sheet(isPresented: $pickingDay, onDismiss: openPickedDay) {
                ChatCalendarSheet(chatID: chatID) { day in pickedDay = day }
            }
            .alert(
                String(localized: "chats.clear.title", defaultValue: "Очистить историю у себя?"),
                isPresented: $confirmingClear
            ) {
                Button(String(localized: "chats.clear", defaultValue: "Очистить историю"), role: .destructive) {
                    Task {
                        await run {
                            try await api.clearHistory(chatID: chatID)
                            // Лента читает базу: без этого очищенная история оставалась бы на экране.
                            try await MessageStore().clearHistory(chatID: chatID)
                        }
                    }
                }
                Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
            }
            .alert(
                ChatLeaveTitle.question(for: chat?.kind ?? .private, isOwner: chat?.isOwner ?? false),
                isPresented: $confirmingLeave
            ) {
                Button(ChatLeaveTitle.title(for: chat?.kind ?? .private, isOwner: chat?.isOwner ?? false), role: .destructive) {
                    Task { await leave() }
                }
                Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
            }
            .alert(
                chat?.blocked == true
                    ? String(localized: "chats.unblock.title", defaultValue: "Разблокировать?")
                    : String(localized: "chats.block.title", defaultValue: "Заблокировать пользователя?"),
                isPresented: $confirmingBlock
            ) {
                Button(
                    chat?.blocked == true
                        ? String(localized: "chats.unblock", defaultValue: "Разблокировать")
                        : String(localized: "chats.block", defaultValue: "Заблокировать"),
                    role: chat?.blocked == true ? nil : .destructive
                ) {
                    Task { await toggleBlock() }
                }
                Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
            } message: {
                if chat?.blocked != true {
                    Text(String(localized: "chats.block.message", defaultValue: "Он не сможет писать вам, дружба будет удалена."))
                }
            }
            .alert(
                String(localized: "chats.invite.reset.title", defaultValue: "Сбросить ссылку-приглашение?"),
                isPresented: $confirmingInviteReset
            ) {
                Button(String(localized: "chats.invite.reset", defaultValue: "Сбросить ссылку"), role: .destructive) {
                    Task { await copyInvite(reset: true) }
                }
                Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
            } message: {
                Text(String(localized: "chats.invite.reset.message", defaultValue: "Старая ссылка перестанет работать. Новая будет скопирована."))
            }
            .alert(
                memberAction?.title ?? "",
                isPresented: Binding(get: { memberAction != nil }, set: { if !$0 { memberAction = nil } }),
                presenting: memberAction
            ) { action in
                Button(action.confirmTitle, role: action.isDestructive ? .destructive : nil) {
                    Task { await perform(action) }
                }
                Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
            } message: { action in
                if let message = action.message {
                    Text(message)
                }
            }
            .sensoryFeedback(.success, trigger: copiedInvite)
            .task(id: copiedInvite) {
                guard inviteNotice != nil else { return }
                try? await Task.sleep(for: .seconds(2))
                guard !Task.isCancelled else { return }
                inviteNotice = nil
            }
    }

    /// Найденное сообщение: переписка под этим экраном откроется на нём.
    private func openPickedMessage() {
        guard let pickedMessage else { return }
        self.pickedMessage = nil
        showInChat(pickedMessage)
    }

    /// День из календаря: переписка под этим экраном откроется на нём.
    private func openPickedDay() {
        guard let pickedDay else { return }
        self.pickedDay = nil
        shared.stopVoice()
        ChatJumpRequests.shared.days[chatID] = pickedDay
        dismiss()
    }

    /// «Показать в чате» — из поиска или из общих материалов: переписка под этим
    /// экраном откроется на сообщении.
    private func showInChat(_ messageID: String) {
        shared.stopVoice()
        ChatJumpRequests.shared.pending[chatID] = messageID
        dismiss()
    }

    // MARK: Загрузка и действия

    private func reloadChat() async {
        chat = try? await AppServices.database.reader.read { db in try ChatRecord.fetchOne(db, key: chatID) }
    }

    private func loadMembers() async {
        guard chat?.kind != .saved else {
            membersLoaded = true
            return
        }
        do {
            members = try await api.members(chatID: chatID)
            membersFailure = nil
        } catch is CancellationError {
            return
        } catch {
            // Прежний состав остаётся; сбой виден, только когда показать нечего.
            membersFailure = error.userMessage
        }
        membersLoaded = true
    }

    private func run(_ action: () async throws -> Void) async {
        do {
            try await action()
            failure = nil
        } catch {
            failure = error.userMessage
        }
    }

    private func setMuted(_ muted: Bool, minutes: Int?, importantOnly: Bool) async {
        if muted {
            await run { try await api.mute(chatID: chatID, minutes: minutes, importantOnly: importantOnly) }
        } else {
            await run { try await ChatsAPI().setMuted(false, chatID: chatID) }
        }
        try? await ChatStore().setMuted(muted, chatID: chatID)
        await reloadChat()
    }

    private func toggleBlock() async {
        guard let peer, let chat else { return }
        let blocked = !chat.blocked
        await run { try await api.setBlocked(blocked, userID: peer.id) }
        try? await AppServices.database.writer.write { db in
            guard var row = try ChatRecord.fetchOne(db, key: chatID) else { return }
            row.blocked = blocked
            try row.update(db)
        }
        await reloadChat()
    }

    /// Ссылка того же вида, что раздаёт веб: `/join-chat/<id>?k=<код>`. Сброс выдаёт новый
    /// код — прежняя ссылка перестаёт работать, а новая сразу в буфере.
    private func copyInvite(reset: Bool = false) async {
        do {
            let code = reset ? try await api.resetInviteCode(chatID: chatID) : try await api.inviteCode(chatID: chatID)
            if let base = AppConfiguration.webBaseURL {
                var components = URLComponents(
                    url: base.appendingPathComponent("join-chat").appendingPathComponent(chatID),
                    resolvingAgainstBaseURL: false
                )
                components?.queryItems = [URLQueryItem(name: "k", value: code)]
                UIPasteboard.general.url = components?.url
            } else {
                UIPasteboard.general.string = code
            }
            inviteNotice = reset
                ? String(localized: "chats.invite.resetDone", defaultValue: "Новая ссылка скопирована")
                : String(localized: "chats.invite.copied", defaultValue: "Ссылка скопирована")
            copiedInvite += 1
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
        }
    }

    private func perform(_ action: MemberAction) async {
        switch action {
        case .remove(let member):
            await run { try await api.removeMember(chatID: chatID, userID: member.id) }
            await loadMembers()
        case .ban(let member):
            await setBanned(true, member)
        case .transfer(let member):
            await transferOwnership(to: member)
        }
    }

    private func setBanned(_ banned: Bool, _ member: ChatMemberDTO) async {
        await run { try await api.setBanned(banned, chatID: chatID, userID: member.id) }
        await loadMembers()
    }

    /// После передачи я остаюсь админом: «Изм.» и добавление участников остаются, а
    /// меню создателя (фото, бан, админы) уходит сразу — не дожидаясь списка чатов.
    private func transferOwnership(to member: ChatMemberDTO) async {
        do {
            try await api.transferOwnership(chatID: chatID, to: member.id)
            try? await ChatStore().setOwner(false, chatID: chatID)
            failure = nil
        } catch {
            if !(error is CancellationError) { failure = error.userMessage }
        }
        await reloadChat()
        await loadMembers()
    }

    private func openPrivate(with member: ChatMemberDTO) async {
        do {
            try await PrivateChatOpener.open(with: member.id, api: api)
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
        }
    }

    private func leave() async {
        do {
            try await api.deleteChat(chatID: chatID)
            _ = try? await AppServices.database.writer.write { db in try ChatRecord.deleteOne(db, key: chatID) }
            AppServices.router.stacks[.chats] = []
        } catch {
            failure = (error as? APIError)?.displayMessage
        }
    }
}

/// Опасные действия над участником группы — все через подтверждение.
private enum MemberAction {
    case remove(ChatMemberDTO)
    case ban(ChatMemberDTO)
    case transfer(ChatMemberDTO)

    var member: ChatMemberDTO {
        switch self {
        case .remove(let member), .ban(let member), .transfer(let member): return member
        }
    }

    private var name: String {
        member.name.isEmpty ? String(localized: "home.someone", defaultValue: "Кто-то") : member.name
    }

    var title: String {
        switch self {
        case .remove:
            return String(localized: "chats.member.remove.title", defaultValue: "Исключить \(name) из группы?")
        case .ban:
            return String(localized: "chats.member.ban.title", defaultValue: "Заблокировать \(name) в группе?")
        case .transfer:
            return String(localized: "chats.member.transfer.title", defaultValue: "Передать группу \(name)?")
        }
    }

    var message: String? {
        switch self {
        case .remove:
            return nil
        case .ban:
            return String(
                localized: "chats.member.ban.message",
                defaultValue: "Участник покинет группу и не сможет вернуться даже по ссылке-приглашению, пока вы его не разблокируете."
            )
        case .transfer:
            return String(
                localized: "chats.member.transfer.message",
                defaultValue: "Новый владелец сможет менять фото, назначать админов, блокировать участников и удалить группу. Вы останетесь админом, а вернуть владение сможет только он."
            )
        }
    }

    var confirmTitle: String {
        switch self {
        case .remove: return String(localized: "chats.member.remove", defaultValue: "Исключить")
        case .ban: return String(localized: "chats.block", defaultValue: "Заблокировать")
        case .transfer: return String(localized: "chats.member.transfer.confirm", defaultValue: "Передать")
        }
    }

    var isDestructive: Bool {
        if case .transfer = self { return false }
        return true
    }
}

/// Круглая стеклянная кнопка шапки с подписью снизу — та же, что у карточек людей и
/// групп (`HeroActionLabel`): круги в рядах всего приложения одного размера.
private struct ChatInfoActionButton: View {
    let title: String
    let symbol: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HeroActionLabel(title: title, symbol: symbol)
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
    }
}

/// Поиск по сообщениям этого чата. Выбранное открывается в переписке.
private struct ChatInfoSearchSheet: View {
    let chatID: String
    let pick: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var results: [ChatMessageDTO] = []
    @State private var isSearching = false
    @State private var failure: String?
    @State private var isOffline = false
    private let api: ChatActing = ChatsAPI()

    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        NavigationStack {
            List(results, id: \.id) { message in
                Button {
                    pick(message.id)
                    dismiss()
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(message.sender?.name ?? "")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Palette.foreground)
                                .lineLimit(1)
                            Spacer(minLength: Spacing.md)
                            Text(ChatMoment.short(message.createdAt))
                                .font(Typography.tabular(.footnote))
                                .foregroundStyle(Palette.mutedForeground)
                        }
                        Text(message.content)
                            .font(.subheadline)
                            .foregroundStyle(Palette.mutedForeground)
                            .lineLimit(2)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .listStyle(.plain)
            .overlay {
                if results.isEmpty {
                    if isSearching {
                        ProgressView()
                    } else if let failure {
                        ErrorStateView(message: failure, isOffline: isOffline) { await search() }
                    } else if trimmed.count >= 2 {
                        ContentUnavailableView.search(text: trimmed)
                    } else {
                        ContentUnavailableView(
                            String(localized: "chats.info.search.hint", defaultValue: "Найдите сообщение в этом чате"),
                            systemImage: "magnifyingglass"
                        )
                    }
                }
            }
            .searchable(
                text: $query,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: Text(String(localized: "chats.info.search.prompt", defaultValue: "Поиск сообщений"))
            )
            .navigationTitle(Text(String(localized: "chats.info.search.title", defaultValue: "Поиск в чате")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
            }
            .task(id: trimmed) { await search() }
        }
    }

    private func search() async {
        guard trimmed.count >= 2 else {
            results = []
            failure = nil
            return
        }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        isSearching = true
        defer { isSearching = false }
        do {
            results = try await api.searchMessages(String(trimmed.prefix(100)), chatID: chatID)
            failure = nil
        } catch {
            guard !Task.isCancelled else { return }
            results = []
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }
}

private struct MemberRow: View {
    let member: ChatMemberDTO
    let isOnline: Bool

    var body: some View {
        HStack(spacing: Spacing.lg) {
            ZStack(alignment: .bottomTrailing) {
                AvatarView(url: member.avatarUrl, name: member.name, size: 40)
                if isOnline {
                    Circle().fill(Palette.success)
                        .frame(width: 11, height: 11)
                        .overlay(Circle().strokeBorder(Palette.card, lineWidth: 2))
                }
            }
            VStack(alignment: .leading, spacing: 0) {
                Text(member.name.isEmpty ? String(localized: "home.someone", defaultValue: "Кто-то") : member.name)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(1)
                Text(subtitle)
                    .font(Typography.meta)
                    .foregroundStyle(isOnline ? Palette.primary : Palette.mutedForeground)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            if member.isAdmin == true {
                Text(String(localized: "chats.admin", defaultValue: "админ"))
                    .font(.caption)
                    .foregroundStyle(Palette.mutedForeground)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        if isOnline { return String(localized: "chats.online", defaultValue: "в сети") }
        if let role = member.role.flatMap(Role.init(rawValue:))?.feedTitle { return role }
        if let seen = member.lastSeenAt {
            return String(localized: "chats.lastSeen", defaultValue: "был(а) \(seen.formatted(.relative(presentation: .named)))")
        }
        return ""
    }
}

/// Разделы содержимого чата.
enum ChatMediaKindTab: String, CaseIterable, Identifiable {
    case media, files, voice, links
    var id: String { rawValue }

    var title: String {
        switch self {
        case .media: return String(localized: "chats.info.media", defaultValue: "Медиа")
        case .files: return String(localized: "chats.info.files", defaultValue: "Файлы")
        case .voice: return String(localized: "chats.info.voice", defaultValue: "Голосовые")
        case .links: return String(localized: "chats.info.links", defaultValue: "Ссылки")
        }
    }

    var kind: ChatMediaKind? {
        switch self {
        case .media: return .media
        case .files: return .file
        case .voice: return .voice
        case .links: return nil
        }
    }
}

/// Правка группы: фото, название и описание. Фото меняет только создатель (у админов
/// сервер его не примет) и сразу, без «Сохранить», — как в вебе и Telegram; название и
/// описание уходят одной правкой по кнопке.
private struct GroupEditSheet: View {
    let chat: ChatRecord
    let saved: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var description = ""
    @State private var avatarURL: String?
    /// Выбранный снимок: виден сразу, пока идёт загрузка, и остаётся после неё —
    /// иначе картинка мигнула бы пустым кругом, пока грузится по новой ссылке.
    @State private var photo: UIImage?
    @State private var uploading = false
    @State private var failure: String?
    private let api: ChatActing = ChatsAPI()

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    GroupAvatarButton(
                        title: title.isEmpty ? (chat.title ?? "") : title,
                        avatarURL: avatarURL,
                        image: photo,
                        busy: uploading,
                        removable: avatarURL != nil || photo != nil,
                        pick: { image in Task { await upload(image) } },
                        remove: { Task { await removeAvatar() } }
                    )
                    .disabled(!chat.isOwner)
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
                Section {
                    TextField(String(localized: "chats.group.title", defaultValue: "Название группы"), text: $title)
                    TextField(
                        String(localized: "chats.group.description", defaultValue: "Описание"),
                        text: $description,
                        axis: .vertical
                    )
                    .lineLimit(3...8)
                }
                if let failure {
                    Text(failure).foregroundStyle(Palette.destructive)
                }
            }
            .navigationTitle(Text(String(localized: "feed.edit", defaultValue: "Редактировать")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "common.save", defaultValue: "Сохранить")) {
                        Task { await save() }
                    }
                    .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear {
                title = chat.title ?? ""
                description = chat.chatDescription ?? ""
                avatarURL = chat.avatarUrl
            }
        }
    }

    private func save() async {
        let newTitle = String(title.trimmingCharacters(in: .whitespaces).prefix(150))
        let newDescription = String(description.prefix(1000))
        do {
            try await api.updateGroup(chatID: chat.id, title: newTitle, description: newDescription)
            let id = chat.id
            try? await AppServices.database.writer.write { db in
                guard var row = try ChatRecord.fetchOne(db, key: id) else { return }
                row.title = newTitle
                row.chatDescription = newDescription
                try row.update(db)
            }
            await saved()
            dismiss()
        } catch {
            failure = (error as? APIError)?.displayMessage
        }
    }

    private func upload(_ image: UIImage?) async {
        guard let jpeg = await PhotoJPEG.encode(image, maxSide: PhotoJPEG.avatarSide) else {
            failure = String(localized: "profile.imageUnreadable", defaultValue: "Не удалось прочитать изображение")
            return
        }
        let previous = photo
        photo = image
        uploading = true
        defer { uploading = false }
        do {
            let url = try await api.uploadGroupAvatar(chatID: chat.id, jpeg: jpeg)
            avatarURL = url
            try? await ChatStore().setAvatar(url, chatID: chat.id)
            await saved()
            failure = nil
        } catch {
            photo = previous
            if !(error is CancellationError) { failure = error.userMessage }
        }
    }

    private func removeAvatar() async {
        uploading = true
        defer { uploading = false }
        do {
            try await api.removeGroupAvatar(chatID: chat.id)
            photo = nil
            avatarURL = nil
            try? await ChatStore().setAvatar(nil, chatID: chat.id)
            await saved()
            failure = nil
        } catch {
            if !(error is CancellationError) { failure = error.userMessage }
        }
    }
}

/// Круглое фото группы с карандашом: касание открывает меню источника у самого фото.
/// Общее для правки группы и шага «Новая группа».
struct GroupAvatarButton: View {
    let title: String
    let avatarURL: String?
    /// Выбранный снимок — важнее ссылки: его видно до и во время загрузки.
    let image: UIImage?
    var busy = false
    let removable: Bool
    let pick: (UIImage?) -> Void
    var remove: () -> Void = {}

    @Environment(\.isEnabled) private var isEnabled
    @State private var choosing = false
    @ScaledMetric(relativeTo: .title) private var size: CGFloat = 96

    private var side: CGFloat { min(size, 128) }

    var body: some View {
        Button { choosing = true } label: {
            ZStack {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .frame(width: side, height: side)
                        .clipShape(Circle())
                } else if avatarURL == nil, title.trimmingCharacters(in: .whitespaces).isEmpty {
                    // Новая группа без названия и фото: подсказка, что сюда ставится снимок.
                    Circle().fill(Palette.primary.opacity(0.12))
                    Image(systemName: "camera.fill")
                        .font(.system(size: side * 0.32, weight: .semibold))
                        .foregroundStyle(Palette.primary)
                } else {
                    ChatAvatarView(title: title, kind: .group, avatarURL: avatarURL, size: side)
                }
                if busy {
                    Circle().fill(Color.black.opacity(0.35))
                    ProgressView().tint(.white)
                }
            }
            .frame(width: side, height: side)
            .overlay(alignment: .bottomTrailing) {
                if isEnabled { EditBadge() }
            }
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .padding(.vertical, Spacing.sm)
        .accessibilityLabel(Text(String(localized: "chats.group.photo", defaultValue: "Фото группы")))
        .photoSourceMenu(isPresented: $choosing, removable: removable, pick: pick, remove: remove)
    }
}

/// Выбор человека для добавления в группу.
private struct MemberPickerSheet: View {
    let excluded: Set<String>
    let pick: (String) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var people: [DirectoryUserDTO] = []
    private let api: ChatActing = ChatsAPI()

    var body: some View {
        NavigationStack {
            List(people.filter { !excluded.contains($0.id) }) { person in
                Button {
                    Task {
                        await pick(person.id)
                        dismiss()
                    }
                } label: {
                    HStack(spacing: Spacing.lg) {
                        AvatarView(url: person.avatarUrl, name: person.name, size: 36)
                        Text(person.name).foregroundStyle(Palette.foreground)
                    }
                }
            }
            .searchable(
                text: $query,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: Text(String(localized: "search.people", defaultValue: "Имя или логин"))
            )
            .navigationTitle(Text(String(localized: "chats.member.add", defaultValue: "Добавить участника")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
            }
            .task(id: query) {
                let trimmed = query.trimmingCharacters(in: .whitespaces)
                guard trimmed.count >= 2 else { return }
                try? await Task.sleep(for: .milliseconds(300))
                guard !Task.isCancelled else { return }
                people = (try? await api.directory(trimmed)) ?? []
            }
        }
    }
}
