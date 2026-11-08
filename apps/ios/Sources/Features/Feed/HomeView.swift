import SwiftUI

/// Главная: истории, ближайшая пара, «Что нового?» и лента.
///
/// Порядок не случаен: сверху свежее у своих (истории) и то, ради чего открывают
/// приложение («когда и где я должен быть»), ниже — то, что читают, если есть
/// минута. Кто я — аватар в верхней панели, отдельная карточка ему не нужна.
/// Боковая колонка веба (события, заявки в друзья) превращена в компактные полосы
/// над лентой и появляется, только когда в ней что-то есть.
struct HomeView: View {
    let role: Role

    @Environment(\.viewerID) private var viewerID
    @Environment(ViewerProfileModel.self) private var viewer
    @State private var feed = FeedModel()
    @State private var schedule = ScheduleModel()
    @State private var home = HomeModel()
    @State private var stories = StoriesModel()
    @State private var viewingRing: String?
    @State private var composingStory = false
    @State private var composingPost = false
    /// Раздел ленты (`filter` сервера); `nil` — вся лента.
    @State private var filter: String?

    var body: some View {
        PostActionsHost(model: feed) { actions in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Spacing.lg) {
                    // Истории — первыми, как в любой социальной ленте: свежее у друзей
                    // и группы видно, не прокручивая.
                    storiesSection

                    if let next = schedule.nextPair() {
                        NextClassCard(pair: next)
                            .padding(.horizontal, Spacing.xl)
                    }

                    if !home.friendRequests.isEmpty {
                        FriendRequestsCard(model: home)
                            .padding(.horizontal, Spacing.xl)
                    }

                    if !home.events.isEmpty, !CommunityPlatformState.shared.isDisabled("events") {
                        EventsStrip(events: home.events)
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
            .background(Palette.background)
        }
        .navigationTitle(Text(AppTab.home.title))
        // Компактная панель: на главной место у историй и ленты, а не у заголовка.
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
            ToolbarItemGroup(placement: .topBarTrailing) {
                // С iOS 18 поиск — своя вкладка у края панели; здесь он нужен только на iOS 17.
                if #available(iOS 18, *) {
                    EmptyView()
                } else {
                    NavigationLink(value: AppRoute.search) {
                        Image(systemName: "magnifyingglass")
                    }
                    .accessibilityLabel(Text(String(localized: "search.title", defaultValue: "Поиск")))
                }

                NavigationLink(value: AppRoute.section(.notifications)) {
                    Image(systemName: home.unreadNotifications > 0 ? "bell.badge" : "bell")
                        .symbolRenderingMode(.multicolor)
                }
                .accessibilityLabel(Text(String(localized: "home.notifications", defaultValue: "Уведомления")))
                .accessibilityValue(Text(home.unreadNotifications > 0
                    ? String(localized: "home.notifications.unread", defaultValue: "Непрочитанных: \(home.unreadNotifications)")
                    : ""))
            }
        }
        .refreshable {
            async let posts: Void = feed.refresh()
            async let pairs: Void = schedule.refresh()
            async let side: Void = home.refresh()
            async let rings: Void = stories.refresh()
            async let me: Void = viewer.refresh()
            _ = await (posts, pairs, side, rings, me)
        }
        .task {
            schedule.start()
            // Выключенные платформой разделы: от них зависят пункты меню постов и полосы.
            await CommunityPlatformState.shared.refresh()
            async let posts: Void = feed.refresh()
            async let pairs: Void = schedule.refresh()
            async let side: Void = home.refresh()
            async let rings: Void = stories.refresh()
            _ = await (posts, pairs, side, rings)
        }
        .onAppear {
            // Вернулись из уведомлений — точка на колокольчике должна погаснуть.
            Task { await home.refreshUnread() }
        }
        .onChange(of: filter) { _, next in
            let scope: FeedScope
            switch next {
            case nil: scope = .all
            case "SAVED": scope = .saved
            case let value?: scope = .filter(value)
            }
            feed = FeedModel(api: FeedAPI(scope: scope))
            Task { await feed.refresh() }
        }
        .fullScreenCover(item: Binding(
            get: { viewingRing.map(RingTarget.init) },
            set: { viewingRing = $0?.id }
        )) { target in
            StoryViewer(model: stories, startRingID: target.id)
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
        if !stories.hasLoaded {
            StoriesRailSkeleton()
        } else if stories.failure == nil {
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
            ForEach(0..<3, id: \.self) { _ in PostCardSkeleton() }
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
                    .onAppear {
                        if post.id == feed.posts.last?.id {
                            Task { await feed.loadMore() }
                        }
                    }
            }

            if feed.isLoadingMore {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(Spacing.lg)
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

private struct RingTarget: Identifiable {
    let id: String
}

// MARK: - Блоки над лентой

/// Ближайшая пара. Нажатие ведёт в расписание — там весь день и изменения.
private struct NextClassCard: View {
    let pair: SchedulePair

    var body: some View {
        Button {
            AppServices.router.select(.schedule)
        } label: {
            HStack(alignment: .top, spacing: Spacing.lg) {
                VStack(spacing: 2) {
                    Text(verbatim: pair.startTime)
                        .font(Typography.tabular(.headline))
                    Text(verbatim: pair.endTime)
                        .font(Typography.tabular(Typography.meta))
                        .foregroundStyle(Palette.mutedForeground)
                }
                .frame(minWidth: 52)
                .padding(.vertical, Spacing.sm)
                .background(Palette.primary.opacity(0.1), in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
                .foregroundStyle(Palette.primary)

                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(isNow
                        ? String(localized: "home.nowPair", defaultValue: "Сейчас идёт")
                        : String(localized: "home.nextPair", defaultValue: "Ближайшая пара"))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(isNow ? Palette.success : Palette.mutedForeground)
                        .textCase(.uppercase)
                    Text(pair.pair.subject)
                        .font(Typography.cardTitle)
                        .foregroundStyle(Palette.foreground)
                        .lineLimit(2)
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: Spacing.lg) { details }
                        VStack(alignment: .leading, spacing: Spacing.xs) { details }
                    }
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    if let note = pair.changeNote {
                        Label(note, systemImage: "exclamationmark.circle")
                            .font(Typography.meta)
                            .foregroundStyle(Palette.warning)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(Spacing.lg)
            .cardSurface()
        }
        .buttonStyle(.plain)
        .accessibilityHint(Text(String(localized: "home.nextPair.open", defaultValue: "Открыть расписание")))
    }

    @ViewBuilder
    private var details: some View {
        if let room = pair.pair.roomName, !room.isEmpty {
            Label(room, systemImage: "mappin.and.ellipse").lineLimit(1)
        }
        if let teacher = pair.pair.teacherName, !teacher.isEmpty {
            Label(teacher, systemImage: "person").lineLimit(1)
        }
    }

    private var isNow: Bool {
        let now = ScheduleModel.clock(of: Date(), calendar: .current)
        return pair.startTime <= now && now < pair.endTime
    }
}

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

/// Ближайшие события — горизонтальная полоса карточек.
private struct EventsStrip: View {
    let events: [EventDTO]

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack {
                Text(String(localized: "home.events", defaultValue: "Ближайшие события"))
                    .font(Typography.sectionTitle)
                Spacer()
                NavigationLink(value: AppRoute.section(.events)) {
                    Text(String(localized: "home.all", defaultValue: "Все"))
                        .font(Typography.meta.weight(.medium))
                }
            }
            .padding(.horizontal, Spacing.xl)

            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: Spacing.md) {
                    ForEach(events) { event in
                        NavigationLink(value: AppRoute.community(.event(id: event.id))) {
                            VStack(alignment: .leading, spacing: Spacing.xs) {
                                Text(event.startsAt, format: .dateTime.day().month(.abbreviated).hour().minute())
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(Palette.primary)
                                Text(event.title)
                                    .font(Typography.body.weight(.medium))
                                    .foregroundStyle(Palette.foreground)
                                    .lineLimit(2)
                                    .multilineTextAlignment(.leading)
                                Spacer(minLength: 0)
                                if let location = event.location, !location.isEmpty {
                                    Label(location, systemImage: "mappin")
                                        .font(Typography.meta)
                                        .foregroundStyle(Palette.mutedForeground)
                                        .lineLimit(1)
                                }
                            }
                            .padding(Spacing.lg)
                            .frame(width: 220, alignment: .leading)
                            .frame(minHeight: 110, alignment: .topLeading)
                            .cardSurface()
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, Spacing.xl)
            }
            .scrollClipDisabled()
        }
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
