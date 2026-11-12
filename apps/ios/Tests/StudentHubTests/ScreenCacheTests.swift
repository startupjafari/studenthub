import XCTest

@testable import StudentHub

/// Итерация 5: кеш экранов (stale-while-revalidate) и единый счётчик уведомлений.
final class ScreenCacheKeyTests: XCTestCase {
    /// Порядок параметров не делает ответы разными; пользователь — делает.
    func testKeyIgnoresQueryOrderButNotOwner() {
        let a = ScreenCacheKey(
            owner: "u-1", method: "GET", path: "grades",
            query: [URLQueryItem(name: "b", value: "2"), URLQueryItem(name: "a", value: "1")], language: "ru"
        )
        let b = ScreenCacheKey(
            owner: "u-1", method: "GET", path: "grades",
            query: [URLQueryItem(name: "a", value: "1"), URLQueryItem(name: "b", value: "2")], language: "ru"
        )
        let other = ScreenCacheKey(owner: "u-2", method: "GET", path: "grades", query: [], language: "ru")

        XCTAssertEqual(a, b)
        XCTAssertEqual(a.fileName, b.fileName)
        XCTAssertNotEqual(other.fileName, a.fileName)
        XCTAssertFalse(a.fileName.contains("u-1"), "в имени файла нет id человека")
    }

    /// Значение с «&» не склеивается с соседним параметром в чужой ключ.
    func testQueryValuesAreEscaped() {
        let joined = ScreenCacheKey(
            owner: "u-1", method: "GET", path: "search", query: [URLQueryItem(name: "q", value: "a&b=1")], language: "ru"
        )
        let split = ScreenCacheKey(
            owner: "u-1", method: "GET", path: "search",
            query: [URLQueryItem(name: "q", value: "a"), URLQueryItem(name: "b", value: "1")], language: "ru"
        )

        XCTAssertNotEqual(joined, split)
    }

    func testSensitiveRoutesAreNotCached() {
        XCTAssertTrue(ScreenCache.allows(path: "grades", query: []))
        XCTAssertTrue(ScreenCache.allows(path: "users/me", query: []))
        XCTAssertFalse(ScreenCache.allows(path: "auth/refresh", query: []))
        XCTAssertFalse(ScreenCache.allows(path: "security/visitors", query: []))
        XCTAssertFalse(ScreenCache.allows(path: "cameras", query: []))
        XCTAssertFalse(ScreenCache.allows(path: "invites/abc", query: []))
        XCTAssertFalse(ScreenCache.allows(path: "documents/d-1/download", query: []))
        XCTAssertFalse(ScreenCache.allows(path: "events/e-1/meeting", query: []))
        XCTAssertFalse(ScreenCache.allows(path: "notifications/unread-count", query: []))
        XCTAssertFalse(ScreenCache.allows(path: "chats", query: []))
        XCTAssertFalse(ScreenCache.allows(path: "media/m-1", query: [URLQueryItem(name: "t", value: "secret")]))
    }
}

final class ScreenCacheStoreTests: XCTestCase {
    private var root = FileManager.default.temporaryDirectory

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appending(path: "screen-cache-\(UUID().uuidString)")
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    private func key(_ owner: String = "u-1", path: String = "grades") -> ScreenCacheKey {
        ScreenCacheKey(owner: owner, method: "GET", path: path, query: [], language: "ru")
    }

    func testStoredResponseIsReadBack() async {
        let store = ScreenCacheStore(root: root, build: "1", isLocked: { false })
        store.claim(owner: "u-1")

        store.store(Data("ответ".utf8), for: key(), generation: store.generation)
        await store.flush()
        // Новый экземпляр — без памяти: читает с диска, как после перезапуска.
        let reopened = ScreenCacheStore(root: root, build: "1", isLocked: { false })
        reopened.claim(owner: "u-1")

        let data = await reopened.data(for: key())
        XCTAssertEqual(data, Data("ответ".utf8))
    }

