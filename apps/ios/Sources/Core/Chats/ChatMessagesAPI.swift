import Foundation

/// Разница по чату с позиции клиента (PROJECT.md §9.2c).
///
/// `overflow` означает, что разрыв больше серверного лимита и догонять поштучно
/// нечем — историю нужно перезапросить целиком.
struct ChatUpdatesDTO: Decodable, Equatable {
    let created: [ChatMessageDTO]
    let mutated: [ChatMessageDTO]
    let deletedIds: [String]
    let latestSeq: Int
    let overflow: Bool
}

/// Маршруты переписки. Отдельно от списка: у ленты свой набор и свои тесты.
protocol ChatMessagesFetching: Sendable {
    /// Страница истории. Сервер отдаёт свежие первыми.
    func messages(chatID: String, cursor: String?, limit: Int) async throws -> Page<ChatMessageDTO>
    /// Окно вокруг первого сообщения на дату или позже: до `limit` старее, оно само и до
    /// `limit` новее. Позже даты ничего нет — сервер отдаёт обычную последнюю страницу.
    func messages(chatID: String, aroundDate: Date, limit: Int) async throws -> Page<ChatMessageDTO>
    /// Страница НОВЕЕ сообщения `cursor` — догрузка вниз после перехода в окно истории.
    /// Курсор следующей страницы — `meta.prevCursor`, есть ли она — `meta.hasPrev`.
    func newerMessages(chatID: String, after cursor: String, limit: Int) async throws -> Page<ChatMessageDTO>
    /// Догон после обрыва: только то, что изменилось с позиции клиента.
    func updates(chatID: String, since: Int, sinceTs: Date?) async throws -> ChatUpdatesDTO
}

extension ChatsAPI: ChatMessagesFetching {
    /// Потолок страницы истории на сервере — 50.
    static let messagePageLimit = 50
    /// Окно перехода по дате: по тридцать сообщений в обе стороны, как в вебе.
    static let dateWindowLimit = 30
    /// Страница поиска внутри чата — та же, что у веба.
    static let searchPageLimit = 30

    func messages(
        chatID: String,
        cursor: String?,
        limit: Int = messagePageLimit
    ) async throws -> Page<ChatMessageDTO> {
        var query = [URLQueryItem(name: "limit", value: String(limit))]
        if let cursor {
            query.append(URLQueryItem(name: "cursor", value: cursor))
        }
        return try await client.page(.get("chats/\(chatID)/messages", query: query), of: ChatMessageDTO.self)
    }

    func messages(chatID: String, aroundDate: Date, limit: Int = messagePageLimit) async throws -> Page<ChatMessageDTO> {
        let query = [
            URLQueryItem(name: "aroundDate", value: ISO8601DateFormatter.contract.string(from: aroundDate)),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        return try await client.page(.get("chats/\(chatID)/messages", query: query), of: ChatMessageDTO.self)
    }

    func newerMessages(chatID: String, after cursor: String, limit: Int = messagePageLimit) async throws -> Page<ChatMessageDTO> {
        let query = [
            URLQueryItem(name: "cursor", value: cursor),
            URLQueryItem(name: "direction", value: "newer"),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        return try await client.page(.get("chats/\(chatID)/messages", query: query), of: ChatMessageDTO.self)
    }

    func updates(chatID: String, since: Int, sinceTs: Date?) async throws -> ChatUpdatesDTO {
        var query = [URLQueryItem(name: "since", value: String(since))]
        if let sinceTs {
            // Без отметки времени сервер не ищет правки и удаления: сравнивать не с чем.
            query.append(URLQueryItem(name: "sinceTs", value: ISO8601DateFormatter.contract.string(from: sinceTs)))
        }
        return try await client.send(.get("chats/\(chatID)/updates", query: query), as: ChatUpdatesDTO.self)
    }
}

extension ISO8601DateFormatter {
    /// Формат, который принимает `z.string().datetime()` на сервере.
    static let contract: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
