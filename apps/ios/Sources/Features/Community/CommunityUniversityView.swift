import SwiftUI

/// Страница вуза (`/universities/[id]`): обложка, логотип, сведения и контакты,
/// публикации от имени вуза, фото, альбомы и статьи.
struct CommunityUniversityView: View {
    let universityID: String

    @Environment(\.viewerID) private var viewerID
    @State private var page: CommunityUniversityPageDTO?
    @State private var counts: ProfileCountsDTO?
    @State private var failure: String?
    @State private var tab: Tab = .posts
    @State private var posts: FeedModel
    @State private var media: [ProfileMediaDTO]?
    @State private var albums: [CommunityAlbumDTO]?
    @State private var articles: [CommunityArticleDTO]?
    @State private var viewing: CommunityMediaTarget?

    private let api = CommunityAPI()

    enum Tab: Hashable, CaseIterable {
        case posts, photos, albums, articles

        var title: String {
            switch self {
            case .posts: return String(localized: "community.university.posts", defaultValue: "Публикации")
            case .photos: return String(localized: "community.university.photos", defaultValue: "Фото и видео")
            case .albums: return String(localized: "community.screen.albums", defaultValue: "Альбомы")
            case .articles: return String(localized: "community.screen.articles", defaultValue: "Статьи")
            }
        }
    }

    init(universityID: String) {
        self.universityID = universityID
        _posts = State(initialValue: FeedModel(api: FeedAPI(scope: .universityPage(id: universityID))))
    }

