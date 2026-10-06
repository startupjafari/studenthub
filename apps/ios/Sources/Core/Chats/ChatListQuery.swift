import Foundation
import GRDB

/// Строка списка чатов — ровно то, что рисует экран.
///
/// Плоская структура и запрос руками, а не ассоциации: в списке три источника
/// (чат, превью последнего сообщения, черновик), и один понятный SQL честнее трёх
/// склеенных запросов.
struct ChatListRow: FetchableRecord, Decodable, Identifiable, Equatable {
    var id: String
    var type: String
    var title: String?
    var avatarUrl: String?
    var unreadCount: Int
    var muted: Bool
    var pinnedAt: Date?
    var archivedAt: Date?
    var requestIncoming: Bool
    var updatedAt: Date
    /// Черновик показывается вместо превью: он важнее чужого последнего сообщения.
    var draftText: String?
    var lastContent: String?
    var lastSenderId: String?
    var lastCreatedAt: Date?
    var lastDeletedAt: Date?

    var kind: ChatKind { ChatKind.from(type) }
    var isPinned: Bool { pinnedAt != nil }

    /// Что показать второй строкой.
    var preview: String? {
        if let draftText, !draftText.isEmpty { return draftText }
        if lastDeletedAt != nil { return nil }
        return lastContent
    }
}

/// Вкладка над списком.
enum ChatListTab: Equatable, Hashable {
    case all
    case folder(id: String, name: String)
    case requests
    case archive
}

enum ChatListQuery {
    /// Один запрос на все вкладки: меняется только условие отбора.
    ///
    /// Порядок повторяет сервер и веб: закреплённые сверху по времени закрепления,
    /// дальше по свежести. `pinnedAt IS NULL` первой ступенью — это и есть «сначала
    /// закреплённые», без отдельного запроса и склейки на клиенте.
    static func rows(for tab: ChatListTab) -> SQLRequest<ChatListRow> {
        let condition: SQL
        switch tab {
        case .all:
            condition = "c.archivedAt IS NULL AND c.requestIncoming = 0"
        case .folder(let id, _):
            condition = """
                c.archivedAt IS NULL AND c.requestIncoming = 0
                AND c.id IN (SELECT chatId FROM folderChat WHERE folderId = \(id))
                """
        case .requests:
            condition = "c.requestIncoming = 1"
        case .archive:
            condition = "c.archivedAt IS NOT NULL AND c.requestIncoming = 0"
        }

        return """
            SELECT
                c.id, c.type, c.title, c.avatarUrl, c.unreadCount, c.muted,
                c.pinnedAt, c.archivedAt, c.requestIncoming, c.updatedAt,
                d.text AS draftText,
                m.content AS lastContent,
                m.senderId AS lastSenderId,
                m.createdAt AS lastCreatedAt,
                m.deletedAt AS lastDeletedAt
            FROM chat c
            LEFT JOIN draft d ON d.chatId = c.id
            LEFT JOIN message m ON m.id = c.lastMessageId
            WHERE \(condition)
            ORDER BY (c.pinnedAt IS NULL), c.pinnedAt DESC, c.updatedAt DESC
            """
    }

    /// Вкладки: «Все», папки по позиции, «Запросы» и «Архив» — последние две только
    /// тогда, когда в них что-то есть. Пустая вкладка «Архив» занимает место и ничего
    /// не сообщает.
    static func tabs(in db: Database) throws -> [ChatListTab] {
        var tabs: [ChatListTab] = [.all]
        let folders = try FolderRecord
            .order(FolderRecord.Columns.position)
            .fetchAll(db)
        tabs += folders.map { .folder(id: $0.id, name: $0.name) }

        let requests = try ChatRecord
            .filter(ChatRecord.Columns.requestIncoming == true)
            .fetchCount(db)
        if requests > 0 { tabs.append(.requests) }

        let archived = try ChatRecord
            .filter(ChatRecord.Columns.archivedAt != nil)
            .fetchCount(db)
        if archived > 0 { tabs.append(.archive) }

        return tabs
    }
}
