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
            coordinator?.pushIfStale()
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
        // Внешняя установка — вторая дверь шлюза (IOS_RULES 7.2.1, 7.2.2): переводы строк
        // черновика с сервера или правки приводятся к одному виду и здесь.
        let incoming = OutgoingText.normalizingLineBreaks(text)
        if view.text != incoming, view.markedTextRange == nil {
            // Смена выделения от `text =` приходит посреди обновления SwiftUI — контекст
            // курсора пересчитаем на следующем витке, ниже.
            context.coordinator.isSettingText = true
            view.text = incoming
            context.coordinator.isSettingText = false
            // Отмена после подмены текста целиком указывала бы на чужие диапазоны —
            // UIKit на этом падает.
            view.undoManager?.removeAllActions()
            // Состояние кнопок — после прохода обновления SwiftUI, не посреди него.
            DispatchQueue.main.async {
                controller.refresh()
                controller.measure()
                controller.updateContext()
                // Нормализация изменила строку — в модель уходит то, что в поле.
                if incoming != text { context.coordinator.pushIfStale() }
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
        /// Идёт внешняя установка текста из `updateUIView`.
        var isSettingText = false

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

        /// Правка кодом (emoji, форматирование, список, отмена): `UITextView` обычно сам
        /// присылает `textViewDidChange`, и второй проход `pushText` был бы лишним
        /// (IOS_RULES 7.3.5). Досылаем, только если поле и модель всё ещё расходятся.
        func pushIfStale() {
            guard let view, parent.text != view.text else { return }
            pushText()
        }

        func textViewDidChange(_ textView: UITextView) {
            pushText()
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            guard !isSettingText else { return }
            parent.controller.updateContext()
        }

        /// Единый шлюз ввода (IOS_RULES 7.2.1): его проходят набор, вставка, диктовка и
        /// перетаскивание. Здесь — нормализация переводов строк и снятие `U+FFFC` (7.2.2,
        /// 7.2.3), а не в `paste(_:)` и кнопках по отдельности.
        func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
            // Составление IME правит марк. текст — вмешательство сорвало бы подбор.
            guard textView.markedTextRange == nil else { return true }
            let clean = OutgoingText.normalizingLineBreaks(text)
            guard clean != text else { return true }
            // Очищенное вставляем сами одной правкой (она попадает в отмену); курсор —
            // за вставленным, по длине уже очищенной строки.
            parent.controller.replaceText(range, with: clean)
            return false
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
            let context = ComposerContext.at(range, in: textView.text)
            return UIMenu(children: suggestedActions + [view.formatMenu(context)])
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
    ///
    /// Скопированное из нашего же пузыря несёт исходный Markdown своим типом
    /// (`MessageClipboard`, IOS_RULES 7.7.8): в поле вставляется он, и форматирование не
    /// теряется. `insertText` идёт через тот же шлюз ввода, что набор (7.2.1).
    override func paste(_ sender: Any?) {
        let board = UIPasteboard.general
        if let onPasteImages, board.hasImages, let images = board.images, !images.isEmpty {
            onPasteImages(images)
            return
        }
        if let markdown = MessageClipboard.markdown(in: board) {
            insertText(markdown)
            return
        }
        super.paste(sender)
    }

    /// Подменю «Форматирование»: значки слева, как в меню Telegram. Внутри кода
    /// доступен только «Блок кода» (IOS_RULES 7.4.3).
    func formatMenu(_ context: ComposerContext) -> UIMenu {
        let actions = ComposerFormat.allCases.map { format in
            UIAction(
                title: format.title,
                image: UIImage(systemName: format.symbol),
                attributes: context.allows(format) ? [] : .disabled
            ) { [weak self] _ in
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
    /// Где выделение относительно кода и ссылок — от этого зависят пункты
    /// «Форматирования» и автокоррекция (IOS_RULES 7.4.3).
    private(set) var context = ComposerContext()

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
        onChange?()  // досылка только если `UITextView` не прислал `textViewDidChange`
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
        guard let view, ComposerContext.at(view.selectedRange, in: view.text).allows(format) else { return }
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

    /// Сверить признаки поля с местом курсора: внутри кода — без автокоррекции,
    /// проверки орфографии и «умных» кавычек и тире, они портят код (IOS_RULES 7.4.3).
    func updateContext() {
        guard let view, view.markedTextRange == nil else { return }
        let next = ComposerContext.at(view.selectedRange, in: view.text)
        if context != next { context = next }
        let code = next.inCode
        let autocorrection: UITextAutocorrectionType = code ? .no : .default
        guard view.autocorrectionType != autocorrection else { return }
        view.autocorrectionType = autocorrection
        view.spellCheckingType = code ? .no : .default
        view.smartQuotesType = code ? .no : .default
        view.smartDashesType = code ? .no : .default
        // Клавиатура кеширует эти признаки — без перезагрузки смена не дойдёт до неё.
        if view.isFirstResponder { view.reloadInputViews() }
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
        let text = view.text as NSString
        // Выделение — до границ составных символов: иначе половина суррогатной пары
        // или ZWJ-последовательности emoji окажется по ту сторону маркера (IOS_RULES 7.4.2).
        let range = view.selectedRange.length > 0
            ? text.rangeOfComposedCharacterSequences(for: view.selectedRange)
            : view.selectedRange
        guard ComposerContext.at(range, in: view.text).allows(format) else { return }
        let selected = text.substring(with: range)
        let result = format.apply(to: selected, url: url)
        replace(range, with: result.text)
        view.selectedRange = NSRange(
            location: range.location + result.selection.location,
            length: result.selection.length
        )
        onChange?()
    }

    /// Заменить отрезок из шлюза ввода (IOS_RULES 7.2.1) и поставить курсор за вставкой.
    func replaceText(_ range: NSRange, with string: String) {
        guard let view else { return }
        replace(range, with: string)
        let end = min(range.location + string.utf16.count, (view.text as NSString).length)
        view.selectedRange = NSRange(location: end, length: 0)
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
