import XCTest

@testable import StudentHub

/// Взаимодействия в переписке по записи Telegram (ТЗ 15.11): итог пересылки, ключи
/// частей большой пачки.
final class ChatForwardOutcomeTests: XCTestCase {
    private func result(_ pairs: [(String, Bool)]) -> ForwardResultDTO {
        ForwardResultDTO(results: pairs.map { ForwardResultDTO.Target(chatId: $0.0, ok: $0.1, messageIds: []) })
    }

    func testAllConfirmedIsComplete() {
        let outcome = ForwardOutcome(requested: ["a", "b"], result: result([("a", true), ("b", true)]))
        XCTAssertTrue(outcome.isComplete)
        XCTAssertEqual(outcome.delivered, ["a", "b"])
    }

    /// Чат, о котором сервер промолчал, — не доставлен: «Переслано» всем не показываем.
    func testMissingChatIsFailure() {
        let outcome = ForwardOutcome(requested: ["a", "b"], result: result([("a", true)]))
        XCTAssertFalse(outcome.isComplete)
        XCTAssertEqual(outcome.failed, ["b"])
    }

    func testPartialFailureKeepsOrderOfRequest() {
        let outcome = ForwardOutcome(requested: ["c", "a", "b"], result: result([("b", false), ("a", true), ("c", true)]))
        XCTAssertEqual(outcome.delivered, ["c", "a"])
        XCTAssertEqual(outcome.failed, ["b"])
    }

    /// Части пачки больше 100: первая — ключ листа, остальные — разные и повторяемые.
    func testChunkKeysAreStableAndDistinct() {
        let key = UUID()
        XCTAssertEqual(ChatThreadModel.chunkKey(key, index: 0), key)
        let second = ChatThreadModel.chunkKey(key, index: 1)
        XCTAssertNotEqual(second, key)
        XCTAssertEqual(second, ChatThreadModel.chunkKey(key, index: 1))
        XCTAssertNotEqual(second, ChatThreadModel.chunkKey(key, index: 2))
    }
}

/// Лист вложений: текст файлом, разделы контактов, плашка расширения недавнего файла.
final class ChatAttachSheetTests: XCTestCase {
    func testTextAttachmentIsUTF8FileNamedByFirstLine() throws {
        let url = try TextAttachmentEditor.file(for: "Конспект: лекция 3\nвторая строка 🎓")
        XCTAssertEqual(url.pathExtension, "txt")
        XCTAssertEqual(url.deletingPathExtension().lastPathComponent, "Конспект лекция 3", "двоеточие из имени убрано")
        XCTAssertEqual(try String(contentsOf: url, encoding: .utf8), "Конспект: лекция 3\nвторая строка 🎓")
    }

    func testBlankFirstLineFallsBackToDatedName() throws {
        let url = try TextAttachmentEditor.file(for: "   \nтекст", now: Date(timeIntervalSince1970: 0))
        XCTAssertTrue(url.lastPathComponent.hasPrefix("   ") == false)
        XCTAssertFalse(url.deletingPathExtension().lastPathComponent.isEmpty)
    }

    func testContactSectionsKeepOrderAndPutHashLast() {
        let names = ["Айгерим", "#1 Деканат", "Болат", "алия", "Zhanna"]
        let sections = ContactsIndex.sections(names) { ContactsIndex.letter(for: $0) }
        XCTAssertEqual(sections.map(\.letter), ["А", "Б", "Z", "#"])
        XCTAssertEqual(sections.first?.rows, ["Айгерим", "алия"])
    }

    func testRecentFileBadgeUsesExtension() {
        let file = RecentChatFileDTO(id: "f", chatId: "c", messageId: "m", name: "notes.rar", mime: "application/x-rar", size: 10, durationMs: nil, createdAt: Date())
        XCTAssertEqual(RecentFilesList.badge(for: file), "RAR")
        let unnamed = RecentChatFileDTO(id: "f", chatId: "c", messageId: "m", name: nil, mime: "text/plain", size: 1, durationMs: nil, createdAt: Date())
        XCTAssertEqual(RecentFilesList.badge(for: unnamed), "PLAI")
    }
}
