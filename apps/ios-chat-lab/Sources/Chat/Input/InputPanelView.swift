import UIKit

@MainActor
protocol InputPanelDelegate: AnyObject {
    func inputPanel(_ panel: InputPanelView, didSend text: String)
    func inputPanelDidTapAttach(_ panel: InputPanelView)
    func inputPanelDidCancelAccessory(_ panel: InputPanelView)
    func inputPanelDidTapAccessory(_ panel: InputPanelView)
    func inputPanelHeightDidChange(_ panel: InputPanelView, animated: Bool)
    func inputPanelTextDidChange(_ panel: InputPanelView)
    /// Записано голосовое: файл уже в `MediaStorage`.
    func inputPanel(_ panel: InputPanelView, didRecordVoice media: MediaRef)
    /// Записано видеосообщение.
    func inputPanel(_ panel: InputPanelView, didRecordVideoNote media: MediaRef)
}

/// Над полем: ответ или редактирование.
enum InputAccessory: Equatable {
    case reply(MessageID, author: String, text: String)
    case edit(MessageID, text: String)

    var messageId: MessageID {
        switch self {
        case let .reply(id, _, _), let .edit(id, _): return id
        }
    }
}

/// Панель ввода Telegram: скрепка, растущее поле с кнопкой эмодзи внутри, справа —
/// микрофон, который превращается в «отправить», когда есть текст. Над полем — панель
/// ответа/редактирования. Фон — стекло iOS 26.
final class InputPanelView: UIView, UITextViewDelegate {
    weak var delegate: InputPanelDelegate?

    let backgroundView = UIVisualEffectView(effect: UIBlurEffect(style: .systemChromeMaterial))
    let attachButton = UIButton(type: .system)
    let fieldBackground = UIView()
    let textView = UITextView()
    let placeholderLabel = UILabel()
    let emojiButton = UIButton(type: .system)
    let sendButton = UIButton(type: .custom)
    /// Микрофон / камера (переключается коротким нажатием, удержание — запись).
    let micButton = UIButton(type: .custom)
    let accessoryView = InputAccessoryBar()
    private let separator = UIView()

    private(set) var accessory: InputAccessory?
    /// Режим кнопки записи: голос или кружок.
    var recordsVideoNote = false {
        didSet { updateMicIcon() }
    }

    static let fieldMinHeight: CGFloat = 36
    static let lineHeight: CGFloat = 22
    private var maxFieldHeight: CGFloat = 36 + 22 * 6
    private var fieldHeight: CGFloat = 36

    /// Высота панели (без нижней безопасной зоны).
    var contentHeight: CGFloat {
        let accessoryHeight: CGFloat = accessory == nil ? 0 : InputAccessoryBar.height
        return accessoryHeight + fieldHeight + 16
    }

