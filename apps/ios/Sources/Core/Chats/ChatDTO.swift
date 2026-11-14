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
    /// Собеседник в сети — только у личного чата.
    var online: Bool? = nil
    var isOwner: Bool? = nil
    var isAdmin: Bool? = nil
    /// Я заблокировал собеседника / он меня.
    var blocked: Bool? = nil
    var blockedBy: Bool? = nil
    /// Пометка «как новое», место среди закреплённых и «собеседник в друзьях». Старый
    /// сервер их не присылает — поля необязательны, значения по умолчанию у записи.
    var markedUnread: Bool? = nil
    var pinnedOrder: Int? = nil
    var isFriend: Bool? = nil
}

/// Вложение сообщения. Вид (картинка, файл, голосовое) выводится при рендере из
/// mime, имени и флага `asDocument` — отдельного типа сообщения в модели нет
/// (PROJECT.md §9.1a).
struct ChatAttachmentDTO: Decodable, Equatable {
    let id: String
    let mime: String
    let size: Int?
    let name: String?
    let spoiler: Bool?
    let asDocument: Bool?
    let width: Int?
    let height: Int?
    /// Размытое превью (LQIP) и длительность — у фото и видео, пока не скачан файл.
    var placeholder: String? = nil
    var durationMs: Int? = nil
}

/// Человек в сообщении: автор, автор ответа, автор пересланного.
struct ChatPersonDTO: Codable, Hashable {
    let id: String
    let firstName: String?
    let lastName: String?
    var avatarUrl: String? = nil

    var name: String {
        [lastName, firstName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
    }
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
    let media: [ChatAttachmentDTO]?
    var sender: ChatPersonDTO? = nil
    /// Каждая реакция отдельной строкой: у человека одна реакция на сообщение.
    var reactions: [Reaction]? = nil
    var replyTo: Reply? = nil
    var forwardedFromId: String? = nil
    var forwardedFrom: Forwarded? = nil
    var linkPreview: MessageExtras.LinkPreview? = nil
    var systemMeta: MessageExtras.SystemMeta? = nil
    var sharedPost: SharedPost? = nil
    var sharedStory: SharedStory? = nil
    var sharedStoryReply: Bool? = nil
    var poll: MessageExtras.Poll? = nil
    var location: MessageExtras.Location? = nil
    var contact: MessageExtras.Contact? = nil
    var checklist: MessageExtras.Checklist? = nil
    var sticker: MessageExtras.Sticker? = nil

    struct Reaction: Decodable, Equatable {
        let emoji: String
        let userId: String
        var user: ChatPersonDTO? = nil
    }

    struct Reply: Decodable, Equatable {
        let id: String
        let content: String?
        let senderId: String?
        var sender: ChatPersonDTO? = nil
    }

    struct Forwarded: Decodable, Equatable {
        let id: String
        let senderId: String?
        var sender: ChatPersonDTO? = nil
    }

    struct SharedPost: Decodable, Equatable {
        let id: String
        let title: String?
        let content: String?
        var author: ChatPersonDTO? = nil
        var deletedAt: Date? = nil
    }

    struct SharedStory: Decodable, Equatable {
        let id: String
        let text: String?
        let background: String?
        var author: ChatPersonDTO? = nil
    }

    /// Всё, что лента рисует сверх текста, — одним значением для базы.
    var extras: MessageExtras {
        MessageExtras(
            reactions: Dictionary(grouping: reactions ?? [], by: \.emoji)
                .map { MessageExtras.ReactionGroup(emoji: $0.key, userIds: $0.value.map(\.userId)) }
                .sorted { $0.userIds.count == $1.userIds.count ? $0.emoji < $1.emoji : $0.userIds.count > $1.userIds.count },
            replySenderName: replyTo?.sender?.name,
            replyContent: replyTo?.content,
            forwardedFromName: forwardedFrom?.sender?.name,
            isForwarded: forwardedFromId != nil,
            linkPreview: linkPreview,
            systemMeta: systemMeta,
            sharedPost: sharedPost.map {
                MessageExtras.SharedPostCard(
                    id: $0.id,
                    title: $0.title,
                    excerpt: $0.content,
                    authorName: $0.author?.name,
                    isDeleted: $0.deletedAt != nil
                )
            },
            sharedStory: sharedStory.map {
                MessageExtras.SharedStoryCard(
                    id: $0.id,
                    text: $0.text,
                    background: $0.background,
                    authorName: $0.author?.name,
                    isReply: sharedStoryReply == true
                )
            },
            poll: poll,
            location: location,
            contact: contact,
            checklist: checklist,
            sticker: sticker
        )
    }
}

/// Подробности сообщения сверх текста. Лежат в базе одной JSON-колонкой: по ним не
/// ищут и не сортируют, а отдельные таблицы на каждую — это джойны на каждом кадре
/// ленты.
struct MessageExtras: Codable, Hashable {
    struct ReactionGroup: Codable, Hashable {
        let emoji: String
        let userIds: [String]
    }

