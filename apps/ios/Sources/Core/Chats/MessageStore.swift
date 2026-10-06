import Foundation
import GRDB

/// Запись переписки в локальную базу.
///
/// Как и список, лента читает только базу. Здесь единственное место, где ответы
/// истории и догона в неё попадают.
struct MessageStore: Sendable {
    private let database: AppDatabase

    init(database: AppDatabase = AppServices.database) {
        self.database = database
    }

    /// Страница истории. Сервер отдаёт свежие первыми — порядок нам безразличен,
    /// лента сортирует сама.
    func save(messages: [ChatMessageDTO], chatID: String) async throws {
        guard !messages.isEmpty else { return }
        try await database.writer.write { db in
            for message in messages {
                try Self.upsert(message, in: db)
            }
            try Self.liftLastSeq(chatID: chatID, to: messages.compactMap(\.seq).max(), in: db)
        }
    }

    /// Применить догон. Порядок важен: сначала правки и новые сообщения, потом
    /// удаления — иначе только что удалённое вернулось бы из `created`.
    func apply(_ updates: ChatUpdatesDTO, chatID: String) async throws {
        try await database.writer.write { db in
            for message in updates.created + updates.mutated {
                try Self.upsert(message, in: db)
            }
            for id in updates.deletedIds {
                // Удаление мягкое, как на сервере: строка остаётся, в ленте на её
                // месте — «сообщение удалено», и позиции соседей не прыгают.
                if var message = try MessageRecord.fetchOne(db, key: id), message.deletedAt == nil {
                    message.deletedAt = Date()
                    try message.update(db)
                }
            }
            try Self.liftLastSeq(chatID: chatID, to: updates.latestSeq, in: db)
        }
    }

    /// Сообщения чата в порядке ленты.
    ///
    /// Сортируем по времени, а не по номеру: номер есть только у подтверждённых, а
    /// неотправленное должно стоять там, где человек его написал, — последним.
    func messages(chatID: String) -> QueryInterfaceRequest<MessageRecord> {
        MessageRecord
            .filter(MessageRecord.Columns.chatId == chatID)
            .order(MessageRecord.Columns.createdAt.asc, MessageRecord.Columns.seq.asc)
    }

    /// Известная позиция догона: с неё запрашивается разница после обрыва.
    func lastSeq(chatID: String) async throws -> Int {
        try await database.reader.read { db in
            try ChatRecord.fetchOne(db, key: chatID)?.lastSeq ?? 0
        }
    }

    /// Сбросить переписку чата: единственный честный ответ на `overflow` — разрыв
    /// больше серверного лимита, и склеивать там нечего.
    func clearHistory(chatID: String) async throws {
        try await database.writer.write { db in
            try MessageRecord
                .filter(MessageRecord.Columns.chatId == chatID)
                .filter(MessageRecord.Columns.sendState == MessageSendState.sent.rawValue)
                .deleteAll(db)
            if var chat = try ChatRecord.fetchOne(db, key: chatID) {
                chat.lastSeq = 0
                try chat.update(db)
            }
        }
    }

    // MARK: - Внутреннее

    static func upsert(_ message: ChatMessageDTO, in db: Database) throws {
        // Своё отправленное сообщение уже лежит в базе под локальным ключом —
        // подтверждение находим по `remoteId`, иначе в ленте появился бы дубль.
        if var local = try MessageRecord
            .filter(MessageRecord.Columns.remoteId == message.id)
            .fetchOne(db)
        {
            local.seq = message.seq ?? local.seq
            local.content = message.content
            local.editedAt = message.editedAt
            local.deletedAt = message.deletedAt
            local.pinnedAt = message.pinnedAt
            local.sendState = .sent
            try local.update(db)
            return
        }

        try MessageRecord(
            id: message.id,
            remoteId: message.id,
            chatId: message.chatId,
            seq: message.seq,
            senderId: message.senderId,
            content: message.content,
            replyToId: message.replyToId,
            replyQuote: message.replyQuote,
            systemType: message.systemType,
            editedAt: message.editedAt,
            deletedAt: message.deletedAt,
            pinnedAt: message.pinnedAt,
            createdAt: message.createdAt,
            sendState: .sent
        ).upsert(db)
    }

    private static func liftLastSeq(chatID: String, to seq: Int?, in db: Database) throws {
        guard let seq, var chat = try ChatRecord.fetchOne(db, key: chatID), seq > chat.lastSeq else { return }
        chat.lastSeq = seq
        try chat.update(db)
    }
}
