import PhotosUI
import SwiftUI

// Статьи: список автора (свои — с черновиками и сохранёнными), чтение с лайком,
// закладкой и комментариями, создание и правка своих (`/articles/[id]`, `/profile/articles/*`).

// MARK: - Список

struct CommunityArticlesView: View {
    /// `nil` — свои.
    let userID: String?

    @Environment(\.viewerID) private var viewerID
    @State private var shelf: Shelf = .written
    @State private var reload = 0
    @State private var creating = false

    enum Shelf: Hashable {
        case written, saved
    }

    private var ownerID: String { userID ?? viewerID }
    private var isMine: Bool { userID == nil || userID == viewerID }

    var body: some View {
        RemoteContent(reloadToken: reload &+ (shelf == .saved ? 1_000_000 : 0)) {
            if isMine, shelf == .saved { return try await CommunityAPI().bookmarkedArticles() }
            guard !ownerID.isEmpty else { return [CommunityArticleDTO]() }
            return try await CommunityAPI().articles(userID: ownerID)
        } content: { articles in
            List {
                if isMine {
                    FilterChipsRow(
                        options: [
                            (value: Shelf.written, title: String(localized: "community.articles.mine", defaultValue: "Мои")),
                            (value: Shelf.saved, title: String(localized: "community.articles.saved", defaultValue: "Сохранённые")),
                        ],
                        selection: Binding(get: { shelf }, set: { if let next = $0 { shelf = next } }),
                        fillsWidth: true
                    )
                }
                if !articles.isEmpty {
                    Section {
                        ForEach(articles) { article in
                            NavigationLink(value: AppRoute.community(.article(id: article.id))) {
                                CommunityArticleRow(article: article)
                            }
                        }
                    }
                }
            }
            .compactListStyle()
            // Без кнопки «Написать статью»: то же действие — у плавающей кнопки.
            .screenState(articles.isEmpty) {
                EmptyStateView(
                    title: shelf == .saved
                        ? String(localized: "community.articles.noSaved", defaultValue: "Сохранённых статей нет")
                        : String(localized: "community.articles.empty", defaultValue: "Статей пока нет"),
                    symbol: "doc.richtext",
                    hint: emptyHint
                )
            }
            .pullToRefresh { reload += 1 }
        }
        .background(Palette.background)
        .navigationTitle(Text(CommunityScreen.articles(userID: nil).title))
        .navigationBarTitleDisplayMode(.inline)
        .communityFloatingAction(isMine, String(localized: "community.articles.new", defaultValue: "Написать статью"), symbol: "square.and.pencil") {
            creating = true
        }
        .sheet(isPresented: $creating) {
            CommunityArticleEditor(article: nil) { _ in reload += 1 }
        }
    }

    private var emptyHint: String? {
        guard isMine else { return nil }
        return shelf == .saved
            ? String(localized: "community.articles.noSaved.hint", defaultValue: "Нажмите на закладку в статье, чтобы вернуться к ней позже")
            : String(localized: "community.articles.empty.hint", defaultValue: "Расскажите о своём опыте — статья появится в профиле")
    }
}

struct CommunityArticleRow: View {
    let article: CommunityArticleDTO

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.lg) {
            if let cover = article.coverUrl.flatMap(URL.init(string:)) {
                RemoteImage(url: cover, cacheKey: "article:\(article.id)")
                    .frame(width: 72, height: 72)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
            } else {
                RowSymbol(symbol: "doc.richtext.fill", tint: TileTint.indigo)
            }
            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack(alignment: .firstTextBaseline) {
                    Text(article.title)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Palette.foreground)
                        .lineLimit(3)
                    if article.isDraft {
                        StatusBadge(text: String(localized: "community.articles.draft", defaultValue: "Черновик"), tint: Palette.warning)
                    }
                }
                if let description = article.description, !description.isEmpty {
                    Text(description)
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(2)
                }
                ArticleMetaLine(date: article.publishedAt ?? article.createdAt, minutes: article.readingMinutes, views: article.views)
            }
        }
        .padding(.vertical, Spacing.xs)
        .accessibilityElement(children: .combine)
    }
}

/// Строка сведений статьи: «22 авг. 2025 · 1 мин · 👁 8». Части через точку, как
/// подписи в ленте, а число просмотров — вплотную к своему значку, не в стороне.
struct ArticleMetaLine: View {
    let date: Date?
    let minutes: Int?
    let views: Int?

    var body: some View {
        HStack(spacing: Spacing.xs) {
            Text(DisplayFormat.date(date))
            if let minutes, minutes > 0 {
                Text(verbatim: "·")
                Text(String(localized: "profile.article.minutes", defaultValue: "\(minutes) мин"))
            }
            if let views, views > 0 {
                Text(verbatim: "·")
                HStack(spacing: 2) {
                    Image(systemName: "eye")
                        .imageScale(.small)
                    Text(views.formatted())
                }
            }
        }
        .font(Typography.meta)
        .foregroundStyle(Palette.mutedForeground)
        .lineLimit(1)
    }
}

// MARK: - Чтение

/// Статья для чтения: обложка, крупный заголовок и текст во всю ширину, как в
/// «Новостях» и Medium, а не карточкой в сгруппированном списке — там текст сжимался
/// отступами секции и рвался переносами. Ниже — панель действий, автор, комментарии и
/// похожие статьи.
struct CommunityArticleView: View {
    let articleID: String

