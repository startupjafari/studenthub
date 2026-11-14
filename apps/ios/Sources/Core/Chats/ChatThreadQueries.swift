import Foundation
import GRDB

/// Срез переписки: сообщения и их вложения, прочитанные одним запросом.
struct ThreadSnapshot: Equatable {
    let messages: [MessageRecord]
    let attachments: [String: [AttachmentRecord]]
}

/// База для экрана чата: наблюдение ленты и строки чата, черновик, точечные записи.
///
/// Экран не знает про GRDB (IOS_RULES 9.1.2): он получает потоки готовых значений, а
/// запросы, порядок и отсев одинаковых срезов живут здесь.
struct ChatThreadQueries: Sendable {
    private let database: AppDatabase

    init(database: AppDatabase = AppServices.database) {
        self.database = database
    }

    // MARK: - Лента

    /// Срезы переписки окна от `floor` (`nil` — весь чат) по мере изменений базы.
    ///
    /// Сообщения и вложения читаем одним наблюдением: раздельные дали бы кадр, где
    /// картинка уже пришла, а сообщения под неё ещё нет. Наблюдение будит любая запись
    /// в `message`/`attachment`, в том числе в чужом чате: одинаковый срез отсеивается
    /// вне главного потока и до ленты не доходит.
    func observeSnapshot(chatID: String, floor: Int?) -> AsyncStream<ThreadSnapshot> {
        let request = MessageStore(database: database).messages(chatID: chatID, from: floor)
        let observation = ValueObservation.tracking { db -> ThreadSnapshot in
            try Self.readSnapshot(request, chatID: chatID, floor: floor, in: db)
        }
        .removeDuplicates()
        return AsyncValues.stream(of: observation, in: database.reader)
    }

    /// Срез переписки прямо из базы, мимо наблюдения: оно доносит запись асинхронно,
    /// и сразу после неё последний срез у экрана ещё старый.
    func fetchSnapshot(chatID: String, floor: Int?) async throws -> ThreadSnapshot {
        let request = MessageStore(database: database).messages(chatID: chatID, from: floor)
        return try await database.reader.read { db in
            try Self.readSnapshot(request, chatID: chatID, floor: floor, in: db)
        }
    }

    /// Срез переписки: сообщения в порядке ленты и их вложения.
    private static func readSnapshot(
        _ request: QueryInterfaceRequest<MessageRecord>,
        chatID: String,
        floor: Int?,
        in db: Database
    ) throws -> ThreadSnapshot {
        let signpost = Signposts.chats.beginInterval("ThreadSnapshotRead")
        let messages = try request.fetchAll(db)
        // Вложения — только сообщений окна, та же граница, что у запроса сообщений.
        let attachments = try AttachmentRecord.fetchAll(
            db,
            sql: """
                SELECT a.* FROM attachment a
                JOIN message m ON m.id = a.messageId
                WHERE m.chatId = ? AND (? IS NULL OR m.seq >= ? OR m.seq IS NULL)
                """,
            arguments: [chatID, floor, floor]
        )
        Signposts.chats.endInterval(
            "ThreadSnapshotRead", signpost,
            "messages: \(messages.count), attachments: \(attachments.count)"
        )
        return ThreadSnapshot(
            messages: messages,
            attachments: Dictionary(grouping: attachments, by: \.messageId)
        )
    }

    // MARK: - Строка чата

    /// Строка чата по мере изменений. Запись в строку другого чата (счётчик, прочтение)
    /// эту строку не меняет — одинаковое значение отсеивается.
    func observeChat(id: String) -> AsyncStream<ChatRecord?> {
        let observation = ValueObservation.tracking { db in try ChatRecord.fetchOne(db, key: id) }
            .removeDuplicates()
        return AsyncValues.stream(of: observation, in: database.reader)
    }

    /// Строка чата сейчас, синхронно: одна строка по ключу, а граница окна нужна
    /// экрану до первого среза.
    func chatNow(id: String) throws -> ChatRecord? {
        try database.reader.read { db in try ChatRecord.fetchOne(db, key: id) }
    }

    /// Вид чата из базы — пока наблюдение ещё не донесло строку.
    func chatKind(id: String) async throws -> ChatKind? {
        try await database.reader.read { db in try ChatRecord.fetchOne(db, key: id)?.kind }
    }

    /// Строка чата уходит из базы: сервер удалил чат, я вышел или отклонил запрос на
    /// переписку. Список и экран увидят это сами.
    func removeChat(id: String) async throws {
        _ = try await database.writer.write { db in try ChatRecord.deleteOne(db, key: id) }
    }

    /// Запрос на переписку принят: чат становится обычным, плашка запроса уходит.
    func acceptRequest(chatID: String) async throws {
        try await database.writer.write { db in
            guard var chat = try ChatRecord.fetchOne(db, key: chatID) else { return }
            chat.requestIncoming = false
            try chat.update(db)
        }
    }

    // MARK: - Черновик

    /// Черновик чата из базы.
    func draft(chatID: String) async throws -> DraftRecord? {
        try await database.reader.read { db in
            try DraftRecord.fetchOne(db, key: chatID)
        }
    }

    /// Черновик в базу: пустой текст стирает его. Серверу он ещё не донесён — запись
    /// несинхронизированная, пока `markDraftSynced` не отметит обратное.
    func saveDraft(_ text: String, chatID: String) async throws {
        try await database.writer.write { db in
            if text.isEmpty {
                _ = try DraftRecord.deleteOne(db, key: chatID)
                return
            }
            try DraftRecord(
                chatId: chatID,
                text: text,
                replyToId: nil,
                updatedAt: Date(),
                isSynced: false
            ).upsert(db)
        }
    }

    /// Сервер принял черновик с этим текстом. Пока запрос шёл, текст мог смениться —
    /// тогда новая запись остаётся несинхронизированной.
    func markDraftSynced(_ text: String, chatID: String) async throws {
        try await database.writer.write { db in
            guard var record = try DraftRecord.fetchOne(db, key: chatID), record.text == text else { return }
            record.isSynced = true
            try record.update(db)
        }
    }
}
