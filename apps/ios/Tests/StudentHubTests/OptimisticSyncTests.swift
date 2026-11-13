import XCTest

@testable import StudentHub

/// Движок оптимистичных действий (итерация 3, `CHANGELOG-PERF.md`): сразу на экране,
/// на сервер — только итоговое, ответ на устаревший запрос не перезаписывает новое,
/// откат при отказе.
@MainActor
final class OptimisticSyncTests: XCTestCase {
    private var shown: [String: Bool] = [:]
    private var applied: [Bool] = []
    private var failures: [Error] = []

    override func setUp() async throws {
        shown = [:]
        applied = []
        failures = []
    }

    // MARK: - Сразу на экране

    func testAppliesImmediatelyAndConfirms() async {
        let sync = OptimisticSync<String, Bool>(label: "test", pacing: .immediate)
        let sends = ScriptedSends<Bool>()

        let task = Task { await set(sync, "k", to: true, current: false, sends: sends) }
        await waitUntil { sends.waiting == 1 }

        XCTAssertEqual(shown["k"], true, "до ответа сервера")
        sends.succeed()
        let settlement = await task.value

        XCTAssertEqual(settlement, .confirmed)
        XCTAssertEqual(applied, [true])
        XCTAssertFalse(sync.isPending("k"))
    }

    func testSameValueSendsNothing() async {
        let sync = OptimisticSync<String, Bool>(label: "test", pacing: .immediate)
        let sends = ScriptedSends<Bool>()

        let settlement = await set(sync, "k", to: false, current: false, sends: sends)

        XCTAssertEqual(settlement, .confirmed)
        XCTAssertTrue(sends.calls.isEmpty)
        XCTAssertTrue(applied.isEmpty)
    }

    // MARK: - Только итоговое состояние

    /// «Вкл-выкл-вкл», пока первый запрос в полёте: второго запроса нет — итог
    /// совпал с тем, что сервер подтвердил.
    func testRapidTogglesWhileInFlightSendFinalOnly() async {
        let sync = OptimisticSync<String, Bool>(label: "test", pacing: .immediate)
        let sends = ScriptedSends<Bool>()

        let first = Task { await set(sync, "k", to: true, current: false, sends: sends) }
        await waitUntil { sends.waiting == 1 }
        let second = await set(sync, "k", to: false, current: true, sends: sends)
        let third = await set(sync, "k", to: true, current: false, sends: sends)
        sends.succeed()
        let settlement = await first.value

        XCTAssertEqual(second, .merged)
        XCTAssertEqual(third, .merged)
        XCTAssertEqual(settlement, .confirmed)
        XCTAssertEqual(sends.calls.count, 1)
        XCTAssertEqual(shown["k"], true)
    }

    /// Пауза перед отправкой сливает нажатия: «вкл-выкл» до неё — ни одного запроса.
    func testDebounceCollapsesTapsBeforeSending() async {
        let pacing = OptimisticPacing(debounce: .milliseconds(80), retryDelays: [.zero])
        let sync = OptimisticSync<String, Bool>(label: "test", pacing: pacing)
        let sends = ScriptedSends<Bool>()

        let first = Task { await set(sync, "k", to: true, current: false, sends: sends) }
        await waitUntil { sync.isPending("k") }
        _ = await set(sync, "k", to: false, current: true, sends: sends)
        let settlement = await first.value

        XCTAssertEqual(settlement, .confirmed)
        XCTAssertTrue(sends.calls.isEmpty, "итог совпал с сервером — запрос не нужен")
        XCTAssertEqual(shown["k"], false)
    }

