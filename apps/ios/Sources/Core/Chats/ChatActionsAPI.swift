import Foundation

// Действия над чатами и сообщениями сверх списка и истории: реакции, закрепление,
// пересылка, участники, управление группой, поиск, опросы (PROJECT.md §8.3, §9).
// Правка и удаление сообщений идут через сокет — см. `RealtimeCoordinator`.

/// Участник чата.
struct ChatMemberDTO: Decodable, Equatable, Identifiable {
    let id: String
    let firstName: String?
    let lastName: String?
    let avatarUrl: String?
    let role: String?
    let online: Bool?
    /// Есть, только когда человек не в сети и разрешил показывать время.
    let lastSeenAt: Date?
    let banned: Bool?
    let isAdmin: Bool?

    var name: String {
        [lastName, firstName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
    }
}

/// Человек из справочника вуза — для нового чата и добавления в группу.
struct DirectoryUserDTO: Decodable, Equatable, Identifiable {
    struct Named: Decodable, Equatable {
        let name: String?
    }

    let id: String
    let firstName: String?
    let lastName: String?
    let avatarUrl: String?
    let role: String?
    let group: Named?

    var name: String {
        [lastName, firstName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
    }
}

/// Файл из раздела «Медиа», «Файлы» или «Голосовые» в информации о чате.
struct ChatMediaItemDTO: Decodable, Equatable, Identifiable {
    let id: String
    let messageId: String
    let name: String?
    let mime: String
    let size: Int?
    let width: Int?
    let height: Int?
    let placeholder: String?
    let durationMs: Int?
    let createdAt: Date
}

/// Ссылка из раздела «Ссылки».
struct ChatLinkItemDTO: Decodable, Equatable, Identifiable {
    let messageId: String
    let createdAt: Date
    let sender: ChatPersonDTO?
    let linkPreview: MessageExtras.LinkPreview?

    var id: String { messageId }
}

/// Результаты опроса.
struct PollResultsDTO: Decodable, Equatable {
    struct Option: Decodable, Equatable, Identifiable {
        let id: String
        let text: String
        let votes: Int
        let voters: [ChatPersonDTO]?
    }

    let id: String
    let anonymous: Bool
    let multiple: Bool
    let allowRevote: Bool
    let closed: Bool
    let totalVotes: Int
    let options: [Option]
    let myOptionIds: [String]
}

/// Кто дочитал групповой чат до какого момента.
struct ChatReadDTO: Decodable, Equatable, Identifiable {
    let id: String
    let firstName: String?
    let lastName: String?
    let avatarUrl: String?
    let lastReadAt: Date?
}

/// Вид раздела вложений в информации о чате.
enum ChatMediaKind: String {
    case media, file, voice
}

/// Реакции на сообщения — белый список сервера (`CHAT_REACTION_EMOJIS`). Любая
/// другая отвечает 400, поэтому полного набора эмодзи здесь нет.
enum ChatReactions {
    static let all = ["👍", "❤️", "😂", "🎉", "😮", "😢", "🔥", "👀"]
    /// Двойное нажатие на пузырь — как в вебе.
    static let doubleTap = "🔥"
}

protocol ChatActing: Sendable {
    // Сообщения
    func react(messageID: String, emoji: String) async throws -> ChatMessageDTO
    func setPinned(_ pinned: Bool, messageID: String) async throws
    func pinned(chatID: String) async throws -> [ChatMessageDTO]
    func forward(messageID: String, to chatID: String) async throws
    func searchMessages(_ query: String, chatID: String?) async throws -> [ChatMessageDTO]
    func around(messageID: String, chatID: String) async throws -> Page<ChatMessageDTO>
    func reads(chatID: String) async throws -> [ChatReadDTO]
    // Чат
    func members(chatID: String) async throws -> [ChatMemberDTO]
    func media(chatID: String, kind: ChatMediaKind, cursor: String?) async throws -> Page<ChatMediaItemDTO>
    func links(chatID: String, cursor: String?) async throws -> Page<ChatLinkItemDTO>
    func mute(chatID: String, minutes: Int?, importantOnly: Bool) async throws
    func clearHistory(chatID: String) async throws
    func deleteChat(chatID: String) async throws
    func acceptRequest(chatID: String) async throws
    func declineRequest(chatID: String) async throws
    func setBlocked(_ blocked: Bool, userID: String) async throws
    func saveDraft(chatID: String, text: String) async throws
    // Создание и поиск людей
    func directory(_ query: String) async throws -> [DirectoryUserDTO]
    func createPrivate(with userID: String) async throws -> String
    func createGroup(title: String, memberIDs: [String]) async throws -> String
    func savedMessages() async throws -> String
    // Группа
    func updateGroup(chatID: String, title: String?, description: String?) async throws
    func addMember(chatID: String, userID: String) async throws
    func removeMember(chatID: String, userID: String) async throws
    func setAdmin(_ admin: Bool, chatID: String, userID: String) async throws
    func inviteCode(chatID: String) async throws -> String
    func join(chatID: String, code: String) async throws
    // Опросы
    func poll(id: String) async throws -> PollResultsDTO
    func vote(pollID: String, optionIDs: [String]) async throws
    func createPoll(chatID: String, question: String, options: [String], multiple: Bool, anonymous: Bool) async throws
}

extension ChatsAPI: ChatActing {
    func react(messageID: String, emoji: String) async throws -> ChatMessageDTO {
        try await client.send(
            try .post("chats/messages/\(messageID)/reactions", json: ["emoji": emoji]),
            as: ChatMessageDTO.self
        )
    }

