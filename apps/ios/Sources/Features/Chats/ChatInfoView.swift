import SwiftUI
import UIKit

/// Информация о чате: кто в нём, что в нём отправляли и что с ним можно сделать.
///
/// Набор действий зависит от вида чата и роли: группой управляют её админы,
/// официальные чаты заводит система и их не переименовывают.
struct ChatInfoView: View {
    let chatID: String

    @Environment(\.viewerID) private var viewerID
    @Environment(\.dismiss) private var dismiss
    @State private var chat: ChatRecord?
    @State private var members: [ChatMemberDTO] = []
    @State private var section: ChatMediaKindTab = .media
    @State private var editing = false
    @State private var addingMember = false
    @State private var confirmingLeave = false
    @State private var confirmingClear = false
    @State private var confirmingBlock = false
    @State private var copiedInvite = 0
    @State private var failure: String?
    private let api: ChatActing = ChatsAPI()
    private var realtime: RealtimeCoordinator { AppServices.realtime }

    var body: some View {
        List {
            header
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)

            if let failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            if let chat {
                actionsSection(chat)
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
                    ChatContentList(chatID: chatID, tab: section)
                }
                dangerSection(chat)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "chats.info.title", defaultValue: "Информация")))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if chat?.kind == .group, chat?.isAdmin == true || chat?.isOwner == true {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(String(localized: "feed.edit", defaultValue: "Редактировать")) { editing = true }
                }
            }
        }
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
        .confirmationDialog(
            String(localized: "chats.clear.title", defaultValue: "Очистить историю у себя?"),
            isPresented: $confirmingClear,
            titleVisibility: .visible
        ) {
            Button(String(localized: "chats.clear", defaultValue: "Очистить историю"), role: .destructive) {
                Task { await run { try await api.clearHistory(chatID: chatID) } }
            }
        }
        .confirmationDialog(
            String(localized: "chats.delete.chat.title", defaultValue: "Удалить чат?"),
            isPresented: $confirmingLeave,
            titleVisibility: .visible
        ) {
            Button(ChatLeaveTitle.title(for: chat?.kind ?? .private), role: .destructive) {
                Task { await leave() }
            }
        }
        .confirmationDialog(
            chat?.blocked == true
                ? String(localized: "chats.unblock.title", defaultValue: "Разблокировать?")
                : String(localized: "chats.block.title", defaultValue: "Заблокировать пользователя?"),
            isPresented: $confirmingBlock,
            titleVisibility: .visible
        ) {
            Button(
                chat?.blocked == true
                    ? String(localized: "chats.unblock", defaultValue: "Разблокировать")
                    : String(localized: "chats.block", defaultValue: "Заблокировать"),
                role: chat?.blocked == true ? nil : .destructive
            ) {
                Task { await toggleBlock() }
            }
        } message: {
            if chat?.blocked != true {
                Text(String(localized: "chats.block.message", defaultValue: "Он не сможет писать вам, дружба будет удалена."))
            }
        }
        .sensoryFeedback(.success, trigger: copiedInvite)
        .task {
            await reloadChat()
            await loadMembers()
        }
    }

    // MARK: Шапка

    private var header: some View {
        VStack(spacing: Spacing.md) {
            ChatAvatarView(
                title: chat.map { $0.title ?? ChatTitle.fallback(for: $0) },
                kind: chat?.kind ?? .unknown,
                avatarURL: chat?.avatarUrl,
                online: chat?.kind == .private && peerOnline,
                size: 96
            )
            HStack(spacing: Spacing.xs) {
                Text(chat.map { $0.title ?? ChatTitle.fallback(for: $0) } ?? "")
                    .font(.title2.weight(.semibold))
                    .multilineTextAlignment(.center)
                if chat?.kind.isOfficial == true {
                    Image(systemName: "checkmark.seal.fill").foregroundStyle(Palette.primary)
                }
            }
            if let status {
                Text(status)
                    .font(Typography.meta)
                    .foregroundStyle(peerOnline ? Palette.primary : Palette.mutedForeground)
            }
            if let description = chat?.chatDescription, !description.isEmpty {
                Text(RichText.attributed(description))
                    .font(Typography.body)
                    .foregroundStyle(Palette.foreground)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, Spacing.md)
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
            if peerOnline { return String(localized: "chats.online", defaultValue: "в сети") }
            if let seen = peer?.lastSeenAt {
                return String(localized: "chats.lastSeen", defaultValue: "был(а) \(seen.formatted(.relative(presentation: .named)))")
            }
            return nil
        case .saved:
            return String(localized: "chats.saved.hint", defaultValue: "Заметки и пересланное себе")
        default:
            let count = max(chat.memberCount, members.count)
            return count > 0 ? String(localized: "chats.members", defaultValue: "Участников: \(count)") : nil
        }
    }

    // MARK: Действия

    @ViewBuilder
    private func actionsSection(_ chat: ChatRecord) -> some View {
        Section {
            MuteMenu(isMuted: chat.muted) { minutes, importantOnly in
                Task {
                    await run { try await api.mute(chatID: chatID, minutes: minutes, importantOnly: importantOnly) }
                    try? await ChatStore().setMuted(true, chatID: chatID)
                }
            } unmute: {
                Task {
                    await run { try await ChatsAPI().setMuted(false, chatID: chatID) }
                    try? await ChatStore().setMuted(false, chatID: chatID)
                }
            }
            if chat.kind == .private, let peer {
                NavigationLink(value: AppRoute.profile(id: peer.id)) {
                    Label(String(localized: "home.profile.open", defaultValue: "Открыть профиль"), systemImage: "person.crop.circle")
                }
                Button(role: chat.blocked ? nil : .destructive) {
                    confirmingBlock = true
                } label: {
                    Label(
                        chat.blocked
                            ? String(localized: "chats.unblock", defaultValue: "Разблокировать")
                            : String(localized: "chats.block", defaultValue: "Заблокировать"),
                        systemImage: "hand.raised"
                    )
                }
            }
            if chat.kind == .group, chat.isAdmin || chat.isOwner {
                Button {
                    Task { await copyInvite() }
                } label: {
                    Label(String(localized: "chats.invite.copy", defaultValue: "Скопировать ссылку-приглашение"), systemImage: "link")
                }
            }
        }
    }

    @ViewBuilder
    private func membersSection(_ chat: ChatRecord) -> some View {
        let canManage = chat.kind == .group && (chat.isAdmin || chat.isOwner)
        Section {
            if canManage {
                Button {
                    addingMember = true
                } label: {
                    Label(String(localized: "chats.member.add", defaultValue: "Добавить участника"), systemImage: "person.badge.plus")
                }
            }
            ForEach(members) { member in
                MemberRow(member: member, isOnline: realtime.onlineUsers.contains(member.id) || member.online == true)
                    .swipeActions(edge: .trailing) {
                        if canManage, member.id != viewerID {
                            Button(role: .destructive) {
                                Task {
                                    await run { try await api.removeMember(chatID: chatID, userID: member.id) }
                                    await loadMembers()
                                }
                            } label: {
                                Label(String(localized: "chats.member.remove", defaultValue: "Исключить"), systemImage: "person.badge.minus")
                            }
                        }
                    }
                    .contextMenu {
                        NavigationLink(value: AppRoute.profile(id: member.id)) {
                            Label(String(localized: "home.profile.open", defaultValue: "Открыть профиль"), systemImage: "person.crop.circle")
                        }
                        if chat.kind == .group, chat.isOwner, member.id != viewerID {
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
                        }
                    }
            }
        } header: {
            Text(String(localized: "chats.group.members", defaultValue: "Участники"))
        }
    }

    @ViewBuilder
    private func dangerSection(_ chat: ChatRecord) -> some View {
        Section {
            Button(role: .destructive) {
                confirmingClear = true
            } label: {
                Label(String(localized: "chats.clear", defaultValue: "Очистить историю"), systemImage: "eraser")
            }
            if chat.kind == .private || chat.kind == .group {
                Button(role: .destructive) {
                    confirmingLeave = true
                } label: {
                    Label(ChatLeaveTitle.title(for: chat.kind), systemImage: "rectangle.portrait.and.arrow.right")
                }
            }
        }
    }

    // MARK: Загрузка и действия

    private func reloadChat() async {
        chat = try? await AppServices.database.reader.read { db in try ChatRecord.fetchOne(db, key: chatID) }
    }

    private func loadMembers() async {
        guard chat?.kind != .saved else { return }
        if let list = try? await api.members(chatID: chatID) { members = list }
    }

    private func run(_ action: () async throws -> Void) async {
        do {
            try await action()
            failure = nil
        } catch {
            failure = error.userMessage
        }
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

    /// Ссылка того же вида, что раздаёт веб: `/join-chat/<id>?k=<код>`.
    private func copyInvite() async {
        do {
            let code = try await api.inviteCode(chatID: chatID)
            guard let base = AppConfiguration.webBaseURL else {
                UIPasteboard.general.string = code
                copiedInvite += 1
                return
            }
            var components = URLComponents(
                url: base.appendingPathComponent("join-chat").appendingPathComponent(chatID),
                resolvingAgainstBaseURL: false
            )
            components?.queryItems = [URLQueryItem(name: "k", value: code)]
            UIPasteboard.general.url = components?.url
            copiedInvite += 1
        } catch {
            failure = (error as? APIError)?.displayMessage
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

/// Список выбранного раздела: сетка фото и видео, строки файлов и ссылок.
private struct ChatContentList: View {
    let chatID: String
    let tab: ChatMediaKindTab

    @State private var media: [ChatMediaItemDTO] = []
    @State private var links: [ChatLinkItemDTO] = []
    @State private var loaded = false
    private let api: ChatActing = ChatsAPI()

    var body: some View {
        Group {
            if tab == .media, !media.isEmpty {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 2)], spacing: 2) {
                    ForEach(media) { item in
                        ChatMediaThumb(item: item)
                    }
                }
            } else if tab == .links, !links.isEmpty {
                ForEach(links) { link in
                    if let preview = link.linkPreview, let url = URL(string: preview.url) {
                        Link(destination: url) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(preview.title ?? url.host() ?? preview.url)
                                    .font(Typography.body.weight(.medium))
                                    .foregroundStyle(Palette.foreground)
                                    .lineLimit(2)
                                Text(preview.url)
                                    .font(Typography.meta)
                                    .foregroundStyle(Palette.primary)
                                    .lineLimit(1)
                            }
                        }
                    }
                }
            } else if (tab == .files || tab == .voice), !media.isEmpty {
                ForEach(media) { item in
                    HStack(spacing: Spacing.lg) {
                        Image(systemName: tab == .voice ? "waveform" : "doc.fill")
                            .foregroundStyle(Palette.primary)
                            .frame(width: 32)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(item.name ?? String(localized: "chats.preview.file", defaultValue: "Файл"))
                                .lineLimit(1)
                            Text(detail(for: item))
                                .font(Typography.meta)
                                .foregroundStyle(Palette.mutedForeground)
                        }
                    }
                }
            } else if loaded {
                Text(String(localized: "chats.info.empty", defaultValue: "Здесь пока пусто"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .frame(maxWidth: .infinity)
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .task(id: tab) { await load() }
    }

    private func detail(for item: ChatMediaItemDTO) -> String {
        var parts = [item.createdAt.formatted(date: .abbreviated, time: .omitted)]
        if let size = item.size {
            parts.append(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))
        }
        if let duration = item.durationMs {
            parts.append(Duration.milliseconds(duration).formatted(.time(pattern: .minuteSecond)))
        }
        return parts.joined(separator: " · ")
    }

    private func load() async {
        loaded = false
        media = []
        links = []
        if let kind = tab.kind {
            media = (try? await api.media(chatID: chatID, kind: kind, cursor: nil).items) ?? []
        } else {
            links = (try? await api.links(chatID: chatID, cursor: nil).items) ?? []
        }
        loaded = true
    }
}

