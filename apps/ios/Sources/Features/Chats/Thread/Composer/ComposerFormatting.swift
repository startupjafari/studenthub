import Foundation

/// Форматирование текста сообщения — разметкой Markdown, которую уже понимают веб
/// (react-markdown + GFM) и пузырь в приложении (`RichText`): поле ввода остаётся
/// простым текстом, и черновик, правка и сервер видят ровно то, что уйдёт.
///
/// Чистые функции над строкой и выделением (в UTF-16, как `NSRange` у `UITextView`):
/// поле применяет результат одной заменой, и её можно отменить.
enum ComposerFormat: CaseIterable, Hashable {
    case bold, italic, monospace, strikethrough, link, quote, codeBlock

    var title: String {
        switch self {
        case .bold: String(localized: "chats.format.bold", defaultValue: "Жирный")
        case .italic: String(localized: "chats.format.italic", defaultValue: "Курсив")
        case .monospace: String(localized: "chats.format.monospace", defaultValue: "Моноширинный")
        case .strikethrough: String(localized: "chats.format.strikethrough", defaultValue: "Зачёркнутый")
        case .link: String(localized: "chats.format.link", defaultValue: "Ссылка")
        case .quote: String(localized: "chats.format.quote", defaultValue: "Цитата")
        case .codeBlock: String(localized: "chats.format.codeBlock", defaultValue: "Блок кода")
        }
    }

    var symbol: String {
        switch self {
        case .bold: "bold"
        case .italic: "italic"
        case .monospace: "chevron.left.forwardslash.chevron.right"
        case .strikethrough: "strikethrough"
        case .link: "link"
        case .quote: "text.quote"
        case .codeBlock: "curlybraces"
        }
    }

    /// Чем обернуть выделение в строке; у цитаты и блока кода — построчная разметка.
    private var marker: String? {
        switch self {
        case .bold: "**"
        case .italic: "_"
        case .monospace: "`"
        case .strikethrough: "~~"
        case .link, .quote, .codeBlock: nil
        }
    }

    /// Замена выделения: что поставить на место `selected` и какое выделение оставить
    /// внутри замены (смещение и длина в UTF-16). Пустое выделение — разметка с курсором
    /// внутри, чтобы сразу печатать. `url` — только для ссылки.
    func apply(to selected: String, url: String? = nil) -> (text: String, selection: NSRange) {
        if let marker {
            // Повторное нажатие на уже размеченное — снимает разметку.
            if selected.count >= marker.count * 2, selected.hasPrefix(marker), selected.hasSuffix(marker) {
                let inner = String(selected.dropFirst(marker.count).dropLast(marker.count))
                return (inner, NSRange(location: 0, length: inner.utf16.count))
            }
            let text = marker + selected + marker
            return (text, NSRange(location: marker.utf16.count, length: selected.utf16.count))
        }
        switch self {
        case .link:
            let address = Self.linkAddress(url ?? "")
            let label = Self.singleLine(selected)
            // Пустое выделение или подпись, равная адресу, — голый адрес: получатель
            // распознает его сам, а `[адрес](адрес)` — лишняя разметка (IOS_RULES 7.4.4).
            if label.isEmpty || Self.sameAddress(label, url ?? "") {
                return (address, NSRange(location: address.utf16.count, length: 0))
            }
            let escaped = Self.linkLabel(label)
            let text = "[\(escaped)](\(address))"
            return (text, NSRange(location: 1, length: escaped.utf16.count))
        case .quote:
            let lines = selected.components(separatedBy: "\n")
            // Снятие узнаёт и строку `>` без пробела (IOS_RULES 7.4.6): иначе повтор
            // добавил бы второй уровень цитаты.
            let quoted = lines.allSatisfy { $0.hasPrefix(">") }
                ? lines.map { line in
                    let rest = line.dropFirst()
                    return String(rest.hasPrefix(" ") ? rest.dropFirst() : rest)
                }
                : lines.map { "> " + $0 }
            let text = quoted.joined(separator: "\n")
            return (text, NSRange(location: 0, length: text.utf16.count))
        case .codeBlock:
            let text = "```\n" + selected + "\n```"
            return (text, NSRange(location: 4, length: selected.utf16.count))
        default:
            return (selected, NSRange(location: 0, length: selected.utf16.count))
        }
    }