    func setPinned(_ pinned: Bool, messageID: String) async throws {
        let path = "chats/messages/\(messageID)/pin"
        try await client.send(pinned ? .post(path) : Endpoint(method: .delete, path: path))
    }

    func pinned(chatID: String) async throws -> [ChatMessageDTO] {
        try await client.send(.get("chats/\(chatID)/pinned"), as: [ChatMessageDTO].self)
    }

    func forward(messageID: String, to chatID: String) async throws {
        try await client.send(try .post("chats/\(chatID)/forward", json: ["messageId": messageID]))
    }

    func searchMessages(_ query: String, chatID: String?) async throws -> [ChatMessageDTO] {
        var items = [URLQueryItem(name: "q", value: query), URLQueryItem(name: "limit", value: "50")]
        if let chatID { items.append(URLQueryItem(name: "chatId", value: chatID)) }
        return try await client.page(.get("chats/search", query: items), of: ChatMessageDTO.self).items
    }

    /// Окно истории вокруг сообщения — переход к закреплённому, к найденному, по ссылке.
    func around(messageID: String, chatID: String) async throws -> Page<ChatMessageDTO> {
        try await client.page(
            .get(
                "chats/\(chatID)/messages",
                query: [URLQueryItem(name: "around", value: messageID), URLQueryItem(name: "limit", value: "50")]
            ),
            of: ChatMessageDTO.self
        )
    }

    func reads(chatID: String) async throws -> [ChatReadDTO] {
        try await client.send(.get("chats/\(chatID)/reads"), as: [ChatReadDTO].self)
    }

    func members(chatID: String) async throws -> [ChatMemberDTO] {
        try await client.send(.get("chats/\(chatID)/members"), as: [ChatMemberDTO].self)
    }

