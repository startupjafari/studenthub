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
            let label = selected.isEmpty ? (url ?? "") : selected
            let text = "[\(label)](\(url ?? ""))"
            return (text, NSRange(location: 1, length: label.utf16.count))
        case .quote:
            let lines = selected.components(separatedBy: "\n")
            let quoted = lines.allSatisfy { $0.hasPrefix("> ") }
                ? lines.map { String($0.dropFirst(2)) }
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
