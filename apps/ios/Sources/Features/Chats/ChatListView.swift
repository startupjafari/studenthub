import SwiftUI

/// Список чатов.
///
/// Рисуется из базы и потому открывается мгновенно и в самолёте. Сеть здесь только
/// догоняет: ошибка запроса показывается строкой сверху, а список продолжает жить.
/// Поиск — системный: по названиям чатов сразу, по людям и сообщениям — запросом.
struct ChatListView: View {
    @State private var model = ChatListModel()
    @State private var query = ""
    @State private var composing: NewChatKind?
    @State private var clearing: ChatListRow?
    @State private var deleting: ChatListRow?
    private var realtime: RealtimeCoordinator { AppServices.realtime }

    var body: some View {
        List {
            if let failure = model.failure {
                FormAlert(message: failure)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            if query.trimmingCharacters(in: .whitespaces).isEmpty {
                ForEach(model.rows) { row in
                    rowView(row)
                }
            } else {
                ChatSearchResults(query: query, rows: model.rows)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .overlay {
            if model.rows.isEmpty, query.isEmpty {
                if model.isRefreshing {
                    ProgressView()
                } else {
                    ContentUnavailableView {
                        Label(String(localized: "chats.empty", defaultValue: "Чатов пока нет"), systemImage: "bubble.left.and.bubble.right")
                    } description: {
                        Text(String(localized: "chats.empty.hint", defaultValue: "Напишите однокурснику или преподавателю"))
                    } actions: {
                        Button(String(localized: "chats.new", defaultValue: "Новый чат")) { composing = .direct }
                            .buttonStyle(.borderedProminent)
                    }
                }
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if model.tabs.count > 1, query.isEmpty {
                ChatTabsView(tabs: model.tabs, selected: model.tab) { model.select($0) }
            }
        }
        .searchable(
            text: $query,
            placement: .navigationBarDrawer(displayMode: .automatic),
            prompt: Text(String(localized: "chats.search.prompt", defaultValue: "Чаты, люди и сообщения"))
        )
        .refreshable {
            await model.refresh()
        }
        .navigationTitle(Text(AppTab.chats.title))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        composing = .direct
                    } label: {
                        Label(String(localized: "chats.new", defaultValue: "Новый чат"), systemImage: "person")
                    }
                    Button {
                        composing = .group
                    } label: {
                        Label(String(localized: "chats.newGroup", defaultValue: "Новая группа"), systemImage: "person.3")
                    }
                    Button {
                        Task { await openSaved() }
                    } label: {
                        Label(String(localized: "chats.saved", defaultValue: "Избранное"), systemImage: "bookmark")
                    }
                } label: {
                    Image(systemName: "square.and.pencil")
                }
                .accessibilityLabel(Text(String(localized: "chats.new", defaultValue: "Новый чат")))
            }
        }
        .sheet(item: $composing) { kind in
            NewChatView(kind: kind) { chatID in
                composing = nil
                Task {
                    await model.refresh()
                    AppServices.router.stacks[.chats, default: []].append(.chat(id: chatID))
                }
            }
        }
        .confirmationDialog(
            String(localized: "chats.clear.title", defaultValue: "Очистить историю у себя?"),
            isPresented: Binding(get: { clearing != nil }, set: { if !$0 { clearing = nil } }),
            titleVisibility: .visible,
            presenting: clearing
        ) { row in
            Button(String(localized: "chats.clear", defaultValue: "Очистить историю"), role: .destructive) {
                Task { await model.clearHistory(row) }
            }
        } message: { _ in
            Text(String(localized: "chats.clear.message", defaultValue: "У собеседников переписка останется."))
        }
        .confirmationDialog(
            String(localized: "chats.delete.chat.title", defaultValue: "Удалить чат?"),
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible,
            presenting: deleting
        ) { row in
            Button(ChatLeaveTitle.title(for: row.kind), role: .destructive) {
                Task { await model.delete(row) }
            }
        }
        .task {
            model.start()
            await model.refresh()
        }
    }

    // MARK: Строка

