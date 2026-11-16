import Foundation
import GRDB
import os

/// Чтение базы для списка чатов и экранов вокруг него: вкладки, папки, число на
/// вкладке «Чаты», выбор чатов в листах, поиск.
///
/// Экраны не знают про GRDB (IOS_RULES 9.1.2): наблюдение здесь отдаётся потоком, а
/// разовое чтение — асинхронной функцией. Сами запросы живут в `ChatListQuery`; здесь —
/// только как их читать и наблюдать.
struct ChatListQueries: Sendable {
    let database: AppDatabase

    init(database: AppDatabase = AppServices.database) {
        self.database = database
    }

    // MARK: - Наблюдение

    /// Строки вкладки. Запись, не меняющая строк (страница истории, прочтение в открытом
    /// чате), не будит список и не запускает анимацию перестановки.
    func observeRows(for tab: ChatListTab) -> AsyncStream<[ChatListRow]> {
        let request = ChatListQuery.rows(for: tab)
        let observation = ValueObservation.tracking { db -> [ChatListRow] in
            let signpost = Signposts.chats.beginInterval("ChatListRead")
            let rows = try request.fetchAll(db)
            Signposts.chats.endInterval("ChatListRead", signpost, "rows: \(rows.count)")
            return rows
        }
        .removeDuplicates()
        return AsyncValues.stream(of: observation, in: database.reader)
    }

    /// Архивные чаты — для строки «Архив» над списком.
    func observeArchivedRows() -> AsyncStream<[ChatListRow]> {
        let request = ChatListQuery.rows(for: .archive)
        let observation = ValueObservation.tracking { db in try request.fetchAll(db) }
            .removeDuplicates()
        return AsyncValues.stream(of: observation, in: database.reader)
    }

    func observeFolderSummary() -> AsyncStream<ChatFolderSummary> {
        let observation = ValueObservation.tracking { db in try ChatListQuery.folderSummary(in: db) }
            .removeDuplicates()
        return AsyncValues.stream(of: observation, in: database.reader)
    }

    func observeTabs() -> AsyncStream<[ChatListTab]> {
        let observation = ValueObservation.tracking { db in try ChatListQuery.tabs(in: db) }
            .removeDuplicates()
        return AsyncValues.stream(of: observation, in: database.reader)
    }

    func observeFolders() -> AsyncStream<[ChatFolderDTO]> {
        let observation = ValueObservation.tracking { db in try ChatListQuery.folders(in: db) }
            .removeDuplicates()
        return AsyncValues.stream(of: observation, in: database.reader)
    }

    /// Число на вкладке «Чаты»: архив и чаты без звука не считаются, чат «как новое» без
    /// новых сообщений добавляет единицу. Число то же — оболочка с вкладками не
    /// пересчитывается.
    func observeUnreadTotal() -> AsyncStream<Int> {
        let observation = ValueObservation.tracking { db in
            try Int.fetchOne(
                db,
                sql: """
                    SELECT COALESCE(SUM(CASE WHEN unreadCount > 0 THEN unreadCount ELSE markedUnread END), 0)
                    FROM chat
                    WHERE archivedAt IS NULL AND muted = 0
                    """
            ) ?? 0
        }
        .removeDuplicates()
        return AsyncValues.stream(of: observation, in: database.reader)
    }

    // MARK: - Разовое чтение

    /// Непрочитанные чаты папки — «Прочитать все» из меню вкладки.
    func fetchUnreadChatIDs(folderID: String) async throws -> [String] {
        try await database.reader.read { db in
            try ChatListQuery.unreadChatIDs(folderID: folderID, in: db)
        }
    }

    /// Закреплённые сверху вниз — в порядке списка.
    func fetchPinnedChatIDs() async throws -> [String] {
        try await database.reader.read { db in try ChatListQuery.pinnedChatIDs(in: db) }
    }

    /// Строки одной вкладки — для листов выбора чата.
    func fetchRows(for tab: ChatListTab) async throws -> [ChatListRow] {
        try await database.reader.read { db in
            try ChatListQuery.rows(for: tab).fetchAll(db)
        }
    }

    /// Чаты для состава папки: живые и архивные одним чтением.
    func fetchFolderCandidates() async throws -> [ChatListRow] {
        let all = ChatListQuery.rows(for: .all)
        let archived = ChatListQuery.rows(for: .archive)
        return try await database.reader.read { db in
            try all.fetchAll(db) + archived.fetchAll(db)
        }
    }

    func fetchChat(id: String) async throws -> ChatRecord? {
        try await database.reader.read { db in try ChatRecord.fetchOne(db, key: id) }
    }

    func fetchChats(ids: [String]) async throws -> [ChatRecord] {
        try await database.reader.read { db in
            try ChatRecord.fetchAll(db, keys: ids)
        }
    }

    /// Последние двенадцать сообщений чата с вложениями — для превью переписки по
    /// долгому нажатию на строку.
    func fetchPreview(chatID id: String) async throws -> ThreadSnapshot {
        try await database.reader.read { db -> ThreadSnapshot in
            let messages = try MessageRecord
                .filter(MessageRecord.Columns.chatId == id)
                .order(MessageRecord.Columns.createdAt.desc)
                .limit(12)
                .fetchAll(db)
            let ids = messages.map(\.id)
            let attachments = try AttachmentRecord
                .filter(ids.contains(AttachmentRecord.Columns.messageId))
                .fetchAll(db)
            return ThreadSnapshot(
                messages: messages.reversed(),
                attachments: Dictionary(grouping: attachments, by: \.messageId)
            )
        }
    }

    /// Вложение из базы — галерея медиа чата берёт свой файл с диска, если он есть.
    func fetchAttachment(id: String) async throws -> AttachmentRecord? {
        try await database.reader.read { db in try AttachmentRecord.fetchOne(db, key: id) }
    }
}
