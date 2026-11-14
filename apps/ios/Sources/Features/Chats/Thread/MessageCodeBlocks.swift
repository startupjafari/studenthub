import SwiftUI
import UIKit

/// Блоки кода в тексте сообщения: ```` ```язык … ``` ````, как в Telegram.
///
/// Разбор — здесь, а не в `RichText`: тот общий с лентой постов, и менять его разбор
/// значило бы поменять вид постов. Лента переписки зовёт этот разбор только для текстов
/// с тройной кавычкой; остальные идут прежним путём без единого лишнего шага.
///
/// Правила:
/// - блок — между парой ```` ``` ````; незакрытая тройная кавычка остаётся текстом;
/// - первая строка блока — язык, если это одно короткое слово (`swift`, `c++`, `objective-c`);
///   иначе она — часть кода; пустая первая строка (перенос сразу после ```` ``` ````) отбрасывается;
/// - перевод строки перед закрывающей ```` ``` ```` и вокруг блока не рисуется: блок и так
///   стоит своей строкой;
/// - пустой блок (одни пробелы) остаётся текстом как есть — рисовать пустую плашку незачем.
enum MessageCodeBlocks {
    enum Segment: Hashable {
        case text(String)
        case code(language: String?, code: String)

        var isCode: Bool {
            if case .code = self { return true }
            return false
        }
    }

    static let fence = "```"

    /// Сегменты текста, если в нём есть хотя бы один блок кода; `nil` — обычный текст.
    /// Разбор — один раз на текст: ячейка ленты перерисовывается часто.
    static func segments(ifAny source: String) -> [Segment]? {
        guard source.contains(fence) else { return nil }
        let key = source as NSString
        if let known = cache.object(forKey: key) { return known.value }
        let parsed = parse(source)
        let result = parsed.contains(where: \.isCode) ? parsed : nil
        cache.setObject(Parsed(result), forKey: key, cost: source.utf16.count)
        return result
    }

    /// Чистый разбор без кеша — его и проверяют тесты.
    static func parse(_ source: String) -> [Segment] {
        var segments: [Segment] = []
        var pending = ""
        var rest = Substring(source)

        func flushText() {
            let trimmed = pending.trimmingCharacters(in: .newlines)
            if !trimmed.isEmpty { segments.append(.text(trimmed)) }
            pending = ""
        }

        while let open = rest.range(of: fence),
            let close = rest[open.upperBound...].range(of: fence)
        {
            pending += rest[..<open.lowerBound]
            let (language, code) = split(rest[open.upperBound..<close.lowerBound])
            if code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                pending += rest[open.lowerBound..<close.upperBound]
            } else {
                flushText()
                segments.append(.code(language: language, code: code))
            }
            rest = rest[close.upperBound...]
        }
        pending += rest
        flushText()
        return segments
    }

    /// Язык и код внутри пары ```` ``` ````.
    private static func split(_ inner: Substring) -> (String?, String) {
        var body = inner
        var language: String?
        if let newline = body.firstIndex(of: "\n") {
            let head = body[..<newline].trimmingCharacters(in: .whitespaces)
            if head.isEmpty {
                body = body[body.index(after: newline)...]
            } else if isLanguage(head) {
                language = head
                body = body[body.index(after: newline)...]
            }
        }
        var code = String(body)
        while code.hasSuffix("\n") { code.removeLast() }
        return (language, code)
    }

    /// Одно слово до 24 символов из букв, цифр и `+#._-`: `swift`, `c#`, `objective-c`.
    private static func isLanguage(_ head: String) -> Bool {
        guard (1...24).contains(head.count) else { return false }
        return head.unicodeScalars.allSatisfy { scalar in
            CharacterSet.alphanumerics.contains(scalar) || "+#._-".unicodeScalars.contains(scalar)
        }
    }

    // MARK: Кеш

    private final class Parsed {
        let value: [Segment]?
        init(_ value: [Segment]?) { self.value = value }
    }

    /// Разобранные тексты сообщений прежнего человека — тоже его данные (`LocalData.erase`).
    static func clearCache() {
        cache.removeAllObjects()
    }

    /// `NSCache` потокобезопасен; разбор зовут и с главного потока (ячейка), и из тестов.
    private static let cache: NSCache<NSString, Parsed> = {
        let cache = NSCache<NSString, Parsed>()
        cache.countLimit = 500
        cache.totalCostLimit = 1_000_000
        return cache
    }()
}

