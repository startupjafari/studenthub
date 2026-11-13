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

    /// Заменить переписку окном истории (переход к далёкому сообщению или дате).
    ///
    /// Окно с прежней историей не склеить: между ними может лежать что угодно, а лента
    /// показала бы их встык, и «дыру» никто бы не заметил. Поэтому в базе остаётся только
    /// окно — дальше оно растёт страницами в обе стороны и снова доходит до свежего.
    ///
    /// Не трогаем неотправленное (оно ещё должно уйти) и последнее сообщение чата: на него
    /// смотрит превью в списке чатов. Позиция догона — по окну: всё, что новее, лента
    /// дочитает сама.
    func replaceHistory(with window: [ChatMessageDTO], chatID: String) async throws {
        try await database.writer.write { db in
            let chat = try ChatRecord.fetchOne(db, key: chatID)
            var stale = MessageRecord
                .filter(MessageRecord.Columns.chatId == chatID)
                .filter(MessageRecord.Columns.sendState == MessageSendState.sent.rawValue)
            if let last = chat?.lastMessageId {
                stale = stale.filter(MessageRecord.Columns.id != last)
            }
            try stale.deleteAll(db)
            for message in window {
                try Self.upsert(message, in: db)
            }
            if var chat = try ChatRecord.fetchOne(db, key: chatID) {
                chat.lastSeq = window.compactMap(\.seq).max() ?? 0
                try chat.update(db)
            }
        }
    }

    /// Убрать сообщения, удалённые «у меня» (своим действием или с другого устройства).
    func removeHidden(remoteIDs: [String], chatID: String) async throws {
        guard !remoteIDs.isEmpty else { return }
        try await database.writer.write { db in
            _ = try MessageRecord
                .filter(MessageRecord.Columns.chatId == chatID)
                .filter(remoteIDs.contains(MessageRecord.Columns.remoteId))
                .deleteAll(db)
        }
    }

    /// Убрать очищенный у себя период: границы включительно, как на сервере.
    /// Неотправленное не трогаем — сервер о нём ещё не знает, и очищать там нечего.
    func clearHistory(chatID: String, from: Date, to: Date) async throws {
        try await database.writer.write { db in
            _ = try MessageRecord
                .filter(MessageRecord.Columns.chatId == chatID)
                .filter(MessageRecord.Columns.sendState == MessageSendState.sent.rawValue)
                .filter(MessageRecord.Columns.createdAt >= from && MessageRecord.Columns.createdAt <= to)
                .deleteAll(db)
        }
    }

    // MARK: - Внутреннее

    /// Подтвердить свою отправку ответом сервера.
    ///
    /// Если то же сообщение уже легло отдельной строкой (сокет успел раньше и сверка по
    /// тексту не сработала), эта строка убирается: иначе `remoteId` упёрся бы в
    /// уникальность, отправка считалась бы неудачной, а повтор слал бы дубль всем.
    static func confirm(localID: String, with sent: ChatMessageDTO, in db: Database) throws {
        guard var local = try MessageRecord.fetchOne(db, key: localID) else { return }
        if let twin = try MessageRecord
            .filter(MessageRecord.Columns.remoteId == sent.id)
            .fetchOne(db), twin.id != local.id
        {
            try twin.delete(db)
        }
        // Ключ строки не меняем: на него уже ссылается лента. Серверный id кладём
        // рядом — по нему сообщение узнаётся, когда придёт из сокета.
        local.remoteId = sent.id
        local.seq = sent.seq
        local.createdAt = sent.createdAt
        local.sendState = .sent
        local.absorb(sent)
        try local.update(db)
    }

    static func upsert(_ message: ChatMessageDTO, nonce: String? = nil, in db: Database) throws {
        // Своё отправленное сообщение уже лежит в базе под локальным ключом —
        // подтверждение находим по `remoteId`, иначе в ленте появился бы дубль.
        if var local = try MessageRecord
            .filter(MessageRecord.Columns.remoteId == message.id)
            .fetchOne(db)
        {
            let before = local
            local.seq = message.seq ?? local.seq
            local.content = message.content
            local.editedAt = message.editedAt
            local.deletedAt = message.deletedAt
            local.pinnedAt = message.pinnedAt
            local.sendState = .sent
            local.absorb(message)
            // Только изменённые столбцы и только если они есть: страница списка и догон
            // приносят те же сообщения снова, и пустая запись будила бы ленту и список.
            try local.updateChanges(db, from: before)
            try saveAttachments(of: message, messageID: local.id, in: db)
            return
        }

        // Своё сообщение пришло из сокета раньше, чем HTTP-ответ на отправку: серверного
        // id у локальной строки ещё нет. Без сверки здесь вставлялась вторая строка, а
        // потом подтверждение отправки упиралось в UNIQUE(remoteId) — сообщение
        // раздваивалось и помечалось «Не отправлено» (§9.1a: терпимость к порядку).
        if try MessageRecord.fetchOne(db, key: message.id) == nil,
           var pending = try ownPending(for: message, nonce: nonce, in: db)
        {
            pending.remoteId = message.id
            pending.seq = message.seq
            pending.createdAt = message.createdAt
            pending.sendState = .sent
            pending.absorb(message)
            try pending.update(db)
            try saveAttachments(of: message, messageID: pending.id, in: db)
            return
        }

        let arrived = MessageRecord(server: message)
        if let known = try MessageRecord.fetchOne(db, key: message.id) {
            try arrived.updateChanges(db, from: known)
        } else {
            try arrived.insert(db)
        }
        try saveAttachments(of: message, messageID: message.id, in: db)
    }

    /// Вложения переписываем целиком: сервер присылает их полным списком, а
    /// дельта по ним не приходит вовсе.
    /// Своё неподтверждённое сообщение, которому соответствует пришедшее.
    ///
    /// Ключ повтора (`nonce`) — это локальный id строки: по нему сверка точная. Ключ есть,
    /// а строки с ним нет — сообщение отправлено с другого устройства, и подбирать ему
    /// «пару» по тексту нельзя: два одинаковых «ок» склеились бы не с теми строками.
    /// Без ключа (эхо сообщения, отправленного прежней версией приложения) — по автору и
    /// тексту, самую раннюю из неподтверждённых.
    private static func ownPending(
        for message: ChatMessageDTO,
        nonce: String?,
        in db: Database
    ) throws -> MessageRecord? {
        if let nonce {
            guard let row = try MessageRecord.fetchOne(db, key: nonce),
                row.remoteId == nil, row.chatId == message.chatId
            else { return nil }
            return row
        }
        return try MessageRecord
            .filter(MessageRecord.Columns.chatId == message.chatId)
            .filter(MessageRecord.Columns.remoteId == nil)
            .filter(MessageRecord.Columns.senderId == message.senderId)
            .filter(MessageRecord.Columns.content == message.content)
            .order(MessageRecord.Columns.createdAt.asc)
            .fetchOne(db)
    }

    private static func saveAttachments(
        of message: ChatMessageDTO,
        messageID: String,
        in db: Database
    ) throws {
        guard let media = message.media else { return }
        let known = try AttachmentRecord
            .filter(AttachmentRecord.Columns.messageId == messageID)
            .fetchAll(db)
        let paths = Dictionary(known.map { ($0.id, $0.localPath) }, uniquingKeysWith: { first, _ in first })
        // Размеры снимка, известные с отправки: сервер узнаёт их позже (медиа-система), и
        // без них пузырь на миг перескакивал к пропорции «по умолчанию» — лента прыгала.
        let sizes = Dictionary(known.map { ($0.id, ($0.width, $0.height)) }, uniquingKeysWith: { first, _ in first })

        let arrived = media.map { item in
            AttachmentRecord(
                id: item.id,
                messageId: messageID,
                mime: item.mime,
                name: item.name,
                size: item.size,
                width: item.width ?? sizes[item.id]?.0,
                height: item.height ?? sizes[item.id]?.1,
                // Уже скачанный файл не теряем: ключ кэша — id, и ссылка на диск
                // переживает обновление самой записи.
                localPath: paths[item.id] ?? nil,
                placeholder: item.placeholder,
                durationMs: item.durationMs,
                spoiler: item.spoiler ?? false,
                asDocument: item.asDocument ?? false
            )
        }
        // Те же вложения в том же порядке — ничего не пишем: удаление и вставка заново
        // будили наблюдения ленты и списка на каждый повтор того же сообщения.
        guard arrived != known else { return }

        try AttachmentRecord
            .filter(AttachmentRecord.Columns.messageId == messageID)
            .deleteAll(db)
        for record in arrived {
            try record.insert(db)
        }
    }

    private static func liftLastSeq(chatID: String, to seq: Int?, in db: Database) throws {
        guard let seq, var chat = try ChatRecord.fetchOne(db, key: chatID), seq > chat.lastSeq else { return }
        chat.lastSeq = seq
        try chat.update(db)
    }
}

extension MessageRecord {
    /// Строка из ответа сервера.
    init(server message: ChatMessageDTO) {
        self.init(
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
        )
        absorb(message)
    }

    /// Автор и подробности из ответа сервера. Реакции, превью ссылки и опрос меняются
    /// у уже сохранённого сообщения — поэтому переписываются при каждом приходе.
    mutating func absorb(_ message: ChatMessageDTO) {
        if let sender = message.sender {
            senderName = sender.name
            senderAvatar = sender.avatarUrl
        }
        extras = message.extras
    }
}