    var text: String {
        get { textView.text ?? "" }
        set {
            textView.text = newValue
            textDidChange(animated: false)
        }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        addSubview(backgroundView)
        separator.backgroundColor = .separator
        addSubview(separator)
        addSubview(accessoryView)
        accessoryView.alpha = 0
        accessoryView.onCancel = { [weak self] in
            guard let self else { return }
            self.delegate?.inputPanelDidCancelAccessory(self)
        }
        accessoryView.onTap = { [weak self] in
            guard let self else { return }
            self.delegate?.inputPanelDidTapAccessory(self)
        }

        attachButton.setImage(UIImage(systemName: "paperclip", withConfiguration: UIImage.SymbolConfiguration(pointSize: 22, weight: .regular)), for: .normal)
        attachButton.tintColor = .secondaryLabel
        attachButton.accessibilityLabel = "Вложение"
        attachButton.accessibilityIdentifier = "input.attach"
        attachButton.addAction(UIAction { [weak self] _ in
            guard let self else { return }
            self.delegate?.inputPanelDidTapAttach(self)
        }, for: .touchUpInside)
        addSubview(attachButton)

        fieldBackground.backgroundColor = Palette.inputFieldBackground
        fieldBackground.layer.cornerRadius = 18
        fieldBackground.layer.cornerCurve = .continuous
        fieldBackground.layer.borderWidth = 1 / max(1, traitCollection.displayScale)
        fieldBackground.layer.borderColor = Palette.inputFieldBorder.resolvedColor(with: traitCollection).cgColor
        addSubview(fieldBackground)

        textView.font = .systemFont(ofSize: 17)
        textView.backgroundColor = .clear
        textView.textContainerInset = UIEdgeInsets(top: 8, left: 6, bottom: 8, right: 6)
        textView.delegate = self
        textView.isScrollEnabled = false
        textView.scrollsToTop = false
        textView.accessibilityIdentifier = "input.text"
        textView.accessibilityLabel = "Сообщение"
        textView.dataDetectorTypes = []
        fieldBackground.addSubview(textView)

        placeholderLabel.text = "Сообщение"
        placeholderLabel.font = .systemFont(ofSize: 17)
        placeholderLabel.textColor = .placeholderText
        placeholderLabel.isUserInteractionEnabled = false
        fieldBackground.addSubview(placeholderLabel)

        emojiButton.setImage(UIImage(systemName: "face.smiling", withConfiguration: UIImage.SymbolConfiguration(pointSize: 20)), for: .normal)
        emojiButton.tintColor = .secondaryLabel
        emojiButton.accessibilityLabel = "Эмодзи"
        emojiButton.accessibilityIdentifier = "input.emoji"
        fieldBackground.addSubview(emojiButton)

        sendButton.setImage(UIImage(systemName: "arrow.up", withConfiguration: UIImage.SymbolConfiguration(pointSize: 16, weight: .bold)), for: .normal)
        sendButton.tintColor = .white
        sendButton.backgroundColor = Palette.accent
        sendButton.layer.cornerRadius = 17
        sendButton.accessibilityLabel = "Отправить"
        sendButton.accessibilityIdentifier = "input.send"
        sendButton.addAction(UIAction { [weak self] _ in self?.sendTapped() }, for: .touchUpInside)
        addSubview(sendButton)

        micButton.tintColor = .secondaryLabel
        micButton.accessibilityIdentifier = "input.mic"
        addSubview(micButton)
        updateMicIcon()

        registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (view: InputPanelView, _) in
            view.fieldBackground.layer.borderColor = Palette.inputFieldBorder.resolvedColor(with: view.traitCollection).cgColor
        }
        updateSendState(animated: false)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func updateMicIcon() {
        let name = recordsVideoNote ? "video" : "mic"
        micButton.setImage(UIImage(systemName: name, withConfiguration: UIImage.SymbolConfiguration(pointSize: 22)), for: .normal)
        micButton.accessibilityLabel = recordsVideoNote ? "Записать видеосообщение" : "Записать голосовое"
        micButton.accessibilityHint = "Удерживайте для записи, коснитесь, чтобы переключить голос и видео"
    }

    // MARK: Ответ / правка

    func setAccessory(_ accessory: InputAccessory?, animated: Bool) {
        let changed = self.accessory != accessory
        self.accessory = accessory
        if let accessory { accessoryView.configure(accessory) }
        guard changed else { return }
        let apply = {
            self.accessoryView.alpha = accessory == nil ? 0 : 1
            self.setNeedsLayout()
            self.layoutIfNeeded()
        }
        if animated { Motion.layout(apply) } else { apply() }
        delegate?.inputPanelHeightDidChange(self, animated: animated)
        updateSendState(animated: animated)
    }

    // MARK: Текст

    func textViewDidChange(_ textView: UITextView) {
        textDidChange(animated: true)
        delegate?.inputPanelTextDidChange(self)
    }

