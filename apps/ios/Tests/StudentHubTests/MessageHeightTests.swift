import XCTest

@testable import StudentHub

/// Высоты сообщений для раскладки ленты (`MessageTimelineLayout`): отпечаток содержимого
/// решает, годится ли запомненная высота, а оценка — куда встанет ещё не виденное.
final class MessageHeightTests: XCTestCase {
    /// Отпечаток стабилен: тот же пузырь между запусками — та же запомненная высота.
    func testFingerprintIsStableForSameContent() {
        let first = item(content: "Привет").heightFingerprint(isGroup: false, selecting: false)
        let second = item(content: "Привет").heightFingerprint(isGroup: false, selecting: false)
        XCTAssertEqual(first, second)
    }

    /// Правка текста или режим выбора меняют пузырь — прежняя высота недействительна.
    func testFingerprintChangesWithContentAndMode() {
        let base = item(content: "Привет").heightFingerprint(isGroup: false, selecting: false)
        XCTAssertNotEqual(base, item(content: "Привет!").heightFingerprint(isGroup: false, selecting: false))
        XCTAssertNotEqual(base, item(content: "Привет").heightFingerprint(isGroup: false, selecting: true))
        XCTAssertNotEqual(base, item(content: "Привет", lastInGroup: false).heightFingerprint(isGroup: false, selecting: false))
    }

    /// Оценка растёт с текстом и вложениями: длинное сообщение встаёт выше короткого ещё
    /// до замера, и лента почти не сдвигается, когда ячейка досчитает себя.
    func testEstimateGrowsWithContent() {
        let width: CGFloat = 393
        let short = item(content: "Да").estimatedHeight(width: width, isGroup: false)
        let long = item(content: String(repeating: "длинное сообщение ", count: 20)).estimatedHeight(width: width, isGroup: false)
        let photo = item(content: "", attachments: [image()]).estimatedHeight(width: width, isGroup: false)
        XCTAssertGreaterThan(long, short)
        XCTAssertGreaterThan(photo, short)
    }

    /// Ключ кэша различает ширину и размер шрифта: на другом экране высота другая.
    func testCacheKeySeparatesWidthAndCategory() {
        let a = MessageHeightCache.key(id: "m1", width: 393, category: .large)
        XCTAssertNotEqual(a, MessageHeightCache.key(id: "m1", width: 430, category: .large))
        XCTAssertNotEqual(a, MessageHeightCache.key(id: "m1", width: 393, category: .extraExtraLarge))
    }

    private func item(
        content: String,
        attachments: [AttachmentRecord] = [],
        lastInGroup: Bool = true
    ) -> MessageTimeline.Item {
        MessageTimeline.Item(
            message: MessageRecord(
                id: "m1",
                remoteId: "m1",
                chatId: "c-1",
                seq: 1,
                senderId: "u-1",
                content: content,
                replyToId: nil,
                replyQuote: nil,
                systemType: nil,
                editedAt: nil,
                deletedAt: nil,
                pinnedAt: nil,
                createdAt: Date(timeIntervalSince1970: 0),
                sendState: .sent
            ),
            attachments: attachments,
            isFirstInGroup: true,
            isLastInGroup: lastInGroup,
            isOwn: false
        )
    }

    private func image() -> AttachmentRecord {
        AttachmentRecord(id: "a1", messageId: "m1", mime: "image/jpeg", name: nil, size: nil, width: 1200, height: 900, localPath: nil)
    }
}
