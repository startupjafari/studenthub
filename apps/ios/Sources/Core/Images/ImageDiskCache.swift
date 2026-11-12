import CryptoKit
import Foundation
import os

/// Картинки на диске: исходные байты, как пришли из сети (итерация 6, п. 35 аудита).
///
/// - Ключ — адрес без подписи (`key(for:)`): подписанные ссылки меняются при каждом
///   обновлении ленты, и кеш по полному адресу промахивался бы всякий раз. Имя файла —
///   SHA-256 ключа.
/// - Хранятся исходные байты, а не декодированные кадры: копию под размер вида делает
///   общий даунсемплинг (`ImageDownsampler`) — одна запись служит и миниатюре, и плитке.
/// - Срок жизни — из `Cache-Control: max-age` или `Expires`, без них — 7 дней, не больше
///   30; `no-store`, `no-cache` и `max-age=0` — на диск не кладём. Срок записан в начале
///   файла.
/// - Объём — до 200 МБ: сверх — уходят давно не открывавшиеся (дата файла обновляется
///   при чтении, то есть это LRU), до 150 МБ. Уборка — фоном при запуске и каждые 30 записей.
/// - Класс защиты — «до первой разблокировки»; ошибка чтения — промах, ничего не стирается.
/// - Выход из аккаунта стирает всё, включая аватары: платформа закрытая, «публичных»
///   картинок в ней нет, а смена аккаунта не должна показать чужое ни на кадр.
final class ImageDiskCache: @unchecked Sendable {
    struct Limits: Sendable {
        var maxBytes: Int
        var trimTo: Int
        var defaultLifetime: TimeInterval
        var maxLifetime: TimeInterval
        var maxEntryBytes: Int

        static let standard = Limits(
            maxBytes: 200 * 1024 * 1024,
            trimTo: 150 * 1024 * 1024,
            defaultLifetime: 7 * 24 * 60 * 60,
            maxLifetime: 30 * 24 * 60 * 60,
            maxEntryBytes: 30 * 1024 * 1024
        )
    }

    static let shared = ImageDiskCache()

    /// Формат файла: метка, срок (секунды с 1970, 8 байт), затем байты картинки. Новая
    /// версия — новый каталог.
    private static let formatVersion = 1
    private static let magic = Data("SHI1".utf8)
    private static let headerLength = 12

    private let root: URL
    private let directory: URL
    private let limits: Limits
    private let isLocked: @Sendable () -> Bool
    private let now: @Sendable () -> Date
    private let io = DispatchQueue(label: "kz.studenthub.image-disk-cache", qos: .utility)
    private let log = Logger(subsystem: "kz.studenthub", category: "ImageDiskCache")

    private let lock = NSLock()
    private var storedGeneration = 0
    private var writesSinceTrim = 0

    init(
        root: URL? = nil,
        limits: Limits = .standard,
        isLocked: @escaping @Sendable () -> Bool = { AppServices.databaseHolder.isLocked },
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        self.root = root ?? caches.appending(path: "Images", directoryHint: .isDirectory)
        directory = self.root.appending(path: "v\(Self.formatVersion)", directoryHint: .isDirectory)
        self.limits = limits
        self.isLocked = isLocked
        self.now = now
    }

    /// Поколение: растёт с каждой очисткой. Загрузка, начатая раньше, на диск не пишет.
    var generation: Int { lock.withLock { storedGeneration } }

    // MARK: - Ключ и срок

    /// Параметры подписи и одноразового доступа: от них картинка не меняется.
    private static let volatileParameters: Set<String> = [
        "t", "token", "expires", "signature", "sig", "se", "sp", "sv", "sr", "st", "key-pair-id", "policy",
    ]