    // MARK: Ссылка

    /// Подпись и адрес ссылки — однострочные значения (IOS_RULES 7.2.5): отрезок
    /// пробелов с переводом строки становится одним пробелом, иначе `[…](…)` раскалывается.
    static func singleLine(_ value: String) -> String {
        let normalized = OutgoingText.normalizingLineBreaks(value)
        guard normalized.contains("\n") else { return normalized }
        return normalized
            .components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    /// Подпись внутри `[…]`: скобки экранируются, чтобы `]` в выделении не закрыл ссылку.
    static func linkLabel(_ label: String) -> String {
        label
            .replacingOccurrences(of: "[", with: "\\[", options: .literal)
            .replacingOccurrences(of: "]", with: "\\]", options: .literal)
    }

    /// Адрес внутри `(…)`: пробелы и круглые скобки кодируются — `)` или пробел иначе
    /// обрывают ссылку и в пузыре, и на вебе.
    static func linkAddress(_ url: String) -> String {
        singleLine(url)
            .trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: " ", with: "%20", options: .literal)
            .replacingOccurrences(of: "(", with: "%28", options: .literal)
            .replacingOccurrences(of: ")", with: "%29", options: .literal)
    }

    /// Подпись и есть адрес — с допусками на схему, `www.`, конечный `/`, регистр и
    /// процент-кодирование.
    static func sameAddress(_ label: String, _ url: String) -> Bool {
        func key(_ value: String) -> String {
            var text = (value.removingPercentEncoding ?? value)
                .trimmingCharacters(in: .whitespaces)
                .lowercased()
            for prefix in ["https://", "http://", "mailto:"] where text.hasPrefix(prefix) {
                text.removeFirst(prefix.count)
                break
            }
            if text.hasPrefix("www.") { text.removeFirst(4) }
            while text.hasSuffix("/") { text.removeLast() }
            return text
        }
        let target = key(url)
        return !target.isEmpty && key(label) == target
    }
}

/// Где выделение относительно кода и ссылок (IOS_RULES 7.4.3): внутри
/// ```` ``` ```` или `` ` `` маркеры форматирования получатель увидел бы буквально,
/// поэтому там доступен только «Блок кода»; ссылку не кладут на моноширинный, а
/// моноширинный — на ссылку.
///
/// Блок кода узнаётся по чётности ```` ``` ```` до места — теми же парами, что разбирает
/// `MessageCodeBlocks.parse`; незакрытый блок тоже считается кодом: человек его ещё пишет.
struct ComposerContext: Equatable {
    var inCodeBlock = false
    var inInlineCode = false
    var inLink = false
    /// В выделении есть `` ` ``: ссылку на моноширинный не кладём.
    var selectionHasCode = false
    /// В выделении есть ссылка: моноширинный на неё не кладём.
    var selectionHasLink = false

    var inCode: Bool { inCodeBlock || inInlineCode }

    func allows(_ format: ComposerFormat) -> Bool {
        if inCode { return format == .codeBlock }
        switch format {
        case .link: return !selectionHasCode && !inLink
        case .monospace: return !selectionHasLink && !inLink
        default: return true
        }
    }

    /// Контекст выделения `range` (UTF-16) в тексте.
    static func at(_ range: NSRange, in text: String) -> ComposerContext {
        let ns = text as NSString
        let start = min(max(0, range.location), ns.length)
        let end = min(start + max(0, range.length), ns.length)
        let selected = ns.substring(with: NSRange(location: start, length: end - start))
        let fences = fenceLocations(in: ns, before: end)
        func insideBlock(_ position: Int) -> Bool {
            fences.filter { $0 < position }.count % 2 == 1
        }
        var context = ComposerContext(
            inCodeBlock: insideBlock(start) || insideBlock(end) || fences.contains { $0 >= start && $0 < end },
            selectionHasCode: selected.contains("`"),
            selectionHasLink: selected.contains("](")
        )
        if !context.inCodeBlock {
            let line = linePrefix(of: ns, at: start)
            context.inInlineCode = insideInlineCode(line)
            context.inLink = insideLink(line)
        }
        return context
    }

