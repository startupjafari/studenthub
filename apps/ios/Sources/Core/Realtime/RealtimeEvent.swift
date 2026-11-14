import Foundation

/// Событие реального времени (PROJECT.md §9.2) в том виде, в каком его понимает
/// приложение.
///
/// Разбор сырых словарей от сокета остаётся в транспорте: остальной код работает с
/// этим перечислением, и подменить транспорт дублёром в тестах ничего не стоит.
enum RealtimeEvent: Equatable {
    case connected
    case disconnected
    /// `nonce` — ключ повтора, с которым сообщение отправили (эхо сервера); у чужих и
    /// у отправленных без ключа его нет.
    case messageNew(ChatMessageDTO, nonce: String? = nil)
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
    /// Переименование или смена аватара группы. Сервер шлёт только изменённое поле:
    /// `avatarURL == .some(nil)` — аватар убран, `nil` — не менялся.
    case chatUpdated(chatID: String, title: String?, avatarURL: String??)
    /// В чате что-то произошло (новое сообщение, участники, запрос) — повод обновить
    /// строку списка. Приходит в личные комнаты, в том числе по закрытым чатам.
    case chatActivity(chatID: String)
    /// Закрепили или открепили сообщение — плашку закреплённого нужно перечитать.
    case chatPinned(chatID: String)
    /// Мои отложенные в чате изменились (создание, правка, удаление, отправка сейчас или
    /// cron'ом) — часы в поле ввода и список перечитываются. Приходит в личную комнату.
    case scheduledChanged(chatID: String)
    /// Кто-то проголосовал: результаты опроса перечитываются.
    case pollUpdated(pollID: String, chatID: String)
    /// Общий список изменили (отметка, новый или убранный пункт) — состояние целиком.
    case checklistUpdated(MessageExtras.Checklist, chatID: String)
    /// Живая геопозиция сдвинулась или трансляцию остановили.
    case locationUpdated(MessageExtras.Location, messageID: String, chatID: String)
    /// Сообщения удалены «у меня» на другом моём устройстве.
    case messagesHidden(chatID: String, messageIDs: [String])
    /// Блокировка в одну из сторон — меняется доступность личного чата.
    case blockChanged(userID: String)
    /// Свои настройки чатов изменились на другом устройстве: пометка «как новое»,
    /// закрепление и его порядок, звук папки. Объекта чата в событии нет.
    case chatListChanged(chatIDs: [String])
    /// Свои папки изменились: создание, правка, удаление, порядок.
    case foldersChanged
    /// Единый конверт `event` (PROJECT.md §9.2a). Приложению из него нужен пока
    /// один тип — смена статуса заявки: человек ждёт справку и хочет узнать о ней
    /// без обновления экрана.
    case applicationStatusChanged(applicationID: String, status: String)

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
        static let chatActivity = "chat:activity"
        static let chatPinned = "chat:pinned"
        static let scheduledChanged = "chat:scheduled-changed"
        static let chatBlock = "chat:block"
        static let chatListChanged = "chat:list-changed"
        static let foldersChanged = "chat:folders-changed"
        static let memberAdded = "chat:member-added"
        static let memberRemoved = "chat:member-removed"
        static let messageReaction = "message:reaction"
        static let messagePinned = "message:pinned"
        static let messageUnpinned = "message:unpinned"
        static let pollUpdated = "poll:updated"
        static let checklistUpdated = "checklist:updated"
        static let messageHidden = "message:hidden"
        static let locationUpdated = "location:updated"
        static let edit = "message:edit"
        static let delete = "message:delete"
        /// Единый канал событий поверх именованных.
        static let envelope = "event"
        static let applicationStatusChanged = "application.status.changed"

        static let join = "chat:join"
        static let leave = "chat:leave"
        static let read = "message:read"
        static let action = "chat:action"
        static let authRefresh = "auth:refresh"
    }
}
