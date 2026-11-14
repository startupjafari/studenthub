import SwiftUI

/// Цитаты и списки в тексте сообщения — тот же набор, что даёт поле ввода (IOS_RULES 7.6.1):
/// строка `> текст` — цитата, `- пункт` / `• пункт` / `1. пункт` — список.
///
/// Разбор — здесь, а не в `RichText`: тот общий с лентой постов, и менять его разбор
/// значило бы поменять вид постов. Блоки кода делит `MessageCodeBlocks` раньше, сюда
/// приходит только текст без них. Маркер списка узнаёт `ComposerList.marker`, тот же, что
/// ставит и снимает его в поле ввода (7.6.2): что поле считает пунктом, то пузырь и рисует.
///
/// Правила:
/// - подряд идущие строки `>` — одна цитата; строка из одного `>` — пустая строка внутри
///   неё (`> p1\n>\n> p2` — одна цитата, как у Telegram); знаков `>` в начале может быть
///   несколько — уровень один, вложенных цитат нет;
/// - цитата из одних пробелов остаётся текстом как есть — рисовать пустую плашку незачем;
/// - подряд идущие пункты — один список, пустая строка его заканчивает;
/// - перевод строки вокруг цитаты и списка не рисуется: блок и так стоит своей строкой;
///   внутри абзаца переводы и пустые строки сохраняются, как в обычном пузыре;
/// - экранированное `\>` — текст: строчный разбор покажет его знаком `>`.
enum MessageTextBlocks {
    enum Block: Hashable {
        case text(String)
        case quote(String)
        case list([ListItem])

        var isText: Bool {
            if case .text = self { return true }
            return false
        }

        var isQuote: Bool {
            if case .quote = self { return true }
            return false
        }
    }

    struct ListItem: Hashable {
        /// Что рисуется перед пунктом: «•» или номер с точкой («12.»).
        let marker: String
        let text: String
    }

    /// Блоки текста, если в нём есть цитата или список; `nil` — обычный текст, который
    /// пузырь рисует прежним путём одной строкой `Text`. Разбор — один раз на текст.
    static func blocks(ifAny source: String) -> [Block]? {
        guard mayHaveBlocks(source) else { return nil }
        let key = source as NSString
        if let known = cache.object(forKey: key) { return known.value }
        let parsed = parse(source)
        let result = parsed.contains { !$0.isText } ? parsed : nil
        cache.setObject(Parsed(result), forKey: key, cost: source.utf16.count)
        return result
    }

    /// Текст без цитаты в конце может нести время в последней строке; цитата — нет:
    /// время легло бы на её подложку.
    static func carriesMeta(_ source: String) -> Bool {
        blocks(ifAny: source)?.last?.isQuote != true
    }

    /// Предфильтр без разбора: может отправить в разбор лишнее (строка с цифры или
    /// дефиса), но не пропустит блок — тот начинается строкой с `>`, `-`, `•` или цифры.
    static func mayHaveBlocks(_ source: String) -> Bool {
        var atLineStart = true
        for scalar in source.unicodeScalars {
            if atLineStart, scalar == ">" || scalar == "-" || scalar == "•" || scalar.properties.numericType != nil {
                return true
            }
            // Те же разрывы строки, что приводит к `\n` `OutgoingText.normalizingLineBreaks`.
            atLineStart = [0x0A, 0x0D, 0x85, 0x2028, 0x2029].contains(scalar.value)
        }
        return false
    }

    /// Чистый разбор без кеша — его и проверяют тесты.
    static func parse(_ source: String) -> [Block] {
        var blocks: [Block] = []
        var paragraph: [String] = []
        var quote: [String] = []
        var quoteRaw: [String] = []
        var items: [ListItem] = []

        func flushParagraph() {
            let text = paragraph.joined(separator: "\n").trimmingCharacters(in: .newlines)
            if !text.trimmingCharacters(in: .whitespaces).isEmpty { blocks.append(.text(text)) }
            paragraph = []
        }
        func flushQuote() {
            defer { quote = []; quoteRaw = [] }
            guard !quote.isEmpty else { return }
            let text = quote.joined(separator: "\n").trimmingCharacters(in: .newlines)
            if text.trimmingCharacters(in: .whitespaces).isEmpty {
                // Пустая цитата — строки как есть, частью абзаца.
                paragraph += quoteRaw
            } else {
                flushParagraph()
                blocks.append(.quote(text))
            }
        }
        func flushList() {
            if !items.isEmpty { blocks.append(.list(items)) }
            items = []
        }

        for line in OutgoingText.normalizingLineBreaks(source).components(separatedBy: "\n") {
            if let body = quoteBody(line) {
                flushList()
                quote.append(String(body))
                quoteRaw.append(line)
            } else if let marker = ComposerList.marker(of: line) {
                flushQuote()
                flushParagraph()
                let number = marker.trimmingCharacters(in: .whitespaces)
                items.append(ListItem(
                    marker: number.first?.isNumber == true ? number : "•",
                    text: String(line.dropFirst(marker.count))
                ))
            } else {
                flushQuote()
                flushList()
                paragraph.append(line)
            }
        }
        flushQuote()
        flushList()
        flushParagraph()
        return blocks
    }

