import XCTest

@testable import StudentHub

/// Подгрузка следующей страницы после сбоя (IOS_RULES 9.6.9).
@MainActor
final class PagedLoaderTests: XCTestCase {
    /// Временный сбой повторяется сам, пока ждёт задача последней строки, — без кнопки.
    func testTransientPageFailureRetriesOnItsOwn() async throws {
        let server = PageServer(failuresBeforeSecondPage: 2, error: APIError.transport(URLError(.notConnectedToInternet)))
        let loader = PagedLoader<Row>(limit: 2, cachesFirstPage: false) { request in try await server.page(request) }
        loader.firstRetryDelay = .milliseconds(5)
        await loader.reload()
        let last = try XCTUnwrap(loader.items.last)

        await loader.loadMore(after: last)

        XCTAssertEqual(loader.items.map(\.id), ["1", "2", "3"])
        XCTAssertNil(loader.pageFailure)
        let calls = await server.calls
        XCTAssertEqual(calls, 4)
    }

    /// Отказ по существу сам не повторяется: ждёт «Повторить».
    func testRejectedPageFailureWaitsForButton() async throws {
        let server = PageServer(
            failuresBeforeSecondPage: 1,
            error: APIError.server(code: .forbidden, message: "", details: [], statusCode: 403)
        )
        let loader = PagedLoader<Row>(limit: 2, cachesFirstPage: false) { request in try await server.page(request) }
        loader.firstRetryDelay = .milliseconds(5)
        await loader.reload()
        let last = try XCTUnwrap(loader.items.last)

        await loader.loadMore(after: last)
        await loader.loadMore(after: last)

        XCTAssertNotNil(loader.pageFailure)
        var calls = await server.calls
        XCTAssertEqual(calls, 2)

        await loader.retryMore()
        XCTAssertNil(loader.pageFailure)
        XCTAssertEqual(loader.items.count, 3)
        calls = await server.calls
        XCTAssertEqual(calls, 3)
    }
}

private struct Row: Decodable, Identifiable, Sendable {
    let id: String
}

/// Две страницы; вторая отвечает ошибкой заданное число раз.
private actor PageServer {
    private(set) var calls = 0
    private var failuresLeft: Int
    private let error: Error

    init(failuresBeforeSecondPage: Int, error: Error) {
        failuresLeft = failuresBeforeSecondPage
        self.error = error
    }

    func page(_ request: PageRequest) throws -> Page<Row> {
        calls += 1
        guard request.page > 1 else {
            return Page(items: [Row(id: "1"), Row(id: "2")], meta: APIMeta(cursor: "c", hasNext: true, total: nil, prevCursor: nil, hasPrev: nil))
        }
        if failuresLeft > 0 {
            failuresLeft -= 1
            throw error
        }
        return Page(items: [Row(id: "3")], meta: APIMeta(cursor: nil, hasNext: false, total: nil, prevCursor: nil, hasPrev: nil))
    }
}
