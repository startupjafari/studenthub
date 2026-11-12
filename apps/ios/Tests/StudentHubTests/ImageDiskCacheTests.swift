import XCTest

@testable import StudentHub

/// Итерация 6: дисковый кеш картинок и одна загрузка на картинку.
final class ImageDiskCacheTests: XCTestCase {
    private var root = FileManager.default.temporaryDirectory

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appending(path: "image-cache-\(UUID().uuidString)")
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    /// Подпись меняется при каждом обновлении — ключ нет; параметры самой картинки
    /// остаются.
    func testKeyDropsSignatureButKeepsImageParameters() throws {
        let first = try XCTUnwrap(URL(string: "https://cdn.test/b/p.webp?X-Amz-Signature=a&X-Amz-Date=1&w=640"))
        let second = try XCTUnwrap(URL(string: "https://cdn.test/b/p.webp?w=640&X-Amz-Signature=b&X-Amz-Date=2"))
        let api = try XCTUnwrap(URL(string: "https://api.test/api/v1/media/m-1/640?t=secret"))
        let other = try XCTUnwrap(URL(string: "https://cdn.test/b/p.webp?w=1280&X-Amz-Signature=a"))

        XCTAssertEqual(ImageDiskCache.key(for: first), ImageDiskCache.key(for: second))
        XCTAssertEqual(ImageDiskCache.key(for: api), "https://api.test/api/v1/media/m-1/640")
        XCTAssertNotEqual(ImageDiskCache.key(for: first), ImageDiskCache.key(for: other))
    }

    func testExpiryFollowsCacheHeaders() throws {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let limits = ImageDiskCache.Limits.standard

        XCTAssertNil(ImageDiskCache.expiry(for: try response(["Cache-Control": "no-store"]), now: now))
        XCTAssertNil(ImageDiskCache.expiry(for: try response(["Cache-Control": "private, max-age=0"]), now: now))
        XCTAssertEqual(
            ImageDiskCache.expiry(for: try response(["Cache-Control": "public, max-age=60"]), now: now),
            now.addingTimeInterval(60)
        )
        XCTAssertEqual(
            ImageDiskCache.expiry(for: try response(["Expires": "Mon, 12 Jan 1970 14:00:00 GMT"]), now: now),
            Date(timeIntervalSince1970: 1_000_800)
        )
        XCTAssertEqual(
            ImageDiskCache.expiry(for: try response([:]), now: now),
            now.addingTimeInterval(limits.defaultLifetime),
            "без заголовков — разумный срок"
        )
        XCTAssertEqual(
            ImageDiskCache.expiry(for: try response(["Cache-Control": "max-age=99999999"]), now: now),
            now.addingTimeInterval(limits.maxLifetime),
            "не дольше потолка"
        )
    }

    func testStoredBytesAreReadBack() async {
        let cache = ImageDiskCache(root: root, isLocked: { false })

        cache.store(Data("картинка".utf8), for: "k", expires: Date().addingTimeInterval(60), generation: cache.generation)
        await cache.flush()

        let data = await ImageDiskCache(root: root, isLocked: { false }).data(for: "k")
        XCTAssertEqual(data, Data("картинка".utf8))
    }

    func testExpiredEntryIsAMiss() async {
        let cache = ImageDiskCache(root: root, isLocked: { false })

        cache.store(Data("старое".utf8), for: "k", expires: Date().addingTimeInterval(-1), generation: cache.generation)
        await cache.flush()

        let data = await cache.data(for: "k")
        XCTAssertNil(data)
    }

    /// Загрузка, начатая до выхода из аккаунта, на диск не пишет.
    func testWriteFromPreviousGenerationIsDropped() async {
        let cache = ImageDiskCache(root: root, isLocked: { false })
        let started = cache.generation

        cache.eraseAll()
        cache.store(Data("чужое".utf8), for: "k", expires: Date().addingTimeInterval(60), generation: started)
        await cache.flush()

        let data = await cache.data(for: "k")
        XCTAssertNil(data)
    }

    func testLockedDeviceWritesNothing() async {
        let cache = ImageDiskCache(root: root, isLocked: { true })

        cache.store(Data("x".utf8), for: "k", expires: Date().addingTimeInterval(60), generation: cache.generation)
        await cache.flush()

        XCTAssertFalse(FileManager.default.fileExists(atPath: root.path()))
    }

    /// Сверх объёма уходит давно не открывавшееся, а открытое недавно — остаётся.
    func testTrimEvictsLeastRecentlyUsed() async throws {
        let limits = ImageDiskCache.Limits(
            maxBytes: 2_500, trimTo: 1_500, defaultLifetime: 3_600, maxLifetime: 3_600, maxEntryBytes: 10_000
        )
        let cache = ImageDiskCache(root: root, limits: limits, isLocked: { false })
        let expires = Date().addingTimeInterval(3_600)
        for key in ["a", "b", "c"] {
            cache.store(Data(repeating: 7, count: 1_000), for: key, expires: expires, generation: cache.generation)
        }
        await cache.flush()
        let directory = root.appending(path: "v1")
        for (index, key) in ["a", "b", "c"].enumerated() {
            try FileManager.default.setAttributes(
                [.modificationDate: Date().addingTimeInterval(Double(index) * 10 - 100)],
                ofItemAtPath: directory.appending(path: ImageDiskCache.fileName(for: key)).path()
            )
        }
        // «a» открыли только что — она самая свежая по использованию.
        _ = await cache.data(for: "a")

        cache.housekeeping()
        await cache.flush()

        let a = await cache.data(for: "a")
        let b = await cache.data(for: "b")
        XCTAssertNotNil(a)
        XCTAssertNil(b)
    }

