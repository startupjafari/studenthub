import SwiftUI
import UIKit

/// Правка надписи поверх затемнённого холста.
///
/// Буквы рисует не `UITextView`, а тот же `StoryTextLayout`, что и холст с экспортом:
/// поле ввода прозрачное и даёт только курсор, выделение и клавиатуру. Поэтому подложка,
/// обводка и тень видны прямо во время набора и совпадают с итогом до пикселя.
/// Надпись стоит посередине между верхом холста и клавиатурой — клавиатура её не
/// закрывает, а сам снимок под ней не сжимается и не сдвигается.
final class StoryTextEditingView: UIView, UITextViewDelegate {
    var onChange: (StoryTextPayload) -> Void = { _ in }
    var onInputChange: (StoryTextInput) -> Void = { _ in }
    var onOpenColorPicker: () -> Void = {}

    private(set) var payload = StoryTextPayload(text: "")
    private(set) var input: StoryTextInput = .keyboard
    var canvasFrame: CGRect = .zero {
        didSet { if canvasFrame != oldValue { setNeedsLayout() } }
    }

    private let dimView = UIView()
    private let previewView = StoryTextPreviewView()
    let textView = StoryTextField()
    private let formatBar = StoryTextFormatBar()
    private lazy var emojiInput = EmojiKeyboardInputView { [weak self] emoji in self?.insertEmoji(emoji) }
    private var keyboardTop: CGFloat?

