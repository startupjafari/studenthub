import Foundation

extension MessageExtras.ReactionGroup {
    /// Реакции после нажатия `emoji` смотрящим — по правилу сервера (`toggleReaction`): у
    /// человека одна реакция на сообщение; та же снимается, другая заменяет прежнюю.
    /// Порядок — как у выдачи сервера (`ChatMessageDTO.extras`): больше голосов выше, при
    /// равенстве — по эмодзи. Так оптимистичная правка не переставит капсулы, когда придёт
    /// подтверждение.
    static func toggled(_ groups: [MessageExtras.ReactionGroup], emoji: String, viewerID: String) -> [MessageExtras.ReactionGroup] {
        let had = groups.first { $0.userIds.contains(viewerID) }?.emoji
        var result = groups.compactMap { group -> MessageExtras.ReactionGroup? in
            let others = group.userIds.filter { $0 != viewerID }
            return others.isEmpty ? nil : MessageExtras.ReactionGroup(emoji: group.emoji, userIds: others)
        }
        if had != emoji {
            if let index = result.firstIndex(where: { $0.emoji == emoji }) {
                result[index] = MessageExtras.ReactionGroup(emoji: emoji, userIds: result[index].userIds + [viewerID])
            } else {
                result.append(MessageExtras.ReactionGroup(emoji: emoji, userIds: [viewerID]))
            }
        }
        return result.sorted { lhs, rhs in
            lhs.userIds.count == rhs.userIds.count ? lhs.emoji < rhs.emoji : lhs.userIds.count > rhs.userIds.count
        }
    }
}
