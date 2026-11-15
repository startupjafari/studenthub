import UIKit

/// Помощники панели ввода, привязанные к экрану чата: запись голоса/кружков и панель эмодзи.
@MainActor
final class InputExtensions: NSObject {
    let recording: RecordingController
    private(set) lazy var emojiKeyboard: EmojiKeyboardView = {
        let view = EmojiKeyboardView()
        view.onInsert = { [weak self] emoji in self?.insertEmoji(emoji) }
        view.onBackspace = { [weak self] in self?.panel?.textView.deleteBackward() }
        return view
    }()
    private weak var panel: InputPanelView?
    private var endEditingObserver: NSObjectProtocol?

    init(chat: ChatViewController) {
        recording = RecordingController(chat: chat)
        panel = chat.inputPanel
        super.init()
    }

    func install() {
        recording.install()
        guard let panel else { return }
        panel.emojiButton.addAction(UIAction { [weak self] _ in self?.toggleEmojiKeyboard() }, for: .touchUpInside)
        // Поле ушло из фокуса — в следующий раз снова системная клавиатура.
        endEditingObserver = NotificationCenter.default.addObserver(
            forName: UITextView.textDidEndEditingNotification, object: panel.textView, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.resetToSystemKeyboard() }
        }
    }

    /// Эмодзи ↔ клавиатура: подменяется `inputView` поля, поэтому панель едет вместе с
    /// `keyboardLayoutGuide` — лента и поле двигаются так же, как с системной клавиатурой.
    func toggleEmojiKeyboard() {
        guard let panel else { return }
        let textView = panel.textView
        let showEmoji = textView.inputView == nil
        if showEmoji {
            emojiKeyboard.reloadSections()
            textView.inputView = emojiKeyboard
        } else {
            textView.inputView = nil
        }
        updateEmojiButton(showingEmoji: showEmoji)
        if textView.isFirstResponder {
            textView.reloadInputViews()
        } else {
            textView.becomeFirstResponder()
        }
        Haptics.selection()
    }

    private func resetToSystemKeyboard() {
        guard let panel, panel.textView.inputView != nil else { return }
        panel.textView.inputView = nil
        updateEmojiButton(showingEmoji: false)
    }

    private func updateEmojiButton(showingEmoji: Bool) {
        guard let button = panel?.emojiButton else { return }
        let name = showingEmoji ? "keyboard" : "face.smiling"
        button.setImage(UIImage(systemName: name, withConfiguration: UIImage.SymbolConfiguration(pointSize: 20)), for: .normal)
        button.accessibilityLabel = showingEmoji ? "Клавиатура" : "Эмодзи"
    }

    /// Вставка в позицию курсора — через `insertText`, то есть тем же путём, что и ввод
    /// с клавиатуры (отмена, автоподстановка, `textViewDidChange`).
    private func insertEmoji(_ emoji: String) {
        guard let panel else { return }
        let textView = panel.textView
        textView.insertText(emoji)
        // `insertText` из кода не всегда доходит до делегата — дёргаем явно (повтор безвреден).
        panel.textViewDidChange(textView)
    }
}

nonisolated(unsafe) private var inputExtensionsKey: UInt8 = 0

extension ChatViewController {
    /// Помощники ввода живут столько же, сколько экран.
    var inputExtensions: InputExtensions {
        if let existing = objc_getAssociatedObject(self, &inputExtensionsKey) as? InputExtensions { return existing }
        let created = InputExtensions(chat: self)
        objc_setAssociatedObject(self, &inputExtensionsKey, created, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        return created
    }

    func installInputExtensions() {
        inputExtensions.install()
    }

    /// Лист вложений (средняя/большая высота, как у Telegram).
    func presentAttachmentMenu() {
        guard !cellContext.isSelecting else { return }
        inputExtensions.recording.cancel()
        let sheet = AttachmentSheetController(chat: self)
        sheet.modalPresentationStyle = .pageSheet
        if let controller = sheet.sheetPresentationController {
            controller.detents = [.medium(), .large()]
            controller.prefersGrabberVisible = true
            controller.preferredCornerRadius = 16
        }
        present(sheet, animated: true)
    }
}
