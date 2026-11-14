import Foundation

/// Результаты опросов по `pollID` (IOS_RULES 9.8.22).
///
/// Пузырь опроса перечитывал результаты при каждом появлении ячейки, а два пузыря одного
/// опроса (оригинал и пересылка) — каждый свои. Теперь у опроса один «носитель»:
/// - при появлении — кэш, если он свежее `minInterval` и с тех пор не было `poll:updated`
///   (версия сигнала та же);
/// - один запрос в полёте на опрос: второй пузырь ждёт его ответа;
/// - голос и закрытие перечитывают принудительно.
/// Вне экрана не опрашивается ничего: чтение запускает только появившийся пузырь.
@MainActor
final class PollResultsCache {
    static let minInterval: TimeInterval = 5

    private struct Entry {
        let results: PollResultsDTO
        let version: Int
        let fetchedAt: Date
    }

    private var entries: [String: Entry] = [:]
    private var inFlight: [String: (id: UInt64, version: Int, task: Task<PollResultsDTO?, Never>)] = [:]
    private var nextID: UInt64 = 0
    /// Растёт с каждой очисткой: ответ, пришедший после выхода, в кэш не попадает.
    private var generation = 0
    private let now: () -> Date

    init(now: @escaping () -> Date = Date.init) {
        self.now = now
    }

    /// То, что уже известно, — для первого кадра пузыря.
    func cached(_ pollID: String) -> PollResultsDTO? {
        entries[pollID]?.results
    }

    /// Результаты опроса: из кэша, из запроса в полёте или новым запросом. Сбой — прежние
    /// результаты (или `nil`), пузырь остаётся как был.
    func load(
        _ pollID: String,
        version: Int,
        force: Bool = false,
        fetch: @escaping @Sendable () async throws -> PollResultsDTO
    ) async -> PollResultsDTO? {
        if !force, let entry = entries[pollID], entry.version >= version,
           now().timeIntervalSince(entry.fetchedAt) < Self.minInterval {
            return entry.results
        }
        // Запрос в полёте начат не раньше нужной версии — его ответ годится. После голоса
        // (`force`) — нет: он мог уйти до голоса и вернуть старое.
        if !force, let running = inFlight[pollID], running.version >= version {
            return await running.task.value ?? entries[pollID]?.results
        }
        nextID &+= 1
        let id = nextID
        let generation = generation
        let task = Task { try? await fetch() }
        inFlight[pollID] = (id, version, task)
        let fetched = await task.value
        if inFlight[pollID]?.id == id { inFlight[pollID] = nil }
        if let fetched, self.generation == generation {
            entries[pollID] = Entry(results: fetched, version: version, fetchedAt: now())
        }
        return fetched ?? entries[pollID]?.results
    }

    /// Выход из аккаунта: свои голоса (`myOptionIds`) следующему человеку не достаются.
    func clear() {
        generation += 1
        entries = [:]
        inFlight = [:]
    }
}
