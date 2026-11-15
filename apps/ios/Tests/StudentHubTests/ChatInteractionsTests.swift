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
