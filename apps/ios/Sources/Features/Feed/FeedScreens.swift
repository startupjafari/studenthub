import SwiftUI

/// Пост с комментариями — экран по ссылке из уведомления, пуша или репоста.
struct PostDetailView: View {
    let postID: String

    var body: some View {
        PostCommentsView(postID: postID, showsPost: true)
    }
}

/// События: что будет и куда я иду.
struct EventsView: View {
    @State private var model = EventsModel()

    var body: some View {
        List {
            if let failure = model.failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            ForEach(model.events) { event in
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(event.title)
                        .font(Typography.cardTitle)
                    HStack(spacing: Spacing.md) {
                        Label(
                            event.startsAt.formatted(date: .abbreviated, time: .shortened),
                            systemImage: "calendar"
                        )
                        if let location = event.location {
                            Label(location, systemImage: "mappin")
                        }
                    }
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)

                    Button {
                        Task { await model.toggleRegistration(event.id) }
                    } label: {
                        Text(model.isRegistered(event.id)
                            ? String(localized: "events.cancel", defaultValue: "Не пойду")
                            : String(localized: "events.join", defaultValue: "Пойду"))
                            .font(Typography.meta)
                            .padding(.horizontal, Spacing.lg)
                            .frame(height: ControlHeight.sm)
                            .background(
                                model.isRegistered(event.id) ? Palette.muted : Palette.primary.opacity(0.1),
                                in: Capsule()
                            )
                            .foregroundStyle(
                                model.isRegistered(event.id) ? Palette.mutedForeground : Palette.primary
                            )
                    }
                    .buttonStyle(.plain)
                }
                .padding(.vertical, Spacing.xs)
                .listRowBackground(Palette.card)
            }

            if model.events.isEmpty, !model.isLoading {
                EmptyRow(text: String(localized: "events.empty", defaultValue: "Событий пока нет"))
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "more.events", defaultValue: "События")))
        .refreshable { await model.refresh() }
        .task { await model.refresh() }
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
