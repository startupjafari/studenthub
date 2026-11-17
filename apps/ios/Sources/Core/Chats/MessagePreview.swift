import Foundation

/// Однострочное превью текста сообщения — одна функция для списка чатов, панелей
/// ответа и правки, закрепа (IOS_RULES 7.7.1). Раньше список отдавал `lastContent` как
/// есть, и во второй строке были видны `**`, `` ` `` и ```` ``` ````.
///
/// Разметку снимают те же разборщики, что рисуют пузырь (7.6.2): блоки кода —
/// `MessageCodeBlocks`, цитаты и списки — `MessageTextBlocks`, строчный Markdown —
/// `RichText`. Все кешируют разбор и очищаются при выходе из аккаунта, своего кеша здесь нет.
///
/// Спойлер `||…||` (PROJECT.md §3.6) в превью не читается: вместо текста — знаки Брайля
/// той же длины (`ChatMarkup.placeholder`), как в Telegram и на вебе.
enum MessagePreview {
    /// Сколько графем показывать: строка всё равно обрезается шириной, длиннее — лишняя
    /// работа (7.7.2).
    static let maxLength = 200
    /// Сколько текста вообще читать ради одной строки: длинное не разбираем целиком.
    static let readLimit = 4096

    static func text(_ content: String) -> String {
        let source = content.utf16.count > readLimit ? String(content.prefix(readLimit)) : content
        let code = String(localized: "chats.preview.code", defaultValue: "Код")
        return clip(oneLine(render(source, code: { _ in code }, spoiler: ChatMarkup.placeholder(for:))))
    }

    /// Видимый текст сообщения — то, что нарисовано в пузыре, без разметки: его кладёт в
    /// буфер «Копировать» (IOS_RULES 7.7.8, как в Telegram). Блок кода — его кодом, цитата —
    /// без `>`, пункт списка — с маркером, как в пузыре; переводы строк сохраняются.
    /// Спойлер — своим текстом: копирование — явное действие, как в Telegram.
    static func visibleText(_ content: String) -> String {
        render(content, code: { $0 }, spoiler: { $0 })
    }

    /// Что VoiceOver читает о сообщении целиком (сводка пузыря в режиме выбора): текст без
    /// разметки, скрытый спойлер — словами «скрытый текст».
    static func spokenText(_ content: String) -> String {
        let code = String(localized: "chats.preview.code", defaultValue: "Код")
        return render(content, code: { _ in code }, spoiler: { _ in ChatMarkup.spokenPlaceholder })
    }

    /// Текст без разметки; блок кода — тем, что вернёт `code`, спойлер — `spoiler`.
    private static func render(
        _ source: String,
        code: (String) -> String,
        spoiler: (String) -> String
    ) -> String {
        guard let segments = MessageCodeBlocks.segments(ifAny: source) else {
            return blocks(source, spoiler: spoiler)
        }
        return segments.map { segment in
            switch segment {
            case .text(let text): blocks(text, spoiler: spoiler)
            case .code(_, let body): code(body)
            }
        }
        .joined(separator: "\n")
    }

    /// Цитаты и списки — тем же разбором, что рисует их в пузыре (`MessageTextBlocks`).
    private static func blocks(_ text: String, spoiler: (String) -> String) -> String {
        guard let blocks = MessageTextBlocks.blocks(ifAny: text) else { return inline(text, spoiler: spoiler) }
        return blocks.map { block in
            switch block {
            case .text(let text), .quote(let text):
                inline(text, spoiler: spoiler)
            case .list(let items):
                items.map { "\($0.marker) " + inline($0.text, spoiler: spoiler) }.joined(separator: "\n")
            }
        }
        .joined(separator: "\n")
    }

    /// Строчная разметка — тем же разбором, что в пузыре (с маркерами чата).
    private static func inline(_ text: String, spoiler: (String) -> String) -> String {
        guard needsParsing(text) else { return text }
        return ChatMarkup.text(of: RichText.attributed(text, chat: true), spoiler: spoiler)
    }

    /// Предфильтр без разбора: может отправить в разбор лишнее, но не пропустит
    /// разметку — без этих знаков Markdown строку не меняет (`+` и `|` — маркеры чата).
    private static func needsParsing(_ text: String) -> Bool {
        text.contains { "*_`~[\\<&+|".contains($0) }
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
