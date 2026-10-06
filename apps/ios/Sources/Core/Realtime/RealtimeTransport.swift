import Foundation
import SocketIO

/// Соединение с сервером реального времени.
///
/// Протокол нужен не ради абстракции как таковой: без него логику догона и записи
/// событий в базу пришлось бы проверять живым сокетом, то есть не проверять вовсе.
protocol RealtimeTransport: Sendable {
    /// Поток событий. Начинается с `connected`/`disconnected` и живёт, пока жив
    /// транспорт.
    var events: AsyncStream<RealtimeEvent> { get }

    func connect(token: String) async
    func disconnect() async
    /// Новый access-токен без разрыва соединения (`auth:refresh`).
    func refresh(token: String) async
    func join(chatID: String) async
    func leave(chatID: String) async
    /// «Прочитано до этого сообщения».
    func markRead(chatID: String, messageID: String) async
    /// Что человек делает сейчас; `nil` — закончил.
    func send(action: String?, chatID: String) async
}

/// Реализация на socket.io-client-swift.
///
/// Единственное место в приложении, которое знает про библиотеку. Разбор полезной
/// нагрузки идёт через `JSONSerialization` и общий декодер: сервер шлёт те же
/// объекты, что и REST, и вторая модель данных им не нужна.
actor SocketIORealtimeTransport: RealtimeTransport {
    nonisolated let events: AsyncStream<RealtimeEvent>

    private let continuation: AsyncStream<RealtimeEvent>.Continuation
    private let manager: SocketManager
    private let socket: SocketIOClient

    init(baseURL: URL = AppConfiguration.apiBaseURL) {
        (events, continuation) = AsyncStream<RealtimeEvent>.makeStream()
        // Сокет живёт на корне домена, а не под префиксом API: путь `/socket.io`
        // задаёт сам сервер.
        manager = SocketManager(
            socketURL: Self.origin(of: baseURL),
            config: [.compress, .reconnects(true), .forceWebsockets(true)]
        )
        socket = manager.defaultSocket
    }

    deinit {
        continuation.finish()
    }

    func connect(token: String) async {
        subscribe()
        // Токен уходит в CONNECT-пакет: сервер читает его из `handshake.auth.token`.
        socket.connect(withPayload: ["token": token])
    }

    func disconnect() async {
        socket.disconnect()
    }

    func refresh(token: String) async {
        socket.emit(RealtimeEvent.Name.authRefresh, ["token": token])
    }

    func join(chatID: String) async {
        socket.emit(RealtimeEvent.Name.join, ["chatId": chatID])
    }

    func leave(chatID: String) async {
        socket.emit(RealtimeEvent.Name.leave, ["chatId": chatID])
    }

    func markRead(chatID: String, messageID: String) async {
        socket.emit(RealtimeEvent.Name.read, ["chatId": chatID, "messageId": messageID])
    }

    func send(action: String?, chatID: String) async {
        socket.emit(
            RealtimeEvent.Name.action,
            ["chatId": chatID, "action": action as Any]
        )
    }

    // MARK: - Подписка

    private func subscribe() {
        guard socket.status == .notConnected || socket.status == .disconnected else { return }

        socket.on(clientEvent: .connect) { [continuation] _, _ in
            continuation.yield(.connected)
        }
        socket.on(clientEvent: .disconnect) { [continuation] _, _ in
            continuation.yield(.disconnected)
        }

        on(RealtimeEvent.Name.messageNew) { payload in
            Self.message(from: payload).map { RealtimeEvent.messageNew($0) }
        }
        on(RealtimeEvent.Name.messageUpdated) { payload in
            Self.message(from: payload).map { RealtimeEvent.messageUpdated($0) }
        }
        on(RealtimeEvent.Name.messageDeleted) { payload in
            guard
                let id = payload["messageId"] as? String,
                let chatID = payload["chatId"] as? String
            else { return nil }
            return .messageDeleted(messageID: id, chatID: chatID)
        }
        on(RealtimeEvent.Name.messageRead) { payload in
            guard
                let chatID = payload["chatId"] as? String,
                let userID = payload["userId"] as? String,
                let readAt = Self.date(payload["readAt"])
            else { return nil }
            return .messageRead(chatID: chatID, userID: userID, readAt: readAt)
        }
        on(RealtimeEvent.Name.chatRead) { payload in
            guard
                let chatID = payload["chatId"] as? String,
                let readAt = Self.date(payload["readAt"])
            else { return nil }
            return .chatRead(chatID: chatID, readAt: readAt)
        }
        on(RealtimeEvent.Name.chatAction) { payload in
            guard
                let chatID = payload["chatId"] as? String,
                let userID = payload["userId"] as? String
            else { return nil }
            return .action(chatID: chatID, userID: userID, action: payload["action"] as? String)
        }
        on(RealtimeEvent.Name.presenceChanged) { payload in
            guard
                let userID = payload["userId"] as? String,
                let online = payload["online"] as? Bool
            else { return nil }
            return .presence(userID: userID, online: online)
        }
        on(RealtimeEvent.Name.chatUpdated) { payload in
            guard
                let raw = payload["chat"],
                let chat: ChatListItemDTO = Self.decode(raw)
            else { return nil }
            return .chatUpdated(chat)
        }
    }

    private func on(_ name: String, _ map: @escaping ([String: Any]) -> RealtimeEvent?) {
        socket.on(name) { [continuation] data, _ in
            guard let payload = data.first as? [String: Any], let event = map(payload) else { return }
            continuation.yield(event)
        }
    }

    // MARK: - Разбор

    private static func message(from payload: [String: Any]) -> ChatMessageDTO? {
        guard let raw = payload["message"] else { return nil }
        return decode(raw)
    }

    private static func decode<T: Decodable>(_ raw: Any) -> T? {
        guard
            JSONSerialization.isValidJSONObject(raw),
            let data = try? JSONSerialization.data(withJSONObject: raw)
        else { return nil }
        return try? JSONCoding.decoder.decode(T.self, from: data)
    }

    private static func date(_ raw: Any?) -> Date? {
        guard let string = raw as? String else { return nil }
        return ISO8601DateFormatter.contract.date(from: string)
            ?? ISO8601DateFormatter().date(from: string)
    }

    /// Адрес без пути API: `https://host/api/v1` → `https://host`.
    private static func origin(of url: URL) -> URL {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.path = ""
        components?.query = nil
        return components?.url ?? url
    }
}
