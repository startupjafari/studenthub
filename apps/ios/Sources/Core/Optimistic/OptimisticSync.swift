import Foundation
import os

/// Чем закончилось действие — с точки зрения отката, а не текста ошибки.
enum ActionFailureKind: Equatable, Sendable {
    /// Задача отменена: ответа нет, судить не о чем.
    case cancelled
    /// Нет связи или временный сбой сервера (5xx, 429): действие могло и не дойти.
    case transient
    /// Сервер отказал по существу (4xx) или ответ не разобрался: повтор не поможет.
    case rejected

    init(_ error: Error) {
        if error is CancellationError {
            self = .cancelled
            return
        }
        if let url = error as? URLError {
            self = url.code == .cancelled ? .cancelled : .transient
            return
        }
        guard let api = error as? APIError else {
            self = .rejected
            return
        }
        switch api {
        case .transport(let url):
            self = url.code == .cancelled ? .cancelled : .transient
        case .server(_, _, _, let statusCode), .malformedResponse(let statusCode):
            // 502 от прокси приходит HTML-страницей — это `malformedResponse`, но по сути
            // то же «сервер сейчас не может», что и 5xx по контракту.
            self = statusCode >= 500 || statusCode == 429 ? .transient : .rejected
        case .decoding:
            self = .rejected
        }
    }
}

/// Что делать, если действие не дошло из-за связи. Решение — по каждому действию
/// (`CHANGELOG-PERF.md`, итерация 3).
enum OptimisticRetryPolicy: Equatable, Sendable {
    /// Вернуть как было и сказать: человек должен знать, что лайк или переключатель не
    /// сохранились.
    case rollback
    /// Оставить показанное и повторить до `attempts` раз с паузой; не вышло — откат.
    /// Для безвредных идемпотентных действий: «прочитано».
    case retry(attempts: Int)
}

/// Чем закончился вызов `OptimisticSync.set`.
enum OptimisticSettlement: Equatable, Sendable {
    /// Сервер принял итоговое состояние (или поправил его своим — оно и показано).
    case confirmed
    /// Запрос по этому ключу уже в полёте: новое желаемое состояние уйдёт следом,
    /// когда он вернётся.
    case merged
    /// Отказ или связь так и не появилась: показано прежнее состояние сервера.
    case rolledBack
    /// Действие снято (выход из аккаунта, `reset`) — ответ, если придёт, не применяется.
    case abandoned
}

/// Паузы движка. В тестах — нулевые.
struct OptimisticPacing: Sendable {
    /// Пауза перед отправкой: за неё «вкл-выкл-вкл» сливается в одно итоговое «вкл»,
    /// и на сервер уходит один запрос, а не три. Экран меняется сразу — пауза не видна.
    var debounce: Duration
    /// Паузы перед повторами при обрыве связи (`OptimisticRetryPolicy.retry`).
    var retryDelays: [Duration]

    static let standard = OptimisticPacing(
        debounce: .milliseconds(250),
        retryDelays: [.seconds(1), .seconds(3), .seconds(8)]
    )
    static let immediate = OptimisticPacing(debounce: .zero, retryDelays: [.zero])
}

/// Отметка начала чтения с сервера (обновление списка, событие сокета): по ней движок
/// отличает ответ, начатый до подтверждения действия, от свежего.
struct OptimisticReadStamp: Equatable, Sendable {
    fileprivate let tick: UInt64
}

/// Оптимистичное изменение одного значения по ключу: применить сразу → отправить
/// итоговое → при отказе откатить.
///
/// Правила, ради которых он есть:
/// - на ключ в полёте не больше одного запроса; нажатия во время полёта меняют только
///   желаемое состояние, и следом уходит лишь итоговое — если оно отличается от
///   подтверждённого сервером;
/// - ответ на устаревший запрос не перезаписывает новое: после ответа сравнивается
///   желаемое сейчас, а не то, что было при отправке;
/// - ответы со стороны (обновление списка, сокет) обновляют подтверждённое состояние,
///   но не затирают показанное, пока действие не решено (`resolve`), а ответ, начатый
///   до подтверждения, не откатывает уже подтверждённое;
/// - отказ по существу — откат к последнему подтверждённому и сообщение; обрыв связи —
///   по `OptimisticRetryPolicy` действия.
///
/// Отправка идёт в своей задаче движка: уход с экрана, отменивший задачу кнопки, не
/// обрывает запрос посередине. `reset()` снимает всё (выход из аккаунта).
///
/// `PerformanceFlags.optimisticActions == false` — экран меняется только после ответа
/// сервера; очередь и слияние нажатий остаются.
@MainActor
final class OptimisticSync<Key: Hashable, Value: Equatable> {
    typealias Send = @MainActor (_ from: Value, _ to: Value) async throws -> Value?

