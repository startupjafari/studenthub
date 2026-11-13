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
    /// Одиночный PUT файла с диска. `progress` получает число уже отправленных байт.
    func upload(
        fileAt file: URL,
        to url: URL,
        mime: String,
        progress: @escaping @Sendable (Int64) -> Void
    ) async throws
    /// Открыть многочастную загрузку (`POST /chats/:id/attachments/multipart/start`).
    func startMultipart(chatID: String, mime: String, size: Int) async throws -> MultipartUploadTarget
    /// Подписи на диапазон частей (`POST /chats/:id/attachments/multipart/urls`).
    func partURLs(chatID: String, key: String, uploadID: String, from: Int, to: Int) async throws -> [MultipartPartURL]
    /// PUT одной части; ответ — её ETag, без него сервер объект не соберёт.
    func uploadPart(_ data: Data, to url: URL, progress: @escaping @Sendable (Int64) -> Void) async throws -> String
    func sendUploaded(
        chatID: String,
        content: String?,
        replyToID: String?,
        asFiles: Bool,
        attachments: [AttachmentUpload]
    ) async throws -> ChatMessageDTO
}

/// Готовое к отправке вложение: уже лежит в хранилище под своим ключом. У многочастного
/// ещё `uploadId` и список частей — сборку делает сервер на отправке сообщения.
struct AttachmentUpload: Encodable, Equatable {
    let key: String
    var uploadId: String? = nil
    let name: String?
    var spoiler: Bool? = nil
    var parts: [UploadedPart]? = nil
}

extension ChatsAPI: AttachmentSending {
    func presign(chatID: String, mime: String) async throws -> AttachmentUploadTicket {
        try await client.send(
            try .post("chats/\(chatID)/attachments/presign", json: ["mime": mime]),
            as: AttachmentUploadTicket.self
        )
    }

    /// Загрузка идёт в хранилище напрямую, мимо API: тело файла не проходит через
    /// процесс сервера и не ложится ему в память. И не ложится в память телефона:
    /// `fromFile` читает файл с диска по ходу отправки.
    func upload(
        fileAt file: URL,
        to url: URL,
        mime: String,
        progress: @escaping @Sendable (Int64) -> Void
    ) async throws {
        var request = URLRequest(url: url)
        request.httpMethod = HTTPMethod.put.rawValue
        request.setValue(mime, forHTTPHeaderField: "Content-Type")

        let (_, response) = try await URLSession.shared.upload(
            for: request,
            fromFile: file,
            delegate: UploadProgressDelegate(onSent: progress)
        )
        try Self.ensureSuccess(response)
    }

    /// Тот же PUT из памяти — для небольших файлов ленты и профиля, которые и так уже
    /// лежат в памяти сжатыми.
    func upload(_ data: Data, to url: URL, mime: String) async throws {
        var request = URLRequest(url: url)
        request.httpMethod = HTTPMethod.put.rawValue
        request.setValue(mime, forHTTPHeaderField: "Content-Type")

        let (_, response) = try await URLSession.shared.upload(for: request, from: data)
        try Self.ensureSuccess(response)
    }

    func startMultipart(chatID: String, mime: String, size: Int) async throws -> MultipartUploadTarget {
        struct Body: Encodable {
            let mime: String
            let size: Int
        }
        return try await client.send(
            try .post("chats/\(chatID)/attachments/multipart/start", json: Body(mime: mime, size: size)),
            as: MultipartUploadTarget.self
        )
    }

    func partURLs(chatID: String, key: String, uploadID: String, from: Int, to: Int) async throws -> [MultipartPartURL] {
        struct Body: Encodable {
            let key: String
            let uploadId: String
            let from: Int
            let to: Int
        }
        struct Response: Decodable {
            let parts: [MultipartPartURL]
        }
        return try await client.send(
            try .post(
                "chats/\(chatID)/attachments/multipart/urls",
                json: Body(key: key, uploadId: uploadID, from: from, to: to)
            ),
            as: Response.self
        ).parts
    }

