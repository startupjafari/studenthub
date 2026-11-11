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
    var subject: String?
    var online: Bool
    var mutedImportantOnly: Bool
    var othersReadAt: Date?
    /// Черновик показывается вместо превью: он важнее чужого последнего сообщения.
    var draftText: String?
    var lastContent: String?
    var lastSenderId: String?
    var lastCreatedAt: Date?
    var lastDeletedAt: Date?
    var lastSenderName: String?
    var lastSystemType: String?
    /// Вложений в последнем сообщении — превью «Фото», «Голосовое» вместо пустоты.
    var lastAttachmentMime: String?
    var lastAttachmentName: String?
    /// Создатель группы: «удалить» для него удаляет группу у всех, а не выводит из неё.
    var isOwner: Bool

    var kind: ChatKind { ChatKind.from(type) }
    var isPinned: Bool { pinnedAt != nil }

    /// Название для строки: у личного — имя собеседника, у официальных без названия —
    /// тема или подпись по типу, у «Избранного» — своё слово.
    var displayTitle: String {
        if kind == .saved { return String(localized: "chats.saved", defaultValue: "Избранное") }
        if let title, !title.isEmpty { return title }
        if let subject, !subject.isEmpty { return subject }
        switch kind {
        case .groupOfficial: return String(localized: "chats.kind.group", defaultValue: "Чат группы")
        case .faculty: return String(localized: "chats.kind.faculty", defaultValue: "Факультет")
        case .dean: return String(localized: "chats.kind.dean", defaultValue: "Деканат")
        case .support, .supportPlatform: return String(localized: "chats.kind.support", defaultValue: "Поддержка")
        default: return String(localized: "chats.untitled", defaultValue: "Без названия")
        }
    }

    /// Текст превью, когда в последнем сообщении нет текста: что именно пришло.
    var attachmentPreview: String? {
        guard let mime = lastAttachmentMime else { return nil }
        if mime.hasPrefix("audio/") || lastAttachmentName?.hasPrefix("voice-") == true {
            return String(localized: "chats.preview.voice", defaultValue: "Голосовое сообщение")
        }
        if mime.hasPrefix("image/") { return String(localized: "chats.preview.photo", defaultValue: "Фото") }
        if mime.hasPrefix("video/") { return String(localized: "chats.preview.video", defaultValue: "Видео") }
        return lastAttachmentName ?? String(localized: "chats.preview.file", defaultValue: "Файл")
    }

    /// Что показать второй строкой.
    var preview: String? {
        if let draftText, !draftText.isEmpty { return draftText }
        if lastDeletedAt != nil {
            return String(localized: "chats.deletedMessage", defaultValue: "Сообщение удалено")
        }
        if let lastContent, !lastContent.isEmpty { return lastContent }
        return attachmentPreview
    }
}

/// Вкладка над списком.
enum ChatListTab: Equatable, Hashable {
    case all
    case folder(id: String, name: String)
    case requests
    case archive
    /// Встроенные вкладки веба по типу и непрочитанному.
    case unread
    case personal
    case groups
    case subjects
    case university

    /// Id своей папки — у вкладки по типу его нет.
    var folderID: String? {
        if case .folder(let id, _) = self { return id }
        return nil
    }
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
        case .unread:
            condition = "c.archivedAt IS NULL AND c.requestIncoming = 0 AND c.unreadCount > 0"
        case .personal:
            condition = "c.archivedAt IS NULL AND c.requestIncoming = 0 AND c.type IN ('PRIVATE', 'SAVED')"
        case .groups:
            condition = "c.archivedAt IS NULL AND c.requestIncoming = 0 AND c.type IN ('GROUP', 'GROUP_OFFICIAL')"
        case .subjects:
            condition = "c.archivedAt IS NULL AND c.requestIncoming = 0 AND c.type = 'SUBJECT'"
        case .university:
            condition = """
                c.archivedAt IS NULL AND c.requestIncoming = 0
                AND c.type IN ('FACULTY', 'DEAN', 'SUPPORT', 'SUPPORT_PLATFORM', 'EVENT')
                """
        }

        return """
            SELECT
                c.id, c.type, c.title, c.avatarUrl, c.unreadCount, c.muted,
                c.pinnedAt, c.archivedAt, c.requestIncoming, c.updatedAt,
                c.subject, c.online, c.mutedImportantOnly, c.othersReadAt, c.isOwner,
                d.text AS draftText,
                m.content AS lastContent,
                m.senderId AS lastSenderId,
                m.createdAt AS lastCreatedAt,
                m.deletedAt AS lastDeletedAt,
                m.senderName AS lastSenderName,
                m.systemType AS lastSystemType,
                (SELECT a.mime FROM attachment a WHERE a.messageId = m.id LIMIT 1) AS lastAttachmentMime,
                (SELECT a.name FROM attachment a WHERE a.messageId = m.id LIMIT 1) AS lastAttachmentName
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
        // Вкладки по типу — только непустые: пустая вкладка занимает место и ничего не
        // сообщает (так же решает веб). Свои папки — после встроенных.
        let active = "archivedAt IS NULL AND requestIncoming = 0"
        func has(_ condition: String) throws -> Bool {
            try Bool.fetchOne(db, sql: "SELECT EXISTS(SELECT 1 FROM chat WHERE \(active) AND \(condition))") ?? false
        }
        if try has("unreadCount > 0") { tabs.append(.unread) }
        if try has("type = 'PRIVATE'") { tabs.append(.personal) }
        if try has("type IN ('GROUP', 'GROUP_OFFICIAL')") { tabs.append(.groups) }
        if try has("type = 'SUBJECT'") { tabs.append(.subjects) }
        if try has("type IN ('FACULTY', 'DEAN', 'SUPPORT', 'SUPPORT_PLATFORM', 'EVENT')") { tabs.append(.university) }

        let folders = try FolderRecord
            .order(FolderRecord.Columns.position, FolderRecord.Columns.name)
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

    /// Свои папки с составом — в порядке вкладок. Позиции после удалений бывают с
    /// пропусками и повторами, поэтому вторая ступень — имя, как у сервера и веба.
    /// Состав читается без лимита: его держит сервер — не больше 20 папок по 200 чатов.
    static func folders(in db: Database) throws -> [ChatFolderDTO] {
        let folders = try FolderRecord
            .order(FolderRecord.Columns.position, FolderRecord.Columns.name)
            .fetchAll(db)
        let items = Dictionary(grouping: try FolderChatRecord.fetchAll(db), by: \.folderId)
        return folders.map { folder in
            ChatFolderDTO(
                id: folder.id,
                name: folder.name,
                position: folder.position,
                chatIds: items[folder.id]?.map(\.chatId) ?? []
            )
        }
    }
}
