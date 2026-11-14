import SwiftUI
import UIKit

/// Поле текста сообщения на `UITextView`.
///
/// Раньше было SwiftUI `TextField(axis: .vertical)`: оно не отдаёт выделение и меню
/// над ним, а форматирование (`ComposerFormat`), вставка картинок, отмена и повтор в
/// полноэкранном редакторе без них не сделать. Поведение прежнего поля сохранено:
/// высота растёт от одной строки до `maxLines`, дальше текст прокручивается; Return —
/// перенос строки; шрифт — системный body с Dynamic Type; фокус — через `isFocused`.
///
/// Текст в базе и на сервере — по-прежнему простая строка `draft`: форматирование —
/// разметка Markdown внутри неё.
struct ComposerTextView: UIViewRepresentable {
    @Binding var text: String
    @Binding var isFocused: Bool
    let controller: ComposerTextController
    /// Больше строк — прокрутка внутри поля. `nil` — поле занимает всё отведённое место
    /// (полноэкранный редактор).
    var maxLines: Int? = 6
    /// Во время записи голосового текст и курсор гаснут, клавиатура остаётся.
    var isMuted = false
    var accessibilityID = "chat.composer"
    var accessibilityLabel = ""
    /// «Вставить» с картинками в буфере: открыть лист отправки вложений.
    var onPasteImages: (([UIImage]) -> Void)?

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> ComposerUITextView {
        let view = ComposerUITextView()
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.font = UIFont.preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        // Ширину задаёт панель, а не длина строки: без этого длинная строка без пробелов
        // раздвигала бы поле за экран.
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.setContentHuggingPriority(.defaultLow, for: .horizontal)
        view.isScrollEnabled = maxLines == nil
        // Касание строки состояния листает ленту чата, а не поле: при двух «к началу»
        // система не листает ни одно.
        view.scrollsToTop = false
        view.alwaysBounceVertical = maxLines == nil
        view.keyboardDismissMode = maxLines == nil ? .interactive : .none
        view.text = text
        view.accessibilityIdentifier = accessibilityID
        view.accessibilityLabel = accessibilityLabel
        controller.attach(view, onChange: { [weak coordinator = context.coordinator] in
            coordinator?.pushText()
        })
        context.coordinator.view = view
        return view
    }

    func updateUIView(_ view: ComposerUITextView, context: Context) {
        context.coordinator.parent = self
        view.onPasteImages = onPasteImages
        view.onWidthChange = { [weak controller] in controller?.measure() }
        view.onFormatMenu = { [weak controller] format in controller?.apply(format) }
        view.textColor = isMuted ? .clear : UIColor(Palette.foreground)
        view.tintColor = isMuted ? .clear : UIColor(Palette.primary)
        view.accessibilityLabel = accessibilityLabel
        view.wantsFocus = isFocused

        // Текст сменили снаружи (отправка очистила поле, правка, черновик из базы,
        // emoji с панели). Пока идёт набор с подбором (марк. текст), не перебиваем.
        if view.text != text, view.markedTextRange == nil {
            view.text = text
            // Отмена после подмены текста целиком указывала бы на чужие диапазоны —
            // UIKit на этом падает.
            view.undoManager?.removeAllActions()
            // Состояние кнопок — после прохода обновления SwiftUI, не посреди него.
            DispatchQueue.main.async {
                controller.refresh()
                controller.measure()
            }
        }

        // Фокус — на следующем витке: смена первого ответчика посреди обновления SwiftUI
        // перестраивает клавиатуру в середине прохода раскладки.
        if isFocused, !view.isFirstResponder {
            DispatchQueue.main.async {
                guard view.window != nil, !view.isFirstResponder, context.coordinator.parent.isFocused else { return }
                view.becomeFirstResponder()
            }
        } else if !isFocused, view.isFirstResponder {
            DispatchQueue.main.async {
                guard view.isFirstResponder, !context.coordinator.parent.isFocused else { return }
                view.resignFirstResponder()
            }
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView view: ComposerUITextView, context: Context) -> CGSize? {
        // Пробы раскладки без ширины — по собственному размеру поля (его сжатие
        // разрешено низким приоритетом), окончательная ширина придёт следом.
        guard let width = proposal.width, width.isFinite else { return nil }
        let lineHeight = (view.font ?? UIFont.preferredFont(forTextStyle: .body)).lineHeight
        guard width > 0 else { return CGSize(width: 0, height: ceil(lineHeight)) }
        guard let maxLines else {
            return CGSize(width: width, height: proposal.height.flatMap { $0.isFinite ? $0 : nil } ?? 200)
        }
        let fitting = view.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
        let limit = ceil(lineHeight * CGFloat(maxLines))
        let scrolls = fitting > limit + 1
        if view.isScrollEnabled != scrolls {
            // Переключение прокрутки сбрасывает смещение — возвращаем курсор в кадр.
            DispatchQueue.main.async {
                view.isScrollEnabled = scrolls
                if scrolls { view.scrollRangeToVisible(view.selectedRange) }
            }
        }
        return CGSize(width: width, height: ceil(min(max(fitting, lineHeight), limit)))
    }

    static func dismantleUIView(_ view: ComposerUITextView, coordinator: Coordinator) {
        coordinator.parent.controller.detach(view)
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: ComposerTextView
        weak var view: ComposerUITextView?

        init(_ parent: ComposerTextView) {
            self.parent = parent
        }

        /// Текст поля — в черновик модели.
        func pushText() {
            guard let view else { return }
            if parent.text != view.text { parent.text = view.text }
            // Высоту поля SwiftUI спрашивает заново (`sizeThatFits`).
            view.invalidateIntrinsicContentSize()
            parent.controller.refresh()
            parent.controller.measure()
        }

        func textViewDidChange(_ textView: UITextView) {
            pushText()
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            if !parent.isFocused { parent.isFocused = true }
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            if parent.isFocused { parent.isFocused = false }
        }

        /// Меню над выделением: системные пункты и «Форматирование», как в Telegram.
        func textView(
            _ textView: UITextView,
            editMenuForTextIn range: NSRange,
            suggestedActions: [UIMenuElement]
        ) -> UIMenu? {
            guard range.length > 0, let view = textView as? ComposerUITextView else {
                return UIMenu(children: suggestedActions)
            }
            return UIMenu(children: suggestedActions + [view.formatMenu()])
        }
    }
}

/// `UITextView` поля ввода: вставка картинок и подменю форматирования.
final class ComposerUITextView: UITextView {
    var onPasteImages: (([UIImage]) -> Void)?
    var onFormatMenu: ((ComposerFormat) -> Void)?
    /// Ширина поля сменилась — число строк пересчитывается.
    var onWidthChange: (() -> Void)?
    private var lastWidth: CGFloat = 0
    /// Фокус попросили, когда поля ещё не было в окне (редактор только показывается):
    /// клавиатура поднимется, как только оно туда попадёт.
    var wantsFocus = false

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil, wantsFocus, !isFirstResponder else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self, self.window != nil, self.wantsFocus, !self.isFirstResponder else { return }
            self.becomeFirstResponder()
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.width != lastWidth else { return }
        lastWidth = bounds.width
        let callback = onWidthChange
        DispatchQueue.main.async { callback?() }
    }

