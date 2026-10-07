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
        let local = AttachmentRecord(
            id: UUID().uuidString,
            messageId: message.id,
            mime: attachment.mime,
            name: attachment.name,
            size: attachment.data.count,
            width: attachment.width,
            height: attachment.height,
            localPath: attachment.cachedPath
        )

        do {
            try await database.writer.write { db in
                try message.insert(db)
                try local.insert(db)
            }
        } catch {
            return false
        }

        do {
            let ticket = try await api.presign(chatID: chatID, mime: attachment.mime)
            try await api.upload(attachment.data, to: ticket.url, mime: attachment.mime)
            let sent = try await api.sendUploaded(
                chatID: chatID,
                content: caption,
                replyToID: replyToID,
                attachments: [AttachmentUpload(key: ticket.key, name: attachment.name)]
            )
            try await database.writer.write { db in
                guard var row = try MessageRecord.fetchOne(db, key: message.id) else { return }
                row.remoteId = sent.id
                row.seq = sent.seq
                row.createdAt = sent.createdAt
                row.sendState = .sent
                try row.update(db)
                // Серверные вложения заменяют локальную запись, но файл на диске
                // остаётся: показывать его из кэша быстрее, чем качать своё же.
                if let serverFile = sent.media?.first {
                    var updated = local
                    updated.id = serverFile.id
                    try local.delete(db)
                    try updated.insert(db)
                }
            }
            return true
        } catch {
            try? await database.writer.write { db in
                guard var row = try MessageRecord.fetchOne(db, key: message.id) else { return }
                row.sendState = .failed
                try row.update(db)
            }
            return false
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
