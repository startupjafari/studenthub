import Foundation
import GRDB

/// Запись ответов API в локальную базу.
///
/// Единственное место, где сеть встречается с хранилищем. Экран сюда не заглядывает:
/// он читает базу и видит изменения сам.
struct ChatStore: Sendable {
    private let database: AppDatabase

    init(database: AppDatabase = AppServices.database) {
        self.database = database
    }

    /// Сохранить страницу списка чатов.
    ///
    /// Страница не заменяет базу целиком: чаты приходят по сто штук, и стереть всё
    /// ради первой страницы значит показать человеку обрезанный список.
    func save(chats items: [ChatListItemDTO]) async throws {
        try await database.writer.write { db in
            for item in items {
                try upsert(item, in: db)
            }
        }
    }

    /// Сохранить папки. Здесь, наоборот, замена полная: папок единицы, сервер отдаёт
    /// их разом, и удалённая папка иначе осталась бы вкладкой навсегда.
    func save(folders: [ChatFolderDTO]) async throws {
        try await database.writer.write { db in
            let arrived = Set(folders.map(\.id))
            for stale in try FolderRecord.fetchAll(db) where !arrived.contains(stale.id) {
                try stale.delete(db)
            }
            for folder in folders {
                try write(folder, in: db)
            }
        }
    }

    /// Одна папка — ответ на создание или правку, либо её вид до отказа сервера. Прочие
    /// папки не трогаем: полная замена здесь стёрла бы чужую правку, что ещё в пути.
    func save(folder: ChatFolderDTO) async throws {
        try await database.writer.write { db in
            try write(folder, in: db)
        }
    }

    /// Состав уходит вместе с папкой — каскадом по внешнему ключу.
    func deleteFolder(id: String) async throws {
        _ = try await database.writer.write { db in
            try FolderRecord.deleteOne(db, key: id)
        }
    }

    /// Переключатели списка. Пишем сразу, не дожидаясь сервера: это и есть
    /// оптимистичность — палец убрал, строка уже уехала. Откат делает вызывающий.
    func setPinned(_ pinned: Bool, chatID: String) async throws {
        try await database.writer.write { db in
            guard var chat = try ChatRecord.fetchOne(db, key: chatID) else { return }
            chat.pinnedAt = pinned ? Date() : nil
            // Новое закрепление встаёт на самый верх, как на сервере: выше всех
            // упорядоченных. Пока порядка нет ни у кого (старый сервер), его хватает и
            // свежего `pinnedAt` — закреплённые без места идут по нему.
            if pinned {
                let top = try Int.fetchOne(
                    db,
                    sql: "SELECT MIN(pinnedOrder) FROM chat WHERE pinnedAt IS NOT NULL AND pinnedOrder IS NOT NULL"
                )
                chat.pinnedOrder = top.map { $0 - 1 }
            } else {
                chat.pinnedOrder = nil
            }
            try chat.update(db)
        }
    }

    /// Ручной порядок закреплённых — id сверху вниз. Возвращает прежние места, чтобы
    /// вызывающий мог откатить их при отказе сервера.
    @discardableResult
    func setPinnedOrder(_ ids: [String]) async throws -> [String: Int?] {
        try await database.writer.write { db in
            let pinned = try ChatRecord.filter(ChatRecord.Columns.pinnedAt != nil).fetchAll(db)
            let previous = Dictionary(uniqueKeysWithValues: pinned.map { ($0.id, $0.pinnedOrder) })
            let listed = Set(ids)
            // Не перечисленные закреплённые встают ниже перечисленных в прежнем порядке
            // списка — так их ставит и сервер (§B.2 контракта): после вызова место есть
            // у всех закреплённых.
            let rest = try ChatListQuery.pinnedChatIDs(in: db).filter { !listed.contains($0) }
            let place = Dictionary((ids + rest).enumerated().map { ($1, $0) }, uniquingKeysWith: { first, _ in first })
            for var chat in pinned {
                guard let order = place[chat.id], chat.pinnedOrder != order else { continue }
                chat.pinnedOrder = order
                try chat.update(db)
            }
            return previous
        }
    }

    /// Вернуть места закреплённых, снятые `setPinnedOrder`.
    func restorePinnedOrder(_ previous: [String: Int?]) async throws {
        try await database.writer.write { db in
            for (id, order) in previous {
                guard var chat = try ChatRecord.fetchOne(db, key: id), chat.pinnedOrder != order else { continue }
                chat.pinnedOrder = order
                try chat.update(db)
            }
        }
    }

