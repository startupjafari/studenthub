import Foundation

/// Однострочное превью текста сообщения — одна функция для списка чатов, панелей
/// ответа и правки, закрепа (IOS_RULES 7.7.1). Раньше список отдавал `lastContent` как
/// есть, и во второй строке были видны `**`, `` ` `` и ```` ``` ````.
///
/// Разметку снимают те же разборщики, что рисуют пузырь (7.6.2): блоки кода —
/// `MessageCodeBlocks`, цитаты и списки — `MessageTextBlocks`, строчный Markdown —
/// `RichText`. Все кешируют разбор и очищаются при выходе из аккаунта, своего кеша здесь нет.
enum MessagePreview {
    /// Сколько графем показывать: строка всё равно обрезается шириной, длиннее — лишняя
    /// работа (7.7.2).
    static let maxLength = 200
    /// Сколько текста вообще читать ради одной строки: длинное не разбираем целиком.
    static let readLimit = 4096

    static func text(_ content: String) -> String {
        let source = content.utf16.count > readLimit ? String(content.prefix(readLimit)) : content
        let code = String(localized: "chats.preview.code", defaultValue: "Код")
        return clip(oneLine(render(source, code: { _ in code })))
    }

    /// Видимый текст сообщения — то, что нарисовано в пузыре, без разметки: его кладёт в
    /// буфер «Копировать» (IOS_RULES 7.7.8, как в Telegram). Блок кода — его кодом, цитата —
    /// без `>`, пункт списка — с маркером, как в пузыре; переводы строк сохраняются.
    static func visibleText(_ content: String) -> String {
        render(content, code: { $0 })
    }

    /// Текст без разметки; блок кода — тем, что вернёт `code`.
    private static func render(_ source: String, code: (String) -> String) -> String {
        guard let segments = MessageCodeBlocks.segments(ifAny: source) else { return blocks(source) }
        return segments.map { segment in
            switch segment {
            case .text(let text): blocks(text)
            case .code(_, let body): code(body)
            }
        }
        .joined(separator: "\n")
    }

    /// Цитаты и списки — тем же разбором, что рисует их в пузыре (`MessageTextBlocks`).
    private static func blocks(_ text: String) -> String {
        guard let blocks = MessageTextBlocks.blocks(ifAny: text) else { return inline(text) }
        return blocks.map { block in
            switch block {
            case .text(let text), .quote(let text): inline(text)
            case .list(let items): items.map { "\($0.marker) " + inline($0.text) }.joined(separator: "\n")
            }
        }
        .joined(separator: "\n")
    }

    /// Строчная разметка — тем же разбором, что в пузыре.
    private static func inline(_ text: String) -> String {
        needsParsing(text) ? String(RichText.attributed(text).characters) : text
    }

    /// Предфильтр без разбора: может отправить в разбор лишнее, но не пропустит
    /// разметку — без этих знаков Markdown строку не меняет.
    private static func needsParsing(_ text: String) -> Bool {
        text.contains { "*_`~[\\<&".contains($0) }
    }

    /// Переводы строк и их отрезки — один пробел.
    private static func oneLine(_ text: String) -> String {
        let normalized = OutgoingText.normalizingLineBreaks(text)
        guard normalized.contains("\n") else { return normalized.trimmingCharacters(in: .whitespaces) }
        return normalized
            .components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    /// Обрезка по графемам, не по UTF-16: emoji не распадается на половинки.
    private static func clip(_ text: String) -> String {
        guard text.count > maxLength else { return text }
        return String(text.prefix(maxLength)).trimmingCharacters(in: .whitespaces) + "…"
    }
}