    struct LinkPreview: Codable, Hashable {
        let url: String
        let title: String?
        let description: String?
        let siteName: String?
    }

    /// Подробности системного сообщения: чьё имя и какое название подставить.
    struct SystemMeta: Codable, Hashable {
        let targetName: String?
        let title: String?
    }

    struct SharedPostCard: Codable, Hashable {
        let id: String
        let title: String?
        let excerpt: String?
        let authorName: String?
        let isDeleted: Bool
    }

    struct SharedStoryCard: Codable, Hashable {
        let id: String
        let text: String?
        let background: String?
        let authorName: String?
        let isReply: Bool
    }

    struct Poll: Codable, Hashable {
        struct Option: Codable, Hashable, Identifiable {
            let id: String
            let text: String
            let order: Int?
        }

        let id: String
        let question: String
        let multiple: Bool?
        let anonymous: Bool?
        let allowRevote: Bool?
        let closed: Bool?
        let options: [Option]
        /// Пояснение под вопросом (необязательное).
        var description: String? = nil
    }

    /// Точка на карте.
    struct Location: Codable, Hashable {
        let lat: Double
        let lng: Double
        var title: String? = nil
        var address: String? = nil
        /// Живая геопозиция: до какого момента транслируется (у статичной — `nil`).
        var liveUntil: Date? = nil
        var liveUpdatedAt: Date? = nil
        var heading: Double? = nil
        var accuracy: Double? = nil

        func isLive(at now: Date = Date()) -> Bool {
            liveUntil.map { $0 > now } ?? false
        }
    }

    /// Карточка контакта из телефонной книги.
    struct Contact: Codable, Hashable {
        let name: String
        var phones: [String] = []
        var emails: [String] = []
        var userId: String? = nil
    }

    /// Общий список дел: пункты отмечают участники, изменения приходят событием
    /// `checklist:updated`.
    struct Checklist: Codable, Hashable, Identifiable {
        struct Item: Codable, Hashable, Identifiable {
            let id: String
            let text: String
            var order: Int? = nil
            let done: Bool
            var doneAt: Date? = nil
            var doneBy: ChatPersonDTO? = nil
            /// Кто добавил пункт: убрать его может он и автор списка.
            var createdById: String? = nil
        }

        let id: String
        let title: String
        var othersCanAdd: Bool? = nil
        var othersCanMark: Bool? = nil
        let items: [Item]
    }

    /// Стикер из каталога: картинку отдаёт `GET /chats/stickers/:id/url`.
    struct Sticker: Codable, Hashable {
        let id: String
        var setId: String? = nil
        var emoji: String? = nil
        var width: Int? = nil
        var height: Int? = nil
    }

    var reactions: [ReactionGroup] = []
    var replySenderName: String?
    var replyContent: String?
    var forwardedFromName: String?
    var isForwarded = false
    var linkPreview: LinkPreview?
    var systemMeta: SystemMeta?
    var sharedPost: SharedPostCard?
    var sharedStory: SharedStoryCard?
    var poll: Poll?
    var location: Location?
    var contact: Contact?
    var checklist: Checklist?
    var sticker: Sticker?

