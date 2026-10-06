import Foundation

/// Маршруты чатов, нужные списку.
///
/// Протокол — ради тестов: синхронизация и экран проверяются без сети, а подменять
/// `URLSession` ради этого значит проверять не свой код, а чужой.
protocol ChatsFetching: Sendable {
    func chats(cursor: String?, limit: Int) async throws -> Page<ChatListItemDTO>
    func folders() async throws -> [ChatFolderDTO]
    func setPinned(_ pinned: Bool, chatID: String) async throws
    func setArchived(_ archived: Bool, chatID: String) async throws
    func setMuted(_ muted: Bool, chatID: String) async throws
}

struct ChatsAPI: ChatsFetching {
    /// Сервер отдаёт до 200 чатов за страницу; сотня — его же значение по умолчанию.
    static let pageLimit = 100

    /// Доступен расширениям в соседних файлах: маршруты чатов разнесены по задачам
    /// (список, переписка, вложения), а клиент у них один.
    let client: APIClient

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    func chats(cursor: String?, limit: Int = pageLimit) async throws -> Page<ChatListItemDTO> {
        var query = [URLQueryItem(name: "limit", value: String(limit))]
        if let cursor {
            query.append(URLQueryItem(name: "cursor", value: cursor))
        }
        return try await client.page(.get("chats", query: query), of: ChatListItemDTO.self)
    }

    func folders() async throws -> [ChatFolderDTO] {
        try await client.send(.get("chats/folders"), as: [ChatFolderDTO].self)
    }

    // Переключатели списка. У каждого два маршрута вместо одного с телом — так на
    // сервере, и выдумывать свой контракт клиенту незачем.

    func setPinned(_ pinned: Bool, chatID: String) async throws {
        try await toggle(pinned, path: "chats/\(chatID)/pin")
    }

    func setArchived(_ archived: Bool, chatID: String) async throws {
        try await toggle(archived, path: "chats/\(chatID)/archive")
    }

    func setMuted(_ muted: Bool, chatID: String) async throws {
        try await toggle(muted, path: "chats/\(chatID)/mute")
    }

    private func toggle(_ on: Bool, path: String) async throws {
        try await client.send(on ? .post(path) : Endpoint(method: .delete, path: path))
    }
}
