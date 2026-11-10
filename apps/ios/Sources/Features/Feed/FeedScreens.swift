import SwiftUI

/// Пост с комментариями — экран по ссылке из уведомления, пуша или репоста.
struct PostDetailView: View {
    let postID: String

    var body: some View {
        PostCommentsView(postID: postID, showsPost: true)
    }
}

/// События: ближайшие, прошедшие и мои; запись, карточка события, создание своего.
struct EventsView: View {
    var body: some View {
        CommunitySectionGate(section: "events") { CommunityEventsList() }
    }
}

/// Список событий с разделами, как вкладки страницы событий веба.
private struct CommunityEventsList: View {
    @Environment(\.viewerRole) private var role
    @State private var scope: Scope = .upcoming
    @State private var loader = PagedLoader<CommunityEventDTO>(limit: 20) { request in
        try await CommunityAPI().events(filter: "upcoming", mine: false, page: request)
    }
    @State private var creating = false
    @State private var failure: String?

    enum Scope: Hashable {
        case upcoming, past, mine
    }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: String(localized: "events.empty", defaultValue: "Событий пока нет"),
                symbol: "calendar"
            )
        ) {
            FilterChipsRow(
                options: [
                    (value: Scope.upcoming, title: String(localized: "community.events.upcoming", defaultValue: "Ближайшие")),
                    (value: Scope.past, title: String(localized: "community.events.past", defaultValue: "Прошедшие")),
                    (value: Scope.mine, title: String(localized: "community.events.mine", defaultValue: "Я иду")),
                ],
                selection: Binding(get: { scope }, set: { if let next = $0 { scope = next } })
            )
        } row: { event in
            NavigationLink(value: AppRoute.community(.event(id: event.id))) {
                CommunityEventRow(event: event)
            }
            .swipeActions {
                if !event.isOver {
                    Button {
                        Task { await toggle(event) }
                    } label: {
                        if event.isRegistered == true {
                            Label(String(localized: "events.cancel", defaultValue: "Не пойду"), systemImage: "xmark")
                        } else {
                            Label(String(localized: "events.join", defaultValue: "Пойду"), systemImage: "checkmark")
                        }
                    }
                    .tint(event.isRegistered == true ? Palette.mutedForeground : Palette.success)
                }
            }
        }
        .communityFloatingAction(
            !CommunityEventText.audiences(for: role).isEmpty,
            String(localized: "community.event.new", defaultValue: "Новое событие"),
            symbol: "calendar.badge.plus"
        ) {
            creating = true
        }
        .navigationTitle(Text(String(localized: "more.events", defaultValue: "События")))
        .onChange(of: scope) { _, next in
            Task {
                await loader.replace { request in
                    try await CommunityAPI().events(filter: next == .past ? "past" : "upcoming", mine: next == .mine, page: request)
                }
            }
        }
        .sheet(isPresented: $creating) {
            CommunityEventEditor(event: nil) { _ in Task { await loader.reload() } }
        }
        .actionFailureAlert($failure)
    }

    @MainActor
    private func toggle(_ event: CommunityEventDTO) async {
        let on = event.isRegistered != true
        do {
            try await CommunityAPI().setRegistered(eventID: event.id, on)
            loader.update { items in
                if let index = items.firstIndex(where: { $0.id == event.id }) { items[index].isRegistered = on }
            }
        } catch {
            failure = error.userMessage
        }
    }
}

/// Центр уведомлений: строки как в списке чатов — значок вида слева, заголовок
/// полужирным, время справа, текст в две строки, точка у непрочитанного. Каналы
/// доставки — в настройках уведомлений (шестерёнка в панели).
struct NotificationsView: View {
    /// Роль — чтобы уведомление не открыло раздел, которого у человека нет.
    let role: Role

    @State private var model = NotificationsModel()
    @State private var loadedOnce = false

