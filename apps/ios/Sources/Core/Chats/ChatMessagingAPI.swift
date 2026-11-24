import Foundation

// Маршруты переписки «как в Telegram»: пересылка пачкой, «удалить у себя», новые виды
// сообщений (геопозиция, контакт, список), закрытие опроса. Контракты —
// docs/PROJECT.md, раздел чатов.

/// Сообщение как строка списка (вкладка «Опросы» в информации о чате).
extension ChatMessageDTO: Identifiable {}

/// Итог пересылки по каждому чату — сервер отвечает за всех сразу, и часть может не
/// пройти (запрос на переписку не принят, участника исключили).
struct ForwardOutcome: Equatable {
    var delivered: [String] = []
    var failed: [String] = []
    /// Ошибка всего запроса (нет сети, сервер упал) — повтор с тем же ключом безопасен.
    var failure: String?

    var isComplete: Bool { failure == nil && failed.isEmpty && !delivered.isEmpty }

    /// Разбор ответа сервера. Чат, о котором ответ молчит, — не доставлен: «всё ушло»
    /// показывается, только если сервер подтвердил каждого получателя.
    init(requested: [String], result: ForwardResultDTO) {
        let delivered = Set(result.results.filter(\.ok).map(\.chatId))
        self.delivered = requested.filter { delivered.contains($0) }
        failed = requested.filter { !delivered.contains($0) }
    }

    init(delivered: [String] = [], failed: [String] = [], failure: String? = nil) {
        self.delivered = delivered
        self.failed = failed
        self.failure = failure
    }
}

struct ForwardResultDTO: Decodable, Equatable {
    struct Target: Decodable, Equatable {
        let chatId: String
        let ok: Bool
        let messageIds: [String]
        var code: String? = nil
    }

    let results: [Target]
}

struct HiddenMessagesDTO: Decodable, Equatable {
    let hiddenIds: [String]
}

struct DeletedMessagesDTO: Decodable, Equatable {
    let deletedIds: [String]
    var skippedIds: [String] = []
}

struct ContactCardDraft: Encodable, Equatable, Sendable {
    let name: String
    let phones: [String]
    let emails: [String]
}

protocol ChatMessaging: Sendable {
    func forward(messageIDs: [String], to chatIDs: [String], comment: String?, hideSender: Bool, requestID: UUID) async throws -> ForwardResultDTO
    func hide(messageIDs: [String], chatID: String) async throws -> HiddenMessagesDTO
    func deleteForEveryone(messageIDs: [String], chatID: String) async throws -> DeletedMessagesDTO
    func closePoll(id: String) async throws
    func createPoll(
        chatID: String, question: String, description: String?, options: [String], multiple: Bool, anonymous: Bool
    ) async throws
    func polls(chatID: String, page: PageRequest) async throws -> Page<ChatMessageDTO>
    func sendLocation(
        chatID: String, latitude: Double, longitude: Double, title: String?, address: String?,
        livePeriod: Int?, accuracy: Double?, replyToID: String?, nonce: String
    ) async throws -> ChatMessageDTO
    func updateLiveLocation(messageID: String, latitude: Double, longitude: Double, heading: Double?, accuracy: Double?) async throws -> MessageExtras.Location
    func stopLiveLocation(messageID: String) async throws -> MessageExtras.Location
    func sendContact(chatID: String, contact: ContactCardDraft, replyToID: String?, nonce: String) async throws -> ChatMessageDTO
    func sendChecklist(chatID: String, title: String, items: [String], othersCanAdd: Bool, othersCanMark: Bool, replyToID: String?, nonce: String) async throws -> ChatMessageDTO
    func checklist(id: String) async throws -> MessageExtras.Checklist
    func addChecklistItem(checklistID: String, text: String) async throws -> MessageExtras.Checklist
    func removeChecklistItem(checklistID: String, itemID: String) async throws -> MessageExtras.Checklist
    func toggleChecklistItem(checklistID: String, itemID: String, done: Bool) async throws -> MessageExtras.Checklist
}

extension ChatsAPI: ChatMessaging {
    func forward(messageIDs: [String], to chatIDs: [String], comment: String?, hideSender: Bool, requestID: UUID) async throws -> ForwardResultDTO {
        struct Body: Encodable {
            let messageIds: [String]
            let chatIds: [String]
            let comment: String?
            let requestId: String
            /// Только `true`: без флага сервер и старые версии ведут себя как раньше.
            let hideSender: Bool?
        }
        return try await client.send(
            try .post(
                "chats/forward",
                json: Body(
                    messageIds: messageIDs,
                    chatIds: chatIDs,
                    comment: comment,
                    requestId: requestID.uuidString.lowercased(),
                    hideSender: hideSender ? true : nil
                )
            ),
            as: ForwardResultDTO.self
        )
    }

    func hide(messageIDs: [String], chatID: String) async throws -> HiddenMessagesDTO {
        try await client.send(
            try .post("chats/\(chatID)/messages/hide", json: ["messageIds": messageIDs]),
            as: HiddenMessagesDTO.self
        )
    }

