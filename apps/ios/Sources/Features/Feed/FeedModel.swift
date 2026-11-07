import Foundation
import Observation

/// Лента постов.
///
/// Реакции ставятся оптимистично, как свайпы в списке чатов: палец убрал — цифра
/// уже изменилась. Отказ сервера откатываем, иначе человек уверен, что поставил
/// лайк, а его нет.
@Observable
final class FeedModel {
    private(set) var posts: [PostDTO] = []
    private(set) var isRefreshing = false
    private(set) var isLoadingMore = false
    /// Первая загрузка ещё не закончилась — вместо пустого состояния показываем скелет.
    private(set) var hasLoaded = false
    /// Последняя ошибка загрузки ленты: экран показывает её с повтором.
    private(set) var failure: String?
    /// Ошибка — отсутствие связи, а не отказ сервера: текст и иконка другие.
    private(set) var isOffline = false
    /// Сообщение о неудавшемся действии над постом (реакция, закладка, удаление).
    private(set) var actionFailure: String?
    /// Локальные поправки к реакциям: id поста → эмодзи → моё состояние.
    private(set) var myReactions: [String: Set<String>] = [:]
    private(set) var counts: [String: [String: Int]] = [:]
    private(set) var bookmarks: Set<String> = []

    private let api: FeedFetching
    private var cursor: String?

    init(api: FeedFetching = FeedAPI()) {
        self.api = api
    }

    var hasMore: Bool { cursor != nil }

    @MainActor
    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer {
            isRefreshing = false
            hasLoaded = true
        }
        do {
            let page = try await api.posts(cursor: nil)
            posts = page.items
            cursor = page.meta?.hasNext == true ? page.meta?.cursor : nil
            myReactions = [:]
            counts = [:]
            bookmarks = []
            remember(page.items)
            failure = nil
            isOffline = false
        } catch {
            report(error)
        }
    }

    @MainActor
    func loadMore() async {
        guard let cursor, !isRefreshing, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await api.posts(cursor: cursor)
            // Пост мог сдвинуться между страницами (закрепили, подняли приоритет) —
            // повтор с тем же id сломал бы идентичность строк в ленте.
            let known = Set(posts.map(\.id))
            let fresh = page.items.filter { !known.contains($0.id) }
            posts += fresh
            // Реакции дозагруженных постов — туда же, иначе со второй страницы все
            // счётчики показывались нулями.
            remember(fresh)
            self.cursor = page.meta?.hasNext == true ? page.meta?.cursor : nil
        } catch {
            // Молча: хвост ленты не доехал — это не повод рисовать ошибку поверх
            // того, что человек уже читает. Следующая прокрутка до конца повторит.
        }
    }

    // MARK: - Реакции

    func isMine(_ emoji: String, in postID: String) -> Bool {
        myReactions[postID]?.contains(emoji) ?? false
    }

    func count(_ emoji: String, in postID: String) -> Int {
        counts[postID]?[emoji] ?? 0
    }

    /// Все реакции поста — для счётчика рядом с кнопкой.
    func totalReactions(in postID: String) -> Int {
        counts[postID]?.values.reduce(0, +) ?? 0
    }

    /// Поставленные на пост эмодзи по убыванию: их показываем стопкой у счётчика.
    func topReactions(in postID: String, limit: Int = 3) -> [String] {
        (counts[postID] ?? [:])
            .filter { $0.value > 0 }
            .sorted { $0.value == $1.value ? $0.key < $1.key : $0.value > $1.value }
            .prefix(limit)
            .map(\.key)
    }

    @MainActor
    func toggle(_ emoji: String, on postID: String) async {
        let wasMine = isMine(emoji, in: postID)
        apply(emoji: emoji, postID: postID, mine: !wasMine)
        do {
            try await api.react(postID: postID, emoji: emoji, on: !wasMine)
        } catch {
            apply(emoji: emoji, postID: postID, mine: wasMine)
            failure = message(for: error)
        }
    }

    // MARK: - Действия над постом

    func isBookmarked(_ postID: String) -> Bool { bookmarks.contains(postID) }

    @MainActor
    func toggleBookmark(_ postID: String) async {
        let was = isBookmarked(postID)
        setBookmark(postID, !was)
        do {
            // Сервер — переключатель: верим его ответу, а не своему предположению.
            setBookmark(postID, try await api.toggleBookmark(postID: postID))
        } catch {
            setBookmark(postID, was)
            actionFailure = message(for: error)
        }
    }

    /// Репост в свою группу. Новый пост встаёт наверх ленты — человек видит результат.
    @MainActor
    func repost(_ postID: String, note: String?) async -> Bool {
        do {
            let created = try await api.repost(postID: postID, note: note)
            insert(created)
            return true
        } catch {
            actionFailure = message(for: error)
            return false
        }
    }

    @MainActor
    func edit(_ postID: String, content: String) async -> Bool {
        do {
            let updated = try await api.editPost(id: postID, content: content)
            if let index = posts.firstIndex(where: { $0.id == postID }) {
                posts[index] = updated
            }
            return true
        } catch {
            actionFailure = message(for: error)
            return false
        }
    }

    @MainActor
    func delete(_ postID: String) async {
        guard let index = posts.firstIndex(where: { $0.id == postID }) else { return }
        let removed = posts.remove(at: index)
        do {
            try await api.deletePost(id: postID)
        } catch {
            posts.insert(removed, at: min(index, posts.count))
            actionFailure = message(for: error)
        }
    }

    @MainActor
    func reportPost(_ postID: String, reason: String) async -> Bool {
        do {
            try await api.report(.post, id: postID, reason: reason)
            return true
        } catch {
            actionFailure = message(for: error)
            return false
        }
    }

    /// Пост, только что созданный на этом телефоне.
    @MainActor
    func insert(_ post: PostDTO) {
        posts.removeAll { $0.id == post.id }
        posts.insert(post, at: 0)
        remember([post])
    }

    @MainActor
    func dismissActionFailure() {
        actionFailure = nil
    }

    // MARK: - Внутреннее

    @MainActor
    private func remember(_ items: [PostDTO]) {
        for post in items {
            myReactions[post.id] = Set(post.myReactions)
            counts[post.id] = post.reactions
            if post.bookmarked == true { bookmarks.insert(post.id) }
        }
    }

    @MainActor
    private func setBookmark(_ postID: String, _ on: Bool) {
        if on { bookmarks.insert(postID) } else { bookmarks.remove(postID) }
    }

    @MainActor
    private func report(_ error: Error) {
        if case .transport = error as? APIError {
            isOffline = true
        }
        failure = message(for: error)
    }

    private func message(for error: Error) -> String {
        error.userMessage
    }

    @MainActor
    private func apply(emoji: String, postID: String, mine: Bool) {
        var set = myReactions[postID] ?? []
        var map = counts[postID] ?? [:]
        if mine {
            set.insert(emoji)
            map[emoji] = (map[emoji] ?? 0) + 1
        } else {
            set.remove(emoji)
            map[emoji] = max(0, (map[emoji] ?? 0) - 1)
        }
        myReactions[postID] = set
        counts[postID] = map
    }
}