    func testEraseAllRemovesEverything() async {
        let cache = ImageDiskCache(root: root, isLocked: { false })
        cache.store(Data("x".utf8), for: "k", expires: Date().addingTimeInterval(60), generation: cache.generation)
        await cache.flush()

        cache.eraseAll()
        await cache.flush()

        XCTAssertFalse(FileManager.default.fileExists(atPath: root.path()))
    }

    private func response(_ headers: [String: String]) throws -> HTTPURLResponse {
        try XCTUnwrap(HTTPURLResponse(
            url: try XCTUnwrap(URL(string: "https://cdn.test/p.webp")),
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: headers
        ))
    }
}

final class ImageDownloadsTests: XCTestCase {
    private var root = FileManager.default.temporaryDirectory

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appending(path: "image-downloads-\(UUID().uuidString)")
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    /// Десять ячеек ждут одну картинку — загрузка одна.
    func testConcurrentRequestsShareOneDownload() async throws {
        let network = SlowNetwork(delay: .milliseconds(50))
        let downloads = ImageDownloads(disk: ImageDiskCache(root: root, isLocked: { false })) { url in
            await network.fetch(url)
        }
        let url = try XCTUnwrap(URL(string: "https://cdn.test/p.webp?X-Amz-Signature=1"))

        let results = await withTaskGroup(of: Data?.self) { group in
            for _ in 0..<10 { group.addTask { await downloads.data(for: url) } }
            var collected: [Data?] = []
            for await result in group { collected.append(result) }
            return collected
        }

        XCTAssertEqual(results.compactMap { $0 }.count, 10)
        let calls = await network.calls
        XCTAssertEqual(calls, 1)
    }

    /// После перезапуска картинка — с диска, без сети; подпись в адресе другая.
    func testSecondLaunchReadsFromDisk() async throws {
        let network = SlowNetwork(delay: .zero)
        let disk = ImageDiskCache(root: root, isLocked: { false })
        let first = ImageDownloads(disk: disk) { url in await network.fetch(url) }
        _ = await first.data(for: try XCTUnwrap(URL(string: "https://cdn.test/p.webp?X-Amz-Signature=1")))
        await disk.flush()

        let second = ImageDownloads(disk: ImageDiskCache(root: root, isLocked: { false })) { url in await network.fetch(url) }
        let data = await second.data(for: try XCTUnwrap(URL(string: "https://cdn.test/p.webp?X-Amz-Signature=2")))

        XCTAssertNotNil(data)
        let calls = await network.calls
        XCTAssertEqual(calls, 1)
    }

    /// `no-store` — на диск не кладём: следующий запрос снова идёт в сеть.
    func testNoStoreIsNotWrittenToDisk() async throws {
        let network = SlowNetwork(delay: .zero, expires: nil)
        let disk = ImageDiskCache(root: root, isLocked: { false })
        let downloads = ImageDownloads(disk: disk) { url in await network.fetch(url) }
        let url = try XCTUnwrap(URL(string: "https://cdn.test/private.webp"))

        _ = await downloads.data(for: url)
        await disk.flush()
        _ = await downloads.data(for: url)

        let calls = await network.calls
        XCTAssertEqual(calls, 2)
    }

    /// Ушли все ждущие — загрузка снимается.
    func testDownloadIsCancelledWhenEveryoneLeaves() async throws {
        let network = SlowNetwork(delay: .seconds(5))
        let downloads = ImageDownloads(disk: ImageDiskCache(root: root, isLocked: { false })) { url in
            await network.fetch(url)
        }
        let url = try XCTUnwrap(URL(string: "https://cdn.test/slow.webp"))

        let waiter = Task { await downloads.data(for: url) }
        try await Task.sleep(for: .milliseconds(50))
        waiter.cancel()
        let result = await waiter.value

        XCTAssertNil(result)
        let cancelled = await network.cancelled
        XCTAssertTrue(cancelled)
        let inFlight = await downloads.inFlightCount
        XCTAssertEqual(inFlight, 0)
    }
}

/// Сеть для загрузчика: считает запросы, умеет ждать и замечает отмену.
private actor SlowNetwork {
    private(set) var calls = 0
    private(set) var cancelled = false
    private let delay: Duration
    private let expires: Date?

    init(delay: Duration, expires: Date? = Date().addingTimeInterval(3_600)) {
        self.delay = delay
        self.expires = expires
    }

    func fetch(_ url: URL) async -> ImageDownloads.Fetched? {
        calls += 1
        do {
            try await Task.sleep(for: delay)
        } catch {
            cancelled = true
            return nil
        }
        return ImageDownloads.Fetched(data: Data(url.path().utf8), expires: expires)
    }
}
