import SwiftUI
import XCTest

@testable import StudentHub

/// Снимки ключевых элементов экранов — карточки ленты и строки списка чатов — на тех
/// же фикстурах, что mock API UI-тестов (`MockFixtures`).
///
/// Время в этих видах считается от «сейчас» («10 минут назад», «09:41»), поэтому даты
/// подставляются от текущего момента, а не берутся из фикстуры: иначе снимок
/// расходился бы с эталоном просто потому, что прошёл день.
final class FeatureSnapshotTests: SnapshotTestCase {
    // MARK: - Лента

    func testPostCards() throws {
        let model = FeedModel()
        let posts = try (0..<2).map { try decodePost(index: $0) }
        let view = ScrollView {
            VStack(spacing: Spacing.lg) {
                ForEach(posts) { post in
                    PostCardView(post: post, model: model, viewerID: MockFixtures.studentID)
                }
            }
            .padding(.vertical)
        }
        .background(Palette.background)
        assertSnapshots(of: view, named: "post-cards")
    }

    // MARK: - Чаты

    func testChatRows() {
        let rows = [
            chatRow(id: "chat-1", title: "Даурен Ахметов", unread: 2, online: true,
                    last: "Скинь, пожалуйста, методичку к лабораторной", sender: "u-1"),
            chatRow(id: "chat-2", title: "ИС-21 · Группа", type: "GROUP", unread: 0, online: false,
                    last: "Пара перенесена в 305 аудиторию", sender: "u-2", senderName: "Мария"),
            chatRow(id: "chat-3", title: "Мария Ким", unread: 0, online: false,
                    last: "Договорились, до встречи!", sender: MockFixtures.studentID, muted: true),
        ]
        let view = List {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                ChatRowView(row: row, isGroup: index == 1)
            }
        }
        .listStyle(.plain)
        .environment(\.viewerID, MockFixtures.studentID)
        assertSnapshots(of: view, named: "chat-rows", height: 400)
    }

    // MARK: - Помощники

    private func decodePost(index: Int) throws -> PostDTO {
        var json = MockFixtures.post(index)
        let created = MockFixtures.iso(Date().addingTimeInterval(-Double(10 + index * 50) * 60))
        json["createdAt"] = created
        json["publishedAt"] = created
        let data = try JSONSerialization.data(withJSONObject: json)
        return try JSONCoding.decoder.decode(PostDTO.self, from: data)
    }

    /// Сегодня в 09:41 — время в строке выглядит одинаково в любой день прогона.
    private var todayAt941: Date {
        Calendar.current.date(bySettingHour: 9, minute: 41, second: 0, of: Date()) ?? Date()
    }

    private func chatRow(
        id: String, title: String, type: String = "PRIVATE", unread: Int, online: Bool,
        last: String, sender: String, senderName: String? = nil, muted: Bool = false
    ) -> ChatListRow {
        ChatListRow(
            id: id, type: type, title: title, avatarUrl: nil, unreadCount: unread, muted: muted,
            pinnedAt: nil, archivedAt: nil, requestIncoming: false, updatedAt: todayAt941,
            subject: nil, online: online, mutedImportantOnly: false, othersReadAt: nil,
            draftText: nil, lastContent: last, lastSenderId: sender, lastCreatedAt: todayAt941,
            lastDeletedAt: nil, lastSenderName: senderName, lastSystemType: nil, lastExtras: nil,
            lastAttachmentMime: nil, lastAttachmentName: nil, isOwner: false)
    }
}
