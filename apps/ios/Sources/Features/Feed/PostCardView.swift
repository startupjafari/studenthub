import SwiftUI
import UIKit

/// Что карточка просит у экрана. Листы и диалоги живут на экране, а не в каждой
/// карточке: в ленте их сотня, и сотня скрытых листов — лишняя работа на прокрутке.
struct PostCardActions {
    var comments: (PostDTO) -> Void = { _ in }
    var repost: (PostDTO) -> Void = { _ in }
    var edit: (PostDTO) -> Void = { _ in }
    var delete: (PostDTO) -> Void = { _ in }
    var report: (PostDTO) -> Void = { _ in }
}

/// Карточка публикации: шапка, текст, медиа, репост и действия.
///
/// Структура одна для поста с картинками и без: отступы задаёт содержимое, поэтому
/// короткий текст не превращается в пустую плитку.
struct PostCardView: View {
    let post: PostDTO
    let model: FeedModel
    let viewerID: String
    var actions = PostCardActions()

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            PostHeaderView(post: post, isOwn: isOwn, actions: actions)

            if let title = post.title, !title.isEmpty {
                Text(title)
                    .font(Typography.sectionTitle)
                    .foregroundStyle(Palette.foreground)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let content = post.content, !content.isEmpty {
                PostTextView(content: content)
            }

            if post.isRepost {
                RepostContentView(original: post.original)
            }

            if let media = post.media, !media.isEmpty {
                PostMediaView(media: media)
            }

            PostActionsView(post: post, model: model, actions: actions)
        }
        .padding(Spacing.xl)
        .cardSurface()
        .contentShape(Rectangle())
        .accessibilityElement(children: .contain)
    }

    private var isOwn: Bool { (post.authorId ?? post.author?.id) == viewerID }
}

// MARK: - Шапка

struct PostHeaderView: View {
    let post: PostDTO
    let isOwn: Bool
    let actions: PostCardActions

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.lg) {
            authorLink {
                AvatarView(url: post.speaker?.logoUrl ?? post.author?.avatarUrl, name: displayName, size: 40)
            }

            VStack(alignment: .leading, spacing: 2) {
                authorLink {
                    Text(displayName)
                        .font(Typography.cardTitle)
                        .foregroundStyle(Palette.foreground)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                .buttonStyle(.plain)

                HStack(spacing: Spacing.xs) {
                    if let subtitle {
                        Text(subtitle)
                        Text(verbatim: "·").accessibilityHidden(true)
                    }
                    Text(post.publishedAt ?? post.createdAt, format: .relative(presentation: .named))
                    if let audience = PostAudienceLabel.title(post.audience) {
                        Text(verbatim: "·").accessibilityHidden(true)
                        Label(audience, systemImage: PostAudienceLabel.symbol(post.audience))
                            .labelStyle(.iconOnly)
                            .accessibilityLabel(Text(audience))
                    }
                    if post.pinnedAt != nil {
                        Image(systemName: "pin.fill")
                            .accessibilityLabel(Text(String(localized: "feed.pinned", defaultValue: "Закреплено")))
                    }
                }
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
                .lineLimit(1)
            }

            Spacer(minLength: 0)

            PostMenu(post: post, isOwn: isOwn, actions: actions)
        }
    }

    private var displayName: String {
        if let speaker = post.speaker { return speaker.name }
        let name = post.author?.name ?? ""
        return name.isEmpty ? String(localized: "home.someone", defaultValue: "Кто-то") : name
    }

    private var subtitle: String? {
        if post.isRepost { return String(localized: "feed.reposted", defaultValue: "репост") }
        guard post.speaker == nil, let raw = post.author?.role else { return nil }
        return Role(rawValue: raw)?.feedTitle
    }

    /// Имя и аватар ведут в профиль автора. У поста организации профиля человека нет.
    @ViewBuilder
    private func authorLink<Label: View>(@ViewBuilder label: () -> Label) -> some View {
        if post.speaker == nil, let id = post.author?.id {
            NavigationLink(value: AppRoute.profile(id: id), label: label)
                .buttonStyle(.plain)
        } else {
            label()
        }
    }
}

/// Меню «…»: набор пунктов зависит от прав. Чего сервер не умеет (скрыть пост),
/// здесь нет — кнопка без действия хуже её отсутствия.
private struct PostMenu: View {
    let post: PostDTO
    let isOwn: Bool
    let actions: PostCardActions