    /// Переключили обратно, пока шёл запрос: ответ на «вкл» не возвращает «вкл» на
    /// экран, и следом уходит «выкл».
    func testStaleResponseDoesNotOverwriteNewerState() async {
        let sync = OptimisticSync<String, Bool>(label: "test", pacing: .immediate)
        let sends = ScriptedSends<Bool>()

        let first = Task { await set(sync, "k", to: true, current: false, sends: sends) }
        await waitUntil { sends.waiting == 1 }
        _ = await set(sync, "k", to: false, current: true, sends: sends)
        sends.succeed()
        await waitUntil { sends.waiting == 1 }

        XCTAssertEqual(shown["k"], false, "ответ на устаревший запрос не перезаписал новое")
        XCTAssertEqual(sends.calls.last?.to, false)
        sends.succeed()
        _ = await first.value

        XCTAssertEqual(applied, [true, false])
        XCTAssertEqual(sends.calls.map { $0.to }, [true, false])
    }

    /// Сервер — переключатель и ответил своим положением: показываем его.
    func testServerCorrectionIsShown() async {
        let sync = OptimisticSync<String, Bool>(label: "test", pacing: .immediate)
        let sends = ScriptedSends<Bool>()

        let task = Task { await set(sync, "k", to: true, current: false, sends: sends) }
        await waitUntil { sends.waiting == 1 }
        sends.succeed(false)
        _ = await task.value

        XCTAssertEqual(shown["k"], false)
    }

    // MARK: - Откат

    func testRejectionRollsBackAndReports() async {
        let sync = OptimisticSync<String, Bool>(label: "test", pacing: .immediate)
        let sends = ScriptedSends<Bool>()

        let task = Task { await set(sync, "k", to: true, current: false, sends: sends) }
        await waitUntil { sends.waiting == 1 }
        sends.fail(APIError.server(code: .forbidden, message: "Нельзя", details: [], statusCode: 403))
        let settlement = await task.value

        XCTAssertEqual(settlement, .rolledBack)
        XCTAssertEqual(shown["k"], false)
        XCTAssertEqual(failures.count, 1)
    }

    /// Первый шаг подтверждён, второй отклонён — откат к подтверждённому, а не к
    /// состоянию до первого нажатия.
    func testRollbackGoesToLastConfirmedState() async {
        let sync = OptimisticSync<String, Bool>(label: "test", pacing: .immediate)
        let sends = ScriptedSends<Bool>()

        let first = Task { await set(sync, "k", to: true, current: false, sends: sends) }
        await waitUntil { sends.waiting == 1 }
        _ = await set(sync, "k", to: false, current: true, sends: sends)
        sends.succeed()
        await waitUntil { sends.waiting == 1 }
        sends.fail(APIError.server(code: .forbidden, message: "Нельзя", details: [], statusCode: 403))
        _ = await first.value

        XCTAssertEqual(shown["k"], true)
    }

    func testOfflineWithRollbackPolicyRollsBack() async {
        let sync = OptimisticSync<String, Bool>(label: "test", pacing: .immediate)
        let sends = ScriptedSends<Bool>()

        let task = Task { await set(sync, "k", to: true, current: false, sends: sends) }
        await waitUntil { sends.waiting == 1 }
        sends.fail(APIError.transport(URLError(.notConnectedToInternet)))
        let settlement = await task.value

        XCTAssertEqual(settlement, .rolledBack)
        XCTAssertEqual(shown["k"], false)
        XCTAssertEqual(sends.calls.count, 1)
    }

    /// Безвредное действие без связи — не откат, а повтор; связь появилась — сохранено.
    func testOfflineWithRetryPolicyKeepsStateAndRetries() async {
        let sync = OptimisticSync<String, Bool>(label: "test", pacing: .immediate)
        let sends = ScriptedSends<Bool>()

        let task = Task { await set(sync, "k", to: true, current: false, retry: .retry(attempts: 2), sends: sends) }
        await waitUntil { sends.waiting == 1 }
        sends.fail(APIError.transport(URLError(.timedOut)))
        await waitUntil { sends.waiting == 1 }

        XCTAssertEqual(shown["k"], true, "пока повторяем — показанное держится")
        sends.succeed()
        let settlement = await task.value

        XCTAssertEqual(settlement, .confirmed)
        XCTAssertEqual(sends.calls.count, 2)
        XCTAssertTrue(failures.isEmpty)
    }

