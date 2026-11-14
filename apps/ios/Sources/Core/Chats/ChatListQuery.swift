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
    /// Опрос, геопозиция, контакт, список, стикер последнего сообщения — для превью.
    var lastExtras: MessageExtras?
    /// Вложений в последнем сообщении — превью «Фото», «Голосовое» вместо пустоты.
    var lastAttachmentMime: String?
    var lastAttachmentName: String?
    /// Создатель группы: «удалить» для него удаляет группу у всех, а не выводит из неё.
    var isOwner: Bool
    /// «Пометить как новое»: точка вместо счётчика, пока чат не прочтут.
    var markedUnread: Bool = false
    var pinnedOrder: Int? = nil
    var isFriend: Bool = false
    /// Первое вложение последнего сообщения — миниатюра перед превью, как в Telegram.
    var lastAttachmentId: String? = nil
    var lastAttachmentPlaceholder: String? = nil
    var lastAttachmentLocalPath: String? = nil
    var lastAttachmentWidth: Int? = nil
    var lastAttachmentHeight: Int? = nil
    var lastAttachmentAsDocument: Bool? = nil
    var lastAttachmentSpoiler: Bool? = nil

    var kind: ChatKind { ChatKind.from(type) }
    var isPinned: Bool { pinnedAt != nil }
    /// Непрочитанный для вкладок, «Прочитать» и счётчиков папок: новые сообщения или
    /// ручная пометка.
    var isUnread: Bool { unreadCount > 0 || markedUnread }

    /// Снимок или ролик последнего сообщения — для миниатюры в превью. Только когда
    /// превью и правда показывает это сообщение: черновик, удалённое и системное
    /// сообщение миниатюры не получают. Файл «как документ» — строка файла, не снимок.
    var previewMedia: AttachmentRecord? {
        guard draftText?.isEmpty != false, lastDeletedAt == nil, lastSystemType == nil,
              let fileID = lastAttachmentId, let mime = lastAttachmentMime,
              mime.hasPrefix("image/") || mime.hasPrefix("video/"), lastAttachmentAsDocument != true
        else { return nil }
        // Владелец записи экрану не нужен — только id файла; ключом служит чат.
        return AttachmentRecord(
            id: fileID,
            messageId: id,
            mime: mime,
            name: lastAttachmentName,
            size: nil,
            width: lastAttachmentWidth,
            height: lastAttachmentHeight,
            localPath: lastAttachmentLocalPath,
            placeholder: lastAttachmentPlaceholder,
            spoiler: lastAttachmentSpoiler ?? false
        )
    }

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
        if let special = specialPreview { return special }
        guard let mime = lastAttachmentMime else { return nil }
        if lastAttachmentName?.hasPrefix("voice-") == true {
            return String(localized: "chats.preview.voice", defaultValue: "Голосовое сообщение")
        }
        if mime.hasPrefix("audio/") {
            return lastAttachmentName ?? String(localized: "chats.preview.audio", defaultValue: "Аудио")
        }
        if mime == "image/gif" { return String(localized: "chats.preview.gif", defaultValue: "GIF") }
        if mime.hasPrefix("image/") { return String(localized: "chats.preview.photo", defaultValue: "Фото") }
        if mime.hasPrefix("video/") { return String(localized: "chats.preview.video", defaultValue: "Видео") }
        return lastAttachmentName ?? String(localized: "chats.preview.file", defaultValue: "Файл")
    }

    /// Сообщение без текста и файлов: что именно в нём.
    private var specialPreview: String? {
        guard let extras = lastExtras else { return nil }
        if let poll = extras.poll { return "📊 \(poll.question)" }
        if let location = extras.location {
            return "📍 " + (location.title ?? String(localized: "chats.attach.location", defaultValue: "Геопозиция"))
        }
        if let contact = extras.contact { return "👤 \(contact.name)" }
        if let checklist = extras.checklist { return "☑️ \(checklist.title)" }
        if let sticker = extras.sticker {
            return [sticker.emoji, String(localized: "chats.preview.sticker", defaultValue: "Стикер")]
                .compactMap { $0 }
                .joined(separator: " ")
        }
        return nil
    }

    /// Что показать второй строкой. Текст — без разметки, одной строкой: та же функция,
    /// что в панелях ответа и закрепа (IOS_RULES 7.7.1).
    var preview: String? {
        if let draftText, !draftText.isEmpty { return MessagePreview.text(draftText) }
        if lastDeletedAt != nil {
            return String(localized: "chats.deletedMessage", defaultValue: "Сообщение удалено")
        }
        if let lastContent, !lastContent.isEmpty { return MessagePreview.text(lastContent) }
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
    /// Порядок повторяет сервер и веб: закреплённые сверху, дальше по свежести.
    /// `pinnedAt IS NULL` первой ступенью — это и есть «сначала закреплённые», без
    /// отдельного запроса и склейки на клиенте. Среди закреплённых — ручной порядок
    /// (`pinnedOrder`), а у кого места нет — после них, свежим закреплением выше (§A
    /// контракта).
    static let order: SQL = """
        (c.pinnedAt IS NULL), (c.pinnedOrder IS NULL), c.pinnedOrder, c.pinnedAt DESC, c.updatedAt DESC
        """

    static func rows(for tab: ChatListTab) -> SQLRequest<ChatListRow> {
        let condition: SQL
        switch tab {
        case .all:
            condition = "c.archivedAt IS NULL AND c.requestIncoming = 0"
        case .folder(let id, _):
            condition = "c.archivedAt IS NULL AND c.requestIncoming = 0 AND \(folderCondition(id))"
        case .requests:
            condition = "c.requestIncoming = 1"
        case .archive:
            condition = "c.archivedAt IS NOT NULL AND c.requestIncoming = 0"
        case .unread:
            condition = "c.archivedAt IS NULL AND c.requestIncoming = 0 AND (c.unreadCount > 0 OR c.markedUnread = 1)"
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
                c.markedUnread, c.pinnedOrder, c.isFriend,
                d.text AS draftText,
                m.content AS lastContent,
                m.senderId AS lastSenderId,
                m.createdAt AS lastCreatedAt,
                m.deletedAt AS lastDeletedAt,
                m.senderName AS lastSenderName,
                m.systemType AS lastSystemType,
                m.extras AS lastExtras,
                a.mime AS lastAttachmentMime,
                a.name AS lastAttachmentName,
                a.id AS lastAttachmentId,
                a.placeholder AS lastAttachmentPlaceholder,
                a.localPath AS lastAttachmentLocalPath,
                a.width AS lastAttachmentWidth,
                a.height AS lastAttachmentHeight,
                a.asDocument AS lastAttachmentAsDocument,
                a.spoiler AS lastAttachmentSpoiler
            FROM chat c
            LEFT JOIN draft d ON d.chatId = c.id
            LEFT JOIN message m ON m.id = c.lastMessageId
            -- Первое вложение — одним соединением, а не подзапросом на каждое поле:
            -- полей у миниатюры семь, и столько же проходов по вложениям на строку.
            LEFT JOIN attachment a ON a.id = (
                SELECT a1.id FROM attachment a1 WHERE a1.messageId = m.id LIMIT 1
            )
            WHERE \(condition)
            ORDER BY \(order)
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
        if try has("(unreadCount > 0 OR markedUnread = 1)") { tabs.append(.unread) }
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
        let excluded = Dictionary(grouping: try FolderExcludedChatRecord.fetchAll(db), by: \.folderId)
        return folders.map { folder in
            ChatFolderDTO(
                id: folder.id,
                name: folder.name,
                position: folder.position,
                chatIds: items[folder.id]?.map(\.chatId) ?? [],
                excludedChatIds: excluded[folder.id]?.map(\.chatId) ?? [],
                emoji: folder.emoji,
                color: folder.color,
                includeContacts: folder.includeContacts,
                includeNonContacts: folder.includeNonContacts,
                includeGroups: folder.includeGroups
            )
        }
    }

    // MARK: - Состав папки

    /// Типы чатов, которые папка берёт флагом «Группы». «Избранное» и поддержка в папку
    /// попадают только явным выбором (§C контракта).
    static let groupTypes = ["GROUP", "GROUP_OFFICIAL", "SUBJECT", "FACULTY", "DEAN", "EVENT"]

    /// Правило состава папки — одно на вкладку, её счётчик, теги в строках и «Выкл.
    /// уведомления»; то же правило у сервера (§C контракта):
    ///
    /// чат в папке ⇔ не исключён И (выбран явно
    ///   ИЛИ «Контакты» и личный чат с другом
    ///   ИЛИ «Не контакты» и личный чат не с другом
    ///   ИЛИ «Группы» и групповой тип).
    ///
    /// Условие читает флаги папки из базы, а не подставляет их значениями: правка папки
    /// будит наблюдение за списком сама, без пересборки запроса. Таблица чата — `c`.
    static func folderCondition(_ folderID: String) -> SQL {
        let groups = groupTypes.map { "'\($0)'" }.joined(separator: ", ")
        return """
            c.id NOT IN (SELECT chatId FROM folderExcludedChat WHERE folderId = \(folderID))
            AND (
                c.id IN (SELECT chatId FROM folderChat WHERE folderId = \(folderID))
                OR EXISTS (
                    SELECT 1 FROM folder f WHERE f.id = \(folderID) AND (
                        (f.includeContacts = 1 AND c.type = 'PRIVATE' AND c.isFriend = 1)
                        OR (f.includeNonContacts = 1 AND c.type = 'PRIVATE' AND c.isFriend = 0)
                        OR (f.includeGroups = 1 AND c.type IN (\(sql: groups)))
                    )
                )
            )
            """
    }

    /// Чат на вкладке — не в архиве и не входящий запрос.
    private static let visible: SQL = "c.archivedAt IS NULL AND c.requestIncoming = 0"

    /// Непрочитанные чаты папки — для «Прочитать все» из меню вкладки.
    static func unreadChatIDs(folderID: String, in db: Database) throws -> [String] {
        let request: SQLRequest<String> = """
            SELECT c.id FROM chat c
            WHERE \(visible) AND (c.unreadCount > 0 OR c.markedUnread = 1) AND \(folderCondition(folderID))
            """
        return try request.fetchAll(db)
    }

    /// Закреплённые сверху вниз — в порядке списка. Перестановка на вкладке папки видит
    /// только часть закреплённых; остальные остаются на своих местах.
    static func pinnedChatIDs(in db: Database) throws -> [String] {
        let request: SQLRequest<String> = """
            SELECT c.id FROM chat c WHERE c.pinnedAt IS NOT NULL ORDER BY \(order)
            """
        return try request.fetchAll(db)
    }

    /// Счётчики вкладок папок и теги для строк «Все» — одним проходом на папку. Папок
    /// не больше двадцати, и наблюдение пересчитывает всё разом при любой записи в чаты.
    static func folderSummary(in db: Database) throws -> ChatFolderSummary {
        var summary = ChatFolderSummary()
        let folders = try FolderRecord
            .order(FolderRecord.Columns.position, FolderRecord.Columns.name)
            .fetchAll(db)
        for folder in folders {
            let condition = folderCondition(folder.id)
            let counts: SQLRequest<Row> = """
                SELECT
                    COUNT(*) AS total,
                    COALESCE(SUM(c.muted), 0) AS muted,
                    COALESCE(SUM(CASE WHEN (c.unreadCount > 0 OR c.markedUnread = 1) AND c.muted = 0 THEN 1 ELSE 0 END), 0) AS unread,
                    COALESCE(SUM(CASE WHEN (c.unreadCount > 0 OR c.markedUnread = 1) AND c.muted = 1 THEN 1 ELSE 0 END), 0) AS mutedUnread
                FROM chat c
                WHERE \(visible) AND \(condition)
                """
            if let row = try counts.fetchOne(db) {
                summary.badges[folder.id] = ChatFolderBadge(
                    unread: row["unread"],
                    mutedUnread: row["mutedUnread"],
                    total: row["total"],
                    muted: row["muted"]
                )
            }
            guard let color = folder.color else { continue }
            let members: SQLRequest<String> = "SELECT c.id FROM chat c WHERE \(visible) AND \(condition)"
            let tag = ChatFolderTag(folderID: folder.id, name: folder.name, color: color)
            for chatID in try members.fetchAll(db) {
                summary.tags[chatID, default: []].append(tag)
            }
        }
        return summary
    }
}

/// Счётчик вкладки папки: сколько чатов непрочитано — со звуком и без — и сколько из
/// всех заглушено (для пункта «Выкл./Вкл. уведомления»).
struct ChatFolderBadge: Equatable, Sendable {
    var unread = 0
    var mutedUnread = 0
    var total = 0
    var muted = 0

    /// В папке есть чаты, и все без звука — меню предлагает включить.
    var allMuted: Bool { total > 0 && muted == total }
}

/// Тег папки в строке чата: название цветом папки.
struct ChatFolderTag: Equatable, Hashable, Sendable {
    let folderID: String
    let name: String
    let color: Int
}

struct ChatFolderSummary: Equatable, Sendable {
    var badges: [String: ChatFolderBadge] = [:]
    /// Теги по id чата — только папки с цветом, в порядке вкладок.
    var tags: [String: [ChatFolderTag]] = [:]
}
