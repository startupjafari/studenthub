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
        // Набор и порядок — с записи Telegram из ТЗ (15.11): 👌 🙏 👍 😂 😁 ❤️ 👎.
        XCTAssertEqual(EmojiCatalog.quickReactions, ["👌", "🙏", "👍", "😂", "😁", "❤️", "👎"])
    }

    func testCatalogHasNoDuplicatesAndFlags() {
        let all = EmojiCatalog.all
        XCTAssertEqual(all.count, Set(all).count)
        XCTAssertEqual(EmojiCatalog.flag("KZ"), "🇰🇿")
        XCTAssertEqual(EmojiCatalog.categories.first { $0.id == "flags" }?.emoji.first, "🇰🇿")
        XCTAssertTrue(EmojiCatalog.categories.allSatisfy { !$0.emoji.isEmpty })
    }

    /// Поиск emoji понимает русский, казахский и английский; флаги — по названию страны.
    func testEmojiSearchInRussianKazakhAndEnglish() {
        XCTAssertTrue(EmojiKeywords.search("сердце").contains("❤️"))
        XCTAssertTrue(EmojiKeywords.search("жүрек").contains("❤️"))
        XCTAssertTrue(EmojiKeywords.search("heart").contains("❤️"))
        XCTAssertTrue(EmojiKeywords.search("казахстан").contains("🇰🇿"))
        XCTAssertTrue(EmojiKeywords.search("   ").isEmpty)
    }

    /// Опрос, чек-лист, стикер, геопозицию и контакт правка испортила бы — «Редактировать»
    /// для них нет; обычный текст и пересланный пост — правятся (IOS_RULES 7.7.13).
    func testSpecialKindsAreNotEditable() {
        XCTAssertTrue(ChatThreadModel.isEditableKind(nil))
        XCTAssertTrue(ChatThreadModel.isEditableKind(MessageExtras()))
        var sticker = MessageExtras()
        sticker.sticker = .init(id: "s-1")
        XCTAssertFalse(ChatThreadModel.isEditableKind(sticker))
        var location = MessageExtras()
        location.location = .init(lat: 43.2, lng: 76.9)
        XCTAssertFalse(ChatThreadModel.isEditableKind(location))
        var contact = MessageExtras()
        contact.contact = .init(name: "Айгерим")
        XCTAssertFalse(ChatThreadModel.isEditableKind(contact))
        var checklist = MessageExtras()
        checklist.checklist = .init(id: "c-1", title: "Дела", items: [])
        XCTAssertFalse(ChatThreadModel.isEditableKind(checklist))
    }

    private func attachment(_ mime: String, name: String? = nil, asDocument: Bool = false) -> AttachmentRecord {
        AttachmentRecord(id: UUID().uuidString, messageId: "m-1", mime: mime, name: name, asDocument: asDocument)
    }

    /// Меню по виду вложений: снимок — «Сохранить фото», ролик — «Сохранить видео», альбом
    /// вперемешку — «Сохранить в «Фото»», файл — «Сохранить файл»; голосовое не сохраняется.
    func testSaveActionsFollowAttachmentKinds() {
        func actions(_ files: [AttachmentRecord]) -> [MessageMenuAction] {
            MessageMenuAction.available(
                for: message(content: ""), isOwn: false, isGroup: false,
                capabilities: MessageCapabilities(), readCount: 0, attachments: files
            )
        }
        XCTAssertTrue(actions([attachment("image/jpeg")]).contains(.saveMedia(.photo)))
        XCTAssertTrue(actions([attachment("video/mp4")]).contains(.saveMedia(.video)))
        XCTAssertTrue(actions([attachment("image/jpeg"), attachment("video/mp4")]).contains(.saveMedia(.mixed)))
        let document = actions([attachment("application/pdf", name: "a.pdf")])
        XCTAssertTrue(document.contains(.saveFile))
        XCTAssertFalse(document.contains { if case .saveMedia = $0 { return true } else { return false } })
        // Снимок «как файл» сохраняется файлом, а не в «Фото».
        XCTAssertEqual(actions([attachment("image/png", asDocument: true)]).filter { $0.id.hasPrefix("save") }, [.saveFile])
        XCTAssertTrue(actions([attachment("audio/m4a", name: "voice-1.m4a")]).allSatisfy { !$0.id.hasPrefix("save") })
        XCTAssertTrue(actions([]).allSatisfy { !$0.id.hasPrefix("save") }, "у текста сохранять нечего")
        // Только у пришедшего с сервера и без «Скопировать» у медиа без подписи.
        XCTAssertFalse(actions([attachment("image/jpeg")]).contains(.copy))
    }

    /// Оптимистичная реакция — по правилу сервера: одна на человека, та же снимает,
    /// другая заменяет, чужие не трогаются, порядок — как в выдаче.
    func testReactionToggleFollowsServerRule() {
        let groups = [
            MessageExtras.ReactionGroup(emoji: "👍", userIds: ["a", "b"]),
            MessageExtras.ReactionGroup(emoji: "❤️", userIds: ["me"]),
        ]
        let replaced = MessageExtras.ReactionGroup.toggled(groups, emoji: "👍", viewerID: "me")
        XCTAssertEqual(replaced, [MessageExtras.ReactionGroup(emoji: "👍", userIds: ["a", "b", "me"])])
        let removed = MessageExtras.ReactionGroup.toggled(groups, emoji: "❤️", viewerID: "me")
        XCTAssertEqual(removed, [MessageExtras.ReactionGroup(emoji: "👍", userIds: ["a", "b"])])
        let added = MessageExtras.ReactionGroup.toggled([], emoji: "👌", viewerID: "me")
        XCTAssertEqual(added, [MessageExtras.ReactionGroup(emoji: "👌", userIds: ["me"])])
        // Повторное нажатие той же — снова пусто: дублей одного человека не бывает.
        XCTAssertEqual(MessageExtras.ReactionGroup.toggled(added, emoji: "👌", viewerID: "me"), [])
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
