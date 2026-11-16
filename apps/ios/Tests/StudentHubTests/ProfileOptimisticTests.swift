import XCTest

@testable import StudentHub

/// Итерация 3: дружба и голос в опросе в профиле — сразу на экране, откат при отказе.
@MainActor
final class ProfileOptimisticTests: XCTestCase {
    /// Голос пересчитывает доли на месте так же, как сервер: +1 выбранным, −1 снятым.
    func testApplyingVoteRecountsLocally() {
        let poll = poll(myVotes: [], votes: ["a": 2, "b": 1])

        let voted = poll.applyingVote(["b"])

        XCTAssertEqual(voted.myVotes, ["b"])
        XCTAssertEqual(voted.options.first { $0.id == "b" }?.votes, 2)
        XCTAssertEqual(voted.totalVotes, 4)
        XCTAssertEqual(voted.participants, 4)

        let undone = voted.applyingVote([])
        XCTAssertEqual(undone, poll, "откат возвращает опрос как был")
    }

    func testFriendRequestIsImmediate() async {
        let content = StubProfileContent(status: FriendshipStatusDTO(status: "NONE", friendshipId: nil))
        let model = ProfileModel(userID: "u-2", feed: StubProfileFeed(), content: content, pacing: .immediate)
        await model.load()
        content.holds = true

        let task = Task { await model.friendshipAction() }
        await waitUntil { content.heldCount == 1 }

        XCTAssertEqual(model.friendship?.status, "PENDING_OUTGOING", "до ответа сервера")
        content.serverStatus = FriendshipStatusDTO(status: "PENDING_OUTGOING", friendshipId: "f-1")
        content.release()
        await task.value

        XCTAssertEqual(model.friendship?.status, "PENDING_OUTGOING")
        XCTAssertEqual(model.friendship?.friendshipId, "f-1")
        XCTAssertEqual(content.requests, 1)
    }

    /// Повтор заявки, которую сервер уже принял (409), — не ошибка и не дубль.
    func testRepeatedFriendRequestConflictIsSuccess() async {
        let content = StubProfileContent(status: FriendshipStatusDTO(status: "NONE", friendshipId: nil))
        let model = ProfileModel(userID: "u-2", feed: StubProfileFeed(), content: content, pacing: .immediate)
        await model.load()
        content.requestFailure = .server(code: .conflict, message: "Уже отправлена", details: [], statusCode: 409)
        content.serverStatus = FriendshipStatusDTO(status: "PENDING_OUTGOING", friendshipId: "f-1")

        await model.friendshipAction()

        XCTAssertEqual(model.friendship?.status, "PENDING_OUTGOING")
        XCTAssertNil(model.actionFailure)
    }

    /// 409 «недавно отклонили» — тот же код, но заявки на сервере нет: это отказ, а не
    /// «уже отправлена».
    func testCooldownConflictRollsBack() async {
        let content = StubProfileContent(status: FriendshipStatusDTO(status: "NONE", friendshipId: nil))
        let model = ProfileModel(userID: "u-2", feed: StubProfileFeed(), content: content, pacing: .immediate)
        await model.load()
        content.requestFailure = .server(code: .conflict, message: "Недавно отклонили", details: [], statusCode: 409)

        await model.friendshipAction()

        XCTAssertEqual(model.friendship?.status, "NONE")
        XCTAssertNotNil(model.actionFailure)
    }

    func testRejectedFriendRequestRollsBack() async {
        let content = StubProfileContent(status: FriendshipStatusDTO(status: "NONE", friendshipId: nil))
        let model = ProfileModel(userID: "u-2", feed: StubProfileFeed(), content: content, pacing: .immediate)
        await model.load()
        content.requestFailure = .server(code: .forbidden, message: "Нельзя", details: [], statusCode: 403)

        await model.friendshipAction()

        XCTAssertEqual(model.friendship?.status, "NONE")
        XCTAssertNotNil(model.actionFailure)
    }

    private func poll(myVotes: [String], votes: [String: Int]) -> ProfilePollDTO {
        let options = votes.keys.sorted().map { ProfilePollDTO.Option(id: $0, text: $0, votes: votes[$0] ?? 0) }
        let total = votes.values.reduce(0, +)
        return ProfilePollDTO(
            id: "poll-1", question: "?", multiple: false, closed: false, options: options, totalVotes: total,
            participants: total, myVotes: myVotes, canSeeResults: true, canVote: true, createdAt: Date(timeIntervalSince1970: 0)
        )
    }
}

private final class StubProfileContent: ProfileContentFetching, @unchecked Sendable {
    private let lock = NSLock()
    private var _serverStatus: FriendshipStatusDTO
    private var _requestFailure: APIError?
    private var _requests = 0
    private var _holds = false
    private var held: [CheckedContinuation<Void, Never>] = []

