#if DEBUG
import Foundation
import GRDB

/// Тестовый чат для замеров производительности (план аудита, шаг 0.2).
///
/// Только отладочная сборка. Кладёт в локальную базу групповой чат на `count` сообщений —
/// одинаковый на любом устройстве: «случайность» — из генератора с постоянным зерном, а
/// время отсчитывается от момента засева. Сервер про этот чат не знает, поэтому экран
/// переписки берёт для него `OfflineMessages` и в сеть за историей не ходит.
///
/// Состав: треть сообщений — свои, остальные от пяти участников; длина текста от слова до
/// абзаца; каждое десятое — ответ; около 30% — с фото (размеры есть, файла нет: плитка
/// встаёт нужной высоты и показывает «не загрузилось»). Сообщения идут раз в 7 минут —
/// около 24 дней, то есть и разделители дней тоже есть.
enum PerfFixture {
    static let chatID = "perf-fixture-chat"
    static let defaultCount = 5000

    static func isFixture(_ chatID: String) -> Bool {
        chatID == Self.chatID
    }

    /// Заменить тестовый чат свежим. Прежний удаляется целиком (сообщения и вложения уходят
    /// каскадом по внешнему ключу).
    static func seed(
        count: Int = defaultCount,
        viewerID: String,
        database: AppDatabase = AppServices.database,
        now: Date = Date()
    ) async throws {
        try await database.writer.write { db in
            _ = try ChatRecord.deleteOne(db, key: chatID)
            let messages = makeMessages(count: count, viewerID: viewerID, now: now)
            let last = messages.last?.message
            try ChatRecord(
                id: chatID,
                type: ChatKind.group.rawValue,
                title: "Замер: \(count) сообщений",
                avatarUrl: nil,
                chatDescription: nil,
                subject: nil,
                memberCount: 6,
                unreadCount: 0,
                muted: true,
                mutedImportantOnly: false,
                pinnedAt: nil,
                archivedAt: nil,
                requestIncoming: false,
                requestOutgoing: false,
                othersReadAt: last?.createdAt,
                lastMessageId: last?.id,
                lastSeq: count,
                updatedAt: last?.createdAt ?? now
            ).insert(db)
            for item in messages {
                try item.message.insert(db)
                try item.photo?.insert(db)
            }
        }
    }

    /// Удалить тестовый чат.
    static func remove(database: AppDatabase = AppServices.database) async throws {
        _ = try await database.writer.write { db in
            try ChatRecord.deleteOne(db, key: chatID)
        }
    }

    // MARK: - Состав

    struct Item {
        let message: MessageRecord
        let photo: AttachmentRecord?
    }

    static func makeMessages(count: Int, viewerID: String, now: Date) -> [Item] {
        var random = SeededRandom(seed: 0x5EED_CAFE)
        let step: TimeInterval = 7 * 60
        let start = now.addingTimeInterval(-step * Double(count))
        var items: [Item] = []
        items.reserveCapacity(count)

        for index in 0..<count {
            let id = "perf-msg-\(index)"
            let own = random.next(below: 3) == 0
            let peer = random.next(below: 5)
            let words = wordCounts[random.next(below: wordCounts.count)]
            let text = (0..<words).map { _ in wordBank[random.next(below: wordBank.count)] }
                .joined(separator: " ")
            let replyTo = index > 0 && index % 10 == 0 ? items[index - 1].message : nil

            var message = MessageRecord(
                id: id,
                remoteId: id,
                chatId: chatID,
                seq: index + 1,
                senderId: own ? viewerID : "perf-user-\(peer)",
                content: text.prefix(1).uppercased() + text.dropFirst(),
                replyToId: replyTo?.id,
                replyQuote: replyTo.map { String($0.content.prefix(60)) },
                systemType: nil,
                editedAt: nil,
                deletedAt: nil,
                pinnedAt: nil,
                createdAt: start.addingTimeInterval(step * Double(index)),
                sendState: .sent
            )
            if !own {
                message.senderName = "Участник \(peer + 1)"
            }

            var photo: AttachmentRecord?
            if random.next(below: 10) < 3 {
                let size = photoSizes[random.next(below: photoSizes.count)]
                photo = AttachmentRecord(
                    id: "perf-att-\(index)",
                    messageId: id,
                    mime: "image/jpeg",
                    name: nil,
                    size: 240_000,
                    width: size.0,
                    height: size.1,
                    localPath: nil
                )
            }
            items.append(Item(message: message, photo: photo))
        }
        return items
    }

    private static let wordCounts = [1, 2, 3, 5, 8, 12, 20, 35, 60]
    private static let photoSizes = [(1280, 960), (960, 1280), (1080, 1080), (1920, 1080), (1080, 1920)]
    private static let wordBank = [
        "лекция", "завтра", "в", "аудитории", "переносится", "на", "девять", "утра", "кто",
        "сдал", "лабораторную", "по", "базам", "данных", "скиньте", "конспект", "пожалуйста",
        "староста", "сказала", "что", "экзамен", "будет", "устно", "спасибо", "ок", "да",
        "нет", "посмотрю", "вечером", "ссылка", "в", "закреплённом", "сообщении", "кстати",
        "дедлайн", "пятница", "успеем", "если", "начнём", "сегодня", "😂", "👍", "🔥",
    ]

    // MARK: - Без сети

    /// История тестового чата — только из базы: сервер такого чата не знает.
    struct OfflineMessages: ChatMessagesFetching {
        func messages(chatID: String, cursor: String?, limit: Int) async throws -> Page<ChatMessageDTO> {
            Page(items: [], meta: nil)
        }

        func messages(chatID: String, aroundDate: Date, limit: Int) async throws -> Page<ChatMessageDTO> {
            Page(items: [], meta: nil)
        }

        func newerMessages(chatID: String, after cursor: String, limit: Int) async throws -> Page<ChatMessageDTO> {
            Page(items: [], meta: nil)
        }

        func updates(chatID: String, since: Int, sinceTs: Date?) async throws -> ChatUpdatesDTO {
            ChatUpdatesDTO(created: [], mutated: [], deletedIds: [], latestSeq: since, overflow: false)
        }
    }
}

/// Генератор с постоянным зерном (SplitMix64): тот же чат на любом устройстве и в тестах.
struct SeededRandom {
    private var state: UInt64

    init(seed: UInt64) {
        state = seed
    }

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }

    mutating func next(below bound: Int) -> Int {
        Int(next() % UInt64(bound))
    }
}
#endif