    /// Подписанная ссылка самодостаточна: наш `Authorization` хранилищу не нужен и мог бы
    /// не совпасть с подписью — поэтому запрос мимо клиента API, как и одиночный PUT.
    func uploadPart(_ data: Data, to url: URL, progress: @escaping @Sendable (Int64) -> Void) async throws -> String {
        var request = URLRequest(url: url)
        request.httpMethod = HTTPMethod.put.rawValue
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")

        let (_, response) = try await URLSession.shared.upload(
            for: request,
            from: data,
            delegate: UploadProgressDelegate(onSent: progress)
        )
        try Self.ensureSuccess(response)
        let etag = (response as? HTTPURLResponse)?
            .value(forHTTPHeaderField: "ETag")?
            .replacingOccurrences(of: "\"", with: "") ?? ""
        guard !etag.isEmpty else {
            throw APIError.malformedResponse(statusCode: (response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        return etag
    }

    func sendUploaded(
        chatID: String,
        content: String?,
        replyToID: String?,
        asFiles: Bool,
        attachments: [AttachmentUpload]
    ) async throws -> ChatMessageDTO {
        struct Body: Encodable {
            let content: String?
            let replyToId: String?
            // Схема сервера строгая: флаг уходит только включённым, иначе поля нет вовсе.
            let asFiles: Bool?
            let attachments: [AttachmentUpload]
        }
        return try await client.send(
            try .post(
                "chats/\(chatID)/messages/uploaded",
                json: Body(content: content, replyToId: replyToID, asFiles: asFiles ? true : nil, attachments: attachments)
            ),
            as: ChatMessageDTO.self
        )
    }

    private static func ensureSuccess(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.malformedResponse(statusCode: (response as? HTTPURLResponse)?.statusCode ?? 0)
        }
    }
}

/// Прогресс отправки тела запроса. Делегат задачи, а не сессии: общая `URLSession.shared`
/// остаётся без своего делегата, а каждый PUT сообщает о себе сам.
private final class UploadProgressDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    let onSent: @Sendable (Int64) -> Void

    init(onSent: @escaping @Sendable (Int64) -> Void) {
        self.onSent = onSent
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didSendBodyData bytesSent: Int64,
        totalBytesSent: Int64,
        totalBytesExpectedToSend: Int64
    ) {
        onSent(totalBytesSent)
    }
}

/// Отправка вложений.
///
/// Три шага сервера (подпись → загрузка в хранилище → сообщение по ключам) видны
/// здесь как один вызов. Сообщение появляется в ленте сразу, как и текстовое: файлы
/// лежат на устройстве, и показать их можно до того, как они уедут. Несколько файлов —
/// одно сообщение-альбом, как в вебе: сервер принимает до десяти вложений за раз.
struct AttachmentUploader: Sendable {
    /// Потолок вложений в одном сообщении — как у сервера и альбома в вебе.
    static let albumLimit = 10
    /// Порог многочастной загрузки — `FILE_UPLOAD.MULTIPART_THRESHOLD_BYTES` (50 МБ):
    /// до него одиночный PUT ещё надёжен, выше обрыв на 80 % стоил бы заливки заново.
    static let multipartThreshold = 50 * 1024 * 1024

    private let database: AppDatabase
    private let api: AttachmentSending

    init(database: AppDatabase = AppServices.database, api: AttachmentSending = ChatsAPI()) {
        self.database = database
        self.api = api
    }

    /// Одно вложение — голосовое или файл из старых мест вызова.
    @discardableResult
    func send(
        _ attachment: OutgoingAttachment,
        chatID: String,
        senderID: String,
        caption: String?,
        replyToID: String?
    ) async -> Bool {
        await send([attachment], chatID: chatID, senderID: senderID, caption: caption, replyToID: replyToID)
    }

    @discardableResult
    func send(
        _ attachments: [OutgoingAttachment],
        chatID: String,
        senderID: String,
        caption: String?,
        replyToID: String?,
        asFiles: Bool = false
    ) async -> Bool {
        guard let id = await enqueue(
            attachments,
            chatID: chatID,
            senderID: senderID,
            caption: caption,
            replyToID: replyToID,
            asFiles: asFiles
        ) else { return false }
        return await deliver(messageID: id)
    }

    /// Положить сообщение с файлами в ленту, ещё ничего не отправляя. Отдельным шагом —
    /// чтобы альбомы одной отправки встали в ленту сразу все, а уезжали по очереди.
    /// Ответ — локальный id сообщения.
    func enqueue(
        _ attachments: [OutgoingAttachment],
        chatID: String,
        senderID: String,
        caption: String?,
        replyToID: String?,
        asFiles: Bool = false
    ) async -> String? {
        guard !attachments.isEmpty else { return nil }
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
        // «Как файл» — свойство всей отправки, но хранится у каждого вложения: так его
        // видит пузырь и помнит повтор.
        let locals = attachments.map { attachment in
            AttachmentRecord(
                id: UUID().uuidString,
                messageId: message.id,
                mime: attachment.mime,
                name: attachment.name,
                size: attachment.byteCount,
                width: attachment.width,
                height: attachment.height,
                localPath: attachment.cachedPath ?? attachment.data.flatMap { Self.keep($0, name: attachment.name) },
                spoiler: attachment.spoiler && !asFiles,
                asDocument: asFiles
            )
        }

        do {
            try await database.writer.write { db in
                try message.insert(db)
                for local in locals {
                    try local.insert(db)
                }
            }
        } catch {
            return nil
        }
        await AttachmentUploads.shared.enqueue(message.id)
        return message.id
    }

