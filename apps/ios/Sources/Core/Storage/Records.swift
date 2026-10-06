import Foundation
import GRDB

/// Строки локальной базы.
///
/// Поля повторяют ответ API (`GET /chats`, `GET /chats/:id/messages`), а не придумывают
/// свою модель: экран читает только базу, сеть пишет в базу — и чем меньше между ними
/// преобразований, тем меньше мест, где они разойдутся.

/// Чат в списке.
struct ChatRecord: Codable, FetchableRecord, PersistableRecord, Equatable {
    static let databaseTableName = "chat"

    var id: String
    /// Строкой, а не `ChatKind`: в базе может лежать тип, которого в этой сборке ещё
    /// нет (см. `ChatKind.unknown`).
    var type: String
    var title: String?
    var avatarUrl: String?
    var chatDescription: String?
    var subject: String?
    var memberCount: Int
    var unreadCount: Int
    var muted: Bool
    var mutedImportantOnly: Bool
    var pinnedAt: Date?
    var archivedAt: Date?
    /// Запрос на переписку (§50): решение за мной либо я жду ответа.
    var requestIncoming: Bool
    var requestOutgoing: Bool
    /// До какого времени собеседники прочитали переписку.
    var othersReadAt: Date?
    /// Превью списка. Без внешнего ключа намеренно: превью приходит со списком чатов,
    /// а само сообщение попадает в базу только когда человек откроет чат.
    var lastMessageId: String?
    /// Номер последнего известного сообщения. С него идёт догон после обрыва связи
    /// (`GET /chats/:id/updates`, PROJECT.md §9.2c).
    var lastSeq: Int
    /// Порядок списка задаёт сервер — по нему же страницы и приходят.
    var updatedAt: Date

    var kind: ChatKind { ChatKind.from(type) }

    enum Columns {
        static let id = Column(CodingKeys.id)
        static let pinnedAt = Column(CodingKeys.pinnedAt)
        static let archivedAt = Column(CodingKeys.archivedAt)
        static let updatedAt = Column(CodingKeys.updatedAt)
        static let requestIncoming = Column(CodingKeys.requestIncoming)
    }
}

/// Состояние отправки. Сообщение живёт в базе с момента, когда человек нажал
/// «отправить», — иначе лента ждала бы сеть, а в этом вся задумка.
enum MessageSendState: String, Codable, Equatable, DatabaseValueConvertible {
    /// Подтверждено сервером.
    case sent
    /// Лежит в очереди на отправку.
    case pending
    /// Отправка не удалась: человек видит сообщение и может повторить.
    case failed
}

struct MessageRecord: Codable, FetchableRecord, PersistableRecord, Equatable {
    static let databaseTableName = "message"

    /// Идентификатор строки: серверный id у пришедших сообщений, локальный UUID — у
    /// своих, пока сервер не ответил. Первичный ключ не переписываем: дешевле
    /// проставить `remoteId`, чем обновлять ссылки на строку.
    var id: String
    /// Серверный id. `nil`, пока сообщение не подтверждено.
    var remoteId: String?
    var chatId: String
    /// Номер в чате. `nil` у неотправленного: нумерацию выдаёт сервер, и придумывать
    /// её на клиенте нельзя — разойдётся с порядком у всех остальных.
    var seq: Int?
    var senderId: String
    var content: String
    var replyToId: String?
    var replyQuote: String?
    /// Системное сообщение («N вошёл в группу») — у него нет автора-человека.
    var systemType: String?
    var editedAt: Date?
    /// Мягкое удаление, как на сервере: строка остаётся, текст в ленте заменяется.
    var deletedAt: Date?
    var pinnedAt: Date?
    var createdAt: Date
    var sendState: MessageSendState

    enum Columns {
        static let id = Column(CodingKeys.id)
        static let remoteId = Column(CodingKeys.remoteId)
        static let chatId = Column(CodingKeys.chatId)
        static let seq = Column(CodingKeys.seq)
        static let createdAt = Column(CodingKeys.createdAt)
        static let sendState = Column(CodingKeys.sendState)
    }
}

/// Черновик. На сервере он тоже есть (`ChatMember.draft`), но местная копия первична:
/// человек печатает и переключает чаты быстрее, чем уходит запрос, и терять текст
/// из-за сети недопустимо. `isSynced` помечает, донесли ли мы его до сервера.
struct DraftRecord: Codable, FetchableRecord, PersistableRecord, Equatable {
    static let databaseTableName = "draft"

    var chatId: String
    var text: String
    var replyToId: String?
    var updatedAt: Date
    var isSynced: Bool

    enum Columns {
        static let chatId = Column(CodingKeys.chatId)
        static let isSynced = Column(CodingKeys.isSynced)
    }
}

/// Папка чатов (§2 эпика «Чаты»): вкладка над списком.
struct FolderRecord: Codable, FetchableRecord, PersistableRecord, Equatable {
    static let databaseTableName = "folder"

    var id: String
    var name: String
    var position: Int

    enum Columns {
        static let position = Column(CodingKeys.position)
    }
}

/// Состав папки. Хранится отдельной таблицей, а не массивом в папке: по нему идёт
/// фильтр списка, и выбирать чаты вложенным запросом дешевле, чем разбирать JSON.
struct FolderChatRecord: Codable, FetchableRecord, PersistableRecord, Equatable {
    static let databaseTableName = "folderChat"

    var folderId: String
    var chatId: String
}
