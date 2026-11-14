import UIKit

// MARK: - Закреплённое сообщение

/// Панель закрепа под шапкой (50 pt, как у Telegram). Слева — полоски по числу закрепов,
/// при смене сообщения текст уезжает на ±10 pt с растворением за 0,2 с.
final class PinnedPanelView: UIView {
    static let height: CGFloat = 50

    var onTap: (() -> Void)?
    var onClose: (() -> Void)?

    private let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemChromeMaterial))
    private let barTrack = UIView()
    private let barThumb = UIView()
    private let titleLabel = UILabel()
    private let textLabel = UILabel()
    private let closeButton = UIButton(type: .system)
    private let separator = UIView()
    private(set) var currentId: MessageID?
    private var count = 0
    private var index = 0

    override init(frame: CGRect) {
        super.init(frame: frame)
        addSubview(blur)
        barTrack.backgroundColor = Palette.accent.withAlphaComponent(0.3)
        barTrack.layer.cornerRadius = 1
        barThumb.backgroundColor = Palette.accent
        barThumb.layer.cornerRadius = 1
        addSubview(barTrack)
        barTrack.addSubview(barThumb)
        titleLabel.font = .systemFont(ofSize: 14, weight: .semibold)
        titleLabel.textColor = Palette.accent
        textLabel.font = .systemFont(ofSize: 14)
        textLabel.textColor = .label
        addSubview(titleLabel)
        addSubview(textLabel)
        closeButton.setImage(UIImage(systemName: "xmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 13, weight: .semibold)), for: .normal)
        closeButton.tintColor = .secondaryLabel
        closeButton.accessibilityLabel = "Открепить"
        closeButton.accessibilityIdentifier = "pinned.close"
        closeButton.addAction(UIAction { [weak self] _ in self?.onClose?() }, for: .touchUpInside)
        addSubview(closeButton)
        separator.backgroundColor = .separator
        addSubview(separator)
        addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped)))
        isAccessibilityElement = false
        textLabel.isAccessibilityElement = true
        textLabel.accessibilityIdentifier = "pinned.text"
        textLabel.accessibilityTraits = .button
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    @objc private func tapped() { onTap?() }

    /// `index` — номер показанного закрепа среди всех (0 — самый старый).
    func configure(message: Message, index: Int, count: Int, animated: Bool) {
        let direction: CGFloat = (currentId ?? 0) > message.id ? 1 : -1
        let changed = currentId != nil && currentId != message.id
        currentId = message.id
        self.count = count
        self.index = index
        let title = count > 1 ? "Закреплённое сообщение #\(index + 1)" : "Закреплённое сообщение"
        let text = message.previewText.replacingOccurrences(of: "\n", with: " ")
        guard animated, changed, !Motion.reduceMotion else {
            titleLabel.text = title
            textLabel.text = text
            setNeedsLayout()
            return
        }
        // Старый текст уезжает и гаснет, новый приезжает с другой стороны.
        if let snapshot = textLabel.snapshotView(afterScreenUpdates: false) {
            snapshot.frame = textLabel.frame
            addSubview(snapshot)
            UIView.animate(withDuration: 0.2, animations: {
                snapshot.transform = CGAffineTransform(translationX: 0, y: -10 * direction)
                snapshot.alpha = 0
            }, completion: { _ in snapshot.removeFromSuperview() })
        }
        titleLabel.text = title
        textLabel.text = text
        textLabel.transform = CGAffineTransform(translationX: 0, y: 10 * direction)
        textLabel.alpha = 0
        UIView.animate(withDuration: 0.2) {
            self.textLabel.transform = .identity
            self.textLabel.alpha = 1
        }
        layoutBar(animated: true)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        blur.frame = bounds
        barTrack.frame = CGRect(x: 10, y: 8, width: 2, height: bounds.height - 16)
        titleLabel.frame = CGRect(x: 20, y: 7, width: bounds.width - 70, height: 18)
        textLabel.bounds = CGRect(x: 0, y: 0, width: bounds.width - 70, height: 18)
        textLabel.center = CGPoint(x: 20 + textLabel.bounds.width / 2, y: 34)
        closeButton.frame = CGRect(x: bounds.width - 44, y: 3, width: 44, height: 44)
        separator.frame = CGRect(x: 0, y: bounds.height - 1 / UIScreen.main.scale, width: bounds.width, height: 1 / UIScreen.main.scale)
        layoutBar(animated: false)
    }

    private func layoutBar(animated: Bool) {
        let segments = max(1, min(count, 4))
        let segmentHeight = barTrack.bounds.height / CGFloat(segments)
        let position = segments == 1 ? 0 : min(segments - 1, Int(Double(index) / Double(max(1, count - 1)) * Double(segments - 1)))
        let frame = CGRect(x: 0, y: CGFloat(position) * segmentHeight, width: 2, height: segmentHeight - (segments > 1 ? 2 : 0))
        if animated { Motion.layout(duration: 0.2) { self.barThumb.frame = frame } } else { barThumb.frame = frame }
    }
}