// MARK: - Вид

/// Текст сообщения с блоками кода: абзацы — как обычный текст пузыря, код — моноширинной
/// плашкой с подписью языка и кнопкой «скопировать».
///
/// Длинные строки кода переносятся, а не прокручиваются вбок: горизонтальная прокрутка
/// внутри ячейки спорила бы со свайпом «ответить» и с жестом назад, а перенос даёт
/// предсказуемую высоту ячейки — лента переписки меряет её один раз.
struct MessageCodeText: View {
    let segments: [MessageCodeBlocks.Segment]
    let isOwn: Bool
    let textColor: Color
    let tint: Color
    /// Поиск в переписке: найденное подсвечивается и в коде.
    let highlight: String?
    /// Невидимая подпись времени в конце последнего абзаца — время встаёт в его строку.
    /// `nil`, если текст кончается кодом: тогда время уходит на свою строку.
    let metaPlaceholder: Text?
    let onCopy: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            ForEach(Array(segments.enumerated()), id: \.offset) { index, segment in
                switch segment {
                case .text(let text):
                    paragraph(text, isLast: index == segments.count - 1)
                case .code(let language, let code):
                    MessageCodeBlockView(
                        language: language,
                        code: highlighted(code, rich: false),
                        plain: code,
                        isOwn: isOwn,
                        textColor: textColor,
                        onCopy: onCopy
                    )
                }
            }
        }
    }

    private func paragraph(_ text: String, isLast: Bool) -> some View {
        let body = Text(highlighted(text, rich: true)).font(Typography.body)
        let line = isLast ? metaPlaceholder.map { body + $0 } ?? body : body
        return line
            .foregroundStyle(textColor)
            .tint(tint)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel(Text(text))
    }

    private func highlighted(_ text: String, rich: Bool) -> AttributedString {
        var result = rich ? RichText.attributed(text) : AttributedString(text)
        if let highlight {
            SearchHighlight.apply(highlight, to: &result, background: isOwn ? SearchHighlight.outgoing : SearchHighlight.incoming)
        }
        return result
    }
}

/// Плашка кода: полоска слева, язык и «скопировать» сверху, код моноширинным шрифтом.
struct MessageCodeBlockView: View {
    let language: String?
    let code: AttributedString
    let plain: String
    let isOwn: Bool
    let textColor: Color
    let onCopy: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(spacing: Spacing.sm) {
                if let language {
                    Text(verbatim: language)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(accent)
                        .lineLimit(1)
                }
                Spacer(minLength: Spacing.md)
                Button {
                    onCopy(plain)
                } label: {
                    Image(systemName: "doc.on.doc")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(accent)
                        .frame(width: ControlHeight.sm, height: ControlHeight.sm, alignment: .trailing)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .bubbleControl()
                .accessibilityLabel(Text(String(localized: "chats.code.copy", defaultValue: "Скопировать код")))
            }
            // Строка шапки ниже кнопки: код подтягивается под неё, а не на высоту
            // круга касания.
            .frame(height: Spacing.lg)

            Text(code)
                .font(.system(.subheadline, design: .monospaced))
                .foregroundStyle(textColor)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.leading, Spacing.md)
        .padding(.trailing, Spacing.sm)
        .padding(.vertical, Spacing.sm)
        .background(accent.opacity(0.12), in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
        .overlay(alignment: .leading) {
            UnevenRoundedRectangle(topLeadingRadius: Radius.md, bottomLeadingRadius: Radius.md, style: .continuous)
                .fill(accent)
                .frame(width: 3)
        }
        .accessibilityElement(children: .contain)
    }

    /// На своём синем пузыре — белый, на чужом — фирменный синий, как у цитаты ответа.
    private var accent: Color {
        isOwn ? Palette.primaryForeground : Palette.primary
    }
}
