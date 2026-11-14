import UIKit

// ЗАГЛУШКА: полноценное меню Telegram (подъём пузыря, размытие, реакции) — отдельный шаг.
extension ChatViewController {
    func presentContextMenu(for cell: MessageCell, messageId: MessageID) {
        animatePress(cell, pressed: false)
        guard let message = store.message(messageId) else { return }
        let sheet = UIAlertController(title: nil, message: nil, preferredStyle: .actionSheet)
        sheet.addAction(UIAlertAction(title: "Ответить", style: .default) { [weak self] _ in self?.beginReply(to: messageId) })
        if message.hasCopyableText {
            sheet.addAction(UIAlertAction(title: "Копировать", style: .default) { [weak self] _ in self?.copyText([messageId]) })
        }
        sheet.addAction(UIAlertAction(title: "Удалить", style: .destructive) { [weak self] _ in self?.confirmDelete([messageId]) })
        sheet.addAction(UIAlertAction(title: "Отмена", style: .cancel))
        present(sheet, animated: true)
    }

    func presentForwardPicker(_ ids: [MessageID], completion: (() -> Void)? = nil) {
        completion?()
    }
}
