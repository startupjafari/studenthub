import Foundation

/// Событие реального времени (PROJECT.md §9.2) в том виде, в каком его понимает
/// приложение.
///
/// Разбор сырых словарей от сокета остаётся в транспорте: остальной код работает с
/// этим перечислением, и подменить транспорт дублёром в тестах ничего не стоит.
enum RealtimeEvent: Equatable {
    case connected
    case disconnected
    case messageNew(ChatMessageDTO)
    case messageUpdated(ChatMessageDTO)
    case messageDeleted(messageID: String, chatID: String)
    /// Кто-то прочитал переписку до указанного момента.
    case messageRead(chatID: String, userID: String, readAt: Date)
    /// Моя собственная отметка — приходит в личную комнату и гасит счётчик на всех
    /// моих устройствах.
    case chatRead(chatID: String, readAt: Date)
    /// Что человек делает в чате прямо сейчас (`TYPING`, `RECORDING_VOICE`, …).
    /// `action == nil` означает «закончил».
    case action(chatID: String, userID: String, action: String?)
    case presence(userID: String, online: Bool)
    case chatUpdated(ChatListItemDTO)

    /// Имена событий сервера. Строки собраны здесь, чтобы опечатка в одной из них
    /// ловилась в одном месте, а не расследовалась по тишине в интерфейсе.
    enum Name {
        static let messageNew = "message:new"
        static let messageUpdated = "message:updated"
        static let messageDeleted = "message:deleted"
        static let messageRead = "message:read"
        static let chatRead = "chat:read"
        static let chatAction = "chat:action"
        static let presenceChanged = "presence:changed"
        static let chatUpdated = "chat:updated"

        static let join = "chat:join"
        static let leave = "chat:leave"
        static let read = "message:read"
        static let action = "chat:action"
        static let authRefresh = "auth:refresh"
    }
}
