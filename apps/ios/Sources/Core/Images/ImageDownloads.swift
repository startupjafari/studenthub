import Foundation
import os

/// Одна загрузка на картинку, сколько бы ячеек её ни ждало (итерация 6, п. 36 аудита).
///
/// Ключ — адрес без подписи (`ImageDiskCache.key`). Общая задача сначала смотрит диск,
/// потом сеть и кладёт ответ на диск — один раз, а не каждым ждущим. Ждущий ушёл
/// (ячейка уехала с экрана) — его место освобождается; ушли все — загрузка снимается.
/// Декодирование — у каждого своё: копии под разные размеры из одних байтов.
///
/// Доля скачанного раздаётся всем ждущим (кольцо прогресса на плитке переписки);
/// пришедший позже сразу получает уже известную долю. Сбой не запоминается: следующий
/// запрос — новая загрузка.
actor ImageDownloads {
    static let shared = ImageDownloads(disk: .shared, fetchWithProgress: { url, progress in
        await ImageDownloads.network(url, progress: progress)
    })

    /// Что пришло из сети: байты и до какого момента их можно держать на диске (`nil` —
    /// не класть).
    struct Fetched: Sendable {
        let data: Data
        let expires: Date?
    }

    /// Доля скачанного, 0…1.
    typealias Progress = @Sendable (Double) -> Void

    private struct Entry {
        let id: UInt64
        let task: Task<Data?, Never>
        var waiters: Int
        /// Кому сообщать долю: ждущие, которые о ней просили.
        var listeners: [UInt64: Progress] = [:]
        /// Последняя известная доля — для того, кто присоединится позже.
        var fraction: Double?
    }

    private let disk: ImageDiskCache
    private let fetch: @Sendable (URL, @escaping Progress) async -> Fetched?
    private var entries: [String: Entry] = [:]
    private var nextID: UInt64 = 0

    /// Загрузчик с сетью без прогресса (тесты).
    init(disk: ImageDiskCache = .shared, fetch: @escaping @Sendable (URL) async -> Fetched?) {
        self.disk = disk
        self.fetch = { url, _ in await fetch(url) }
    }

    /// Загрузчик, сеть которого сообщает долю скачанного.
    init(disk: ImageDiskCache, fetchWithProgress: @escaping @Sendable (URL, @escaping Progress) async -> Fetched?) {
        self.disk = disk
        fetch = fetchWithProgress
    }

    /// Байты картинки: с диска или из сети. `nil` — нет (сеть, статус, отмена).
    /// `progress` — доля скачанного по сети (с диска — без отсчёта).
    func data(for url: URL, progress: Progress? = nil) async -> Data? {
        let key = ImageDiskCache.key(for: url)
        let (task, id, waiter) = join(url, key: key, progress: progress)
        return await withTaskCancellationHandler {
            await task.value
        } onCancel: {
            Task { await self.leave(key, id: id, waiter: waiter) }
        }
    }

    /// Сколько загрузок сейчас в полёте (тесты).
    var inFlightCount: Int { entries.count }

    private func join(_ url: URL, key: String, progress: Progress?) -> (Task<Data?, Never>, UInt64, UInt64) {
        nextID &+= 1
        let waiter = nextID
        if var entry = entries[key] {
            entry.waiters += 1
            if let progress {
                entry.listeners[waiter] = progress
                if let fraction = entry.fraction { progress(fraction) }
            }
            entries[key] = entry
            Signposts.images.emitEvent("ImageJoined")
            return (entry.task, entry.id, waiter)
        }
        let id = waiter
        let disk = disk
        let fetch = fetch
        let generation = disk.generation
        let task = Task<Data?, Never> {
            // Задача унаследовала изоляцию актора: снять себя с полёта можно сразу.
            defer { self.finish(key, id: id) }
            if let stored = await disk.data(for: key) {
                Signposts.images.emitEvent("ImageDiskHit")
                return stored
            }
            guard !Task.isCancelled else { return nil }
            let fetched = await fetch(url) { fraction in
                Task { await self.report(key, id: id, fraction: fraction) }
            }
            guard let fetched else { return nil }
            if let expires = fetched.expires {
                disk.store(fetched.data, for: key, expires: expires, generation: generation)
            }
            return fetched.data
        }
        var entry = Entry(id: id, task: task, waiters: 1)
        if let progress { entry.listeners[waiter] = progress }
        entries[key] = entry
        return (task, id, waiter)
    }

    /// Доля скачанного — всем, кто о ней просил. Только вперёд: отсчёты приходят через
    /// отдельные задачи и могут обогнать друг друга.
    private func report(_ key: String, id: UInt64, fraction: Double) {
        guard var entry = entries[key], entry.id == id else { return }
        let clamped = min(max(fraction, 0), 1)
        if let known = entry.fraction, known >= clamped { return }
        entry.fraction = clamped
        entries[key] = entry
        for listener in entry.listeners.values { listener(clamped) }
    }

    /// Ждущий ушёл. Последний — загрузка снимается.
    private func leave(_ key: String, id: UInt64, waiter: UInt64) {
        guard var entry = entries[key], entry.id == id else { return }
        entry.waiters -= 1
        entry.listeners[waiter] = nil
        if entry.waiters <= 0 {
            entry.task.cancel()
            entries[key] = nil
        } else {
            entries[key] = entry
        }
    }

    /// Загрузка закончилась — следующий запрос начнёт новую (уже с диска или из памяти).
    private func finish(_ key: String, id: UInt64) {
        if entries[key]?.id == id { entries[key] = nil }
    }

    private static let log = Logger(subsystem: "kz.studenthub", category: "ImageDownloads")

    /// Сеть: успешный ответ и срок хранения из заголовков. Сбой пишется в журнал с
    /// причиной (статус, код ошибки): без неё «картинка не грузится» не разобрать —
    /// протухшая подпись (403), нет объекта (404), не тот порт хранилища (HTML).
    static func network(_ url: URL, progress: @escaping Progress = { _ in }) async -> Fetched? {
        let signpost = Signposts.images.beginInterval("ImageFetch")
        let relay = ImageProgressRelay(report: progress)
        let loaded: (Data, URLResponse)
        do {
            loaded = try await URLSession.shared.data(from: url, delegate: relay)
        } catch {
            Signposts.images.endInterval("ImageFetch", signpost, "bytes: 0")
            let code = (error as? URLError)?.code
            // Отмена — ячейка ушла с экрана, это не сбой.
            if code != .cancelled, !(error is CancellationError) {
                log.error(
                    "Картинка не скачана: \(url.host() ?? "-", privacy: .public) \(url.path(), privacy: .private) — \(error.localizedDescription, privacy: .public)"
                )
            }
            return nil
        }
        let (data, response) = loaded
        Signposts.images.endInterval("ImageFetch", signpost, "bytes: \(data.count)")
        guard let http = response as? HTTPURLResponse else {
            // Не HTTP (свой файл) — на диск кеша не кладём, он и так на диске.
            return Fetched(data: data, expires: nil)
        }
        guard (200..<300).contains(http.statusCode) else {
            log.error(
                "Картинка не скачана: \(url.host() ?? "-", privacy: .public) \(url.path(), privacy: .private) — HTTP \(http.statusCode, privacy: .public)"
            )
            return nil
        }
        if let type = http.value(forHTTPHeaderField: "Content-Type")?.lowercased(), type.hasPrefix("text/html") {
            // Вместо картинки — страница (консоль хранилища на публичном домене вместо
            // S3 API): декодер её не прочтёт, а на диске она осталась бы на неделю.
            log.error("Вместо картинки пришёл HTML: \(url.host() ?? "-", privacy: .public)")
            return nil
        }
        progress(1)
        return Fetched(data: data, expires: ImageDiskCache.expiry(for: http, now: Date()))
    }
}

/// Доля скачанного из задачи `URLSession`: асинхронный `data(from:)` сам прогресса не
/// даёт. Отсчёт — шагами не мельче 2 %: кольцу чаще не нужно, а каждая доля — задача.
private final class ImageProgressRelay: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let report: ImageDownloads.Progress
    private let lock = NSLock()
    private var observation: NSKeyValueObservation?
    private var reported: Double = 0

    init(report: @escaping ImageDownloads.Progress) {
        self.report = report
    }

    func urlSession(_ session: URLSession, didCreateTask task: URLSessionTask) {
        let observation = task.progress.observe(\.fractionCompleted) { [weak self] progress, _ in
            self?.forward(progress.fractionCompleted)
        }
        lock.withLock { self.observation = observation }
    }

    private func forward(_ fraction: Double) {
        guard fraction.isFinite else { return }
        let due = lock.withLock { () -> Bool in
            guard fraction - reported >= 0.02 || (fraction >= 1 && reported < 1) else { return false }
            reported = fraction
            return true
        }
        if due { report(fraction) }
    }

    deinit {
        observation?.invalidate()
    }
}
