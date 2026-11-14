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
    /// Правка и удаление — только через сокет: REST-маршрутов у них нет (§9.1).
    func edit(messageID: String, content: String) async
    func delete(messageID: String) async
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
    /// Своя последовательная очередь библиотеки (`handleQueue`): по умолчанию socket.io
    /// разбирает кадры и зовёт обработчики на главной, и пачка событий после
    /// переподключения (словари, `ChatMessageDTO`) давала рывки ленты (IOS_RULES 13.1.9).
    /// Библиотека не потокобезопасна — всё обращение к сокету идёт через эту же очередь,
    /// а на главный уходит только готовое событие через поток `events`.
    private let queue = DispatchQueue(label: "kz.studenthub.realtime", qos: .userInitiated)
    /// Обработчики вешаются один раз на жизнь сокета. Повторная подписка при каждом
    /// входе удваивала бы каждое событие — по сообщению на каждый прошлый вход.
    private var subscribed = false

    init(baseURL: URL = AppConfiguration.apiBaseURL) {
        (events, continuation) = AsyncStream<RealtimeEvent>.makeStream()
        // Сокет живёт на корне домена, а не под префиксом API: путь `/socket.io`
        // задаёт сам сервер.
        //
        // Своё переподключение библиотеки выключено: она повторяет CONNECT с исходным
        // токеном, а он живёт 15 минут — после долгого обрыва сервер такой отклоняет, и
        // реальное время молча умирает. Обрыв уходит в координатор событием
        // `disconnected`, тот подключается заново с токеном, который выдаст сессия.
        manager = SocketManager(
            socketURL: Self.origin(of: baseURL),
            config: [.compress, .reconnects(false), .forceWebsockets(true), .handleQueue(queue)]
        )
        socket = manager.defaultSocket
    }

    deinit {
        continuation.finish()
    }

    func connect(token: String) async {
        subscribe()
        // Токен уходит в CONNECT-пакет: сервер читает его из `handshake.auth.token`.
        onQueue { $0.connect(withPayload: ["token": token]) }
    }

    func disconnect() async {
        onQueue { $0.disconnect() }
    }

    func refresh(token: String) async {
        emit(RealtimeEvent.Name.authRefresh, ["token": token])
    }

    func join(chatID: String) async {
        emit(RealtimeEvent.Name.join, ["chatId": chatID])
    }

    func leave(chatID: String) async {
        emit(RealtimeEvent.Name.leave, ["chatId": chatID])
    }

    func markRead(chatID: String, messageID: String) async {
        emit(RealtimeEvent.Name.read, ["chatId": chatID, "messageId": messageID])
    }

    func send(action: String?, chatID: String) async {
        emit(RealtimeEvent.Name.action, ["chatId": chatID, "action": action as Any])
    }

    func edit(messageID: String, content: String) async {
        emit(RealtimeEvent.Name.edit, ["messageId": messageID, "content": content])
    }

    func delete(messageID: String) async {
        emit(RealtimeEvent.Name.delete, ["messageId": messageID])
    }

    /// Работа с сокетом — на его очереди. Последовательная очередь сохраняет порядок
    /// вызовов актора: подписка ляжет раньше подключения, вход в комнату — раньше прочтения.
    private func onQueue(_ work: @escaping (SocketIOClient) -> Void) {
        let socket = socket
        queue.async { work(socket) }
    }

    private func emit(_ name: String, _ payload: [String: Any]) {
        onQueue { $0.emit(name, payload) }
    }

    // MARK: - Подписка

    private func subscribe() {
        guard !subscribed else { return }
        subscribed = true

        onQueue { [continuation] socket in
            socket.on(clientEvent: .connect) { _, _ in
                continuation.yield(.connected)
            }
            socket.on(clientEvent: .disconnect) { _, _ in
                continuation.yield(.disconnected)
            }
        }

        on(RealtimeEvent.Name.messageNew) { payload in
            Self.message(from: payload).map { RealtimeEvent.messageNew($0, nonce: payload["nonce"] as? String) }
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
        on(RealtimeEvent.Name.envelope) { payload in
            // Конверт: `{ type, entityId, version, ts, data }`. Разбираем только
            // известные типы — чужие события приложению ничего не говорят.
            guard
                payload["type"] as? String == RealtimeEvent.Name.applicationStatusChanged,
                let id = payload["entityId"] as? String,
                let data = payload["data"] as? [String: Any],
                let status = data["status"] as? String
            else { return nil }
            return .applicationStatusChanged(applicationID: id, status: status)
        }
        on(RealtimeEvent.Name.chatUpdated) { payload in
            // `{chatId, title}` или `{chatId, avatarUrl}` — объекта чата в событии нет.
            guard let chatID = payload["chatId"] as? String else { return nil }
            let avatar: String?? = payload.keys.contains("avatarUrl")
                ? .some(payload["avatarUrl"] as? String)
                : nil
            return .chatUpdated(chatID: chatID, title: payload["title"] as? String, avatarURL: avatar)
        }
        // Реакция и закрепление присылают сообщение целиком — оно ложится тем же путём,
        // что и правка.
        for name in [
            RealtimeEvent.Name.messageReaction,
            RealtimeEvent.Name.messagePinned,
            RealtimeEvent.Name.messageUnpinned,
        ] {
            on(name) { payload in
                Self.message(from: payload).map { RealtimeEvent.messageUpdated($0) }
            }
        }
        for name in [
            RealtimeEvent.Name.chatActivity,
            RealtimeEvent.Name.memberAdded,
            RealtimeEvent.Name.memberRemoved,
        ] {
            on(name) { payload in
                (payload["chatId"] as? String).map { RealtimeEvent.chatActivity(chatID: $0) }
            }
        }
        on(RealtimeEvent.Name.chatListChanged) { payload in
            .chatListChanged(chatIDs: payload["chatIds"] as? [String] ?? [])
        }
        on(RealtimeEvent.Name.foldersChanged) { _ in
            .foldersChanged
        }
        on(RealtimeEvent.Name.chatPinned) { payload in
            (payload["chatId"] as? String).map { RealtimeEvent.chatPinned(chatID: $0) }
        }
        on(RealtimeEvent.Name.scheduledChanged) { payload in
            (payload["chatId"] as? String).map { RealtimeEvent.scheduledChanged(chatID: $0) }
        }
        on(RealtimeEvent.Name.pollUpdated) { payload in
            guard
                let pollID = payload["pollId"] as? String,
                let chatID = payload["chatId"] as? String
            else { return nil }
            return .pollUpdated(pollID: pollID, chatID: chatID)
        }
        on(RealtimeEvent.Name.checklistUpdated) { payload in
            guard
                let chatID = payload["chatId"] as? String,
                let raw = payload["checklist"],
                let checklist: MessageExtras.Checklist = Self.decode(raw)
            else { return nil }
            return .checklistUpdated(checklist, chatID: chatID)
        }
        on(RealtimeEvent.Name.locationUpdated) { payload in
            guard
                let chatID = payload["chatId"] as? String,
                let messageID = payload["messageId"] as? String,
                let raw = payload["location"],
                let location: MessageExtras.Location = Self.decode(raw)
            else { return nil }
            return .locationUpdated(location, messageID: messageID, chatID: chatID)
        }
        on(RealtimeEvent.Name.messageHidden) { payload in
            guard
                let chatID = payload["chatId"] as? String,
                let ids = payload["messageIds"] as? [String]
            else { return nil }
            return .messagesHidden(chatID: chatID, messageIDs: ids)
        }
        on(RealtimeEvent.Name.chatBlock) { payload in
            (payload["userId"] as? String).map { RealtimeEvent.blockChanged(userID: $0) }
        }
    }

    /// Обработчик зовётся на `queue`: разбор полезной нагрузки идёт там же, вне главного.
    private func on(_ name: String, _ map: @escaping ([String: Any]) -> RealtimeEvent?) {
        onQueue { [continuation] socket in
            socket.on(name) { data, _ in
                guard let payload = data.first as? [String: Any], let event = map(payload) else { return }
                continuation.yield(event)
            }
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
        // Тот же разбор, что у API: с долями секунды, потом без — без нового
        // форматтера на каждое событие (п. 49).
        return JSONCoding.isoDate(string)
    }

    /// Адрес без пути API: `https://host/api/v1` → `https://host`.
    private static func origin(of url: URL) -> URL {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.path = ""
        components?.query = nil
        return components?.url ?? url
    }
}
