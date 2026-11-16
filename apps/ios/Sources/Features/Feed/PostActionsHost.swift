import SwiftUI

/// Листы и диалоги действий над постом — одни на экран.
///
/// Экран отдаёт содержимому готовый набор действий, а сам держит состояние: какой пост
/// открыт в комментариях, что правится, на что жалуемся. Одно и то же нужно ленте и
/// экрану публикации, поэтому это отдельный контейнер, а не копия в каждом экране.
struct PostActionsHost<Content: View>: View {
    let model: FeedModel
    var onDeleted: () -> Void = {}
    @ViewBuilder let content: (PostCardActions) -> Content

    @State private var commentsFor: PostDTO?
    @State private var editing: PostDTO?
    @State private var reporting: PostDTO?
    @State private var deleting: PostDTO?
    @State private var reposting: PostDTO?
    @State private var repostNote = ""
    @State private var reported = false
    @State private var sharing: PostDTO?

    var body: some View {
        content(actions)
            .sheet(item: $commentsFor) { post in
                NavigationStack {
                    PostCommentsView(postID: post.id, showsPost: false) { delta in
                        model.adjustComments(of: post.id, by: delta)
                    }
                }
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
            }
            .sheet(item: $editing) { post in
                PostEditorSheet(post: post, model: model)
            }
            .sheet(item: $sharing) { post in
                CommunitySharePostView(postID: post.id)
                    .presentationDetents([.medium, .large])
            }
            .alert(
                String(localized: "feed.report.title", defaultValue: "Что не так с публикацией?"),
                isPresented: Binding(get: { reporting != nil }, set: { if !$0 { reporting = nil } }),
                presenting: reporting
            ) { post in
                ForEach(ComplaintReason.allCases) { reason in
                    Button(reason.title) {
                        Task {
                            reported = await model.reportPost(post.id, reason: reason.title)
                        }
                    }
                }
                Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
            }
            .alert(
                String(localized: "feed.delete.title", defaultValue: "Удалить публикацию?"),
                isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                presenting: deleting
            ) { post in
                Button(String(localized: "feed.delete", defaultValue: "Удалить"), role: .destructive) {
                    Task {
                        await model.delete(post.id)
                        onDeleted()
                    }
                }
                Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
            } message: { _ in
                Text(String(localized: "feed.delete.message", defaultValue: "Публикацию нельзя будет вернуть."))
            }
            .alert(
                String(localized: "feed.repost.title", defaultValue: "Репост в группу"),
                isPresented: Binding(get: { reposting != nil }, set: { if !$0 { reposting = nil } }),
                presenting: reposting
            ) { post in
                TextField(
                    String(localized: "feed.repost.note", defaultValue: "Комментарий (необязательно)"),
                    text: $repostNote
                )
                Button(String(localized: "feed.repost.send", defaultValue: "Опубликовать")) {
                    let note = repostNote.trimmingCharacters(in: .whitespacesAndNewlines)
                    repostNote = ""
                    Task { _ = await model.repost(post.id, note: note.isEmpty ? nil : note) }
                }
                Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {
                    repostNote = ""
                }
            } message: { _ in
                Text(String(
                    localized: "feed.repost.message",
                    defaultValue: "Публикация появится в ленте вашей группы."
                ))
            }
            .alert(
                String(localized: "feed.report.sent", defaultValue: "Жалоба отправлена"),
                isPresented: $reported
            ) {
                Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
            } message: {
                Text(String(
                    localized: "feed.report.sent.message",
                    defaultValue: "Модераторы вуза рассмотрят её."
                ))
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

    private var actions: PostCardActions {
        PostCardActions(
            comments: { commentsFor = $0 },
            repost: { reposting = $0 },
            edit: { editing = $0 },
            delete: { deleting = $0 },
            report: { reporting = $0 },
            shareToChat: { sharing = $0 },
            pin: { post in Task { await model.setPinned(post.id, post.pinnedAt == nil) } },
            publish: { post in Task { await model.publishDraft(post.id) } }
        )
    }
}

/// Причины жалобы — те же, что в вебе. На сервер уходит подпись на языке человека:
/// поле `reason` у жалобы — свободный текст для модератора.
enum ComplaintReason: String, CaseIterable, Identifiable {
    case spam, forbidden, fraud, hate, explicit, other

    var id: String { rawValue }

    var title: String {
        switch self {
        case .spam: return String(localized: "complaint.spam", defaultValue: "Спам или реклама")
        case .forbidden: return String(localized: "complaint.forbidden", defaultValue: "Запрещённый контент")
        case .fraud: return String(localized: "complaint.fraud", defaultValue: "Мошенничество")
        case .hate: return String(localized: "complaint.hate", defaultValue: "Оскорбления или травля")
        case .explicit: return String(localized: "complaint.explicit", defaultValue: "Непристойный контент")
        case .other: return String(localized: "complaint.other", defaultValue: "Другое")
        }
    }
}

/// Правка текста своего поста. Аудиторию и медиа сервер менять не даёт — их здесь нет.
private struct PostEditorSheet: View {
    let post: PostDTO
    let model: FeedModel

    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var isSaving = false
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            TextEditor(text: $text)
                .font(Typography.body)
                .focused($focused)
                .padding(.horizontal, Spacing.lg)
                .navigationTitle(Text(String(localized: "feed.edit", defaultValue: "Редактировать")))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        SheetCloseButton { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(String(localized: "common.save", defaultValue: "Сохранить")) {
                            Task {
                                isSaving = true
                                let saved = await model.edit(post.id, content: text)
                                isSaving = false
                                if saved { dismiss() }
                            }
                        }
                        .disabled(isSaving || !canSave)
                    }
                }
        }
        .onAppear {
            text = post.content ?? ""
            focused = true
        }
    }

    /// Пустой текст сервер принимает только у репоста.
    private var canSave: Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return (post.isRepost || !trimmed.isEmpty) && trimmed.count <= 5000 && text != (post.content ?? "")
    }
}
