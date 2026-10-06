import SwiftUI

/// Главная: ближайшая пара, непрочитанное и лента.
///
/// Состав ровно такой, как в карте экранов плана. Порядок не случаен: сверху то,
/// что человек открывает приложение узнать («когда и где я должен быть»), ниже —
/// то, что читают, если есть минута.
struct HomeView: View {
    let role: Role

    @State private var feed = FeedModel()
    @State private var schedule = ScheduleModel()

    private static let reactions = ["👍", "🔥", "❤️"]

    var body: some View {
        List {
            if let failure = feed.failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            if let next = schedule.visiblePairs.first(where: { !$0.isCancelled }) {
                Section {
                    NavigationLink(value: AppRoute.lesson(id: next.id)) {
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            Text(next.pair.subject)
                                .font(Typography.cardTitle)
                            HStack(spacing: Spacing.md) {
                                Label(verbatimTime(next), systemImage: "clock")
                                if let room = next.pair.roomName {
                                    Label(room, systemImage: "mappin")
                                }
                            }
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                        }
                    }
                } header: {
                    Text(String(localized: "home.nextPair", defaultValue: "Ближайшая пара"))
                }
                .listRowBackground(Palette.card)
            }

            Section {
                ForEach(feed.posts) { post in
                    PostCard(post: post, model: feed, reactions: Self.reactions)
                        .listRowBackground(Palette.card)
                        .onAppear {
                            if post.id == feed.posts.last?.id {
                                Task { await feed.loadMore() }
                            }
                        }
                }

                if feed.posts.isEmpty, !feed.isRefreshing {
                    EmptyRow(text: String(localized: "home.emptyFeed", defaultValue: "В ленте пока пусто"))
                }
            } header: {
                Text(String(localized: "home.feed", defaultValue: "Лента"))
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(AppTab.home.title))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink(value: AppRoute.section(.notifications)) {
                    Image(systemName: "bell")
                }
                .accessibilityLabel(Text(String(
                    localized: "home.notifications",
                    defaultValue: "Уведомления"
                )))
            }
        }
        .refreshable {
            await feed.refresh()
            await schedule.refresh()
        }
        .task {
            schedule.start()
            await feed.refresh()
            await schedule.refresh()
        }
    }

    private func verbatimTime(_ pair: SchedulePair) -> String {
        "\(pair.startTime) – \(pair.endTime)"
    }
}

/// Карточка поста: автор, текст, медиа, реакции и переход к комментариям.
struct PostCard: View {
    let post: PostDTO
    let model: FeedModel
    let reactions: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(spacing: Spacing.md) {
                Text(post.author?.name ?? String(localized: "home.someone", defaultValue: "Кто-то"))
                    .font(Typography.cardTitle)
                Spacer()
                Text(verbatim: post.createdAt.formatted(date: .abbreviated, time: .shortened))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            }

            if let content = post.content, !content.isEmpty {
                Text(content)
                    .font(Typography.body)
                    .foregroundStyle(Palette.foreground)
            }

            if let media = post.media?.first, let raw = media.url, let url = URL(string: raw) {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Rectangle().fill(Palette.muted)
                }
                .frame(height: 180)
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
            }

            HStack(spacing: Spacing.md) {
                ForEach(reactions, id: \.self) { emoji in
                    Button {
                        Task { await model.toggle(emoji, on: post.id) }
                    } label: {
                        HStack(spacing: Spacing.xs) {
                            Text(verbatim: emoji)
                            if model.count(emoji, in: post.id) > 0 {
                                Text(verbatim: String(model.count(emoji, in: post.id)))
                                    .font(Typography.tabular(Typography.meta))
                            }
                        }
                        .padding(.horizontal, Spacing.md)
                        .padding(.vertical, Spacing.sm)
                        .background(
                            model.isMine(emoji, in: post.id) ? Palette.primary.opacity(0.1) : Palette.muted,
                            in: Capsule()
                        )
                        .foregroundStyle(
                            model.isMine(emoji, in: post.id) ? Palette.primary : Palette.mutedForeground
                        )
                    }
                    .buttonStyle(.plain)
                }

                Spacer()

                NavigationLink(value: AppRoute.post(id: post.id)) {
                    Label {
                        Text(verbatim: String(post.commentsCount ?? 0))
                    } icon: {
                        Image(systemName: "bubble.right")
                    }
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                }
            }
        }
        .padding(.vertical, Spacing.sm)
    }
}