    private struct Operation {
        var apply: @MainActor (Value) -> Void
        var send: Send
        var failed: @MainActor (Error) -> Void
        var retry: OptimisticRetryPolicy
    }

    private struct Entry {
        let id: UInt64
        /// Последнее состояние, известное серверу.
        var confirmed: Value
        /// Отметка, с которой `confirmed` подтверждён этим движком: чтения, начатые
        /// раньше, его не трогают.
        var confirmedTick: UInt64
        /// Что показано и должно оказаться на сервере.
        var desired: Value
        var operation: Operation
    }

    private struct Settled {
        let value: Value
        let tick: UInt64
    }

    let isOptimistic: Bool
    private let label: String
    private let pacing: OptimisticPacing
    private let settledLimit: Int

    private var entries: [Key: Entry] = [:]
    private var pumps: [Key: Task<OptimisticSettlement, Never>] = [:]
    private var settled: [Key: Settled] = [:]
    private var settledOrder: [Key] = []
    private var tick: UInt64 = 0
    private var nextID: UInt64 = 0

    /// `label` — только для меток Instruments, без идентификаторов и данных.
    ///
    /// `nonisolated`: модели экранов создаются в инициализаторах `@State`, вне главного
    /// актора; до первого вызова движок ни с кем не делится, гонки здесь нет.
    nonisolated init(
        label: String,
        optimistic: Bool = PerformanceFlags.optimisticActions,
        pacing: OptimisticPacing = .standard,
        settledLimit: Int = 256
    ) {
        self.label = label
        self.isOptimistic = optimistic
        self.pacing = pacing
        self.settledLimit = max(1, settledLimit)
    }

    /// Действие по ключу ещё не решено.
    func isPending(_ key: Key) -> Bool { entries[key] != nil }

    /// Ключи, по которым ответ сервера со стороны надо пропустить через `resolve`:
    /// действие в полёте или подтверждено недавно.
    var trackedKeys: [Key] {
        Array(Set(entries.keys).union(settled.keys))
    }

    /// Начинается чтение с сервера, ответ которого пойдёт в `resolve`.
    func beginRead() -> OptimisticReadStamp {
        tick &+= 1
        return OptimisticReadStamp(tick: tick)
    }

    /// Значение с сервера, пришедшее мимо действия. Возвращает, что показывать.
    ///
    /// Действие в полёте — показанное не меняется, а пришедшее становится новой точкой
    /// отката (если чтение начато после последнего подтверждения). Действие подтверждено
    /// после начала этого чтения — ответ устарел, показываем подтверждённое.
    func resolve(_ key: Key, server: Value, readAt stamp: OptimisticReadStamp) -> Value {
        if var entry = entries[key] {
            if stamp.tick > entry.confirmedTick {
                entry.confirmed = server
                entries[key] = entry
            }
            return isOptimistic ? entry.desired : entry.confirmed
        }
        if let done = settled[key], done.tick > stamp.tick {
            return done.value
        }
        return server
    }

    /// Поставить значение. `current` — что показано сейчас (точка отката, если по ключу
    /// ничего не в полёте). Возвращается, когда действие решено; нажатие во время полёта
    /// возвращается сразу (`.merged`).
    @discardableResult
    func set(
        _ key: Key,
        to desired: Value,
        current: Value,
        retry: OptimisticRetryPolicy = .rollback,
        apply: @escaping @MainActor (Value) -> Void,
        send: @escaping Send,
        failed: @escaping @MainActor (Error) -> Void
    ) async -> OptimisticSettlement {
        let operation = Operation(apply: apply, send: send, failed: failed, retry: retry)
        if var entry = entries[key] {
            entry.desired = desired
            entry.operation = operation
            entries[key] = entry
            if isOptimistic { apply(desired) }
            Signposts.actions.emitEvent("OptimisticMerged", "\(self.label, privacy: .public)")
            return .merged
        }
        guard desired != current else { return .confirmed }
        nextID &+= 1
        let id = nextID
        entries[key] = Entry(id: id, confirmed: current, confirmedTick: 0, desired: desired, operation: operation)
        if isOptimistic { apply(desired) }
        let pump = Task { await self.pump(key, id: id) }
        pumps[key] = pump
        return await pump.value
    }

