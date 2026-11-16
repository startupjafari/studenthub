import CryptoKit
import Foundation
import os

/// Ключ сохранённого ответа: чей, какой маршрут, с какими параметрами и на каком языке.
///
/// Пользователь — обязательная часть ключа: два человека на одном телефоне не увидят
/// ответы друг друга даже при сбое очистки. Параметры — отсортированы: порядок в
/// запросе не делает два одинаковых ответа разными.
struct ScreenCacheKey: Hashable, Sendable {
    let owner: String
    let method: String
    let path: String
    let query: String
    let language: String

    init(owner: String, method: String, path: String, query: [URLQueryItem], language: String) {
        self.owner = owner
        self.method = method
        self.path = path
        // Имена и значения экранированы: значение с «&» или «=» не склеится с соседним
        // параметром в чужой ключ.
        func escaped(_ text: String) -> String {
            text.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? text
        }
        self.query = query
            .map { "\(escaped($0.name))=\(escaped($0.value ?? ""))" }
            .sorted()
            .joined(separator: "&")
        self.language = language
    }

    /// Строка ключа — только в памяти процесса; на диск уходит её хеш.
    var raw: String { "\(owner)|\(method) \(path)?\(query)|\(language)" }

    /// Имя файла: SHA-256 ключа. Ни id человека, ни маршрут в имени не видны.
    var fileName: String {
        SHA256.hash(data: Data(raw.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

/// Сохранённые ответы экранов на диске и в памяти (итерация 5, `CHANGELOG-PERF.md`).
///
/// - Файлы — в `Caches/ScreenCache/v<схема>-<сборка>/`: новая сборка начинает с пустого
///   каталога, а старые каталоги удаляются фоном — модель, поменявшаяся в сборке, не
///   встретит чужой формат (а если встретит, ошибка разбора — промах, не падение).
/// - Класс защиты — «до первой разблокировки»: тихий пуш после перезагрузки файлов не
///   прочтёт. Ошибка чтения — промах кеша и только: ничего не стирается.
/// - Лимиты: не старше 7 дней, всего не больше 20 МБ (лишнее — самые давние записи), ответ
///   больше 2 МБ не сохраняется.
/// - Чей кеш — `owner`: без него ничего не читается и не пишется. Выход из аккаунта
///   стирает каталог и меняет поколение: запись, начатая до выхода, в кеш следующего
///   человека не попадёт.
///
/// Вся работа с диском — на одной последовательной очереди: удаление при выходе не
/// разойдётся с чтением и записью.
final class ScreenCacheStore: @unchecked Sendable {
    struct Limits: Sendable {
        var maxBytes: Int
        var trimTo: Int
        var maxAge: TimeInterval
        var maxEntryBytes: Int

        static let standard = Limits(
            maxBytes: 20 * 1024 * 1024,
            trimTo: 15 * 1024 * 1024,
            maxAge: 7 * 24 * 60 * 60,
            maxEntryBytes: 2 * 1024 * 1024
        )
    }

    /// Формат записи. Поднять, если меняется то, что лежит в файле (не модели API: от
    /// них защищает номер сборки в пути).
    static let schemaVersion = 1

    static let shared = ScreenCacheStore()

    private let root: URL
    private let directory: URL
    private let limits: Limits
    private let isLocked: @Sendable () -> Bool
    private let now: @Sendable () -> Date
    private let io = DispatchQueue(label: "kz.studenthub.screen-cache", qos: .utility)
    private let memory: NSCache<NSString, NSData> = {
        let cache = NSCache<NSString, NSData>()
        cache.totalCostLimit = 4 * 1024 * 1024
        return cache
    }()
    private let log = Logger(subsystem: "kz.studenthub", category: "ScreenCache")

    private let lock = NSLock()
    private var storedOwner: String?
    private var storedGeneration = 0
    private var writesSinceTrim = 0

    init(
        root: URL? = nil,
        build: String = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0",
        limits: Limits = .standard,
        isLocked: @escaping @Sendable () -> Bool = { AppServices.databaseHolder.isLocked },
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        self.root = root ?? caches.appending(path: "ScreenCache", directoryHint: .isDirectory)
        directory = self.root.appending(path: "v\(Self.schemaVersion)-\(build)", directoryHint: .isDirectory)
        self.limits = limits
        self.isLocked = isLocked
        self.now = now
    }

    /// Чей кеш сейчас. `nil` — никто не вошёл: кеш не читается и не пишется.
    var owner: String? { lock.withLock { storedOwner } }

    /// Поколение: растёт с каждой очисткой.
    var generation: Int { lock.withLock { storedGeneration } }

    /// Вошёл `owner` (`LocalData.claim`). Другой человек — прежнее стирается.
    func claim(owner: String) {
        let previous = lock.withLock { () -> String? in
            defer { storedOwner = owner }
            return storedOwner
        }
        if let previous, previous != owner { erase(keepingOwner: owner) }
    }

    /// Выход из аккаунта (`LocalData.erase`): всё стирается, запись в полёте отбрасывается.
    func erase() {
        erase(keepingOwner: nil)
    }

    private func erase(keepingOwner owner: String?) {
        lock.withLock {
            storedGeneration += 1
            storedOwner = owner
            writesSinceTrim = 0
        }
        memory.removeAllObjects()
        let root = root
        io.async {
            // Удаление не требует чтения: работает и до первой разблокировки.
            try? FileManager.default.removeItem(at: root)
        }
    }

    /// Сохранённый ответ или `nil`. Ошибка чтения (данные заперты, файла нет, он
    /// испорчен) — промах, а не повод стирать.
    func data(for key: ScreenCacheKey) async -> Data? {
        guard key.owner == owner else { return nil }
        let memoryKey = key.raw as NSString
        if let hit = memory.object(forKey: memoryKey) { return hit as Data }
        let url = directory.appending(path: key.fileName)
        let maxAge = limits.maxAge
        let now = now
        let data: Data? = await withCheckedContinuation { continuation in
            io.async {
                guard
                    let values = try? url.resourceValues(forKeys: [.contentModificationDateKey]),
                    let stored = values.contentModificationDate,
                    now().timeIntervalSince(stored) <= maxAge,
                    let data = try? Data(contentsOf: url, options: .mappedIfSafe)
                else {
                    continuation.resume(returning: nil)
                    return
                }
                continuation.resume(returning: data)
            }
        }
        guard let data, key.owner == owner else { return nil }
        memory.setObject(data as NSData, forKey: memoryKey, cost: data.count)
        return data
    }

    /// Сохранить ответ. `generation` — поколение на момент начала запроса: кеш очищен с
    /// тех пор — запись не нужна.
    func store(_ data: Data, for key: ScreenCacheKey, generation: Int) {
        guard data.count <= limits.maxEntryBytes else { return }
        let accepted = lock.withLock { storedGeneration == generation && storedOwner == key.owner }
        guard accepted else { return }
        memory.setObject(data as NSData, forKey: key.raw as NSString, cost: data.count)
        let directory = directory
        let url = directory.appending(path: key.fileName)
        io.async { [self] in
            // Ещё раз под замком: между постановкой в очередь и записью мог случиться выход.
            guard lock.withLock({ storedGeneration == generation }) else { return }
            // До первой разблокировки файл класса «до первой разблокировки» не создать —
            // и пытаться незачем.
            guard !isLocked() else { return }
            do {
                try FileManager.default.createDirectory(
                    at: directory,
                    withIntermediateDirectories: true,
                    attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
                )
                try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            } catch {
                log.error("Ответ экрана не сохранён: \(error.localizedDescription, privacy: .public)")
                return
            }
            let shouldTrim = lock.withLock { () -> Bool in
                writesSinceTrim += 1
                guard writesSinceTrim >= 20 else { return false }
                writesSinceTrim = 0
                return true
            }
            if shouldTrim { trimNow() }
        }
    }

    /// Фоновая уборка при запуске: каталоги прежних сборок и записи сверх лимитов.
    func housekeeping() {
        io.async { [self] in
            guard !isLocked() else { return }
            let current = directory.lastPathComponent
            let siblings = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
            for url in siblings where url.lastPathComponent != current {
                try? FileManager.default.removeItem(at: url)
            }
            trimNow()
        }
    }

    /// Дождаться, пока очередь диска выполнит всё поставленное (тесты).
    func flush() async {
        await withCheckedContinuation { continuation in
            io.async { continuation.resume() }
        }
    }

    /// Убрать просроченное и, если всё ещё больше лимита, самое давнее. Только на `io`.
    private func trimNow() {
        let keys: [URLResourceKey] = [.contentModificationDateKey, .totalFileAllocatedSizeKey, .fileSizeKey]
        guard
            let files = try? FileManager.default.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: keys
            )
        else { return }
        let moment = now()
        var entries: [(url: URL, date: Date, size: Int)] = []
        for url in files {
            guard let values = try? url.resourceValues(forKeys: Set(keys)) else { continue }
            let date = values.contentModificationDate ?? .distantPast
            if moment.timeIntervalSince(date) > limits.maxAge {
                try? FileManager.default.removeItem(at: url)
                continue
            }
            // Логический размер: лимит — про объём ответов, а не про блоки файловой системы.
            entries.append((url, date, values.fileSize ?? values.totalFileAllocatedSize ?? 0))
        }
        var total = entries.reduce(0) { $0 + $1.size }
        guard total > limits.maxBytes else { return }
        for entry in entries.sorted(by: { $0.date < $1.date }) {
            guard total > limits.trimTo else { break }
            try? FileManager.default.removeItem(at: entry.url)
            total -= entry.size
        }
    }
}
