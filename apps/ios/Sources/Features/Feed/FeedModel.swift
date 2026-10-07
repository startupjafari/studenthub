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
    private(set) var failure: String?
    /// Локальные поправки к реакциям: id поста → эмодзи → моё состояние.
    private(set) var myReactions: [String: Set<String>] = [:]
    private(set) var counts: [String: [String: Int]] = [:]

    private let api: FeedFetching
    private var cursor: String?

    init(api: FeedFetching = FeedAPI()) {
        self.api = api
    }

    @MainActor
    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let page = try await api.posts(cursor: nil)
            posts = page.items
            cursor = page.meta?.hasNext == true ? page.meta?.cursor : nil
            myReactions = Dictionary(
                page.items.map { ($0.id, Set($0.myReactions ?? [])) },
                uniquingKeysWith: { first, _ in first }
            )
            counts = Dictionary(
                page.items.map { ($0.id, $0.reactions ?? [:]) },
                uniquingKeysWith: { first, _ in first }
            )
            failure = nil
        } catch {
            failure = (error as? APIError)?.displayMessage
                ?? String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
        }
    }

    @MainActor
    func loadMore() async {
        guard let cursor, !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let page = try await api.posts(cursor: cursor)
            posts += page.items
            self.cursor = page.meta?.hasNext == true ? page.meta?.cursor : nil
        } catch {
            // Молча: хвост ленты не доехал — это не повод рисовать ошибку поверх
            // того, что человек уже читает.
        }
    }

    func isMine(_ emoji: String, in postID: String) -> Bool {
        myReactions[postID]?.contains(emoji) ?? false
    }

    func count(_ emoji: String, in postID: String) -> Int {
        counts[postID]?[emoji] ?? 0
    }

    @MainActor
    func toggle(_ emoji: String, on postID: String) async {
        let wasMine = isMine(emoji, in: postID)
        apply(emoji: emoji, postID: postID, mine: !wasMine)
        do {
            try await api.react(postID: postID, emoji: emoji, on: !wasMine)
        } catch {
            apply(emoji: emoji, postID: postID, mine: wasMine)
            failure = (error as? APIError)?.displayMessage
                ?? String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
        }
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
@Observable
final class PostCommentsModel {
    private(set) var comments: [PostCommentDTO] = []
    private(set) var isLoading = false
    private(set) var failure: String?
    var draft = ""

    private let api: FeedFetching
    private let postID: String

    init(postID: String, api: FeedFetching = FeedAPI()) {
        self.postID = postID
        self.api = api
    }

    @MainActor
    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            comments = try await api.comments(postID: postID)
            failure = nil
        } catch {
            failure = (error as? APIError)?.displayMessage
                ?? String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
        }
    }

    @MainActor
    func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        do {
            let created = try await api.comment(postID: postID, text: text)
            comments.append(created)
            failure = nil
        } catch {
            // Текст возвращаем в поле: потерять написанное из-за сети нельзя.
            draft = text
            failure = (error as? APIError)?.displayMessage
                ?? String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
        }
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
            failure = (error as? APIError)?.displayMessage
                ?? String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
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
            failure = (error as? APIError)?.displayMessage
                ?? String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
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
            failure = (error as? APIError)?.displayMessage
                ?? String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
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
    func update(push: Bool? = nil, email: Bool? = nil, inApp: Bool? = nil) async {
        let next = NotificationSettingsDTO(
            push: push ?? settings?.push,
            email: email ?? settings?.email,
            inApp: inApp ?? settings?.inApp
        )
        settings = next
        do {
            try await api.updateNotificationSettings(next)
        } catch {
            failure = (error as? APIError)?.displayMessage
                ?? String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
            await refresh()
        }
    }
}
