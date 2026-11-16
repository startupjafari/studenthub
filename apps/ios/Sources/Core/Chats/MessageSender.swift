import Foundation
import GRDB

/// Отправка сообщений.
///
/// Сообщение попадает в базу до запроса и уходит из неё только вместе с чатом:
/// человек видит свой текст мгновенно, а судьба отправки — отдельное состояние
/// строки (`sendState`). Поэтому обрыв связи не стирает написанное и не требует
/// «повторите ввод».
protocol ChatMessageSending: Sendable {
    /// `nonce` — ключ повтора отправки: сервер помнит его 10 минут, и повтор с тем же
    /// ключом возвращает уже созданное сообщение, а не второе. Он же приходит эхом в
    /// `message:new` — по нему сокет узнаёт своё неподтверждённое сообщение.
    func send(text: String, chatID: String, replyToID: String?, nonce: String) async throws -> ChatMessageDTO
    /// «Отправить без звука»: сообщение доставляется, уведомления и пуша по нему нет.
    func send(text: String, chatID: String, replyToID: String?, nonce: String, silent: Bool) async throws -> ChatMessageDTO
}

extension ChatMessageSending {
    /// Дублёры в тестах знают только обычную отправку: «без звука» для них — она же.
    func send(text: String, chatID: String, replyToID: String?, nonce: String, silent: Bool) async throws -> ChatMessageDTO {
        try await send(text: text, chatID: chatID, replyToID: replyToID, nonce: nonce)
    }
}

extension ChatsAPI: ChatMessageSending {
    /// Маршрут multipart: на сервере текст и вложения приходят одним запросом.
    /// Когда появится сокет (задача 1.5), отправка уйдёт туда, а этот путь останется
    /// запасным — он работает и там, где сокет не поднялся.
    func send(text: String, chatID: String, replyToID: String?, nonce: String) async throws -> ChatMessageDTO {
        try await send(text: text, chatID: chatID, replyToID: replyToID, nonce: nonce, silent: false)
    }

    func send(text: String, chatID: String, replyToID: String?, nonce: String, silent: Bool) async throws -> ChatMessageDTO {
        var form = MultipartForm()
        form.append(text, name: "content")
        if let replyToID {
            form.append(replyToID, name: "replyToId")
        }
        if silent {
            form.append("true", name: "silent")
        }
        form.append(nonce, name: "nonce")
        return try await client.send(.multipart("chats/\(chatID)/messages", form: form), as: ChatMessageDTO.self)
    }
}

/// Очередь отправки поверх базы.
///
/// Отдельной таблицы у очереди нет: очередь — это и есть сообщения в состоянии
/// `pending`. Так она переживает перезапуск приложения, и ничего не нужно сверять
/// между двумя хранилищами.
struct MessageOutbox: Sendable {
    private let database: AppDatabase
    private let api: ChatMessageSending

    init(database: AppDatabase = AppServices.database, api: ChatMessageSending = ChatsAPI()) {
        self.database = database
        self.api = api
    }

    /// Положить сообщение в ленту и попытаться отправить.
    /// `silent` действует только на первую попытку: очередь живёт в базе без этого флага,
    /// и повтор после обрыва уйдёт обычным сообщением — лучше со звуком, чем никак.
    @discardableResult
    func send(text: String, chatID: String, senderID: String, replyToID: String?, silent: Bool = false) async -> Bool {
        let local = MessageRecord(
            id: UUID().uuidString,
            remoteId: nil,
            chatId: chatID,
            seq: nil,
            senderId: senderID,
            content: text,
            replyToId: replyToID,
            replyQuote: nil,
            systemType: nil,
            editedAt: nil,
            deletedAt: nil,
            pinnedAt: nil,
            createdAt: Date(),
            sendState: .pending
        )
        do {
            try await database.writer.write { db in try local.insert(db) }
        } catch {
            return false
        }
        return await deliver(local, silent: silent) == .sent
    }

    /// Повторить одну неудачу — по кнопке у сообщения. Переход «неудача → в пути»
    /// одной транзакцией: второе нажатие, пока первое едет, дубля не отправит.
    @discardableResult
    func retry(_ message: MessageRecord) async -> Bool {
        guard message.remoteId == nil else { return true }
        let claimed = (try? await database.writer.write { db -> Bool in
            guard var row = try MessageRecord.fetchOne(db, key: message.id), row.sendState == .failed else { return false }
            row.sendState = .pending
            // Человек сам решил повторить — прежний отказ больше не держит строку вне очереди.
            row.sendRejected = false
            try row.update(db)
            return true
        }) ?? false
        guard claimed else { return false }
        var pending = message
        pending.sendState = .pending
        pending.sendRejected = false
        return await deliver(pending) == .sent
    }

