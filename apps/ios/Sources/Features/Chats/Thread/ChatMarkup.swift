import SwiftUI

/// Подчёркнутый `++текст++` и спойлер `||текст||` — маркеры контракта разметки сообщения
/// сверх CommonMark (PROJECT.md §3.6). Правила те же, что у веба (`shared/lib/chat-markup.ts`)
/// и Android (`ChatMarkup.kt`):
/// - маркер — ровно два знака, не часть серии `+++` / `|||`;
/// - открывающий: перед ним начало или не буква и не цифра, после — не пробел;
/// - закрывающий: перед ним не пробел, после — конец или не буква и не цифра;
/// - пара — ближайший подходящий закрывающий в пределах абзаца, внутри строчного кода не ищется;
/// - `\|` и `\+` — экранирование.
/// Так `i++; j++`, `C++ и C++`, `a || b`, `a||b||c` остаются текстом.
///
/// Разбор встроен в разбор Markdown Apple, а не сделан вторым проходом поверх готового текста:
/// пара переписывается во встроенный атрибут (`^[текст](spoiler: true)`), и остальная разметка
/// внутри неё (`||**жирный** спойлер||`) разбирается тем же разборщиком, что и раньше (IOS_RULES
/// 7.6.2). Строчный код и экранирование переписыванием не трогаются — их разбирает Apple.
enum ChatMarkup {
    enum Kind {
        case underline, spoiler

        /// Имя встроенного атрибута Markdown Apple — `name` ключа атрибута ниже.
        var attribute: String {
            switch self {
            case .underline: ChatUnderlineAttribute.name
            case .spoiler: ChatSpoilerAttribute.name
            }
        }
    }

    /// Предфильтр без разбора: без двух одинаковых знаков подряд пар нет.
    static func mayHaveMarks(_ source: String) -> Bool {
        source.contains("++") || source.contains("||")
    }

    /// Есть ли в тексте хоть один спойлер — по тому же разбору, что рисует.
    static func containsSpoiler(_ source: String) -> Bool {
        guard source.contains("||") else { return false }
        var found = false
        _ = replace(source) { kind, inner in
            if kind == .spoiler { found = true }
            return inner
        }
        return found
    }

    /// Текст с парами, переписанными во встроенные атрибуты Markdown Apple; `nil` — пар нет,
    /// и текст разбирается как раньше.
    static func rewrite(_ source: String) -> String? {
        guard mayHaveMarks(source) else { return nil }
        var changed = false
        let result = replace(source) { kind, inner in
            changed = true
            return "^[\(escapingUnbalancedBrackets(inner))](\(kind.attribute): true)"
        }
        return changed ? result : nil
    }