    func setMarkedUnread(_ marked: Bool, chatID: String) async throws {
        try await update(chatID) { chat in chat.markedUnread = marked }
    }

    /// Прочитать чаты целиком: счётчик и пометка «как новое» гаснут сразу. Возвращает
    /// прежнее состояние для отката.
    @discardableResult
    func markRead(chatIDs: [String]) async throws -> [ChatReadSnapshot] {
        try await database.writer.write { db in
            var previous: [ChatReadSnapshot] = []
            for id in chatIDs {
                guard var chat = try ChatRecord.fetchOne(db, key: id),
                      chat.unreadCount != 0 || chat.markedUnread
                else { continue }
                previous.append(ChatReadSnapshot(chatID: id, unreadCount: chat.unreadCount, markedUnread: chat.markedUnread))
                chat.unreadCount = 0
                chat.markedUnread = false
                try chat.update(db)
            }
            return previous
        }
    }

    func restore(_ reads: [ChatReadSnapshot]) async throws {
        try await database.writer.write { db in
            for read in reads {
                guard var chat = try ChatRecord.fetchOne(db, key: read.chatID) else { continue }
                chat.unreadCount = read.unreadCount
                chat.markedUnread = read.markedUnread
                try chat.update(db)
            }
        }
    }

    /// Звук всем чатам папки — по тому же правилу состава, что и вкладка. Возвращает
    /// прежние флаги для отката.
    @discardableResult
    func setMuted(_ muted: Bool, folderID: String) async throws -> [String: Bool] {
        try await database.writer.write { db in
            let condition = ChatListQuery.folderCondition(folderID)
            let request: SQLRequest<ChatRecord> = "SELECT c.* FROM chat c WHERE \(condition)"
            var previous: [String: Bool] = [:]
            for var chat in try request.fetchAll(db) where chat.muted != muted {
                previous[chat.id] = chat.muted
                chat.muted = muted
                try chat.update(db)
            }
            return previous
        }
    }

    func restoreMuted(_ previous: [String: Bool]) async throws {
        try await database.writer.write { db in
            for (id, muted) in previous {
                guard var chat = try ChatRecord.fetchOne(db, key: id) else { continue }
                chat.muted = muted
                try chat.update(db)
            }
        }
    }

    func setArchived(_ archived: Bool, chatID: String) async throws {
        try await update(chatID) { chat in chat.archivedAt = archived ? Date() : nil }
    }

    func setMuted(_ muted: Bool, chatID: String) async throws {
        try await update(chatID) { chat in chat.muted = muted }
    }

    /// Фото группы после загрузки или удаления: сокет об удалении молчит (`nil` в
    /// `chat:updated` не отличить от «не менялось»), а список и шапка читают базу.
    func setAvatar(_ url: String?, chatID: String) async throws {
        try await update(chatID) { chat in chat.avatarUrl = url }
    }

    /// Владение передано: права в шапке и меню — сразу, не дожидаясь списка.
    func setOwner(_ isOwner: Bool, chatID: String) async throws {
        try await update(chatID) { chat in chat.isOwner = isOwner }
    }

    /// Флаг «я заблокировал собеседника» у личного чата с человеком — для плашки над полем
    /// ввода. Собеседника запись чата не хранит, поэтому чат находим по его сообщениям;
    /// переписку без единого его сообщения поправит следующая страница списка.
    func setBlocked(_ blocked: Bool, peerID: String) async throws {
        _ = try await database.writer.write { db in
            try ChatRecord
                .filter(Column("type") == ChatKind.private.rawValue)
                .filter(sql: "id IN (SELECT chatId FROM message WHERE senderId = ?)", arguments: [peerID])
                .updateAll(db, Column("blocked").set(to: blocked))
        }
    }

    // MARK: - Внутреннее

    /// Папка с составом. Состав заменяется целиком — так его хранит и сервер.
    private func write(_ folder: ChatFolderDTO, in db: Database) throws {
        try FolderRecord(
            id: folder.id,
            name: folder.name,
            position: folder.position,
            emoji: folder.emoji,
            color: folder.color,
            includeContacts: folder.includeContacts,
            includeNonContacts: folder.includeNonContacts,
            includeGroups: folder.includeGroups
        )
        .upsert(db)
        try FolderChatRecord
            .filter(Column("folderId") == folder.id)
            .deleteAll(db)
        for chatID in Set(folder.chatIds) {
            try FolderChatRecord(folderId: folder.id, chatId: chatID).insert(db)
        }
        try FolderExcludedChatRecord
            .filter(Column("folderId") == folder.id)
            .deleteAll(db)
        for chatID in Set(folder.excludedChatIds) {
            try FolderExcludedChatRecord(folderId: folder.id, chatId: chatID).insert(db)
        }
    }