    /// Ключ файла — адрес без подписи. Параметры, которые меняют саму картинку
    /// (размер, версия), остаются в ключе.
    static func key(for url: URL) -> String {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return url.absoluteString
        }
        let kept = (components.queryItems ?? []).filter { item in
            let name = item.name.lowercased()
            return !name.hasPrefix("x-amz-") && !volatileParameters.contains(name)
        }
        components.queryItems = kept.isEmpty ? nil : kept.sorted { $0.name < $1.name }
        components.fragment = nil
        return components.string ?? url.absoluteString
    }

    /// До какого момента ответ можно держать на диске; `nil` — не класть вовсе.
    static func expiry(for response: HTTPURLResponse, now: Date, limits: Limits = .standard) -> Date? {
        let control = (response.value(forHTTPHeaderField: "Cache-Control") ?? "").lowercased()
        let directives = control.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        if directives.contains("no-store") || directives.contains("no-cache") { return nil }
        let lifetime: TimeInterval
        if let maxAge = directives.first(where: { $0.hasPrefix("max-age=") }),
           let seconds = TimeInterval(maxAge.dropFirst("max-age=".count)) {
            guard seconds > 0 else { return nil }
            lifetime = seconds
        } else if let header = response.value(forHTTPHeaderField: "Expires"),
                  let date = httpDate.date(from: header) {
            lifetime = date.timeIntervalSince(now)
            guard lifetime > 0 else { return nil }
        } else {
            lifetime = limits.defaultLifetime
        }
        return now.addingTimeInterval(min(lifetime, limits.maxLifetime))
    }

    /// Дата HTTP (RFC 7231). Форматтер не меняется после создания — разбор
    /// потокобезопасен.
    private static let httpDate: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "GMT")
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
        return formatter
    }()

    // MARK: - Чтение и запись

    /// Байты картинки или `nil`: нет, просрочено, заперто до разблокировки, чужой формат.
    /// Ни одна из этих причин не стирает файл (просроченный уберёт уборка).
    func data(for key: String) async -> Data? {
        let url = directory.appending(path: Self.fileName(for: key))
        let now = now
        return await withCheckedContinuation { continuation in
            io.async {
                guard
                    let file = try? Data(contentsOf: url, options: .mappedIfSafe),
                    let payload = Self.payload(of: file, now: now())
                else {
                    continuation.resume(returning: nil)
                    return
                }
                // Открыли — свежая дата файла: уборка уносит давно не открывавшиеся (LRU).
                try? FileManager.default.setAttributes([.modificationDate: now()], ofItemAtPath: url.path())
                continuation.resume(returning: payload)
            }
        }
    }

    /// Положить байты до `expires`. `generation` — на начало загрузки: очищено с тех пор —
    /// не кладём.
    func store(_ data: Data, for key: String, expires: Date, generation: Int) {
        guard data.count <= limits.maxEntryBytes, !data.isEmpty else { return }
        let directory = directory
        let url = directory.appending(path: Self.fileName(for: key))
        io.async { [self] in
            guard lock.withLock({ storedGeneration == generation }), !isLocked() else { return }
            var file = Self.magic
            var seconds = UInt64(max(0, expires.timeIntervalSince1970)).bigEndian
            withUnsafeBytes(of: &seconds) { file.append(contentsOf: $0) }
            file.append(data)
            do {
                try FileManager.default.createDirectory(
                    at: directory,
                    withIntermediateDirectories: true,
                    attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
                )
                try file.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            } catch {
                log.error("Картинка не сохранена на диск: \(error.localizedDescription, privacy: .public)")
                return
            }
            let shouldTrim = lock.withLock { () -> Bool in
                writesSinceTrim += 1
                guard writesSinceTrim >= 30 else { return false }
                writesSinceTrim = 0
                return true
            }
            if shouldTrim { trimNow() }
        }
    }

    /// Выход из аккаунта: стереть всё. Удаление не требует чтения — работает и до первой
    /// разблокировки.
    func eraseAll() {
        lock.withLock {
            storedGeneration += 1
            writesSinceTrim = 0
        }
        let root = root
        io.async { try? FileManager.default.removeItem(at: root) }
    }

    /// Уборка фоном: каталоги прежних форматов, просроченное, сверх объёма.
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

    /// Дождаться очереди диска (тесты).
    func flush() async {
        await withCheckedContinuation { continuation in
            io.async { continuation.resume() }
        }
    }

    // MARK: - Внутреннее

    static func fileName(for key: String) -> String {
        SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// Байты картинки из файла, если формат свой и срок не вышел.
    private static func payload(of file: Data, now: Date) -> Data? {
        guard file.count > headerLength, file.prefix(magic.count) == magic else { return nil }
        let seconds = file.dropFirst(magic.count).prefix(8).reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
        guard Date(timeIntervalSince1970: TimeInterval(seconds)) > now else { return nil }
        return Data(file.dropFirst(headerLength))
    }

    /// Просроченное — удалить; сверх объёма — давно не открывавшееся. Только на `io`.
    private func trimNow() {
        let keys: [URLResourceKey] = [.contentModificationDateKey, .fileSizeKey]
        guard
            let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: keys)
        else { return }
        let moment = now()
        var entries: [(url: URL, used: Date, size: Int)] = []
        for url in files {
            guard let values = try? url.resourceValues(forKeys: Set(keys)) else { continue }
            // Срок — в заголовке: читаем только его.
            if let handle = try? FileHandle(forReadingFrom: url) {
                let header = (try? handle.read(upToCount: Self.headerLength)) ?? Data()
                try? handle.close()
                if header.count == Self.headerLength, header.prefix(Self.magic.count) == Self.magic {
                    let seconds = header.dropFirst(Self.magic.count).reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
                    if Date(timeIntervalSince1970: TimeInterval(seconds)) <= moment {
                        try? FileManager.default.removeItem(at: url)
                        continue
                    }
                }
            }
            entries.append((url, values.contentModificationDate ?? .distantPast, values.fileSize ?? 0))
        }
        var total = entries.reduce(0) { $0 + $1.size }
        guard total > limits.maxBytes else { return }
        for entry in entries.sorted(by: { $0.used < $1.used }) {
            guard total > limits.trimTo else { break }
            try? FileManager.default.removeItem(at: entry.url)
            total -= entry.size
        }
    }
}
