import Foundation

// Маршруты переписки «как в Telegram»: пересылка пачкой, «удалить у себя», новые виды
// сообщений (геопозиция, контакт, список, стикер, GIF), закрытие опроса. Контракты —
// docs/PROJECT.md, раздел чатов.

/// Сообщение как строка списка (вкладка «Опросы» в информации о чате).
extension ChatMessageDTO: Identifiable {}

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

struct StickerSetDTO: Decodable, Equatable, Identifiable, Sendable {
    struct Sticker: Decodable, Equatable, Identifiable, Sendable {
        let id: String
        let emoji: String?
        let width: Int?
        let height: Int?
        let url: String
        let expiresAt: Date?
    }

    let id: String
    let title: String
    let slug: String
    let stickers: [Sticker]
}

/// Элемент списка, который не роняет весь ответ: не разобрался — `nil`, и его пропускают.
private struct LossyElement<Value: Decodable>: Decodable {
    let value: Value?

    init(from decoder: Decoder) throws {
        value = try? Value(from: decoder)
    }
}

struct SignedURLDTO: Decodable, Equatable {
    let url: String
    let expiresAt: Date?
}

struct RecentGifDTO: Decodable, Equatable, Identifiable, Sendable {
    let fileId: String
    let width: Int?
    let height: Int?
    let url: String
    let expiresAt: Date?

    var id: String { fileId }
}

/// GIF из внешнего каталога (GIPHY) через прокси сервера: ключ живёт только там.
struct ExternalGifDTO: Decodable, Equatable, Identifiable, Sendable {
    let id: String
    let title: String?
    let width: Int?
    let height: Int?
    let previewUrl: String
    let previewWidth: Int?
    let previewHeight: Int?
}

struct ExternalGifPageDTO: Decodable, Equatable, Sendable {
    let items: [ExternalGifDTO]
    let nextOffset: Int?
}

protocol ChatMessaging: Sendable {
    /// Популярные (пустой запрос) или найденные GIF. Без ключа на сервере — 503
    /// `FEATURE_DISABLED`.
    func searchGifs(_ query: String, offset: Int) async throws -> ExternalGifPageDTO
    func sendExternalGif(chatID: String, gifID: String, replyToID: String?, nonce: String) async throws -> ChatMessageDTO
    func forward(messageIDs: [String], to chatIDs: [String], comment: String?, requestID: UUID) async throws -> ForwardResultDTO
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
    func stickerSets() async throws -> [StickerSetDTO]
    func stickerURL(id: String) async throws -> SignedURLDTO
    func sendSticker(chatID: String, stickerID: String, replyToID: String?, nonce: String) async throws -> ChatMessageDTO
    /// Избранные стикеры — свежие сверху, не больше 30 (сервер вытесняет самый старый).
    func favoriteStickers() async throws -> [StickerSetDTO.Sticker]
    /// Добавить в избранное (повтор поднимает наверх) или убрать.
    func setFavoriteSticker(_ favorite: Bool, stickerID: String) async throws
    func recentGifs() async throws -> [RecentGifDTO]
    func sendGif(chatID: String, fileID: String, replyToID: String?, nonce: String) async throws -> ChatMessageDTO
}

extension ChatsAPI: ChatMessaging {
    func searchGifs(_ query: String, offset: Int) async throws -> ExternalGifPageDTO {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        var items = [URLQueryItem(name: "offset", value: String(offset)), URLQueryItem(name: "limit", value: "24")]
        if term.isEmpty {
            return try await client.send(.get("chats/gifs/trending", query: items), as: ExternalGifPageDTO.self)
        }
        items.append(URLQueryItem(name: "q", value: String(term.prefix(50))))
        return try await client.send(.get("chats/gifs/search", query: items), as: ExternalGifPageDTO.self)
    }

    func sendExternalGif(chatID: String, gifID: String, replyToID: String?, nonce: String) async throws -> ChatMessageDTO {
        struct Body: Encodable {
            let provider: String
            let id: String
            let replyToId: String?
            let nonce: String
        }
        return try await client.send(
            try .post(
                "chats/\(chatID)/gif/external",
                json: Body(provider: "giphy", id: gifID, replyToId: replyToID, nonce: nonce)
            ),
            as: ChatMessageDTO.self
        )
    }

    func forward(messageIDs: [String], to chatIDs: [String], comment: String?, requestID: UUID) async throws -> ForwardResultDTO {
        struct Body: Encodable {
            let messageIds: [String]
            let chatIds: [String]
            let comment: String?
            let requestId: String
        }
        return try await client.send(
            try .post(
                "chats/forward",
                json: Body(messageIds: messageIDs, chatIds: chatIDs, comment: comment, requestId: requestID.uuidString.lowercased())
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

    func stickerSets() async throws -> [StickerSetDTO] {
        try await client.send(.get("chats/stickers/sets"), as: [StickerSetDTO].self)
    }

    func stickerURL(id: String) async throws -> SignedURLDTO {
        try await client.send(.get("chats/stickers/\(id)/url"), as: SignedURLDTO.self)
    }

    func sendSticker(chatID: String, stickerID: String, replyToID: String?, nonce: String) async throws -> ChatMessageDTO {
        struct Body: Encodable {
            let stickerId: String
            let replyToId: String?
            let nonce: String
        }
        return try await client.send(
            try .post("chats/\(chatID)/sticker", json: Body(stickerId: stickerID, replyToId: replyToID, nonce: nonce)),
            as: ChatMessageDTO.self
        )
    }

    func favoriteStickers() async throws -> [StickerSetDTO.Sticker] {
        // Терпимо к чужим строкам: стикер без id или ссылки пропускаем, а не роняем всё.
        try await client.send(.get("chats/stickers/favorites"), as: [LossyElement<StickerSetDTO.Sticker>].self).compactMap(\.value)
    }

    func setFavoriteSticker(_ favorite: Bool, stickerID: String) async throws {
        let path = "chats/stickers/favorites/\(stickerID)"
        try await client.send(favorite ? .post(path) : Endpoint(method: .delete, path: path))
    }

    func recentGifs() async throws -> [RecentGifDTO] {
        try await client.send(
            .get("chats/gifs/recent", query: [URLQueryItem(name: "limit", value: "50")]),
            as: [RecentGifDTO].self
        )
    }

    func sendGif(chatID: String, fileID: String, replyToID: String?, nonce: String) async throws -> ChatMessageDTO {
        struct Body: Encodable {
            let fileId: String
            let replyToId: String?
            let nonce: String
        }
        return try await client.send(
            try .post("chats/\(chatID)/gif", json: Body(fileId: fileID, replyToId: replyToID, nonce: nonce)),
            as: ChatMessageDTO.self
        )
    }
}
