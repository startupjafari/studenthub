import Foundation
import Observation

/// Реакция на пост — ключ оптимистичного движка: эмодзи поста живут независимо.
struct PostReactionKey: Hashable, Sendable {
    let postID: String
    let emoji: String
}

/// Лента постов.
///
/// Реакции, закладки и закрепление ставятся оптимистично (`OptimisticSync`), как свайпы
/// в списке чатов: палец убрал — цифра уже изменилась. Быстрые повторные нажатия
/// сливаются, и на сервер уходит только итоговое состояние. Отказ сервера откатываем,
/// иначе человек уверен, что поставил лайк, а его нет; без связи — тоже откат с
/// сообщением (`CHANGELOG-PERF.md`, итерация 3).
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
    /// Следующая страница не пришла: под лентой — «Повторить».
    private(set) var pageFailure: String?
    /// Сообщение о неудавшемся действии над постом (реакция, закладка, удаление).
    private(set) var actionFailure: String?
    /// Локальные поправки к реакциям: id поста → эмодзи → моё состояние.
    private(set) var myReactions: [String: Set<String>] = [:]
    private(set) var counts: [String: [String: Int]] = [:]
    private(set) var bookmarks: Set<String> = []

    private let api: FeedFetching
    private var cursor: String?
    private let reactionSync: OptimisticSync<PostReactionKey, Bool>
    private let bookmarkSync: OptimisticSync<String, Bool>
    private let pinSync: OptimisticSync<String, Bool>

    init(api: FeedFetching = FeedAPI(), pacing: OptimisticPacing = .standard) {
        self.api = api
        reactionSync = OptimisticSync(label: "feed.reaction", pacing: pacing)
        bookmarkSync = OptimisticSync(label: "feed.bookmark", pacing: pacing)
        pinSync = OptimisticSync(label: "feed.pin", pacing: pacing)
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
        let stamp = beginRead()
        do {
            let page = try await api.posts(cursor: nil)
            posts = page.items.map { resolvePin($0, readAt: stamp) }
            cursor = page.meta?.hasNext == true ? page.meta?.cursor : nil
            myReactions = [:]
            counts = [:]
            bookmarks = []
            remember(page.items, readAt: stamp)
            // Тексты страницы — разобрать фоном, пока лента встаёт на экран: карточки
            // возьмут готовое (п. 34).
            RichText.warm(page.items.compactMap(\.content))
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
        let stamp = beginRead()
        do {
            let page = try await api.posts(cursor: cursor)
            // Пост мог сдвинуться между страницами (закрепили, подняли приоритет) —
            // повтор с тем же id сломал бы идентичность строк в ленте.
            let known = Set(posts.map(\.id))
            let fresh = page.items.filter { !known.contains($0.id) }
            posts += fresh.map { resolvePin($0, readAt: stamp) }
            // Реакции дозагруженных постов — туда же, иначе со второй страницы все
            // счётчики показывались нулями.
            remember(fresh, readAt: stamp)
            RichText.warm(fresh.compactMap(\.content))
            self.cursor = page.meta?.hasNext == true ? page.meta?.cursor : nil
            pageFailure = nil
        } catch is CancellationError {
            return
        } catch {
            // Не поверх того, что человек читает, а строкой под лентой — там, где он
            // ждёт продолжения.
            pageFailure = message(for: error)
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

    /// Поставить или снять реакцию. Состояние меняется сразу; «вкл-выкл-вкл» подряд
    /// отправляет одно итоговое «вкл». Повтор, уже применённый сервером (409 на
    /// «поставить», 404 на «снять»), — успех: дубля реакции не будет.
    @MainActor
    func toggle(_ emoji: String, on postID: String) async {
        let shown = isMine(emoji, in: postID)
        let api = api
        await reactionSync.set(
            PostReactionKey(postID: postID, emoji: emoji),
            to: !shown,
            current: shown,
            apply: { [weak self] mine in self?.apply(emoji: emoji, postID: postID, mine: mine) },
            send: { _, mine in
                do {
                    try await api.react(postID: postID, emoji: emoji, on: mine)
                } catch where error.isAlreadyApplied(turningOn: mine) {}
                return nil
            },
            // Отказ действия — не отказ ленты: полоса «данные устарели» здесь солгала бы.
            failed: { [weak self] error in self?.actionFailure = error.rollbackMessage }
        )
    }

    // MARK: - Действия над постом

    func isBookmarked(_ postID: String) -> Bool { bookmarks.contains(postID) }

    /// Закладка. Сервер — переключатель: запрос уходит, только когда показанное
    /// расходится с подтверждённым, и ответ сервера (его положение) — правда, которую
    /// и показываем.
    @MainActor
    func toggleBookmark(_ postID: String) async {
        let shown = isBookmarked(postID)
        let api = api
        await bookmarkSync.set(
            postID,
            to: !shown,
            current: shown,
            apply: { [weak self] on in self?.setBookmark(postID, on) },
            send: { _, _ in try await api.toggleBookmark(postID: postID) },
            failed: { [weak self] error in self?.actionFailure = error.rollbackMessage }
        )
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

    /// Закрепить или открепить — только роль выше автора (`canPin`). Метка на
    /// карточке меняется сразу, отказ её возвращает.
    @MainActor
    func setPinned(_ postID: String, _ pinned: Bool) async {
        guard let index = posts.firstIndex(where: { $0.id == postID }) else { return }
        let shown = posts[index].pinnedAt != nil
        await pinSync.set(
            postID,
            to: pinned,
            current: shown,
            apply: { [weak self] on in self?.setPinnedLocally(postID, on) },
            send: { _, on in
                try await CommunityAPI().setPinned(postID: postID, pinned: on)
                return nil
            },
            failed: { [weak self] error in self?.actionFailure = error.rollbackMessage }
        )
    }

    /// Опубликовать свой черновик сейчас. Из списка черновиков он уходит.
    @MainActor
    func publishDraft(_ postID: String) async {
        do {
            let published = try await CommunityAPI().publishDraft(postID: postID)
            if let index = posts.firstIndex(where: { $0.id == postID }) {
                if posts[index].isDraft || posts[index].isScheduled {
                    posts.remove(at: index)
                } else {
                    posts[index] = published
                }
            }
        } catch {
            actionFailure = message(for: error)
        }
    }

    /// Комментарий отправили или удалили — счётчик на карточке меняется сразу.
    @MainActor
    func adjustComments(of postID: String, by delta: Int) {
        guard delta != 0, let index = posts.firstIndex(where: { $0.id == postID }) else { return }
        let current = posts[index].commentsCount
        posts[index].counts = PostDTO.Counts(comments: max(0, current + delta))
    }

    /// Пост, только что созданный на этом телефоне.
    @MainActor
    func insert(_ post: PostDTO) {
        posts.removeAll { $0.id == post.id }
        posts.insert(post, at: 0)
        remember([post], readAt: beginRead())
    }

    @MainActor
    func dismissActionFailure() {
        actionFailure = nil
    }

    // MARK: - Внутреннее

    /// Чтение с сервера начинается — отметка для всех движков сразу.
    @MainActor
    private func beginRead() -> FeedReadStamp {
        FeedReadStamp(
            reactions: reactionSync.beginRead(),
            bookmarks: bookmarkSync.beginRead(),
            pins: pinSync.beginRead()
        )
    }

    /// Реакции и закладки с сервера — поверх них то, что человек нажал и что ещё не
    /// решено (или подтверждено уже после начала этого чтения): иначе обновление ленты
    /// посреди запроса возвращало бы снятый лайк на секунду.
    @MainActor
    private func remember(_ items: [PostDTO], readAt stamp: FeedReadStamp) {
        let tracked = Dictionary(grouping: reactionSync.trackedKeys, by: \.postID)
        for post in items {
            var mine = Set(post.myReactions)
            var map = post.reactions
            for key in tracked[post.id] ?? [] {
                let server = mine.contains(key.emoji)
                let shown = reactionSync.resolve(key, server: server, readAt: stamp.reactions)
                guard shown != server else { continue }
                if shown {
                    mine.insert(key.emoji)
                    map[key.emoji] = (map[key.emoji] ?? 0) + 1
                } else {
                    mine.remove(key.emoji)
                    map[key.emoji] = max(0, (map[key.emoji] ?? 0) - 1)
                }
            }
            myReactions[post.id] = mine
            counts[post.id] = map
            let bookmarked = bookmarkSync.resolve(post.id, server: post.bookmarked == true, readAt: stamp.bookmarks)
            setBookmark(post.id, bookmarked)
        }
    }

    @MainActor
    private func resolvePin(_ post: PostDTO, readAt stamp: FeedReadStamp) -> PostDTO {
        let server = post.pinnedAt != nil
        let shown = pinSync.resolve(post.id, server: server, readAt: stamp.pins)
        guard shown != server else { return post }
        var copy = post
        copy.pinnedAt = shown ? Date() : nil
        return copy
    }

    @MainActor
    private func setPinnedLocally(_ postID: String, _ pinned: Bool) {
        guard let index = posts.firstIndex(where: { $0.id == postID }) else { return }
        guard (posts[index].pinnedAt != nil) != pinned else { return }
        posts[index].pinnedAt = pinned ? Date() : nil
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

    /// Показать реакцию. Повторное применение того же состояния ничего не меняет:
    /// движок зовёт его и при откате, и при поправке сервера.
    @MainActor
    private func apply(emoji: String, postID: String, mine: Bool) {
        guard isMine(emoji, in: postID) != mine else { return }
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
    /// Сбой — из-за связи: пустой экран говорит «нет связи», а не «сломалось».
    private(set) var isOffline = false
    /// Сколько комментариев добавилось за время на экране (минус удалённые) — на
    /// столько меняется счётчик на карточке поста в ленте.
    private(set) var countChange = 0
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

    /// Все ответы по корням разом, по порядку внутри корня: экран берёт их одним
    /// проходом, а не `replies(to:)` на каждый корень.
    var repliesByRoot: [String: [PostCommentDTO]] {
        Self.groupReplies(comments)
    }

    /// Ответы по корням: порядок внутри корня — как в `comments`.
    static func groupReplies(_ comments: [PostCommentDTO]) -> [String: [PostCommentDTO]] {
        Dictionary(grouping: comments.filter { $0.parentId != nil }) { $0.parentId ?? "" }
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
            isOffline = false
            // Просмотр засчитывается при открытии поста, как в вебе. Ошибка счётчика
            // человеку ни о чём не говорит. Не ждём его: карточка поста встаёт на экран
            // после `load()`, и лишний запрос показывал сначала одни комментарии, а через
            // миг сверху въезжал пост и сдвигал их.
            Task { [api, postID] in try? await api.markViewed(postID: postID) }
        } catch {
            report(error)
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
            report(error)
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
            countChange += 1
            replyTo = nil
            failure = nil
        } catch {
            // Текст возвращаем в поле: потерять написанное из-за сети нельзя.
            draft = text
            report(error)
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
            countChange -= 1
        } catch {
            comments = snapshot
            report(error)
        }
    }

    @MainActor
    func reportComment(_ comment: PostCommentDTO, reason: String) async -> Bool {
        do {
            try await api.report(.comment, id: comment.id, reason: reason)
            return true
        } catch {
            report(error)
            return false
        }
    }

    @MainActor
    private func report(_ error: Error) {
        failure = error.userMessage
        isOffline = error.isOffline
    }
}

/// Отметки начала чтения ленты для каждого движка.
private struct FeedReadStamp {
    let reactions: OptimisticReadStamp
    let bookmarks: OptimisticReadStamp
    let pins: OptimisticReadStamp
}

/// События и запись на них.
@Observable
final class EventsModel {
    private(set) var events: [EventDTO] = []
    private(set) var registered: Set<String> = []
    private(set) var isLoading = false
    private(set) var failure: String?

    private let api: FeedFetching
    private let registration: OptimisticSync<String, Bool>

    init(api: FeedFetching = FeedAPI(), pacing: OptimisticPacing = .standard) {
        self.api = api
        registration = OptimisticSync(label: "events.register", pacing: pacing)
    }

    @MainActor
    func refresh() async {
        isLoading = true
        defer { isLoading = false }
        let stamp = registration.beginRead()
        do {
            let page = try await api.events(onlyMine: false)
            events = page.items
            registered = Set(page.items.filter { event in
                registration.resolve(event.id, server: event.isRegistered == true, readAt: stamp)
            }.map(\.id))
            failure = nil
        } catch {
            failure = error.userMessage
        }
    }

    func isRegistered(_ id: String) -> Bool { registered.contains(id) }

    /// Запись тоже оптимистична: человек нажал «пойду» и должен увидеть это сразу,
    /// а не через круг ожидания. 409 здесь — «мест нет», это отказ, а не «уже записан»:
    /// откатываем и показываем причину.
    @MainActor
    func toggleRegistration(_ id: String) async {
        let shown = isRegistered(id)
        let api = api
        await registration.set(
            id,
            to: !shown,
            current: shown,
            apply: { [weak self] on in
                if on { self?.registered.insert(id) } else { self?.registered.remove(id) }
            },
            send: { _, on in
                do {
                    try await api.register(eventID: id, on: on)
                } catch where !on && error.isAlreadyApplied(turningOn: false) {}
                return nil
            },
            failed: { [weak self] error in self?.failure = error.userMessage }
        )
    }
}

/// Что «прочитано» оптимистично: одно уведомление или все разом.
enum NotificationReadKey: Hashable, Sendable {
    case item(String)
    case all
}

/// Центр уведомлений.
///
/// «Прочитано» и «прочитать все» меняют строки сразу, без перезагрузки списка. Действие
/// безвредное и идемпотентное: без связи оно не откатывается сразу, а повторяется
/// (`OptimisticRetryPolicy.retry`); не вышло и с повторами — откат и плашка.
/// Настройки каналов здесь больше не грузятся: экран их не показывал, а сбой их запроса
/// ломал весь список (каналы — `NotificationPreferencesModel`).
@Observable
final class NotificationsModel {
    private(set) var items: [NotificationDTO] = []
    private(set) var isLoading = false
    private(set) var failure: String?
    private(set) var isOffline = false
    /// Действие не сохранилось — короткая плашка (`actionToast`), не алерт.
    var actionNotice: String?

    private let api: FeedFetching
    private let readSync: OptimisticSync<NotificationReadKey, Bool>
    /// До какого момента «прочитать все» действует на строки: уведомление, пришедшее
    /// после нажатия, остаётся непрочитанным.
    @ObservationIgnored private var readAllMoment: Date?

    init(api: FeedFetching = FeedAPI(), pacing: OptimisticPacing = .standard) {
        self.api = api
        readSync = OptimisticSync(label: "notifications.read", pacing: pacing)
    }

    var unreadCount: Int { items.filter { !$0.isRead }.count }

    @MainActor
    func refresh() async {
        isLoading = true
        defer { isLoading = false }
        let stamp = readSync.beginRead()
        do {
            let fresh = try await api.notifications(cursor: nil).items
            items = fresh.map { resolveRead($0, readAt: stamp) }
            failure = nil
            isOffline = false
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    @MainActor
    func markRead(_ id: String) async {
        guard let item = items.first(where: { $0.id == id }), !item.isRead else { return }
        let api = api
        await readSync.set(
            .item(id),
            to: true,
            current: false,
            retry: .retry(attempts: 3),
            apply: { [weak self] read in self?.setRead(read, ids: [id]) },
            send: { [weak self] _, _ in
                // Модели нет — экран закрыт или человек вышел из аккаунта: повтор не уходит
                // (с токеном следующего вошедшего он и вовсе был бы чужим).
                guard self != nil else { throw CancellationError() }
                // 404 — уведомления уже нет (удалено, истекло): читать нечего, это не сбой.
                do {
                    try await api.markRead(notificationID: id)
                } catch where error.isAlreadyApplied(turningOn: false) {}
                return nil
            },
            failed: { [weak self] error in self?.actionNotice = error.rollbackMessage }
        )
    }

    @MainActor
    func markAllRead() async {
        let unread = items.filter { !$0.isRead }.map(\.id)
        guard !unread.isEmpty else { return }
        // Часы сервера и телефона расходятся: граница — не раньше самого свежего из
        // показанных, иначе оно осталось бы непрочитанным после обновления.
        let newest = items.map(\.createdAt).max() ?? Date()
        readAllMoment = max(Date(), newest)
        let api = api
        await readSync.set(
            .all,
            to: true,
            current: false,
            retry: .retry(attempts: 3),
            apply: { [weak self] read in
                guard let self else { return }
                if read {
                    self.setRead(true, ids: unread)
                } else {
                    // Откат «всех» не трогает те, что читаются по одному прямо сейчас.
                    self.readAllMoment = nil
                    self.setRead(false, ids: unread.filter { !self.readSync.isPending(.item($0)) })
                }
            },
            send: { [weak self] _, _ in
                guard self != nil else { throw CancellationError() }
                try await api.markAllRead()
                return nil
            },
            failed: { [weak self] error in self?.actionNotice = error.rollbackMessage }
        )
    }

    /// Строка с сервера — поверх неё «прочитано», которое ещё в пути или подтверждено
    /// уже после начала этого чтения.
    @MainActor
    private func resolveRead(_ item: NotificationDTO, readAt stamp: OptimisticReadStamp) -> NotificationDTO {
        guard !item.isRead else { return item }
        var shown = readSync.resolve(.item(item.id), server: false, readAt: stamp)
        if !shown, let moment = readAllMoment, item.createdAt <= moment {
            shown = readSync.resolve(.all, server: false, readAt: stamp)
        }
        guard shown else { return item }
        var copy = item
        copy.isRead = true
        return copy
    }

    @MainActor
    private func setRead(_ read: Bool, ids: [String]) {
        guard !ids.isEmpty else { return }
        let targets = Set(ids)
        var next = items
        var changed = false
        for index in next.indices where targets.contains(next[index].id) && next[index].isRead != read {
            next[index].isRead = read
            changed = true
        }
        if changed { items = next }
    }
}
