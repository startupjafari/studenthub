import PhotosUI
import SwiftUI

/// Пост с комментариями.
struct PostDetailView: View {
    let postID: String

    @State private var model: PostCommentsModel?

    var body: some View {
        VStack(spacing: 0) {
            List {
                if let failure = model?.failure {
                    FormAlert(message: failure)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }

                ForEach(model?.comments ?? []) { comment in
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(comment.author?.name ?? String(localized: "home.someone", defaultValue: "Кто-то"))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                        Text(comment.content)
                            .font(Typography.body)
                    }
                    .padding(.vertical, Spacing.xs)
                    .listRowBackground(Palette.card)
                }

                if model?.comments.isEmpty ?? true {
                    EmptyRow(text: String(localized: "feed.noComments", defaultValue: "Комментариев пока нет"))
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)

            if let model {
                HStack(spacing: Spacing.md) {
                    TextField(text: Binding(get: { model.draft }, set: { model.draft = $0 }), axis: .vertical) {
                        Text(verbatim: String(localized: "feed.comment", defaultValue: "Комментарий"))
                    }
                    .lineLimit(1...4)
                    .padding(.horizontal, Spacing.lg)
                    .padding(.vertical, Spacing.md)
                    .background(Palette.muted, in: RoundedRectangle(cornerRadius: Radius.xl))

                    Button {
                        Task { await model.send() }
                    } label: {
                        Image(systemName: "arrow.up")
                            .foregroundStyle(Palette.primaryForeground)
                            .frame(width: ControlHeight.lg, height: ControlHeight.lg)
                            .background(Palette.primary, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(String(localized: "chats.send", defaultValue: "Отправить")))
                }
                .padding(Spacing.xl)
                .background(Palette.background)
            }
        }
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "shell.post", defaultValue: "Публикация")))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if model == nil { model = PostCommentsModel(postID: postID) }
            await model?.load()
        }
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
                            get: { settings.push ?? true },
                            set: { value in Task { await model.update(push: value) } }
                        )
                    )
                    Toggle(
                        String(localized: "notifications.email", defaultValue: "Письма"),
                        isOn: Binding(
                            get: { settings.email ?? true },
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
