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
            Picker(String(localized: "community.events.scope", defaultValue: "Раздел"), selection: $scope) {
                Text(String(localized: "community.events.upcoming", defaultValue: "Ближайшие")).tag(Scope.upcoming)
                Text(String(localized: "community.events.past", defaultValue: "Прошедшие")).tag(Scope.past)
                Text(String(localized: "community.events.mine", defaultValue: "Я иду")).tag(Scope.mine)
            }
            .pickerStyle(.segmented)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
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
        .navigationTitle(Text(String(localized: "more.events", defaultValue: "События")))
        .toolbar {
            if !CommunityEventText.audiences(for: role).isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        creating = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel(Text(String(localized: "community.event.new", defaultValue: "Новое событие")))
                }
            }
        }
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

/// Центр уведомлений: лента и тумблеры каналов.
struct NotificationsView: View {
    /// Роль — чтобы уведомление не открыло раздел, которого у человека нет.
    let role: Role

    @State private var model = NotificationsModel()

    var body: some View {
        List {
            if let failure = model.failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            if let settings = model.settings {
                Section {
                    Toggle(
                        String(localized: "notifications.push", defaultValue: "Пуши"),
                        isOn: Binding(
                            get: { settings.pushEnabled ?? false },
                            set: { value in Task { await model.update(push: value) } }
                        )
                    )
                    Toggle(
                        String(localized: "notifications.email", defaultValue: "Письма"),
                        isOn: Binding(
                            get: { settings.emailEnabled ?? true },
                            set: { value in Task { await model.update(email: value) } }
                        )
                    )
                } header: {
                    Text(String(localized: "notifications.channels", defaultValue: "Каналы"))
                }
                .listRowBackground(Palette.card)
            }

            Section {
                ForEach(model.items) { item in
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(item.title)
                            .font(Typography.cardTitle)
                            .foregroundStyle(item.isRead ? Palette.mutedForeground : Palette.foreground)
                        Text(item.body)
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                        Text(verbatim: item.createdAt.formatted(date: .abbreviated, time: .shortened))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    .padding(.vertical, Spacing.xs)
                    .listRowBackground(Palette.card)
                    .onTapGesture {
                        Task { await model.markRead(item.id) }
                        // Строка ведёт туда же, куда пуш: в чат, к посту, к заявке.
                        if let link = item.link {
                            AppServices.router.open(link, for: role)
                        }
                    }
                }

                if model.items.isEmpty, !model.isLoading {
                    EmptyRow(text: String(
                        localized: "notifications.empty",
                        defaultValue: "Уведомлений пока нет"
                    ))
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "home.notifications", defaultValue: "Уведомления")))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await model.markAllRead() }
                } label: {
                    Text(String(localized: "notifications.readAll", defaultValue: "Прочитать все"))
                        .font(Typography.meta)
                }
                .disabled(model.unreadCount == 0)
            }
        }
        .refreshable { await model.refresh() }
        .task { await model.refresh() }
    }
}