/// Комментарии одного поста.
///
/// Сервер отдаёт их от новых к старым, а читают сверху вниз — от старых к новым.
/// Поэтому страница разворачивается, а «показать предыдущие» дописывает в начало.
@Observable
final class PostCommentsModel {
    /// Сам пост: карточка из пуша или колокольчика показывала одни комментарии.
    private(set) var post: PostDTO?
    private(set) var comments: [PostCommentDTO] = []
    private(set) var isLoading = false
    private(set) var isLoadingOlder = false
    private(set) var isSending = false
    private(set) var failure: String?
    /// На какой комментарий отвечаем. Ответ на ответ сервер всё равно вешает на корень.
    var replyTo: PostCommentDTO?
    var draft = ""

    private let api: FeedFetching
    private let postID: String
    private var cursor: String?

    init(postID: String, api: FeedFetching = FeedAPI()) {
        self.postID = postID
        self.api = api
    }

    var hasOlder: Bool { cursor != nil }

    /// Корневые комментарии по порядку.
    var roots: [PostCommentDTO] { comments.filter { $0.parentId == nil } }

    /// Ответы на корневой комментарий, по порядку.
    func replies(to rootID: String) -> [PostCommentDTO] {
        comments.filter { $0.parentId == rootID }
    }

    /// Ответ, чей корень не попал в загруженные страницы, показываем отдельной строкой,
    /// а не теряем.
    var orphans: [PostCommentDTO] {
        let rootIDs = Set(roots.map(\.id))
        return comments.filter { comment in
            guard let parent = comment.parentId else { return false }
            return !rootIDs.contains(parent)
        }
    }

