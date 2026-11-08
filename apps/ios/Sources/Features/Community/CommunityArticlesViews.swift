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
                    Picker(String(localized: "community.articles.shelf", defaultValue: "Раздел"), selection: $shelf) {
                        Text(String(localized: "community.articles.mine", defaultValue: "Мои")).tag(Shelf.written)
                        Text(String(localized: "community.articles.saved", defaultValue: "Сохранённые")).tag(Shelf.saved)
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
                if articles.isEmpty {
                    EmptyStateView(
                        title: shelf == .saved
                            ? String(localized: "community.articles.noSaved", defaultValue: "Сохранённых статей нет")
                            : String(localized: "community.articles.empty", defaultValue: "Статей пока нет"),
                        symbol: "doc.richtext",
                        actionTitle: isMine && shelf == .written
                            ? String(localized: "community.articles.new", defaultValue: "Написать статью") : nil,
                        action: isMine && shelf == .written ? { creating = true } : nil
                    )
                    .listRowBackground(Color.clear)
                } else {
                    Section {
                        ForEach(articles) { article in
                            NavigationLink(value: AppRoute.community(.article(id: article.id))) {
                                CommunityArticleRow(article: article)
                            }
                        }
                    }
                    .listRowBackground(Palette.card)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .refreshable { reload += 1 }
        }
        .background(Palette.background)
        .navigationTitle(Text(CommunityScreen.articles(userID: nil).title))
        .toolbar {
            if isMine {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        creating = true
                    } label: {
                        Image(systemName: "square.and.pencil")
                    }
                    .accessibilityLabel(Text(String(localized: "community.articles.new", defaultValue: "Написать статью")))
                }
            }
        }
        .sheet(isPresented: $creating) {
            CommunityArticleEditor(article: nil) { _ in reload += 1 }
        }
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
            }
            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack(alignment: .firstTextBaseline) {
                    Text(article.title)
                        .font(Typography.cardTitle)
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
                HStack(spacing: Spacing.md) {
                    Text(DisplayFormat.date(article.publishedAt ?? article.createdAt))
                    if let minutes = article.readingMinutes, minutes > 0 {
                        Text(String(localized: "profile.article.minutes", defaultValue: "\(minutes) мин"))
                    }
                    if let views = article.views, views > 0 {
                        Label(views.formatted(), systemImage: "eye")
                    }
                }
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
            }
        }
        .padding(.vertical, Spacing.xs)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Чтение

struct CommunityArticleView: View {
    let articleID: String

    @Environment(\.viewerID) private var viewerID
    @Environment(\.dismiss) private var dismiss
    @State private var article: CommunityArticleDTO?
    @State private var failure: String?
    @State private var related: [CommunityArticleDTO] = []
    @State private var comments = PagedLoader<CommunityArticleCommentDTO>(limit: 30) { _ in Page(items: [], meta: nil) }
    @State private var draft = ""
    @State private var isSending = false
    @State private var editing = false
    @State private var confirmingDelete = false
    @State private var deletingComment: CommunityArticleCommentDTO?
    @State private var actionFailure: String?
    @State private var reposted = false

    private let api = CommunityAPI()