    @Environment(\.viewerID) private var viewerID
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var article: CommunityArticleDTO?
    @State private var failure: String?
    @State private var isOffline = false
    @State private var related: [CommunityArticleDTO] = []
    @State private var comments = PagedLoader<CommunityArticleCommentDTO>(limit: 30) { _ in Page(items: [], meta: nil) }
    @State private var draft = ""
    @State private var isSending = false
    @State private var editing = false
    @State private var confirmingDelete = false
    @State private var deletingComment: CommunityArticleCommentDTO?
    @State private var actionFailure: String?
    @State private var reposted = false
    @State private var viewingCover = false
    /// Заголовок статьи уехал под панель — тогда он появляется в самой панели.
    @State private var titleScrolledAway = false
    /// Высота панели навигации над прокруткой: по ней видно, что заголовок ушёл под неё.
    @State private var scrollTopInset: CGFloat = 0
    /// Счётчики для отклика: растут на каждое действие, на них смотрит `sensoryFeedback`.
    /// Само значение (`liked`) не годится — оно меняется и при загрузке, и при откате.
    @State private var likeTick = 0
    @State private var bookmarkTick = 0
    @State private var sentTick = 0
    @FocusState private var isComposing: Bool

    private let api = CommunityAPI()

    /// Ширина колонки текста: на iPad и в альбомной ориентации строка длиннее ~70 знаков
    /// читается тяжело — глаз теряет начало следующей.
    private static let readableWidth: CGFloat = 680
    private static let commentsAnchor = "article.comments"
    /// Аватар в строке комментария (`CommunityCommentRow`): от него отступает разделитель.
    private static let commentAvatar: CGFloat = 32

    var body: some View {
        Group {
            if let article {
                content(article)
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .background(Palette.background)
        // Текст статьи плавно тает под панелью, без резкой границы.
        .softTopEdge()
        .navigationTitle(Text(CommunityScreen.article(id: articleID).title))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // Заголовок статьи — в панели, только когда крупный заголовок в начале уехал
            // под неё: иначе он повторялся бы дважды друг над другом.
            ToolbarItem(placement: .principal) {
                let shows = titleScrolledAway || article == nil
                Text(article?.title ?? CommunityScreen.article(id: articleID).title)
                    .font(.headline)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(1)
                    .opacity(shows ? 1 : 0)
                    .animation(.easeInOut(duration: Motion.Duration.feedback), value: shows)
                    .accessibilityHidden(!shows)
            }
        }
        .task { await load() }
        .sheet(isPresented: $editing) {
            if let article {
                CommunityArticleEditor(article: article) { updated in self.article = updated }
            }
        }
        .fullScreenCover(isPresented: $viewingCover) {
            if let cover = article?.coverUrl {
                MediaViewer(media: [PostDTO.Media(id: "article-cover-\(articleID)", url: cover, mime: "image/jpeg", sources: nil, poster: nil, hls: nil)], start: 0)
            }
        }
        .alert(
            String(localized: "community.article.delete.title", defaultValue: "Удалить статью?"),
            isPresented: $confirmingDelete
        ) {
            Button(String(localized: "feed.delete", defaultValue: "Удалить"), role: .destructive) {
                Task { await deleteArticle() }
            }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
        }
        .confirmDestructive(
            $deletingComment,
            title: { _ in String(localized: "community.comment.delete.title", defaultValue: "Удалить комментарий?") },
            actionTitle: String(localized: "feed.delete", defaultValue: "Удалить")
        ) { comment in
            do {
                try await api.deleteArticleComment(articleID: articleID, commentID: comment.id)
                comments.remove(id: comment.id)
            } catch {
                actionFailure = error.userMessage
            }
        }
        .alert(String(localized: "community.article.reposted", defaultValue: "Статья опубликована в ленте группы"), isPresented: $reposted) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        }
        .actionFailureAlert($actionFailure)
        .sensoryFeedback(.impact(weight: .light), trigger: likeTick)
        .sensoryFeedback(.selection, trigger: bookmarkTick)
        .sensoryFeedback(.success, trigger: sentTick)
        .sensoryFeedback(.success, trigger: reposted) { _, new in new }
    }

