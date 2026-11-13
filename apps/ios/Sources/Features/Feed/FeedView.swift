import SwiftUI

/// Лента: истории, «Что нового?», заявки в друзья и публикации.
///
/// Как в любой социальной ленте, сверху свежее у своих (истории), ниже — то, что читают,
/// если есть минута. Учебный день (ближайшая пара, сроки, события) — на «Главной»: лента
/// не дублирует его, чтобы оставаться лентой. Кто я — аватар в верхней панели.
struct FeedView: View {
    let role: Role

    @Environment(\.viewerID) private var viewerID
    @Environment(ViewerProfileModel.self) private var viewer
    @State private var feed = FeedModel()
    @State private var home = HomeModel()
    @State private var stories = StoriesModel()
    @State private var viewingRing: String?
    @State private var composingStory = false
    @State private var composingPost = false
    /// Раздел ленты (`filter` сервера); `nil` — вся лента.
    @State private var filter: String?
    /// Текст и первая картинка следующих постов — заранее (п. 40 аудита).
    @State private var prefetcher = FeedPrefetcher()
    /// Ширина ленты: по ней предзагрузка считает размер плитки.
    @State private var listWidth: CGFloat = 0
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        PostActionsHost(model: feed) { actions in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Spacing.lg) {
                    storiesSection

                    if !home.friendRequests.isEmpty {
                        FriendRequestsCard(model: home)
                            .padding(.horizontal, Spacing.xl)
                    }

                    if !CommunityPostAudience.allowed(for: role).isEmpty {
                        ComposerLauncher(profile: viewer.profile) { composingPost = true }
                            .padding(.horizontal, Spacing.xl)
                    }

                    FilterChips(options: feedFilters, selection: $filter)
                        .padding(.horizontal, Spacing.xl)

                    feedSection(actions: actions)
                        .padding(.horizontal, Spacing.xl)
                }
                .padding(.vertical, Spacing.md)
            }
            .accessibilityIdentifier("feed.list")
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { listWidth = $0 }
            // Первая загрузка — один системный индикатор по центру экрана, без заглушек
            // карточек: человек видит, что лента грузится, а не пустые серые блоки.
            .screenState(!feed.hasLoaded && feed.posts.isEmpty) { LoadingStateView() }
            .background(Palette.background)
        }
        .navigationTitle(Text(AppTab.feed.title))
        // Компактная панель: в ленте место у историй и публикаций, а не у заголовка.
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(verbatim: "StudentHub")
                    .font(.system(.headline, design: .rounded, weight: .bold))
                    .foregroundStyle(Palette.foreground)
                    .accessibilityAddTraits(.isHeader)
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                // С iOS 18 поиск — своя вкладка у края панели; здесь он нужен только на iOS 17.
                if #available(iOS 18, *) {
                    EmptyView()
                } else {
                    NavigationLink(value: AppRoute.search) {
                        Image(systemName: "magnifyingglass")
                    }
                    .accessibilityLabel(Text(String(localized: "search.title", defaultValue: "Поиск")))
                }
            }
        }
        .pullToRefresh { await reload() }
        .task {
            // Вкладка возвращается на экран после каждого перехода назад; лента, прокрученная
            // на пятую страницу, не должна сбрасываться к первой. Обновление — жестом.
            guard !feed.hasLoaded else { return }
            await reload()
        }
        .onChange(of: filter) { _, next in
            let scope: FeedScope
            switch next {
            case nil: scope = .all
            case "SAVED": scope = .saved
            case let value?: scope = .filter(value)
            }
            prefetcher.cancelAll()
            feed = FeedModel(api: FeedAPI(scope: scope))
            Task { await feed.refresh() }
        }
        .fullScreenCover(item: Binding(
            get: { viewingRing.map(RingTarget.init) },
            set: { viewingRing = $0?.id }
        )) { target in
            StoryViewer(model: stories, startRingID: target.id)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("stories.viewer")
        }
        .sheet(isPresented: $composingStory) {
            StoryComposerView(model: stories)
        }
        .sheet(isPresented: $composingPost) {
            PostComposerView(feed: feed)
        }
        .alert(
            String(localized: "feed.actionFailed", defaultValue: "Не получилось"),
            isPresented: Binding(
                get: { home.actionFailure != nil },
                set: { if !$0 { home.dismissActionFailure() } }
            )
        ) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        } message: {
            Text(home.actionFailure ?? "")
        }
    }

    /// Всё разом: выключенные платформой разделы (от них зависят пункты меню постов),
    /// публикации, истории, заявки в друзья — запросы не зависят друг от друга.
    private func reload() async {
        async let platform: Void = CommunityPlatformState.shared.refresh()
        async let posts: Void = feed.refresh()
        async let requests: Void = home.refreshFriendRequests()
        async let rings: Void = stories.refresh()
        _ = await (platform, posts, requests, rings)
    }

    /// Разделы ленты, как вкладки над лентой веба. «Модерация» — только ролям, которые
    /// снимают посты: это не срез личной ленты, а всё, что роль вправе модерировать.
    private var feedFilters: [(value: String?, title: String)] {
        var options: [(value: String?, title: String)] = [
            (nil, String(localized: "community.feed.all", defaultValue: "Все")),
            ("GROUP", String(localized: "community.feed.group", defaultValue: "Моя группа")),
            ("UNIVERSITY", String(localized: "community.feed.university", defaultValue: "Университет")),
            ("TEACHERS", String(localized: "community.feed.teachers", defaultValue: "Преподаватели")),
            ("IMPORTANT", String(localized: "community.feed.important", defaultValue: "Важное")),
            ("SAVED", String(localized: "community.feed.saved", defaultValue: "Сохранённое")),
        ]
        if [.platformAdmin, .platformModerator, .universityAdmin, .universityModerator, .dean].contains(role) {
            options.append(("MODERATION", String(localized: "community.feed.moderation", defaultValue: "Модерация")))
        }
        return options
    }

    // MARK: Истории

    @ViewBuilder
    private var storiesSection: some View {
        // Пока истории грузятся, полосы нет: загрузку экрана показывает общий индикатор.
        if stories.hasLoaded, stories.failure == nil {
            StoriesRail(
                model: stories,
                viewerID: viewerID,
                viewerName: viewer.profile?.name,
                viewerAvatar: viewer.profile?.avatarUrl,
                open: { viewingRing = $0 },
                create: { composingStory = true }
            )
        }
    }

    // MARK: Лента

    @ViewBuilder
    private func feedSection(actions: PostCardActions) -> some View {
        if !feed.hasLoaded, feed.posts.isEmpty {
            // Индикатор — поверх экрана (`screenState` в `body`).
            EmptyView()
        } else if let failure = feed.failure, feed.posts.isEmpty {
            ErrorStateView(message: failure, isOffline: feed.isOffline) { await feed.refresh() }
        } else if feed.posts.isEmpty {
            EmptyStateView(
                title: String(localized: "home.emptyFeed", defaultValue: "В ленте пока пусто"),
                symbol: "text.bubble",
                hint: String(localized: "home.emptyFeed.hint", defaultValue: "Здесь появятся публикации вуза, факультета и группы"),
                actionTitle: CommunityPostAudience.allowed(for: role).isEmpty
                    ? nil : String(localized: "composer.title", defaultValue: "Новая публикация"),
                action: { composingPost = true }
            )
        } else {
            if let failure = feed.failure {
                // Лента уже есть, обновление не удалось: показываем старое и честно
                // говорим, что оно не свежее.
                StaleDataBanner(message: failure, isOffline: feed.isOffline) { await feed.refresh() }
            }

            ForEach(feed.posts) { post in
                PostCardView(post: post, model: feed, viewerID: viewerID, actions: actions)
                    // Контейнер с id для UI-тестов; кнопки внутри доступны по-прежнему.
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("feed.post.\(post.id)")
                    .onAppear {
                        prefetcher.appeared(post.id, in: feed.posts, width: mediaWidth, scale: displayScale)
                        // Следующая страница — за пять постов до конца, а не на последнем:
                        // к концу ленты она уже пришла (п. 40). Сбой подгрузки не
                        // повторяем на каждую строку — для этого «Повторить» под лентой.
                        if feed.pageFailure == nil, let index = feed.posts.firstIndex(where: { $0.id == post.id }),
                           index >= feed.posts.count - 5 {
                            Task { await feed.loadMore() }
                        }
                    }
                    .onDisappear {
                        prefetcher.disappeared(post.id, in: feed.posts, width: mediaWidth, scale: displayScale)
                    }
            }

            if feed.isLoadingMore {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(Spacing.lg)
            } else if let pageFailure = feed.pageFailure {
                PageFailureRow(message: pageFailure) { await feed.loadMore() }
            } else if !feed.hasMore {
                Text(String(localized: "home.feedEnd", defaultValue: "Это все публикации"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .frame(maxWidth: .infinity)
                    .padding(Spacing.lg)
            }
        }
    }
}

extension FeedView {
    /// Ширина плитки медиа: лента минус поля по бокам.
    fileprivate var mediaWidth: CGFloat {
        max(0, listWidth - 2 * Spacing.xl)
    }
}

private struct RingTarget: Identifiable {
    let id: String
}

// MARK: - Блоки над лентой

/// Входящие заявки в друзья: принять или отклонить, не уходя с главной.
private struct FriendRequestsCard: View {
    let model: HomeModel

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            Text(String(localized: "home.friendRequests", defaultValue: "Заявки в друзья"))
                .font(Typography.sectionTitle)
            ForEach(model.friendRequests.prefix(3)) { request in
                HStack(spacing: Spacing.lg) {
                    NavigationLink(value: AppRoute.profile(id: request.user.id)) {
                        HStack(spacing: Spacing.md) {
                            AvatarView(url: request.user.avatarUrl, name: request.user.name, size: 36)
                            Text(request.user.name)
                                .font(Typography.body)
                                .foregroundStyle(Palette.foreground)
                                .lineLimit(1)
                        }
                    }
                    .buttonStyle(.plain)
                    Spacer(minLength: 0)
                    Button {
                        Task { await model.decline(request) }
                    } label: {
                        Image(systemName: "xmark")
                            .frame(width: ControlHeight.md, height: ControlHeight.md)
                            .background(Palette.muted, in: Circle())
                            .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(String(localized: "friends.decline", defaultValue: "Отклонить")))
                    Button {
                        Task { await model.accept(request) }
                    } label: {
                        Image(systemName: "checkmark")
                            .foregroundStyle(Palette.primaryForeground)
                            .frame(width: ControlHeight.md, height: ControlHeight.md)
                            .background(Palette.primary, in: Circle())
                            .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .sensoryFeedback(.success, trigger: model.friendRequests.count)
                    .accessibilityLabel(Text(String(localized: "friends.accept", defaultValue: "Принять")))
                }
            }
            if model.friendRequests.count > 3 {
                Text(String(localized: "home.friendRequests.more", defaultValue: "Ещё заявок: \(model.friendRequests.count - 3)"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            }
        }
        .padding(Spacing.lg)
        .cardSurface()
    }
}

/// Строка запуска редактора: аватар и приглашение написать. Не форма в ленте —
/// нажатие открывает полноценный редактор.
private struct ComposerLauncher: View {
    let profile: UserProfileDTO?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Spacing.lg) {
                AvatarView(url: profile?.avatarUrl, name: profile?.name, size: 36)
                Text(String(localized: "composer.placeholder", defaultValue: "Что нового?"))
                    .font(Typography.body)
                    .foregroundStyle(Palette.mutedForeground)
                Spacer(minLength: 0)
                Image(systemName: "photo.on.rectangle")
                    .foregroundStyle(Palette.primary)
            }
            .padding(Spacing.lg)
            .cardSurface()
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(String(localized: "composer.title", defaultValue: "Новая публикация")))
    }
}
