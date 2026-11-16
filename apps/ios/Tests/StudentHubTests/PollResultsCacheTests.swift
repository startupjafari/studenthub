import XCTest

@testable import StudentHub

/// Результаты опроса: дроссель при появлении и один запрос на опрос (IOS_RULES 9.8.22).
@MainActor
final class PollResultsCacheTests: XCTestCase {
    private final class Counter: @unchecked Sendable {
        var calls = 0
    }

    private nonisolated static func results(_ id: String, votes: Int) -> PollResultsDTO {
        PollResultsDTO(
            id: id, anonymous: false, multiple: false, allowRevote: true, closed: false,
            totalVotes: votes, options: [], myOptionIds: []
        )
    }

    func testReappearingCellDoesNotRefetchWithinInterval() async {
        var now = Date(timeIntervalSince1970: 1_000)
        let cache = PollResultsCache(now: { now })
        let counter = Counter()
        let fetch: @Sendable () async throws -> PollResultsDTO = {
            counter.calls += 1
            return Self.results("p-1", votes: 1)
        }

        _ = await cache.load("p-1", version: 0, fetch: fetch)
        _ = await cache.load("p-1", version: 0, fetch: fetch)
        XCTAssertEqual(counter.calls, 1)

        // `poll:updated` — версия выросла: перечитать сразу.
        _ = await cache.load("p-1", version: 1, fetch: fetch)
        XCTAssertEqual(counter.calls, 2)

        // Прошло больше интервала — перечитать и без события.
        now = now.addingTimeInterval(PollResultsCache.minInterval + 1)
        _ = await cache.load("p-1", version: 1, fetch: fetch)
        XCTAssertEqual(counter.calls, 3)

        // Голос — всегда заново.
        _ = await cache.load("p-1", version: 1, force: true, fetch: fetch)
        XCTAssertEqual(counter.calls, 4)
    }

    func testTwoBubblesShareOneRequest() async {
        let cache = PollResultsCache()
        let counter = Counter()
        let fetch: @Sendable () async throws -> PollResultsDTO = {
            counter.calls += 1
            try await Task.sleep(for: .milliseconds(50))
            return Self.results("p-1", votes: 2)
        }

        async let first = cache.load("p-1", version: 0, fetch: fetch)
        async let second = cache.load("p-1", version: 0, fetch: fetch)
        let (a, b) = await (first, second)

        XCTAssertEqual(counter.calls, 1)
        XCTAssertEqual(a?.totalVotes, 2)
        XCTAssertEqual(b?.totalVotes, 2)
    }

    func testClearForgetsPreviousAccount() async {
        let cache = PollResultsCache()
        _ = await cache.load("p-1", version: 0) { Self.results("p-1", votes: 3) }
        XCTAssertNotNil(cache.cached("p-1"))
        cache.clear()
        XCTAssertNil(cache.cached("p-1"))
    }
}
