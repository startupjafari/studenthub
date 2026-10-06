import Foundation
import GRDB

/// Отправка сообщений.
///
/// Сообщение попадает в базу до запроса и уходит из неё только вместе с чатом:
/// человек видит свой текст мгновенно, а судьба отправки — отдельное состояние
/// строки (`sendState`). Поэтому обрыв связи не стирает написанное и не требует
/// «повторите ввод».
protocol ChatMessageSending: Sendable {
    func send(text: String, chatID: String, replyToID: String?) async throws -> ChatMessageDTO
}

extension ChatsAPI: ChatMessageSending {
    /// Маршрут multipart: на сервере текст и вложения приходят одним запросом.
    /// Когда появится сокет (задача 1.5), отправка уйдёт туда, а этот путь останется
    /// запасным — он работает и там, где сокет не поднялся.
    func send(text: String, chatID: String, replyToID: String?) async throws -> ChatMessageDTO {
        var form = MultipartForm()
        form.append(text, name: "content")
        if let replyToID {
            form.append(replyToID, name: "replyToId")
        }
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
    @discardableResult
    func send(text: String, chatID: String, senderID: String, replyToID: String?) async -> Bool {
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
        return await deliver(local)
    }

    /// Повторить одну неудачу — по кнопке у сообщения.
    @discardableResult
    func retry(_ message: MessageRecord) async -> Bool {
        guard message.remoteId == nil else { return true }
        await mark(message.id, as: .pending)
        var pending = message
        pending.sendState = .pending
        return await deliver(pending)
    }

    /// Дослать всё, что осталось висеть: после перезапуска, возвращения связи или
    /// открытия чата. Порядок — по времени написания, иначе переписка перемешается.
    func flush(chatID: String? = nil) async {
        let stuck: [MessageRecord]
        do {
            stuck = try await database.reader.read { db in
                var request = MessageRecord
                    .filter(MessageRecord.Columns.remoteId == nil)
                    .order(MessageRecord.Columns.createdAt.asc)
                if let chatID {
                    request = request.filter(MessageRecord.Columns.chatId == chatID)
                }
                return try request.fetchAll(db)
            }
        } catch {
            return
        }

        for message in stuck {
            // Останавливаемся на первой же неудаче: дальше почти наверняка та же
            // сеть, а порядок сообщений важнее попытки протолкнуть следующее.
            guard await deliver(message) else { return }
        }
    }

    // MARK: - Внутреннее

    private func deliver(_ message: MessageRecord) async -> Bool {
        do {
            let sent = try await api.send(
                text: message.content,
                chatID: message.chatId,
                replyToID: message.replyToId
            )
            try await database.writer.write { db in
                guard var local = try MessageRecord.fetchOne(db, key: message.id) else { return }
                // Ключ строки не меняем: на него уже ссылается лента. Серверный id
                // кладём рядом — по нему сообщение узнаётся, когда придёт из сокета.
                local.remoteId = sent.id
                local.seq = sent.seq
                local.createdAt = sent.createdAt
                local.sendState = .sent
                try local.update(db)
            }
            return true
        } catch {
            await mark(message.id, as: .failed)
            return false
        }
    }

    private func mark(_ id: String, as state: MessageSendState) async {
        try? await database.writer.write { db in
            guard var message = try MessageRecord.fetchOne(db, key: id) else { return }
            message.sendState = state
            try message.update(db)
        }
    }
}
