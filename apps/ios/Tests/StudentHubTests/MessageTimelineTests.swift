import XCTest

@testable import StudentHub

final class MessageTimelineTests: XCTestCase {
    private let viewer = "u-me"

    /// Разные дни — разные секции: без разделителя переписка выглядит как один
    /// бесконечный день.
    func testMessagesSplitByDay() {
        let days = MessageTimeline.build(
            from: [
                message(id: "1", at: "2026-10-05T10:00:00Z"),
                message(id: "2", at: "2026-10-05T10:01:00Z"),
                message(id: "3", at: "2026-10-06T09:00:00Z"),
            ],
            viewerID: viewer,
            calendar: utc
        )

        XCTAssertEqual(days.count, 2)
        XCTAssertEqual(days.first?.items.map(\.id), ["1", "2"])
        XCTAssertEqual(days.last?.items.map(\.id), ["3"])
    }

    /// Подряд идущие сообщения одного автора — одна группа: имя и хвостик рисуются
    /// по краям, а не у каждой реплики.
    func testConsecutiveMessagesFormOneGroup() {
        let days = MessageTimeline.build(
            from: [
                message(id: "1", at: "2026-10-06T10:00:00Z", sender: "u-1"),
                message(id: "2", at: "2026-10-06T10:01:00Z", sender: "u-1"),
                message(id: "3", at: "2026-10-06T10:02:00Z", sender: "u-2"),
            ],
            viewerID: viewer,
            calendar: utc
        )
        let items = days.flatMap(\.items)

        XCTAssertEqual(items.map(\.isFirstInGroup), [true, false, true])
        XCTAssertEqual(items.map(\.isLastInGroup), [false, true, true])
    }

    /// Пауза рвёт группу: через час это уже другой разговор.
    func testLongPauseBreaksGroup() {
        let days = MessageTimeline.build(
            from: [
                message(id: "1", at: "2026-10-06T10:00:00Z", sender: "u-1"),
                message(id: "2", at: "2026-10-06T11:00:00Z", sender: "u-1"),
            ],
            viewerID: viewer,
            calendar: utc
        )

        XCTAssertEqual(days.flatMap(\.items).map(\.isFirstInGroup), [true, true])
    }

    /// Системное сообщение не склеивается ни с чем: это не реплика человека.
    func testSystemMessageStandsAlone() {
        let days = MessageTimeline.build(
            from: [
                message(id: "1", at: "2026-10-06T10:00:00Z", sender: "u-1"),
                message(id: "2", at: "2026-10-06T10:00:30Z", sender: "u-1", system: "member_added"),
                message(id: "3", at: "2026-10-06T10:01:00Z", sender: "u-1"),
            ],
            viewerID: viewer,
            calendar: utc
        )

        XCTAssertEqual(days.flatMap(\.items).map(\.isFirstInGroup), [true, true, true])
    }

    func testOwnMessagesAreMarked() {
        let days = MessageTimeline.build(
            from: [
                message(id: "1", at: "2026-10-06T10:00:00Z", sender: viewer),
                message(id: "2", at: "2026-10-06T10:05:00Z", sender: "u-1"),
            ],
            viewerID: viewer,
            calendar: utc
        )

        XCTAssertEqual(days.flatMap(\.items).map(\.isOwn), [true, false])
    }

    /// Якорь непрочитанного — первое чужое из последних `unreadCount`: именно туда
    /// человек хочет попасть, открыв чат с тремя новыми сообщениями.
    func testUnreadAnchorPointsAtFirstUnreadForeignMessage() {
        let messages = [
            message(id: "1", at: "2026-10-06T10:00:00Z", sender: "u-1"),
            message(id: "2", at: "2026-10-06T10:01:00Z", sender: viewer),
            message(id: "3", at: "2026-10-06T10:02:00Z", sender: "u-1"),
            message(id: "4", at: "2026-10-06T10:03:00Z", sender: "u-1"),
        ]

        let anchor = MessageTimeline.firstUnreadID(in: messages, viewerID: viewer, unreadCount: 2)

        XCTAssertEqual(anchor, "3")
    }

    /// Непрочитанных нет — и якоря нет: лента открывается внизу, как обычно.
    func testNoAnchorWithoutUnread() {
        let messages = [message(id: "1", at: "2026-10-06T10:00:00Z", sender: "u-1")]

        XCTAssertNil(MessageTimeline.firstUnreadID(in: messages, viewerID: viewer, unreadCount: 0))
    }

    // MARK: - Помощники

    private var utc: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
        return calendar
    }

    private func message(
        id: String,
        at iso: String,
        sender: String = "u-1",
        system: String? = nil
    ) -> MessageRecord {
        MessageRecord(
            id: id,
            remoteId: id,
            chatId: "c-1",
            seq: Int(id),
            senderId: sender,
            content: "текст \(id)",
            replyToId: nil,
            replyQuote: nil,
            systemType: system,
            editedAt: nil,
            deletedAt: nil,
            pinnedAt: nil,
            createdAt: ISO8601DateFormatter().date(from: iso) ?? Date(),
            sendState: .sent
        )
    }
}