    override init(frame: CGRect) {
        super.init(frame: frame)
        dimView.backgroundColor = UIColor.black.withAlphaComponent(0.45)
        addSubview(dimView)
        addSubview(previewView)
        textView.delegate = self
        textView.backgroundColor = .clear
        textView.textContainer.lineFragmentPadding = 0
        textView.isScrollEnabled = false
        textView.autocorrectionType = .default
        textView.keyboardAppearance = .dark
        textView.accessibilityIdentifier = "story.text.input"
        addSubview(textView)
        textView.inputAccessoryView = formatBar
        formatBar.onAction = { [weak self] action in self?.handle(action) }

        let tapOutside = UITapGestureRecognizer(target: self, action: #selector(tappedOutside))
        dimView.addGestureRecognizer(tapOutside)

        NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillChange(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillHide(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
        accessibilityIdentifier = "story.text.editor"
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) не используется") }

    /// Начать правку: текст и оформление надписи, клавиатура поднимается сразу.
    func begin(with payload: StoryTextPayload) {
        self.payload = payload
        input = .keyboard
        textView.inputView = nil
        textView.text = payload.text
        applyAttributes()
        formatBar.configure(payload: payload, input: .keyboard)
        relayoutText()
        textView.becomeFirstResponder()
    }

    func end() {
        textView.inputView = nil
        textView.resignFirstResponder()
    }

    /// Новый цвет из большого выбора цвета. Модель его уже знает — обратно не сообщаем:
    /// вызов приходит из обновления SwiftUI, и правка состояния там запрещена.
    func setColor(_ color: StoryColor) {
        payload.color = color
        applyAttributes()
        formatBar.configure(payload: payload, input: input)
        relayoutText()
    }

    func refocus() {
        if !textView.isFirstResponder { textView.becomeFirstResponder() }
    }

    // MARK: Раскладка

    override func layoutSubviews() {
        super.layoutSubviews()
        dimView.frame = bounds
        relayoutText()
    }

    private func relayoutText() {
        guard canvasFrame.width > 0 else { return }
        let layout = StoryTextLayout(payload: payload, canvasWidth: canvasFrame.width, text: textView.text)
        let top = canvasFrame.minY + 8
        let bottom = min(keyboardTop ?? (canvasFrame.maxY), canvasFrame.maxY) - 8
        let available = max(bottom - top, 60)
        let height = min(layout.size.height, available)
        let center = CGPoint(x: canvasFrame.midX, y: top + available / 2)
        // Поле ввода на 2 pt шире строк: при строке ровно во всю ширину его раскладка
        // не перенесёт последнее слово иначе, чем рисунок букв (курсор и буквы на разных строках).
        let slack = StoryTextLayout.wrapSlack
        let frame = CGRect(x: center.x - layout.size.width / 2 - slack / 2, y: center.y - height / 2, width: layout.size.width + slack, height: height)
        previewView.layout = layout
        previewView.frame = CGRect(x: frame.minX + slack / 2, y: frame.minY, width: layout.size.width, height: layout.size.height)
        textView.frame = frame
        textView.textContainerInset = UIEdgeInsets(top: layout.padding.height, left: layout.padding.width, bottom: layout.padding.height, right: layout.padding.width)
        // Длинная надпись выше свободного места — прокрутка внутри поля, подложка едет следом.
        textView.isScrollEnabled = layout.size.height > available
        previewView.frame.origin.y = frame.minY - (textView.isScrollEnabled ? textView.contentOffset.y : 0)
        previewView.frame.origin.x = frame.minX + slack / 2
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        previewView.frame.origin.y = textView.frame.minY - textView.contentOffset.y
    }

    @objc private func keyboardWillChange(_ note: Notification) {
        guard let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect, let window else { return }
        let local = convert(frame, from: window.screen.coordinateSpace)
        keyboardTop = local.minY < bounds.maxY ? local.minY : nil
        animateAlongKeyboard(note)
    }

    @objc private func keyboardWillHide(_ note: Notification) {
        keyboardTop = nil
        animateAlongKeyboard(note)
    }

    private func animateAlongKeyboard(_ note: Notification) {
        let duration = note.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
        let curve = note.userInfo?[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt ?? 7
        UIView.animate(withDuration: duration, delay: 0, options: UIView.AnimationOptions(rawValue: curve << 16)) {
            self.relayoutText()
        }
    }

    // MARK: Ввод

    func textViewDidChange(_ textView: UITextView) {
        var text = textView.text ?? ""
        if text.count > StoryTextPayload.maxLength {
            text = String(text.prefix(StoryTextPayload.maxLength))
            textView.text = text
        }
        payload.text = text
        relayoutText()
        onChange(payload)
    }

    private func insertEmoji(_ emoji: String) {
        RecentEmoji.shared.use(emoji)
        // В позицию курсора, как с клавиатуры: выделение заменяется.
        textView.insertText(emoji)
        Haptics.tap()
    }

    @objc private func tappedOutside() {
        if input != .keyboard { handle(.keyboard) }
    }

    private func handle(_ action: StoryTextFormatBar.Action) {
        Haptics.tap()
        switch action {
        case .style:
            payload.style = payload.style.next
            payloadChanged()
        case .alignment:
            payload.alignment = payload.alignment.next
            payloadChanged()
        case .color(let color):
            payload.color = color.withAlpha(payload.color.alpha)
            payloadChanged()
        case .openPalette:
            onOpenColorPicker()
        case .font(let font):
            payload.font = font
            payloadChanged()
        case .emoji:
            setInput(.emoji)
        case .keyboard:
            setInput(.keyboard)
        case .fonts:
            setInput(.fonts)
        case .closeFonts:
            setInput(.keyboard)
        }
    }

    private func setInput(_ input: StoryTextInput) {
        guard input != self.input else { return }
        self.input = input
        // Панель эмодзи — `inputView` того же поля: курсор и выделение остаются на месте.
        textView.inputView = input == .emoji ? emojiInput : nil
        textView.reloadInputViews()
        formatBar.configure(payload: payload, input: input)
        onInputChange(input)
    }

    private func payloadChanged() {
        applyAttributes()
        formatBar.configure(payload: payload, input: input)
        relayoutText()
        onChange(payload)
    }

    private func applyAttributes() {
        let font = payload.font.uiFont(size: CGFloat(payload.fontSize) * max(canvasFrame.width, 1))
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = payload.alignment.nsAlignment
        paragraph.lineBreakMode = .byWordWrapping
        // Буквы поля прозрачные — видны буквы `previewView` под ним.
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: UIColor.clear,
            .paragraphStyle: paragraph,
        ]
        let selection = textView.selectedRange
        textView.attributedText = NSAttributedString(string: textView.text ?? "", attributes: attributes)
        textView.typingAttributes = attributes
        textView.selectedRange = selection
        textView.tintColor = payload.style == .filled ? payload.color.uiColor : (payload.color.isLight ? .white : payload.color.uiColor)
        textView.textAlignment = payload.alignment.nsAlignment
    }
}

/// Поле ввода надписи: курсор потолще, как у Telegram.
final class StoryTextField: UITextView {
    override func caretRect(for position: UITextPosition) -> CGRect {
        var rect = super.caretRect(for: position)
        rect.size.width = 3
        return rect
    }
}

/// Буквы и подложка надписи во время правки.
final class StoryTextPreviewView: UIView {
    var layout: StoryTextLayout? {
        didSet { setNeedsDisplay() }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isOpaque = false
        isUserInteractionEnabled = false
        contentMode = .redraw
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) не используется") }

    override func draw(_ rect: CGRect) {
        guard let layout, let context = UIGraphicsGetCurrentContext() else { return }
        layout.draw(in: context)
    }
}

/// Панель над клавиатурой: цвет, стиль, выравнивание, эмодзи, шрифт.
final class StoryTextFormatBar: UIInputView {
    enum Action {
        case style
        case alignment
        case color(StoryColor)
        case openPalette
        case font(StoryFont)
        case emoji
        case keyboard
        case fonts
        case closeFonts
    }

    var onAction: (Action) -> Void = { _ in }
    private let scroll = UIScrollView()
    private let stack = UIStackView()

    init() {
        super.init(frame: CGRect(x: 0, y: 0, width: 390, height: 52), inputViewStyle: .default)
        allowsSelfSizing = false
        backgroundColor = UIColor.black.withAlphaComponent(0.55)
        scroll.showsHorizontalScrollIndicator = false
        scroll.alwaysBounceHorizontal = true
        addSubview(scroll)
        stack.axis = .horizontal
        stack.alignment = .center
        stack.spacing = 14
        scroll.addSubview(stack)
        accessibilityIdentifier = "story.text.formatBar"
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) не используется") }

    override var intrinsicContentSize: CGSize { CGSize(width: UIView.noIntrinsicMetric, height: 52) }

    override func layoutSubviews() {
        super.layoutSubviews()
        scroll.frame = bounds
        let size = stack.systemLayoutSizeFitting(CGSize(width: UIView.layoutFittingCompressedSize.width, height: bounds.height))
        stack.frame = CGRect(x: 14, y: 0, width: max(size.width, bounds.width - 28), height: bounds.height)
        scroll.contentSize = CGSize(width: stack.frame.width + 28, height: bounds.height)
    }

    func configure(payload: StoryTextPayload, input: StoryTextInput) {
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        switch input {
        case .fonts:
            stack.addArrangedSubview(iconButton("chevron.left", label: String(localized: "stories.text.back", defaultValue: "Назад"), id: "story.text.fontsBack") { [weak self] in
                self?.onAction(.closeFonts)
            })
            for font in StoryFont.allCases {
                let button = chip(title: font.displayName, font: font.uiFont(size: 15), selected: font == payload.font, id: "story.text.font.\(font.rawValue)") { [weak self] in
                    self?.onAction(.font(font))
                }
                stack.addArrangedSubview(button)
            }
        case .keyboard, .emoji:
            stack.addArrangedSubview(paletteButton(current: payload.color))
            for color in StoryColor.presets.prefix(6) {
                stack.addArrangedSubview(swatch(color, selected: color.matches(payload.color)))
            }
            stack.addArrangedSubview(iconButton(payload.style.symbol, label: payload.style.title, id: "story.text.style", value: payload.style.rawValue) { [weak self] in
                self?.onAction(.style)
            })
            stack.addArrangedSubview(iconButton(payload.alignment.symbol, label: String(localized: "stories.text.alignment", defaultValue: "Выравнивание"), id: "story.text.alignment", value: payload.alignment.rawValue) { [weak self] in
                self?.onAction(.alignment)
            })
            if input == .emoji {
                stack.addArrangedSubview(iconButton("keyboard", label: String(localized: "stories.text.keyboard", defaultValue: "Клавиатура"), id: "story.text.keyboard") { [weak self] in
                    self?.onAction(.keyboard)
                })
            } else {
                stack.addArrangedSubview(iconButton("face.smiling", label: String(localized: "stories.text.emoji", defaultValue: "Эмодзи"), id: "story.text.emoji") { [weak self] in
                    self?.onAction(.emoji)
                })
            }
            stack.addArrangedSubview(chip(title: payload.font.displayName + " ›", font: .systemFont(ofSize: 15, weight: .semibold), selected: false, id: "story.text.fonts") { [weak self] in
                self?.onAction(.fonts)
            })
        }
        setNeedsLayout()
    }

    private func iconButton(_ symbol: String, label: String, id: String, value: String? = nil, action: @escaping () -> Void) -> UIButton {
        var configuration = UIButton.Configuration.plain()
        configuration.image = UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .semibold))
        configuration.baseForegroundColor = .white
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 6, bottom: 8, trailing: 6)
        let button = UIButton(configuration: configuration, primaryAction: UIAction { _ in action() })
        button.accessibilityLabel = label
        button.accessibilityIdentifier = id
        button.accessibilityValue = value
        return button
    }