    /// Дослать всё, что осталось висеть: после перезапуска, возвращения связи или
    /// открытия чата. Порядок — по времени написания, иначе переписка перемешается.
    ///
    /// Только тексты: вложение повторяет `AttachmentUploader`, этой отправкой ушла бы
    /// одна подпись без файла. И только то, что не едет прямо сейчас: свежее «в пути»
    /// ещё ждёт ответа, повтор дал бы дубль. Зависшее дольше минуты (приложение
    /// закрыли посреди отправки) — уже не в пути.
    ///
    /// Отказ сервера по существу (403, 422) — не повод стоять: строка уходит в «не
    /// отправлено» без автоповтора, а следующие за ней едут дальше (IOS_RULES 9.3.1).
    ///
    /// `true` — повторять нечего (всё ушло или отвергнуто), `false` — что-то не дошло.
    @discardableResult
    func flush(chatID: String? = nil) async -> Bool {
        let stuck: [MessageRecord]
        do {
            stuck = try await database.reader.read { db in
                var request = Self.stuck(now: Date())
                if let chatID {
                    request = request.filter(MessageRecord.Columns.chatId == chatID)
                }
                return try request.fetchAll(db)
            }
        } catch {
            return false
        }

        for message in stuck {
            // Останавливаемся на первой же временной неудаче: дальше почти наверняка
            // та же сеть, а порядок сообщений важнее попытки протолкнуть следующее.
            if await deliver(message) == .retryLater { return false }
        }
        return true
    }

    /// Чаты, где есть что досылать, — для `OutboxService`.
    func stuckChatIDs() async -> [String] {
        (try? await database.reader.read { db in
            try Self.stuck(now: Date())
                .unordered()
                .select(MessageRecord.Columns.chatId)
                .distinct()
                .asRequest(of: String.self)
                .fetchAll(db)
        }) ?? []
    }

    private static func stuck(now: Date) -> QueryInterfaceRequest<MessageRecord> {
        MessageRecord
            .filter(MessageRecord.Columns.remoteId == nil)
            .filter(MessageRecord.Columns.sendRejected == false)
            .filter(MessageRecord.Columns.sendState == MessageSendState.failed.rawValue
                || MessageRecord.Columns.createdAt < now.addingTimeInterval(-60))
            .filter(sql: "NOT EXISTS (SELECT 1 FROM attachment WHERE attachment.messageId = message.id)")
            .order(MessageRecord.Columns.createdAt.asc)
    }

    // MARK: - Внутреннее

    /// Чем кончилась одна попытка.
    enum Delivery: Equatable {
        case sent
        /// Нет связи, 5xx, 429 или отмена — очередь повторит сама.
        case retryLater
        /// Сервер отказал по существу — повтор только по кнопке.
        case rejected
    }

    private func deliver(_ message: MessageRecord, silent: Bool = false) async -> Delivery {
        do {
            // Ключ повтора — локальный id строки: один на сообщение и переживает
            // перезапуск приложения, поэтому повтор после таймаута не создаст дубль.
            let sent = try await api.send(
                text: message.content,
                chatID: message.chatId,
                replyToID: message.replyToId,
                nonce: message.id,
                silent: silent
            )
            try await database.writer.write { db in
                try MessageStore.confirm(localID: message.id, with: sent, in: db)
            }
            return .sent
        } catch {
            let rejected = Self.isRejection(error)
            await mark(message.id, as: .failed, rejected: rejected)
            return rejected ? .rejected : .retryLater
        }
    }

    /// Отказ по существу — то, что повтор не исправит. 401 сюда не входит: клиент уже
    /// пробовал продлить сессию, и после входа заново строка должна уйти сама.
    static func isRejection(_ error: Error) -> Bool {
        guard ActionFailureKind(error) == .rejected else { return false }
        if case .server(let code, _, _, _) = error as? APIError, code.meansSessionExpired { return false }
        return true
    }

    private func mark(_ id: String, as state: MessageSendState, rejected: Bool = false) async {
        try? await database.writer.write { db in
            // Уже подтверждённое не трогаем: ту же строку мог дослать параллельный проход
            // (экран чата и `OutboxService`), и неудача второго не делает её неотправленной.
            guard var message = try MessageRecord.fetchOne(db, key: id), message.remoteId == nil else { return }
            message.sendState = state
            message.sendRejected = rejected
            try message.update(db)
        }
    }
}
