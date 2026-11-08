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

                    if !profile.isLimited {
                        CommunityHighlightsStrip(userID: profile.id)
                            .padding(.bottom, Spacing.md)
                    }

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
                    ForEach(articles) { article in
                        NavigationLink(value: AppRoute.community(.article(id: article.id))) {
                            ArticleCardRow(article: article)
                        }
                        .buttonStyle(.plain)
                    }
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
        VStack(spacing: Spacing.md) {
            mediaActions(tab: tab)
            mediaTiles(items, tab: tab)
        }
    }

    /// Загрузка в профиль и альбомы — над сеткой фото и видео.
    private func mediaActions(tab: ProfileTab) -> some View {
        HStack(spacing: Spacing.md) {
            if model.isMine {
                CommunityMediaUploadButton(title: String(localized: "community.albums.uploadHere", defaultValue: "Загрузить")) { _ in
                    await model.loadTab(tab, force: true)
                }
                .glassButton()
            }
            if let owner = model.userID ?? (viewerID.isEmpty ? nil : viewerID) {
                NavigationLink(value: AppRoute.community(.albums(userID: model.isMine ? nil : owner))) {
                    Label(CommunityScreen.albums(userID: nil).title, systemImage: "photo.stack")
                }
                .glassButton()
            }
            Spacer(minLength: 0)
        }
        .font(Typography.meta)
        .padding(.horizontal, Spacing.xl)
    }

    private func mediaTiles(_ items: [ProfileMediaDTO]?, tab: ProfileTab) -> some View {
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

/// Шапка как профиль в Telegram: крупный аватар по центру (на обложке, если она есть),
/// имя, кто это, ряд круглых стеклянных кнопок и карточка «о себе» под ним.
private struct ProfileHeaderView: View {
    let profile: UserProfileDTO
    let model: ProfileModel
    let edit: () -> Void
    let details: () -> Void

    @Environment(\.viewerID) private var viewerID
    @ScaledMetric(relativeTo: .largeTitle) private var avatarSize: CGFloat = 100
    @State private var confirmsUnfriend = false

    private let coverHeight: CGFloat = 128

    var body: some View {
        VStack(spacing: Spacing.sm) {
            visual
                .padding(.bottom, Spacing.xs)

            Text(profile.name)
                .font(.title2.weight(.semibold))
                .foregroundStyle(Palette.foreground)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .padding(.horizontal, Spacing.xl)

            if let headline = profile.headline, !headline.isEmpty {
                Text(headline)
                    .font(.subheadline)
                    .foregroundStyle(Palette.foreground)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, Spacing.xl)
            }
            if !subtitle.isEmpty {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(Palette.mutedForeground)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, Spacing.xl)
            }
            if let status = profile.academicStatus, !status.isEmpty {
                StatusBadge(text: status, tint: Palette.success)
            }

            actionRow
                .padding(.top, Spacing.md)

            stats
                .padding(.top, Spacing.sm)

            if !profile.isLimited {
                aboutCard
                    .padding(.horizontal, Spacing.xl)
                    .padding(.top, Spacing.md)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.bottom, Spacing.lg)
        .confirmationDialog(
            unfriendTitle,
            isPresented: $confirmsUnfriend,
            titleVisibility: .visible
        ) {
            Button(unfriendAction, role: .destructive) {
                Task { await model.friendshipAction() }
            }
        }
    }

    // MARK: Аватар и обложка

    @ViewBuilder
    private var visual: some View {
        let side = min(avatarSize, 140)
        if let url = profile.coverUrl.flatMap(URL.init(string:)) {
            // Обложка — спокойной карточкой, аватар наполовину на ней, как в Telegram
            // у каналов с фоном: имя и кнопки остаются на чистом фоне и читаются.
            ZStack(alignment: .bottom) {
                RemoteImage(url: url, cacheKey: "cover:\(profile.coverUrl?.split(separator: "?").first ?? "")")
                    .frame(height: coverHeight)
                    .frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                    .padding(.horizontal, Spacing.xl)
                    .padding(.bottom, side / 2)
                    .accessibilityHidden(true)
                AvatarView(url: profile.avatarUrl, name: profile.name, size: side)
                    .overlay(Circle().strokeBorder(Palette.background, lineWidth: 4))
            }
        } else {
            AvatarView(url: profile.avatarUrl, name: profile.name, size: side)
                .padding(.top, Spacing.md)
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

    // MARK: Кнопки

    /// Ряд круглых стеклянных кнопок. У себя — правка, друзья, сохранённое и «Ещё»;
    /// у другого — «Написать», дружба и «Ещё». Редкое — в меню, чтобы ряд не дробился.
    private var actionRow: some View {
        GlassGroup(spacing: Spacing.lg) {
            HStack(alignment: .top, spacing: Spacing.md) {
                if model.isMine {
                    Button(action: edit) {
                        HeroActionLabel(title: String(localized: "profile.edit", defaultValue: "Изменить"), symbol: "pencil")
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("profile.edit")
                    NavigationLink(value: AppRoute.community(.friends(userID: nil))) {
                        HeroActionLabel(title: CommunityScreen.friends(userID: nil).title, symbol: "person.2.fill")
                    }
                    .buttonStyle(.plain)
                    NavigationLink {
                        SavedPostsView()
                    } label: {
                        HeroActionLabel(title: String(localized: "saved.title", defaultValue: "Сохранённое"), symbol: "bookmark.fill")
                    }
                    .buttonStyle(.plain)
                } else if !profile.isLimited || model.friendship != nil {
                    if !CommunityPlatformState.shared.isDisabled("chats") {
                        Button {
                            Task { await openChat() }
                        } label: {
                            HeroActionLabel(title: String(localized: "profile.message", defaultValue: "Написать"), symbol: "bubble.left.fill")
                        }
                        .buttonStyle(.plain)
                    }
                    if let friendship = model.friendship {
                        friendshipButton(friendship)
                    }
                }
                moreMenu
            }
        }
        .padding(.horizontal, Spacing.xl)
    }

    /// Добавить и принять — сразу; убрать из друзей и отозвать заявку — через
    /// подтверждение: случайное касание не должно рвать дружбу.
    @ViewBuilder
    private func friendshipButton(_ friendship: FriendshipStatusDTO) -> some View {
        let label = HeroActionLabel(title: Self.friendshipTitle(friendship.status), symbol: Self.friendshipSymbol(friendship.status))
        switch friendship.status {
        case "NONE", "PENDING_INCOMING":
            Button {
                Task { await model.friendshipAction() }
            } label: { label }
                .buttonStyle(.plain)
                .sensoryFeedback(.success, trigger: friendship.status)
        default:
            Button {
                confirmsUnfriend = true
            } label: { label }
                .buttonStyle(.plain)
                .sensoryFeedback(.success, trigger: friendship.status)
        }
    }

    private var unfriendTitle: String {
        model.friendship?.status == "PENDING_OUTGOING"
            ? String(localized: "profile.friends.cancelConfirm", defaultValue: "Отозвать заявку в друзья?")
            : String(localized: "profile.friends.removeConfirm", defaultValue: "Удалить из друзей?")
    }

    private var unfriendAction: String {
        model.friendship?.status == "PENDING_OUTGOING"
            ? String(localized: "profile.friends.cancelAction", defaultValue: "Отозвать заявку")
            : String(localized: "profile.friends.removeAction", defaultValue: "Удалить из друзей")
    }

    private var moreMenu: some View {
        Menu {
            if !profile.isLimited {
                Button(action: details) {
                    Label(String(localized: "profile.details", defaultValue: "Подробнее"), systemImage: "info.circle")
                }
            }
            if model.isMine {
                Section {
                    NavigationLink(value: AppRoute.community(.myPosts)) {
                        Label(CommunityScreen.myPosts.title, systemImage: "clock.badge")
                    }
                    NavigationLink(value: AppRoute.community(.articles(userID: nil))) {
                        Label(CommunityScreen.articles(userID: nil).title, systemImage: "doc.richtext")
                    }
                    NavigationLink(value: AppRoute.community(.albums(userID: nil))) {
                        Label(CommunityScreen.albums(userID: nil).title, systemImage: "photo.stack")
                    }
                    if !viewerID.isEmpty {
                        NavigationLink(value: AppRoute.community(.highlights(userID: viewerID))) {
                            Label(CommunityScreen.highlights(userID: viewerID).title, systemImage: "sparkles")
                        }
                    }
                }
            } else if let id = model.userID, !profile.isLimited {
                Section {
                    NavigationLink(value: AppRoute.community(.articles(userID: id))) {
                        Label(CommunityScreen.articles(userID: id).title, systemImage: "doc.richtext")
                    }
                    NavigationLink(value: AppRoute.community(.albums(userID: id))) {
                        Label(CommunityScreen.albums(userID: id).title, systemImage: "photo.stack")
                    }
                    NavigationLink(value: AppRoute.community(.highlights(userID: id))) {
                        Label(CommunityScreen.highlights(userID: id).title, systemImage: "sparkles")
                    }
                }
            }
            if let universityID = profile.universityId {
                NavigationLink(value: AppRoute.community(.university(id: universityID))) {
                    Label(CommunityScreen.university(id: universityID).title, systemImage: "building.columns")
                }
            }
        } label: {
            HeroActionLabel(title: String(localized: "profile.more", defaultValue: "Ещё"), symbol: "ellipsis")
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("profile.more")
    }

    // MARK: Итоги

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
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    VStack(spacing: 0) {
                        Text(verbatim: "\(item.1 ?? 0)")
                            .font(Typography.tabular(.headline))
                            .foregroundStyle(Palette.foreground)
                        Text(item.0)
                            .font(.caption)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .padding(.horizontal, Spacing.xl)
        }
    }

    // MARK: О себе

    /// Карточка сведений под кнопками, как «о себе» и имя пользователя в Telegram:
    /// главное видно сразу, остальное — по строке «Подробнее».
    private var aboutCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let bio = profile.bio, !bio.isEmpty {
                aboutRow(title: String(localized: "profile.about", defaultValue: "О себе")) {
                    Text(bio)
                        .font(Typography.body)
                        .foregroundStyle(Palette.foreground)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                }
                Divider().padding(.leading, Spacing.xl)
            }
            if let username = profile.username, !username.isEmpty {
                aboutRow(title: String(localized: "profile.usernameTitle", defaultValue: "Имя пользователя")) {
                    Text(verbatim: "@\(username)")
                        .font(Typography.body)
                        .foregroundStyle(Palette.primary)
                        .textSelection(.enabled)
                }
                Divider().padding(.leading, Spacing.xl)
            }
            if let universityID = profile.universityId, let university = profile.universityName, !university.isEmpty {
                NavigationLink(value: AppRoute.community(.university(id: universityID))) {
                    aboutRow(title: String(localized: "profile.university", defaultValue: "Вуз"), chevron: true) {
                        Text(university)
                            .font(Typography.body)
                            .foregroundStyle(Palette.foreground)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .buttonStyle(.plain)
                Divider().padding(.leading, Spacing.xl)
            }
            Button(action: details) {
                HStack {
                    Text(String(localized: "profile.details", defaultValue: "Подробнее"))
                        .font(Typography.body)
                        .foregroundStyle(Palette.primary)
                    Spacer(minLength: Spacing.md)
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Palette.mutedForeground.opacity(0.6))
                        .accessibilityHidden(true)
                }
                .padding(.horizontal, Spacing.xl)
                .padding(.vertical, Spacing.lg)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("profile.details")
        }
        .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
    }

    private func aboutRow<Value: View>(title: String, chevron: Bool = false, @ViewBuilder value: () -> Value) -> some View {
        HStack(spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                value()
                Text(title)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            }
            Spacer(minLength: 0)
            if chevron {
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.mutedForeground.opacity(0.6))
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
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

/// Переключатель вкладок — капсула-дорожка как папки в Telegram, прилипает к верху
/// при прокрутке. Число рядом с названием — сколько там всего.
private struct ProfileTabBar: View {
    @Binding var selection: ProfileTab
    let counts: ProfileCountsDTO?

    var body: some View {
        FilterChips(
            options: ProfileTab.allCases.map { tab in
                let title = count(for: tab).map { $0 > 0 ? "\(tab.title) \($0)" : tab.title } ?? tab.title
                return (value: Optional(tab), title: title)
            },
            selection: Binding(get: { selection }, set: { if let next = $0 { selection = next } })
        )
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.sm)
        .frame(maxWidth: .infinity)
        .background(Palette.background)
        .accessibilityIdentifier("profile.tabs")
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
