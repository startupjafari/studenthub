import Foundation
import Observation

/// Боковая колонка веба: ближайшие события — для «Главной»,
/// заявки в друзья — для ленты (свой профиль — у оболочки, `ViewerProfileModel`).
@MainActor
@Observable
final class HomeModel {
    private(set) var events: [EventDTO] = []
    private(set) var friendRequests: [FriendRequestDTO] = []
    private(set) var actionFailure: String?

    private let feed: FeedFetching
    private let friends: FriendsFetching

    init(feed: FeedFetching = FeedAPI(), friends: FriendsFetching = FriendsAPI()) {
        self.feed = feed
        self.friends = friends
    }

    /// Блоки независимы: упал один — остальные показываются. Поэтому каждый запрос
    /// со своим `try?`, а не общий `throws` на весь экран.
    @MainActor
    func refresh() async {
        async let events = try? feed.upcomingEvents()
        async let requests = try? friends.incomingRequests()
        if let value = await events { self.events = value }
        if let value = await requests { friendRequests = value }
    }

    /// События — для «Главной»: заявки в друзья живут в ленте. Счётчик колокольчика
    /// сюда больше не грузится: его никто не читал, а колокольчик берёт свой.
    @MainActor
    func refreshSummary() async {
        let feed = feed
        if let value = try? await ScreenCache.refreshing({ try await feed.upcomingEvents() }) { self.events = value }
    }

    /// Сохранённые события — для первого кадра «Главной», без сети (кеш экранов, п. 25).
    @MainActor
    func showCachedSummary() async {
        guard events.isEmpty else { return }
        let feed = feed
        if let value = await ScreenCache.cached({ try await feed.upcomingEvents() }), events.isEmpty {
            events = value
        }
    }

    /// Только заявки в друзья — для ленты: события и колокольчик живут на «Главной».
    @MainActor
    func refreshFriendRequests() async {
        if let value = try? await friends.incomingRequests() { friendRequests = value }
    }

    @MainActor
    func accept(_ request: FriendRequestDTO) async {
        await answer(request) { try await friends.accept(friendshipID: request.friendshipId) }
    }

    @MainActor
    func decline(_ request: FriendRequestDTO) async {
        await answer(request) { try await friends.decline(friendshipID: request.friendshipId) }
    }

    @MainActor
    func dismissActionFailure() {
        actionFailure = nil
    }

    /// Заявка уходит из списка сразу; отказ сервера возвращает её на место.
    @MainActor
    private func answer(_ request: FriendRequestDTO, _ call: () async throws -> Void) async {
        let snapshot = friendRequests
        friendRequests.removeAll { $0.id == request.id }
        do {
            try await call()
        } catch {
            friendRequests = snapshot
            actionFailure = error.userMessage
        }
    }
}
