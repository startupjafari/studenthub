import XCTest

@testable import StudentHub

@MainActor
final class FeedModelTests: XCTestCase {
    /// Реакция ставится оптимистично: палец убрал — цифра изменилась. Ждать сеть
    /// ради лайка человек не станет.
    func testReactionAppliesImmediately() async {
        let api = StubFeed()
        api.posts = [post(id: "p-1", reactions: ["👍": 2], mine: [])]
        let model = FeedModel(api: api)
        await model.refresh()

        await model.toggle("👍", on: "p-1")

        XCTAssertTrue(model.isMine("👍", in: "p-1"))
        XCTAssertEqual(model.count("👍", in: "p-1"), 3)
    }

    /// Отказ сервера откатывает: иначе человек уверен, что поставил лайк, а его нет.
    func testFailedReactionRollsBack() async {
        let api = StubFeed()
        api.posts = [post(id: "p-1", reactions: ["👍": 2], mine: [])]
        api.failure = .server(code: .forbidden, message: "Нельзя", details: [], statusCode: 403)
        let model = FeedModel(api: api)
        await model.refresh()

        await model.toggle("👍", on: "p-1")

        XCTAssertFalse(model.isMine("👍", in: "p-1"))
        XCTAssertEqual(model.count("👍", in: "p-1"), 2)
        XCTAssertNotNil(model.failure)
    }

    /// Снятие своей реакции уменьшает счётчик, но не уводит его в минус.
    func testRemovingReactionNeverGoesBelowZero() async {
        let api = StubFeed()
        api.posts = [post(id: "p-1", reactions: [:], mine: ["🔥"])]
        let model = FeedModel(api: api)
        await model.refresh()

        await model.toggle("🔥", on: "p-1")

        XCTAssertFalse(model.isMine("🔥", in: "p-1"))
        XCTAssertEqual(model.count("🔥", in: "p-1"), 0)
    }

    private func post(id: String, reactions: [String: Int], mine: [String]) -> PostDTO {
        PostDTO(
            id: id, content: "текст", createdAt: Date(), author: nil, media: nil,
            commentsCount: 0, reactions: reactions, myReactions: mine
        )
    }
}

@MainActor
final class EventsModelTests: XCTestCase {
    /// «Пойду» должно отмечаться сразу: это решение, а не запрос.
    func testRegistrationIsOptimistic() async {
        let api = StubFeed()
        api.events = [event(id: "e-1", registered: false)]
        let model = EventsModel(api: api)
        await model.refresh()

        await model.toggleRegistration("e-1")

        XCTAssertTrue(model.isRegistered("e-1"))
    }

    func testFailedRegistrationRollsBack() async {
        let api = StubFeed()
        api.events = [event(id: "e-1", registered: false)]
        api.failure = .server(code: .conflict, message: "Мест нет", details: [], statusCode: 409)
        let model = EventsModel(api: api)
        await model.refresh()

        await model.toggleRegistration("e-1")

        XCTAssertFalse(model.isRegistered("e-1"))
        XCTAssertNotNil(model.failure)
    }

    private func event(id: String, registered: Bool) -> EventDTO {
        EventDTO(
            id: id, title: "Встреча", description: nil, startsAt: Date(), endsAt: nil,
            location: "Актовый зал", isRegistered: registered, participantsCount: 10
        )
    }
}

@MainActor
final class PostCommentsModelTests: XCTestCase {
    /// Неотправленный комментарий возвращается в поле: потерять написанное из-за
    /// сети нельзя.
    func testFailedCommentReturnsTextToTheField() async {
        let api = StubFeed()
        api.failure = .transport(URLError(.notConnectedToInternet))
        let model = PostCommentsModel(postID: "p-1", api: api)
        model.draft = "мысль"

        await model.send()

        XCTAssertEqual(model.draft, "мысль")
        XCTAssertTrue(model.comments.isEmpty)
    }
}

private final class StubFeed: FeedFetching, @unchecked Sendable {
    private let lock = NSLock()
    var posts: [PostDTO] = []
    var events: [EventDTO] = []
    var failure: APIError?

    func posts(cursor: String?) async throws -> Page<PostDTO> {
        Page(items: lock.withLock { posts }, meta: nil)
    }
    func comments(postID: String) async throws -> [PostCommentDTO] { [] }
    func comment(postID: String, text: String) async throws -> PostCommentDTO {
        if let failure = lock.withLock({ failure }) { throw failure }
        return PostCommentDTO(id: "c-1", content: text, createdAt: Date(), author: nil)
    }
    func react(postID: String, emoji: String, on: Bool) async throws {
        if let failure = lock.withLock({ failure }) { throw failure }
    }
    func events(onlyMine: Bool) async throws -> Page<EventDTO> {
        Page(items: lock.withLock { events }, meta: nil)
    }
    func register(eventID: String, on: Bool) async throws {
        if let failure = lock.withLock({ failure }) { throw failure }
    }
    func notifications(cursor: String?) async throws -> Page<NotificationDTO> { Page(items: [], meta: nil) }
    func markRead(notificationID: String) async throws {}
    func markAllRead() async throws {}
    func notificationSettings() async throws -> NotificationSettingsDTO {
        NotificationSettingsDTO(push: true, email: true, inApp: true)
    }
    func updateNotificationSettings(_ settings: NotificationSettingsDTO) async throws {}
    func me() async throws -> UserProfileDTO {
        UserProfileDTO(
            id: "u-1", firstName: "Аян", lastName: "Серик", email: nil, username: nil,
            avatarUrl: nil, bio: nil, role: nil, groupName: nil, facultyName: nil
        )
    }
    func user(id: String) async throws -> UserProfileDTO { try await me() }
    func updateProfile(firstName: String, lastName: String, bio: String?) async throws {}
    func uploadAvatar(_ data: Data, mime: String) async throws {}
}