    /// Ключ ответа — чужой: не читается, даже если файл есть.
    func testOtherOwnerNeverSeesData() async {
        let store = ScreenCacheStore(root: root, build: "1", isLocked: { false })
        store.claim(owner: "u-1")
        store.store(Data("u-1".utf8), for: key("u-1"), generation: store.generation)
        await store.flush()

        store.claim(owner: "u-2")
        await store.flush()

        let mine = await store.data(for: key("u-1"))
        XCTAssertNil(mine, "сменился владелец — прежнее стёрто и не читается")
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.path()))
    }

    /// Запись, начатая до выхода, в кеш следующего не попадает.
    func testWriteFromPreviousGenerationIsDropped() async {
        let store = ScreenCacheStore(root: root, build: "1", isLocked: { false })
        store.claim(owner: "u-1")
        let started = store.generation

        store.erase()
        store.claim(owner: "u-1")
        store.store(Data("старое".utf8), for: key(), generation: started)
        await store.flush()

        let data = await store.data(for: key())
        XCTAssertNil(data)
    }

    func testExpiredEntryIsAMiss() async {
        let clock = TestClock(Date())
        let store = ScreenCacheStore(
            root: root, build: "1", limits: .standard, isLocked: { false }, now: { clock.now }
        )
        store.claim(owner: "u-1")
        store.store(Data("вчера".utf8), for: key(), generation: store.generation)
        await store.flush()
        let reopened = ScreenCacheStore(
            root: root, build: "1", limits: .standard, isLocked: { false },
            now: { clock.now.addingTimeInterval(8 * 24 * 60 * 60) }
        )
        reopened.claim(owner: "u-1")

        let data = await reopened.data(for: key())
        XCTAssertNil(data, "старше недели — не показываем")
    }

    /// До первой разблокировки файл не пишется (и пытаться незачем), ошибок нет.
    func testLockedDeviceWritesNothing() async {
        let store = ScreenCacheStore(root: root, build: "1", isLocked: { true })
        store.claim(owner: "u-1")

        store.store(Data("x".utf8), for: key(), generation: store.generation)
        await store.flush()

        XCTAssertFalse(FileManager.default.fileExists(atPath: root.path()))
    }

    /// Файл не читается — промах, и файл остаётся на месте: ошибка чтения не повод
    /// стирать (до первой разблокировки так выглядит любой файл).
    func testUnreadableFileIsAMissAndIsKept() async throws {
        let store = ScreenCacheStore(root: root, build: "1", isLocked: { false })
        store.claim(owner: "u-1")
        store.store(Data("x".utf8), for: key(), generation: store.generation)
        await store.flush()
        let file = root.appending(path: "v\(ScreenCacheStore.schemaVersion)-1").appending(path: key().fileName)
        try FileManager.default.setAttributes([.posixPermissions: 0], ofItemAtPath: file.path())
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: file.path()) }
        let reopened = ScreenCacheStore(root: root, build: "1", isLocked: { false })
        reopened.claim(owner: "u-1")

        let data = await reopened.data(for: key())

        XCTAssertNil(data)
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path()))
    }

    /// Сверх лимита — самые давние записи уходят.
    func testTrimRemovesOldestOverLimit() async {
        let limits = ScreenCacheStore.Limits(maxBytes: 2_500, trimTo: 1_500, maxAge: 3_600, maxEntryBytes: 10_000)
        let clock = TestClock(Date())
        let store = ScreenCacheStore(root: root, build: "1", limits: limits, isLocked: { false }, now: { clock.now })
        store.claim(owner: "u-1")
        for index in 0..<3 {
            store.store(Data(repeating: 1, count: 1_000), for: key(path: "p\(index)"), generation: store.generation)
            await store.flush()
            // Разные даты записи — порядок вытеснения однозначный.
            let file = root.appending(path: "v\(ScreenCacheStore.schemaVersion)-1").appending(path: key(path: "p\(index)").fileName)
            try? FileManager.default.setAttributes(
                [.modificationDate: clock.now.addingTimeInterval(Double(index - 3))],
                ofItemAtPath: file.path()
            )
        }

        store.housekeeping()
        await store.flush()
        let reopened = ScreenCacheStore(root: root, build: "1", limits: limits, isLocked: { false }, now: { clock.now })
        reopened.claim(owner: "u-1")

        let oldest = await reopened.data(for: key(path: "p0"))
        let newest = await reopened.data(for: key(path: "p2"))
        XCTAssertNil(oldest)
        XCTAssertNotNil(newest)
    }

    /// Новая сборка начинает с чистого каталога: модель, поменявшаяся в ней, не
    /// встретит ответ старого формата.
    func testOtherBuildsAreIgnoredAndPurged() async {
        let old = ScreenCacheStore(root: root, build: "1", isLocked: { false })
        old.claim(owner: "u-1")
        old.store(Data("старый формат".utf8), for: key(), generation: old.generation)
        await old.flush()

        let new = ScreenCacheStore(root: root, build: "2", isLocked: { false })
        new.claim(owner: "u-1")
        let data = await new.data(for: key())
        new.housekeeping()
        await new.flush()

        XCTAssertNil(data)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appending(path: "v\(ScreenCacheStore.schemaVersion)-1").path()))
    }
}