    var body: some View {
        Group {
            if let page {
                content(page)
            } else if let failure {
                ErrorStateView(message: failure) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .background(Palette.background)
        .navigationTitle(Text(page?.shortName ?? page?.name ?? CommunityScreen.university(id: universityID).title))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .fullScreenCover(item: $viewing) { target in
            MediaViewer(media: target.media, start: target.start)
        }
    }

    private func content(_ page: CommunityUniversityPageDTO) -> some View {
        PostActionsHost(model: posts) { actions in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Spacing.lg, pinnedViews: [.sectionHeaders]) {
                    header(page)
                    about(page)
                    Section {
                        tabContent(actions: actions)
                    } header: {
                        Picker(String(localized: "community.university.tab", defaultValue: "Раздел"), selection: $tab) {
                            ForEach(Tab.allCases, id: \.self) { Text($0.title).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        .padding(.horizontal, Spacing.xl)
                        .padding(.vertical, Spacing.sm)
                        .background(Palette.background)
                    }
                }
                .padding(.bottom, Spacing.xxl)
            }
            .refreshable { await load() }
        }
        .task(id: tab) { await loadTab() }
    }

    private func header(_ page: CommunityUniversityPageDTO) -> some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            ZStack(alignment: .bottomLeading) {
                Group {
                    if let cover = page.coverUrl.flatMap(URL.init(string:)) {
                        RemoteImage(url: cover, cacheKey: "university-cover:\(page.id)")
                    } else {
                        LinearGradient(colors: [Palette.primary.opacity(0.55), Palette.chart3.opacity(0.4)], startPoint: .topLeading, endPoint: .bottomTrailing)
                    }
                }
                .frame(height: 140)
                .frame(maxWidth: .infinity)
                .clipped()
                .padding(.bottom, 40)

                AvatarView(url: page.logoUrl, name: page.shortName ?? page.name, size: 80)
                    .overlay(Circle().strokeBorder(Palette.background, lineWidth: 4))
                    .padding(.leading, Spacing.xl)
            }
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(page.name)
                    .font(.title2.weight(.bold))
                    .foregroundStyle(Palette.foreground)
                    .fixedSize(horizontal: false, vertical: true)
                let subtitle = [page.shortName, page.city, page.foundedYear.map { String(localized: "community.university.founded", defaultValue: "основан в \(String($0))") }]
                    .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
                if !subtitle.isEmpty {
                    Text(subtitle).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                }
                if let counts {
                    HStack(spacing: Spacing.xl) {
                        stat(counts.photos, String(localized: "profile.stat.photos", defaultValue: "фото"))
                        stat(counts.videos, String(localized: "profile.stat.videos", defaultValue: "видео"))
                        stat(counts.articles, String(localized: "profile.stat.articles", defaultValue: "статей"))
                    }
                    .padding(.top, Spacing.xs)
                }
            }
            .padding(.horizontal, Spacing.xl)
        }
    }

    private func stat(_ value: Int, _ title: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.xs) {
            Text(verbatim: value.formatted()).font(Typography.tabular(.subheadline.weight(.semibold)))
            Text(title).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func about(_ page: CommunityUniversityPageDTO) -> some View {
        let contacts: [(String, String, URL?)] = [
            ("globe", page.website, page.website.flatMap(URL.init(string:))),
            ("envelope", page.contactEmail, page.contactEmail.flatMap { URL(string: "mailto:\($0)") }),
            ("phone", page.contactPhone, page.contactPhone.flatMap { URL(string: "tel:\($0.filter { $0.isNumber || $0 == "+" })") }),
            ("mappin.and.ellipse", page.address, nil),
            ("paperplane", page.telegram, page.telegram.flatMap { URL(string: $0.hasPrefix("http") ? $0 : "https://t.me/\($0.trimmingCharacters(in: CharacterSet(charactersIn: "@")))") }),
            ("camera", page.instagram, page.instagram.flatMap { URL(string: $0.hasPrefix("http") ? $0 : "https://instagram.com/\($0.trimmingCharacters(in: CharacterSet(charactersIn: "@")))") }),
            ("link", page.linkedin, page.linkedin.flatMap(URL.init(string:))),
        ].compactMap { symbol, value, url in
            guard let value, !value.isEmpty else { return nil }
            return (symbol, value, url)
        }
        if (page.description?.isEmpty == false) || !contacts.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.md) {
                if let description = page.description, !description.isEmpty {
                    PostTextView(content: description, lineLimit: 6)
                }
                ForEach(contacts, id: \.1) { symbol, value, url in
                    if let url {
                        Link(destination: url) {
                            Label(value, systemImage: symbol).font(Typography.body)
                        }
                    } else {
                        Label(value, systemImage: symbol).font(Typography.body).foregroundStyle(Palette.foreground)
                    }
                }
            }
            .padding(Spacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .cardSurface()
            .padding(.horizontal, Spacing.xl)
        }
    }

    @ViewBuilder
    private func tabContent(actions: PostCardActions) -> some View {
        switch tab {
        case .posts:
            if !posts.hasLoaded {
                ProgressView().frame(maxWidth: .infinity).padding(Spacing.xxl)
            } else if posts.posts.isEmpty {
                EmptyStateView(title: String(localized: "profile.noPosts", defaultValue: "Публикаций пока нет"), symbol: "text.bubble")
            } else {
                ForEach(posts.posts) { post in
                    PostCardView(post: post, model: posts, viewerID: viewerID, actions: actions)
                        .padding(.horizontal, Spacing.xl)
                        .onAppear {
                            if post.id == posts.posts.last?.id { Task { await posts.loadMore() } }
                        }
                }
            }
        case .photos:
            if let media {
                if media.isEmpty {
                    EmptyStateView(title: String(localized: "profile.emptyTab", defaultValue: "Здесь пока пусто"), symbol: "photo")
                } else {
                    CommunityMediaGrid(items: media) { index in
                        viewing = CommunityMediaTarget(media: media.map(\.asPostMedia), start: index)
                    }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(Spacing.xxl)
            }
        case .albums:
            if let albums {
                if albums.isEmpty {
                    EmptyStateView(title: String(localized: "community.albums.empty", defaultValue: "Альбомов пока нет"), symbol: "photo.stack")
                } else {
                    ForEach(albums) { album in
                        CommunityAlbumRow(album: album)
                            .padding(.horizontal, Spacing.xl)
                    }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(Spacing.xxl)
            }
        case .articles:
            if let articles {
                if articles.isEmpty {
                    EmptyStateView(title: String(localized: "community.articles.empty", defaultValue: "Статей пока нет"), symbol: "doc.richtext")
                } else {
                    ForEach(articles) { article in
                        NavigationLink(value: AppRoute.community(.article(id: article.id))) {
                            CommunityArticleRow(article: article)
                                .padding(Spacing.lg)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .cardSurface()
                        }
                        .buttonStyle(.plain)
                        .padding(.horizontal, Spacing.xl)
                    }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(Spacing.xxl)
            }
        }
    }

    @MainActor
    private func load() async {
        do {
            page = try await api.universityPage(id: universityID)
            failure = nil
            counts = try? await api.universityCounts(id: universityID)
            await posts.refresh()
        } catch {
            failure = error.userMessage
        }
    }

    @MainActor
    private func loadTab() async {
        switch tab {
        case .posts: break
        case .photos: if media == nil { media = (try? await api.universityMedia(universityID: universityID)) ?? [] }
        case .albums: if albums == nil { albums = (try? await api.universityAlbums(universityID: universityID)) ?? [] }
        case .articles: if articles == nil { articles = (try? await api.universityArticles(universityID: universityID)) ?? [] }
        }
    }
}

struct CommunityMediaTarget: Identifiable {
    let id = UUID()
    let media: [PostDTO.Media]
    let start: Int
}

/// Сетка фото и видео в три колонки.
struct CommunityMediaGrid: View {
    let items: [ProfileMediaDTO]
    let open: (Int) -> Void
    var menu: ((ProfileMediaDTO) -> AnyView)?

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: 3), spacing: 2) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                Button {
                    open(index)
                } label: {
                    Palette.muted
                        .aspectRatio(1, contentMode: .fit)
                        .overlay { RemoteImage(url: item.thumbnailURL, cacheKey: "profile-media:\(item.id)") }
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
                .contextMenu {
                    if let menu { menu(item) }
                }
                .accessibilityLabel(Text(item.isVideo
                    ? String(localized: "profile.video", defaultValue: "Видео")
                    : String(localized: "profile.photo", defaultValue: "Фото")))
            }
        }
    }
}

/// Карточка альбома: обложка, название, число снимков.
struct CommunityAlbumRow: View {
    let album: CommunityAlbumDTO
    var link: AppRoute?

    var body: some View {
        let label = HStack(spacing: Spacing.lg) {
            Group {
                if let cover = album.coverUrl.flatMap(URL.init(string:)) {
                    RemoteImage(url: cover, cacheKey: "album:\(album.id):\(album.coverUrl?.split(separator: "?").first ?? "")")
                } else {
                    ZStack {
                        Palette.muted
                        Image(systemName: "photo.stack").foregroundStyle(Palette.mutedForeground)
                    }
                }
            }
            .frame(width: 64, height: 64)
            .clipShape(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(album.title).font(Typography.cardTitle).foregroundStyle(Palette.foreground)
                Text(String(localized: "community.albums.count", defaultValue: "Снимков: \((album.count ?? 0).formatted())"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            }
            Spacer(minLength: 0)
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)

        if let link {
            NavigationLink(value: link) { label.cardSurface() }.buttonStyle(.plain)
        } else {
            label.cardSurface()
        }
    }
}