    /// Пройти строку и заменить каждую пару тем, что вернёт `transform` (внутренность — уже
    /// обработанная тем же проходом). Экранирование и строчный код переносятся как есть.
    static func replace(_ source: String, _ transform: (Kind, String) -> String) -> String {
        guard mayHaveMarks(source) else { return source }
        let chars = Array(source)
        var out = ""
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if c == "\\" {
                out.append(c)
                if i + 1 < chars.count { out.append(chars[i + 1]) }
                i += 2
                continue
            }
            if c == "`" {
                let end = codeSpanEnd(chars, i, chars.count) ?? i + runLength(chars, i)
                out += String(chars[i..<end])
                i = end
                continue
            }
            if let markKind = Self.kind(of: c), isOpening(chars, i), let close = closing(chars, i, chars.count) {
                let inner = String(chars[(i + 2)..<close])
                out += transform(markKind, replace(inner, transform))
                i = close + 2
                continue
            }
            out.append(c)
            i += 1
        }
        return out
    }

    // MARK: Правила маркера

    static func kind(of character: Character) -> Kind? {
        switch character {
        case "+": .underline
        case "|": .spoiler
        default: nil
        }
    }

    private static func isWord(_ character: Character) -> Bool {
        character.isLetter || character.isNumber
    }

    static func canOpen(prev: Character?, next: Character?) -> Bool {
        guard let next, !next.isWhitespace else { return false }
        return prev.map { !isWord($0) } ?? true
    }

    static func canClose(prev: Character?, next: Character?) -> Bool {
        guard let prev, !prev.isWhitespace else { return false }
        return next.map { !isWord($0) } ?? true
    }

    private static func isEscaped(_ chars: [Character], _ at: Int) -> Bool {
        var slashes = 0
        var i = at - 1
        while i >= 0, chars[i] == "\\" {
            slashes += 1
            i -= 1
        }
        return slashes % 2 == 1
    }

    private static func runLength(_ chars: [Character], _ at: Int) -> Int {
        var end = at
        while end < chars.count, chars[end] == chars[at] { end += 1 }
        return end - at
    }

    /// Конец строчного кода с серии обратных кавычек в `at` — после закрывающей серии той же
    /// длины; `nil` — незакрытая серия, просто текст.
    private static func codeSpanEnd(_ chars: [Character], _ at: Int, _ limit: Int) -> Int? {
        let fence = runLength(chars, at)
        var i = at + fence
        while i < limit {
            if chars[i] == "`" {
                let run = runLength(chars, i)
                if run == fence { return i + run }
                i += run
            } else {
                i += 1
            }
        }
        return nil
    }

    /// Маркер из ровно двух знаков, не экранированный.
    private static func isPairMarker(_ chars: [Character], _ at: Int) -> Bool {
        let c = chars[at]
        guard kind(of: c) != nil, at + 1 < chars.count, chars[at + 1] == c else { return false }
        if at > 0, chars[at - 1] == c { return false }
        if at + 2 < chars.count, chars[at + 2] == c { return false }
        return !isEscaped(chars, at)
    }

    private static func isOpening(_ chars: [Character], _ at: Int) -> Bool {
        isPairMarker(chars, at)
            && canOpen(prev: at > 0 ? chars[at - 1] : nil, next: at + 2 < chars.count ? chars[at + 2] : nil)
    }

    /// Закрывающий маркер для открывающего в `open`: не дальше пустой строки, мимо кода.
    private static func closing(_ chars: [Character], _ open: Int, _ limit: Int) -> Int? {
        let marker = chars[open]
        var i = open + 2
        while i < limit {
            let c = chars[i]
            if c == "\\" {
                i += 2
                continue
            }
            if c.isNewline {
                var j = i + 1
                while j < limit, chars[j] == " " || chars[j] == "\t" { j += 1 }
                if j < limit, chars[j].isNewline { return nil }
            }
            if c == "`" {
                i = codeSpanEnd(chars, i, limit) ?? i + runLength(chars, i)
                continue
            }
            if c == marker, i > open + 2, isPairMarker(chars, i),
               canClose(prev: chars[i - 1], next: i + 2 < limit ? chars[i + 2] : nil) {
                return i
            }
            i += 1
        }
        return nil
    }

    /// Непарные `[` и `]` внутри пары экранируются: иначе `]` закрыл бы `^[…]` раньше времени.
    /// Парные (подпись ссылки `[сайт](…)`) остаются — ссылка внутри спойлера работает.
    private static func escapingUnbalancedBrackets(_ text: String) -> String {
        let chars = Array(text)
        var unbalanced = Set<Int>()
        var open: [Int] = []
        var i = 0
        while i < chars.count {
            switch chars[i] {
            case "\\":
                i += 1
            case "`":
                if let end = codeSpanEnd(chars, i, chars.count) { i = end - 1 }
            case "[":
                open.append(i)
            case "]":
                if open.popLast() == nil { unbalanced.insert(i) }
            default:
                break
            }
            i += 1
        }
        unbalanced.formUnion(open)
        guard !unbalanced.isEmpty else { return text }
        var out = ""
        for (index, character) in chars.enumerated() {
            if unbalanced.contains(index) { out.append("\\") }
            out.append(character)
        }
        return out
    }

    // MARK: Отрисовка

    /// Подчёркнутые куски — подчёркиванием SwiftUI. Зовётся после разбора (`RichText`).
    static func styleUnderlines(_ text: inout AttributedString) {
        for (value, range) in text.runs[ChatUnderlineAttribute.self] where value == true {
            text[range].underlineStyle = Text.LineStyle.single
        }
    }

    /// Скрыть спойлеры: текст прозрачен (место в строке остаётся — открытие не двигает
    /// раскладку и высоту ячейки), поверх — подложка цвета текста; ссылка внутри не нажимается.
    static func conceal(_ text: inout AttributedString, tint: Color) {
        for (value, range) in text.runs[ChatSpoilerAttribute.self] where value == true {
            text[range].foregroundColor = Color.clear
            text[range].backgroundColor = tint.opacity(0.28)
            text[range].link = nil
        }
    }

    /// Текст для VoiceOver и превью: спойлер — тем, что вернёт `spoiler` (его видимый текст
    /// на входе), остальное — как нарисовано.
    static func text(of attributed: AttributedString, spoiler: (String) -> String) -> String {
        var out = ""
        for (value, range) in attributed.runs[ChatSpoilerAttribute.self] {
            let part = String(attributed[range].characters)
            out += value == true ? spoiler(part) : part
        }
        return out
    }

    /// Спойлер в однострочном превью: знаки Брайля `⠿` той же длины, не больше 12, — как в
    /// Telegram и на вебе; сам текст в превью не попадает.
    static func placeholder(for visible: String) -> String {
        let count = visible.trimmingCharacters(in: .whitespacesAndNewlines).count
        return String(repeating: "⠿", count: min(max(count, 1), 12))
    }

    /// Чем VoiceOver читает скрытый спойлер.
    static var spokenPlaceholder: String {
        String(localized: "chats.spoiler.hidden", defaultValue: "скрытый текст")
    }
}

