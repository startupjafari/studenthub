import UIKit

/// Аватар: фото, если файл есть, иначе инициалы на градиенте по id (как в Telegram).
final class AvatarView: UIView {
    private let gradient = CAGradientLayer()
    private let initialsLabel = UILabel()
    private let imageView = UIImageView()
    private var file: String?

    override init(frame: CGRect) {
        super.init(frame: frame)
        clipsToBounds = true
        layer.addSublayer(gradient)
        gradient.startPoint = CGPoint(x: 0.5, y: 0)
        gradient.endPoint = CGPoint(x: 0.5, y: 1)
        initialsLabel.textColor = .white
        initialsLabel.textAlignment = .center
        addSubview(initialsLabel)
        imageView.contentMode = .scaleAspectFill
        addSubview(imageView)
        isAccessibilityElement = false
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(peer: Peer) {
        let colors = Palette.avatarGradients[Int(peer.id) % Palette.avatarGradients.count]
        gradient.colors = [UIColor(rgb: colors.0).cgColor, UIColor(rgb: colors.1).cgColor]
        initialsLabel.text = peer.initials
        file = peer.avatarFile
        imageView.image = nil
        guard let file = peer.avatarFile, MediaStorage.exists(file) else { return }
        let size = CGSize(width: max(bounds.width, 40), height: max(bounds.height, 40))
        if let image = ImagePipeline.shared.load(.photo(file), pointSize: CGSize(width: max(size.width, 120), height: max(size.height, 120)), completion: { [weak self] image in
            if self?.file == file { self?.imageView.image = image }
        }) {
            imageView.image = image
        }
    }

    /// Фото, если уже загружено (для перехода в профиль).
    var image: UIImage? { imageView.image }

    override func layoutSubviews() {
        super.layoutSubviews()
        layer.cornerRadius = bounds.width / 2
        gradient.frame = bounds
        imageView.frame = bounds
        initialsLabel.frame = bounds
        initialsLabel.font = .systemFont(ofSize: bounds.width * 0.4, weight: .semibold)
    }
}

/// Заголовок чата: имя и статус по центру. Статус меняется растворением, «печатает…» —
/// с бегущими точками.
final class ChatTitleView: UIControl {
    private let nameLabel = UILabel()
    private let statusLabel = UILabel()
    private let typingDots = TypingDotsView()
    private var currentStatus = ""

    override init(frame: CGRect) {
        super.init(frame: frame)
        nameLabel.font = .systemFont(ofSize: 17, weight: .semibold)
        nameLabel.textAlignment = .center
        nameLabel.textColor = .label
        statusLabel.font = .systemFont(ofSize: 13)
        statusLabel.textAlignment = .center
        addSubview(nameLabel)
        addSubview(statusLabel)
        addSubview(typingDots)
        typingDots.isHidden = true
        isAccessibilityElement = true
        accessibilityTraits = .button
        accessibilityIdentifier = "chat.title"
        accessibilityHint = "Открыть профиль"
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var intrinsicContentSize: CGSize { CGSize(width: 200, height: 40) }

    func configure(name: String) {
        nameLabel.text = name
        accessibilityLabel = "\(name), \(currentStatus)"
    }

    func setPresence(_ presence: PeerPresence, animated: Bool) {
        let text: String
        var accent = false
        switch presence {
        case .online: text = "в сети"; accent = true
        case .recently: text = "был(а) недавно"
        case let .lastSeen(date): text = "был(а) в \(MessageLayoutEngine.timeFormatter.string(from: date))"
        case .typing: text = "печатает"; accent = true
        case .recordingVoice: text = "записывает аудио"; accent = true
        case .recordingVideo: text = "записывает видео"; accent = true
        case .choosingPhoto: text = "отправляет фото"; accent = true
        }
        guard text != currentStatus else { return }
        currentStatus = text
        accessibilityLabel = "\(nameLabel.text ?? ""), \(text)"
        accessibilityValue = text
        let update = {
            self.statusLabel.text = text
            self.statusLabel.textColor = accent ? Palette.accent : .secondaryLabel
            self.typingDots.isHidden = !presence.isActivity
            self.typingDots.tintColor = Palette.accent
            self.setNeedsLayout()
            self.layoutIfNeeded()
        }
        if animated, !Motion.reduceMotion {
            UIView.transition(with: self, duration: 0.2, options: [.transitionCrossDissolve, .beginFromCurrentState], animations: update)
        } else {
            update()
        }
        if presence.isActivity { typingDots.start() } else { typingDots.stop() }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        nameLabel.frame = CGRect(x: 0, y: 1, width: bounds.width, height: 21)
        let statusSize = statusLabel.sizeThatFits(CGSize(width: bounds.width, height: 16))
        let dotsWidth: CGFloat = typingDots.isHidden ? 0 : 18
        let total = statusSize.width + dotsWidth
        let x = (bounds.width - total) / 2
        typingDots.frame = CGRect(x: x, y: 26, width: 16, height: 8)
        statusLabel.frame = CGRect(x: x + dotsWidth, y: 22, width: statusSize.width, height: 16)
    }

    override var isHighlighted: Bool {
        didSet { alpha = isHighlighted ? 0.6 : 1 }
    }
}

/// Три точки «печатает», бегущая волна.
final class TypingDotsView: UIView {
    private var dots: [CALayer] = []

    override init(frame: CGRect) {
        super.init(frame: frame)
        for _ in 0..<3 {
            let dot = CALayer()
            dot.cornerRadius = 2
            layer.addSublayer(dot)
            dots.append(dot)
        }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        for (index, dot) in dots.enumerated() {
            dot.frame = CGRect(x: CGFloat(index) * 6, y: bounds.midY - 2, width: 4, height: 4)
            dot.backgroundColor = tintColor.resolvedColor(with: traitCollection).cgColor
        }
    }

    override func tintColorDidChange() {
        super.tintColorDidChange()
        setNeedsLayout()
    }

    func start() {
        for (index, dot) in dots.enumerated() where dot.animation(forKey: "wave") == nil {
            let animation = CAKeyframeAnimation(keyPath: "opacity")
            animation.values = [0.3, 1, 0.3]
            animation.keyTimes = [0, 0.5, 1]
            animation.duration = 0.9
            animation.repeatCount = .infinity
            animation.beginTime = CACurrentMediaTime() + Double(index) * 0.15
            dot.add(animation, forKey: "wave")
        }
    }

    func stop() {
        dots.forEach { $0.removeAnimation(forKey: "wave") }
    }
}