    /// Начала ```` ``` ```` до `limit` — литеральным поиском, как в разборе пузыря.
    private static func fenceLocations(in text: NSString, before limit: Int) -> [Int] {
        var result: [Int] = []
        var from = 0
        while from < limit {
            let found = text.range(of: MessageCodeBlocks.fence, options: .literal, range: NSRange(location: from, length: text.length - from))
            guard found.location != NSNotFound, found.location < limit else { break }
            result.append(found.location)
            from = found.location + found.length
        }
        return result
    }

    /// Строка до места: строчный код и ссылка в Markdown не переходят через абзац.
    private static func linePrefix(of text: NSString, at location: Int) -> String {
        let lineStart = text.lineRange(for: NSRange(location: location, length: 0)).location
        return text.substring(with: NSRange(location: lineStart, length: location - lineStart))
    }

    /// Нечётное число одиночных `` ` `` до места — внутри строчного кода.
    private static func insideInlineCode(_ line: String) -> Bool {
        line.replacingOccurrences(of: MessageCodeBlocks.fence, with: "", options: .literal)
            .reduce(0) { $1 == "`" ? $0 + 1 : $0 } % 2 == 1
    }

    /// Внутри `[подписи]` или `(адреса)` ссылки.
    private static func insideLink(_ line: String) -> Bool {
        var depth = 0
        var inAddress = false
        var previous: Character?
        for character in line {
            if inAddress {
                if character == ")" { inAddress = false }
            } else if character == "[" {
                depth += 1
            } else if character == "]" {
                depth = max(0, depth - 1)
            } else if character == "(", previous == "]" {
                inAddress = true
            }
            previous = character
        }
        return depth > 0 || inAddress
    }
}

/// Списки в тексте: маркер «- » или номер «1. » в начале строки.
enum ComposerList {
    enum Style { case bulleted, numbered }

    /// Переключить список на строке с курсором: строка без маркера получает его,
    /// с маркером того же вида — теряет. Номер — следующий за номером строки выше.
    /// Возвращает, какой отрезок строки заменить (UTF-16) и на что.
    static func toggle(_ style: Style, in text: String, at location: Int) -> (range: NSRange, replacement: String) {
        let ns = text as NSString
        let safe = min(max(0, location), ns.length)
        let line = ns.lineRange(for: NSRange(location: safe, length: 0))
        let lineText = ns.substring(with: line)

        if let existing = marker(of: lineText) {
            let isNumbered = existing.first?.isNumber == true
            let replacement: String
            if isNumbered == (style == .numbered) {
                replacement = ""
            } else {
                replacement = prefix(style, previousLine: previousLine(in: ns, before: line))
            }
            return (NSRange(location: line.location, length: existing.utf16.count), replacement)
        }
        return (NSRange(location: line.location, length: 0), prefix(style, previousLine: previousLine(in: ns, before: line)))
    }

    /// Маркер в начале строки: «- », «• » или «12. ».
    static func marker(of line: String) -> String? {
        if line.hasPrefix("- ") { return "- " }
        if line.hasPrefix("• ") { return "• " }
        let digits = line.prefix(while: \.isNumber)
        guard !digits.isEmpty, digits.count <= 3 else { return nil }
        let rest = line.dropFirst(digits.count)
        return rest.hasPrefix(". ") ? String(digits) + ". " : nil
    }

    private static func prefix(_ style: Style, previousLine: String?) -> String {
        switch style {
        case .bulleted:
            return "- "
        case .numbered:
            let digits = previousLine.map { String($0.prefix(while: \.isNumber)) } ?? ""
            if let number = Int(digits), previousLine.flatMap(marker(of:)) != nil {
                return "\(number + 1). "
            }
            return "1. "
        }
    }

    private static func previousLine(in text: NSString, before line: NSRange) -> String? {
        guard line.location > 0 else { return nil }
        let previous = text.lineRange(for: NSRange(location: line.location - 1, length: 0))
        return text.substring(with: previous)
    }
}
