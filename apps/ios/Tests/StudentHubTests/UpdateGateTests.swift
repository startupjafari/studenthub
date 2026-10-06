import XCTest

@testable import StudentHub

final class AppVersionTests: XCTestCase {
    /// Главное, ради чего версия вообще разбирается на числа: строкой «1.10.0»
    /// меньше «1.9.0», и блокировка срабатывала бы наоборот на десятом релизе.
    func testOrderIsNumericNotAlphabetical() throws {
        let older = try XCTUnwrap(AppVersion("1.9.0"))
        let newer = try XCTUnwrap(AppVersion("1.10.0"))

        XCTAssertTrue(older < newer)
    }

    func testEqualVersionsAreEqual() {
        XCTAssertEqual(AppVersion("2.0.1"), AppVersion("2.0.1"))
    }

    /// Не версия — значит не версия: догадываться о ней опаснее, чем признать
    /// разбор неудачным.
    func testGarbageIsRejected() {
        for raw in ["1.2", "latest", "1.2.0-beta", "", "x.y.z", "1.2.3.4"] {
            XCTAssertNil(AppVersion(raw), "разобралось то, что версией не является: \(raw)")
        }
    }
}

@MainActor
final class UpdateGateTests: XCTestCase {
    private let storeURL = URL(string: "https://apps.apple.com/app/id1")!

    func testOlderBuildIsBlocked() async {
        let gate = makeGate(current: "1.0.0", answer: info(minimum: "1.2.0"))

        await gate.check()

        XCTAssertEqual(gate.state, .blocked(storeURL: storeURL))
    }

    func testCurrentBuildPasses() async {
        let gate = makeGate(current: "1.2.0", answer: info(minimum: "1.2.0"))

        await gate.check()

        XCTAssertEqual(gate.state, .allowed)
    }

    /// Авария на бэкенде не должна запирать приложение всем сразу, включая тех, у
    /// кого версия свежая.
    func testServerFailureLocksNobody() async {
        let api = StubClientVersion()
        api.failure = .transport(URLError(.notConnectedToInternet))
        let gate = UpdateGateModel(api: api, cache: MemoryCache(), currentVersion: "1.0.0")

        await gate.check()

        XCTAssertEqual(gate.state, .allowed)
    }

    /// Запуск без сети не отменяет уже принятое решение — иначе выключенный Wi-Fi
    /// обходил бы блокировку.
    func testRememberedAnswerSurvivesOfflineLaunch() async {
        let api = StubClientVersion()
        api.failure = .transport(URLError(.notConnectedToInternet))
        let cache = MemoryCache(stored: info(minimum: "1.2.0"))
        let gate = UpdateGateModel(api: api, cache: cache, currentVersion: "1.0.0")

        await gate.check()

        XCTAssertEqual(gate.state, .blocked(storeURL: storeURL))
    }

    func testFreshAnswerIsRemembered() async {
        let cache = MemoryCache()
        let gate = makeGate(current: "1.0.0", answer: info(minimum: "1.2.0"), cache: cache)

        await gate.check()

        XCTAssertEqual(cache.load()?.minimumVersion, "1.2.0")
    }

    /// Опечатка в переменной окружения не должна ломать приложение у всех.
    func testUnparsableServerVersionDoesNotBlock() async {
        let gate = makeGate(current: "1.0.0", answer: info(minimum: "последняя"))

        await gate.check()

        XCTAssertEqual(gate.state, .allowed)
    }

    /// Ссылки на магазин нет — кнопке «Обновить» взяться неоткуда, и экран обязан
    /// это пережить.
    func testBlockWithoutStoreLink() async {
        let gate = makeGate(current: "1.0.0", answer: ClientVersionInfo(
            platform: "ios",
            minimumVersion: "2.0.0",
            storeUrl: nil
        ))

        await gate.check()

        XCTAssertEqual(gate.state, .blocked(storeURL: nil))
    }

    private func info(minimum: String) -> ClientVersionInfo {
        ClientVersionInfo(platform: "ios", minimumVersion: minimum, storeUrl: storeURL)
    }

    private func makeGate(
        current: String,
        answer: ClientVersionInfo,
        cache: MemoryCache = MemoryCache()
    ) -> UpdateGateModel {
        let api = StubClientVersion()
        api.answer = answer
        return UpdateGateModel(api: api, cache: cache, currentVersion: current)
    }
}

// MARK: - Дублёры

private final class StubClientVersion: ClientVersionChecking, @unchecked Sendable {
    private let lock = NSLock()
    var answer = ClientVersionInfo(platform: "ios", minimumVersion: "0.0.0", storeUrl: nil)
    var failure: APIError?

    func supportedVersion() async throws -> ClientVersionInfo {
        let (error, value) = lock.withLock { (failure, answer) }
        if let error { throw error }
        return value
    }
}

private final class MemoryCache: ClientVersionCache, @unchecked Sendable {
    private let lock = NSLock()
    private var stored: ClientVersionInfo?

    init(stored: ClientVersionInfo? = nil) { self.stored = stored }

    func load() -> ClientVersionInfo? { lock.withLock { stored } }
    func save(_ info: ClientVersionInfo) { lock.withLock { stored = info } }
}