/// Плитка сетки медиа: ссылка подписывается по требованию, картинка — из кэша по id.
private struct ChatMediaThumb: View {
    let item: ChatMediaItemDTO

    @State private var url: URL?

    var body: some View {
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                RemoteImage(url: url, cacheKey: "chatmedia:\(item.id)", placeholder: item.placeholder)
                    .id(url)
            }
            .overlay(alignment: .bottomLeading) {
                if item.mime.hasPrefix("video/") {
                    Image(systemName: "play.fill")
                        .font(.caption)
                        .foregroundStyle(.white)
                        .padding(Spacing.xs)
                }
            }
            .clipped()
            .task { url = await AppServices.attachmentURLs.url(for: item.id) }
    }
}

/// Правка группы: название и описание.
private struct GroupEditSheet: View {
    let chat: ChatRecord
    let saved: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var description = ""
    @State private var failure: String?
    private let api: ChatActing = ChatsAPI()

    var body: some View {
        NavigationStack {
            Form {
                TextField(String(localized: "chats.group.title", defaultValue: "Название группы"), text: $title)
                TextField(
                    String(localized: "chats.group.description", defaultValue: "Описание"),
                    text: $description,
                    axis: .vertical
                )
                .lineLimit(3...8)
                if let failure {
                    Text(failure).foregroundStyle(Palette.destructive)
                }
            }
            .navigationTitle(Text(String(localized: "feed.edit", defaultValue: "Редактировать")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "common.cancel", defaultValue: "Отмена")) { dismiss() }
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
                    Button(String(localized: "common.cancel", defaultValue: "Отмена")) { dismiss() }
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