    func testRetriesExhaustedRollBack() async {
        let sync = OptimisticSync<String, Bool>(label: "test", pacing: .immediate)
        let sends = ScriptedSends<Bool>()

        let task = Task { await set(sync, "k", to: true, current: false, retry: .retry(attempts: 1), sends: sends) }
        await waitUntil { sends.waiting == 1 }
        sends.fail(APIError.transport(URLError(.timedOut)))
        await waitUntil { sends.waiting == 1 }
        sends.fail(APIError.transport(URLError(.timedOut)))
        let settlement = await task.value

        XCTAssertEqual(settlement, .rolledBack)
        XCTAssertEqual(shown["k"], false)
        XCTAssertEqual(failures.count, 1)
    }

    // MARK: - Ответы со стороны

    /// Обновление списка, пришедшее, пока действие в полёте, не затирает показанное.
    func testServerReadDuringFlightKeepsShownValue() async {
        let sync = OptimisticSync<String, Bool>(label: "test", pacing: .immediate)
        let sends = ScriptedSends<Bool>()

        let task = Task { await set(sync, "k", to: true, current: false, sends: sends) }
        await waitUntil { sends.waiting == 1 }
        let stamp = sync.beginRead()

        XCTAssertEqual(sync.resolve("k", server: false, readAt: stamp), true)
        sends.succeed()
        _ = await task.value
    }

    /// Чтение начато до подтверждения, а ответ пришёл после: устарело, держим
    /// подтверждённое. Чтение начато после — правда сервера.
    func testReadStartedBeforeConfirmationIsStale() async {
        let sync = OptimisticSync<String, Bool>(label: "test", pacing: .immediate)
        let sends = ScriptedSends<Bool>()
        let early = sync.beginRead()

        let task = Task { await set(sync, "k", to: true, current: false, sends: sends) }
        await waitUntil { sends.waiting == 1 }
        sends.succeed()
        _ = await task.value
        let late = sync.beginRead()

        XCTAssertEqual(sync.resolve("k", server: false, readAt: early), true)
        XCTAssertEqual(sync.resolve("k", server: false, readAt: late), false)
    }

    /// Обновление показало, что сервер уже в нужном состоянии (сделали с другого
    /// устройства), пока шла пауза перед отправкой, — запрос не уходит.
    func testServerAlreadyInDesiredStateSkipsSend() async {
        let pacing = OptimisticPacing(debounce: .milliseconds(80), retryDelays: [.zero])
        let sync = OptimisticSync<String, Bool>(label: "test", pacing: pacing)
        let sends = ScriptedSends<Bool>()

        let task = Task { await set(sync, "k", to: true, current: false, sends: sends) }
        await waitUntil { sync.isPending("k") }
        let stamp = sync.beginRead()
        _ = sync.resolve("k", server: true, readAt: stamp)
        _ = await task.value

        XCTAssertTrue(sends.calls.isEmpty)
    }

    // MARK: - Без оптимизма и сброс

    func testPessimisticModeAppliesOnlyAfterServer() async {
        let sync = OptimisticSync<String, Bool>(label: "test", optimistic: false, pacing: .immediate)
        let sends = ScriptedSends<Bool>()

        let task = Task { await set(sync, "k", to: true, current: false, sends: sends) }
        await waitUntil { sends.waiting == 1 }

        XCTAssertNil(shown["k"], "без оптимизма экран ждёт сервер")
        sends.succeed()
        _ = await task.value
        XCTAssertEqual(shown["k"], true)
    }

    /// Выход из аккаунта: ответ, пришедший потом, не применяется, отката нет.
    func testResetAbandonsInFlightAction() async {
        let sync = OptimisticSync<String, Bool>(label: "test", pacing: .immediate)
        let sends = ScriptedSends<Bool>()

        let task = Task { await set(sync, "k", to: true, current: false, sends: sends) }
        await waitUntil { sends.waiting == 1 }
        sync.reset()
        sends.fail(APIError.server(code: .forbidden, message: "Нельзя", details: [], statusCode: 403))
        let settlement = await task.value

        XCTAssertEqual(settlement, .abandoned)
        XCTAssertEqual(applied, [true])
        XCTAssertTrue(failures.isEmpty)
        XCTAssertTrue(sync.trackedKeys.isEmpty)
    }