// MARK: - Атрибуты

/// `^[текст](underline: true)` — подчёркнутый кусок сообщения.
enum ChatUnderlineAttribute: CodableAttributedStringKey, MarkdownDecodableAttributedStringKey {
    typealias Value = Bool
    static let name = "underline"
}

/// `^[текст](spoiler: true)` — спойлер.
enum ChatSpoilerAttribute: CodableAttributedStringKey, MarkdownDecodableAttributedStringKey {
    typealias Value = Bool
    static let name = "spoiler"
}

extension AttributeScopes {
    /// Атрибуты разбора сообщения чата: Foundation (ссылки, жирный, код) и маркеры §3.6.
    struct ChatMarkupAttributes: AttributeScope {
        let chatUnderline: ChatUnderlineAttribute
        let chatSpoiler: ChatSpoilerAttribute
        let foundation: FoundationAttributes
    }

    var chatMarkup: ChatMarkupAttributes.Type { ChatMarkupAttributes.self }
}

extension AttributeDynamicLookup {
    subscript<T: AttributedStringKey>(
        dynamicMember keyPath: KeyPath<AttributeScopes.ChatMarkupAttributes, T>
    ) -> T {
        self[T.self]
    }
}

// MARK: - Открытие спойлеров

/// Держит, открыты ли спойлеры сообщения: одно касание открывает все, как в Telegram.
/// Состояние — у этого вида, а вид получает личность по id сообщения (`.id(…)` у места
/// вызова): переиспользованная ячейка чужого сообщения открытый спойлер не наследует
/// (IOS_RULES 6.2.5, 6.2.6). Пока спойлеры скрыты, касание текста открывает их и не уходит
/// в ссылку; открытые — касание снова у ссылок и пузыря.
struct ChatSpoilerReveal<Content: View>: View {
    let hasSpoilers: Bool
    @ViewBuilder let content: (Bool) -> Content

    @State private var revealed = false
    @Environment(\.motionReduced) private var reduceMotion

    private var hidden: Bool { hasSpoilers && !revealed }

    var body: some View {
        content(revealed)
            .gesture(TapGesture().onEnded { reveal() }, including: hidden ? .all : .subviews)
            .accessibilityActions {
                if hidden {
                    Button(String(localized: "chats.spoiler.reveal", defaultValue: "Показать спойлер")) { reveal() }
                }
            }
    }

    private func reveal() {
        guard hidden else { return }
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { revealed = true }
    }
}