    var body: some View {
        Group {
            if let article {
                content(article)
            } else if let failure {
                ErrorStateView(message: failure) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .background(Palette.background)
        .navigationTitle(Text(CommunityScreen.article(id: articleID).title))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(isPresented: $editing) {
            if let article {
                CommunityArticleEditor(article: article) { updated in self.article = updated }
            }
        }
        .confirmationDialog(
            String(localized: "community.article.delete.title", defaultValue: "Удалить статью?"),
            isPresented: $confirmingDelete,
            titleVisibility: .visible
        ) {
            Button(String(localized: "feed.delete", defaultValue: "Удалить"), role: .destructive) {
                Task { await deleteArticle() }
            }
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
    }

    private func content(_ article: CommunityArticleDTO) -> some View {
        List {
            Section {
                if let cover = article.coverUrl.flatMap(URL.init(string:)) {
                    RemoteImage(url: cover, cacheKey: "article-cover:\(article.id)")
                        .frame(height: 180)
                        .frame(maxWidth: .infinity)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
                        .listRowInsets(EdgeInsets(top: Spacing.md, leading: Spacing.md, bottom: Spacing.md, trailing: Spacing.md))
                }
                VStack(alignment: .leading, spacing: Spacing.md) {
                    if article.isDraft {
                        StatusBadge(text: String(localized: "community.articles.draft", defaultValue: "Черновик"), tint: Palette.warning)
                    }
                    Text(article.title)
                        .font(.title2.weight(.bold))
                        .foregroundStyle(Palette.foreground)
                        .fixedSize(horizontal: false, vertical: true)
                    if let description = article.description, !description.isEmpty {
                        Text(description)
                            .font(Typography.body)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    meta(article)
                    if let tags = article.tags, !tags.isEmpty {
                        Text(verbatim: tags.map { "#\($0)" }.joined(separator: " "))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.primary)
                    }
                    Divider()
                    CommunityMarkdownView(source: article.content ?? "")
                }
                .padding(.vertical, Spacing.sm)
                actionsRow(article)
            }
            .listRowBackground(Palette.card)

            if let author = article.userId, article.company == nil, article.universityPage == nil {
                Section {
                    NavigationLink(value: AppRoute.profile(id: author)) {
                        Label(String(localized: "community.article.author", defaultValue: "Профиль автора"), systemImage: "person.crop.circle")
                    }
                }
                .listRowBackground(Palette.card)
            }

            commentsSection(article)

            if !related.isEmpty {
                Section {
                    ForEach(related) { item in
                        NavigationLink(value: AppRoute.community(.article(id: item.id))) {
                            CommunityArticleRow(article: item)
                        }
                    }
                } header: {
                    Text(String(localized: "community.article.related", defaultValue: "Похожие статьи"))
                }
                .listRowBackground(Palette.card)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .refreshable { await load() }
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
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityLabel(Text(String(localized: "community.article.actions", defaultValue: "Действия со статьёй")))
                }
            }
        }
    }

    private func meta(_ article: CommunityArticleDTO) -> some View {
        HStack(spacing: Spacing.md) {
            Text(DisplayFormat.date(article.publishedAt ?? article.createdAt))
            if let minutes = article.readingMinutes, minutes > 0 {
                Text(String(localized: "profile.article.minutes", defaultValue: "\(minutes) мин"))
            }
            if let views = article.views {
                Label(views.formatted(), systemImage: "eye")
            }
            if let category = article.category {
                Text(CommunityArticleText.category(category))
            }
        }
        .font(Typography.meta)
        .foregroundStyle(Palette.mutedForeground)
    }

    private func actionsRow(_ article: CommunityArticleDTO) -> some View {
        HStack(spacing: Spacing.xl) {
            Button {
                Task { await toggleLike(article) }
            } label: {
                Label((article.likesCount ?? 0).formatted(), systemImage: article.liked == true ? "heart.fill" : "heart")
                    .foregroundStyle(article.liked == true ? Palette.destructive : Palette.foreground)
            }
            .disabled(article.isDraft)
            .accessibilityLabel(Text(String(localized: "community.article.like", defaultValue: "Нравится")))
            Label((article.commentCount ?? 0).formatted(), systemImage: "bubble.left")
                .foregroundStyle(Palette.mutedForeground)
            Spacer()
            if !article.isDraft {
                Button {
                    Task { await repost(article) }
                } label: {
                    Image(systemName: "arrow.2.squarepath")
                }
                .accessibilityLabel(Text(String(localized: "community.article.repost", defaultValue: "Поделиться в ленте")))
            }
            if let base = AppConfiguration.webBaseURL {
                ShareLink(item: base.appendingPathComponent("articles").appendingPathComponent(article.id)) {
                    Image(systemName: "square.and.arrow.up")
                }
            }
            Button {
                Task { await toggleBookmark(article) }
            } label: {
                Image(systemName: article.bookmarked == true ? "bookmark.fill" : "bookmark")
            }
            .accessibilityLabel(Text(String(localized: "saved.title", defaultValue: "Сохранённое")))
        }
        .buttonStyle(.borderless)
        .font(Typography.body)
    }

    @ViewBuilder
    private func commentsSection(_ article: CommunityArticleDTO) -> some View {
        Section {
            if article.allowComments == false {
                Text(String(localized: "community.article.commentsOff", defaultValue: "Автор отключил комментарии"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            } else {
                HStack(alignment: .bottom, spacing: Spacing.md) {
                    TextField(
                        String(localized: "community.comment.placeholder", defaultValue: "Комментарий"),
                        text: $draft,
                        axis: .vertical
                    )
                    .lineLimit(1...5)
                    Button {
                        Task { await send() }
                    } label: {
                        if isSending { ProgressView() } else { Image(systemName: "paperplane.fill") }
                    }
                    .buttonStyle(.borderless)
                    .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending)
                    .accessibilityLabel(Text(String(localized: "community.comment.send", defaultValue: "Отправить")))
                }
            }
            ForEach(comments.items) { comment in
                CommunityCommentRow(
                    name: comment.author?.name ?? "—",
                    avatar: comment.author?.avatar,
                    text: comment.content,
                    date: comment.createdAt,
                    profileID: comment.author?.id
                )
                .task { await comments.loadMore(after: comment) }
                .swipeActions {
                    if (comment.authorId ?? comment.author?.id) == viewerID || isOwn(article) {
                        Button(role: .destructive) {
                            deletingComment = comment
                        } label: {
                            Label(String(localized: "feed.delete", defaultValue: "Удалить"), systemImage: "trash")
                        }
                    }
                }
            }
        } header: {
            Text(String(localized: "feed.comments", defaultValue: "Комментарии"))
        }
        .listRowBackground(Palette.card)
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
        } catch {
            failure = error.userMessage
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
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: Spacing.sm) {
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
    @State private var isUploadingCover = false
    @State private var isSaving = false
    @State private var failure: String?
    @State private var didFill = false

    private let api = CommunityAPI()

    var body: some View {
        NavigationStack {
            Form {
                if let failure {
                    FormAlert(message: failure)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                Section {
                    TextField(String(localized: "community.article.title", defaultValue: "Заголовок"), text: $title, axis: .vertical)
                        .font(Typography.sectionTitle)
                    TextField(String(localized: "community.article.summary", defaultValue: "Короткое описание"), text: $summary, axis: .vertical)
                        .lineLimit(1...3)
                }
                .listRowBackground(Palette.card)

                Section {
                    TextEditor(text: $content)
                        .frame(minHeight: 240)
                        .font(Typography.body)
                } header: {
                    Text(String(localized: "community.article.content", defaultValue: "Текст"))
                } footer: {
                    Text(String(localized: "community.article.markdown", defaultValue: "Поддерживается Markdown: # заголовок, **жирный**, *курсив*, - список, > цитата"))
                }
                .listRowBackground(Palette.card)

                Section {
                    PhotosPicker(selection: $coverPick, matching: .images) {
                        HStack {
                            Label(
                                coverURL == nil
                                    ? String(localized: "community.article.addCover", defaultValue: "Добавить обложку")
                                    : String(localized: "community.article.replaceCover", defaultValue: "Заменить обложку"),
                                systemImage: "photo"
                            )
                            Spacer()
                            if isUploadingCover { ProgressView() }
                        }
                    }
                    if let coverURL, let url = URL(string: coverURL) {
                        RemoteImage(url: url, cacheKey: "article-editor:\(coverURL)")
                            .frame(height: 140)
                            .clipShape(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
                        Button(String(localized: "community.article.removeCover", defaultValue: "Убрать обложку"), role: .destructive) {
                            self.coverURL = nil
                        }
                    }
                    Picker(String(localized: "community.article.category", defaultValue: "Рубрика"), selection: $category) {
                        Text(String(localized: "community.article.noCategory", defaultValue: "Без рубрики")).tag("")
                        ForEach(CommunityArticleText.categories, id: \.self) { Text(CommunityArticleText.category($0)).tag($0) }
                    }
                    TextField(String(localized: "community.article.tags", defaultValue: "Теги через запятую"), text: $tags)
                        .textInputAutocapitalization(.never)
                    Picker(String(localized: "community.article.visibility", defaultValue: "Кто видит"), selection: $visibility) {
                        ForEach(CommunityArticleText.visibilities, id: \.self) { Text(CommunityArticleText.visibility($0)).tag($0) }
                    }
                    Toggle(String(localized: "community.article.allowComments", defaultValue: "Разрешить комментарии"), isOn: $allowComments)
                }
                .listRowBackground(Palette.card)

                Section {
                    Button(String(localized: "community.article.saveDraft", defaultValue: "Сохранить черновик")) {
                        Task { await save(status: "DRAFT") }
                    }
                    .disabled(!canSave)
                }
                .listRowBackground(Palette.card)
            }
            .scrollContentBackground(.hidden)
            .scrollDismissesKeyboard(.interactively)
            .background(Palette.background)
            .navigationTitle(Text(article == nil
                ? String(localized: "community.articles.new", defaultValue: "Написать статью")
                : String(localized: "feed.edit", defaultValue: "Редактировать")))
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(isSaving)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "common.cancel", defaultValue: "Отмена")) { dismiss() }
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
            }
            .task(id: coverPick) { await uploadCover() }
            .onAppear(perform: fill)
        }
    }

    private var canSave: Bool {
        let titleOK = !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && title.count <= 200
        let contentOK = !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && content.count <= 20000
        return titleOK && contentOK && summary.count <= 300 && !isUploadingCover && !isSaving
    }

    private func fill() {
        guard !didFill else { return }
        didFill = true
        guard let article else { return }
        title = article.title
        summary = article.description ?? ""
        content = article.content ?? ""
        category = article.category ?? ""
        tags = (article.tags ?? []).joined(separator: ", ")
        visibility = CommunityArticleText.visibilities.contains(article.visibility ?? "") ? (article.visibility ?? "ALL") : "ALL"
        allowComments = article.allowComments ?? true
        coverURL = article.coverUrl
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
