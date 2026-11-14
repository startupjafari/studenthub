import Foundation

/// Однострочное превью текста сообщения — одна функция для списка чатов, панелей
/// ответа и правки, закрепа (IOS_RULES 7.7.1). Раньше список отдавал `lastContent` как
/// есть, и во второй строке были видны `**`, `` ` `` и ```` ``` ````.
///
/// Разметку снимают те же разборщики, что рисуют пузырь (7.6.2): блоки кода —
/// `MessageCodeBlocks`, строчный Markdown — `RichText`. Оба кешируют разбор и
/// очищаются при выходе из аккаунта, своего кеша здесь нет.
enum MessagePreview {
    /// Сколько графем показывать: строка всё равно обрезается шириной, длиннее — лишняя
    /// работа (7.7.2).
    static let maxLength = 200
    /// Сколько текста вообще читать ради одной строки: длинное не разбираем целиком.
    static let readLimit = 4096

    static func text(_ content: String) -> String {
        let source = content.utf16.count > readLimit ? String(content.prefix(readLimit)) : content
        let plain: String
        if let segments = MessageCodeBlocks.segments(ifAny: source) {
            plain = segments.map { segment in
                switch segment {
                case .text(let text): inline(text)
                case .code: String(localized: "chats.preview.code", defaultValue: "Код")
                }
            }
            .joined(separator: " ")
        } else {
            plain = inline(source)
        }
        return clip(oneLine(plain))
    }

    /// Строчная разметка — тем же разбором, что в пузыре; знак цитаты в начале строки
    /// пузырь не рисует как блок, и в превью он тоже не нужен.
    private static func inline(_ text: String) -> String {
        let rendered = needsParsing(text) ? String(RichText.attributed(text).characters) : text
        guard rendered.contains(">") else { return rendered }
        return rendered
            .components(separatedBy: "\n")
            .map { line in
                let body = line.drop { $0 == ">" }
                return body.count == line.count ? line : String(body.drop { $0 == " " })
            }
            .joined(separator: "\n")
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
