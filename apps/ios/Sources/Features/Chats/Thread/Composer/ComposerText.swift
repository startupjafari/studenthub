import SwiftUI

/// Что из поля ввода уйдёт на сервер — одна функция для кнопки «Отправить», самой
/// отправки, правки, счётчика длины и черновика (IOS_RULES 7.1.6, 7.1.7). Пока проверка
/// была скопирована в три места, клиент считал «можно отправить» не так, как сервер:
/// невидимые символы не снимал, длину не проверял, и длинный текст отклонялся уже после
/// нажатия.
enum OutgoingText {
    /// Лимит сервера: `messageText(max = 4000)` и `SaveDraftSchema` в
    /// `packages/shared-schemas/src/chats.ts`. Меряет zod — то есть JS `length`, единицы UTF-16.
    static let limit = 4000
    /// Счётчик появляется, когда до лимита осталось меньше этого, — как в Telegram:
    /// раньше он только отвлекает.
    static let counterThreshold = 100

    /// Невидимые символы, которые сервер вырезает до проверки (`INVISIBLE_RE`).
    private static func isInvisible(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x200B...0x200D, 0x2060, 0xFEFF: true
        default: false
        }
    }

    /// Текст, каким его сохранит сервер: без невидимых символов и пробелов по краям.
    static func normalized(_ raw: String) -> String {
        var scalars = String.UnicodeScalarView()
        scalars.append(contentsOf: raw.unicodeScalars.lazy.filter { !isInvisible($0) })
        return String(scalars).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Длина того, что уйдёт, в единицах UTF-16 — так же меряет сервер.
    static func length(_ raw: String) -> Int {
        normalized(raw).utf16.count
    }

    /// Сколько ещё можно дописать; отрицательное — на столько текст длиннее лимита.
    static func remaining(_ raw: String) -> Int {
        limit - length(raw)
    }

    /// Отправлять нечего: после очистки пусто. Микрофон вместо «Отправить».
    static func isBlank(_ raw: String) -> Bool {
        normalized(raw).isEmpty
    }

    /// Текст к отправке или `nil`, если отправлять нечего или сервер его не примет.
    /// Длинный текст молча не обрезается: человек видит счётчик и решает сам.
    static func sendable(_ raw: String) -> String? {
        let text = normalized(raw)
        guard !text.isEmpty, text.utf16.count <= limit else { return nil }
        return text
    }

    /// Число для счётчика у поля; `nil`, пока до лимита далеко.
    static func counter(_ raw: String) -> Int? {
        let left = remaining(raw)
        return left < counterThreshold ? left : nil
    }

    /// Примет ли сервер черновик. `SaveDraftSchema` меряет текст как есть, без очистки:
    /// черновик хранит набранное дословно, вместе с пробелами по краям.
    static func draftFits(_ raw: String) -> Bool {
        raw.utf16.count <= limit
    }
}

/// Поле ввода чата: черновик нового сообщения и текст правки — разные значения, как
/// `composeInputState` и `editMessage.inputState` у Telegram (IOS_RULES 9.8.6). Правка
/// своего сообщения не трогает неотправленный черновик, а после неё он возвращается в поле.
struct ComposerInput: Equatable {
    /// Неотправленный черновик чата — его пишут в базу и на сервер.
    var draft = ""
    /// Текст правки своего сообщения; `nil` — ничего не правим.
    private(set) var editText: String?

    var isEditing: Bool { editText != nil }

    /// То, что сейчас в поле: при правке — её текст, иначе черновик.
    var text: String {
        get { editText ?? draft }
        set {
            if editText != nil {
                editText = newValue
            } else {
                draft = newValue
            }
        }
    }

    /// Черновик к сохранению; при правке — `nil`: её текст черновиком не становится.
    var draftToPersist: String? { isEditing ? nil : draft }

    mutating func beginEdit(_ content: String) {
        editText = content
    }

    /// Правку сохранили или отменили — в поле снова черновик.
    mutating func endEdit() {
        editText = nil
    }
}

/// Сколько символов осталось — у края поля, когда до лимита меньше сотни; сверх лимита
/// число отрицательное и красное, «Отправить» при этом неактивна (IOS_RULES 7.1.7).
struct ComposerLengthCounter: View {
    let text: String

    var body: some View {
        if let left = OutgoingText.counter(text) {
            Text(verbatim: "\(left)")
                .font(Typography.tabular(Typography.meta))
                .foregroundStyle(left < 0 ? Palette.destructive : Palette.mutedForeground)
                .lineLimit(1)
                .fixedSize()
                .allowsHitTesting(false)
                .accessibilityLabel(Text(left < 0
                    ? String(localized: "chats.composer.overLimit", defaultValue: "Лимит превышен на \(-left)")
                    : String(localized: "chats.composer.remaining", defaultValue: "Осталось символов: \(left)")))
        }
    }
}