    private func chip(title: String, font: UIFont, selected: Bool, id: String, action: @escaping () -> Void) -> UIButton {
        var configuration = UIButton.Configuration.filled()
        configuration.cornerStyle = .capsule
        configuration.baseBackgroundColor = selected ? .white : UIColor.white.withAlphaComponent(0.18)
        configuration.baseForegroundColor = selected ? .black : .white
        configuration.attributedTitle = AttributedString(title, attributes: AttributeContainer([.font: font]))
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12)
        let button = UIButton(configuration: configuration, primaryAction: UIAction { _ in action() })
        button.accessibilityIdentifier = id
        if selected { button.accessibilityTraits.insert(.selected) }
        return button
    }

    private func swatch(_ color: StoryColor, selected: Bool) -> UIButton {
        let button = UIButton(type: .custom, primaryAction: UIAction { [weak self] _ in self?.onAction(.color(color)) })
        button.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([button.widthAnchor.constraint(equalToConstant: 26), button.heightAnchor.constraint(equalToConstant: 26)])
        button.backgroundColor = color.uiColor
        button.layer.cornerRadius = 13
        button.layer.borderColor = UIColor.white.cgColor
        button.layer.borderWidth = selected ? 3 : 1.5
        button.accessibilityIdentifier = "story.text.color.\(color.hex)"
        button.accessibilityLabel = color.hex
        if selected { button.accessibilityTraits.insert(.selected) }
        return button
    }

    /// Радужный круг — большой выбор цвета.
    private func paletteButton(current: StoryColor) -> UIButton {
        let button = UIButton(type: .custom, primaryAction: UIAction { [weak self] _ in self?.onAction(.openPalette) })
        button.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([button.widthAnchor.constraint(equalToConstant: 28), button.heightAnchor.constraint(equalToConstant: 28)])
        let gradient = CAGradientLayer()
        gradient.type = .conic
        gradient.colors = [UIColor.systemRed, .systemYellow, .systemGreen, .systemCyan, .systemBlue, .systemPurple, .systemRed].map(\.cgColor)
        gradient.startPoint = CGPoint(x: 0.5, y: 0.5)
        gradient.endPoint = CGPoint(x: 0.5, y: 0)
        gradient.frame = CGRect(x: 0, y: 0, width: 28, height: 28)
        gradient.cornerRadius = 14
        button.layer.addSublayer(gradient)
        let dot = CALayer()
        dot.frame = CGRect(x: 7, y: 7, width: 14, height: 14)
        dot.cornerRadius = 7
        dot.backgroundColor = current.uiColor.cgColor
        dot.borderColor = UIColor.white.cgColor
        dot.borderWidth = 1.5
        button.layer.addSublayer(dot)
        button.accessibilityIdentifier = "story.text.palette"
        button.accessibilityLabel = String(localized: "stories.color.title", defaultValue: "Выбор цвета")
        button.accessibilityValue = current.hex
        return button
    }
}

extension StoryTextStyle {
    var symbol: String {
        switch self {
        case .plain: return "textformat"
        case .filled: return "character.textbox"
        case .translucent: return "square.text.square"
        case .outline: return "a.circle"
        case .shadow: return "shadow"
        }
    }

    var title: String {
        switch self {
        case .plain: return String(localized: "stories.text.style.plain", defaultValue: "Без фона")
        case .filled: return String(localized: "stories.text.style.filled", defaultValue: "Подложка")
        case .translucent: return String(localized: "stories.text.style.translucent", defaultValue: "Полупрозрачная подложка")
        case .outline: return String(localized: "stories.text.style.outline", defaultValue: "Обводка")
        case .shadow: return String(localized: "stories.text.style.shadow", defaultValue: "Тень")
        }
    }
}
