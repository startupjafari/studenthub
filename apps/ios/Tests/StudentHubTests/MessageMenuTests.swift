import XCTest

@testable import StudentHub

/// Меню по долгому нажатию: состав пунктов зависит от сообщения и прав, порядок — как в
/// Telegram. И каталог emoji для расширенного выбора реакций.
final class MessageMenuTests: XCTestCase {
    func testOwnGroupMessageHasFullMenu() {
        let actions = MessageMenuAction.available(
            for: message(content: "Привет"),
            isOwn: true,
            isGroup: true,
            capabilities: MessageCapabilities(canEdit: true, canDelete: true, canReport: false),
            readCount: 3
        )
        XCTAssertEqual(actions, [
            .reply, .copy, .edit, .pin(isPinned: false), .forward, .readers(count: 3), .delete, .select,
        ])
    }

    /// Чужое: можно пожаловаться, нельзя править; «Удалить» остаётся — у себя.
    func testOthersMessage() {
        let actions = MessageMenuAction.available(
            for: message(content: "Привет", pinned: true),
            isOwn: false,
            isGroup: true,
            capabilities: MessageCapabilities(canEdit: false, canDelete: false, canReport: true),
            readCount: 0
        )
        XCTAssertEqual(actions, [.reply, .copy, .pin(isPinned: true), .forward, .report, .delete, .select])
    }

    /// Без текста — нечего копировать.
    func testNoCopyWithoutText() {
        let actions = MessageMenuAction.available(
            for: message(content: ""),
            isOwn: false,
            isGroup: false,
            capabilities: MessageCapabilities(),
            readCount: 0
        )
        XCTAssertFalse(actions.contains(.copy))
        XCTAssertFalse(actions.contains(.readers(count: 0)))
    }

    /// Не дошедшее до сервера: ни ответа, ни пересылки — только локальные действия.
    func testPendingMessage() {
        var pending = message(content: "в пути")
        pending.remoteId = nil
        pending.sendState = .pending
        let actions = MessageMenuAction.available(
            for: pending,
            isOwn: true,
            isGroup: false,
            capabilities: MessageCapabilities(canDelete: true),
            readCount: 0
        )
        XCTAssertEqual(actions, [.copy, .delete, .select])
    }

    func testDeletedMessageOnlySelects() {
        var deleted = message(content: "x")
        deleted.deletedAt = Date()
        XCTAssertEqual(
            MessageMenuAction.available(
                for: deleted, isOwn: true, isGroup: false, capabilities: MessageCapabilities(), readCount: 0
            ),
            [.select]
        )
    }

    func testQuickReactionsMatchTelegramSet() {
        XCTAssertEqual(EmojiCatalog.quickReactions, ["👍", "❤️", "😂", "🔥", "👎", "🙏"])
    }

    func testCatalogHasNoDuplicatesAndFlags() {
        let all = EmojiCatalog.all
        XCTAssertEqual(all.count, Set(all).count)
        XCTAssertEqual(EmojiCatalog.flag("KZ"), "🇰🇿")
        XCTAssertEqual(EmojiCatalog.categories.first { $0.id == "flags" }?.emoji.first, "🇰🇿")
        XCTAssertTrue(EmojiCatalog.categories.allSatisfy { !$0.emoji.isEmpty })
    }

    private func message(content: String, pinned: Bool = false) -> MessageRecord {
        MessageRecord(
            id: "m-1",
            remoteId: "m-1",
            chatId: "c-1",
            seq: 1,
            senderId: "u-1",
            content: content,
            replyToId: nil,
            replyQuote: nil,
            systemType: nil,
            editedAt: nil,
            deletedAt: nil,
            pinnedAt: pinned ? Date() : nil,
            createdAt: Date(),
            sendState: .sent
        )
    }
}