    private func textDidChange(animated: Bool) {
        placeholderLabel.isHidden = !(textView.text ?? "").isEmpty
        updateSendState(animated: animated)
        let width = max(50, fieldBackground.bounds.width - 36)
        let fitting = textView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
        let newHeight = min(maxFieldHeight, max(Self.fieldMinHeight, ceil(fitting)))
        textView.isScrollEnabled = fitting > maxFieldHeight
        guard newHeight != fieldHeight else { return }
        fieldHeight = newHeight
        // Рост поля у Telegram: easeInOut 0,1 с.
        if animated, !Motion.reduceMotion {
            UIView.animate(withDuration: 0.1, delay: 0, options: [.curveEaseInOut, .beginFromCurrentState]) {
                self.setNeedsLayout()
                self.layoutIfNeeded()
            }
        } else {
            setNeedsLayout()
        }
        delegate?.inputPanelHeightDidChange(self, animated: animated)
    }

    private var hasSendableContent: Bool {
        !(textView.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Микрофон ↔ «отправить»: масштаб 0,2 → 1 и растворение, как у Telegram.
    private func updateSendState(animated: Bool) {
        let showSend = hasSendableContent || {
            if case .edit = accessory { return true } else { return false }
        }()
        let apply = {
            self.sendButton.alpha = showSend ? 1 : 0
            self.sendButton.transform = showSend ? .identity : CGAffineTransform(scaleX: 0.2, y: 0.2)
            self.micButton.alpha = showSend ? 0 : 1
            self.micButton.transform = showSend ? CGAffineTransform(scaleX: 0.2, y: 0.2) : .identity
        }
        sendButton.isUserInteractionEnabled = showSend
        micButton.isUserInteractionEnabled = !showSend
        sendButton.accessibilityElementsHidden = !showSend
        micButton.accessibilityElementsHidden = showSend
        if case .edit = accessory {
            sendButton.setImage(UIImage(systemName: "checkmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 16, weight: .bold)), for: .normal)
            sendButton.accessibilityLabel = "Сохранить"
        } else {
            sendButton.setImage(UIImage(systemName: "arrow.up", withConfiguration: UIImage.SymbolConfiguration(pointSize: 16, weight: .bold)), for: .normal)
            sendButton.accessibilityLabel = "Отправить"
        }
        if animated { Motion.spring(duration: 0.3, apply) } else { apply() }
    }

    private func sendTapped() {
        let value = textView.text ?? ""
        if case .edit = accessory {
            delegate?.inputPanel(self, didSend: value)
            return
        }
        guard hasSendableContent else { return }
        delegate?.inputPanel(self, didSend: value)
    }

    /// Очистка после отправки — без анимации высоты (её ведёт вставка в ленту).
    func clearAfterSend() {
        // Сбросить автокоррекцию: иначе система вставит отложенное исправление в пустое поле.
        textView.unmarkText()
        textView.text = ""
        textDidChange(animated: true)
    }

    // MARK: Раскладка

    override func layoutSubviews() {
        super.layoutSubviews()
        // Фон уходит под полосу «домой»: панель стоит на `keyboardLayoutGuide`, а под ней
        // без клавиатуры — безопасная зона, которую Telegram тоже закрывает фоном панели.
        backgroundView.frame = CGRect(x: 0, y: 0, width: bounds.width, height: bounds.height + 120)
        fieldBackground.layer.borderWidth = 1 / max(1, traitCollection.displayScale)
        separator.frame = CGRect(x: 0, y: 0, width: bounds.width, height: 1 / max(1, traitCollection.displayScale))
        var y: CGFloat = 0
        accessoryView.frame = CGRect(x: 0, y: 0, width: bounds.width, height: InputAccessoryBar.height)
        if accessory != nil { y = InputAccessoryBar.height }
        let fieldY = y + 8
        attachButton.frame = CGRect(x: 4, y: fieldY + fieldHeight - 40, width: 44, height: 40)
        let rightButtonSize: CGFloat = 44
        let fieldX: CGFloat = 50
        let fieldWidth = bounds.width - fieldX - rightButtonSize - 6
        fieldBackground.frame = CGRect(x: fieldX, y: fieldY, width: fieldWidth, height: fieldHeight)
        textView.frame = CGRect(x: 0, y: 0, width: fieldWidth - 34, height: fieldHeight)
        placeholderLabel.frame = CGRect(x: 11, y: 0, width: fieldWidth - 50, height: Self.fieldMinHeight)
        emojiButton.frame = CGRect(x: fieldWidth - 36, y: fieldHeight - 36, width: 36, height: 36)
        sendButton.bounds = CGRect(x: 0, y: 0, width: 34, height: 34)
        sendButton.center = CGPoint(x: bounds.width - 6 - rightButtonSize / 2, y: fieldY + fieldHeight - 18)
        micButton.bounds = CGRect(x: 0, y: 0, width: 44, height: 44)
        micButton.center = sendButton.center
        maxFieldHeight = Self.fieldMinHeight + Self.lineHeight * CGFloat(max(3, min(12, Int(((window?.bounds.height ?? 700) * 0.3) / Self.lineHeight))))
    }

    /// Рамка текста в окне — откуда «вылетает» отправленное сообщение.
    var textFrameInWindow: CGRect {
        fieldBackground.convert(textView.frame, to: nil)
    }
}

/// Полоса «В ответ …» / «Редактирование» над полем.
final class InputAccessoryBar: UIView {
    static let height: CGFloat = 44

    var onCancel: (() -> Void)?
    var onTap: (() -> Void)?

    private let icon = UIImageView()
    private let bar = UIView()
    private let titleLabel = UILabel()
    private let textLabel = UILabel()
    private let closeButton = UIButton(type: .system)

    override init(frame: CGRect) {
        super.init(frame: frame)
        icon.tintColor = Palette.accent
        icon.contentMode = .center
        addSubview(icon)
        bar.backgroundColor = Palette.accent
        bar.layer.cornerRadius = 1
        addSubview(bar)
        titleLabel.font = .systemFont(ofSize: 14, weight: .semibold)
        titleLabel.textColor = Palette.accent
        textLabel.font = .systemFont(ofSize: 14)
        textLabel.textColor = .label
        addSubview(titleLabel)
        addSubview(textLabel)
        closeButton.setImage(UIImage(systemName: "xmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 14, weight: .semibold)), for: .normal)
        closeButton.tintColor = .secondaryLabel
        closeButton.accessibilityLabel = "Отменить"
        closeButton.accessibilityIdentifier = "input.accessory.cancel"
        closeButton.addAction(UIAction { [weak self] _ in self?.onCancel?() }, for: .touchUpInside)
        addSubview(closeButton)
        addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped)))
        accessibilityIdentifier = "input.accessory"
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    @objc private func tapped() { onTap?() }

    func configure(_ accessory: InputAccessory) {
        switch accessory {
        case let .reply(_, author, text):
            icon.image = UIImage(systemName: "arrowshape.turn.up.left", withConfiguration: UIImage.SymbolConfiguration(pointSize: 18))
            titleLabel.text = "В ответ \(author)"
            textLabel.text = text.replacingOccurrences(of: "\n", with: " ")
        case let .edit(_, text):
            icon.image = UIImage(systemName: "pencil", withConfiguration: UIImage.SymbolConfiguration(pointSize: 18))
            titleLabel.text = "Редактирование"
            textLabel.text = text.replacingOccurrences(of: "\n", with: " ")
        }
        titleLabel.accessibilityIdentifier = "input.accessory.title"
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        icon.frame = CGRect(x: 6, y: 0, width: 40, height: bounds.height)
        bar.frame = CGRect(x: 50, y: 7, width: 2, height: bounds.height - 12)
        titleLabel.frame = CGRect(x: 60, y: 5, width: bounds.width - 110, height: 18)
        textLabel.frame = CGRect(x: 60, y: 23, width: bounds.width - 110, height: 18)
        closeButton.frame = CGRect(x: bounds.width - 46, y: 0, width: 44, height: bounds.height)
    }
}
