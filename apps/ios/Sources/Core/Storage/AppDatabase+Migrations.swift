import Foundation
import GRDB

extension AppDatabase {
    /// Схема и её история.
    ///
    /// Мигратор заведён с первого релиза, хотя версия пока одна. Причина простая:
    /// старая сборка живёт на устройстве месяцами, и к моменту, когда схема
    /// изменится, добавлять миграции будет уже некуда — на руках окажутся базы,
    /// которых код не понимает.
    ///
    /// `eraseDatabaseOnSchemaChange` сознательно не включаем даже в отладке: он
    /// приучает не писать миграции, а потом ровно этого не хватает.
    static var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()

        migrator.registerMigration("v1.chats") { db in
            try db.create(table: ChatRecord.databaseTableName) { table in
                table.primaryKey("id", .text)
                table.column("type", .text).notNull()
                table.column("title", .text)
                table.column("avatarUrl", .text)
                table.column("chatDescription", .text)
                table.column("subject", .text)
                table.column("memberCount", .integer).notNull().defaults(to: 0)
                table.column("unreadCount", .integer).notNull().defaults(to: 0)
                table.column("muted", .boolean).notNull().defaults(to: false)
                table.column("mutedImportantOnly", .boolean).notNull().defaults(to: false)
                table.column("pinnedAt", .datetime)
                table.column("archivedAt", .datetime)
                table.column("requestIncoming", .boolean).notNull().defaults(to: false)
                table.column("requestOutgoing", .boolean).notNull().defaults(to: false)
                table.column("othersReadAt", .datetime)
                table.column("lastMessageId", .text)
                table.column("lastSeq", .integer).notNull().defaults(to: 0)
                table.column("updatedAt", .datetime).notNull()
            }
            // Список чатов: свежие сверху, закреплённые экран поднимает сам.
            try db.create(
                index: "chat_on_updatedAt",
                on: ChatRecord.databaseTableName,
                columns: ["updatedAt"]
            )

            try db.create(table: MessageRecord.databaseTableName) { table in
                table.primaryKey("id", .text)
                table.column("remoteId", .text).unique()
                table.column("chatId", .text)
                    .notNull()
                    .references(ChatRecord.databaseTableName, onDelete: .cascade)
                table.column("seq", .integer)
                table.column("senderId", .text).notNull()
                table.column("content", .text).notNull()
                table.column("replyToId", .text)
                table.column("replyQuote", .text)
                table.column("systemType", .text)
                table.column("editedAt", .datetime)
                table.column("deletedAt", .datetime)
                table.column("pinnedAt", .datetime)
                table.column("createdAt", .datetime).notNull()
                table.column("sendState", .text).notNull().defaults(to: MessageSendState.sent.rawValue)
            }
            // Номер уникален в пределах чата — ровно как на сервере. Условие нужно
            // потому, что у неотправленных сообщений номера ещё нет, и таких строк
            // в чате может быть сколько угодно.
            try db.execute(
                sql: """
                    CREATE UNIQUE INDEX message_on_chat_seq
                    ON message (chatId, seq) WHERE seq IS NOT NULL
                    """
            )
            // Лента чата.
            try db.create(
                index: "message_on_chat_createdAt",
                on: MessageRecord.databaseTableName,
                columns: ["chatId", "createdAt"]
            )
            // Очередь отправки: строк в ней единицы, и частичный индекс не даёт
            // перебирать всю переписку ради них.
            try db.execute(
                sql: """
                    CREATE INDEX message_on_pending
                    ON message (createdAt) WHERE sendState <> 'sent'
                    """
            )

            try db.create(table: DraftRecord.databaseTableName) { table in
                // Черновик ровно один на чат — первичный ключ это и выражает.
                table.primaryKey("chatId", .text)
                    .references(ChatRecord.databaseTableName, onDelete: .cascade)
                table.column("text", .text).notNull()
                table.column("replyToId", .text)
                table.column("updatedAt", .datetime).notNull()
                table.column("isSynced", .boolean).notNull().defaults(to: false)
            }
            // Несинхронизированные черновики — их досылает фоновая отправка.
            try db.execute(
                sql: "CREATE INDEX draft_on_unsynced ON draft (updatedAt) WHERE isSynced = 0"
            )
        }

        migrator.registerMigration("v2.chatFolders") { db in
            try db.create(table: FolderRecord.databaseTableName) { table in
                table.primaryKey("id", .text)
                table.column("name", .text).notNull()
                table.column("position", .integer).notNull()
            }

            try db.create(table: FolderChatRecord.databaseTableName) { table in
                table.column("folderId", .text)
                    .notNull()
                    .references(FolderRecord.databaseTableName, onDelete: .cascade)
                // Без внешнего ключа на чат намеренно: папка приходит целиком, а сами
                // чаты — страницами, и состав папки может ссылаться на чат, который
                // в базу ещё не доехал.
                table.column("chatId", .text).notNull()
                table.primaryKey(["folderId", "chatId"])
            }
            try db.create(
                index: "folderChat_on_chat",
                on: FolderChatRecord.databaseTableName,
                columns: ["chatId"]
            )
        }

        migrator.registerMigration("v3.attachments") { db in
            try db.create(table: AttachmentRecord.databaseTableName) { table in
                table.primaryKey("id", .text)
                table.column("messageId", .text)
                    .notNull()
                    .references(MessageRecord.databaseTableName, onDelete: .cascade)
                table.column("mime", .text).notNull()
                table.column("name", .text)
                table.column("size", .integer)
                table.column("width", .integer)
                table.column("height", .integer)
                table.column("localPath", .text)
            }
            try db.create(
                index: "attachment_on_message",
                on: AttachmentRecord.databaseTableName,
                columns: ["messageId"]
            )
        }

        return migrator
    }
}