    private func rowView(_ row: ChatListRow) -> some View {
        NavigationLink(value: AppRoute.chat(id: row.id)) {
            // Подпись видна и в списке: событие уходит в личные комнаты участников,
            // а не только в комнату чата (PROJECT.md §9.2).
            ChatRowView(
                row: row,
                action: realtime.actions[row.id]?.values.first,
                isGroup: row.kind != .private && row.kind != .saved
            )
        }
        .listRowBackground(Palette.background)
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if canDelete(row) {
                Button(role: .destructive) {
                    deleting = row
                } label: {
                    Label(String(localized: "feed.delete", defaultValue: "Удалить"), systemImage: "trash")
                }
            }
            Button {
                Task { await model.toggleArchived(row) }
            } label: {
                Label(
                    row.archivedAt == nil
                        ? String(localized: "chats.archive", defaultValue: "В архив")
                        : String(localized: "chats.unarchive", defaultValue: "Из архива"),
                    systemImage: "archivebox"
                )
            }
            .tint(Palette.mutedForeground)
        }
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            if row.unreadCount > 0 {
                Button {
                    Task { await model.markRead(row) }
                } label: {
                    Label(String(localized: "chats.markRead", defaultValue: "Прочитано"), systemImage: "checkmark.message")
                }
                .tint(Palette.primary)
            }
            Button {
                Task { await model.togglePinned(row) }
            } label: {
                Label(
                    row.isPinned
                        ? String(localized: "chats.unpin", defaultValue: "Открепить")
                        : String(localized: "chats.pin", defaultValue: "Закрепить"),
                    systemImage: row.isPinned ? "pin.slash" : "pin"
                )
            }
            .tint(Palette.success)
        }
        .contextMenu {
            Button {
                Task { await model.togglePinned(row) }
            } label: {
                Label(
                    row.isPinned
                        ? String(localized: "chats.unpin", defaultValue: "Открепить")
                        : String(localized: "chats.pin", defaultValue: "Закрепить"),
                    systemImage: row.isPinned ? "pin.slash" : "pin"
                )
            }
            if row.unreadCount > 0 {
                Button {
                    Task { await model.markRead(row) }
                } label: {
                    Label(String(localized: "chats.markRead", defaultValue: "Прочитано"), systemImage: "checkmark.message")
                }
            }
            MuteMenu(isMuted: row.muted) { minutes, importantOnly in
                Task { await model.mute(row, minutes: minutes, importantOnly: importantOnly) }
            } unmute: {
                Task { await model.toggleMuted(row) }
            }
            Button {
                Task { await model.toggleArchived(row) }
            } label: {
                Label(
                    row.archivedAt == nil
                        ? String(localized: "chats.archive", defaultValue: "В архив")
                        : String(localized: "chats.unarchive", defaultValue: "Из архива"),
                    systemImage: "archivebox"
                )
            }
            Divider()
            Button(role: .destructive) {
                clearing = row
            } label: {
                Label(String(localized: "chats.clear", defaultValue: "Очистить историю"), systemImage: "eraser")
            }
            if canDelete(row) {
                Button(role: .destructive) {
                    deleting = row
                } label: {
                    Label(ChatLeaveTitle.title(for: row.kind), systemImage: "trash")
                }
            }
        }
    }

    /// Удалить или покинуть можно личный чат и группу; официальные заводит система.
    private func canDelete(_ row: ChatListRow) -> Bool {
        row.kind == .private || row.kind == .group
    }

    private func openSaved() async {
        guard let id = try? await ChatsAPI().savedMessages() else { return }
        await model.refresh()
        AppServices.router.stacks[.chats, default: []].append(.chat(id: id))
    }
}

/// «Без звука» с выбором срока — те же варианты, что в вебе.
struct MuteMenu: View {
    let isMuted: Bool
    let mute: (Int?, Bool) -> Void
    let unmute: () -> Void

    var body: some View {
        if isMuted {
            Button(action: unmute) {
                Label(String(localized: "chats.unmute", defaultValue: "Включить звук"), systemImage: "bell")
            }
        } else {
            Menu {
                Button(String(localized: "chats.mute.1h", defaultValue: "На час")) { mute(60, false) }
                Button(String(localized: "chats.mute.4h", defaultValue: "На 4 часа")) { mute(240, false) }
                Button(String(localized: "chats.mute.8h", defaultValue: "На 8 часов")) { mute(480, false) }
                Button(String(localized: "chats.mute.1d", defaultValue: "На сутки")) { mute(1440, false) }
                Button(String(localized: "chats.mute.3d", defaultValue: "На 3 дня")) { mute(4320, false) }
                Button(String(localized: "chats.mute.forever", defaultValue: "Навсегда")) { mute(nil, false) }
                Divider()
                Button(String(localized: "chats.mute.important", defaultValue: "Только важное")) { mute(nil, true) }
            } label: {
                Label(String(localized: "chats.mute", defaultValue: "Без звука"), systemImage: "bell.slash")
            }
        }
    }
}

