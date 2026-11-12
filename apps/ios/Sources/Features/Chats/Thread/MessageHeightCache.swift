import UIKit

/// Высоты сообщений, как их знает Telegram: каждое уже показанное сообщение помнит свою
/// точную высоту — в памяти и на диске, между открытиями чата и запусками. Лента
/// раскладывается по ним сразу, а не по одной оценке на всех, и не дёргается, когда
/// ячейки досчитывают себя.
///
/// Ключ — ширина ленты, размер шрифта и id сообщения; к высоте приложен отпечаток
/// содержимого (`fingerprint`): правка, реакция или прочтение, меняющие пузырь, делают
/// запомненную высоту недействительной.
final class MessageHeightCache: @unchecked Sendable {
    static let shared = MessageHeightCache()

    private struct Entry: Codable {
        let f: UInt64
        let h: Float
    }

    private let lock = NSLock()
    private var entries: [String: Entry] = [:]
    private var loaded = false
    private var dirty = false
    /// Потолок записей на диске: десятки тысяч сообщений — сотни килобайт.
    private static let limit = 30_000

    private let file: URL? = FileManager.default
        .urls(for: .cachesDirectory, in: .userDomainMask).first?
        .appendingPathComponent("message-heights.plist")

    private init() {
        NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil
        ) { [weak self] _ in
            self?.save()
        }
    }

    /// Точная высота, если содержимое с прошлого замера не менялось.
    func height(for key: String, fingerprint: UInt64) -> CGFloat? {
        lock.lock()
        defer { lock.unlock() }
        loadIfNeeded()
        guard let entry = entries[key], entry.f == fingerprint else { return nil }
        return CGFloat(entry.h)
    }

    /// Последняя известная высота — лучшая оценка, когда содержимое чуть поменялось.
    func lastHeight(for key: String) -> CGFloat? {
        lock.lock()
        defer { lock.unlock() }
        loadIfNeeded()
        return entries[key].map { CGFloat($0.h) }
    }

    func store(_ height: CGFloat, for key: String, fingerprint: UInt64) {
        lock.lock()
        defer { lock.unlock() }
        loadIfNeeded()
        if let old = entries[key], old.f == fingerprint, abs(CGFloat(old.h) - height) < 0.5 { return }
        entries[key] = Entry(f: fingerprint, h: Float(height))
        dirty = true
    }

    /// Записать на диск — при уходе в фон и закрытии переписки.
    func save() {
        lock.lock()
        guard dirty, let file else {
            lock.unlock()
            return
        }
        var snapshot = entries
        dirty = false
        lock.unlock()
        if snapshot.count > Self.limit {
            // Порядка записей нет — отбрасываем лишнее как придётся: потерянная высота
            // просто будет посчитана заново.
            snapshot = Dictionary(uniqueKeysWithValues: snapshot.prefix(Self.limit / 2).map { ($0.key, $0.value) })
        }
        DispatchQueue.global(qos: .utility).async {
            guard let data = try? PropertyListEncoder().encode(snapshot) else { return }
            try? data.write(to: file, options: .atomic)
        }
    }

    private func loadIfNeeded() {
        guard !loaded else { return }
        loaded = true
        guard let file, let data = try? Data(contentsOf: file),
            let stored = try? PropertyListDecoder().decode([String: Entry].self, from: data)
        else { return }
        entries = stored
    }

    static func key(id: String, width: CGFloat, category: UIContentSizeCategory) -> String {
        "\(Int(width.rounded()))|\(category.rawValue)|\(id)"
    }
}

extension MessageTimeline.Item {
    /// Отпечаток того, что меняет высоту пузыря: текст, вложения, ответ, реакции и прочие
    /// подробности, место в группе. Стабилен между запусками (FNV-1a), в отличие от
    /// `hashValue`.
    func heightFingerprint(isGroup: Bool, selecting: Bool) -> UInt64 {
        var parts: [String] = [
            message.content,
            message.replyToId ?? "",
            message.replyQuote ?? "",
            message.systemType ?? "",
            message.deletedAt == nil ? "" : "d",
            message.editedAt == nil ? "" : "e",
            message.senderName ?? "",
            isFirstInGroup ? "f" : "",
            isLastInGroup ? "l" : "",
            isOwn ? "o" : "",
            isGroup ? "g" : "",
            selecting ? "s" : "",
            message.extras.map { String(describing: $0) } ?? "",
        ]
        for attachment in attachments {
            parts.append("\(attachment.id)|\(attachment.mime)|\(attachment.width ?? 0)x\(attachment.height ?? 0)|\(attachment.asDocument)|\(attachment.spoiler)")
        }
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for part in parts {
            for byte in part.utf8 {
                hash ^= UInt64(byte)
                hash = hash &* 0x0000_0100_0000_01b3
            }
            hash ^= 0x1f
            hash = hash &* 0x0000_0100_0000_01b3
        }
        return hash
    }

    /// Оценка высоты ещё не виденного сообщения — по тексту и вложениям, а не одна на
    /// всех. Ошибка оценки гасится при показе: ячейка досчитывает себя, и лента
    /// компенсирует сдвиг (`MessageTimelineLayout`).
    func estimatedHeight(width: CGFloat, isGroup: Bool) -> CGFloat {
        let metrics = UIFontMetrics(forTextStyle: .body)
        let line = metrics.scaledValue(for: 22)
        let bubble = min(width * 0.78, 460) - 24
        var height: CGFloat = isLastInGroup ? 10 : 2
        // Поля пузыря и строка времени.
        height += 16 + metrics.scaledValue(for: 6)
        if message.systemType != nil {
            return metrics.scaledValue(for: 34)
        }
        if !message.content.isEmpty {
            let perLine = max(8, bubble / metrics.scaledValue(for: 8.6))
            let lines = message.content
                .split(separator: "\n", omittingEmptySubsequences: false)
                .reduce(0) { $0 + max(1, Int((CGFloat($1.count) / perLine).rounded(.up))) }
            height += CGFloat(lines) * line
        }
        for attachment in attachments {
            let media = (attachment.mime.hasPrefix("image/") || attachment.mime.hasPrefix("video/")) && !attachment.asDocument
            if media {
                let ratio = attachment.width.flatMap { w in attachment.height.map { CGFloat($0) / CGFloat(max(w, 1)) } } ?? 0.75
                height += min(bubble * min(max(ratio, 0.5), 1.4), 320)
            } else {
                height += metrics.scaledValue(for: 52)
            }
        }
        if message.replyToId != nil { height += metrics.scaledValue(for: 44) }
        if isGroup, isFirstInGroup, !isOwn { height += metrics.scaledValue(for: 18) }
        return height.rounded(.up)
    }
}