    /// «Вставить» видно и тогда, когда в буфере только картинка: обычное поле его прячет.
    /// `hasImages` не читает сам буфер — системного вопроса о вставке нет.
    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(paste(_:)), onPasteImages != nil, UIPasteboard.general.hasImages {
            return true
        }
        return super.canPerformAction(action, withSender: sender)
    }

    /// Картинки из буфера — в лист отправки вложений (как в Telegram), текст — в поле как
    /// обычно. Чтение буфера по «Вставить» человек начал сам — вопроса о вставке нет.
    override func paste(_ sender: Any?) {
        let board = UIPasteboard.general
        if let onPasteImages, board.hasImages, let images = board.images, !images.isEmpty {
            onPasteImages(images)
            return
        }
        super.paste(sender)
    }

    /// Подменю «Форматирование»: значки слева, как в меню Telegram.
    func formatMenu() -> UIMenu {
        let actions = ComposerFormat.allCases.map { format in
            UIAction(title: format.title, image: UIImage(systemName: format.symbol)) { [weak self] _ in
                self?.onFormatMenu?(format)
            }
        }
        return UIMenu(
            title: String(localized: "chats.format.menu", defaultValue: "Форматирование"),
            image: UIImage(systemName: "textformat"),
            children: actions
        )
    }
}

/// Управление полем снаружи: emoji в место курсора, форматирование, списки, отмена и
/// повтор. Одно на поле: у панели ввода своё, у полноэкранного редактора — своё.
@MainActor
@Observable
final class ComposerTextController {
    private(set) var canUndo = false
    private(set) var canRedo = false
    /// Сколько строк занимает текст при текущей ширине: с трёх в панели появляется
    /// кнопка полноэкранного редактора.
    private(set) var lineCount = 1

    @ObservationIgnored private weak var view: ComposerUITextView?
    @ObservationIgnored private var onChange: (() -> Void)?
    @ObservationIgnored private var observers: [NSObjectProtocol] = []

