import XCTest

@testable import StudentHub

/// Удалённый выключатель функций (IOS_RULES 14.5.1): разбор `disabledFeatures`, кеш
/// последнего ответа и применение тем же путём, что проверка версии.
@MainActor
final class RemoteFeaturesTests: XCTestCase {
    // MARK: Разбор

    func testKnownNamesAreDecodedUnknownDropped() throws {
        let info = try decode("""
        {"platform":"ios","minimumVersion":"1.0.0",
         "disabledFeatures":["liveLocation","fromTheFuture",42,"chatVideoUpload","liveLocation","stickers"]}
        """)

        // `stickers` — имя выключателя убранной функции: эта сборка его не знает.
        XCTAssertEqual(info.disabledFeatures, [.liveLocation, .chatVideoUpload])
    }

    /// Ответ старого сервера и кеш прежней сборки поля не знают — это «всё включено».
    func testMissingFieldMeansAllEnabled() throws {
        let info = try decode(#"{"platform":"ios","minimumVersion":"1.2.0"}"#)

        XCTAssertEqual(info.disabledFeatures, [])
        XCTAssertEqual(info.minimumVersion, "1.2.0")
    }

    /// Битое поле не должно стоить проверки версии, которая едет в том же ответе.
    func testMalformedFieldKeepsVersionAnswer() throws {
        let info = try decode(#"{"platform":"ios","minimumVersion":"2.0.0","disabledFeatures":"liveLocation"}"#)

        XCTAssertEqual(info.disabledFeatures, [])
        XCTAssertEqual(info.minimumVersion, "2.0.0")
    }

    // MARK: Кеш

    func testCacheRoundTripKeepsDisabledFeatures() throws {
        let suite = "remote-features-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let cache = DefaultsClientVersionCache(defaults: defaults)

        cache.save(answer(disabled: [.chatVideoUpload]))

        XCTAssertEqual(cache.load()?.disabledFeatures, [.chatVideoUpload])
        // Первый кадр после перезапуска уже знает, что выключено.
        let features = RemoteFeatures(cache: cache)
        XCTAssertFalse(features.isEnabled(.chatVideoUpload))
        XCTAssertTrue(features.isEnabled(.liveLocation))
    }

    // MARK: Применение через проверку версии

    func testServerAnswerTurnsFeaturesOffAndBackOn() async {
        let api = StubVersionAPI(answer: answer(disabled: [.chatVideoUpload]))
        let features = RemoteFeatures(cache: MemoryVersionCache())
        let gate = UpdateGateModel(api: api, cache: MemoryVersionCache(), features: features, currentVersion: "1.0.0")

        await gate.check()
        XCTAssertFalse(features.isEnabled(.chatVideoUpload))

        api.set(answer(disabled: []))
        await gate.check()
        XCTAssertTrue(features.isEnabled(.chatVideoUpload))
    }

    /// Без сети действует последний ответ: функция, выключенная из-за поломки, не
    /// включается обратно, стоит выйти из зоны приёма.
    func testOfflineKeepsRememberedSwitches() async {
        let cache = MemoryVersionCache(stored: answer(disabled: [.liveLocation]))
        let api = StubVersionAPI(answer: answer(disabled: []))
        api.fail()
        let features = RemoteFeatures(cache: MemoryVersionCache())
        let gate = UpdateGateModel(api: api, cache: cache, features: features, currentVersion: "1.0.0")

        await gate.check()

        XCTAssertFalse(features.isEnabled(.liveLocation))
        XCTAssertEqual(gate.state, .allowed)
    }

    /// Неразобранная версия на сервере не отменяет выключение функций.
    func testSwitchesApplyEvenWithUnparsableVersion() async {
        let api = StubVersionAPI(answer: ClientVersionInfo(
            platform: "ios", minimumVersion: "последняя", storeUrl: nil, disabledFeatures: [.chatVideoUpload]
        ))
        let features = RemoteFeatures(cache: MemoryVersionCache())
        let gate = UpdateGateModel(api: api, cache: MemoryVersionCache(), features: features, currentVersion: "1.0.0")

        await gate.check()

        XCTAssertFalse(features.isEnabled(.chatVideoUpload))
    }

    // MARK: Помощники

    private func decode(_ json: String) throws -> ClientVersionInfo {
        try JSONCoding.decoder.decode(ClientVersionInfo.self, from: Data(json.utf8))
    }

    private func answer(disabled: [RemoteFeature]) -> ClientVersionInfo {
        ClientVersionInfo(platform: "ios", minimumVersion: "0.0.0", storeUrl: nil, disabledFeatures: disabled)
    }
}

// MARK: - Дублёры

private final class StubVersionAPI: ClientVersionChecking, @unchecked Sendable {
    private let lock = NSLock()
    private var answer: ClientVersionInfo
    private var failing = false

    init(answer: ClientVersionInfo) { self.answer = answer }

    func set(_ value: ClientVersionInfo) { lock.withLock { answer = value } }
    func fail() { lock.withLock { failing = true } }

    func supportedVersion() async throws -> ClientVersionInfo {
        // Явные имена и тип: кортеж с тем же именем, что у свойства, ронял компилятор Xcode 26.6
        // («failed to produce diagnostic»), хотя Swift 6.4 его принимал.
        let snapshot: (shouldFail: Bool, info: ClientVersionInfo) = lock.withLock { (self.failing, self.answer) }
        if snapshot.shouldFail { throw APIError.transport(URLError(.notConnectedToInternet)) }
        return snapshot.info
    }
}

private final class MemoryVersionCache: ClientVersionCache, @unchecked Sendable {
    private let lock = NSLock()
    private var stored: ClientVersionInfo?

    init(stored: ClientVersionInfo? = nil) { self.stored = stored }

    func load() -> ClientVersionInfo? { lock.withLock { stored } }
    func save(_ info: ClientVersionInfo) { lock.withLock { stored = info } }
}