    /// Есть ли содержимое вида, известного этой сборке. Сообщение без текста, файлов и такого
    /// содержимого — новый вид из будущей версии: его рисуют заглушкой «обновите приложение»,
    /// а не пустым пузырём (IOS_RULES 9.2.8). Новый вид — добавить сюда, иначе он станет заглушкой.
    var hasKnownContent: Bool {
        sharedPost != nil || sharedStory != nil || poll != nil || location != nil || contact != nil
            || checklist != nil || sticker != nil
    }
}

/// Папка чатов (§2 эпика «Чаты»): имя, позиция вкладки, состав и правила как в Telegram —
/// типы чатов, исключения, значок и цвет тега.
///
/// Разбор терпимый: старый сервер новых полей не присылает, и папка с ним остаётся
/// прежней — только явные чаты, без значка и цвета.
struct ChatFolderDTO: Decodable, Equatable, Identifiable {
    var id: String
    var name: String
    var position: Int
    var chatIds: [String]
    var excludedChatIds: [String] = []
    var emoji: String? = nil
    var color: Int? = nil
    var includeContacts = false
    var includeNonContacts = false
    var includeGroups = false

    init(
        id: String,
        name: String,
        position: Int,
        chatIds: [String],
        excludedChatIds: [String] = [],
        emoji: String? = nil,
        color: Int? = nil,
        includeContacts: Bool = false,
        includeNonContacts: Bool = false,
        includeGroups: Bool = false
    ) {
        self.id = id
        self.name = name
        self.position = position
        self.chatIds = chatIds
        self.excludedChatIds = excludedChatIds
        self.emoji = emoji
        self.color = color
        self.includeContacts = includeContacts
        self.includeNonContacts = includeNonContacts
        self.includeGroups = includeGroups
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, position, chatIds, excludedChatIds, emoji, color
        case includeContacts, includeNonContacts, includeGroups
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        position = try container.decodeIfPresent(Int.self, forKey: .position) ?? 0
        chatIds = try container.decodeIfPresent([String].self, forKey: .chatIds) ?? []
        excludedChatIds = try container.decodeIfPresent([String].self, forKey: .excludedChatIds) ?? []
        emoji = try container.decodeIfPresent(String.self, forKey: .emoji)
        // Цвет вне палитры (новая сборка сервера) — без цвета, а не падение разбора.
        color = (try? container.decodeIfPresent(Int.self, forKey: .color)).flatMap { $0 }
            .flatMap { (0..<ChatFolderPalette.count).contains($0) ? $0 : nil }
        includeContacts = try container.decodeIfPresent(Bool.self, forKey: .includeContacts) ?? false
        includeNonContacts = try container.decodeIfPresent(Bool.self, forKey: .includeNonContacts) ?? false
        includeGroups = try container.decodeIfPresent(Bool.self, forKey: .includeGroups) ?? false
    }

    /// Хоть один тип чатов включён — папка собирается не только из явного выбора.
    var includesTypes: Bool { includeContacts || includeNonContacts || includeGroups }
}

/// Лимиты папок — те же, что проверяет сервер (`CHAT_FOLDER_LIMITS`). Клиент упирается в
/// них заранее: иначе человек собрал бы папку и узнал об отказе только на «Сохранить».
enum ChatFolderLimits {
    static let folders = 20
    static let chatsPerFolder = 200
    static let nameLength = 40
    /// Исключений — столько же, сколько явных чатов (§C контракта).
    static let excludedPerFolder = 200
}

/// Палитра цветов папки (§C контракта): синий, зелёный, оранжевый, красный, фиолетовый,
/// бирюзовый, розовый. Сервер хранит индекс; сами цвета — у экрана (`ChatFolderPalette.colors`).
enum ChatFolderPalette {
    static let count = 7
}
