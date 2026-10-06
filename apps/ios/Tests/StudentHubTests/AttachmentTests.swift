import GRDB
import XCTest

@testable import StudentHub

final class AttachmentTests: XCTestCase {
    /// Вложение видно в ленте сразу, а подтверждение лишь меняет идентификаторы:
    /// файл лежит на устройстве, и ждать хранилище, чтобы его показать, незачем.
    func testUploadedAttachmentIsVisibleImmediately() async throws {
        let database = try await seeded()
        let api = StubAttachments()
        api.message = message(id: "server-1", fileID: "file-1")
        let uploader = AttachmentUploader(database: database, api: api)

        let ok = await uploader.send(
            OutgoingAttachment(data: Data("байты".utf8), mime: "image/jpeg", name: "photo.jpg", cachedPath: "/tmp/photo.jpg"),
            chatID: "c-1",
            senderID: "u-me",
            caption: "смотри",
            replyToID: nil
        )

        XCTAssertTrue(ok)
        try database.reader.read { db in
            let message = try MessageRecord.fetchOne(db)
            XCTAssertEqual(message?.remoteId, "server-1")
            XCTAssertEqual(message?.sendState, .sent)
            let attachment = try AttachmentRecord.fetchOne(db)
            XCTAssertEqual(attachment?.id, "file-1")
            // Файл с диска не теряем: показывать своё из кэша быстрее, чем качать.
            XCTAssertEqual(attachment?.localPath, "/tmp/photo.jpg")
        }
    }

    /// Загрузка сорвалась — сообщение остаётся в ленте неотправленным, а файл на
    /// месте: человек нажмёт «ещё раз», а не будет искать снимок заново.
    func testFailedUploadKeepsMessageAndFile() async throws {
        let database = try await seeded()
        let api = StubAttachments()
        api.failure = .transport(URLError(.timedOut))
        let uploader = AttachmentUploader(database: database, api: api)

        let ok = await uploader.send(
            OutgoingAttachment(data: Data("байты".utf8), mime: "audio/m4a", name: "voice-1.m4a", cachedPath: "/tmp/voice-1.m4a"),
            chatID: "c-1",
            senderID: "u-me",
            caption: nil,
            replyToID: nil
        )

        XCTAssertFalse(ok)
        try database.reader.read { db in
            XCTAssertEqual(try MessageRecord.fetchOne(db)?.sendState, .failed)
            XCTAssertEqual(try AttachmentRecord.fetchOne(db)?.localPath, "/tmp/voice-1.m4a")
        }
    }

    /// Вложения входящего сообщения кладутся вместе с ним, а повторная синхронизация
    /// не теряет уже скачанный файл.
    func testIncomingAttachmentsAreStoredAndKeepLocalCopy() async throws {
        let database = try await seeded()
        let store = MessageStore(database: database)
        let incoming = ChatMessageDTO(
            id: "m-1", chatId: "c-1", seq: 1, senderId: "u-1", content: "",
            replyToId: nil, replyQuote: nil, systemType: nil, editedAt: nil, deletedAt: nil,
            pinnedAt: nil, createdAt: Date(timeIntervalSince1970: 1_800_000_000),
            media: [
                ChatAttachmentDTO(
                    id: "file-9", mime: "image/png", size: 100, name: "p.png",
                    spoiler: nil, asDocument: nil, width: 10, height: 20
                )
            ]
        )
        try await store.save(messages: [incoming], chatID: "c-1")
        try await database.writer.write { db in
            try db.execute(sql: "UPDATE attachment SET localPath = '/tmp/p.png' WHERE id = 'file-9'")
        }

        try await store.save(messages: [incoming], chatID: "c-1")

        try database.reader.read { db in
            XCTAssertEqual(try AttachmentRecord.fetchCount(db), 1)
            XCTAssertEqual(try AttachmentRecord.fetchOne(db)?.localPath, "/tmp/p.png")
        }
    }

    /// Голосовое узнаётся по имени, как и на сервере: отдельного типа сообщения в
    /// модели нет.
    func testVoiceIsRecognisedByName() {
        let voice = AttachmentRecord(
            id: "1", messageId: "m", mime: "audio/m4a", name: "voice-7.m4a",
            size: nil, width: nil, height: nil, localPath: nil
        )
        let music = AttachmentRecord(
            id: "2", messageId: "m", mime: "audio/mpeg", name: "song.mp3",
            size: nil, width: nil, height: nil, localPath: nil
        )

        XCTAssertTrue(voice.isVoice)
        XCTAssertFalse(music.isVoice)
    }

    private func seeded() async throws -> AppDatabase {
        let database = try AppDatabase.inMemory()
        try await database.writer.write { db in
            try ChatRecord(
                id: "c-1", type: ChatKind.private.rawValue, title: "Чат", avatarUrl: nil,
                chatDescription: nil, subject: nil, memberCount: 2, unreadCount: 0, muted: false,
                mutedImportantOnly: false, pinnedAt: nil, archivedAt: nil, requestIncoming: false,
                requestOutgoing: false, othersReadAt: nil, lastMessageId: nil, lastSeq: 0,
                updatedAt: Date(timeIntervalSince1970: 1_800_000_000)
            ).insert(db)
        }
        return database
    }

    private func message(id: String, fileID: String) -> ChatMessageDTO {
        ChatMessageDTO(
            id: id, chatId: "c-1", seq: 3, senderId: "u-me", content: "смотри",
            replyToId: nil, replyQuote: nil, systemType: nil, editedAt: nil, deletedAt: nil,
            pinnedAt: nil, createdAt: Date(timeIntervalSince1970: 1_800_000_100),
            media: [
                ChatAttachmentDTO(
                    id: fileID, mime: "image/jpeg", size: 5, name: "photo.jpg",
                    spoiler: nil, asDocument: nil, width: nil, height: nil
                )
            ]
        )
    }
}

private final class StubAttachments: AttachmentSending, @unchecked Sendable {
    private let lock = NSLock()
    var failure: APIError?
    var message: ChatMessageDTO?
    private(set) var uploads = 0

    func presign(chatID: String, mime: String) async throws -> AttachmentUploadTicket {
        if let failure = lock.withLock({ failure }) { throw failure }
        return AttachmentUploadTicket(
            key: "k-1",
            url: URL(string: "https://storage.example/k-1")!,
            expiresAt: Date().addingTimeInterval(600)
        )
    }

    func upload(_ data: Data, to url: URL, mime: String) async throws {
        if let failure = lock.withLock({ uploads += 1; return failure }) { throw failure }
    }

    func sendUploaded(
        chatID: String,
        content: String?,
        replyToID: String?,
        attachments: [AttachmentUpload]
    ) async throws -> ChatMessageDTO {
        if let failure = lock.withLock({ failure }) { throw failure }
        guard let message = lock.withLock({ message }) else {
            throw APIError.malformedResponse(statusCode: 0)
        }
        return message
    }
}
