import Foundation
import Observation

/// Всё, что на главной не лента и не истории: кто я, сколько непрочитанного,
/// ближайшие события и заявки в друзья — то, что в вебе стоит в боковой колонке.
@Observable
final class HomeModel {
    private(set) var profile: UserProfileDTO?
    private(set) var unreadNotifications = 0
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
        async let profile = try? feed.me()
        async let unread = try? feed.unreadNotifications()
        async let events = try? feed.upcomingEvents()
        async let requests = try? friends.incomingRequests()
        if let value = await profile { self.profile = value }
        if let value = await unread { unreadNotifications = value }
        if let value = await events { self.events = value }
        if let value = await requests { friendRequests = value }
    }

    @MainActor
    func refreshUnread() async {
        if let value = try? await feed.unreadNotifications() { unreadNotifications = value }
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
