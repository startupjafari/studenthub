import Foundation

/// Идентичность строки ленты. Стабильна между обновлениями: альбом — по первому сообщению,
/// дата — по дню. Именно она связывает строку с ячейкой при точечных обновлениях.
enum RowID: Hashable {
    case message(MessageID)
    case date(Int)
}

/// Положение пузыря в серии подряд идущих сообщений одного автора (как в Telegram:
/// хвост — только у последнего в серии, углы между соседями — малого радиуса).
struct MergeFlags: Hashable {
    /// Сосед сверху (более старое сообщение) — того же автора и рядом по времени.
    var top: Bool
    /// Сосед снизу (более новое сообщение) — того же автора и рядом по времени.
    var bottom: Bool
}

/// Строка ленты: сообщение (или альбом — несколько сообщений одним пузырём) либо дата.
struct ChatRow: Hashable {
    enum Kind: Hashable {
        case messages([Message])
        case date(Date)
    }

    var id: RowID
    var kind: Kind
    var merge = MergeFlags(top: false, bottom: false)

    var messages: [Message] {
        if case let .messages(list) = kind { return list }
        return []
    }

    /// Главное сообщение строки: у альбома — последнее (у него подпись, время и реакции).
    var primary: Message? { messages.last }

    var allIds: [MessageID] { messages.map(\.id) }
}

enum ChatRowBuilder {
    /// Серия обрывается, если между сообщениями больше 10 минут (порог Telegram).
    static let mergeInterval: TimeInterval = 600

    /// Строки в порядке ленты: индекс 0 — самое новое (лента перевёрнута, как у Telegram).
    static func build(messages: [Message], calendar: Calendar = .current) -> [ChatRow] {
        var chronological: [ChatRow] = []
        chronological.reserveCapacity(messages.count + 64)
        var currentDay: Date?
        var index = 0
        while index < messages.count {
            let message = messages[index]
            let day = calendar.startOfDay(for: message.date)
            if currentDay != day {
                currentDay = day
                chronological.append(ChatRow(id: .date(Int(day.timeIntervalSince1970)), kind: .date(day)))
            }
            var group = [message]
            if let groupId = message.groupId {
                var next = index + 1
                while next < messages.count, messages[next].groupId == groupId, group.count < 10 {
                    group.append(messages[next])
                    next += 1
                }
            }
            chronological.append(ChatRow(id: .message(message.id), kind: .messages(group)))
            index += group.count
        }
        // Флаги серий.
        for position in chronological.indices {
            guard let current = chronological[position].primary, !current.isService else { continue }
            let first = chronological[position].messages.first ?? current
            if position > 0, let previous = chronological[position - 1].primary {
                chronological[position].merge.top = canMerge(previous, first)
            }
            if position + 1 < chronological.count, let next = chronological[position + 1].messages.first {
                chronological[position].merge.bottom = canMerge(current, next)
            }
        }
        return chronological.reversed()
    }

    static func canMerge(_ older: Message, _ newer: Message) -> Bool {
        guard older.author == newer.author, !older.isService, !newer.isService else { return false }
        // Кружки и крупные эмодзи стоят без пузыря — серию не продолжают визуально, но и не рвут хвост соседей.
        return newer.date.timeIntervalSince(older.date) < mergeInterval
    }
}
