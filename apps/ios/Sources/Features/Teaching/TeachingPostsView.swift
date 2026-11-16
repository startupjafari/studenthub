import SwiftUI

/// Свои публикации преподавателя: лента его постов с правкой и удалением (меню
/// карточки) и новая публикация. Общая лента — на «Главной»; здесь — то, что он
/// написал сам, чтобы не искать свой пост среди чужих.
struct TeachingPostsView: View {
    @Environment(\.viewerID) private var viewerID
    @State private var feed: FeedModel?
    @State private var composing = false

    var body: some View {
        Group {
            if let feed {
                PostActionsHost(model: feed) { actions in
                    ScrollView {
                        LazyVStack(spacing: Spacing.lg) {
                            if !feed.posts.isEmpty {
                                ForEach(feed.posts) { post in
                                    PostCardView(post: post, model: feed, viewerID: viewerID, actions: actions)
                                        .onAppear {
                                            if post.id == feed.posts.last?.id { Task { await feed.loadMore() } }
                                        }
                                }
                            }
                        }
                        .padding(Spacing.xl)
                    }
                    .screenState(feed.posts.isEmpty) {
                        if !feed.hasLoaded {
                            LoadingStateView()
                        } else if let failure = feed.failure {
                            ErrorStateView(message: failure, isOffline: feed.isOffline) { await feed.refresh() }
                        } else {
                            EmptyStateView(
                                title: String(localized: "teaching.posts.empty", defaultValue: "Вы ещё ничего не публиковали"),
                                symbol: "square.and.pencil",
                                hint: String(localized: "teaching.posts.empty.hint", defaultValue: "Объявление для групп или новость — студенты увидят его в ленте."),
                                actionTitle: String(localized: "teaching.posts.new", defaultValue: "Новая публикация"),
                                action: { composing = true }
                            )
                        }
                    }
                }
                .pullToRefresh { await feed.refresh() }
                .sheet(isPresented: $composing, onDismiss: { Task { await feed.refresh() } }) {
                    PostComposerView(feed: feed)
                }
            } else {
                LoadingStateView()
            }
        }
        .background(Palette.background)
        .navigationTitle(Text(TeacherScreen.myPosts.title))
        .floatingAction(String(localized: "teaching.posts.new", defaultValue: "Новая публикация"), symbol: "square.and.pencil") {
            if feed != nil { composing = true }
        }
        .task {
            guard feed == nil, !viewerID.isEmpty else { return }
            let model = FeedModel(api: FeedAPI(scope: .author(id: viewerID)))
            feed = model
            await model.refresh()
        }
    }
}
