import SwiftUI

/// Профиль: обложка, аватар, кто это, итоги — и вкладки содержимого.
///
/// Свой и чужой — один экран: расходясь, они начинают по-разному показывать одни и
/// те же поля, и человек видит у себя не то, что видят у него. Разница — в кнопках
/// шапки: у себя «Изменить» и настройки, у другого — «Написать» и дружба.
struct ProfileView: View {
    /// `nil` — мой профиль.
    let userID: String?

    @Environment(\.viewerID) private var viewerID
    @Environment(ViewerProfileModel.self) private var viewer
    @State private var model: ProfileModel
    @State private var posts: FeedModel
    @State private var tab: ProfileTab = .posts
    @State private var editing = false
    @State private var showsDetails = false
    @State private var viewing: MediaTarget?

    init(userID: String?) {
        self.userID = userID
        _model = State(initialValue: ProfileModel(userID: userID))
        // Посты автора — та же лента, что на главной, со своим срезом. Для своего
        // профиля id подставляется из токена в `task`, до того — общий срез не грузим.
        _posts = State(initialValue: FeedModel(api: FeedAPI(scope: userID.map { .author(id: $0) } ?? .all)))
    }

    var body: some View {
        Group {
            if let profile = model.profile {
                content(profile)
            } else if let failure = model.failure {
                ErrorStateView(message: failure, isOffline: model.isOffline) { await model.load() }
            } else {
                LoadingStateView()
            }
        }
        .background(Palette.background)
        .navigationTitle(Text(model.profile?.name ?? String(localized: "more.profile", defaultValue: "Профиль")))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if model.isMine {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink(value: AppRoute.section(.settings)) {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel(Text(String(localized: "more.settings", defaultValue: "Настройки")))
                    .accessibilityIdentifier("profile.settings")
                }
            }
        }
        .task {
            if model.isMine, !viewerID.isEmpty {
                posts = FeedModel(api: FeedAPI(scope: .author(id: viewerID)))
            }
            async let card: Void = model.load()
            async let feed: Void = posts.refresh()
            _ = await (card, feed)
        }
        .refreshable {
            async let card: Void = model.load()
            async let feed: Void = posts.refresh()
            async let current: Void = model.loadTab(tab, force: true)
            _ = await (card, feed, current)
        }
        .sheet(isPresented: $editing, onDismiss: {
            if let updated = viewer.profile { model.adopt(updated) }
        }) {
            NavigationStack { ProfileEditView() }
        }
        .sheet(isPresented: $showsDetails) {
            if let profile = model.profile {
                NavigationStack { ProfileDetailsView(profile: profile, isMine: model.isMine) }
                    .presentationDetents([.medium, .large])
            }
        }
        .fullScreenCover(item: $viewing) { target in
            MediaViewer(media: target.media, start: target.start)
        }
        .alert(
            String(localized: "feed.actionFailed", defaultValue: "Не получилось"),
            isPresented: Binding(
                get: { model.actionFailure != nil },
                set: { if !$0 { model.dismissActionFailure() } }
            )
        ) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        } message: {
            Text(model.actionFailure ?? "")
        }
    }

    private func content(_ profile: UserProfileDTO) -> some View {
        PostActionsHost(model: posts) { actions in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                    ProfileHeaderView(
                        profile: profile,
                        model: model,
                        edit: { editing = true },
                        details: { showsDetails = true }
                    )

                    if profile.isLimited {
                        EmptyStateView(
                            title: String(localized: "profile.limited", defaultValue: "Профиль закрыт"),
                            symbol: "lock",
                            hint: String(localized: "profile.limited.hint", defaultValue: "Владелец ограничил, кто видит его страницу")
                        )
                        .padding(.vertical, Spacing.xxl)
                    } else {
                        Section {
                            tabContent(actions: actions)
                                .padding(.top, Spacing.lg)
                        } header: {
                            ProfileTabBar(selection: $tab, counts: model.counts)
                        }
                    }
                }
                .padding(.bottom, Spacing.xxl)
            }
        }
        .onChange(of: tab) { _, next in
            Task { await model.loadTab(next) }
        }
    }

    @ViewBuilder
    private func tabContent(actions: PostCardActions) -> some View {
        switch tab {
        case .posts:
            postsTab(actions: actions)
        case .photos:
            mediaGrid(model.photos, tab: .photos)
        case .videos:
            mediaGrid(model.videos, tab: .videos)
        case .articles:
            tabState(model.articles, tab: .articles) { articles in
                LazyVStack(spacing: Spacing.lg) {
                    ForEach(articles) { ArticleCardRow(article: $0) }
                }
                .padding(.horizontal, Spacing.xl)
            }
        case .polls:
            tabState(model.polls, tab: .polls) { polls in
                LazyVStack(spacing: Spacing.lg) {
                    ForEach(polls) { poll in
                        ProfilePollCard(poll: poll) { options in
                            Task { await model.vote(poll: poll, optionIDs: options) }
                        }
                    }
                }
                .padding(.horizontal, Spacing.xl)
            }
        }
    }

    @ViewBuilder
    private func postsTab(actions: PostCardActions) -> some View {
        if !posts.hasLoaded, posts.posts.isEmpty {
            VStack(spacing: Spacing.lg) {
                ForEach(0..<2, id: \.self) { _ in PostCardSkeleton() }
            }
            .padding(.horizontal, Spacing.xl)
        } else if let failure = posts.failure, posts.posts.isEmpty {
            ErrorStateView(message: failure, isOffline: posts.isOffline) { await posts.refresh() }
        } else if posts.posts.isEmpty {
            EmptyStateView(
                title: String(localized: "profile.noPosts", defaultValue: "Публикаций пока нет"),
                symbol: ProfileTab.posts.symbol
            )
        } else {
            LazyVStack(spacing: Spacing.lg) {
                ForEach(posts.posts) { post in
                    PostCardView(post: post, model: posts, viewerID: viewerID, actions: actions)
                        .onAppear {
                            if post.id == posts.posts.last?.id {
                                Task { await posts.loadMore() }
                            }
                        }
                }
                if posts.isLoadingMore { ProgressView().padding(Spacing.lg) }
            }
            .padding(.horizontal, Spacing.xl)
        }
    }

    private func mediaGrid(_ items: [ProfileMediaDTO]?, tab: ProfileTab) -> some View {
        tabState(items, tab: tab) { items in
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: 3), spacing: 2) {
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    Button {
                        viewing = MediaTarget(media: items.map(\.asPostMedia), start: index)
                    } label: {
                        Palette.muted
                            .aspectRatio(1, contentMode: .fit)
                            .overlay {
                                RemoteImage(url: item.thumbnailURL, cacheKey: "profile-media:\(item.id)")
                            }
                            .overlay(alignment: .topTrailing) {
                                if item.isVideo {
                                    Image(systemName: "play.fill")
                                        .font(.caption)
                                        .foregroundStyle(.white)
                                        .padding(Spacing.sm)
                                        .shadow(radius: 2)
                                }
                            }
                            .clipped()
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(item.isVideo
                        ? String(localized: "profile.video", defaultValue: "Видео")
                        : String(localized: "profile.photo", defaultValue: "Фото")))
                }
            }
        }
    }

    /// Загрузка → ошибка → пусто → содержимое для ленивой вкладки.
    @ViewBuilder
    private func tabState<Item, Content: View>(
        _ items: [Item]?,
        tab: ProfileTab,
        @ViewBuilder content: ([Item]) -> Content
    ) -> some View {
        if let items {
            if items.isEmpty {
                EmptyStateView(
                    title: String(localized: "profile.emptyTab", defaultValue: "Здесь пока пусто"),
                    symbol: tab.symbol
                )
            } else {
                content(items)
            }
        } else if let failure = model.tabFailure[tab] {
            ErrorStateView(message: failure) { await model.loadTab(tab, force: true) }
        } else {
            ProgressView()
                .frame(maxWidth: .infinity)
                .padding(Spacing.xxl)
                .task { await model.loadTab(tab) }
        }
    }
}