/// Путь целиком: клиент API в скобках `ScreenCache` — сохраняет, а потом отдаёт без сети.
final class ScreenCacheClientTests: XCTestCase {
    private struct Thing: Decodable, Equatable {
        let value: Int
    }

    private var root = FileManager.default.temporaryDirectory

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appending(path: "screen-cache-\(UUID().uuidString)")
        StubURLProtocol.reset()
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
        StubURLProtocol.reset()
    }

    private func client(_ store: ScreenCacheStore) throws -> APIClient {
        APIClient(
            baseURL: try XCTUnwrap(URL(string: "https://example.test/api/v1")),
            session: StubURLProtocol.session,
            maxRetries: 0,
            cookieJar: nil,
            screenCache: store
        )
    }

    func testCachedReadNeedsNoNetwork() async throws {
        let store = ScreenCacheStore(root: root, build: "1", isLocked: { false })
        store.claim(owner: "u-1")
        let client = try client(store)
        StubURLProtocol.respond(status: 200, body: #"{"data":{"value":7}}"#)

        let fresh = try await ScreenCache.refreshing(store: store) { try await client.send(.get("things"), as: Thing.self) }
        await store.flush()
        StubURLProtocol.respond(status: 500, body: "{}")
        let before = StubURLProtocol.requestCount
        let cached = await ScreenCache.cached(store: store) { try await client.send(.get("things"), as: Thing.self) }

        XCTAssertEqual(fresh, Thing(value: 7))
        XCTAssertEqual(cached, Thing(value: 7))
        XCTAssertEqual(StubURLProtocol.requestCount, before, "сохранённое — без сети")
    }

    /// В режиме «только сохранённое» запись не уходит в сеть и не кешируется.
    func testCachedModeNeverWritesToNetwork() async throws {
        let store = ScreenCacheStore(root: root, build: "1", isLocked: { false })
        store.claim(owner: "u-1")
        let client = try client(store)
        StubURLProtocol.respond(status: 200, body: #"{"data":{"value":1}}"#)

        let value = await ScreenCache.cached(store: store) {
            try await client.send(Endpoint(method: .post, path: "things"), as: Thing.self)
        }

        XCTAssertNil(value)
        XCTAssertEqual(StubURLProtocol.requestCount, 0)
    }

    /// Вне скобок кеша клиент ничего не сохраняет, как и раньше.
    func testOutsideScopeNothingIsStored() async throws {
        let store = ScreenCacheStore(root: root, build: "1", isLocked: { false })
        store.claim(owner: "u-1")
        let client = try client(store)
        StubURLProtocol.respond(status: 200, body: #"{"data":{"value":3}}"#)

        _ = try await client.send(.get("things"), as: Thing.self)
        await store.flush()
        let cached = await ScreenCache.cached(store: store) { try await client.send(.get("things"), as: Thing.self) }

        XCTAssertNil(cached)
    }

    /// Никто не вошёл — кеш не читается и не пишется вовсе.
    func testNoOwnerNoCache() async throws {
        let store = ScreenCacheStore(root: root, build: "1", isLocked: { false })
        let client = try client(store)
        StubURLProtocol.respond(status: 200, body: #"{"data":{"value":5}}"#)

        _ = try await ScreenCache.refreshing(store: store) { try await client.send(.get("things"), as: Thing.self) }
        await store.flush()

        XCTAssertFalse(FileManager.default.fileExists(atPath: root.path()))
    }

    /// Ответ, который не разбирается новой моделью, — промах, а не падение.
    func testUndecodableCachedResponseIsAMiss() async throws {
        let store = ScreenCacheStore(root: root, build: "1", isLocked: { false })
        store.claim(owner: "u-1")
        let client = try client(store)
        StubURLProtocol.respond(status: 200, body: #"{"data":{"другое":true}}"#)
        _ = try? await ScreenCache.refreshing(store: store) { try await client.send(.get("things"), as: [String: Bool].self) }
        await store.flush()

        let cached = await ScreenCache.cached(store: store) { try await client.send(.get("things"), as: Thing.self) }

        XCTAssertNil(cached)
    }
}

@MainActor
final class UnreadNotificationsCounterTests: XCTestCase {
    /// Колокольчик, догон по пушу и экран спросили разом — запрос один.
    func testConcurrentRefreshesShareOneRequest() async {
        let server = CountingFetch(value: 4)
        let counter = UnreadNotificationsCounter(fetch: { try await server.fetch() }, setBadge: { _ in })

        async let first = counter.refresh(maxAge: 0)
        async let second = counter.refresh(maxAge: 0)
        let results = await (first, second)

        XCTAssertEqual(results.0, 4)
        XCTAssertEqual(results.1, 4)
        let calls = await server.calls
        XCTAssertEqual(calls, 1)
    }

    func testFreshValueIsNotRefetched() async {
        let server = CountingFetch(value: 2)
        let counter = UnreadNotificationsCounter(fetch: { try await server.fetch() }, setBadge: { _ in })

        await counter.refresh(maxAge: 15)
        await counter.refresh(maxAge: 15)

        let calls = await server.calls
        XCTAssertEqual(calls, 1)
    }

    /// Прочитали на экране — число меняется сразу, бейдж следом.
    func testAdjustChangesCountImmediately() async {
        let badges = BadgeLog()
        let counter = UnreadNotificationsCounter(fetch: { 3 }, setBadge: { await badges.append($0) })
        await counter.refresh(maxAge: 0)

        counter.adjust(by: -2)

        XCTAssertEqual(counter.count, 1)
        await waitUntil { badges.last == 1 }
    }

    /// Своё поправленное число — свежее: колокольчик сразу после «прочитано» не
    /// спрашивает сервер, который мог его ещё не получить.
    func testAdjustedCountIsNotRefetchedRightAway() async {
        let server = CountingFetch(value: 3)
        let counter = UnreadNotificationsCounter(fetch: { try await server.fetch() }, setBadge: { _ in })
        await counter.refresh(maxAge: 0)

        counter.adjust(by: -1)
        let shown = await counter.refresh(maxAge: 15)

        XCTAssertEqual(shown, 2)
        let calls = await server.calls
        XCTAssertEqual(calls, 1)
    }

    /// Выход: число прежнего человека не возвращается запоздавшим ответом.
    func testResetDropsInFlightAnswer() async {
        let gate = Gate()
        let counter = UnreadNotificationsCounter(fetch: { await gate.wait(); return 9 }, setBadge: { _ in })

        let refresh = Task { await counter.refresh(maxAge: 0) }
        await waitUntil { gate.isWaiting }
        counter.reset()
        gate.open()
        _ = await refresh.value

        XCTAssertNil(counter.count)
    }
}

// MARK: - Помощники

private final class TestClock: @unchecked Sendable {
    let now: Date
    init(_ now: Date) { self.now = now }
}

private actor CountingFetch {
    private(set) var calls = 0
    let value: Int

    init(value: Int) { self.value = value }

    func fetch() async throws -> Int {
        calls += 1
        try await Task.sleep(for: .milliseconds(20))
        return value
    }
}

@MainActor
private final class BadgeLog {
    private(set) var values: [Int] = []
    var last: Int? { values.last }
    func append(_ value: Int) { values.append(value) }
}

/// Запрос, который ждёт, пока тест его отпустит.
private final class Gate: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Void, Never>?
    private var opened = false

    var isWaiting: Bool { lock.withLock { continuation != nil } }

    func wait() async {
        await withCheckedContinuation { continuation in
            let resumeNow = lock.withLock { () -> Bool in
                if opened { return true }
                self.continuation = continuation
                return false
            }
            if resumeNow { continuation.resume() }
        }
    }

    func open() {
        let waiting = lock.withLock { () -> CheckedContinuation<Void, Never>? in
            opened = true
            defer { continuation = nil }
            return continuation
        }
        waiting?.resume()
    }
}

/// Сеть для тестов клиента: один заготовленный ответ на всё и счётчик запросов.
final class StubURLProtocol: URLProtocol {
    /// Общее состояние заглушки — под замком: `URLProtocol` зовётся с потоков сети.
    private final class State: @unchecked Sendable {
        let lock = NSLock()
        var status = 200
        var body = Data()
        var count = 0
    }

    private static let state = State()

    static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        return URLSession(configuration: configuration)
    }()

    static var requestCount: Int { state.lock.withLock { state.count } }

    static func respond(status: Int, body: String) {
        state.lock.withLock {
            state.status = status
            state.body = Data(body.utf8)
        }
    }

    static func reset() {
        state.lock.withLock {
            state.status = 200
            state.body = Data()
            state.count = 0
        }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let state = Self.state
        let (status, body) = state.lock.withLock { () -> (Int, Data) in
            state.count += 1
            return (state.status, state.body)
        }
        guard
            let url = request.url,
            let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)
        else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
