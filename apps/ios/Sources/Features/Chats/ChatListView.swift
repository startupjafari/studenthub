import SwiftUI

/// Список чатов.
///
/// Рисуется из базы и потому открывается мгновенно и в самолёте. Сеть здесь только
/// догоняет: ошибка запроса показывается строкой сверху, а список продолжает жить.
struct ChatListView: View {
    @State private var model = ChatListModel()

    var body: some View {
        List {
            if let failure = model.failure {
                FormAlert(message: failure)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            ForEach(model.rows) { row in
                NavigationLink(value: AppRoute.chat(id: row.id)) {
                    ChatRowView(row: row)
                }
                .listRowBackground(Palette.card)
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
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

                    Button {
                        Task { await model.toggleMuted(row) }
                    } label: {
                        Label(
                            row.muted
                                ? String(localized: "chats.unmute", defaultValue: "Включить звук")
                                : String(localized: "chats.mute", defaultValue: "Без звука"),
                            systemImage: row.muted ? "bell" : "bell.slash"
                        )
                    }
                    .tint(Palette.warning)
                }
                .swipeActions(edge: .leading, allowsFullSwipe: false) {
                    Button {
                        Task { await model.togglePinned(row) }
                    } label: {
                        Label(
                            row.isPinned
                                ? String(localized: "chats.unpin", defaultValue: "Открепить")
                                : String(localized: "chats.pin", defaultValue: "Закрепить"),
                            systemImage: "pin"
                        )
                    }
                    .tint(Palette.primary)
                }
            }

            if model.rows.isEmpty {
                EmptyChatsView(isRefreshing: model.isRefreshing)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .safeAreaInset(edge: .top, spacing: 0) {
            if model.tabs.count > 1 {
                ChatTabsView(tabs: model.tabs, selected: model.tab) { model.select($0) }
            }
        }
        .refreshable {
            await model.refresh()
        }
        .navigationTitle(Text(AppTab.chats.title))
        .task {
            model.start()
            await model.refresh()
        }
    }
}

/// Вкладки над списком: «Все», папки, «Запросы», «Архив».
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
                            .font(Typography.meta)
                            .padding(.horizontal, Spacing.lg)
                            .frame(height: ControlHeight.sm)
                            .background(
                                tab == selected ? Palette.primary.opacity(0.1) : Palette.muted,
                                in: Capsule()
                            )
                            .foregroundStyle(tab == selected ? Palette.primary : Palette.mutedForeground)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.md)
        }
        .background(Palette.background)
    }

    private func title(of tab: ChatListTab) -> String {
        switch tab {
        case .all:
            return String(localized: "chats.tab.all", defaultValue: "Все")
        case .folder(_, let name):
            return name
        case .requests:
            return String(localized: "chats.tab.requests", defaultValue: "Запросы")
        case .archive:
            return String(localized: "chats.tab.archive", defaultValue: "Архив")
        }
    }
}

/// Строка списка. Порядок слева направо тот же, что в вебе: аватар, название и
/// превью, справа время и счётчик.
struct ChatRowView: View {
    let row: ChatListRow

    var body: some View {
        HStack(spacing: Spacing.lg) {
            ChatAvatarView(title: row.title, kind: row.kind)

            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack(spacing: Spacing.sm) {
                    Text(row.title ?? String(localized: "chats.untitled", defaultValue: "Без названия"))
                        .font(Typography.cardTitle)
                        .foregroundStyle(Palette.foreground)
                        .lineLimit(1)
                    if row.muted {
                        Image(systemName: "bell.slash.fill")
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                            .accessibilityLabel(Text(String(
                                localized: "chats.mutedBadge",
                                defaultValue: "Уведомления выключены"
                            )))
                    }
                    if row.isPinned {
                        Image(systemName: "pin.fill")
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                            .accessibilityLabel(Text(String(
                                localized: "chats.pinnedBadge",
                                defaultValue: "Закреплён"
                            )))
                    }
                }

                if let preview = row.preview {
                    Text(preview)
                        .font(Typography.meta)
                        .foregroundStyle(row.draftText == nil ? Palette.mutedForeground : Palette.destructive)
                        .lineLimit(2)
                }
            }

            Spacer(minLength: Spacing.md)

            VStack(alignment: .trailing, spacing: Spacing.sm) {
                Text(ChatMoment.short(row.lastCreatedAt ?? row.updatedAt))
                    .font(Typography.tabular(Typography.meta))
                    .foregroundStyle(Palette.mutedForeground)
                if row.unreadCount > 0 {
                    Text(verbatim: row.unreadCount > 99 ? "99+" : String(row.unreadCount))
                        .font(Typography.tabular(Typography.meta))
                        .foregroundStyle(Palette.primaryForeground)
                        .padding(.horizontal, Spacing.md)
                        .frame(height: ControlHeight.sm - 10)
                        .background(row.muted ? Palette.mutedForeground : Palette.primary, in: Capsule())
                }
            }
        }
        .padding(.vertical, Spacing.sm)
        .accessibilityElement(children: .combine)
    }
}

/// Аватар-заглушка: буква названия на фоне. Картинки появятся вместе с кэшем файлов.
private struct ChatAvatarView: View {
    let title: String?
    let kind: ChatKind

    var body: some View {
        ZStack {
            Circle().fill(Palette.muted)
            if kind == .saved {
                Image(systemName: "bookmark.fill")
                    .foregroundStyle(Palette.primary)
            } else {
                Text(verbatim: initial)
                    .font(Typography.cardTitle)
                    .foregroundStyle(Palette.mutedForeground)
            }
        }
        .frame(width: ControlHeight.island - 8, height: ControlHeight.island - 8)
        .accessibilityHidden(true)
    }

    private var initial: String {
        guard let first = title?.trimmingCharacters(in: .whitespacesAndNewlines).first else { return "•" }
        return String(first).uppercased()
    }
}

private struct EmptyChatsView: View {
    let isRefreshing: Bool

    var body: some View {
        VStack(spacing: Spacing.md) {
            if isRefreshing {
                ProgressView()
            } else {
                Text(String(localized: "chats.empty", defaultValue: "Чатов пока нет"))
                    .font(Typography.body)
                    .foregroundStyle(Palette.mutedForeground)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.xxl)
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
