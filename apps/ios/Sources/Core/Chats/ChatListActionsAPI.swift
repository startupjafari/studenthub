import Foundation

/// Маршруты списка «как в Telegram» (волна 2): пометка «как новое», порядок закреплённых,
/// пакетное прочтение, порядок и звук папок, папки с типами чатов и исключениями.
///
/// Отдельный протокол, а не новые требования к `ChatsFetching` и `ChatActing`: их
/// подменяют тесты, и каждое новое требование ломало бы чужие заглушки.
protocol ChatListActing: Sendable {
    func setMarkedUnread(_ marked: Bool, chatID: String) async throws
    func setPinnedOrder(_ chatIDs: [String]) async throws
    /// Прочитать чаты целиком. Не больше `ChatsAPI.readBatch` за запрос.
    @discardableResult
    func readChats(_ chatIDs: [String]) async throws -> Int
    func setFolderOrder(_ folderIDs: [String]) async throws
    func muteFolder(id: String) async throws
    func unmuteFolder(id: String) async throws
    func createFolder(_ draft: ChatFolderDraft) async throws -> ChatFolderDTO
    func updateFolder(id: String, _ patch: ChatFolderPatch) async throws -> ChatFolderDTO
}

/// Новая папка целиком — так её принимает `POST /chats/folders`.
struct ChatFolderDraft: Encodable, Equatable, Sendable {
    var name: String
    var chatIds: [String]
    var excludedChatIds: [String] = []
    var emoji: String?
    var color: Int?
    var includeContacts = false
    var includeNonContacts = false
    var includeGroups = false

    /// Новые поля — только заданные: старый сервер со строгой схемой отклонил бы
    /// незнакомые ключи, и простая папка «имя + чаты» с ним не создавалась бы вовсе.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: ChatFolderPatch.CodingKeys.self)
        try container.encode(name, forKey: .name)
        try container.encode(chatIds, forKey: .chatIds)
        if !excludedChatIds.isEmpty { try container.encode(excludedChatIds, forKey: .excludedChatIds) }
        try container.encodeIfPresent(emoji, forKey: .emoji)
        try container.encodeIfPresent(color, forKey: .color)
        if includeContacts { try container.encode(true, forKey: .includeContacts) }
        if includeNonContacts { try container.encode(true, forKey: .includeNonContacts) }
        if includeGroups { try container.encode(true, forKey: .includeGroups) }
    }
}

/// Правка папки: в тело попадают только заданные поля — схема сервера строгая, и
/// `null` вместо «не менять» он отклонил бы. Значок и цвет снимаются явным `null`
/// (`.some(nil)`).
struct ChatFolderPatch: Encodable, Equatable, Sendable {
    var name: String?
    var chatIds: [String]?
    var excludedChatIds: [String]?
    var emoji: String??
    var color: Int??
    var includeContacts: Bool?
    var includeNonContacts: Bool?
    var includeGroups: Bool?

    enum CodingKeys: String, CodingKey {
        case name, chatIds, excludedChatIds, emoji, color
        case includeContacts, includeNonContacts, includeGroups
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(name, forKey: .name)
        try container.encodeIfPresent(chatIds, forKey: .chatIds)
        try container.encodeIfPresent(excludedChatIds, forKey: .excludedChatIds)
        if let emoji { try container.encode(emoji, forKey: .emoji) }
        if let color { try container.encode(color, forKey: .color) }
        try container.encodeIfPresent(includeContacts, forKey: .includeContacts)
        try container.encodeIfPresent(includeNonContacts, forKey: .includeNonContacts)
        try container.encodeIfPresent(includeGroups, forKey: .includeGroups)
    }
}

extension ChatsAPI: ChatListActing {
    /// Пачка `POST /chats/read` — столько принимает сервер.
    static let readBatch = 200

    func setMarkedUnread(_ marked: Bool, chatID: String) async throws {
        let path = "chats/\(chatID)/unread"
        try await client.send(marked ? .post(path) : Endpoint(method: .delete, path: path))
    }

    func setPinnedOrder(_ chatIDs: [String]) async throws {
        try await client.send(put("chats/pinned/order", json: ["chatIds": chatIDs]))
    }

    @discardableResult
    func readChats(_ chatIDs: [String]) async throws -> Int {
        struct Updated: Decodable { let updated: Int }
        return try await client.send(try .post("chats/read", json: ["chatIds": chatIDs]), as: Updated.self).updated
    }

    func setFolderOrder(_ folderIDs: [String]) async throws {
        try await client.send(put("chats/folders/order", json: ["folderIds": folderIDs]))
    }

    /// Навсегда, как «Выкл. уведомления» папки в Telegram.
    func muteFolder(id: String) async throws {
        try await client.send(try .post("chats/folders/\(id)/mute", json: [String: Int]()))
    }

    func unmuteFolder(id: String) async throws {
        try await client.send(Endpoint(method: .delete, path: "chats/folders/\(id)/mute"))
    }

    func createFolder(_ draft: ChatFolderDraft) async throws -> ChatFolderDTO {
        try await client.send(try .post("chats/folders", json: draft), as: ChatFolderDTO.self)
    }

    func updateFolder(id: String, _ patch: ChatFolderPatch) async throws -> ChatFolderDTO {
        try await client.send(
            Endpoint(method: .patch, path: "chats/folders/\(id)", body: try JSONCoding.encoder.encode(patch)),
            as: ChatFolderDTO.self
        )
    }

    private func put<Body: Encodable>(_ path: String, json body: Body) throws -> Endpoint {
        Endpoint(method: .put, path: path, body: try JSONCoding.encoder.encode(body))
    }
}