    func media(chatID: String, kind: ChatMediaKind, cursor: String?) async throws -> Page<ChatMediaItemDTO> {
        var items = [URLQueryItem(name: "type", value: kind.rawValue), URLQueryItem(name: "limit", value: "60")]
        if let cursor { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await client.page(.get("chats/\(chatID)/media", query: items), of: ChatMediaItemDTO.self)
    }

    func links(chatID: String, cursor: String?) async throws -> Page<ChatLinkItemDTO> {
        var items = [URLQueryItem(name: "limit", value: "50")]
        if let cursor { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await client.page(.get("chats/\(chatID)/links", query: items), of: ChatLinkItemDTO.self)
    }

    /// Без `minutes` — навсегда. «Только важное» оставляет упоминания и ответы мне.
    func mute(chatID: String, minutes: Int?, importantOnly: Bool) async throws {
        struct Body: Encodable {
            let minutes: Int?
            let importantOnly: Bool?
        }
        try await client.send(
            try .post("chats/\(chatID)/mute", json: Body(minutes: minutes, importantOnly: importantOnly ? true : nil))
        )
    }

    /// Очистка у себя: у собеседников история остаётся.
    func clearHistory(chatID: String) async throws {
        try await client.send(try .post("chats/\(chatID)/clear", json: [String: String]()))
    }

    /// Владелец группы удаляет её целиком, участник выходит, личный чат скрывается у
    /// себя вместе с историей — решает сервер по роли.
    func deleteChat(chatID: String) async throws {
        try await client.send(Endpoint(method: .delete, path: "chats/\(chatID)"))
    }

    func acceptRequest(chatID: String) async throws {
        try await client.send(.post("chats/\(chatID)/request/accept"))
    }

    func declineRequest(chatID: String) async throws {
        try await client.send(.post("chats/\(chatID)/request/decline"))
    }

    func setBlocked(_ blocked: Bool, userID: String) async throws {
        let path = "chats/blocks/\(userID)"
        try await client.send(blocked ? .post(path) : Endpoint(method: .delete, path: path))
    }

    func saveDraft(chatID: String, text: String) async throws {
        try await client.send(
            Endpoint(
                method: .put,
                path: "chats/\(chatID)/draft",
                body: try JSONCoding.encoder.encode(["text": text])
            )
        )
    }

    func directory(_ query: String) async throws -> [DirectoryUserDTO] {
        try await client.send(
            .get("users/directory", query: [URLQueryItem(name: "q", value: query), URLQueryItem(name: "limit", value: "30")]),
            as: [DirectoryUserDTO].self
        )
    }

    /// Личный чат не дублируется: сервер вернёт уже существующий.
    func createPrivate(with userID: String) async throws -> String {
        try await create(type: "PRIVATE", title: nil, memberIDs: [userID])
    }

    func createGroup(title: String, memberIDs: [String]) async throws -> String {
        try await create(type: "GROUP", title: title, memberIDs: memberIDs)
    }

    func savedMessages() async throws -> String {
        try await client.send(.get("chats/saved"), as: Created.self).id
    }

    func updateGroup(chatID: String, title: String?, description: String?) async throws {
        struct Body: Encodable {
            let title: String?
            let description: String?
        }
        try await client.send(
            Endpoint(
                method: .patch,
                path: "chats/\(chatID)",
                body: try JSONCoding.encoder.encode(Body(title: title, description: description))
            )
        )
    }

    func addMember(chatID: String, userID: String) async throws {
        try await client.send(try .post("chats/\(chatID)/members", json: ["userId": userID]))
    }

    func removeMember(chatID: String, userID: String) async throws {
        try await client.send(Endpoint(method: .delete, path: "chats/\(chatID)/members/\(userID)"))
    }

    func setAdmin(_ admin: Bool, chatID: String, userID: String) async throws {
        let path = "chats/\(chatID)/members/\(userID)/admin"
        try await client.send(admin ? .post(path) : Endpoint(method: .delete, path: path))
    }

    func inviteCode(chatID: String) async throws -> String {
        struct Invite: Decodable { let code: String }
        return try await client.send(.get("chats/\(chatID)/invite"), as: Invite.self).code
    }

    func join(chatID: String, code: String) async throws {
        try await client.send(try .post("chats/\(chatID)/join", json: ["code": code]))
    }

    func poll(id: String) async throws -> PollResultsDTO {
        try await client.send(.get("chats/polls/\(id)"), as: PollResultsDTO.self)
    }

    /// Пустой список — отозвать голос.
    func vote(pollID: String, optionIDs: [String]) async throws {
        try await client.send(try .post("chats/polls/\(pollID)/vote", json: ["optionIds": optionIDs]))
    }

    func createPoll(chatID: String, question: String, options: [String], multiple: Bool, anonymous: Bool) async throws {
        struct Body: Encodable {
            let question: String
            let options: [String]
            let multiple: Bool
            let anonymous: Bool
        }
        try await client.send(
            try .post(
                "chats/\(chatID)/poll",
                json: Body(question: question, options: options, multiple: multiple, anonymous: anonymous)
            )
        )
    }

    private struct Created: Decodable { let id: String }

    private func create(type: String, title: String?, memberIDs: [String]) async throws -> String {
        struct Body: Encodable {
            let type: String
            let title: String?
            let memberIds: [String]
        }
        return try await client.send(
            try .post("chats", json: Body(type: type, title: title, memberIds: memberIDs)),
            as: Created.self
        ).id
    }
}
