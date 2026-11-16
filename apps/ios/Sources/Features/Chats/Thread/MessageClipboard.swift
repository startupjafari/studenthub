import UIKit
import UniformTypeIdentifiers

/// «Копировать» сообщение (IOS_RULES 7.7.8, решение как в Telegram): в буфер — видимый
/// текст без разметки, его и вставят заметки, почта и другие приложения. Исходный Markdown
/// едет рядом своим типом: наше поле ввода (`ComposerUITextView.paste`) вставляет его, и
/// пересказ сообщения с форматированием внутри приложения ничего не теряет.
///
/// Видимый текст строит `MessagePreview.visibleText` — тот же разбор, что рисует пузырь.
enum MessageClipboard {
    /// Свой тип в буфере: исходный Markdown сообщения. Другие приложения его не знают и
    /// берут простой текст.
    static let markdownType = "kz.studenthub.message-markdown"

    /// Скопировать текст сообщения.
    static func copy(_ content: String, to board: UIPasteboard = .general) {
        copy(markdown: content, visible: MessagePreview.visibleText(content), to: board)
    }

    /// Скопировать уже собранный видимый текст и его исходник (выбор нескольких).
    static func copy(markdown: String, visible: String, to board: UIPasteboard = .general) {
        board.setItems([item(markdown: markdown, visible: visible)])
    }

    /// Один элемент буфера: простой текст и — если разметка была — исходник своим типом.
    /// Без разметки свой тип не нужен: вставка простого текста даст то же самое.
    static func item(markdown: String, visible: String) -> [String: Any] {
        var item: [String: Any] = [UTType.utf8PlainText.identifier: visible]
        if markdown != visible {
            item[markdownType] = Data(markdown.utf8)
        }
        return item
    }

    /// Исходный Markdown, если в буфере лежит скопированное из нашего пузыря. Буфер
    /// заменяется целиком при любом новом копировании, так что устаревшим он не бывает.
    static func markdown(in board: UIPasteboard = .general) -> String? {
        guard board.contains(pasteboardTypes: [markdownType]),
            let data = board.data(forPasteboardType: markdownType)
        else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