    // MARK: - Классификация ошибок

    func testFailureKinds() {
        XCTAssertEqual(ActionFailureKind(CancellationError()), .cancelled)
        XCTAssertEqual(ActionFailureKind(APIError.transport(URLError(.cancelled))), .cancelled)
        XCTAssertEqual(ActionFailureKind(APIError.transport(URLError(.notConnectedToInternet))), .transient)
        XCTAssertEqual(ActionFailureKind(APIError.server(code: .internalError, message: "", details: [], statusCode: 503)), .transient)
        XCTAssertEqual(ActionFailureKind(APIError.server(code: .rateLimit, message: "", details: [], statusCode: 429)), .transient)
        XCTAssertEqual(ActionFailureKind(APIError.malformedResponse(statusCode: 502)), .transient)
        XCTAssertEqual(ActionFailureKind(APIError.server(code: .conflict, message: "", details: [], statusCode: 409)), .rejected)
    }

    func testAlreadyAppliedMeansSuccessForRepeats() {
        let conflict = APIError.server(code: .conflict, message: "", details: [], statusCode: 409)
        let missing = APIError.server(code: .notFound, message: "", details: [], statusCode: 404)
        XCTAssertTrue(conflict.isAlreadyApplied(turningOn: true))
        XCTAssertFalse(conflict.isAlreadyApplied(turningOn: false))
        XCTAssertTrue(missing.isAlreadyApplied(turningOn: false))
        XCTAssertFalse(missing.isAlreadyApplied(turningOn: true))
    }

    // MARK: - Помощники

    private func set(
        _ sync: OptimisticSync<String, Bool>,
        _ key: String,
        to value: Bool,
        current: Bool,
        retry: OptimisticRetryPolicy = .rollback,
        sends: ScriptedSends<Bool>
    ) async -> OptimisticSettlement {
        await sync.set(
            key,
            to: value,
            current: current,
            retry: retry,
            apply: { [weak self] next in
                self?.shown[key] = next
                self?.applied.append(next)
            },
            send: { from, to in try await sends.send(from, to) },
            failed: { [weak self] error in self?.failures.append(error) }
        )
    }
}

/// Отправка, которую тест отпускает сам: так видно, что происходит, пока запрос в полёте.
@MainActor
final class ScriptedSends<Value: Sendable> {
    private(set) var calls: [(from: Value, to: Value)] = []
    private var continuations: [CheckedContinuation<Value?, Error>] = []

    var waiting: Int { continuations.count }

    func send(_ from: Value, _ to: Value) async throws -> Value? {
        calls.append((from, to))
        return try await withCheckedThrowingContinuation { continuations.append($0) }
    }

    func succeed(_ value: Value? = nil) {
        guard !continuations.isEmpty else { return XCTFail("нечего отпускать") }
        continuations.removeFirst().resume(returning: value)
    }

    func fail(_ error: Error) {
        guard !continuations.isEmpty else { return XCTFail("нечего отпускать") }
        continuations.removeFirst().resume(throwing: error)
    }
}

/// Дождаться условия, уступая главный поток задачам движка. Без часов: тест не зависит
/// от скорости машины, а зависшее условие падает, а не висит.
@MainActor
func waitUntil(
    _ condition: () -> Bool,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    for _ in 0..<2_000 {
        if condition() { return }
        await Task.yield()
    }
    // Пауза перед отправкой (тесты с debounce) — дождёмся её честно.
    for _ in 0..<100 {
        if condition() { return }
        try? await Task.sleep(for: .milliseconds(10))
    }
    XCTFail("условие так и не выполнилось", file: file, line: line)
}