    @MainActor
    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let post = api.post(id: postID)
            async let page = api.comments(postID: postID, cursor: nil)
            self.post = try await post
            let first = try await page
            comments = first.items.reversed()
            cursor = first.meta?.hasNext == true ? first.meta?.cursor : nil
            failure = nil
            // Просмотр засчитывается при открытии поста, как в вебе. Ошибка счётчика
            // человеку ни о чём не говорит.
            try? await api.markViewed(postID: postID)
        } catch {
            failure = message(for: error)
        }
    }

    @MainActor
    func loadOlder() async {
        guard let cursor, !isLoadingOlder else { return }
        isLoadingOlder = true
        defer { isLoadingOlder = false }
        do {
            let page = try await api.comments(postID: postID, cursor: cursor)
            let known = Set(comments.map(\.id))
            comments = page.items.reversed().filter { !known.contains($0.id) } + comments
            self.cursor = page.meta?.hasNext == true ? page.meta?.cursor : nil
        } catch {
            failure = message(for: error)
        }
    }

    @MainActor
    func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isSending else { return }
        let parent = replyTo.map { $0.parentId ?? $0.id }
        draft = ""
        isSending = true
        defer { isSending = false }
        do {
            let created = try await api.comment(postID: postID, text: text, parentID: parent)
            comments.append(created)
            replyTo = nil
            failure = nil
        } catch {
            // Текст возвращаем в поле: потерять написанное из-за сети нельзя.
            draft = text
            failure = message(for: error)
        }
    }

    @MainActor
    func delete(_ comment: PostCommentDTO) async {
        let snapshot = comments
        // Сервер удаляет только сам комментарий: ответы на него остаются и
        // показываются без корня (`orphans`).
        comments.removeAll { $0.id == comment.id }
        do {
            try await api.deleteComment(postID: postID, commentID: comment.id)
        } catch {
            comments = snapshot
            failure = message(for: error)
        }
    }

    @MainActor
    func reportComment(_ comment: PostCommentDTO, reason: String) async -> Bool {
        do {
            try await api.report(.comment, id: comment.id, reason: reason)
            return true
        } catch {
            failure = message(for: error)
            return false
        }
    }

    private func message(for error: Error) -> String {
        error.userMessage
    }
}

/// События и запись на них.
@Observable
final class EventsModel {
    private(set) var events: [EventDTO] = []
    private(set) var registered: Set<String> = []
    private(set) var isLoading = false
    private(set) var failure: String?

    private let api: FeedFetching

    init(api: FeedFetching = FeedAPI()) {
        self.api = api
    }

    @MainActor
    func refresh() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let page = try await api.events(onlyMine: false)
            events = page.items
            registered = Set(page.items.filter { $0.isRegistered == true }.map(\.id))
            failure = nil
        } catch {
            failure = error.userMessage
        }
    }

    func isRegistered(_ id: String) -> Bool { registered.contains(id) }

    /// Запись тоже оптимистична: человек нажал «пойду» и должен увидеть это сразу,
    /// а не через круг ожидания.
    @MainActor
    func toggleRegistration(_ id: String) async {
        let was = isRegistered(id)
        if was { registered.remove(id) } else { registered.insert(id) }
        do {
            try await api.register(eventID: id, on: !was)
        } catch {
            if was { registered.insert(id) } else { registered.remove(id) }
            failure = error.userMessage
        }
    }
}

/// Центр уведомлений и каналы доставки.
@Observable
final class NotificationsModel {
    private(set) var items: [NotificationDTO] = []
    private(set) var settings: NotificationSettingsDTO?
    private(set) var isLoading = false
    private(set) var failure: String?

    private let api: FeedFetching

    init(api: FeedFetching = FeedAPI()) {
        self.api = api
    }

    var unreadCount: Int { items.filter { !$0.isRead }.count }

    @MainActor
    func refresh() async {
        isLoading = true
        defer { isLoading = false }
        do {
            items = try await api.notifications(cursor: nil).items
            settings = try await api.notificationSettings()
            failure = nil
        } catch {
            failure = error.userMessage
        }
    }

    @MainActor
    func markRead(_ id: String) async {
        guard let index = items.firstIndex(where: { $0.id == id }), !items[index].isRead else { return }
        try? await api.markRead(notificationID: id)
        await refresh()
    }

    @MainActor
    func markAllRead() async {
        try? await api.markAllRead()
        await refresh()
    }

    @MainActor
    func update(push: Bool? = nil, email: Bool? = nil) async {
        let next = NotificationSettingsDTO(
            pushEnabled: push ?? settings?.pushEnabled,
            emailEnabled: email ?? settings?.emailEnabled
        )
        settings = next
        do {
            try await api.updateNotificationSettings(next)
        } catch {
            failure = error.userMessage
            await refresh()
        }
    }
}
