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
    ///
    /// `isHead` — это последняя страница чата (без курсора): у ни разу не сверенного чата
    /// с неё начинается позиция догона. Остальные страницы двигают позицию, только если
    /// примыкают к ней (`SyncPosition`).
    ///
    /// `reconcilingUpTo` — отметка `reconcileMark()`, взятая до запроса страницы: тогда
    /// страница сверяется с базой (IOS_RULES 9.3.12). Сервер отдаёт страницу непрерывно
    /// по `seq` без удалённого и скрытого «у меня», поэтому подтверждённое сообщение с
    /// номером внутри страницы, которого в ней нет, удалено — помечаем мягко, как догон.
    /// Без этого удалённое за время, которое догон не покрыл, оставалось в ленте навсегда.
    func save(
        messages: [ChatMessageDTO],
        chatID: String,
        isHead: Bool = false,
        reconcilingUpTo mark: Int64? = nil
    ) async throws {
        guard !messages.isEmpty else { return }
        try await database.writer.write { db in
            for message in messages {
                try Self.upsert(message, in: db)
            }
            if let mark { try Self.reconcile(chatID: chatID, with: messages, upTo: mark, in: db) }
            try Self.advance(chatID: chatID, by: messages, isHead: isHead, in: db)
        }
    }

    /// Отметка для сверки страницы: строки с `rowid` не выше неё лежали в базе до запроса.
    func reconcileMark() async throws -> Int64 {
        try await database.reader.read { db in
            try Int64.fetchOne(db, sql: "SELECT IFNULL(MAX(rowid), 0) FROM \(MessageRecord.databaseTableName)") ?? 0
        }
    }

    /// Сверка страницы с базой. Помечаем только то, что точно отсутствовало в ответе:
    /// - диапазон — от меньшего до большего номера страницы, не дальше подтверждённого;
    /// - только строки, лежавшие в базе до запроса (`rowid <= mark`): пришедшее, пока
    ///   страница была в пути (сокет, догон), под сверку не попадает;
    /// - только пришедшие с сервера (`id = remoteId`): своё неотправленное сервер ещё не
    ///   знает, а своё подтверждённое могло получить номер, пока страница была в пути.
    static func reconcile(chatID: String, with page: [ChatMessageDTO], upTo mark: Int64, in db: Database) throws {
        let seqs = page.compactMap(\.seq)
        guard let low = seqs.min(), let high = seqs.max() else { return }
        let deletedAt = Column("deletedAt")
        try MessageRecord
            .filter(MessageRecord.Columns.chatId == chatID)
            .filter(MessageRecord.Columns.sendState == MessageSendState.sent.rawValue)
            .filter(sql: "id = remoteId AND rowid <= ?", arguments: [mark])
            .filter(MessageRecord.Columns.seq >= low && MessageRecord.Columns.seq <= high)
            .filter(deletedAt == nil)
            .filter(!page.map(\.id).contains(MessageRecord.Columns.remoteId))
            .updateAll(db, deletedAt.set(to: Date()))
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
            // Ответ догона сам несёт непрерывный хвост до `latestSeq` — позиция встаёт на
            // него, а отметка времени — на серверный момент до чтения (IOS_RULES 9.3.5).
            guard var chat = try ChatRecord.fetchOne(db, key: chatID) else { return }
            let before = chat
            chat.syncSeq = max(chat.syncSeq, updates.latestSeq)
            chat.lastSeq = max(chat.lastSeq, updates.latestSeq)
            if let syncedAt = updates.syncedAt { chat.syncedAt = syncedAt }
            try chat.updateChanges(db, from: before)
        }
    }

    /// Переполнение догона: разрыв больше серверного лимита, склеивать нечего. Новая
    /// страница уже скачана — одной транзакцией она ложится вместо отправленной истории,
    /// и выставляется позиция (IOS_RULES 9.3.10). Не вышло скачать — сюда не дошли, и
    /// офлайн-история осталась как была.
    ///
    /// Неотправленное не трогаем (9.3.11), последнее сообщение чата — тоже: на него
    /// смотрит превью списка.
    func resetHistory(
        with page: [ChatMessageDTO],
        chatID: String,
        latestSeq: Int,
        syncedAt: Date?
    ) async throws {
        try await database.writer.write { db in
            guard var chat = try ChatRecord.fetchOne(db, key: chatID) else { return }
            var stale = MessageRecord
                .filter(MessageRecord.Columns.chatId == chatID)
                .filter(MessageRecord.Columns.sendState == MessageSendState.sent.rawValue)
                .filter(!page.map(\.id).contains(MessageRecord.Columns.remoteId))
            if let last = chat.lastMessageId {
                stale = stale.filter(MessageRecord.Columns.id != last)
            }
            try stale.deleteAll(db)
            for message in page {
                try Self.upsert(message, in: db)
            }
            // Страница скачана позже ответа догона: её верх не старее `latestSeq`, а если
            // свежие удалены, `latestSeq` — честная граница на момент догона.
            let top = max(page.compactMap(\.seq).max() ?? 0, latestSeq)
            let before = chat
            chat.syncSeq = top
            chat.lastSeq = max(chat.lastSeq, top)
            chat.syncedAt = syncedAt
            try chat.updateChanges(db, from: before)
        }
    }

    /// Сообщения чата в порядке ленты.
    ///
    /// Сортируем по времени, а не по номеру: номер есть только у подтверждённых, а
    /// неотправленное должно стоять там, где человек его написал, — последним.
    /// `floor` — нижняя граница окна (`seq`): старее неё не читается. Неотправленные
    /// (без номера) входят всегда. `nil` — весь чат.
    func messages(chatID: String, from floor: Int? = nil) -> QueryInterfaceRequest<MessageRecord> {
        var request = MessageRecord.filter(MessageRecord.Columns.chatId == chatID)
        if let floor {
            request = request.filter(MessageRecord.Columns.seq >= floor || MessageRecord.Columns.seq == nil)
        }
        return request.order(MessageRecord.Columns.createdAt.asc, MessageRecord.Columns.seq.asc)
    }

    /// Новая нижняя граница окна на страницу старее `floor` — из того, что уже лежит в
    /// базе. `nil` — старее границы в базе ничего нет, нужна сеть.
    func lowerFloor(chatID: String, below floor: Int, by count: Int) async throws -> Int? {
        try await database.reader.read { db in
            let older = MessageRecord
                .filter(MessageRecord.Columns.chatId == chatID)
                .filter(MessageRecord.Columns.seq < floor)
            let paged = try Int.fetchOne(
                db,
                older.select(MessageRecord.Columns.seq).order(MessageRecord.Columns.seq.desc).limit(1, offset: count - 1)
            )
            if let paged { return paged }
            return try Int.fetchOne(db, older.select(min(MessageRecord.Columns.seq)))
        }
    }

    /// Позиция догона: с неё запрашивается разница после обрыва. 0 — чат не сверялся.
    func syncSeq(chatID: String) async throws -> Int {
        try await database.reader.read { db in
            try ChatRecord.fetchOne(db, key: chatID)?.syncSeq ?? 0
        }
    }

    /// Откуда догонять: позиция и отметка времени для правок и удалений.
    ///
    /// Отметка — серверный `syncedAt` прошлого догона. Пока его нет (база до обновления),
    /// — время самого свежего подтверждённого сообщения: оно тоже по часам сервера, в
    /// отличие от своего неотправленного (IOS_RULES 9.3.5).
    func catchUpMark(chatID: String) async throws -> (since: Int, sinceTs: Date?) {
        try await database.reader.read { db in
            let chat = try ChatRecord.fetchOne(db, key: chatID)
            if let syncedAt = chat?.syncedAt { return (chat?.syncSeq ?? 0, syncedAt) }
            let newest = try Date.fetchOne(
                db,
                MessageRecord
                    .filter(MessageRecord.Columns.chatId == chatID)
                    .filter(MessageRecord.Columns.remoteId != nil)
                    .select(max(MessageRecord.Columns.createdAt))
            )
            return (chat?.syncSeq ?? 0, newest)
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
                chat.syncSeq = 0
                chat.syncedAt = nil
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
                let top = window.compactMap(\.seq).max() ?? 0
                chat.lastSeq = top
                chat.syncSeq = top
                try chat.update(db)
            }
        }
    }

    /// Свежее состояние общего списка из `checklist:updated` — в сохранённые сообщения с
    /// ним (IOS_RULES 9.8.17). Id сообщения событие не несёт: ищем по id списка в `extras`,
    /// а `LIKE` лишь сужает выборку — совпадение проверяется разобранной моделью.
    /// Неизменённое не пишем: повтор того же события не будит ленту.
    func save(checklist: MessageExtras.Checklist, chatID: String?) async throws {
        try await database.writer.write { db in
            var request = MessageRecord.filter(sql: "extras LIKE '%' || ? || '%'", arguments: [checklist.id])
            if let chatID {
                request = request.filter(MessageRecord.Columns.chatId == chatID)
            }
            for var row in try request.fetchAll(db) where row.extras?.checklist?.id == checklist.id {
                guard row.extras?.checklist != checklist else { continue }
                row.extras?.checklist = checklist
                try row.update(db)
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

    /// Сообщение целиком из ответа сервера (например, после реакции) — в базу.
    func save(message: ChatMessageDTO) async throws {
        try await database.writer.write { db in try MessageStore.upsert(message, in: db) }
    }

    /// Своя правка — в строку сразу, до подтверждения сервера. Метка правки — на миг
    /// позже прежней: поздняя страница со старой меткой её не откатит, а серверное
    /// подтверждение примется (IOS_RULES 9.5.1).
    func saveLocalEdit(messageID id: String, text: String) async throws {
        try await database.writer.write { db in
            guard var row = try MessageRecord.fetchOne(db, key: id) else { return }
            row.content = text
            row.editedAt = (row.editedAt ?? row.createdAt).addingTimeInterval(0.001)
            try row.update(db)
        }
    }

    /// Пометить сообщение удалённым сразу, не дожидаясь события сервера.
    func markDeleted(messageID id: String) async throws {
        try await database.writer.write { db in
            guard var row = try MessageRecord.fetchOne(db, key: id) else { return }
            row.deletedAt = Date()
            try row.update(db)
        }
    }

    /// Стереть неотправленное: серверу о нём нечего сказать.
    func deleteLocal(messageID id: String) async throws {
        _ = try await database.writer.write { db in try MessageRecord.deleteOne(db, key: id) }
    }

    /// Стереть несколько неотправленных разом.
    func deleteLocal(messageIDs ids: [String]) async throws {
        _ = try await database.writer.write { db in try MessageRecord.deleteAll(db, keys: ids) }
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
            local.pinnedAt = message.pinnedAt
            local.sendState = .sent
            local.absorb(message)
            local.keepFresherState(than: message)
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

        var arrived = MessageRecord(server: message)
        if let known = try MessageRecord.fetchOne(db, key: message.id) {
            // Сравнение с текущей строкой — внутри той же записи, а не со снимком на
            // начало запроса: событие сокета могло лечь, пока ответ был в пути.
            arrived.content = known.content
            arrived.editedAt = known.editedAt
            arrived.deletedAt = known.deletedAt
            arrived.keepFresherState(than: message)
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

    /// Номер последнего — по максимуму, позиция догона — только непрерывным куском.
    private static func advance(
        chatID: String,
        by messages: [ChatMessageDTO],
        isHead: Bool,
        in db: Database
    ) throws {
        let seqs = messages.compactMap(\.seq)
        guard let top = seqs.max(), var chat = try ChatRecord.fetchOne(db, key: chatID) else { return }
        let before = chat
        chat.lastSeq = max(chat.lastSeq, top)
        if case .advance(let position) = SyncPosition.step(from: chat.syncSeq, seqs: seqs, isHead: isHead) {
            // Первая сверка с последней страницы: отметка времени — самое свежее время
            // в ней по часам сервера. Это нижняя граница момента чтения: правки позже
            // неё догон принесёт, лишнее совпадение безвредно.
            if chat.syncSeq == 0, chat.syncedAt == nil {
                chat.syncedAt = messages.map { max($0.createdAt, $0.editedAt ?? $0.createdAt) }.max()
            }
            chat.syncSeq = position
        }
        try chat.updateChanges(db, from: before)
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
    /// Принять текст и удаление из ответа сервера, не откатив более свежее (IOS_RULES 9.5.1,
    /// 9.5.2). Ответ страницы или догона мог уйти раньше события сокета:
    /// - удаление только ставится — сервер удалённых не отдаёт, и `nil` в ответе значит
    ///   «на момент чтения ещё было», а не «восстановлено»;
    /// - правка применяется, только если её `editedAt` не старее текущей: ответ без
    ///   правки или со старой правкой не возвращает прежний текст.
    mutating func keepFresherState(than message: ChatMessageDTO) {
        if deletedAt == nil { deletedAt = message.deletedAt }
        if Self.isEdit(message.editedAt, atLeastAsFreshAs: editedAt) {
            content = message.content
            editedAt = message.editedAt
        }
    }

    /// Свежесть правки по серверным меткам. Без правки (`nil`) — самое старое состояние.
    static func isEdit(_ incoming: Date?, atLeastAsFreshAs current: Date?) -> Bool {
        guard let current else { return true }
        guard let incoming else { return false }
        return incoming >= current
    }

    mutating func absorb(_ message: ChatMessageDTO) {
        if let sender = message.sender {
            senderName = sender.name
            senderAvatar = sender.avatarUrl
        }
        extras = message.extras
    }
}
