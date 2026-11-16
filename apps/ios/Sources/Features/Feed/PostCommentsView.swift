import SwiftUI
import UIKit

/// Публикация с комментариями.
///
/// Открывается двумя путями: листом из ленты (сам пост человек только что видел — его
/// не повторяем) и экраном по ссылке из уведомления (тогда пост сверху).
struct PostCommentsView: View {
    let postID: String
    var showsPost = true
    /// Счётчик комментариев изменился на столько — карточке в ленте, откуда открыт лист.
    var onCountChange: (Int) -> Void = { _ in }

    @Environment(\.viewerID) private var viewerID
    @Environment(\.dismiss) private var dismiss
    @State private var model: PostCommentsModel?
    @State private var feed = FeedModel()
    @State private var reportingComment: PostCommentDTO?
    @State private var reported = false
    /// Первая страница уже показана: дальше новый последний комментарий — это свой,
    /// только что отправленный, и к нему стоит прокрутить.
    @State private var didLoad = false
    @FocusState private var inputFocused: Bool

    var body: some View {
        // Листы и диалоги поста — над прокруткой, а не в ленивой строке: выгруженная при
        // прокрутке строка унесла бы с собой открытый лист. Удалили пост — экран его
        // комментариев больше не нужен.
        PostActionsHost(model: feed, onDeleted: { dismiss() }) { actions in
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: Spacing.xl) {
                        // Ошибка над уже показанным (не ушёл комментарий, не обновилось) —
                        // полосой; без данных её показывает `commentsSection` с повтором.
                        if let failure = model?.failure, model?.comments.isEmpty == false {
                            FormAlert(message: failure)
                        }

                        if showsPost, let post = feed.posts.first {
                            PostCardView(post: post, model: feed, viewerID: viewerID, actions: actions)
                        }

                        commentsSection
                    }
                    .padding(Spacing.xl)
                }
                .scrollDismissesKeyboard(.interactively)
                .screenState(!showsPost && model?.comments.isEmpty != false) {
                    if let model, !model.isLoading {
                        commentsState(model)
                    } else {
                        LoadingStateView()
                    }
                }
                .background(Palette.background)
                .pullToRefresh { await reload() }
                .onChange(of: model?.comments.last?.id) { _, last in
                    guard let last, didLoad else { return }
                    withMotion(Motion.calm) { proxy.scrollTo(last, anchor: .bottom) }
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            // Писать есть куда, только когда пост открылся: под ошибкой поле ввода
            // обещало бы комментарий к тому, чего на экране нет.
            if let model, model.post != nil {
                CommentInputBar(model: model, focused: $inputFocused)
            }
        }
        .navigationTitle(Text(showsPost
            ? String(localized: "shell.post", defaultValue: "Публикация")
            : String(localized: "feed.comments", defaultValue: "Комментарии")))
        .navigationBarTitleDisplayMode(.inline)
        .alert(
            String(localized: "feed.report.comment", defaultValue: "Что не так с комментарием?"),
            isPresented: Binding(get: { reportingComment != nil }, set: { if !$0 { reportingComment = nil } }),
            presenting: reportingComment
        ) { comment in
            ForEach(ComplaintReason.allCases) { reason in
                Button(reason.title) {
                    Task { reported = await model?.reportComment(comment, reason: reason.title) ?? false }
                }
            }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
        }
        .alert(String(localized: "feed.report.sent", defaultValue: "Жалоба отправлена"), isPresented: $reported) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        }
        .onChange(of: model?.countChange ?? 0) { old, new in
            feed.adjustComments(of: postID, by: new - old)
            onCountChange(new - old)
        }
        .task {
            guard model == nil else { return }
            model = PostCommentsModel(postID: postID)
            await reload()
            didLoad = true
        }
    }

    private func reload() async {
        await model?.load()
        if let post = model?.post { feed.insert(post) }
    }

    /// Комментариев нет: сбой загрузки или пусто.
    @ViewBuilder
    private func commentsState(_ model: PostCommentsModel) -> some View {
        if let failure = model.failure {
            ErrorStateView(message: failure, isOffline: model.isOffline) { await reload() }
        } else {
            EmptyStateView(
                title: String(localized: "feed.noComments", defaultValue: "Комментариев пока нет"),
                symbol: "bubble.left.and.bubble.right",
                hint: String(localized: "feed.noComments.hint", defaultValue: "Напишите первым")
            )
        }
    }

    @ViewBuilder
    private var commentsSection: some View {
        if let model {
            if model.hasOlder {
                Button {
                    Task { await model.loadOlder() }
                } label: {
                    HStack(spacing: Spacing.md) {
                        if model.isLoadingOlder { ProgressView() }
                        Text(String(localized: "feed.olderComments", defaultValue: "Показать предыдущие"))
                    }
                    .font(Typography.meta.weight(.medium))
                    .foregroundStyle(Palette.primary)
                }
                .buttonStyle(.plain)
                .disabled(model.isLoadingOlder)
            }

            if showsPost, model.isLoading, model.comments.isEmpty {
                // Под постом — индикатор строкой; без поста он по центру экрана (`body`).
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Spacing.xxl)
            } else if showsPost, model.comments.isEmpty {
                // Под постом — строкой; без поста состояние встаёт по центру (`commentsState`).
                commentsState(model)
            }

            // Ответы сгруппированы одним проходом на пересчёт, а не фильтром всех
            // комментариев на каждый корень (п. 43 аудита: было O(n²)).
            let replies = model.repliesByRoot
            ForEach(model.roots) { root in
                CommentRow(comment: root, isReply: false, viewerID: viewerID, actions: rowActions(model))
                    .id(root.id)
                ForEach(replies[root.id] ?? []) { reply in
                    CommentRow(comment: reply, isReply: true, viewerID: viewerID, actions: rowActions(model))
                        .id(reply.id)
                }
            }
            ForEach(model.orphans) { reply in
                CommentRow(comment: reply, isReply: true, viewerID: viewerID, actions: rowActions(model))
                    .id(reply.id)
            }
        }
    }

    private func rowActions(_ model: PostCommentsModel) -> CommentRow.Actions {
        CommentRow.Actions(
            reply: { comment in
                model.replyTo = comment
                inputFocused = true
            },
            delete: { comment in Task { await model.delete(comment) } },
            report: { comment in reportingComment = comment }
        )
    }
}