    var body: some View {
        Menu {
            NavigationLink(value: AppRoute.post(id: post.id)) {
                Label(String(localized: "feed.open", defaultValue: "Открыть публикацию"), systemImage: "doc.text")
            }
            if let url = AppConfiguration.webURL(forPost: post.id) {
                ShareLink(item: url) {
                    Label(String(localized: "feed.share", defaultValue: "Поделиться"), systemImage: "square.and.arrow.up")
                }
                Button {
                    UIPasteboard.general.url = url
                } label: {
                    Label(String(localized: "feed.copyLink", defaultValue: "Копировать ссылку"), systemImage: "link")
                }
            }
            if isOwn {
                Button {
                    actions.edit(post)
                } label: {
                    Label(String(localized: "feed.edit", defaultValue: "Редактировать"), systemImage: "pencil")
                }
            }
            if !isOwn {
                Button {
                    actions.report(post)
                } label: {
                    Label(String(localized: "feed.report", defaultValue: "Пожаловаться"), systemImage: "exclamationmark.bubble")
                }
            }
            if post.canDelete == true {
                Button(role: .destructive) {
                    actions.delete(post)
                } label: {
                    Label(String(localized: "feed.delete", defaultValue: "Удалить"), systemImage: "trash")
                }
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.body.weight(.semibold))
                .foregroundStyle(Palette.mutedForeground)
                .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(Text(String(localized: "feed.more", defaultValue: "Действия с публикацией")))
    }
}

// MARK: - Содержимое

/// Текст поста. Длинный сворачивается до восьми строк с «Ещё»: одна простыня не
/// должна занимать весь экран ленты.
struct PostTextView: View {
    let content: String
    var lineLimit = 8

    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(RichText.attributed(content))
                .font(Typography.body)
                .foregroundStyle(Palette.foreground)
                .tint(Palette.primary)
                .lineLimit(expanded ? nil : lineLimit)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)

            if !expanded, content.count > 400 || content.filter(\.isNewline).count >= lineLimit {
                Button(String(localized: "feed.readMore", defaultValue: "Ещё")) {
                    expanded = true
                }
                .font(Typography.meta.weight(.medium))
                .foregroundStyle(Palette.primary)
            }
        }
    }
}