/// Подпись удаления по виду чата: из группы выходят, личный чат удаляют у себя.
enum ChatLeaveTitle {
    static func title(for kind: ChatKind) -> String {
        kind == .group
            ? String(localized: "chats.leave", defaultValue: "Покинуть группу")
            : String(localized: "chats.delete.chat", defaultValue: "Удалить чат")
    }
}

/// Вкладки над списком: «Все», по типам, папки, «Запросы», «Архив».
private struct ChatTabsView: View {
    let tabs: [ChatListTab]
    let selected: ChatListTab
    let onSelect: (ChatListTab) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.md) {
                ForEach(tabs, id: \.self) { tab in
                    Button {
                        onSelect(tab)
                    } label: {
                        Text(title(of: tab))
                            .font(Typography.meta.weight(tab == selected ? .semibold : .regular))
                            .padding(.horizontal, Spacing.lg)
                            .frame(height: ControlHeight.sm)
                            .background(
                                tab == selected ? Palette.primary : Palette.muted,
                                in: Capsule()
                            )
                            .foregroundStyle(tab == selected ? Palette.primaryForeground : Palette.mutedForeground)
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(tab == selected ? .isSelected : [])
                }
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.sm)
        }
        .background(Palette.background)
        .sensoryFeedback(.selection, trigger: selected)
    }

    private func title(of tab: ChatListTab) -> String {
        switch tab {
        case .all: return String(localized: "chats.tab.all", defaultValue: "Все")
        case .folder(_, let name): return name
        case .requests: return String(localized: "chats.tab.requests", defaultValue: "Запросы")
        case .archive: return String(localized: "chats.tab.archive", defaultValue: "Архив")
        case .unread: return String(localized: "chats.tab.unread", defaultValue: "Непрочитанные")
        case .personal: return String(localized: "chats.tab.personal", defaultValue: "Личные")
        case .groups: return String(localized: "chats.tab.groups", defaultValue: "Группы")
        case .subjects: return String(localized: "chats.tab.subjects", defaultValue: "Предметы")
        case .university: return String(localized: "chats.tab.university", defaultValue: "Вуз")
        }
    }
}

/// Строка списка: аватар, название и превью, справа время и счётчик.
struct ChatRowView: View {
    let row: ChatListRow
    var action: String?
    var isGroup = false

    @Environment(\.viewerID) private var viewerID

    var body: some View {
        HStack(spacing: Spacing.lg) {
            ChatAvatarView(
                title: row.displayTitle,
                kind: row.kind,
                avatarURL: row.avatarUrl,
                online: row.kind == .private && row.online
            )

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: Spacing.xs) {
                    Text(row.displayTitle)
                        .font(Typography.cardTitle)
                        .foregroundStyle(Palette.foreground)
                        .lineLimit(1)
                    if row.kind.isOfficial {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.caption)
                            .foregroundStyle(Palette.primary)
                            .accessibilityLabel(Text(String(localized: "chats.official", defaultValue: "Официальный чат")))
                    }
                    if row.muted {
                        Image(systemName: "bell.slash.fill")
                            .font(.caption)
                            .foregroundStyle(Palette.mutedForeground)
                            .accessibilityLabel(Text(String(localized: "chats.mutedBadge", defaultValue: "Уведомления выключены")))
                    }
                    Spacer(minLength: Spacing.md)
                    // Галочки — только у своего последнего сообщения в личном чате.
                    if row.kind == .private, row.lastSenderId == viewerID, row.draftText == nil,
                       let last = row.lastCreatedAt
                    {
                        let readAt = row.othersReadAt ?? .distantPast
                        Image(systemName: readAt >= last ? "checkmark.circle.fill" : "checkmark")
                            .font(.caption)
                            .foregroundStyle(Palette.primary)
                            .accessibilityHidden(true)
                    }
                    Text(ChatMoment.short(row.lastCreatedAt ?? row.updatedAt))
                        .font(Typography.tabular(.caption))
                        .foregroundStyle(row.unreadCount > 0 && !row.muted ? Palette.primary : Palette.mutedForeground)
                }