    init(status: FriendshipStatusDTO) {
        _serverStatus = status
    }

    var serverStatus: FriendshipStatusDTO {
        get { lock.withLock { _serverStatus } }
        set { lock.withLock { _serverStatus = newValue } }
    }

    var requestFailure: APIError? {
        get { lock.withLock { _requestFailure } }
        set { lock.withLock { _requestFailure = newValue } }
    }

    var holds: Bool {
        get { lock.withLock { _holds } }
        set { lock.withLock { _holds = newValue } }
    }

    var requests: Int { lock.withLock { _requests } }
    var heldCount: Int { lock.withLock { held.count } }

    func release() {
        let waiting = lock.withLock { () -> [CheckedContinuation<Void, Never>] in
            defer { held = [] }
            return held
        }
        waiting.forEach { $0.resume() }
    }

    func counts(userID: String) async throws -> ProfileCountsDTO {
        ProfileCountsDTO(photos: 0, videos: 0, articles: 0, polls: 0)
    }
    func media(userID: String) async throws -> [ProfileMediaDTO] { [] }
    func articles(userID: String) async throws -> [ArticleCardDTO] { [] }
    func polls(userID: String) async throws -> [ProfilePollDTO] { [] }
    func vote(pollID: String, optionIDs: [String]) async throws {}
    func friendship(with userID: String) async throws -> FriendshipStatusDTO { serverStatus }
    func friendsCount() async throws -> Int { 0 }
    func requestFriendship(with userID: String) async throws {
        let hold = lock.withLock { () -> Bool in
            _requests += 1
            return _holds
        }
        if hold {
            await withCheckedContinuation { continuation in
                lock.withLock { held.append(continuation) }
            }
        }
        if let failure = requestFailure { throw failure }
    }
    func acceptFriendship(id: String) async throws {}
    func removeFriendship(id: String) async throws {}
}

private struct StubProfileFeed: FeedFetching {
    func posts(cursor: String?) async throws -> Page<PostDTO> { Page(items: [], meta: nil) }
    func post(id: String) async throws -> PostDTO { throw APIError.malformedResponse(statusCode: 404) }
    func comments(postID: String, cursor: String?) async throws -> Page<PostCommentDTO> { Page(items: [], meta: nil) }
    func comment(postID: String, text: String, parentID: String?) async throws -> PostCommentDTO {
        throw APIError.malformedResponse(statusCode: 500)
    }
    func deleteComment(postID: String, commentID: String) async throws {}
    func react(postID: String, emoji: String, on: Bool) async throws {}
    func toggleBookmark(postID: String) async throws -> Bool { false }
    func repost(postID: String, note: String?) async throws -> PostDTO { throw APIError.malformedResponse(statusCode: 500) }
    func editPost(id: String, content: String) async throws -> PostDTO { throw APIError.malformedResponse(statusCode: 500) }
    func deletePost(id: String) async throws {}
    func markViewed(postID: String) async throws {}
    func createPost(content: String, mediaIDs: [String], targetUserID: String?) async throws -> PostDTO {
        throw APIError.malformedResponse(statusCode: 500)
    }
    func upload(_ data: Data, mime: String, filename: String, bucket: UploadBucket) async throws -> UploadedFileDTO {
        throw APIError.malformedResponse(statusCode: 500)
    }
    func report(_ target: ComplaintTarget, id: String, reason: String) async throws {}
    func upcomingEvents() async throws -> [EventDTO] { [] }
    func unreadNotifications() async throws -> Int { 0 }
    func search(_ query: String) async throws -> SearchResultsDTO { SearchResultsDTO(people: [], events: []) }
    func events(onlyMine: Bool) async throws -> Page<EventDTO> { Page(items: [], meta: nil) }
    func register(eventID: String, on: Bool) async throws {}
    func notifications(cursor: String?) async throws -> Page<NotificationDTO> { Page(items: [], meta: nil) }
    func markRead(notificationID: String) async throws {}
    func markAllRead() async throws {}
    func notificationSettings() async throws -> NotificationSettingsDTO {
        NotificationSettingsDTO(pushEnabled: true, emailEnabled: true)
    }
    func updateNotificationSettings(_ settings: NotificationSettingsDTO) async throws {}
    func me() async throws -> UserProfileDTO { try await user(id: "u-1") }
    func user(id: String) async throws -> UserProfileDTO {
        UserProfileDTO(
            id: id, firstName: "Аян", lastName: "Серик", email: nil, username: nil,
            avatarUrl: nil, bio: nil, role: nil, groupName: nil, facultyName: nil
        )
    }
    func updateProfile(firstName: String, lastName: String, bio: String?) async throws {}
    func uploadAvatar(_ data: Data, mime: String) async throws {}
}