/// Исходник репоста: тонкая линия слева и автор — без второй рамки внутри карточки.
struct RepostContentView: View {
    let original: PostDTO.Original?

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.lg) {
            RoundedRectangle(cornerRadius: 1)
                .fill(Palette.primary.opacity(0.5))
                .frame(width: 2)

            if let original {
                NavigationLink(value: AppRoute.post(id: original.id)) {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        HStack(spacing: Spacing.md) {
                            AvatarView(url: original.author?.avatarUrl, name: original.author?.name ?? "", size: 24)
                            Text(original.author?.name ?? String(localized: "home.someone", defaultValue: "Кто-то"))
                                .font(Typography.meta.weight(.semibold))
                                .foregroundStyle(Palette.foreground)
                                .lineLimit(1)
                        }
                        if let title = original.title, !title.isEmpty {
                            Text(title)
                                .font(Typography.cardTitle)
                                .foregroundStyle(Palette.foreground)
                        }
                        if let content = original.content, !content.isEmpty {
                            Text(RichText.attributed(content))
                                .font(Typography.body)
                                .foregroundStyle(Palette.foreground)
                                .lineLimit(6)
                                .multilineTextAlignment(.leading)
                        }
                        Text(String(localized: "feed.openOriginal", defaultValue: "Открыть публикацию"))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.primary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
            } else {
                Label(
                    String(localized: "feed.originalUnavailable", defaultValue: "Публикация недоступна"),
                    systemImage: "eye.slash"
                )
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - Действия

/// Нижняя строка: реакции, комментарии, репост, закладка.
///
/// Короткое нажатие на реакцию ставит «❤️», долгое раскрывает весь набор сервера —
/// системное меню с основным действием делает ровно это без своих жестов.
struct PostActionsView: View {
    let post: PostDTO
    let model: FeedModel
    let actions: PostCardActions

    @State private var reactionTick = 0
    @State private var bookmarkTick = 0

    var body: some View {
        HStack(spacing: Spacing.xs) {
            reactionButton
            counterButton(
                symbol: "bubble.right",
                count: post.commentsCount,
                label: String(localized: "feed.comments", defaultValue: "Комментарии")
            ) {
                actions.comments(post)
            }
            if canRepost {
                counterButton(
                    symbol: "arrow.2.squarepath",
                    count: 0,
                    label: String(localized: "feed.repost", defaultValue: "Репост")
                ) {
                    actions.repost(post)
                }
            }
            Spacer(minLength: 0)
            if let views = post.views, views > 0 {
                Label {
                    Text(verbatim: views.formatted(.number.notation(.compactName)))
                } icon: {
                    Image(systemName: "eye")
                }
                .font(Typography.tabular(Typography.meta))
                .foregroundStyle(Palette.mutedForeground)
                .accessibilityLabel(Text(String(localized: "feed.views", defaultValue: "Просмотры")))
                .accessibilityValue(Text(verbatim: String(views)))
            }
            Button {
                bookmarkTick += 1
                Task { await model.toggleBookmark(post.id) }
            } label: {
                Image(systemName: model.isBookmarked(post.id) ? "bookmark.fill" : "bookmark")
                    .foregroundStyle(model.isBookmarked(post.id) ? Palette.primary : Palette.mutedForeground)
                    .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .sensoryFeedback(.selection, trigger: bookmarkTick)
            .accessibilityLabel(Text(model.isBookmarked(post.id)
                ? String(localized: "feed.unbookmark", defaultValue: "Убрать из сохранённого")
                : String(localized: "feed.bookmark", defaultValue: "Сохранить")))
        }
        .font(Typography.meta)
    }

    /// Репост невозможен у личного поста — так решает и веб.
    private var canRepost: Bool { post.audience != "PERSONAL" }

    private var mine: [String] {
        PostReactions.all.filter { model.isMine($0, in: post.id) }
    }

    private var reactionButton: some View {
        let total = model.totalReactions(in: post.id)
        let top = model.topReactions(in: post.id)
        let reacted = !mine.isEmpty
        return Menu {
            ForEach(PostReactions.all, id: \.self) { emoji in
                Button {
                    react(emoji)
                } label: {
                    if model.isMine(emoji, in: post.id) {
                        Label {
                            Text(verbatim: "\(emoji)  \(model.count(emoji, in: post.id))")
                        } icon: {
                            Image(systemName: "checkmark")
                        }
                    } else {
                        Text(verbatim: model.count(emoji, in: post.id) > 0
                            ? "\(emoji)  \(model.count(emoji, in: post.id))" : emoji)
                    }
                }
            }
        } label: {
            HStack(spacing: Spacing.xs) {
                if top.isEmpty {
                    Image(systemName: reacted ? "heart.fill" : "heart")
                } else {
                    Text(verbatim: top.joined())
                        .font(.footnote)
                }
                if total > 0 {
                    Text(verbatim: total.formatted(.number.notation(.compactName)))
                        .font(Typography.tabular(Typography.meta))
                        .contentTransition(.numericText())
                }
            }
            .padding(.horizontal, Spacing.lg)
            .frame(height: ControlHeight.md)
            .background(reacted ? Palette.primary.opacity(0.12) : Palette.muted, in: Capsule())
            .foregroundStyle(reacted ? Palette.primary : Palette.mutedForeground)
            .animation(Motion.lively, value: total)
        } primaryAction: {
            react(mine.first ?? PostReactions.quick)
        }
        .sensoryFeedback(.impact(weight: .light), trigger: reactionTick)
        .accessibilityLabel(Text(String(localized: "feed.react", defaultValue: "Реакция")))
        .accessibilityValue(Text(verbatim: String(total)))
        .accessibilityHint(Text(String(
            localized: "feed.react.hint",
            defaultValue: "Долгое нажатие — выбрать другую реакцию"
        )))
    }

    private func react(_ emoji: String) {
        reactionTick += 1
        Task { await model.toggle(emoji, on: post.id) }
    }

    private func counterButton(symbol: String, count: Int, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: Spacing.xs) {
                Image(systemName: symbol)
                if count > 0 {
                    Text(verbatim: count.formatted(.number.notation(.compactName)))
                        .font(Typography.tabular(Typography.meta))
                }
            }
            .padding(.horizontal, Spacing.lg)
            .frame(height: ControlHeight.md)
            .foregroundStyle(Palette.mutedForeground)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(verbatim: count > 0 ? String(count) : ""))
    }
}

/// Скелет карточки на время первой загрузки.
struct PostCardSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            HStack(spacing: Spacing.lg) {
                Circle().fill(Palette.muted).frame(width: 40, height: 40)
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    SkeletonBlock(height: 12, width: 140)
                    SkeletonBlock(height: 10, width: 90)
                }
            }
            SkeletonBlock(height: 12)
            SkeletonBlock(height: 12)
            SkeletonBlock(height: 12, width: 200)
        }
        .padding(Spacing.xl)
        .cardSurface()
        .accessibilityHidden(true)
    }
}