    private func content(_ article: CommunityArticleDTO) -> some View {
        ScrollViewReader { scroller in
            ScrollView {
                // Ленивый стек — ради комментариев: строка просит следующую страницу, когда
                // показалась на экране, а в обычном стеке «показались» бы сразу все.
                LazyVStack(alignment: .leading, spacing: 0) {
                    header(article)
                    Divider()
                        .padding(.vertical, Spacing.xl)
                    CommunityMarkdownView(source: article.content ?? "")
                    actionBar(article) {
                        withAnimation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion)) {
                            scroller.scrollTo(Self.commentsAnchor, anchor: .top)
                        }
                    }
                    .padding(.top, Spacing.xxl)

                    if let author = article.userId, article.company == nil, article.universityPage == nil {
                        authorRow(author)
                            .padding(.top, Spacing.lg)
                    }

                    sectionTitle(String(localized: "feed.comments", defaultValue: "Комментарии"), count: article.commentCount)
                        .padding(.top, Spacing.xxl)
                        .id(Self.commentsAnchor)
                    commentsBlock(article)

                    if !related.isEmpty {
                        sectionTitle(String(localized: "community.article.related", defaultValue: "Похожие статьи"))
                            .padding(.top, Spacing.xxl)
                        ForEach(related) { item in
                            NavigationLink(value: AppRoute.community(.article(id: item.id))) {
                                CommunityArticleRow(article: item)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .cardSurface(padding: Spacing.lg)
                                    .contentShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                            }
                            .buttonStyle(.plain)
                            .padding(.top, Spacing.md)
                        }
                    }
                }
                .frame(maxWidth: Self.readableWidth)
                .padding(.horizontal, Spacing.xl)
                .padding(.top, Spacing.md)
                .padding(.bottom, Spacing.xxl)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.top } action: { scrollTopInset = $0 }
            .pullToRefresh { await load() }
        }
        .toolbar {
            if isOwn(article) {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            editing = true
                        } label: {
                            Label(String(localized: "feed.edit", defaultValue: "Редактировать"), systemImage: "pencil")
                        }
                        if article.isDraft {
                            Button {
                                Task { await publish(article) }
                            } label: {
                                Label(String(localized: "stories.publish", defaultValue: "Опубликовать"), systemImage: "paperplane")
                            }
                        }
                        Button(role: .destructive) {
                            confirmingDelete = true
                        } label: {
                            Label(String(localized: "feed.delete", defaultValue: "Удалить"), systemImage: "trash")
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                    }
                    .accessibilityLabel(Text(String(localized: "community.article.actions", defaultValue: "Действия со статьёй")))
                }
            }
        }
    }

    // MARK: Шапка

    private func header(_ article: CommunityArticleDTO) -> some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            if let cover = article.coverUrl.flatMap(URL.init(string:)) {
                Button {
                    viewingCover = true
                } label: {
                    // Рамку 16:9 держит пустая подложка: картинка до загрузки не знает
                    // своих пропорций, и без рамки текст под ней прыгал бы вниз.
                    Color.clear
                        .aspectRatio(16 / 9, contentMode: .fit)
                        .overlay { RemoteImage(url: cover, cacheKey: "article-cover:\(article.id)") }
                        .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                        .contentShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(String(localized: "community.article.openCover", defaultValue: "Обложка статьи, открыть на весь экран")))
                .padding(.bottom, Spacing.xs)
            }

            if article.category != nil || article.isDraft {
                HStack(spacing: Spacing.md) {
                    if let category = article.category {
                        Text(CommunityArticleText.category(category))
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Palette.primary)
                    }
                    if article.isDraft {
                        StatusBadge(text: String(localized: "community.articles.draft", defaultValue: "Черновик"), tint: Palette.warning)
                    }
                }
            }

            VStack(alignment: .leading, spacing: Spacing.md) {
                Text(article.title)
                    .font(.title.weight(.bold))
                    .foregroundStyle(Palette.foreground)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                    // Признак, а не координата: координата меняется на каждом кадре
                    // прокрутки и перерисовывала бы весь экран.
                    .onGeometryChange(for: Bool.self) { [topInset = scrollTopInset] proxy in
                        proxy.frame(in: .scrollView).maxY < topInset
                    } action: { hidden in
                        titleScrolledAway = hidden
                    }
                if let description = article.description, !description.isEmpty {
                    Text(description)
                        .font(.title3)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            ArticleMetaLine(date: article.publishedAt ?? article.createdAt, minutes: article.readingMinutes, views: article.views)

            if let tags = article.tags, !tags.isEmpty {
                FlowLayout(spacing: Spacing.sm) {
                    ForEach(Array(tags.enumerated()), id: \.offset) { _, tag in
                        Text(verbatim: "#\(tag)")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(Palette.primary)
                            .padding(.horizontal, Spacing.md)
                            .padding(.vertical, Spacing.xs)
                            .background(Palette.primary.opacity(0.1), in: Capsule())
                    }
                }
            }
        }
    }

    // MARK: Действия

    /// Панель под текстом: лайк и комментарии со счётчиками слева, редкие действия —
    /// значками справа. Каждая цель касания — не меньше 44 pt.
    private func actionBar(_ article: CommunityArticleDTO, showComments: @escaping () -> Void) -> some View {
        let liked = article.liked == true
        let likes = article.likesCount ?? 0
        let bookmarked = article.bookmarked == true
        return HStack(spacing: 0) {
            Button {
                likeTick += 1
                Task { await toggleLike(article) }
            } label: {
                countLabel(symbol: liked ? "heart.fill" : "heart", count: likes, tint: liked ? Palette.destructive : Palette.foreground)
                    .symbolEffect(.bounce, value: likeTick)
            }
            .disabled(article.isDraft)
            .accessibilityLabel(Text(String(localized: "community.article.like", defaultValue: "Нравится")))
            .accessibilityValue(Text(likes.formatted()))
            .accessibilityAddTraits(liked ? .isSelected : [])

            Button(action: showComments) {
                countLabel(symbol: "bubble.left", count: article.commentCount ?? 0, tint: Palette.foreground)
            }
            .accessibilityLabel(Text(String(localized: "feed.comments", defaultValue: "Комментарии")))
            .accessibilityValue(Text((article.commentCount ?? 0).formatted()))

            Spacer(minLength: Spacing.md)

            if !article.isDraft {
                Button {
                    Task { await repost(article) }
                } label: {
                    iconLabel("arrow.2.squarepath", tint: Palette.foreground)
                }
                .accessibilityLabel(Text(String(localized: "community.article.repost", defaultValue: "Поделиться в ленте")))
            }
            if let base = AppConfiguration.webBaseURL {
                ShareLink(item: base.appendingPathComponent("articles").appendingPathComponent(article.id)) {
                    iconLabel("square.and.arrow.up", tint: Palette.foreground)
                }
            }
            Button {
                bookmarkTick += 1
                Task { await toggleBookmark(article) }
            } label: {
                iconLabel(bookmarked ? "bookmark.fill" : "bookmark", tint: bookmarked ? Palette.primary : Palette.foreground)
            }
            .accessibilityLabel(Text(String(localized: "saved.title", defaultValue: "Сохранённое")))
            .accessibilityAddTraits(bookmarked ? .isSelected : [])
        }
        .buttonStyle(.plain)
        .padding(.horizontal, Spacing.sm)
        .padding(.vertical, Spacing.xs)
        .background(Palette.card, in: Capsule())
        .animation(Motion.respecting(.snappy(duration: Motion.Duration.surface), reduceMotion: reduceMotion), value: article)
    }

    private func countLabel(symbol: String, count: Int, tint: Color) -> some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: symbol)
                .font(.body.weight(.medium))
                .foregroundStyle(tint)
                .contentTransition(.symbolEffect(.replace))
            Text(count.formatted())
                .font(Typography.tabular(.subheadline.weight(.medium)))
                .foregroundStyle(Palette.foreground)
                .contentTransition(.numericText(value: Double(count)))
        }
        .padding(.horizontal, Spacing.lg)
        .frame(minHeight: ControlHeight.xl)
        .contentShape(Capsule())
    }

    private func iconLabel(_ symbol: String, tint: Color) -> some View {
        Image(systemName: symbol)
            .font(.body.weight(.medium))
            .foregroundStyle(tint)
            .contentTransition(.symbolEffect(.replace))
            .frame(width: ControlHeight.xl, height: ControlHeight.xl)
            .contentShape(Circle())
    }

    private func authorRow(_ author: String) -> some View {
        NavigationLink(value: AppRoute.profile(id: author)) {
            HStack(spacing: Spacing.lg) {
                Image(systemName: "person.fill")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Palette.primary)
                    .frame(width: ControlHeight.lg, height: ControlHeight.lg)
                    .background(Palette.primary.opacity(0.12), in: Circle())
                    .accessibilityHidden(true)
                Text(String(localized: "community.article.author", defaultValue: "Профиль автора"))
                    .font(Typography.cardTitle)
                    .foregroundStyle(Palette.foreground)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.mutedForeground)
                    .accessibilityHidden(true)
            }
            .cardSurface(padding: Spacing.lg)
            .contentShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    // MARK: Комментарии

    private func sectionTitle(_ title: String, count: Int? = nil) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
            Text(title)
                .font(Typography.pageTitle)
                .foregroundStyle(Palette.foreground)
                .accessibilityAddTraits(.isHeader)
            if let count, count > 0 {
                Text(count.formatted())
                    .font(Typography.tabular(.title3))
                    .foregroundStyle(Palette.mutedForeground)
            }
        }
    }

    /// Поле, состояния и строки комментариев — прямые элементы ленивого стека, а не
    /// одна карточка: иначе подгрузка страниц (`loadMore`) сработала бы для всех строк
    /// разом. Карточку рисуют сами строки — скруглены только первая сверху и последняя
    /// снизу.
    @ViewBuilder
    private func commentsBlock(_ article: CommunityArticleDTO) -> some View {
        if article.allowComments == false {
            DashboardEmptyRow(text: String(localized: "community.article.commentsOff", defaultValue: "Автор отключил комментарии"), symbol: "bubble.left")
                .cardSurface(padding: Spacing.lg)
                .padding(.top, Spacing.md)
        } else {
            composer
                .padding(.top, Spacing.md)
        }

        // Комментарии не загрузились — не «Комментариев пока нет».
        if comments.items.isEmpty {
            if let failure = comments.failure {
                DashboardFailurePlaceholder(message: failure) { await comments.reload() }
                    .cardSurface(padding: Spacing.lg)
                    .padding(.top, Spacing.md)
            } else if comments.isLoaded, article.allowComments != false {
                DashboardEmptyRow(text: String(localized: "feed.noComments", defaultValue: "Комментариев пока нет"), symbol: "bubble.left")
                    .cardSurface(padding: Spacing.lg)
                    .padding(.top, Spacing.md)
            } else if comments.isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Spacing.xl)
            }
        }

        let items = comments.items
        ForEach(Array(items.enumerated()), id: \.element.id) { index, comment in
            commentRow(comment, article: article, isFirst: index == 0, isLast: index == items.count - 1)
                .task { await comments.loadMore(after: comment) }
        }
        if let pageFailure = comments.pageFailure {
            PageFailureRow(message: pageFailure) { await comments.retryMore() }
        } else if comments.isLoading, !items.isEmpty {
            ProgressView()
                .frame(maxWidth: .infinity)
                .padding(.top, Spacing.lg)
        }
    }

    /// Поле комментария: растёт до пяти строк, кнопка отправки — залитый круг, когда
    /// есть что отправить, и приглушённый, пока поле пустое.
    private var composer: some View {
        let hasText = !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return HStack(alignment: .bottom, spacing: Spacing.sm) {
            TextField(
                String(localized: "community.comment.placeholder", defaultValue: "Комментарий"),
                text: $draft,
                axis: .vertical
            )
            .lineLimit(1...5)
            .focused($isComposing)
            // Одна строка — по центру высоты кнопки, несколько — растут вниз от неё.
            .padding(.vertical, Spacing.sm)
            .frame(minHeight: ControlHeight.xl)

            Button {
                Task { await send() }
            } label: {
                ZStack {
                    Circle()
                        .fill(hasText ? Palette.primary : Palette.muted)
                    if isSending {
                        ProgressView()
                            .tint(Palette.primaryForeground)
                    } else {
                        Image(systemName: "arrow.up")
                            .font(.body.weight(.semibold))
                            .foregroundStyle(hasText ? Palette.primaryForeground : Palette.mutedForeground)
                    }
                }
                .frame(width: ControlHeight.md, height: ControlHeight.md)
                .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .disabled(!hasText || isSending)
            .animation(.easeOut(duration: Motion.Duration.feedback), value: hasText)
            .accessibilityLabel(Text(String(localized: "community.comment.send", defaultValue: "Отправить")))
        }
        .padding(.leading, Spacing.xl)
        .padding(.trailing, Spacing.xs)
        .padding(.vertical, Spacing.xs)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                .strokeBorder(Palette.primary.opacity(isComposing ? 0.5 : 0), lineWidth: 1)
        }
        .animation(.easeOut(duration: Motion.Duration.feedback), value: isComposing)
    }

    private func commentRow(_ comment: CommunityArticleCommentDTO, article: CommunityArticleDTO, isFirst: Bool, isLast: Bool) -> some View {
        let shape = UnevenRoundedRectangle(
            topLeadingRadius: isFirst ? Radius.card : 0,
            bottomLeadingRadius: isLast ? Radius.card : 0,
            bottomTrailingRadius: isLast ? Radius.card : 0,
            topTrailingRadius: isFirst ? Radius.card : 0,
            style: .continuous
        )
        let canDelete = (comment.authorId ?? comment.author?.id) == viewerID || isOwn(article)
        return CommunityCommentRow(
            name: comment.author?.name ?? "—",
            avatar: comment.author?.avatar,
            text: comment.content,
            date: comment.createdAt,
            profileID: comment.author?.id
        )
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.card, in: shape)
        .overlay(alignment: .top) {
            // Разделитель — от текста, а не от края: аватары идут сплошной колонкой.
            if !isFirst {
                Divider()
                    .padding(.leading, Spacing.xl + Self.commentAvatar + Spacing.md)
            }
        }
        // Смахивания вне `List` нет — удаление в меню по долгому нажатию.
        .contentShape(.contextMenuPreview, shape)
        .contextMenu {
            Button {
                UIPasteboard.general.string = comment.content
            } label: {
                Label(String(localized: "common.copy", defaultValue: "Скопировать"), systemImage: "doc.on.doc")
            }
            if canDelete {
                Button(role: .destructive) {
                    deletingComment = comment
                } label: {
                    Label(String(localized: "feed.delete", defaultValue: "Удалить"), systemImage: "trash")
                }
            }
        }
        .padding(.top, isFirst ? Spacing.md : 0)
    }

    private func isOwn(_ article: CommunityArticleDTO) -> Bool {
        article.userId == viewerID && article.company == nil && article.universityPage == nil
    }

    @MainActor
    private func load() async {
        do {
            let loaded = try await api.article(id: articleID)
            article = loaded
            failure = nil
            await comments.replace { [api, articleID] request in
                try await api.articleComments(id: articleID, cursor: request.cursor)
            }
            related = (try? await api.relatedArticles(id: articleID)) ?? []
            if !loaded.isDraft { try? await api.markArticleViewed(id: articleID) }
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    @MainActor
    private func toggleLike(_ current: CommunityArticleDTO) async {
        let liked = !(current.liked ?? false)
        article?.liked = liked
        article?.likesCount = max(0, (current.likesCount ?? 0) + (liked ? 1 : -1))
        do {
            article?.likesCount = try await api.setArticleLiked(id: current.id, liked: liked)
        } catch {
            article = current
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func toggleBookmark(_ current: CommunityArticleDTO) async {
        do {
            article?.bookmarked = try await api.toggleArticleBookmark(id: current.id)
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func repost(_ current: CommunityArticleDTO) async {
        do {
            try await api.repostArticle(id: current.id)
            reposted = true
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        isSending = true
        defer { isSending = false }
        do {
            _ = try await api.commentArticle(id: articleID, text: String(text.prefix(2000)))
            draft = ""
            sentTick += 1
            article?.commentCount = (article?.commentCount ?? 0) + 1
            await comments.reload()
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func publish(_ current: CommunityArticleDTO) async {
        do {
            article = try await api.updateArticle(id: current.id, CommunityArticleText.input(from: current, status: "PUBLISHED"))
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func deleteArticle() async {
        do {
            try await api.deleteArticle(id: articleID)
            dismiss()
        } catch {
            actionFailure = error.userMessage
        }
    }
}

/// Строка комментария: аватар, имя, текст, время.
struct CommunityCommentRow: View {
    let name: String
    let avatar: String?
    let text: String
    let date: Date
    var profileID: String?
    var caption: String?

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            AvatarView(url: avatar, name: name, size: 32)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                    if let profileID {
                        NavigationLink(value: AppRoute.profile(id: profileID)) {
                            Text(name).font(Typography.meta.weight(.semibold)).foregroundStyle(Palette.foreground)
                        }
                        .buttonStyle(.plain)
                    } else {
                        Text(name).font(Typography.meta.weight(.semibold))
                    }
                    Text(DisplayFormat.relative(date))
                        .font(.caption)
                        .foregroundStyle(Palette.mutedForeground)
                }
                if let caption, !caption.isEmpty {
                    Text(caption)
                        .font(.caption)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(2)
                }
                if !text.isEmpty {
                    Text(RichText.attributed(text))
                        .font(Typography.body)
                        .foregroundStyle(Palette.foreground)
                        // Немного воздуха между строками: длинный комментарий иначе
                        // читается сплошным блоком.
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

// MARK: - Редактор

enum CommunityArticleText {
    static let categories = ["STUDY", "SCIENCE", "STUDENT_LIFE", "PROJECTS", "INTERNSHIPS", "CAREER", "EVENTS", "RESOURCES"]
    static let visibilities = ["ALL", "UNIVERSITY", "FACULTY", "GROUP"]

    static func category(_ raw: String) -> String {
        switch raw {
        case "STUDY": return String(localized: "community.articleCategory.study", defaultValue: "Учёба")
        case "SCIENCE": return String(localized: "community.articleCategory.science", defaultValue: "Наука")
        case "STUDENT_LIFE": return String(localized: "community.articleCategory.life", defaultValue: "Студенческая жизнь")
        case "PROJECTS": return String(localized: "community.articleCategory.projects", defaultValue: "Проекты")
        case "INTERNSHIPS": return String(localized: "community.articleCategory.internships", defaultValue: "Стажировки")
        case "CAREER": return String(localized: "community.articleCategory.career", defaultValue: "Карьера")
        case "EVENTS": return String(localized: "community.articleCategory.events", defaultValue: "События")
        case "RESOURCES": return String(localized: "community.articleCategory.resources", defaultValue: "Полезное")
        default: return raw
        }
    }

    static func visibility(_ raw: String) -> String {
        switch raw {
        case "ALL": return String(localized: "community.articleVisibility.all", defaultValue: "Все")
        case "UNIVERSITY": return String(localized: "community.articleVisibility.university", defaultValue: "Мой вуз")
        case "FACULTY": return String(localized: "community.articleVisibility.faculty", defaultValue: "Мой факультет")
        case "GROUP": return String(localized: "community.articleVisibility.group", defaultValue: "Моя группа")
        default: return raw
        }
    }

    /// Полное тело PATCH из статьи: сервер сбрасывает непереданные поля.
    static func input(from article: CommunityArticleDTO, status: String) -> CommunityArticleInput {
        CommunityArticleInput(
            title: article.title,
            description: article.description,
            content: article.content ?? "",
            coverUrl: article.coverUrl,
            category: article.category,
            tags: article.tags,
            visibility: visibilities.contains(article.visibility ?? "") ? (article.visibility ?? "ALL") : "ALL",
            allowComments: article.allowComments ?? true,
            status: status
        )
    }
}

/// Редактор статьи — лист для письма, а не экран настроек: сверху обложка, крупный
/// заголовок и описание, дальше текст, который растёт вместе с формой (прокручивается
/// весь лист, а не окошко внутри него), и предпросмотр. Параметры публикации — после
/// текста: к ним возвращаются один раз, а к тексту — постоянно.
struct CommunityArticleEditor: View {
    let article: CommunityArticleDTO?
    let saved: (CommunityArticleDTO) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var summary = ""
    @State private var content = ""
    @State private var category = ""
    @State private var tags = ""
    @State private var visibility = "ALL"
    @State private var allowComments = true
    @State private var coverURL: String?
    @State private var coverPick: PhotosPickerItem?
    @State private var pickingCover = false
    @State private var isUploadingCover = false
    @State private var isSaving = false
    @State private var failure: String?
    @State private var didFill = false
    /// Форма как открылась — по ней видно, есть ли что терять при закрытии.
    @State private var original = Snapshot()
    @State private var confirmingDiscard = false
    @State private var mode: Mode = .write
    @FocusState private var focused: Field?

    private let api = CommunityAPI()

    private static let titleLimit = 200
    private static let summaryLimit = 300
    private static let contentLimit = 20000
    private static let failureAnchor = "article.editor.failure"

    private enum Field: Hashable {
        case title, summary, content, tags
    }

    private enum Mode: Hashable {
        case write, preview
    }

    /// Всё, что человек может поменять в форме, — одним значением для сравнения.
    private struct Snapshot: Equatable {
        var title = ""
        var summary = ""
        var content = ""
        var category = ""
        var tags = ""
        var visibility = "ALL"
        var allowComments = true
        var coverURL: String?
    }

    private var snapshot: Snapshot {
        Snapshot(
            title: title,
            summary: summary,
            content: content,
            category: category,
            tags: tags,
            visibility: visibility,
            allowComments: allowComments,
            coverURL: coverURL
        )
    }

    private var isDirty: Bool { didFill && snapshot != original }

    var body: some View {
        NavigationStack {
            ScrollViewReader { scroller in
                Form {
                    if let failure {
                        FormAlert(message: failure)
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets())
                            .id(Self.failureAnchor)
                    }
                    coverSection
                    headingSection
                    Section {
                        FilterChipsRow(
                            options: [
                                (value: Mode.write, title: String(localized: "community.article.content", defaultValue: "Текст")),
                                (value: Mode.preview, title: String(localized: "community.article.preview", defaultValue: "Предпросмотр")),
                            ],
                            selection: Binding(get: { mode }, set: { if let next = $0 { mode = next } }),
                            fillsWidth: true
                        )
                    }
                    contentSection
                    settingsSection
                    draftSection
                }
                // Длинная форма прокручена вниз — ошибка над полями была бы не видна, и
                // «Опубликовать» выглядело бы как кнопка, которая ничего не делает.
                .onChange(of: failure) { _, next in
                    guard next != nil else { return }
                    withAnimation(Motion.calm) { scroller.scrollTo(Self.failureAnchor, anchor: .top) }
                }
            }
            .listSectionSpacing(.compact)
            .contentMargins(.top, Spacing.sm, for: .scrollContent)
            .scrollDismissesKeyboard(.interactively)
            .softTopEdge()
            .background(Palette.background)
            .navigationTitle(Text(article == nil
                ? String(localized: "community.articles.new", defaultValue: "Написать статью")
                : String(localized: "feed.edit", defaultValue: "Редактировать")))
            .navigationBarTitleDisplayMode(.inline)
            // Смахнуть лист с написанным нельзя — потерять статью одним жестом слишком легко.
            .interactiveDismissDisabled(isSaving || isUploadingCover || isDirty)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    // Крестик не должен молча делать то, от чего защищён жест.
                    SheetCloseButton {
                        if isDirty { confirmingDiscard = true } else { dismiss() }
                    }
                    .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button(String(localized: "stories.publish", defaultValue: "Опубликовать")) {
                            Task { await save(status: "PUBLISHED") }
                        }
                        .disabled(!canSave)
                    }
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button(String(localized: "common.done", defaultValue: "Готово")) { focused = nil }
                }
            }
            .discardChangesDialog(isPresented: $confirmingDiscard) { dismiss() }
            .photosPicker(isPresented: $pickingCover, selection: $coverPick, matching: .images)
            .task(id: coverPick) { await uploadCover() }
            .onChange(of: mode) { _, next in
                // В предпросмотре печатать некуда — клавиатура только закрывала бы текст.
                if next == .preview { focused = nil }
            }
            .sensoryFeedback(.error, trigger: failure) { _, new in new != nil }
            .onAppear {
                fill()
                // Новая статья начинается с заголовка — не нужно лишнее касание.
                if article == nil { focused = .title }
            }
        }
    }

    // MARK: Обложка

    private var coverSection: some View {
        Section {
            Group {
                if let coverURL, let url = URL(string: coverURL) {
                    coverFrame(aspect: 16 / 9) {
                        RemoteImage(url: url, cacheKey: "article-editor:\(coverURL)")
                    }
                    .overlay(alignment: .bottomTrailing) {
                        coverActions
                            .padding(Spacing.sm)
                    }
                } else {
                    Button {
                        pickingCover = true
                    } label: {
                        // Пустая обложка ниже готовой: место под заголовок и текст важнее,
                        // а 16:9 у пустой рамки съедало полэкрана.
                        coverFrame(aspect: 3) {
                            ZStack {
                                Palette.card
                                VStack(spacing: Spacing.sm) {
                                    Image(systemName: "photo.badge.plus")
                                        .font(.title2)
                                        .foregroundStyle(Palette.primary)
                                    Text(String(localized: "community.article.addCover", defaultValue: "Добавить обложку"))
                                        .font(Typography.cardTitle)
                                        .foregroundStyle(Palette.foreground)
                                }
                                .opacity(isUploadingCover ? 0 : 1)
                            }
                        }
                        .overlay {
                            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                                .strokeBorder(Palette.border, style: StrokeStyle(lineWidth: 1, dash: [6, 4]))
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(isUploadingCover)
                }
            }
            .overlay {
                if isUploadingCover {
                    ZStack {
                        Rectangle().fill(.ultraThinMaterial)
                        ProgressView()
                    }
                    .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                    .transition(.opacity)
                    .accessibilityElement()
                    .accessibilityLabel(Text(String(localized: "community.article.coverUploading", defaultValue: "Загружаем обложку")))
                }
            }
            .animation(.easeOut(duration: Motion.Duration.layer), value: isUploadingCover)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
        }
    }

    private func coverFrame<Content: View>(aspect: CGFloat, @ViewBuilder _ content: () -> Content) -> some View {
        Color.clear
            .aspectRatio(aspect, contentMode: .fit)
            .overlay { content() }
            .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
    }

    /// Кнопки поверх готовой обложки. Стиль `.plain` обязателен: в строке `Form` кнопки
    /// со стилем по умолчанию срабатывают все разом от касания строки.
    private var coverActions: some View {
        HStack(spacing: Spacing.sm) {
            Button {
                pickingCover = true
            } label: {
                Label(String(localized: "community.article.cover.replace", defaultValue: "Заменить"), systemImage: "photo")
                    .font(Typography.meta.weight(.semibold))
                    .padding(.horizontal, Spacing.lg)
                    .frame(height: ControlHeight.md)
                    .floatingGlass(in: Capsule())
            }
            .accessibilityLabel(Text(String(localized: "community.article.replaceCover", defaultValue: "Заменить обложку")))
            Button(role: .destructive) {
                coverURL = nil
                coverPick = nil
            } label: {
                Image(systemName: "trash")
                    .font(Typography.meta.weight(.semibold))
                    .frame(width: ControlHeight.md, height: ControlHeight.md)
                    .floatingGlass(in: Circle())
            }
            .accessibilityLabel(Text(String(localized: "community.article.removeCover", defaultValue: "Убрать обложку")))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Palette.foreground)
        .disabled(isUploadingCover)
    }

    // MARK: Заголовок и текст

    private var headingSection: some View {
        Section {
            TextField(String(localized: "community.article.title", defaultValue: "Заголовок"), text: $title, axis: .vertical)
                .font(.title2.weight(.bold))
                .lineLimit(1...5)
                .focused($focused, equals: .title)
                // Поле многострочное ради длинных заголовков, но перевод строки в
                // заголовке не нужен: «Ввод» ведёт к описанию.
                .onChange(of: title) { _, value in
                    guard value.contains("\n") else { return }
                    title = value.replacingOccurrences(of: "\n", with: "")
                    focused = .summary
                }
            TextField(String(localized: "community.article.summary", defaultValue: "Короткое описание"), text: $summary, axis: .vertical)
                .font(Typography.body)
                .lineLimit(1...4)
                .focused($focused, equals: .summary)
                .onChange(of: summary) { _, value in
                    guard value.contains("\n") else { return }
                    summary = value.replacingOccurrences(of: "\n", with: "")
                    focused = .content
                }
        } footer: {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                counter(String(localized: "community.article.title", defaultValue: "Заголовок"), count: title.count, limit: Self.titleLimit)
                counter(String(localized: "community.article.summary", defaultValue: "Короткое описание"), count: summary.count, limit: Self.summaryLimit)
            }
        }
    }

    private var contentSection: some View {
        Section {
            switch mode {
            case .write:
                TextField(
                    String(localized: "community.article.content.placeholder", defaultValue: "Начните писать…"),
                    text: $content,
                    axis: .vertical
                )
                .font(Typography.body)
                .lineSpacing(4)
                // Поле растёт вместе с текстом, и прокручивается весь лист: окно
                // фиксированной высоты со своей прокруткой внутри формы терялось.
                .lineLimit(12...)
                .focused($focused, equals: .content)
            case .preview:
                preview
            }
        } footer: {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(String(localized: "community.article.markdown", defaultValue: "Поддерживается Markdown: # заголовок, **жирный**, *курсив*, - список, > цитата"))
                counter(String(localized: "community.article.content", defaultValue: "Текст"), count: content.count, limit: Self.contentLimit)
            }
        }
    }

    /// Статья так, как её увидят читатели: заголовок, описание и размеченный текст.
    @ViewBuilder
    private var preview: some View {
        let hasTitle = !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let hasContent = !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        if hasTitle || hasContent {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                if hasTitle {
                    Text(title)
                        .font(.title2.weight(.bold))
                        .foregroundStyle(Palette.foreground)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !summary.isEmpty {
                    Text(summary)
                        .font(Typography.body)
                        .foregroundStyle(Palette.mutedForeground)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if hasTitle, hasContent {
                    Divider()
                }
                if hasContent {
                    CommunityMarkdownView(source: content)
                }
            }
            .padding(.vertical, Spacing.sm)
        } else {
            DashboardEmptyRow(
                text: String(localized: "community.article.previewEmpty", defaultValue: "Здесь появится статья в том виде, в каком её увидят читатели"),
                symbol: "eye"
            )
        }
    }

    /// Счётчик знаков — только у края лимита: постоянное «12 / 20000» под каждым полем
    /// было бы шумом. Перебор — красным, как и запрет сохранить.
    @ViewBuilder
    private func counter(_ name: String, count: Int, limit: Int) -> some View {
        if count * 5 > limit * 4 {
            Text(verbatim: "\(name): \(count.formatted()) / \(limit.formatted())")
                .font(Typography.tabular(.footnote))
                .foregroundStyle(count > limit ? Palette.destructive : Palette.mutedForeground)
        }
    }

    // MARK: Параметры

    private var settingsSection: some View {
        Section {
            Picker(String(localized: "community.article.category", defaultValue: "Рубрика"), selection: $category) {
                Text(String(localized: "community.article.noCategory", defaultValue: "Без рубрики")).tag("")
                ForEach(CommunityArticleText.categories, id: \.self) { Text(CommunityArticleText.category($0)).tag($0) }
            }
            TextField(String(localized: "community.article.tags", defaultValue: "Теги через запятую"), text: $tags)
                .textInputAutocapitalization(.never)
                .focused($focused, equals: .tags)
            Picker(String(localized: "community.article.visibility", defaultValue: "Кто видит"), selection: $visibility) {
                ForEach(CommunityArticleText.visibilities, id: \.self) { Text(CommunityArticleText.visibility($0)).tag($0) }
            }
            Toggle(String(localized: "community.article.allowComments", defaultValue: "Разрешить комментарии"), isOn: $allowComments)
        } header: {
            Text(String(localized: "community.article.settings", defaultValue: "Публикация"))
        }
    }

    /// Черновик — второстепенное действие: тихая кнопка внизу, а «Опубликовать» — в панели.
    private var draftSection: some View {
        Section {
            Button {
                Task { await save(status: "DRAFT") }
            } label: {
                Label(String(localized: "community.article.saveDraft", defaultValue: "Сохранить черновик"), systemImage: "tray.and.arrow.down")
                    .frame(maxWidth: .infinity)
            }
            .glassButton()
            .controlSize(.large)
            .disabled(!canSave)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
        } footer: {
            Text(String(localized: "community.article.draftHint", defaultValue: "Черновик видите только вы — опубликовать его можно позже"))
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
        }
    }

    private var canSave: Bool {
        let titleOK = !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && title.count <= Self.titleLimit
        let contentOK = !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && content.count <= Self.contentLimit
        return titleOK && contentOK && summary.count <= Self.summaryLimit && !isUploadingCover && !isSaving
    }

    private func fill() {
        guard !didFill else { return }
        didFill = true
        if let article {
            title = article.title
            summary = article.description ?? ""
            content = article.content ?? ""
            category = article.category ?? ""
            tags = (article.tags ?? []).joined(separator: ", ")
            visibility = CommunityArticleText.visibilities.contains(article.visibility ?? "") ? (article.visibility ?? "ALL") : "ALL"
            allowComments = article.allowComments ?? true
            coverURL = article.coverUrl
        }
        original = snapshot
    }

    @MainActor
    private func uploadCover() async {
        guard let coverPick else { return }
        isUploadingCover = true
        defer { isUploadingCover = false }
        do {
            let prepared = try await MediaPreparation.prepare(coverPick)
            coverURL = try await api.uploadArticleCover(prepared.data, mime: prepared.mime)
        } catch {
            failure = error.userMessage
        }
    }

    @MainActor
    private func save(status: String) async {
        isSaving = true
        defer { isSaving = false }
        let tagList = tags.split(separator: ",")
            .map { String($0.trimmingCharacters(in: .whitespaces).prefix(40)) }
            .filter { !$0.isEmpty }
        let trimmedSummary = summary.trimmingCharacters(in: .whitespacesAndNewlines)
        let input = CommunityArticleInput(
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            description: trimmedSummary.isEmpty ? nil : trimmedSummary,
            content: content,
            coverUrl: coverURL,
            category: category.isEmpty ? nil : category,
            tags: tagList.isEmpty ? nil : Array(tagList.prefix(15)),
            visibility: visibility,
            allowComments: allowComments,
            status: status
        )
        do {
            let result: CommunityArticleDTO
            if let article {
                result = try await api.updateArticle(id: article.id, input)
            } else {
                result = try await api.createArticle(input)
            }
            saved(result)
            dismiss()
        } catch {
            failure = error.userMessage
        }
    }
}
