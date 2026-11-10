import Foundation
import GRDB

/// Подпись на прямую загрузку (ответ `POST /chats/:id/attachments/presign`).
struct AttachmentUploadTicket: Decodable, Equatable {
    let key: String
    let url: URL
    let expiresAt: Date
}

/// Маршруты вложений.
protocol AttachmentSending: Sendable {
    func presign(chatID: String, mime: String) async throws -> AttachmentUploadTicket
    func upload(_ data: Data, to url: URL, mime: String) async throws
    func sendUploaded(
        chatID: String,
        content: String?,
        replyToID: String?,
        attachments: [AttachmentUpload]
    ) async throws -> ChatMessageDTO
}

/// Готовое к отправке вложение: уже лежит в хранилище под своим ключом.
struct AttachmentUpload: Encodable, Equatable {
    let key: String
    let name: String?
}

extension ChatsAPI: AttachmentSending {
    func presign(chatID: String, mime: String) async throws -> AttachmentUploadTicket {
        try await client.send(
            try .post("chats/\(chatID)/attachments/presign", json: ["mime": mime]),
            as: AttachmentUploadTicket.self
        )
    }

    /// Загрузка идёт в хранилище напрямую, мимо API: тело файла не проходит через
    /// процесс сервера и не ложится ему в память.
    func upload(_ data: Data, to url: URL, mime: String) async throws {
        var request = URLRequest(url: url)
        request.httpMethod = HTTPMethod.put.rawValue
        request.setValue(mime, forHTTPHeaderField: "Content-Type")

        let (_, response) = try await URLSession.shared.upload(for: request, from: data)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.malformedResponse(statusCode: (response as? HTTPURLResponse)?.statusCode ?? 0)
        }
    }

    func sendUploaded(
        chatID: String,
        content: String?,
        replyToID: String?,
        attachments: [AttachmentUpload]
    ) async throws -> ChatMessageDTO {
        struct Body: Encodable {
            let content: String?
            let replyToId: String?
            let attachments: [AttachmentUpload]
        }
        return try await client.send(
            try .post(
                "chats/\(chatID)/messages/uploaded",
                json: Body(content: content, replyToId: replyToID, attachments: attachments)
            ),
            as: ChatMessageDTO.self
        )
    }
}

/// Отправка вложения.
///
/// Три шага сервера (подпись → загрузка в хранилище → сообщение по ключам) видны
/// здесь как один вызов. Сообщение появляется в ленте сразу, как и текстовое: файл
/// лежит на устройстве, и показать его можно до того, как он уедет.
struct AttachmentUploader: Sendable {
    private let database: AppDatabase
    private let api: AttachmentSending

    init(database: AppDatabase = AppServices.database, api: AttachmentSending = ChatsAPI()) {
        self.database = database
        self.api = api
    }

    @discardableResult
    func send(
        _ attachment: OutgoingAttachment,
        chatID: String,
        senderID: String,
        caption: String?,
        replyToID: String?
    ) async -> Bool {
        let message = MessageRecord(
            id: UUID().uuidString,
            remoteId: nil,
            chatId: chatID,
            seq: nil,
            senderId: senderID,
            content: caption ?? "",
            replyToId: replyToID,
            replyQuote: nil,
            systemType: nil,
            editedAt: nil,
            deletedAt: nil,
            pinnedAt: nil,
            createdAt: Date(),
            sendState: .pending
        )
        // Файл кладём на диск, если его там ещё нет: без копии «Повторить» после
        // сбоя было бы нечем, а свой снимок в ленте показывается из неё же, до загрузки.
        let local = AttachmentRecord(
            id: UUID().uuidString,
            messageId: message.id,
            mime: attachment.mime,
            name: attachment.name,
            size: attachment.data.count,
            width: attachment.width,
            height: attachment.height,
            localPath: attachment.cachedPath ?? Self.keep(attachment.data, name: attachment.name)
        )

        do {
            try await database.writer.write { db in
                try message.insert(db)
                try local.insert(db)
            }
        } catch {
            return false
        }
        return await deliver(message: message, local: local, data: attachment.data)
    }

    /// Повторить неудавшееся вложение — по кнопке у сообщения. Байты — из копии на
    /// диске; если система её уже вычистила, сообщение остаётся неотправленным.
    /// Состояние меняется в одной транзакции «неудача → в пути»: второе нажатие, пока
    /// первое ещё едет, ничего не отправит.
    @discardableResult
    func retry(messageID: String) async -> Bool {
        let claimed = try? await database.writer.write { db -> (MessageRecord, AttachmentRecord)? in
            guard
                var message = try MessageRecord.fetchOne(db, key: messageID),
                message.remoteId == nil, message.sendState == .failed,
                let local = try AttachmentRecord.filter(AttachmentRecord.Columns.messageId == messageID).fetchOne(db)
            else { return nil }
            message.sendState = .pending
            try message.update(db)
            return (message, local)
        }
        guard let (message, local) = claimed ?? nil else { return false }
        guard let path = local.localPath, let data = FileManager.default.contents(atPath: path) else {
            await markFailed(message.id)
            return false
        }
        return await deliver(message: message, local: local, data: data)
    }

    /// Три шага сервера и подтверждение в базе.
    private func deliver(message: MessageRecord, local: AttachmentRecord, data: Data) async -> Bool {
        let caption = message.content.isEmpty ? nil : message.content
        do {
            let ticket = try await api.presign(chatID: message.chatId, mime: local.mime)
            try await api.upload(data, to: ticket.url, mime: local.mime)
            let sent = try await api.sendUploaded(
                chatID: message.chatId,
                content: caption,
                replyToID: message.replyToId,
                attachments: [AttachmentUpload(key: ticket.key, name: local.name)]
            )
            try await database.writer.write { db in
                try MessageStore.confirm(localID: message.id, with: sent, in: db)
                // Серверные вложения заменяют локальную запись, но файл на диске
                // остаётся: показывать его из кэша быстрее, чем качать своё же.
                // `upsert`, а не `insert`: если сообщение уже пришло из сокета, строка
                // с серверным id вложения есть — вставка упёрлась бы в ключ.
                if let serverFile = sent.media?.first {
                    var updated = local
                    updated.id = serverFile.id
                    try local.delete(db)
                    try updated.upsert(db)
                }
            }
            return true
        } catch {
            await markFailed(message.id)
            return false
        }
    }

    private func markFailed(_ id: String) async {
        try? await database.writer.write { db in
            guard var row = try MessageRecord.fetchOne(db, key: id) else { return }
            row.sendState = .failed
            try row.update(db)
        }
    }

    /// Каталог копий исходящих файлов — в кэше: система вправе его чистить, и это
    /// не страшно, сервер к тому времени файл уже хранит.
    static var outboxDirectory: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appending(path: "chat-outbox", directoryHint: .isDirectory)
    }

    private static func keep(_ data: Data, name: String?) -> String? {
        let directory = outboxDirectory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let ext = name.map { ($0 as NSString).pathExtension } ?? ""
        let url = directory.appending(path: UUID().uuidString + (ext.isEmpty ? "" : ".\(ext)"))
        do {
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            return url.path
        } catch {
            return nil
        }
    }
}

/// Файл, который человек собрался отправить.
struct OutgoingAttachment: Sendable, Equatable {
    let data: Data
    let mime: String
    let name: String?
    var width: Int?
    var height: Int?
    /// Путь в кэше приложения, если файл уже туда положен (голосовое, снимок).
    var cachedPath: String?
}