private struct MediaTarget: Identifiable {
    let id = UUID()
    let media: [PostDTO.Media]
    let start: Int
}

// MARK: - Шапка

private struct ProfileHeaderView: View {
    let profile: UserProfileDTO
    let model: ProfileModel
    let edit: () -> Void
    let details: () -> Void

    private let coverHeight: CGFloat = 132
    private let avatarSize: CGFloat = 88

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            ZStack(alignment: .bottomLeading) {
                cover
                    .frame(height: coverHeight)
                    .frame(maxWidth: .infinity)
                    .clipped()
                    .padding(.bottom, avatarSize / 2)

                AvatarView(url: profile.avatarUrl, name: profile.name, size: avatarSize)
                    .overlay(Circle().strokeBorder(Palette.background, lineWidth: 4))
                    .padding(.leading, Spacing.xl)
            }

            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(profile.name)
                    .font(.title2.weight(.bold))
                    .foregroundStyle(Palette.foreground)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                if let headline = profile.headline, !headline.isEmpty {
                    Text(headline)
                        .font(Typography.body)
                        .foregroundStyle(Palette.foreground)
                }
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
                if let status = profile.academicStatus, !status.isEmpty {
                    Label(status, systemImage: "checkmark.seal.fill")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Palette.success)
                }
                if let bio = profile.bio, !bio.isEmpty {
                    Text(bio)
                        .font(Typography.body)
                        .foregroundStyle(Palette.foreground)
                        .padding(.top, Spacing.xs)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.horizontal, Spacing.xl)

            stats
                .padding(.horizontal, Spacing.xl)

            actions
                .padding(.horizontal, Spacing.xl)
                .padding(.bottom, Spacing.lg)
        }
    }

    @ViewBuilder
    private var cover: some View {
        if let url = profile.coverUrl.flatMap(URL.init(string:)) {
            RemoteImage(url: url, cacheKey: "cover:\(profile.coverUrl?.split(separator: "?").first ?? "")")
        } else {
            LinearGradient(
                colors: [Palette.primary.opacity(0.55), Palette.chart3.opacity(0.4)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
    }

    /// Роль, курс, специальность, группа — то, по чему человека узнают в вузе.
    private var subtitle: String {
        var parts: [String] = []
        if let role = profile.role.flatMap(Role.init(rawValue:)) {
            parts.append(role.profileTitle)
        }
        if let course = profile.course {
            parts.append(String(localized: "profile.course", defaultValue: "\(course) курс"))
        }
        for value in [profile.specialty, profile.groupName, profile.position, profile.department] {
            if let value, !value.isEmpty { parts.append(value) }
        }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private var stats: some View {
        let items: [(String, Int?)] = [
            (String(localized: "profile.stat.friends", defaultValue: "друзей"), model.friendsCount),
            (String(localized: "profile.stat.photos", defaultValue: "фото"), model.counts?.photos),
            (String(localized: "profile.stat.videos", defaultValue: "видео"), model.counts?.videos),
            (String(localized: "profile.stat.articles", defaultValue: "статей"), model.counts?.articles),
        ].filter { $0.1 != nil }
        if !items.isEmpty {
            HStack(spacing: Spacing.xl) {
                ForEach(items, id: \.0) { title, value in
                    HStack(alignment: .firstTextBaseline, spacing: Spacing.xs) {
                        Text(verbatim: "\(value ?? 0)")
                            .font(Typography.tabular(.subheadline.weight(.semibold)))
                            .foregroundStyle(Palette.foreground)
                        Text(title)
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    @ViewBuilder
    private var actions: some View {
        HStack(spacing: Spacing.md) {
            if model.isMine {
                Button(action: edit) {
                    Label(String(localized: "profile.edit", defaultValue: "Изменить"), systemImage: "pencil")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("profile.edit")
            } else if !profile.isLimited || model.friendship != nil {
                Button {
                    Task { await openChat() }
                } label: {
                    Label(String(localized: "profile.message", defaultValue: "Написать"), systemImage: "bubble.left")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)

                if let friendship = model.friendship {
                    Button {
                        Task { await model.friendshipAction() }
                    } label: {
                        Label(Self.friendshipTitle(friendship.status), systemImage: Self.friendshipSymbol(friendship.status))
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .sensoryFeedback(.success, trigger: friendship.status)
                }
            }

            if !profile.isLimited {
                Button(action: details) {
                    Image(systemName: "info.circle")
                        .frame(minWidth: 24)
                }
                .buttonStyle(.bordered)
                .accessibilityLabel(Text(String(localized: "profile.details", defaultValue: "Подробнее")))
            }
        }
        .controlSize(.large)
    }

    @MainActor
    private func openChat() async {
        guard let id = model.userID else { return }
        do {
            let chatID = try await ChatsAPI().createPrivate(with: id)
            AppServices.router.select(.chats)
            AppServices.router.stacks[.chats] = [.chat(id: chatID)]
        } catch {
            model.report(error)
        }
    }

    static func friendshipTitle(_ status: String) -> String {
        switch status {
        case "ACCEPTED": return String(localized: "profile.friends.remove", defaultValue: "В друзьях")
        case "PENDING_OUTGOING": return String(localized: "profile.friends.pending", defaultValue: "Заявка отправлена")
        case "PENDING_INCOMING": return String(localized: "friends.accept", defaultValue: "Принять")
        default: return String(localized: "profile.friends.add", defaultValue: "Добавить")
        }
    }

    static func friendshipSymbol(_ status: String) -> String {
        switch status {
        case "ACCEPTED": return "person.crop.circle.badge.checkmark"
        case "PENDING_OUTGOING": return "clock"
        case "PENDING_INCOMING": return "person.crop.circle.badge.plus"
        default: return "person.badge.plus"
        }
    }
}

extension Role {
    /// Роль в шапке профиля. В отличие от подписи в ленте, студент тоже подписан:
    /// в профиле роль — сведение, а не шум.
    var profileTitle: String {
        feedTitle ?? String(localized: "role.student", defaultValue: "Студент")
    }
}

// MARK: - Вкладки

/// Переключатель вкладок: горизонтальная полоса, прилипающая к верху при прокрутке.
private struct ProfileTabBar: View {
    @Binding var selection: ProfileTab
    let counts: ProfileCountsDTO?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.md) {
                ForEach(ProfileTab.allCases) { tab in
                    Button {
                        selection = tab
                    } label: {
                        HStack(spacing: Spacing.xs) {
                            Text(tab.title)
                            if let count = count(for: tab), count > 0 {
                                Text(verbatim: "\(count)")
                                    .font(Typography.tabular(.caption))
                                    .foregroundStyle(selection == tab ? Palette.primaryForeground.opacity(0.8) : Palette.mutedForeground)
                            }
                        }
                        .font(Typography.meta.weight(.semibold))
                        .padding(.horizontal, Spacing.lg)
                        .frame(minHeight: ControlHeight.md)
                        .foregroundStyle(selection == tab ? Palette.primaryForeground : Palette.foreground)
                        .background(selection == tab ? Palette.primary : Palette.muted, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(selection == tab ? .isSelected : [])
                    .accessibilityIdentifier("profile.tab.\(tab.rawValue)")
                }
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.md)
        }
        .background(Palette.background)
    }

    private func count(for tab: ProfileTab) -> Int? {
        switch tab {
        case .posts: return nil
        case .photos: return counts?.photos
        case .videos: return counts?.videos
        case .articles: return counts?.articles
        case .polls: return counts?.polls
        }
    }
}

private struct ArticleCardRow: View {
    let article: ArticleCardDTO

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.lg) {
            if let cover = article.coverUrl.flatMap(URL.init(string:)) {
                RemoteImage(url: cover, cacheKey: "article:\(article.id)")
                    .frame(width: 84, height: 84)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
            }
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(article.title)
                    .font(Typography.cardTitle)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(3)
                if let description = article.description, !description.isEmpty {
                    Text(description)
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(2)
                }
                HStack(spacing: Spacing.md) {
                    Text(article.publishedAt ?? article.createdAt, format: .dateTime.day().month(.abbreviated).year())
                    if let minutes = article.readingMinutes, minutes > 0 {
                        Text(String(localized: "profile.article.minutes", defaultValue: "\(minutes) мин"))
                    }
                    if let views = article.views, views > 0 {
                        Label(String(views), systemImage: "eye")
                    }
                }
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
            }
            Spacer(minLength: 0)
        }
        .padding(Spacing.lg)
        .cardSurface()
        .accessibilityElement(children: .combine)
    }
}

/// Опрос в профиле: до голоса — варианты, после — полосы с долями.
private struct ProfilePollCard: View {
    let poll: ProfilePollDTO
    let vote: ([String]) -> Void

    @State private var selected: Set<String> = []

    private var showsResults: Bool { poll.canSeeResults && (!poll.myVotes.isEmpty || poll.closed || !poll.canVote) }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            Text(poll.question)
                .font(Typography.cardTitle)
                .foregroundStyle(Palette.foreground)
                .fixedSize(horizontal: false, vertical: true)

            ForEach(poll.options) { option in
                if showsResults {
                    result(option)
                } else {
                    Button {
                        if poll.multiple {
                            if selected.contains(option.id) { selected.remove(option.id) } else { selected.insert(option.id) }
                        } else {
                            vote([option.id])
                        }
                    } label: {
                        HStack {
                            if poll.multiple {
                                Image(systemName: selected.contains(option.id) ? "checkmark.square.fill" : "square")
                                    .foregroundStyle(Palette.primary)
                            }
                            Text(option.text).foregroundStyle(Palette.foreground)
                            Spacer(minLength: 0)
                        }
                        .padding(Spacing.lg)
                        .background(Palette.muted, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(!poll.canVote)
                }
            }

            HStack {
                Text(String(localized: "profile.poll.votes", defaultValue: "Голосов: \(poll.totalVotes)"))
                if poll.closed {
                    Text(String(localized: "profile.poll.closed", defaultValue: "Завершён"))
                }
                Spacer()
                if poll.multiple, !showsResults, poll.canVote {
                    Button(String(localized: "profile.poll.vote", defaultValue: "Голосовать")) {
                        vote(Array(selected))
                    }
                    .disabled(selected.isEmpty)
                    .font(Typography.meta.weight(.semibold))
                }
            }
            .font(Typography.meta)
            .foregroundStyle(Palette.mutedForeground)
        }
        .padding(Spacing.lg)
        .cardSurface()
    }

    private func result(_ option: ProfilePollDTO.Option) -> some View {
        let share = poll.totalVotes > 0 ? Double(option.votes) / Double(poll.totalVotes) : 0
        let mine = poll.myVotes.contains(option.id)
        return VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack {
                Text(option.text)
                    .font(Typography.body.weight(mine ? .semibold : .regular))
                if mine {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.primary)
                        .accessibilityLabel(Text(String(localized: "profile.poll.mine", defaultValue: "Ваш голос")))
                }
                Spacer()
                Text(share, format: .percent.precision(.fractionLength(0)))
                    .font(Typography.tabular(Typography.meta))
                    .foregroundStyle(Palette.mutedForeground)
            }
            GeometryReader { proxy in
                Capsule().fill(Palette.muted)
                    .overlay(alignment: .leading) {
                        Capsule().fill(mine ? Palette.primary : Palette.primary.opacity(0.45))
                            .frame(width: proxy.size.width * share)
                    }
            }
            .frame(height: 6)
            .accessibilityHidden(true)
        }
        .accessibilityElement(children: .combine)
    }
}