    func deleteForEveryone(messageIDs: [String], chatID: String) async throws -> DeletedMessagesDTO {
        try await client.send(
            try .post("chats/\(chatID)/messages/delete", json: ["messageIds": messageIDs]),
            as: DeletedMessagesDTO.self
        )
    }

    func closePoll(id: String) async throws {
        try await client.send(.post("chats/polls/\(id)/close"))
    }

    func createPoll(
        chatID: String, question: String, description: String?, options: [String], multiple: Bool, anonymous: Bool
    ) async throws {
        struct Body: Encodable {
            let question: String
            let description: String?
            let options: [String]
            let multiple: Bool
            let anonymous: Bool
        }
        try await client.send(
            try .post(
                "chats/\(chatID)/poll",
                json: Body(question: question, description: description, options: options, multiple: multiple, anonymous: anonymous)
            )
        )
    }

    func polls(chatID: String, page: PageRequest) async throws -> Page<ChatMessageDTO> {
        try await client.page(.get("chats/\(chatID)/polls", query: page.cursorQuery), of: ChatMessageDTO.self)
    }

    func sendLocation(
        chatID: String, latitude: Double, longitude: Double, title: String?, address: String?,
        livePeriod: Int?, accuracy: Double?, replyToID: String?, nonce: String
    ) async throws -> ChatMessageDTO {
        struct Body: Encodable {
            let lat: Double
            let lng: Double
            let title: String?
            let address: String?
            let livePeriod: Int?
            let accuracy: Double?
            let replyToId: String?
            let nonce: String
        }
        return try await client.send(
            try .post(
                "chats/\(chatID)/location",
                json: Body(
                    lat: latitude, lng: longitude, title: title, address: address,
                    livePeriod: livePeriod, accuracy: accuracy, replyToId: replyToID, nonce: nonce
                )
            ),
            as: ChatMessageDTO.self
        )
    }

    func updateLiveLocation(
        messageID: String, latitude: Double, longitude: Double, heading: Double?, accuracy: Double?
    ) async throws -> MessageExtras.Location {
        struct Body: Encodable {
            let lat: Double
            let lng: Double
            let heading: Double?
            let accuracy: Double?
        }
        return try await client.send(
            try .post(
                "chats/messages/\(messageID)/live-location",
                json: Body(lat: latitude, lng: longitude, heading: heading, accuracy: accuracy)
            ),
            as: MessageExtras.Location.self
        )
    }

    func stopLiveLocation(messageID: String) async throws -> MessageExtras.Location {
        try await client.send(
            .post("chats/messages/\(messageID)/live-location/stop"),
            as: MessageExtras.Location.self
        )
    }

    func sendContact(chatID: String, contact: ContactCardDraft, replyToID: String?, nonce: String) async throws -> ChatMessageDTO {
        struct Body: Encodable {
            let name: String
            let phones: [String]
            let emails: [String]
            let replyToId: String?
            let nonce: String
        }
        return try await client.send(
            try .post(
                "chats/\(chatID)/contact",
                json: Body(name: contact.name, phones: contact.phones, emails: contact.emails, replyToId: replyToID, nonce: nonce)
            ),
            as: ChatMessageDTO.self
        )
    }

    func sendChecklist(
        chatID: String, title: String, items: [String], othersCanAdd: Bool, othersCanMark: Bool, replyToID: String?, nonce: String
    ) async throws -> ChatMessageDTO {
        struct Body: Encodable {
            let title: String
            let items: [String]
            let othersCanAdd: Bool
            let othersCanMark: Bool
            let replyToId: String?
            let nonce: String
        }
        return try await client.send(
            try .post(
                "chats/\(chatID)/checklist",
                json: Body(
                    title: title, items: items, othersCanAdd: othersCanAdd, othersCanMark: othersCanMark,
                    replyToId: replyToID, nonce: nonce
                )
            ),
            as: ChatMessageDTO.self
        )
    }

    func checklist(id: String) async throws -> MessageExtras.Checklist {
        try await client.send(.get("chats/checklists/\(id)"), as: MessageExtras.Checklist.self)
    }

    func addChecklistItem(checklistID: String, text: String) async throws -> MessageExtras.Checklist {
        try await client.send(
            try .post("chats/checklists/\(checklistID)/items", json: ["text": text]),
            as: MessageExtras.Checklist.self
        )
    }

    func removeChecklistItem(checklistID: String, itemID: String) async throws -> MessageExtras.Checklist {
        try await client.send(
            Endpoint(method: .delete, path: "chats/checklists/\(checklistID)/items/\(itemID)"),
            as: MessageExtras.Checklist.self
        )
    }

    func toggleChecklistItem(checklistID: String, itemID: String, done: Bool) async throws -> MessageExtras.Checklist {
        try await client.send(
            try .post("chats/checklists/\(checklistID)/items/\(itemID)/toggle", json: ["done": done]),
            as: MessageExtras.Checklist.self
        )
    }
}
