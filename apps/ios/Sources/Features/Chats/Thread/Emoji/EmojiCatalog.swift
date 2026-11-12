import Foundation
import Observation

/// Каталог emoji для реакций и панели ввода.
///
/// Список собирается из свойств Unicode самой системы, а не из вшитой таблицы: что
/// система умеет рисовать как emoji — то и показываем, без «тофу» на старых iOS.
/// Разделы — по блокам Unicode: границы их совпадают с привычными группами клавиатуры
/// достаточно, чтобы листать по ним.
enum EmojiCatalog {
    struct Category: Identifiable, Hashable {
        let id: String
        let title: String
        let symbol: String
        let emoji: [String]
    }

    /// Быстрые реакции над пузырём — как в Telegram.
    static let quickReactions = ["👍", "❤️", "😂", "🔥", "👎", "🙏"]

    static let categories: [Category] = build()

    static var all: [String] { categories.flatMap(\.emoji) }

    private static func build() -> [Category] {
        [
            Category(
                id: "smileys",
                title: String(localized: "emoji.smileys", defaultValue: "Смайлы и люди"),
                symbol: "face.smiling",
                emoji: scalars([
                    0x1F600...0x1F64F, 0x1F910...0x1F92F, 0x1F970...0x1F97F, 0x1FAE0...0x1FAEF,
                    0x1F440...0x1F450, 0x1F466...0x1F487, 0x1F9D0...0x1F9DF, 0x1F4AA...0x1F4AA,
                    0x1F590...0x1F596, 0x1F918...0x1F91F, 0x1FAF0...0x1FAF8,
                ])
            ),
            Category(
                id: "nature",
                title: String(localized: "emoji.nature", defaultValue: "Животные и природа"),
                symbol: "leaf",
                emoji: scalars([0x1F400...0x1F43F, 0x1F980...0x1F9AF, 0x1F330...0x1F343, 0x1F331...0x1F33F, 0x1FAB0...0x1FABF])
            ),
            Category(
                id: "food",
                title: String(localized: "emoji.food", defaultValue: "Еда и напитки"),
                symbol: "fork.knife",
                emoji: scalars([0x1F344...0x1F37F, 0x1F950...0x1F96F, 0x1F9C0...0x1F9CF, 0x1FAD0...0x1FADF])
            ),
            Category(
                id: "activity",
                title: String(localized: "emoji.activity", defaultValue: "Активности"),
                symbol: "figure.run",
                emoji: scalars([0x1F380...0x1F3FF, 0x1F93A...0x1F94F, 0x1FA70...0x1FA7F])
            ),
            Category(
                id: "travel",
                title: String(localized: "emoji.travel", defaultValue: "Путешествия и места"),
                symbol: "car",
                emoji: scalars([0x1F680...0x1F6FF, 0x1F300...0x1F32F])
            ),
            Category(
                id: "objects",
                title: String(localized: "emoji.objects", defaultValue: "Предметы"),
                symbol: "lightbulb",
                emoji: scalars([0x1F4A0...0x1F4FF, 0x1F500...0x1F5FF, 0x1FA80...0x1FAAF, 0x231A...0x23FF])
            ),
            Category(
                id: "symbols",
                title: String(localized: "emoji.symbols", defaultValue: "Символы"),
                symbol: "heart",
                emoji: scalars([0x2600...0x27BF, 0x1F191...0x1F19A, 0x2B50...0x2B55])
            ),
            Category(
                id: "flags",
                title: String(localized: "emoji.flags", defaultValue: "Флаги"),
                symbol: "flag",
                emoji: flags()
            ),
        ]
    }

    /// Emoji из диапазонов в порядке Unicode, без повторов. Символы, которые по
    /// умолчанию рисуются текстом (☀, ✈), получают селектор варианта U+FE0F.
    private static func scalars(_ ranges: [ClosedRange<UInt32>]) -> [String] {
        var seen = Set<String>()
        var result: [String] = []
        for range in ranges {
            for value in range {
                guard let scalar = Unicode.Scalar(value), scalar.properties.isEmoji else { continue }
                // Цифры и звёздочка — тоже «emoji» по свойствам, но не для панели.
                guard value > 0x00FF else { continue }
                let text: String
                if scalar.properties.isEmojiPresentation {
                    text = String(scalar)
                } else if scalar.properties.isEmoji, value >= 0x2000 {
                    text = String(scalar) + "\u{FE0F}"
                } else {
                    continue
                }
                if seen.insert(text).inserted { result.append(text) }
            }
        }
        return result
    }

    /// Флаги стран — пары региональных индикаторов. Казахстан первым.
    private static func flags() -> [String] {
        let regions = Locale.Region.isoRegions
            .map(\.identifier)
            .filter { $0.count == 2 && $0.allSatisfy(\.isLetter) }
            .sorted()
        let ordered = ["KZ"] + regions.filter { $0 != "KZ" }
        return ordered.compactMap(flag)
    }

    static func flag(_ code: String) -> String? {
        let base: UInt32 = 0x1F1E6 - 0x41
        var result = ""
        for letter in code.uppercased().unicodeScalars {
            guard let scalar = Unicode.Scalar(base + letter.value) else { return nil }
            result.unicodeScalars.append(scalar)
        }
        return result
    }
}

/// Недавние emoji и реакции — на устройстве, как у системной клавиатуры. Сервер их не
/// хранит, и знать о них ему незачем.
@MainActor
@Observable
final class RecentEmoji {
    static let shared = RecentEmoji()

    private(set) var items: [String]

    private static let key = "chats.recentEmoji"
    private static let limit = 32

    private init() {
        items = UserDefaults.standard.stringArray(forKey: Self.key) ?? []
    }

    func use(_ emoji: String) {
        items.removeAll { $0 == emoji }
        items.insert(emoji, at: 0)
        if items.count > Self.limit { items.removeLast(items.count - Self.limit) }
        UserDefaults.standard.set(items, forKey: Self.key)
    }

    /// Крестик у «Недавних», как в Telegram.
    func clear() {
        items = []
        UserDefaults.standard.removeObject(forKey: Self.key)
    }
}