private struct CommentRow: View {
    struct Actions {
        let reply: (PostCommentDTO) -> Void
        let delete: (PostCommentDTO) -> Void
        let report: (PostCommentDTO) -> Void
    }

    let comment: PostCommentDTO
    let isReply: Bool
    let viewerID: String
    let actions: Actions

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.lg) {
            AvatarView(url: comment.author?.avatarUrl, name: name, size: isReply ? 28 : 32)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack(spacing: Spacing.sm) {
                    Text(name)
                        .font(Typography.meta.weight(.semibold))
                        .foregroundStyle(Palette.foreground)
                        .lineLimit(1)
                    Text(comment.createdAt, format: .relative(presentation: .named))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(1)
                }
                Text(RichText.attributed(comment.content))
                    .font(Typography.body)
                    .foregroundStyle(Palette.foreground)
                    .tint(Palette.primary)
                    .fixedSize(horizontal: false, vertical: true)
                Button(String(localized: "feed.reply", defaultValue: "Ответить")) {
                    actions.reply(comment)
                }
                .font(Typography.meta.weight(.medium))
                .foregroundStyle(Palette.mutedForeground)
                .buttonStyle(.plain)
            }
            Spacer(minLength: 0)
        }
        .padding(.leading, isReply ? 40 : 0)
        .contentShape(Rectangle())
        .contextMenu {
            Button {
                actions.reply(comment)
            } label: {
                Label(String(localized: "feed.reply", defaultValue: "Ответить"), systemImage: "arrowshape.turn.up.left")
            }
            Button {
                UIPasteboard.general.string = comment.content
            } label: {
                Label(String(localized: "feed.copyText", defaultValue: "Копировать текст"), systemImage: "doc.on.doc")
            }
            if comment.author?.id != viewerID {
                Button {
                    actions.report(comment)
                } label: {
                    Label(String(localized: "feed.report", defaultValue: "Пожаловаться"), systemImage: "exclamationmark.bubble")
                }
            }
            if comment.canDelete == true {
                Button(role: .destructive) {
                    actions.delete(comment)
                } label: {
                    Label(String(localized: "feed.delete", defaultValue: "Удалить"), systemImage: "trash")
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var name: String {
        let value = comment.author?.name ?? ""
        return value.isEmpty ? String(localized: "home.someone", defaultValue: "Кто-то") : value
    }
}

/// Поле ввода у нижнего края: едет вместе с клавиатурой, потому что стоит во
/// вставке безопасной зоны, а не поверх списка.
private struct CommentInputBar: View {
    @Bindable var model: PostCommentsModel
    var focused: FocusState<Bool>.Binding

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            if let replyTo = model.replyTo {
                HStack(spacing: Spacing.md) {
                    Image(systemName: "arrowshape.turn.up.left")
                    Text(String(localized: "feed.replyingTo", defaultValue: "Ответ:"))
                    Text(replyTo.author?.name ?? "")
                        .fontWeight(.semibold)
                        .lineLimit(1)
                    Spacer()
                    Button {
                        model.replyTo = nil
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                    }
                    .buttonStyle(.pressableIcon)
                    .accessibilityLabel(Text(String(localized: "feed.reply.cancel", defaultValue: "Отменить ответ")))
                }
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.sm)
                .glassSurface(interactive: false, in: Capsule())
            }
            GlassGroup(spacing: Spacing.md) {
                HStack(alignment: .bottom, spacing: Spacing.md) {
                    TextField(
                        String(localized: "feed.comment", defaultValue: "Комментарий"),
                        text: $model.draft,
                        axis: .vertical
                    )
                    .lineLimit(1...5)
                    .focused(focused)
                    .padding(.horizontal, Spacing.lg)
                    .padding(.vertical, Spacing.md)
                    .frame(minHeight: ControlHeight.lg)
                    // Как поле сообщения в чатах: в одну строку — капсула из стекла.
                    .commentInputGlass(in: RoundedRectangle(cornerRadius: ControlHeight.lg / 2, style: .continuous))

                    Button {
                        Task { await model.send() }
                    } label: {
                        Group {
                            if model.isSending {
                                ProgressView().tint(Palette.primaryForeground)
                            } else {
                                Image(systemName: "arrow.up")
                                    .font(.body.weight(.bold))
                            }
                        }
                        .foregroundStyle(Palette.primaryForeground)
                        .frame(width: ControlHeight.lg, height: ControlHeight.lg)
                        .glassSurface(tint: Palette.primary, in: Circle())
                    }
                    .buttonStyle(.pressableIcon)
                    .disabled(isEmpty || model.isSending)
                    .opacity(isEmpty ? 0.5 : 1)
                    .sensoryFeedback(.success, trigger: model.comments.count)
                    .accessibilityLabel(Text(String(localized: "chats.send", defaultValue: "Отправить")))
                }
            }
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.md)
        .modifier(CommentInputBackground())
    }

    private var isEmpty: Bool {
        model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

/// Подложка панели комментария: на iOS 26 её нет — поле и кнопка стеклом над лентой,
/// как в чатах; раньше — системная полоса.
private struct CommentInputBackground: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26, *) {
            content
        } else {
            content.background(.bar)
        }
    }
}

private extension View {
    @ViewBuilder
    func commentInputGlass<S: Shape>(in shape: S) -> some View {
        if #available(iOS 26, *) {
            glassSurface(in: shape)
        } else {
            background(Palette.muted, in: shape)
        }
    }
}
