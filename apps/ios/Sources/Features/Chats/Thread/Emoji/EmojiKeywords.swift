import Foundation

/// Поиск emoji по словам на русском и казахском (CLDR), а также по английскому
/// названию Unicode. Словарь разбирается один раз, при первом поиске.
enum EmojiKeywords {
    private struct Entry {
        let emoji: String
        let words: [Substring]
    }

    private static let entries: [Entry] = EmojiKeywordsData.raw
        .split(separator: "\n")
        .compactMap { line in
            let parts = line.split(separator: "\t", maxSplits: 1)
            guard parts.count == 2 else { return nil }
            return Entry(emoji: String(parts[0]), words: parts[1].split(separator: " "))
        }

    /// Emoji, у которых какое-то слово начинается с запроса. Сначала те, где слово
    /// совпало целиком, затем — по началу, затем — по английскому названию.
    static func search(_ query: String, in catalog: [String] = EmojiCatalog.all) -> [String] {
        let term = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !term.isEmpty else { return [] }
        // В каталоге символы с U+FE0F, в CLDR — без: сравниваем без селектора.
        let display = Dictionary(catalog.map { ($0.replacingOccurrences(of: "\u{FE0F}", with: ""), $0) }, uniquingKeysWith: { first, _ in first })
        var exact: [String] = []
        var prefix: [String] = []
        for entry in entries {
            if entry.words.contains(where: { $0 == term }) {
                exact.append(display[entry.emoji] ?? entry.emoji)
            } else if entry.words.contains(where: { $0.hasPrefix(term) }) {
                prefix.append(display[entry.emoji] ?? entry.emoji)
            }
        }
        let english = catalog.filter { emoji in
            emoji.unicodeScalars.contains { $0.properties.name?.lowercased().contains(term) == true }
        }
        var seen = Set<String>()
        return (exact + prefix + english).filter { seen.insert($0).inserted }
    }
}