    var body: some View {
        List {
            if let failure = model.failure, !model.items.isEmpty {
                StaleDataBanner(message: failure, isOffline: model.isOffline) { await model.refresh() }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }

            if model.items.isEmpty {
                Group {
                    if let failure = model.failure {
                        ErrorStateView(message: failure, isOffline: model.isOffline) { await model.refresh() }
                    } else if !loadedOnce || model.isLoading {
                        LoadingStateView()
                    } else {
                        EmptyStateView(
                            title: String(localized: "notifications.empty", defaultValue: "Уведомлений пока нет"),
                            symbol: "bell.slash",
                            hint: String(
                                localized: "notifications.empty.hint",
                                defaultValue: "Здесь появятся сообщения, изменения расписания и новости вуза"
                            )
                        )
                    }
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            } else {
                Section {
                    ForEach(model.items) { item in
                        Button {
                            open(item)
                        } label: {
                            NotificationRow(item: item)
                        }
                        .buttonStyle(.plain)
                        .swipeActions(edge: .leading) {
                            if !item.isRead {
                                Button {
                                    Task { await model.markRead(item.id) }
                                } label: {
                                    Label(String(localized: "notifications.markRead", defaultValue: "Прочитано"), systemImage: "envelope.open")
                                }
                                .tint(Palette.primary)
                            }
                        }
                        .contextMenu {
                            if !item.isRead {
                                Button {
                                    Task { await model.markRead(item.id) }
                                } label: {
                                    Label(String(localized: "notifications.markRead", defaultValue: "Прочитано"), systemImage: "envelope.open")
                                }
                            }
                        }
                    }
                }
            }
        }
        .listStyle(.plain)
        .navigationTitle(Text(String(localized: "home.notifications", defaultValue: "Уведомления")))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await model.markAllRead() }
                } label: {
                    Image(systemName: "checkmark.circle")
                }
                .disabled(model.unreadCount == 0)
                .accessibilityLabel(Text(String(localized: "notifications.readAll", defaultValue: "Прочитать все")))
            }
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    NotificationSettingsView()
                } label: {
                    Image(systemName: "gearshape")
                }
                .accessibilityLabel(Text(String(localized: "notifications.settings", defaultValue: "Настройки уведомлений")))
            }
        }
        .refreshable { await model.refresh() }
        .task {
            await model.refresh()
            loadedOnce = true
        }
    }

    private func open(_ item: NotificationDTO) {
        Task { await model.markRead(item.id) }
        // Строка ведёт туда же, куда пуш: в чат, к посту, к заявке.
        if let link = item.link {
            AppServices.router.open(link, for: role)
        }
    }
}

/// Строка уведомления в стиле строки чата.
private struct NotificationRow: View {
    let item: NotificationDTO

    var body: some View {
        TelegramStyleRow(
            title: item.title,
            subtitle: item.body,
            meta: Self.time(item.createdAt),
            metaTint: item.isRead ? Palette.mutedForeground : Palette.primary
        ) {
            RowSymbol(symbol: kind.symbol, tint: kind.tint)
        } accessory: {
            if !item.isRead {
                Circle()
                    .fill(Palette.primary)
                    .frame(width: 10, height: 10)
                    .padding(.bottom, 4)
                    .accessibilityLabel(Text(String(localized: "notifications.unread", defaultValue: "Не прочитано")))
            }
        }
        .contentShape(Rectangle())
    }

    private var kind: (symbol: String, tint: Color) {
        switch item.type {
        case "MESSAGE": return ("bubble.left.fill", TileTint.blue)
        case "SCHEDULE_CHANGE": return ("calendar.badge.exclamationmark", TileTint.orange)
        case "POST": return ("text.bubble.fill", TileTint.teal)
        case "EVENT": return ("calendar", TileTint.purple)
        case "APP_UPDATE": return ("arrow.down.app.fill", TileTint.green)
        default: return ("bell.fill", TileTint.gray)
        }
    }

    /// Сегодня — время, раньше — дата: как в списке чатов.
    static func time(_ date: Date) -> String {
        Calendar.current.isDateInToday(date)
            ? date.formatted(date: .omitted, time: .shortened)
            : date.formatted(.dateTime.day().month(.abbreviated))
    }
}