    /// Текст строки цитаты без знаков `>` и одного пробела за ними; `nil` — не цитата.
    /// Знаки в начале снимает и поле ввода (`ComposerFormat.quote`) — там же правило
    /// «`>` без пробела — тоже цитата» (IOS_RULES 7.4.6).
    static func quoteBody(_ line: String) -> Substring? {
        guard line.hasPrefix(">") else { return nil }
        let body = line.drop { $0 == ">" }
        return body.hasPrefix(" ") ? body.dropFirst() : body
    }

    // MARK: Кеш

    private final class Parsed {
        let value: [Block]?
        init(_ value: [Block]?) { self.value = value }
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

// MARK: - Строчный вид текста в пузыре

/// Как строка сообщения выглядит в пузыре: строчная разметка `RichText`, недоверенные
/// ссылки и подсветка поиска. Одно место для обычного текста, абзацев между блоками кода,
/// цитат и пунктов списка.
struct BubbleTextStyle: Hashable {
    var isOwn = false
    /// Поиск в переписке: найденное подсвечивается.
    var highlight: String?
    /// Входящее в чате-запросе (IOS_RULES 10.4.12): ссылки и упоминания — простой текст.
    var plainLinks = false

    func attributed(_ text: String, rich: Bool = true) -> AttributedString {
        var result = rich ? RichText.attributed(text) : AttributedString(text)
        if plainLinks, rich {
            // Касание по ссылке ничего не откроет, а упоминание не выделится весом:
            // `RichText` задаёт шрифт только упоминаниям, жирный и курсив — намерением.
            result.link = nil
            result.font = nil
        }
        if let highlight {
            SearchHighlight.apply(highlight, to: &result, background: isOwn ? SearchHighlight.outgoing : SearchHighlight.incoming)
        }
        return result
    }
}

// MARK: - Вид

/// Текст сообщения с цитатами и списками: абзацы — как обычный текст пузыря, цитата —
/// плашкой с полоской слева и приглушённым текстом (как блок кода и цитата ответа),
/// пункт — маркером с висячим отступом.
///
/// Блоки ставит `ChatBubbleStack`: пузырь по ширине самого широкого блока, а цитата
/// растягивается на всю его ширину (`ChatStretches`), как превью ссылки. Высоты — от
/// `fixedSize` по вертикали, как у остального текста: лента меряет ячейку один раз.
struct MessageTextBlocksView: View {
    let blocks: [MessageTextBlocks.Block]
    let style: BubbleTextStyle
    let textColor: Color
    let tint: Color
    /// Невидимая подпись времени в конце последнего абзаца или пункта — время встаёт в
    /// его строку. Цитате в конце не передаётся (`MessageTextBlocks.carriesMeta`).
    let metaPlaceholder: Text?

    var body: some View {
        ChatBubbleStack(spacing: Spacing.xs) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
                blockView(block, isLast: index == blocks.count - 1)
            }
        }
        .font(Typography.body)
        .tint(tint)
    }

    @ViewBuilder
    private func blockView(_ block: MessageTextBlocks.Block, isLast: Bool) -> some View {
        switch block {
        case .text(let text):
            line(text, meta: isLast)
                .foregroundStyle(textColor)
        case .quote(let text):
            let attributed = style.attributed(text)
            Text(attributed)
                .foregroundStyle(textColor.opacity(0.8))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.leading, Spacing.md)
                .padding(.trailing, Spacing.sm)
                .padding(.vertical, Spacing.xs)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(accent.opacity(0.12), in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
                .overlay(alignment: .leading) {
                    UnevenRoundedRectangle(topLeadingRadius: Radius.md, bottomLeadingRadius: Radius.md, style: .continuous)
                        .fill(accent)
                        .frame(width: 3)
                }
                .accessibilityLabel(Text(String(attributed.characters)))
                .layoutValue(key: ChatStretches.self, value: true)
        case .list(let items):
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    HStack(alignment: .firstTextBaseline, spacing: Spacing.xs) {
                        Text(verbatim: item.marker)
                            .monospacedDigit()
                            .foregroundStyle(textColor.opacity(0.8))
                            .accessibilityHidden(true)
                        line(item.text, meta: isLast && index == items.count - 1)
                    }
                }
            }
            .foregroundStyle(textColor)
            .padding(.leading, Spacing.xs)
        }
    }

    /// Строка текста с невидимым временем в конце, если она последняя в пузыре.
    private func line(_ text: String, meta: Bool) -> some View {
        let attributed = style.attributed(text)
        let body = Text(attributed)
        let line = meta ? metaPlaceholder.map { body + $0 } ?? body : body
        return line
            .fixedSize(horizontal: false, vertical: true)
            // Невидимую копию времени VoiceOver прочитал бы второй раз.
            .accessibilityLabel(Text(String(attributed.characters)))
    }

    /// На своём синем пузыре — белый, на чужом — фирменный синий, как у блока кода.
    private var accent: Color {
        style.isOwn ? Palette.primaryForeground : Palette.primary
    }
}