    private func update(
        _ chatID: String,
        _ change: @escaping @Sendable (inout ChatRecord) -> Void
    ) async throws {
        try await database.writer.write { db in
            guard var chat = try ChatRecord.fetchOne(db, key: chatID) else { return }
            change(&chat)
            try chat.update(db)
        }
    }

    private func upsert(_ item: ChatListItemDTO, in db: Database) throws {
        let known = try ChatRecord.fetchOne(db, key: item.id)

        let chat = ChatRecord(
            id: item.id,
            type: item.type,
            title: item.title,
            avatarUrl: item.avatarUrl,
            chatDescription: item.description,
            subject: item.subject,
            memberCount: item.memberCount ?? known?.memberCount ?? 0,
            unreadCount: item.unreadCount ?? 0,
            muted: item.muted ?? false,
            mutedImportantOnly: item.mutedImportantOnly ?? false,
            pinnedAt: item.pinnedAt,
            archivedAt: item.archived == true ? (known?.archivedAt ?? item.updatedAt) : nil,
            requestIncoming: item.requestIncoming ?? false,
            requestOutgoing: item.requestOutgoing ?? false,
            othersReadAt: item.othersReadAt,
            lastMessageId: item.lastMessage?.id ?? known?.lastMessageId,
            // Номер только растёт: страница списка может приехать с отставанием от
            // сокета, и откатить позицию догона означало бы перекачать переписку.
            lastSeq: max(known?.lastSeq ?? 0, item.lastMessage?.seq ?? 0),
            updatedAt: item.updatedAt,
            online: item.online ?? false,
            isOwner: item.isOwner ?? false,
            isAdmin: item.isAdmin ?? false,
            blocked: item.blocked ?? false,
            blockedBy: item.blockedBy ?? false,
            markedUnread: item.markedUnread ?? false,
            pinnedOrder: item.pinnedAt == nil ? nil : item.pinnedOrder,
            isFriend: item.isFriend ?? false
        )
        // Только изменённые столбцы: страница списка приходит целиком на каждое обновление,
        // и запись без перемен будила бы все наблюдения за таблицей чатов.
        if let known {
            try chat.updateChanges(db, from: known)
        } else {
            try chat.insert(db)
        }

        // Превью пишем ПОСЛЕ чата: у сообщения внешний ключ на него, и при первой
        // синхронизации нового чата запись сорвалась бы на ограничении целиком.
        if let preview = item.lastMessage {
            try save(preview, in: db)
        }

        try mirrorServerDraft(item.draft, chatID: item.id, in: db)
    }

    /// Сообщение-превью кладём в ту же таблицу, что и историю: это то же сообщение,
    /// и когда человек откроет чат, строка просто обновится.
    private func save(_ message: ChatMessageDTO, in db: Database) throws {
        // Своё отправленное лежит под локальным ключом — его обновляет общий путь
        // переписки, иначе превью вставило бы дубль с тем же `remoteId`.
        try MessageStore.upsert(message, in: db)
    }

    /// Черновик с сервера принимаем, только если своего неотправленного нет.
    ///
    /// Местный текст всегда свежее: человек печатает быстрее, чем уходит запрос, и
    /// затирать его ответом списка — ровно та потеря, из-за которой черновики и
    /// заводят.
    private func mirrorServerDraft(_ text: String?, chatID: String, in db: Database) throws {
        let local = try DraftRecord.fetchOne(db, key: chatID)
        if let local, !local.isSynced { return }

        guard let text, !text.isEmpty else {
            if local != nil { try DraftRecord.deleteOne(db, key: chatID) }
            return
        }
        let mirrored = DraftRecord(
            chatId: chatID,
            text: text,
            replyToId: local?.replyToId,
            updatedAt: local?.updatedAt ?? Date(),
            isSynced: true
        )
        guard mirrored != local else { return }
        try mirrored.upsert(db)
    }
}

/// Состояние прочтения чата до «Прочитать» — для отката при отказе сервера.
struct ChatReadSnapshot: Sendable, Equatable {
    let chatID: String
    let unreadCount: Int
    let markedUnread: Bool
}