// MARK: - Кнопка «вниз»

/// Круглая кнопка 40×40 со счётчиком непрочитанных. Появляется, когда до низа ≥ 40 pt;
/// появление — масштаб 0,2 ↔ 1 с прозрачностью, пружина 0,3 с.
final class ScrollToBottomButton: UIControl {
    private let glass = UIVisualEffectView(effect: UIGlassEffect(style: .regular))
    private let icon = UIImageView(image: UIImage(systemName: "chevron.down", withConfiguration: UIImage.SymbolConfiguration(pointSize: 17, weight: .semibold)))
    private let badge = UILabel()
    private(set) var isShown = false

    override init(frame: CGRect) {
        super.init(frame: CGRect(x: 0, y: 0, width: 40, height: 40))
        glass.isUserInteractionEnabled = false
        glass.layer.cornerRadius = 20
        glass.clipsToBounds = true
        addSubview(glass)
        icon.tintColor = .secondaryLabel
        icon.contentMode = .center
        addSubview(icon)
        badge.font = .systemFont(ofSize: 13, weight: .semibold)
        badge.textColor = .white
        badge.backgroundColor = Palette.accent
        badge.textAlignment = .center
        badge.layer.cornerRadius = 10
        badge.layer.masksToBounds = true
        badge.isHidden = true
        addSubview(badge)
        alpha = 0
        transform = CGAffineTransform(scaleX: 0.2, y: 0.2)
        isAccessibilityElement = true
        accessibilityLabel = "Вниз"
        accessibilityIdentifier = "chat.scrollToBottom"
        accessibilityTraits = .button
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func setUnread(_ count: Int) {
        badge.isHidden = count == 0
        badge.text = count > 99 ? "99+" : "\(count)"
        accessibilityValue = count > 0 ? "\(count) новых" : nil
        setNeedsLayout()
    }

    func setShown(_ shown: Bool, animated: Bool) {
        guard shown != isShown else { return }
        isShown = shown
        isUserInteractionEnabled = shown
        let apply = {
            self.alpha = shown ? 1 : 0
            self.transform = shown ? .identity : CGAffineTransform(scaleX: 0.2, y: 0.2)
        }
        if animated { Motion.spring(duration: 0.3, apply) } else { apply() }
        accessibilityElementsHidden = !shown
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        glass.frame = bounds
        icon.frame = bounds.offsetBy(dx: 0, dy: 1)
        let width = max(20, (badge.text as NSString? ?? "").size(withAttributes: [.font: badge.font!]).width + 10)
        badge.frame = CGRect(x: (bounds.width - width) / 2, y: -10, width: width, height: 20)
    }

    override var isHighlighted: Bool {
        didSet { icon.alpha = isHighlighted ? 0.5 : 1 }
    }
}

// MARK: - Плавающая дата

/// Дата верхней видимой строки при прокрутке; гаснет через 1 с после остановки.
final class FloatingDateView: UIView {
    private let label = UILabel()
    private var hideWorkItem: DispatchWorkItem?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = Palette.serviceFill
        layer.cornerCurve = .continuous
        label.font = Fonts.service
        label.textColor = Palette.serviceText
        label.textAlignment = .center
        addSubview(label)
        alpha = 0
        isUserInteractionEnabled = false
        accessibilityIdentifier = "chat.floatingDate"
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    var text: String? { label.text }

    func show(_ text: String, centerX: CGFloat, top: CGFloat) {
        if label.text != text {
            label.text = text
        }
        let width = (text as NSString).size(withAttributes: [.font: Fonts.service]).width + 20
        frame = CGRect(x: centerX - width / 2, y: top, width: ceil(width), height: BubbleMetrics.datePillHeight)
        layer.cornerRadius = bounds.height / 2
        label.frame = bounds
        hideWorkItem?.cancel()
        if alpha < 1 { Motion.fade(duration: 0.15) { self.alpha = 1 } }
    }

    func scheduleHide() {
        hideWorkItem?.cancel()
        let item = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated {
                guard let self else { return }
                Motion.fade(duration: 0.3) { self.alpha = 0 }
            }
        }
        hideWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 1, execute: item)
    }

    func hideNow() {
        hideWorkItem?.cancel()
        alpha = 0
    }
}
