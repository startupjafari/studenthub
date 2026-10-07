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
                try FolderRecord(id: folder.id, name: folder.name, position: folder.position)
                    .upsert(db)
                try FolderChatRecord
                    .filter(Column("folderId") == folder.id)
                    .deleteAll(db)
                for chatID in folder.chatIds {
                    try FolderChatRecord(folderId: folder.id, chatId: chatID).insert(db)
                }
            }
        }
    }

    /// Переключатели списка. Пишем сразу, не дожидаясь сервера: это и есть
    /// оптимистичность — палец убрал, строка уже уехала. Откат делает вызывающий.
    func setPinned(_ pinned: Bool, chatID: String) async throws {
        try await update(chatID) { chat in chat.pinnedAt = pinned ? Date() : nil }
    }

    func setArchived(_ archived: Bool, chatID: String) async throws {
        try await update(chatID) { chat in chat.archivedAt = archived ? Date() : nil }
    }

    func setMuted(_ muted: Bool, chatID: String) async throws {
        try await update(chatID) { chat in chat.muted = muted }
    }

    // MARK: - Внутреннее

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
            updatedAt: item.updatedAt
        )
        try chat.upsert(db)

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

    /// Черновик с сервера принимаем, только если своего неотправленного нет.
    ///
    /// Местный текст всегда свежее: человек печатает быстрее, чем уходит запрос, и
    /// затирать его ответом списка — ровно та потеря, из-за которой черновики и
    /// заводят.
    private func mirrorServerDraft(_ text: String?, chatID: String, in db: Database) throws {
        let local = try DraftRecord.fetchOne(db, key: chatID)
        if let local, !local.isSynced { return }

        guard let text, !text.isEmpty else {
            try DraftRecord.deleteOne(db, key: chatID)
            return
        }
        try DraftRecord(
            chatId: chatID,
            text: text,
            replyToId: local?.replyToId,
            updatedAt: local?.updatedAt ?? Date(),
            isSynced: true
        ).upsert(db)
    }
}
