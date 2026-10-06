import Foundation

/// Ответы API чатов (PROJECT.md §8.3).
///
/// Здесь только те поля, которые приложение действительно использует: лишние
/// обязательные поля превращают любое изменение на сервере в падение разбора, а
/// необязательные и невостребованные — в мусор, который никто не поддерживает.

struct ChatListItemDTO: Decodable, Equatable {
    let id: String
    let type: String
    let title: String?
    let avatarUrl: String?
    let description: String?
    let subject: String?
    let memberCount: Int?
    let unreadCount: Int?
    let muted: Bool?
    let mutedImportantOnly: Bool?
    let draft: String?
    let pinnedAt: Date?
    let archived: Bool?
    let othersReadAt: Date?
    let requestIncoming: Bool?
    let requestOutgoing: Bool?
    let lastMessage: ChatMessageDTO?
    let updatedAt: Date
}

struct ChatMessageDTO: Decodable, Equatable {
    let id: String
    let chatId: String
    let seq: Int?
    let senderId: String
    let content: String
    let replyToId: String?
    let replyQuote: String?
    let systemType: String?
    let editedAt: Date?
    let deletedAt: Date?
    let pinnedAt: Date?
    let createdAt: Date
}

/// Папка чатов (§2 эпика «Чаты»): имя, позиция вкладки и состав.
struct ChatFolderDTO: Decodable, Equatable {
    let id: String
    let name: String
    let position: Int
    let chatIds: [String]
}
