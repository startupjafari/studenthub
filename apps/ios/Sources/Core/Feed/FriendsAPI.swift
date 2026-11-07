import Foundation

// Друзья (PROJECT.md, раздел друзей). На главной — только входящие заявки: в вебе они
// живут в боковой колонке, на телефоне — компактной строкой над лентой.

struct FriendRequestDTO: Decodable, Equatable, Identifiable {
    struct User: Decodable, Equatable {
        let id: String
        let firstName: String?
        let lastName: String?
        let avatarUrl: String?

        var name: String {
            [lastName, firstName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
        }
    }

    let friendshipId: String
    let createdAt: Date
    let user: User

    var id: String { friendshipId }
}

protocol FriendsFetching: Sendable {
    func incomingRequests() async throws -> [FriendRequestDTO]
    func accept(friendshipID: String) async throws
    func decline(friendshipID: String) async throws
}

struct FriendsAPI: FriendsFetching {
    private let client: APIClient

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    func incomingRequests() async throws -> [FriendRequestDTO] {
        try await client.page(
            .get(
                "friends/requests",
                query: [
                    URLQueryItem(name: "direction", value: "incoming"),
                    URLQueryItem(name: "limit", value: "10"),
                ]
            ),
            of: FriendRequestDTO.self
        ).items
    }

    func accept(friendshipID: String) async throws {
        try await client.send(.post("friends/requests/\(friendshipID)/accept"))
    }

    /// Отклонение — то же удаление связи, что и «убрать из друзей».
    func decline(friendshipID: String) async throws {
        try await client.send(Endpoint(method: .delete, path: "friends/\(friendshipID)"))
    }
}
