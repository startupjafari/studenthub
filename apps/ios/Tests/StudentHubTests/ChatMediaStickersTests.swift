import XCTest

@testable import StudentHub

/// Медиа в чатах «как в Telegram»: загрузка альбома по плиткам, избранные стикеры.
@MainActor
final class ChatMediaStickersTests: XCTestCase {
    // MARK: Загрузка по плиткам

    /// Убранный файл больше не держит общую долю: без этого кольцо сообщения так и не
    /// доходило бы до конца.
    func testDroppedFileLeavesTheTally() {
        let reported = Reported()
        let tally = UploadTally(total: 300) { reported.value = $0 }

        tally.set("0", 100)
        XCTAssertEqual(reported.value ?? 0, 1.0 / 3, accuracy: 0.001)

        tally.set("1.1", 40)
        tally.set("1.2", 10)
        tally.drop("1", bytes: 100)
        XCTAssertEqual(reported.value ?? 0, 0.5, accuracy: 0.001)

        tally.set("2", 100)
        XCTAssertEqual(reported.value ?? 0, 1, accuracy: 0.001)
    }

    /// Крестик на плитке останавливает только идущий файл и отмечает его убранным; после
    /// закрытия состава крестики не действуют.
    func testRemovingFileStopsOnlyItsUpload() {
        let uploads = AttachmentUploads()
        let task = Task<Bool, Never> { true }
        uploads.begin("m-1", task: task)
        let stopped = Reported()
        uploads.beginFile("a-2", of: "m-1") { stopped.value = 1 }

        XCTAssertTrue(uploads.removeFile("a-1", from: "m-1"))
        XCTAssertNil(stopped.value, "ждущий очереди файл просто пропускается")
        XCTAssertTrue(uploads.removeFile("a-2", from: "m-1"))
        XCTAssertEqual(stopped.value, 1, "идущая загрузка файла остановлена")
        XCTAssertTrue(uploads.isRemoved("a-1", from: "m-1"))
        XCTAssertFalse(uploads.isRemoved("a-3", from: "m-1"))

        XCTAssertEqual(uploads.seal("m-1"), ["a-1", "a-2"])
        XCTAssertFalse(uploads.removeFile("a-3", from: "m-1"), "сообщение уже отправляется")

        uploads.end("m-1")
        XCTAssertFalse(uploads.isRemoved("a-1", from: "m-1"))
    }

    /// Доля плитки приходит, пока сообщение в пути, и уходит вместе с ним.
    func testFileProgressLivesWithTheMessage() {
        let uploads = AttachmentUploads()
        uploads.reportFile("a-1", of: "m-1", fraction: 0.5)
        XCTAssertNil(uploads.fileProgress["a-1"], "загрузка не идёт — отчёт лишний")

        uploads.begin("m-1", task: Task<Bool, Never> { true })
        uploads.reportFile("a-1", of: "m-1", fraction: 0.5)
        XCTAssertEqual(uploads.fileProgress["a-1"], 0.5)

        uploads.removeFile("a-1", from: "m-1")
        XCTAssertNil(uploads.fileProgress["a-1"])
        uploads.reportFile("a-1", of: "m-1", fraction: 0.7)
        XCTAssertNil(uploads.fileProgress["a-1"], "убранный файл кольцо не возвращает")

        uploads.reportFile("a-2", of: "m-1", fraction: 0.2)
        uploads.end("m-1")
        XCTAssertTrue(uploads.fileProgress.isEmpty)
    }

    // MARK: Избранные стикеры

    func testFavoriteGoesOnTopAndIsUnique() {
        let list = [sticker("s-1"), sticker("s-2")]

        XCTAssertEqual(StickerCatalog.applying(true, sticker: sticker("s-3"), to: list).map(\.id), ["s-3", "s-1", "s-2"])
        XCTAssertEqual(StickerCatalog.applying(true, sticker: sticker("s-2"), to: list).map(\.id), ["s-2", "s-1"])
        XCTAssertEqual(StickerCatalog.applying(false, sticker: sticker("s-1"), to: list).map(\.id), ["s-2"])
    }

    /// Сверх тридцати вытесняется самый старый — как на сервере.
    func testFavoritesKeepTheServerLimit() {
        let full = (0..<StickerCatalog.favoritesLimit).map { sticker("s-\($0)") }

        let result = StickerCatalog.applying(true, sticker: sticker("new"), to: full)

        XCTAssertEqual(result.count, StickerCatalog.favoritesLimit)
        XCTAssertEqual(result.first?.id, "new")
        XCTAssertFalse(result.contains { $0.id == "s-\(StickerCatalog.favoritesLimit - 1)" })
    }

    func testStickerMessageMenuOffersFavorite() {
        let actions = MessageMenuAction.available(
            for: stickerMessage(),
            isOwn: false,
            isGroup: false,
            capabilities: MessageCapabilities(),
            readCount: 0,
            favoriteSticker: true
        )

        XCTAssertEqual(Array(actions.prefix(2)), [.reply, .favoriteSticker(isFavorite: true)])
    }

    func testFavoritesListSkipsBrokenEntries() throws {
        let json = Data(
            """
            {"data":[{"id":"s-1","emoji":"🎓","width":512,"height":512,"url":"https://cdn/s-1","expiresAt":null},
             {"emoji":"🔥"}]}
            """.utf8
        )

        struct Envelope: Decodable {
            let data: [Entry]
        }
        struct Entry: Decodable {
            let sticker: StickerSetDTO.Sticker?

            init(from decoder: Decoder) throws {
                sticker = try? StickerSetDTO.Sticker(from: decoder)
            }
        }
        let decoded = try JSONCoding.decoder.decode(Envelope.self, from: json)
        XCTAssertEqual(decoded.data.compactMap(\.sticker).map(\.id), ["s-1"])
    }

    // MARK: Вспомогательное

    private final class Reported: @unchecked Sendable {
        var value: Double?
    }

    private func sticker(_ id: String) -> StickerSetDTO.Sticker {
        StickerSetDTO.Sticker(id: id, emoji: nil, width: nil, height: nil, url: "", expiresAt: nil)
    }

    private func stickerMessage() -> MessageRecord {
        var message = MessageRecord(
            id: "m-1",
            remoteId: "m-1",
            chatId: "c-1",
            seq: 1,
            senderId: "u-2",
            content: "",
            replyToId: nil,
            replyQuote: nil,
            systemType: nil,
            editedAt: nil,
            deletedAt: nil,
            pinnedAt: nil,
            createdAt: Date(),
            sendState: .sent
        )
        message.extras = MessageExtras(sticker: MessageExtras.Sticker(id: "s-1", emoji: "🎓"))
        return message
    }
}