    /// Повторить неудавшееся вложение — по кнопке у сообщения. Байты — из копии на
    /// диске; если система её уже вычистила, сообщение остаётся неотправленным.
    /// Состояние меняется в одной транзакции «неудача → в пути»: второе нажатие, пока
    /// первое ещё едет, ничего не отправит.
    @discardableResult
    func retry(messageID: String) async -> Bool {
        let claimed = try? await database.writer.write { db -> Bool in
            guard
                var message = try MessageRecord.fetchOne(db, key: messageID),
                message.remoteId == nil, message.sendState == .failed,
                try AttachmentRecord.filter(AttachmentRecord.Columns.messageId == messageID).fetchCount(db) > 0
            else { return false }
            message.sendState = .pending
            try message.update(db)
            return true
        }
        guard claimed == true else { return false }
        return await deliver(messageID: messageID)
    }

    /// Отправить поставленное в ленту. Загрузка идёт своей задачей, которую можно
    /// отменить крестиком на пузыре (`AttachmentUploads.cancel`).
    @discardableResult
    func deliver(messageID: String) async -> Bool {
        let task = Task { await transfer(messageID: messageID) }
        await AttachmentUploads.shared.begin(messageID, task: task)
        let ok = await task.value
        await AttachmentUploads.shared.end(messageID)
        return ok
    }

    /// Убрать неотправленное сообщение с файлами: отмена загрузки. Сервер о нём ещё не
    /// знает, поэтому это чисто локальное удаление — вместе с копиями файлов.
    func discard(messageID: String) async {
        let paths = (try? await database.writer.write { db -> [String] in
            guard let message = try MessageRecord.fetchOne(db, key: messageID), message.remoteId == nil else { return [] }
            let files = try AttachmentRecord
                .filter(AttachmentRecord.Columns.messageId == messageID)
                .fetchAll(db)
            try AttachmentRecord.filter(AttachmentRecord.Columns.messageId == messageID).deleteAll(db)
            try message.delete(db)
            return files.compactMap(\.localPath)
        }) ?? []
        // Чужие файлы (голосовое пишется рядом, в свой каталог) не трогаем — только копии
        // из каталога исходящих.
        let outbox = Self.outboxDirectory.path
        for path in paths where path.hasPrefix(outbox) {
            try? FileManager.default.removeItem(atPath: path)
        }
    }

    /// Загрузки, оборванные закрытием приложения, так и висели бы «в пути» с часиками:
    /// их некому довести. Такие помечаем неудачными — у пузыря появляется «Повторить».
    func failAbandoned(chatID: String) async {
        let running = await AttachmentUploads.shared.runningIDs
        try? await database.writer.write { db in
            let stuck = try MessageRecord
                .filter(MessageRecord.Columns.chatId == chatID)
                .filter(MessageRecord.Columns.remoteId == nil)
                .filter(MessageRecord.Columns.sendState == MessageSendState.pending.rawValue)
                .filter(sql: "EXISTS (SELECT 1 FROM attachment WHERE attachment.messageId = message.id)")
                .fetchAll(db)
            for var message in stuck where !running.contains(message.id) {
                message.sendState = .failed
                try message.update(db)
            }
        }
    }

    // MARK: - Внутреннее

