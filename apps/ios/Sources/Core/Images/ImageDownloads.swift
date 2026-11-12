import Foundation
import os

/// Одна загрузка на картинку, сколько бы ячеек её ни ждало (итерация 6, п. 36 аудита).
///
/// Ключ — адрес без подписи (`ImageDiskCache.key`). Общая задача сначала смотрит диск,
/// потом сеть и кладёт ответ на диск — один раз, а не каждым ждущим. Ждущий ушёл
/// (ячейка уехала с экрана) — его место освобождается; ушли все — загрузка снимается.
/// Декодирование — у каждого своё: копии под разные размеры из одних байтов.
actor ImageDownloads {
    static let shared = ImageDownloads()

    /// Что пришло из сети: байты и до какого момента их можно держать на диске (`nil` —
    /// не класть).
    struct Fetched: Sendable {
        let data: Data
        let expires: Date?
    }

    private struct Entry {
        let id: UInt64
        let task: Task<Data?, Never>
        var waiters: Int
    }

    private let disk: ImageDiskCache
    private let fetch: @Sendable (URL) async -> Fetched?
    private var entries: [String: Entry] = [:]
    private var nextID: UInt64 = 0

    init(
        disk: ImageDiskCache = .shared,
        fetch: @escaping @Sendable (URL) async -> Fetched? = ImageDownloads.network
    ) {
        self.disk = disk
        self.fetch = fetch
    }

    /// Байты картинки: с диска или из сети. `nil` — нет (сеть, статус, отмена).
    func data(for url: URL) async -> Data? {
        let key = ImageDiskCache.key(for: url)
        let (task, id) = join(url, key: key)
        return await withTaskCancellationHandler {
            await task.value
        } onCancel: {
            Task { await self.leave(key, id: id) }
        }
    }

    /// Сколько загрузок сейчас в полёте (тесты).
    var inFlightCount: Int { entries.count }

    private func join(_ url: URL, key: String) -> (Task<Data?, Never>, UInt64) {
        if var entry = entries[key] {
            entry.waiters += 1
            entries[key] = entry
            Signposts.images.emitEvent("ImageJoined")
            return (entry.task, entry.id)
        }
        nextID &+= 1
        let id = nextID
        let disk = disk
        let fetch = fetch
        let generation = disk.generation
        let task = Task<Data?, Never> {
            defer { Task { await self.finish(key, id: id) } }
            if let stored = await disk.data(for: key) {
                Signposts.images.emitEvent("ImageDiskHit")
                return stored
            }
            guard !Task.isCancelled, let fetched = await fetch(url) else { return nil }
            if let expires = fetched.expires {
                disk.store(fetched.data, for: key, expires: expires, generation: generation)
            }
            return fetched.data
        }
        entries[key] = Entry(id: id, task: task, waiters: 1)
        return (task, id)
    }

    /// Ждущий ушёл. Последний — загрузка снимается.
    private func leave(_ key: String, id: UInt64) {
        guard var entry = entries[key], entry.id == id else { return }
        entry.waiters -= 1
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

    /// Сеть: успешный ответ и срок хранения из заголовков.
    static func network(_ url: URL) async -> Fetched? {
        let signpost = Signposts.images.beginInterval("ImageFetch")
        let loaded = try? await URLSession.shared.data(from: url)
        Signposts.images.endInterval("ImageFetch", signpost, "bytes: \(loaded?.0.count ?? 0)")
        guard let (data, response) = loaded else { return nil }
        guard let http = response as? HTTPURLResponse else {
            // Не HTTP (свой файл) — на диск кеша не кладём, он и так на диске.
            return Fetched(data: data, expires: nil)
        }
        guard (200..<300).contains(http.statusCode) else { return nil }
        return Fetched(data: data, expires: ImageDiskCache.expiry(for: http, now: Date()))
    }
}
