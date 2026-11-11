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
        // Отказ действия — сбой действия (`actionFailure`, алерт), а не ленты: полоса
        // «данные устарели» над свежей лентой солгала бы.
        XCTAssertNotNil(model.actionFailure)
        XCTAssertNil(model.failure)
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

    /// Лента приходит с `reactionSummary` и `_count`, а устаревший `reactions` —
    /// массивом строк: он не должен ронять разбор.
    func testPostDecodesServerShape() throws {
        let json = Data(
            """
            {"id":"p-1","content":"текст","createdAt":"2026-10-24T10:00:00.000Z","author":null,
            "media":[],"reactions":[{"emoji":"👍","userId":"u-1"}],
            "reactionSummary":[{"emoji":"👍","count":2,"mine":true},{"emoji":"🔥","count":1,"mine":false}],
            "_count":{"comments":4}}
            """.utf8
        )

        let post = try JSONCoding.decoder.decode(PostDTO.self, from: json)

        XCTAssertEqual(post.reactions, ["👍": 2, "🔥": 1])
        XCTAssertEqual(post.myReactions, ["👍"])
        XCTAssertEqual(post.commentsCount, 4)
    }

    private func post(id: String, reactions: [String: Int], mine: [String]) -> PostDTO {
        let emojis = Set(reactions.keys).union(mine).sorted()
        return PostDTO(
            id: id, content: "текст", createdAt: Date(), author: nil, media: nil,
            reactionSummary: emojis.map { emoji in
                PostDTO.ReactionSummary(emoji: emoji, count: reactions[emoji] ?? 0, mine: mine.contains(emoji))
            },
            counts: PostDTO.Counts(comments: 0)
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

@MainActor
final class FeedActionsTests: XCTestCase {
    /// Закладка ставится сразу, а отказ сервера её снимает: иначе человек уверен, что
    /// пост сохранён.
    func testFailedBookmarkRollsBack() async {
        let api = StubFeed()
        api.posts = [PostDTO(
            id: "p-1", content: "текст", createdAt: Date(), author: nil, media: nil, reactionSummary: nil,
            counts: nil
        )]
        let model = FeedModel(api: api)
        await model.refresh()
        api.failure = .transport(URLError(.notConnectedToInternet))

        await model.toggleBookmark("p-1")

        XCTAssertFalse(model.isBookmarked("p-1"))
        XCTAssertNotNil(model.actionFailure)
    }

    /// Ответ на ответ уходит на корень: вложенность у сервера одна.
    func testReplyToReplyTargetsRoot() async {
        let api = StubFeed()
        let model = PostCommentsModel(postID: "p-1", api: api)
        model.replyTo = PostCommentDTO(id: "c-2", content: "ответ", createdAt: Date(), author: nil, parentId: "c-1")
        model.draft = "ещё ответ"

        await model.send()

        XCTAssertEqual(model.comments.last?.parentId, "c-1")
        XCTAssertNil(model.replyTo)
    }

    /// Неизвестная наклейка истории не роняет разбор: сервер добавит тип раньше, чем
    /// обновятся телефоны.
    func testUnknownStoryElementIsSkipped() throws {
        let json = Data(
            """
            [{"type":"sticker3d","x":0.2,"y":0.3,"scale":1,"rotation":0},
             {"type":"mention","userId":"u-1","name":"Аян","x":0.5,"y":0.5,"scale":1,"rotation":10}]
            """.utf8
        )

        let elements = try JSONCoding.decoder.decode([StoryElement].self, from: json)

        XCTAssertEqual(elements.first?.kind, .unknown)
        XCTAssertEqual(elements.last?.kind, .mention(userID: "u-1", name: "Аян"))
        XCTAssertEqual(elements.last?.rotation, 10)
    }

    /// Пост ленты разбирает медиа с копиями и HLS, репост и права.
    func testPostDecodesMediaAndRepost() throws {
        let json = Data(
            """
            {"id":"p-2","content":"","createdAt":"2026-11-07T10:00:00.000Z","authorId":"u-1",
            "author":{"id":"u-1","firstName":"Аян","lastName":"Серик","role":"TEACHER","avatarUrl":null},
            "audience":"GROUP","originalPostId":"p-1","original":null,"bookmarked":true,"canDelete":false,
            "media":[{"id":"m-1","mime":"video/mp4","width":1920,"height":1080,"placeholder":null,
            "sources":[],"poster":[{"width":640,"height":360,"url":"https://cdn/p.webp"}],
            "hls":"/api/v1/media/m-1/hls/master.m3u8?t=x","status":"READY","durationMs":12000}],
            "reactionSummary":[],"_count":{"comments":0}}
            """.utf8
        )

        let post = try JSONCoding.decoder.decode(PostDTO.self, from: json)

        XCTAssertTrue(post.isRepost)
        XCTAssertNil(post.original)
        XCTAssertEqual(post.author?.role, "TEACHER")
        XCTAssertEqual(post.media?.first?.isVideo, true)
        XCTAssertEqual(post.media?.first?.aspectRatio, 1920.0 / 1080.0)
        XCTAssertEqual(post.bookmarked, true)
    }
}

private final class StubFeed: FeedFetching, @unchecked Sendable {
    private let lock = NSLock()
    var posts: [PostDTO] = []
    var events: [EventDTO] = []
    var failure: APIError?
    var bookmarkResult = true

    func posts(cursor: String?) async throws -> Page<PostDTO> {
        Page(items: lock.withLock { posts }, meta: nil)
    }
    func post(id: String) async throws -> PostDTO {
        guard let post = lock.withLock({ posts.first { $0.id == id } }) else {
            throw APIError.malformedResponse(statusCode: 404)
        }
        return post
    }
    func comments(postID: String, cursor: String?) async throws -> Page<PostCommentDTO> {
        Page(items: [], meta: nil)
    }
    func comment(postID: String, text: String, parentID: String?) async throws -> PostCommentDTO {
        if let failure = lock.withLock({ failure }) { throw failure }
        return PostCommentDTO(id: "c-1", content: text, createdAt: Date(), author: nil, parentId: parentID)
    }
    func deleteComment(postID: String, commentID: String) async throws {
        if let failure = lock.withLock({ failure }) { throw failure }
    }
    func react(postID: String, emoji: String, on: Bool) async throws {
        if let failure = lock.withLock({ failure }) { throw failure }
    }
    func toggleBookmark(postID: String) async throws -> Bool {
        if let failure = lock.withLock({ failure }) { throw failure }
        return lock.withLock { bookmarkResult }
    }
    func repost(postID: String, note: String?) async throws -> PostDTO {
        if let failure = lock.withLock({ failure }) { throw failure }
        return PostDTO(
            id: "r-1", content: note, createdAt: Date(), author: nil, media: nil, reactionSummary: nil,
            counts: nil, originalPostId: postID
        )
    }
    func editPost(id: String, content: String) async throws -> PostDTO {
        if let failure = lock.withLock({ failure }) { throw failure }
        return PostDTO(
            id: id, content: content, createdAt: Date(), author: nil, media: nil, reactionSummary: nil,
            counts: nil
        )
    }
    func deletePost(id: String) async throws {
        if let failure = lock.withLock({ failure }) { throw failure }
    }
    func markViewed(postID: String) async throws {}
    func createPost(content: String, mediaIDs: [String], targetUserID: String?) async throws -> PostDTO {
        PostDTO(id: "n-1", content: content, createdAt: Date(), author: nil, media: nil, reactionSummary: nil, counts: nil)
    }
    func upload(_ data: Data, mime: String, filename: String, bucket: UploadBucket) async throws -> UploadedFileDTO {
        UploadedFileDTO(id: "f-1", mime: mime)
    }
    func report(_ target: ComplaintTarget, id: String, reason: String) async throws {}
    func upcomingEvents() async throws -> [EventDTO] { lock.withLock { events } }
    func unreadNotifications() async throws -> Int { 0 }
    func search(_ query: String) async throws -> SearchResultsDTO { SearchResultsDTO(people: [], events: []) }
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
        NotificationSettingsDTO(pushEnabled: true, emailEnabled: true)
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
