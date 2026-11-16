import Foundation
#if canImport(Network)
    import Network
#endif

/// Досылка неотправленных сообщений на всё приложение (P0-2 аудита).
///
/// Раньше очередь разбиралась только при открытии того же чата: сообщение, написанное в
/// метро, висело «не отправлено», пока человек не вернётся в эту переписку. Теперь её
/// разбирает один сервис, которому всё равно, какой экран открыт. Повод — всё, после
/// чего сеть могла появиться: новое подключение сокета, возврат приложения на передний
/// план, смена сети (`NWPathMonitor`). Не дослали — повтор с растущей паузой 2 → 60 с.
///
/// Чаты независимы: сбой в одном не держит остальные. Внутри чата порядок сохраняется —
/// `MessageOutbox.flush` останавливается на первой временной неудаче, а отвергнутое
/// сервером по существу пропускает и само не повторяет. Повтор безопасен: у каждого
/// сообщения свой ключ `nonce`, и сервер второй раз его не создаст.
///
/// Вложения сервис не досылает: повторная выгрузка файла (до 500 МБ) без ведома человека,
/// возможно по мобильной сети, — не то же самое, что текст. Им остаётся «Повторить».
actor OutboxService {
    typealias Flush = @Sendable (_ chatID: String) async -> Bool
    typealias StuckChats = @Sendable () async -> [String]
    typealias Sleep = @Sendable (Duration) async throws -> Void

    private let flush: Flush
    private let stuckChats: StuckChats
    private let sleep: Sleep

    private var running = false
    /// Повод пришёл во время прохода — после него нужен ещё один: строка могла лечь в
    /// очередь, когда проход её уже миновал.
    private var rerun = false
    private var retryTask: Task<Void, Never>?
    private var retryDelay = OutboxService.firstRetryDelay
    #if canImport(Network)
        private var monitor: NWPathMonitor?
    #endif

    init(
        flush: @escaping Flush,
        stuckChats: @escaping StuckChats,
        sleep: @escaping Sleep = { try await Task.sleep(for: $0) }
    ) {
        self.flush = flush
        self.stuckChats = stuckChats
        self.sleep = sleep
    }

    /// Сервис приложения поверх общей базы.
    static func live(database: @escaping @Sendable () -> AppDatabase = { AppServices.database }) -> OutboxService {
        OutboxService(
            flush: { chatID in await MessageOutbox(database: database()).flush(chatID: chatID) },
            stuckChats: { await MessageOutbox(database: database()).stuckChatIDs() }
        )
    }

    deinit {
        retryTask?.cancel()
        #if canImport(Network)
            monitor?.cancel()
        #endif
    }

    /// Следить за сменой сети. Повторный вызов ничего не делает.
    func start() {
        #if canImport(Network)
            guard monitor == nil else { return }
            let monitor = NWPathMonitor()
            monitor.pathUpdateHandler = { [weak self] path in
                guard path.status == .satisfied, let self else { return }
                Task { await self.kick() }
            }
            monitor.start(queue: DispatchQueue(label: "kz.studenthub.outbox.path"))
            self.monitor = monitor
        #endif
    }

    /// Повод досылать: сеть могла появиться. Пауза повтора сбрасывается — человек не
    /// должен ждать минуту, если связь вернулась сейчас.
    func kick() async {
        retryTask?.cancel()
        retryTask = nil
        retryDelay = Self.firstRetryDelay
        await run()
    }

    /// Пауза до следующего повтора — для тестов.
    var nextRetryDelay: Duration { retryDelay }

    // MARK: - Проход

    private func run() async {
        guard !running else {
            rerun = true
            return
        }
        running = true
        var delivered = true
        repeat {
            rerun = false
            delivered = await pass()
        } while rerun
        running = false
        if delivered {
            retryDelay = Self.firstRetryDelay
        } else {
            scheduleRetry()
        }
    }

    /// Все чаты с застрявшими сообщениями — по очереди, но независимо друг от друга.
    private func pass() async -> Bool {
        var delivered = true
        for chatID in await stuckChats() {
            if Task.isCancelled { return false }
            if await !flush(chatID) { delivered = false }
        }
        return delivered
    }

    private func scheduleRetry() {
        guard retryTask == nil else { return }
        let delay = Self.jittered(retryDelay)
        retryDelay = min(retryDelay * 2, Self.maxRetryDelay)
        retryTask = Task { [weak self, sleep] in
            do { try await sleep(delay) } catch { return }
            await self?.retryFired()
        }
    }

    private func retryFired() async {
        retryTask = nil
        await run()
    }

    /// Разброс ±20%: телефоны, у которых сеть вернулась одновременно (аудитория, метро),
    /// не стучатся в сервер одной волной.
    static func jittered(_ delay: Duration, unit: Double = Double.random(in: 0...1)) -> Duration {
        delay * (0.8 + 0.4 * unit)
    }

    static let firstRetryDelay: Duration = .seconds(2)
    static let maxRetryDelay: Duration = .seconds(60)
}
