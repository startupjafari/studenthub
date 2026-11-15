import UIKit

/// Шапка профиля Telegram: аватар 100 pt, имя, статус и ряд кнопок действий.
/// При прокрутке аватар уменьшается и гаснет, уходя под навигационную панель.
final class ProfileHeaderView: UIView {
    static let avatarSize: CGFloat = 100

    let avatarView = AvatarView()
    let nameLabel = UILabel()
    let statusLabel = UILabel()
    let messageButton = ProfileActionButton(symbol: "message.fill", title: "Сообщение")
    let muteButton = ProfileActionButton(symbol: "bell.fill", title: "Звук")
    let searchButton = ProfileActionButton(symbol: "magnifyingglass", title: "Поиск")
    let moreButton = ProfileActionButton(symbol: "ellipsis", title: "Ещё")
    private let buttonsStack = UIStackView()

    /// 0 — шапка раскрыта, 1 — аватар ушёл под панель.
    private(set) var collapseProgress: CGFloat = 0

    override init(frame: CGRect) {
        super.init(frame: frame)
        addSubview(avatarView)
        avatarView.accessibilityIdentifier = "profile.avatar"

        nameLabel.font = .systemFont(ofSize: 24, weight: .semibold)
        nameLabel.textAlignment = .center
        nameLabel.textColor = .label
        nameLabel.adjustsFontForContentSizeCategory = true
        nameLabel.accessibilityIdentifier = "profile.name"
        nameLabel.accessibilityTraits = .header
        addSubview(nameLabel)

        statusLabel.font = .systemFont(ofSize: 15)
        statusLabel.textAlignment = .center
        statusLabel.textColor = .secondaryLabel
        statusLabel.accessibilityIdentifier = "profile.status"
        addSubview(statusLabel)

        messageButton.accessibilityIdentifier = "profile.message"
        muteButton.accessibilityIdentifier = "profile.mute"
        searchButton.accessibilityIdentifier = "profile.search"
        moreButton.accessibilityIdentifier = "profile.more"
        buttonsStack.axis = .horizontal
        buttonsStack.distribution = .fillEqually
        buttonsStack.spacing = 8
        [messageButton, muteButton, searchButton, moreButton].forEach { buttonsStack.addArrangedSubview($0) }
        addSubview(buttonsStack)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    static let preferredHeight: CGFloat = 16 + avatarSize + 14 + 30 + 22 + 18 + 58 + 12

    /// Рамка аватара без сжатия — цель перелёта из шапки чата.
    var avatarRestingFrame: CGRect {
        CGRect(x: (bounds.width - Self.avatarSize) / 2, y: 16, width: Self.avatarSize, height: Self.avatarSize)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let resting = avatarRestingFrame
        avatarView.bounds = CGRect(origin: .zero, size: resting.size)
        avatarView.center = CGPoint(x: resting.midX, y: resting.midY)
        nameLabel.frame = CGRect(x: 16, y: resting.maxY + 14, width: bounds.width - 32, height: 30)
        statusLabel.frame = CGRect(x: 16, y: nameLabel.frame.maxY + 2, width: bounds.width - 32, height: 20)
        buttonsStack.frame = CGRect(x: 16, y: statusLabel.frame.maxY + 18, width: bounds.width - 32, height: 58)
    }

    /// Сжатие аватара при прокрутке: к верху он уменьшается до 0,4 и гаснет — как в Telegram,
    /// где фото «уплывает» под панель, а имя переходит в заголовок.
    func setCollapse(progress: CGFloat) {
        let clamped = min(1, max(0, progress))
        collapseProgress = clamped
        let scale = 1 - 0.6 * clamped
        avatarView.transform = CGAffineTransform(translationX: 0, y: Self.avatarSize * 0.3 * clamped).scaledBy(x: scale, y: scale)
        avatarView.alpha = 1 - clamped
        let textProgress = min(1, max(0, (progress - 0.6) / 0.6))
        nameLabel.alpha = 1 - textProgress
        statusLabel.alpha = 1 - textProgress
    }

    func setStatus(_ text: String, accent: Bool) {
        statusLabel.text = text
        statusLabel.textColor = accent ? Palette.accent : .secondaryLabel
    }

    func setMuted(_ muted: Bool) {
        muteButton.configure(symbol: muted ? "bell.slash.fill" : "bell.fill", title: muted ? "Без звука" : "Звук")
        muteButton.accessibilityValue = muted ? "выключен" : "включён"
    }
}

/// Плитка действия под именем (Сообщение / Звук / Поиск / Ещё).
final class ProfileActionButton: UIButton {
    private let iconView = UIImageView()
    private let label = UILabel()

    init(symbol: String, title: String) {
        super.init(frame: .zero)
        backgroundColor = .secondarySystemGroupedBackground
        layer.cornerRadius = 12
        layer.cornerCurve = .continuous
        iconView.contentMode = .center
        iconView.tintColor = Palette.accent
        iconView.isUserInteractionEnabled = false
        addSubview(iconView)
        label.font = .systemFont(ofSize: 12, weight: .medium)
        label.textColor = Palette.accent
        label.textAlignment = .center
        label.isUserInteractionEnabled = false
        addSubview(label)
        configure(symbol: symbol, title: title)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(symbol: String, title: String) {
        iconView.image = UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 19, weight: .medium))
        label.text = title
        accessibilityLabel = title
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        iconView.frame = CGRect(x: 0, y: 7, width: bounds.width, height: 26)
        label.frame = CGRect(x: 2, y: 35, width: bounds.width - 4, height: 16)
    }

    override var isHighlighted: Bool {
        didSet {
            UIView.animate(withDuration: isHighlighted ? 0.08 : 0.2, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
                self.alpha = self.isHighlighted ? 0.55 : 1
            }
        }
    }
}