                HStack(alignment: .top, spacing: Spacing.md) {
                    preview
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if row.unreadCount > 0 {
                        Text(verbatim: row.unreadCount > 99 ? "99+" : String(row.unreadCount))
                            .font(Typography.tabular(.caption).weight(.semibold))
                            .foregroundStyle(Palette.primaryForeground)
                            .padding(.horizontal, Spacing.sm)
                            .frame(minWidth: 22, minHeight: 22)
                            .background(row.muted ? Palette.mutedForeground : Palette.primary, in: Capsule())
                    } else if row.isPinned {
                        Image(systemName: "pin.fill")
                            .font(.caption)
                            .foregroundStyle(Palette.mutedForeground)
                            .accessibilityLabel(Text(String(localized: "chats.pinnedBadge", defaultValue: "Закреплён")))
                    }
                }
            }
        }
        .padding(.vertical, Spacing.xs)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var preview: some View {
        if let action {
            Text(ChatActionCaption.title(for: action))
                .font(Typography.meta)
                .foregroundStyle(Palette.primary)
                .lineLimit(2)
        } else if let draft = row.draftText, !draft.isEmpty {
            (Text(String(localized: "chats.draft", defaultValue: "Черновик: ")).foregroundStyle(Palette.destructive)
                + Text(draft).foregroundStyle(Palette.mutedForeground))
                .font(Typography.meta)
                .lineLimit(2)
        } else if row.lastSystemType != nil {
            Text(String(localized: "chats.system.unknown", defaultValue: "Событие в чате"))
                .font(Typography.meta.italic())
                .foregroundStyle(Palette.mutedForeground)
                .lineLimit(1)
        } else if let text = row.preview {
            if isGroup, let sender = row.lastSenderName, !sender.isEmpty, row.lastDeletedAt == nil {
                (Text(verbatim: "\(sender.split(separator: " ").last.map(String.init) ?? sender): ")
                    .foregroundStyle(Palette.foreground)
                    + Text(text).foregroundStyle(Palette.mutedForeground))
                    .font(Typography.meta)
                    .lineLimit(2)
            } else {
                Text(text)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(2)
            }
        } else if row.requestIncoming {
            Text(String(localized: "chats.request.preview", defaultValue: "Запрос на переписку"))
                .font(Typography.meta)
                .foregroundStyle(Palette.primary)
        }
    }
}

/// Аватар чата: фото, иначе символ по типу или буква названия. Точка — собеседник в сети.
struct ChatAvatarView: View {
    let title: String?
    let kind: ChatKind
    var avatarURL: String?
    var online = false
    var size: CGFloat = 52

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Group {
                if let avatarURL, let url = URL(string: avatarURL) {
                    RemoteImage(url: url, cacheKey: "chat:\(avatarURL.split(separator: "?").first ?? "")")
                } else if let symbol {
                    ZStack {
                        Circle().fill(Palette.primary.opacity(0.12))
                        Image(systemName: symbol)
                            .font(.system(size: size * 0.4, weight: .medium))
                            .foregroundStyle(Palette.primary)
                    }
                } else {
                    AvatarView(url: nil, name: title, size: size)
                }
            }
            .frame(width: size, height: size)
            .clipShape(Circle())

            if online {
                Circle()
                    .fill(Palette.success)
                    .frame(width: size * 0.26, height: size * 0.26)
                    .overlay(Circle().strokeBorder(Palette.background, lineWidth: 2))
                    .accessibilityLabel(Text(String(localized: "chats.online", defaultValue: "в сети")))
            }
        }
        .accessibilityHidden(!online)
    }

    private var symbol: String? {
        switch kind {
        case .saved: return "bookmark.fill"
        case .groupOfficial: return "person.3.fill"
        case .subject: return "book.closed.fill"
        case .faculty: return "building.2.fill"
        case .dean: return "building.columns.fill"
        case .support, .supportPlatform: return "questionmark.bubble.fill"
        case .event: return "calendar"
        default: return nil
        }
    }
}

/// Время в строке списка: сегодня — часы и минуты, на этой неделе — день, дальше —
/// дата. Как в вебе и как во всех мессенджерах: длинная дата в строке не читается.
enum ChatMoment {
    static func short(_ date: Date, now: Date = Date(), calendar: Calendar = .current) -> String {
        if calendar.isDateInToday(date) {
            return date.formatted(date: .omitted, time: .shortened)
        }
        if let week = calendar.date(byAdding: .day, value: -6, to: now), date > week {
            return date.formatted(.dateTime.weekday(.abbreviated))
        }
        return date.formatted(.dateTime.day().month(.abbreviated))
    }
}