    func attach(_ view: ComposerUITextView, onChange: @escaping () -> Void) {
        self.view = view
        self.onChange = onChange
        guard observers.isEmpty else { return }
        // Набор попадает в отмену не сразу, а когда группа правок закрывается (конец
        // витка) — кнопки «отменить/повторить» сверяются по уведомлениям менеджера.
        let center = NotificationCenter.default
        for name in [Notification.Name.NSUndoManagerCheckpoint, .NSUndoManagerDidUndoChange, .NSUndoManagerDidRedoChange] {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] note in
                MainActor.assumeIsolated {
                    guard let self, let manager = self.view?.undoManager, note.object as AnyObject? === manager else { return }
                    self.refresh()
                }
            })
        }
    }

    func detach(_ view: ComposerUITextView) {
        guard self.view === view else { return }
        self.view = nil
        onChange = nil
        observers.forEach(NotificationCenter.default.removeObserver)
        observers = []
    }

    var hasView: Bool { view != nil }

    /// Вставить в место курсора (emoji с панели). Без поля — `false`: вставит вызывающий.
    @discardableResult
    func insert(_ string: String) -> Bool {
        guard let view else { return false }
        view.insertText(string)
        onChange?()
        return true
    }

    /// Стереть символ перед курсором (кнопка панели emoji).
    @discardableResult
    func deleteBackward() -> Bool {
        guard let view else { return false }
        view.deleteBackward()
        onChange?()
        return true
    }

    /// Разметить выделение. Ссылка сначала спрашивает адрес.
    func apply(_ format: ComposerFormat) {
        guard let view else { return }
        if format == .link {
            askLink { [weak self] url in self?.replaceSelection(with: format, url: url) }
            return
        }
        replaceSelection(with: format, url: nil)
    }

    func toggleList(_ style: ComposerList.Style) {
        guard let view else { return }
        let change = ComposerList.toggle(style, in: view.text, at: view.selectedRange.location)
        let caret = view.selectedRange
        replace(change.range, with: change.replacement)
        // Курсор остаётся на своём месте в строке, сдвинувшись на длину маркера.
        let shift = change.replacement.utf16.count - change.range.length
        let location = max(change.range.location + change.replacement.utf16.count, caret.location + shift)
        view.selectedRange = NSRange(location: min(location, (view.text as NSString).length), length: 0)
        onChange?()
    }

    func undo() {
        view?.undoManager?.undo()
        onChange?()
    }

    func redo() {
        view?.undoManager?.redo()
        onChange?()
    }

    /// Свериться с полем: доступность отмены и повтора.
    func refresh() {
        let manager = view?.undoManager
        let undo = manager?.canUndo ?? false
        let redo = manager?.canRedo ?? false
        if canUndo != undo { canUndo = undo }
        if canRedo != redo { canRedo = redo }
    }

    /// Пересчитать число строк при текущей ширине поля.
    func measure() {
        guard let view, view.bounds.width > 0, let font = view.font else { return }
        let height = view.sizeThatFits(CGSize(width: view.bounds.width, height: .greatestFiniteMagnitude)).height
        let lines = max(1, Int((height / font.lineHeight).rounded()))
        if lineCount != lines { lineCount = lines }
    }

    private func replaceSelection(with format: ComposerFormat, url: String?) {
        guard let view else { return }
        let range = view.selectedRange
        let selected = (view.text as NSString).substring(with: range)
        let result = format.apply(to: selected, url: url)
        replace(range, with: result.text)
        view.selectedRange = NSRange(
            location: range.location + result.selection.location,
            length: result.selection.length
        )
        onChange?()
    }

    /// Замена через `UITextInput`: она попадает в отмену поля, в отличие от `text =`.
    private func replace(_ range: NSRange, with string: String) {
        guard let view,
            let start = view.position(from: view.beginningOfDocument, offset: range.location),
            let end = view.position(from: start, offset: range.length),
            let textRange = view.textRange(from: start, to: end)
        else { return }
        view.replace(textRange, withText: string)
    }

    /// Окно с адресом ссылки — системное, поверх того, что сейчас на экране.
    private func askLink(_ completion: @escaping (String) -> Void) {
        guard let view, let presenter = view.window?.rootViewController?.topPresented else { return }
        let alert = UIAlertController(
            title: String(localized: "chats.format.linkTitle", defaultValue: "Ссылка"),
            message: nil,
            preferredStyle: .alert
        )
        alert.addTextField { field in
            field.placeholder = "https://"
            field.keyboardType = .URL
            field.autocapitalizationType = .none
            field.autocorrectionType = .no
            field.text = "https://"
        }
        alert.addAction(UIAlertAction(title: String(localized: "common.cancel", defaultValue: "Отмена"), style: .cancel))
        alert.addAction(UIAlertAction(title: String(localized: "common.done", defaultValue: "Готово"), style: .default) { _ in
            let raw = alert.textFields?.first?.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !raw.isEmpty, raw != "https://" else { return }
            completion(raw.contains("://") || raw.hasPrefix("mailto:") ? raw : "https://" + raw)
        })
        presenter.present(alert, animated: true)
    }
}

private extension UIViewController {
    /// Самый верхний показанный контроллер: окно ссылки встаёт поверх листа и редактора.
    var topPresented: UIViewController {
        var top = self
        while let next = top.presentedViewController, !next.isBeingDismissed { top = next }
        return top
    }
}
