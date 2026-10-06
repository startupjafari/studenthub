import Foundation

/// Раскладка переписки на то, что рисует лента.
///
/// Чистая функция без UIKit и без базы: группировка и разделители — самая частая
/// причина «поехавшей» ленты, и проверять их надо тестами, а не глазами.
enum MessageTimeline {
    /// Подряд идущие сообщения одного автора склеиваются в группу, пока между ними
    /// не прошло больше этого времени. Пять минут — то же правило, что в вебе.
    static let groupingWindow: TimeInterval = 5 * 60

    struct Item: Identifiable, Hashable {
        let message: MessageRecord
        /// Первое в группе — у него рисуется имя автора.
        let isFirstInGroup: Bool
        /// Последнее в группе — у него хвостик пузыря и время.
        let isLastInGroup: Bool
        let isOwn: Bool

        var id: String { message.id }
    }

    struct Day: Identifiable, Hashable {
        /// Начало суток — оно же идентификатор секции.
        let id: Date
        let items: [Item]
    }

    static func build(
        from messages: [MessageRecord],
        viewerID: String,
        calendar: Calendar = .current
    ) -> [Day] {
        var days: [Day] = []
        var currentDay: Date?
        var buffer: [Item] = []

        func flush() {
            guard let day = currentDay, !buffer.isEmpty else { return }
            days.append(Day(id: day, items: buffer))
            buffer = []
        }

        for (index, message) in messages.enumerated() {
            let day = calendar.startOfDay(for: message.createdAt)
            if day != currentDay {
                flush()
                currentDay = day
            }

            let previous = index > 0 ? messages[index - 1] : nil
            let next = index + 1 < messages.count ? messages[index + 1] : nil

            buffer.append(
                Item(
                    message: message,
                    isFirstInGroup: !continues(previous, before: message, calendar: calendar),
                    isLastInGroup: !continues(message, before: next, calendar: calendar),
                    isOwn: message.senderId == viewerID
                )
            )
        }
        flush()

        return days
    }

    /// Первое непрочитанное — якорь, к которому лента прокручивается при открытии.
    ///
    /// Считаем от хвоста по счётчику с сервера: своя отметка прочтения на клиенте не
    /// хранится, а счётчик непрочитанного приходит со списком и всегда про чужие
    /// сообщения.
    static func firstUnreadID(
        in messages: [MessageRecord],
        viewerID: String,
        unreadCount: Int
    ) -> String? {
        guard unreadCount > 0 else { return nil }
        let foreign = messages.filter { $0.senderId != viewerID && $0.deletedAt == nil }
        guard !foreign.isEmpty else { return nil }
        let index = max(0, foreign.count - unreadCount)
        return foreign[index].id
    }

    /// Продолжает ли `next` группу, начатую `previous`.
    private static func continues(
        _ previous: MessageRecord?,
        before next: MessageRecord?,
        calendar: Calendar
    ) -> Bool {
        guard let previous, let next else { return false }
        guard previous.senderId == next.senderId else { return false }
        // Системные сообщения не группируются ни с чем: это не реплика человека.
        guard previous.systemType == nil, next.systemType == nil else { return false }
        guard calendar.isDate(previous.createdAt, inSameDayAs: next.createdAt) else { return false }
        return next.createdAt.timeIntervalSince(previous.createdAt) <= groupingWindow
    }
}
