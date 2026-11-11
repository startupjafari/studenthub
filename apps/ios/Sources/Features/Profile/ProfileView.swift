import SwiftUI
import UIKit

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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var model: ProfileModel
    @State private var posts: FeedModel
    /// Выбранная вкладка переживает уход с экрана и восстановление сцены — у каждого
    /// профиля своя: вернувшись к себе, человек видит те же «Фото», где был.
    @SceneStorage private var tab: ProfileTab
    @State private var editing = false
    @State private var showsDetails = false
    @State private var viewing: MediaTarget?
    @State private var scroll = ProfileScrollMetrics()

    init(userID: String?) {
        self.userID = userID
        _model = State(initialValue: ProfileModel(userID: userID))
        // Посты автора — та же лента, что на главной, со своим срезом. Для своего
        // профиля id подставляется из токена в `task`, до того — общий срез не грузим.
        _posts = State(initialValue: FeedModel(api: FeedAPI(scope: userID.map { .author(id: $0) } ?? .all)))
        _tab = SceneStorage(wrappedValue: .posts, "profile.tab.\(userID ?? "me")")
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
        // Шапка уезжает под панель с плотным краем, а в панели появляется короткое имя —
        // компактная панель, как в Telegram. Мягкий край оставлял имя из шапки видным
        // сквозь размытие под заголовком; гасить шапку вручную — давало чёрную пустоту
        // над вкладками.
        .hardTopEdge()
        .navigationTitle(Text(navigationName))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // Полное имя — в шапке, до двух строк. В панели — короткое, и только когда
            // шапка уехала под неё: длинное ФИО не обрезается многоточием поверх шапки,
            // где оно и так видно целиком.
            ToolbarItem(placement: .principal) {
                let shows = scroll.nameScrolledAway || model.profile == nil
                Text(navigationName)
                    .font(.headline)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(1)
                    .opacity(shows ? 1 : 0)
                    .animation(.easeInOut(duration: Motion.Duration.feedback), value: shows)
                    .accessibilityHidden(!shows)
            }
            // Загрузка в профиль — «+» в панели на вкладках фото и видео, а не капсулы
            // над сеткой: они отнимали целую строку у самих снимков.
            if model.isMine, tab == .photos || tab == .videos {
                ToolbarItem(placement: .topBarTrailing) {
                    CommunityMediaUploadButton(layout: .icon) { _ in
                        async let photos: Void = model.loadTab(.photos, force: true)
                        async let videos: Void = model.loadTab(.videos, force: true)
                        async let card: Void = model.load()
                        _ = await (photos, videos, card)
                    }
                    .accessibilityIdentifier("profile.upload")
                }
            }
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
            // Экран возвращается после каждого «назад» из поста или списка друзей:
            // перечитывать профиль и пересоздавать ленту (со скелетом и потерей прокрутки)
            // незачем — обновление жестом.
            guard !posts.hasLoaded else { return }
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
        // Правка — переходом в том же стеке, а не листом со своей панелью: панель
        // вкладок остаётся, выход один — «Назад».
        .navigationDestination(isPresented: $editing) {
            ProfileEditView()
        }
        // Сохранённое в правке (и новое фото) приходит общим профилем — шапка
        // обновляется без запроса.
        .onChange(of: viewer.profile) { _, updated in
            guard model.isMine, let updated, model.profile != nil else { return }
            model.adopt(updated)
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

    private var navigationName: String {
        model.profile.map(Self.compactName) ?? String(localized: "more.profile", defaultValue: "Профиль")
    }

    /// Короткое имя для панели навигации — в том же порядке, что в шапке (`name`:
    /// фамилия, имя), иначе при прокрутке «Джафари Мехман» сменялся «Мехманом Джафари».
    /// Не влезают вместе — имя первой буквой. Отчество в панели лишнее, оно есть в шапке.
    static func compactName(_ profile: UserProfileDTO) -> String {
        let first = profile.firstName?.trimmingCharacters(in: .whitespaces) ?? ""
        let last = profile.lastName?.trimmingCharacters(in: .whitespaces) ?? ""
        guard !first.isEmpty else { return profile.name }
        guard !last.isEmpty else { return first }
        let full = "\(last) \(first)"
        return full.count <= 22 ? full : "\(last) \(first.prefix(1))."
    }

    private func content(_ profile: UserProfileDTO) -> some View {
        PostActionsHost(model: posts) { actions in
            ScrollViewReader { scroller in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                        ProfileHeaderView(
                            profile: profile,
                            model: model,
                            scrollTopInset: scroll.topInset,
                            nameScrolledAway: $scroll.nameScrolledAway,
                            edit: { editing = true },
                            details: { showsDetails = true },
                            open: { select($0, revealing: true, with: scroller) }
                        )

                        if profile.isLimited {
                            EmptyStateView(
                                title: String(localized: "profile.limited", defaultValue: "Профиль закрыт"),
                                symbol: "lock",
                                hint: String(localized: "profile.limited.hint", defaultValue: "Владелец ограничил, кто видит его страницу")
                            )
                            .padding(.vertical, Spacing.xxl)
                        } else {
                            CommunityHighlightsStrip(userID: profile.id)
                                .padding(.bottom, Spacing.md)

                            // Метка начала вкладок: к ней прокручивается экран при смене
                            // вкладки, когда полоса вкладок уже прилипла к верху.
                            Color.clear
                                .frame(height: 0)
                                .id(ProfileScrollMetrics.tabsAnchor)

                            Section {
                                tabContent(actions: actions)
                                    .padding(.top, Spacing.lg)
                                    // Короткая вкладка не короче экрана под полосой: при
                                    // переключении с длинной ленты экран не прыгает вверх.
                                    .frame(minHeight: scroll.tabContentMinHeight, alignment: .top)
                            } header: {
                                ProfileTabBar(
                                    selection: Binding(get: { tab }, set: { select($0, revealing: false, with: scroller) })
                                )
                                // Признак, а не координата: координата меняется на каждом
                                // кадре прокрутки и перерисовывала бы весь экран.
                                .onGeometryChange(for: Bool.self) { [topInset = scroll.topInset] proxy in
                                    proxy.frame(in: .scrollView).minY <= topInset + 1
                                } action: { pinned in
                                    scroll.tabsPinned = pinned
                                }
                                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { scroll.tabBarHeight = $0 }
                            }
                        }
                    }
                    .padding(.bottom, Spacing.xxl)
                }
                .onGeometryChange(for: EdgeInsets.self) { $0.safeAreaInsets } action: { scroll.insets = $0 }
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { scroll.height = $0 }
            }
        }
    }

    /// Смена вкладки. Полоса вкладок прилипла — экран встаёт к началу новой вкладки, а
    /// не остаётся посреди прежней ленты. `revealing` — прокрутить к вкладкам в любом
    /// случае (касание итога в шапке).
    private func select(_ next: ProfileTab, revealing: Bool, with scroller: ScrollViewProxy) {
        let animation = Motion.respecting(.snappy(duration: 0.3), reduceMotion: reduceMotion)
        let reveals = revealing || scroll.tabsPinned
        withAnimation(animation) {
            tab = next
            if reveals { scroller.scrollTo(ProfileScrollMetrics.tabsAnchor, anchor: .top) }
        }
        Task { await model.loadTab(next) }
    }

    @ViewBuilder
    private func tabContent(actions: PostCardActions) -> some View {
        Group {
            switch tab {
            case .posts:
                postsTab(actions: actions)
            case .photos:
                mediaGrid(model.photos, tab: .photos)
            case .videos:
                mediaGrid(model.videos, tab: .videos)
            case .articles:
                tabState(model.articles, tab: .articles) { articles in
                    LazyVStack(spacing: Spacing.md) {
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
                    LazyVStack(spacing: Spacing.md) {
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
        // Вкладка сменяется растворением, без сдвига: содержимое разной высоты, и
        // сдвиг читался бы как прыжок.
        .id(tab)
        .transition(.opacity)
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
            ProfileEmptyState(tab: .posts, isMine: model.isMine)
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

    /// Сетка фото или видео — сразу под вкладками, как медиа в профиле Telegram.
    /// Загрузка — «+» в панели, альбомы — в меню «Ещё».
    private func mediaGrid(_ items: [ProfileMediaDTO]?, tab: ProfileTab) -> some View {
        tabState(items, tab: tab) { items in
            ProfileMediaGrid(items: items) { index in
                viewing = MediaTarget(media: items.map(\.asPostMedia), start: index)
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
                ProfileEmptyState(tab: tab, isMine: model.isMine)
            } else {
                content(items)
            }
        } else if let failure = model.tabFailure[tab] {
            ErrorStateView(message: failure, isOffline: model.offlineTabs.contains(tab)) { await model.loadTab(tab, force: true) }
        } else {
            ProgressView()
                .frame(maxWidth: .infinity)
                .padding(Spacing.xxl)
                .task { await model.loadTab(tab) }
        }
    }
}

/// Геометрия прокрутки профиля: что видно под панелью навигации.
private struct ProfileScrollMetrics {
    static let tabsAnchor = "profile.tabs.anchor"

    /// Отступы безопасной области прокрутки: сверху — панель навигации, снизу — вкладки
    /// приложения (кнопка «Домой» и соседи).
    var insets = EdgeInsets()
    var height: CGFloat = 0
    var tabBarHeight: CGFloat = 52
    /// Имя в шапке уехало под панель навигации.
    var nameScrolledAway = false
    /// Полоса вкладок прилипла к верху (с запасом в точку на округление).
    var tabsPinned = false

    var topInset: CGFloat { insets.top }

    /// Видимая высота под прилипшей полосой вкладок.
    var tabContentMinHeight: CGFloat {
        max(0, height - insets.top - insets.bottom - tabBarHeight)
    }
}

private struct MediaTarget: Identifiable {
    let id = UUID()
    let media: [PostDTO.Media]
    let start: Int
}

/// Пустая вкладка — одна на все пять: заголовок и значок по вкладке, подсказка — только
/// в своём профиле.
private struct ProfileEmptyState: View {
    let tab: ProfileTab
    let isMine: Bool

    var body: some View {
        EmptyStateView(title: tab.emptyTitle, symbol: tab.symbol, hint: isMine ? tab.emptyHint : nil)
            .padding(.vertical, Spacing.md)
    }
}

// MARK: - Сетка медиа

/// Сетка фото или видео в три колонки, как в Instagram.
///
/// Плитка берёт копию под свой размер, а не полный кадр: распакованный снимок с
/// телефона — десятки мегабайт, а плитке нужна треть ширины экрана. Ключ кэша включает
/// размер копии, чтобы её не перепутать с полноразмерной из просмотра.
private struct ProfileMediaGrid: View {
    let items: [ProfileMediaDTO]
    let open: (Int) -> Void

    @Environment(\.displayScale) private var displayScale
    @State private var tileSide: CGFloat = 130

    private static let gap: CGFloat = 2
    private let columns = Array(repeating: GridItem(.flexible(), spacing: gap), count: 3)

    var body: some View {
        // Размер копии округлён до шага: поворот или другой экран не плодят по копии
        // на каждую точку ширины.
        let pixels = max(64, (tileSide * displayScale / 64).rounded(.up) * 64)
        LazyVGrid(columns: columns, spacing: Self.gap) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                Button {
                    open(index)
                } label: {
                    ProfileMediaTile(item: item, pixels: pixels)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(item.isVideo
                    ? String(localized: "profile.video", defaultValue: "Видео")
                    : String(localized: "profile.photo", defaultValue: "Фото")))
            }
        }
        .onGeometryChange(for: CGFloat.self) { ($0.size.width - Self.gap * 2) / 3 } action: { side in
            tileSide = max(side, 1)
        }
    }
}

private struct ProfileMediaTile: View {
    let item: ProfileMediaDTO
    let pixels: CGFloat

    var body: some View {
        // Квадрат задан до загрузки картинки — плитка не меняет размер, когда она приходит.
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                RemoteImage(
                    url: item.thumbnailURL,
                    cacheKey: "profile-media:\(item.id):\(Int(pixels))",
                    maxPixelSize: pixels
                )
            }
            // Видео — длительность в углу, как в медиа Telegram; пока сервер её не
            // измерил — значок воспроизведения.
            .overlay(alignment: .bottomLeading) {
                if item.isVideo {
                    Group {
                        if let duration = item.durationMs, duration > 0 {
                            Text(verbatim: DisplayFormat.duration(milliseconds: duration))
                                .font(Typography.tabular(.caption2.weight(.semibold)))
                        } else {
                            Image(systemName: "play.fill")
                                .font(.caption2.weight(.bold))
                        }
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, Spacing.sm)
                    .padding(.vertical, 2)
                    .background(.black.opacity(0.45), in: Capsule())
                    .padding(Spacing.sm)
                    .accessibilityHidden(true)
                }
            }
            .clipped()
            .contentShape(Rectangle())
    }
}

// MARK: - Шапка

/// Шапка как профиль в Telegram: аватар по центру (на обложке, если она есть), имя до
/// двух строк, кто это, итоги одной строкой, ряд круглых стеклянных кнопок и компактная
/// карточка «о себе».
private struct ProfileHeaderView: View {
    let profile: UserProfileDTO
    let model: ProfileModel
    /// Верхний отступ прокрутки (панель навигации): по нему видно, ушло ли имя под неё.
    let scrollTopInset: CGFloat
    @Binding var nameScrolledAway: Bool
    let edit: () -> Void
    let details: () -> Void
    /// Открыть вкладку по касанию итога («12 фото» → «Фото»).
    let open: (ProfileTab) -> Void

    @Environment(\.viewerID) private var viewerID
    @ScaledMetric(relativeTo: .title) private var avatarSize: CGFloat = 84
    @State private var confirmsUnfriend = false

    private let coverHeight: CGFloat = 112
    /// Ширина колонки кнопки: четыре колонки на любом iPhone, у трёх — та же ширина.
    private let actionWidth: CGFloat = 92

    var body: some View {
        VStack(spacing: Spacing.sm) {
            visual
                .padding(.bottom, Spacing.xs)

            identity

            stats

            actionRow
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
        let side = min(avatarSize, 112)
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
        }
    }

    // MARK: Кто это

    private var identity: some View {
        VStack(spacing: Spacing.xs) {
            // Полное имя — до двух строк, длинное слегка ужимается, а не режется
            // посередине фамилии.
            Text(profile.name)
                .font(.title2.weight(.bold))
                .foregroundStyle(Palette.foreground)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.85)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .onGeometryChange(for: Bool.self) { proxy in
                    proxy.frame(in: .scrollView).maxY < scrollTopInset
                } action: { hidden in
                    nameScrolledAway = hidden
                }

            if let headline = profile.headline, !headline.isEmpty {
                Text(headline)
                    .font(.subheadline)
                    .foregroundStyle(Palette.foreground)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !subtitle.isEmpty {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(Palette.mutedForeground)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let status = profile.academicStatus, !status.isEmpty {
                StatusBadge(text: status, tint: Palette.success)
                    .padding(.top, Spacing.xs)
            }
        }
        .padding(.horizontal, Spacing.xl)
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
    ///
    /// У каждой кнопки, включая меню, — колонка одной ширины: круги стоят на равных
    /// расстояниях, подписи — строго под своим кругом.
    private var actionRow: some View {
        GlassGroup(spacing: Spacing.lg) {
            HStack(alignment: .top, spacing: Spacing.xs) {
                if model.isMine {
                    Button(action: edit) {
                        HeroActionLabel(title: String(localized: "profile.edit", defaultValue: "Изменить"), symbol: "pencil")
                    }
                    .buttonStyle(.plain)
                    .frame(maxWidth: actionWidth)
                    .accessibilityIdentifier("profile.edit")
                    NavigationLink(value: AppRoute.community(.friends(userID: nil))) {
                        HeroActionLabel(title: CommunityScreen.friends(userID: nil).title, symbol: "person.2.fill")
                    }
                    .buttonStyle(.plain)
                    .frame(maxWidth: actionWidth)
                    NavigationLink {
                        SavedPostsView()
                    } label: {
                        HeroActionLabel(title: String(localized: "saved.title", defaultValue: "Сохранённое"), symbol: "bookmark.fill")
                    }
                    .buttonStyle(.plain)
                    .frame(maxWidth: actionWidth)
                } else if !profile.isLimited || model.friendship != nil {
                    if !CommunityPlatformState.shared.isDisabled("chats") {
                        Button {
                            Task { await openChat() }
                        } label: {
                            HeroActionLabel(title: String(localized: "profile.message", defaultValue: "Написать"), symbol: "bubble.left.fill")
                        }
                        .buttonStyle(.plain)
                        .frame(maxWidth: actionWidth)
                    }
                    if let friendship = model.friendship {
                        friendshipButton(friendship)
                            .frame(maxWidth: actionWidth)
                    }
                }
                moreMenu
                    .frame(maxWidth: actionWidth)
            }
            .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, Spacing.md)
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
                .disabled(model.isChangingFriendship)
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

    /// «Ещё» — та же подпись, что у соседей, а меню открывает прозрачная кнопка UIKit
    /// поверх неё (`MenuOverlay`). SwiftUI-`Menu` на iOS 26 обводит подпись своим
    /// стеклом — круг вокруг значка и подписи разом, и «Ещё» выходило крупнее соседей;
    /// `.menuStyle(.button)` и `.buttonStyle(.plain)` этого не снимают.
    private var moreMenu: some View {
        let title = String(localized: "profile.more", defaultValue: "Ещё")
        return HeroActionLabel(title: title, symbol: "ellipsis")
            .accessibilityHidden(true)
            .overlay {
                MenuOverlay(menu: moreMenuContent, accessibilityLabel: title, accessibilityIdentifier: "profile.more")
            }
    }

    private var moreMenuContent: UIMenu {
        var groups: [UIMenuElement] = []
        // «Подробнее» в меню нет: это строка карточки под кнопками, третий вход туда же
        // был лишним.
        if model.isMine {
            var links = [
                Self.menuLink(CommunityScreen.myPosts.title, symbol: "clock.badge", route: .community(.myPosts)),
                Self.menuLink(CommunityScreen.articles(userID: nil).title, symbol: "doc.richtext", route: .community(.articles(userID: nil))),
                Self.menuLink(CommunityScreen.albums(userID: nil).title, symbol: "photo.stack", route: .community(.albums(userID: nil))),
            ]
            if !viewerID.isEmpty {
                links.append(Self.menuLink(
                    CommunityScreen.highlights(userID: viewerID).title,
                    symbol: "sparkles",
                    route: .community(.highlights(userID: viewerID))
                ))
            }
            groups.append(Self.menuGroup(links))
        } else if let id = model.userID, !profile.isLimited {
            groups.append(Self.menuGroup([
                Self.menuLink(CommunityScreen.articles(userID: id).title, symbol: "doc.richtext", route: .community(.articles(userID: id))),
                Self.menuLink(CommunityScreen.albums(userID: id).title, symbol: "photo.stack", route: .community(.albums(userID: id))),
                Self.menuLink(CommunityScreen.highlights(userID: id).title, symbol: "sparkles", route: .community(.highlights(userID: id))),
            ]))
        }
        if let universityID = profile.universityId {
            groups.append(Self.menuGroup([
                Self.menuLink(
                    CommunityScreen.university(id: universityID).title,
                    symbol: "building.columns",
                    route: .community(.university(id: universityID))
                ),
            ]))
        }
        return UIMenu(children: groups)
    }

    private static func menuGroup(_ actions: [UIAction]) -> UIMenu {
        UIMenu(options: .displayInline, children: actions)
    }

    /// Переход из меню — в стек текущей вкладки, как `NavigationLink(value:)`: профиль
    /// всегда открыт в стеке вкладки (`AppShellView`).
    private static func menuLink(_ title: String, symbol: String, route: AppRoute) -> UIAction {
        UIAction(title: title, image: UIImage(systemName: symbol)) { _ in
            let router = AppServices.router
            router.stacks[router.selectedTab, default: []].append(route)
        }
    }

    // MARK: Итоги

    private struct Stat: Identifiable {
        let id: String
        let title: String
        let value: Int
        /// Вкладка профиля, которую открывает касание. `nil` — друзья (свой список).
        let tab: ProfileTab?
    }

    private var statItems: [Stat] {
        var items: [Stat] = []
        if let friends = model.friendsCount {
            items.append(Stat(id: "friends", title: String(localized: "profile.stat.friends", defaultValue: "друзей"), value: friends, tab: nil))
        }
        if let counts = model.counts {
            items.append(Stat(id: "photos", title: String(localized: "profile.stat.photos", defaultValue: "фото"), value: counts.photos, tab: .photos))
            items.append(Stat(id: "videos", title: String(localized: "profile.stat.videos", defaultValue: "видео"), value: counts.videos, tab: .videos))
            items.append(Stat(id: "articles", title: String(localized: "profile.stat.articles", defaultValue: "статей"), value: counts.articles, tab: .articles))
        }
        return items
    }

    /// Итоги одной строкой под именем, как в Instagram: число и подпись. Касание открывает
    /// свою вкладку, «друзей» — список друзей.
    @ViewBuilder
    private var stats: some View {
        let items = statItems
        if !items.isEmpty {
            HStack(alignment: .top, spacing: 0) {
                ForEach(items) { item in
                    statButton(item)
                        .frame(maxWidth: actionWidth)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, Spacing.md)
            .padding(.top, Spacing.xs)
        } else if !profile.isLimited {
            // Итоги приходят вторым запросом: место под строку занято заранее, иначе
            // кнопки и карточка под ней прыгали вниз, когда числа доезжали.
            Color.clear
                .frame(height: 44)
                .padding(.top, Spacing.xs)
                .accessibilityHidden(true)
        }
    }

    @ViewBuilder
    private func statButton(_ item: Stat) -> some View {
        let label = VStack(spacing: 0) {
            Text(verbatim: "\(item.value)")
                .font(Typography.tabular(.headline))
                .foregroundStyle(Palette.foreground)
            Text(item.title)
                .font(.caption)
                .foregroundStyle(Palette.mutedForeground)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, minHeight: 44)
        .contentShape(Rectangle())

        if let tab = item.tab {
            Button { open(tab) } label: { label }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isButton)
        } else if model.isMine {
            NavigationLink(value: AppRoute.community(.friends(userID: nil))) { label }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
        } else {
            label.accessibilityElement(children: .combine)
        }
    }

    // MARK: О себе

    /// Строка карточки «о себе».
    private enum AboutItem: Identifiable {
        case bio(String)
        case username(String)
        case contact(ProfileContact)
        case university(id: String, name: String)
        case details

        var id: String {
            switch self {
            case .bio: return "bio"
            case .username: return "username"
            case .contact(let contact): return "contact:\(contact.title)"
            case .university: return "university"
            case .details: return "details"
            }
        }
    }

    private var aboutItems: [AboutItem] {
        var items: [AboutItem] = []
        if let bio = profile.bio, !bio.isEmpty { items.append(.bio(bio)) }
        if let username = profile.username, !username.isEmpty { items.append(.username(username)) }
        items += ProfileContact.rows(for: profile).map(AboutItem.contact)
        if let id = profile.universityId, let name = profile.universityName, !name.isEmpty {
            items.append(.university(id: id, name: name))
        }
        if ProfileDetailsView.hasDetails(profile) { items.append(.details) }
        return items
    }

    /// Карточка сведений под кнопками, как в профиле Telegram: о себе, имя
    /// пользователя, контакты и вуз видны сразу, учёба и навыки — по строке
    /// «Подробнее», если они есть. Строки — однострочные, со значком вместо подписи
    /// сверху: подпись читает VoiceOver. Разделители — только между строками.
    @ViewBuilder
    private var aboutCard: some View {
        let items = aboutItems
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    aboutItem(item)
                    if index < items.count - 1 { rowDivider }
                }
            }
            .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        }
    }

    @ViewBuilder
    private func aboutItem(_ item: AboutItem) -> some View {
        switch item {
        case .bio(let bio):
            Text(bio)
                .font(Typography.body)
                .foregroundStyle(Palette.foreground)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Spacing.xl)
                .padding(.vertical, Spacing.lg)
                .accessibilityLabel(Text(String(localized: "profile.about", defaultValue: "О себе")))
                .accessibilityValue(Text(bio))
        case .username(let username):
            aboutRow(
                symbol: "at",
                text: "@\(username)",
                tint: Palette.primary,
                title: String(localized: "profile.usernameTitle", defaultValue: "Имя пользователя"),
                selectable: true
            )
        case .contact(let contact):
            if let url = contact.url {
                Link(destination: url) {
                    aboutRow(symbol: contact.symbol, text: contact.value, tint: Palette.primary, title: contact.title)
                }
                .buttonStyle(.plain)
            } else {
                aboutRow(symbol: contact.symbol, text: contact.value, tint: Palette.foreground, title: contact.title, selectable: true)
            }
        case .university(let id, let name):
            NavigationLink(value: AppRoute.community(.university(id: id))) {
                aboutRow(
                    symbol: "building.columns",
                    text: name,
                    tint: Palette.foreground,
                    title: String(localized: "profile.university", defaultValue: "Вуз"),
                    chevron: true
                )
            }
            .buttonStyle(.plain)
        case .details:
            Button(action: details) {
                aboutRow(
                    symbol: "info.circle",
                    text: String(localized: "profile.details", defaultValue: "Подробнее"),
                    tint: Palette.primary,
                    chevron: true
                )
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("profile.details")
        }
    }

    /// Разделитель — от начала текста строки, как в сгруппированном списке iOS.
    private var rowDivider: some View {
        Divider().padding(.leading, Spacing.xl + Self.rowIconWidth + Spacing.lg)
    }

    private static let rowIconWidth: CGFloat = 24

    /// Строка карточки: значок, значение до двух строк, шеврон у переходов. Подпись
    /// («Имя пользователя», «Вуз») не рисуется — её читает VoiceOver, а значок и так
    /// говорит, что это за строка.
    @ViewBuilder
    private func aboutRow(
        symbol: String,
        text: String,
        tint: Color,
        title: String? = nil,
        chevron: Bool = false,
        selectable: Bool = false
    ) -> some View {
        let row = HStack(spacing: Spacing.lg) {
            Image(systemName: symbol)
                .font(.body)
                .foregroundStyle(Palette.mutedForeground)
                .frame(width: Self.rowIconWidth)
                .accessibilityHidden(true)
            Group {
                if selectable {
                    Text(verbatim: text).textSelection(.enabled)
                } else {
                    Text(verbatim: text)
                }
            }
            .font(Typography.body)
            .foregroundStyle(tint)
            .lineLimit(2)
            .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
            if chevron {
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.mutedForeground.opacity(0.6))
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.md)
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .contentShape(Rectangle())

        if let title {
            row
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(title))
                .accessibilityValue(Text(verbatim: text))
        } else {
            row
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: text))
        }
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
/// при прокрутке. Пункты делят ширину поровну, если влезают. Чисел в названиях нет:
/// они уже в итогах под именем. Выбранную вкладку дорожка сама докручивает в поле
/// зрения (`FilterChips`).
private struct ProfileTabBar: View {
    @Binding var selection: ProfileTab

    var body: some View {
        FilterChips(
            options: ProfileTab.allCases.map { (value: Optional($0), title: $0.title) },
            selection: Binding(get: { selection }, set: { if let next = $0 { selection = next } }),
            fillsWidth: true
        )
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.sm)
        .frame(maxWidth: .infinity)
        // Без подложки: прилипнув, полоса — одна стеклянная капсула, а не чёрная
        // полоса поперёк снимков.
        .accessibilityIdentifier("profile.tabs")
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
                ArticleMetaLine(date: article.publishedAt ?? article.createdAt, minutes: article.readingMinutes, views: article.views)
            }
            Spacer(minLength: 0)
        }
        .cardSurface(padding: Spacing.lg)
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
        .cardSurface(padding: Spacing.lg)
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

// MARK: - Меню UIKit

/// Прозрачная кнопка UIKit, которая по касанию открывает меню. Сама ничего не рисует —
/// под ней своя подпись (`HeroActionLabel`), и системное стекло меню её не обводит.
private struct MenuOverlay: UIViewRepresentable {
    let menu: UIMenu
    let accessibilityLabel: String
    let accessibilityIdentifier: String

    func makeUIView(context: Context) -> UIButton {
        let button = UIButton(type: .custom)
        button.showsMenuAsPrimaryAction = true
        button.backgroundColor = .clear
        return button
    }

    func updateUIView(_ button: UIButton, context: Context) {
        button.menu = menu
        button.accessibilityLabel = accessibilityLabel
        button.accessibilityIdentifier = accessibilityIdentifier
    }
}