    /// Снять всё: ответы, которые ещё придут, не применяются, откатов и сообщений нет.
    /// Выход из аккаунта и уход модели.
    func reset() {
        for pump in pumps.values { pump.cancel() }
        pumps = [:]
        entries = [:]
        settled = [:]
        settledOrder = []
    }

    // MARK: - Внутреннее

    private func pump(_ key: Key, id: UInt64) async -> OptimisticSettlement {
        var transientFailures = 0
        defer { if entries[key]?.id == id || entries[key] == nil { pumps[key] = nil } }
        while true {
            if isOptimistic, pacing.debounce > .zero {
                do {
                    try await Task.sleep(for: pacing.debounce)
                } catch {
                    return abandon(key, id: id)
                }
            }
            guard let entry = entries[key], entry.id == id else { return .abandoned }
            if entry.desired == entry.confirmed {
                return finish(key, value: entry.confirmed)
            }
            let target = entry.desired
            let signpostID = Signposts.actions.makeSignpostID()
            let interval = Signposts.actions.beginInterval("OptimisticSend", id: signpostID, "\(self.label, privacy: .public)")
            do {
                let reported = try await entry.operation.send(entry.confirmed, target)
                Signposts.actions.endInterval("OptimisticSend", interval, "ok")
                guard var after = entries[key], after.id == id else { return .abandoned }
                let truth = reported ?? target
                tick &+= 1
                after.confirmed = truth
                after.confirmedTick = tick
                transientFailures = 0
                if after.desired == target {
                    // Сервер поправил (переключатель на его стороне был в другом
                    // положении) — показываем его. Без оптимизма показываем только сейчас.
                    if truth != target {
                        after.desired = truth
                        after.operation.apply(truth)
                    } else if !isOptimistic {
                        after.operation.apply(truth)
                    }
                }
                entries[key] = after
            } catch {
                Signposts.actions.endInterval("OptimisticSend", interval, "failed")
                guard let after = entries[key], after.id == id else { return .abandoned }
                let kind = ActionFailureKind(error)
                if kind == .cancelled { return abandon(key, id: id) }
                if kind == .transient, case .retry(let attempts) = after.operation.retry, transientFailures < attempts {
                    let delay = pacing.retryDelays.isEmpty
                        ? Duration.zero
                        : pacing.retryDelays[min(transientFailures, pacing.retryDelays.count - 1)]
                    transientFailures += 1
                    do {
                        try await Task.sleep(for: delay)
                    } catch {
                        return abandon(key, id: id)
                    }
                    continue
                }
                entries[key] = nil
                Signposts.actions.emitEvent("OptimisticRollback", "\(self.label, privacy: .public)")
                if isOptimistic, after.desired != after.confirmed {
                    after.operation.apply(after.confirmed)
                }
                after.operation.failed(error)
                return .rolledBack
            }
        }
    }

    /// Действие решено: запоминаем подтверждённое, чтобы ответ чтения, начатого раньше,
    /// его не откатил.
    private func finish(_ key: Key, value: Value) -> OptimisticSettlement {
        entries[key] = nil
        tick &+= 1
        if settled[key] == nil { settledOrder.append(key) }
        settled[key] = Settled(value: value, tick: tick)
        if settledOrder.count > settledLimit {
            let overflow = settledOrder.count - settledLimit
            for old in settledOrder.prefix(overflow) { settled[old] = nil }
            settledOrder.removeFirst(overflow)
        }
        return .confirmed
    }

    /// Задачу сняли (отмена, `reset`). Показанное не трогаем: следующее чтение с
    /// сервера покажет правду.
    private func abandon(_ key: Key, id: UInt64) -> OptimisticSettlement {
        if entries[key]?.id == id { entries[key] = nil }
        return .abandoned
    }
}

extension Error {
    /// Повтор действия, уже применённого на сервере: «поставить» отвечает 409 (уже
    /// стоит), «снять» — 404 (уже снято). Для движка это успех, а не откат: запрос,
    /// чей ответ потерялся, и его повтор не должны выглядеть для человека ошибкой.
    func isAlreadyApplied(turningOn: Bool) -> Bool {
        guard let code = (self as? APIError)?.code else { return false }
        return turningOn ? code == .conflict : code == .notFound
    }
}

extension Error {
    /// Текст плашки после отката оптимистичного действия. Без связи — прямо об этом и о
    /// том, что изменение не сохранилось: «Нет связи с сервером» не говорит, что
    /// переключатель вернулся назад.
    var rollbackMessage: String {
        ActionFailureKind(self) == .transient
            ? String(localized: "optimistic.offline", defaultValue: "Нет связи — изменение не сохранилось")
            : userMessage
    }
}