    /// Файлы — в хранилище по очереди, затем сообщение по их ключам и подтверждение в базе.
    private func transfer(messageID: String) async -> Bool {
        let loaded = try? await database.reader.read { db -> (MessageRecord, [AttachmentRecord])? in
            guard let message = try MessageRecord.fetchOne(db, key: messageID) else { return nil }
            let files = try AttachmentRecord
                .filter(AttachmentRecord.Columns.messageId == messageID)
                .order(sql: "rowid")
                .fetchAll(db)
            return (message, files)
        }
        guard let (message, locals) = loaded ?? nil, !locals.isEmpty else { return false }

        let total = locals.reduce(Int64(0)) { $0 + Int64($1.size ?? 0) }
        let tally = UploadTally(total: total) { fraction in
            Task { @MainActor in AttachmentUploads.shared.report(messageID, fraction: fraction) }
        }
        let asFiles = locals.contains(where: \.asDocument)

        do {
            var uploads: [AttachmentUpload] = []
            // По очереди, а не параллельно: внутри многочастной загрузки и так три части
            // в работе, а пять файлов разом только забили бы канал (как в вебе).
            for (index, local) in locals.enumerated() {
                guard let path = local.localPath else { throw URLError(.fileDoesNotExist) }
                let file = URL(filePath: path)
                let size = local.size ?? 0
                let spoiler: Bool? = local.spoiler ? true : nil
                if size > Self.multipartThreshold {
                    let result = try await MultipartAttachmentUpload(api: api, chatID: message.chatId).run(
                        file: file,
                        size: size,
                        mime: local.mime
                    ) { part, sent in
                        tally.set("\(index).\(part)", sent)
                    }
                    uploads.append(AttachmentUpload(
                        key: result.key,
                        uploadId: result.uploadID,
                        name: local.name,
                        spoiler: spoiler,
                        parts: result.parts
                    ))
                } else {
                    let ticket = try await api.presign(chatID: message.chatId, mime: local.mime)
                    try await api.upload(fileAt: file, to: ticket.url, mime: local.mime) { sent in
                        tally.set("\(index)", sent)
                    }
                    tally.set("\(index)", Int64(size))
                    uploads.append(AttachmentUpload(key: ticket.key, name: local.name, spoiler: spoiler))
                }
                try Task.checkCancellation()
            }

            // Файлы уже в хранилище — сообщение отправляется до конца и крестиком не
            // прерывается: оборванный на лету запрос мог создать сообщение на сервере, а
            // локально оно пропало бы. Отдельной задачей, вместе с подтверждением в базе:
            // асинхронная запись GRDB в отменённой задаче не выполняется вовсе.
            let caption = message.content.isEmpty ? nil : message.content
            try await Task { [api, database] in
                let sent = try await api.sendUploaded(
                    chatID: message.chatId,
                    content: caption,
                    replyToID: message.replyToId,
                    asFiles: asFiles,
                    attachments: uploads
                )
                // Разобранная волна своего голосового переезжает на серверный id вложения
                // до подтверждения в базе: иначе пузырь, получив новый id, на миг рисовал
                // запасную волну другой ширины без длительности — и прыгал.
                for (local, serverFile) in zip(locals, sent.media ?? []) where local.mime.hasPrefix("audio/") {
                    if let profile = VoiceProfileCache.shared.profile(for: local.id) {
                        VoiceProfileCache.shared.store(profile, for: serverFile.id)
                    }
                }
                try await database.writer.write { db in
                    try MessageStore.confirm(localID: message.id, with: sent, in: db)
                    // Серверные вложения заменяют локальные записи, но файлы на диске
                    // остаются: показывать их из кэша быстрее, чем качать своё же. Порядок
                    // у сервера тот же, в каком файлы ушли. `upsert`, а не `insert`: если
                    // сообщение уже пришло из сокета, строка с серверным id вложения есть —
                    // вставка упёрлась бы в ключ.
                    for (local, serverFile) in zip(locals, sent.media ?? []) {
                        var updated = local
                        updated.id = serverFile.id
                        try local.delete(db)
                        try updated.upsert(db)
                    }
                }
            }.value
            return true
        } catch {
            // Уборка — отдельной задачей по той же причине: в отменённой запись не пройдёт.
            let cancelled = Task.isCancelled || error is CancellationError
            await Task {
                if cancelled {
                    await discard(messageID: message.id)
                } else {
                    await markFailed(message.id)
                }
            }.value
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

    /// Свободное место под копию в каталоге исходящих — с расширением исходника: по нему
    /// системный просмотр узнаёт тип файла.
    static func outboxURL(forName name: String?) -> URL {
        let directory = outboxDirectory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let ext = name.map { ($0 as NSString).pathExtension } ?? ""
        return directory.appending(path: UUID().uuidString + (ext.isEmpty ? "" : ".\(ext)"))
    }

    private static func keep(_ data: Data, name: String?) -> String? {
        let url = outboxURL(forName: name)
        do {
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            return url.path
        } catch {
            return nil
        }
    }
}

/// Файл, который человек собрался отправить.
///
/// Тело — либо в памяти (`data`: голосовое, сжатый снимок), либо уже на диске
/// (`cachedPath`): крупный ролик или документ в память не читается вовсе.
struct OutgoingAttachment: Sendable, Equatable {
    var data: Data?
    let mime: String
    let name: String?
    var width: Int?
    var height: Int?
    /// Путь в кэше приложения, если файл уже туда положен (голосовое, снимок, файл).
    var cachedPath: String?
    /// Снимок или ролик уходит под спойлером.
    var spoiler = false

    var byteCount: Int? {
        if let data { return data.count }
        guard let cachedPath else { return nil }
        return (try? FileManager.default.attributesOfItem(atPath: cachedPath)[.size] as? NSNumber)?.intValue
    }
}
