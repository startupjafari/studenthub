import Foundation

// Инструменты переписки «как в Telegram», волна 2: открепить все сообщения разом и
// отложенные сообщения. Контракт — CONTRACT волны 2, разделы B.6 и B.7; на сервере —
// модуль chats (`ScheduleMessageSchema`, `UpdateScheduledMessageSchema`).

/// Отложенное сообщение: своё, в одном чате, уйдёт в `scheduledAt` (его отправляет
/// cron сервера обычным `message:new`). Вложений у отложенных нет по дизайну.
///
/// Разбор терпимый: обязательны только id, текст и время — без них строку списка не
/// показать. Остальное сервер может прислать позже или не прислать вовсе.
struct ScheduledMessageDTO: Decodable, Equatable, Identifiable, Sendable {
    let id: String
    var chatId: String? = nil
    let content: String
    var replyToId: String? = nil
    var replyQuote: String? = nil
    var silent: Bool? = nil
    let scheduledAt: Date
    var createdAt: Date? = nil
}

/// Ответ «открепить все»: сколько сообщений сняли.
struct UnpinnedCountDTO: Decodable, Equatable {
    var count: Int? = nil
}

/// Маршруты инструментов переписки. Отдельным протоколом, как `ChatMessaging`: у
/// экрана переписки свой набор, и подменить его в тестах можно, не трогая остальное.
protocol ChatThreadTooling: Sendable {
    /// Открепить все сообщения чата. Права — как у открепления одного: сервер решает сам,
    /// клиентам каждого открепления уходит `message:unpinned`.
    func unpinAll(chatID: String) async throws -> Int
    /// Свои отложенные в чате, по времени отправки (не больше сотни).
    func scheduled(chatID: String) async throws -> [ScheduledMessageDTO]
    func schedule(
        chatID: String, content: String, at date: Date, replyToID: String?, silent: Bool
    ) async throws -> ScheduledMessageDTO
    /// Правка до отправки: новый текст и/или время (`nil` — не менять).
    func updateScheduled(id: String, content: String?, at date: Date?) async throws -> ScheduledMessageDTO
    func deleteScheduled(id: String) async throws
    /// Отправить сейчас: сервер создаёт обычное сообщение и шлёт `message:new`.
    func sendScheduledNow(id: String) async throws -> ChatMessageDTO
}

extension ChatsAPI: ChatThreadTooling {
    func unpinAll(chatID: String) async throws -> Int {
        try await client.send(.delete("chats/\(chatID)/pinned"), as: UnpinnedCountDTO.self).count ?? 0
    }

    func scheduled(chatID: String) async throws -> [ScheduledMessageDTO] {
        try await client.send(.get("chats/\(chatID)/scheduled"), as: [ScheduledMessageDTO].self)
    }

    func schedule(
        chatID: String, content: String, at date: Date, replyToID: String?, silent: Bool
    ) async throws -> ScheduledMessageDTO {
        struct Body: Encodable {
            let content: String
            let scheduledAt: String
            let replyToId: String?
            // Схема строгая: «без звука» уходит, только когда оно включено.
            let silent: Bool?
        }
        return try await client.send(
            try .post(
                "chats/\(chatID)/scheduled",
                json: Body(
                    content: content,
                    scheduledAt: ISO8601DateFormatter.contract.string(from: date),
                    replyToId: replyToID,
                    silent: silent ? true : nil
                )
            ),
            as: ScheduledMessageDTO.self
        )
    }

    func updateScheduled(id: String, content: String?, at date: Date?) async throws -> ScheduledMessageDTO {
        struct Body: Encodable {
            let content: String?
            let scheduledAt: String?
        }
        return try await client.send(
            try .patch(
                "chats/scheduled/\(id)",
                json: Body(content: content, scheduledAt: date.map { ISO8601DateFormatter.contract.string(from: $0) })
            ),
            as: ScheduledMessageDTO.self
        )
    }

    func deleteScheduled(id: String) async throws {
        try await client.send(.delete("chats/scheduled/\(id)"))
    }

    func sendScheduledNow(id: String) async throws -> ChatMessageDTO {
        try await client.send(.post("chats/scheduled/\(id)/send-now"), as: ChatMessageDTO.self)
    }
}
