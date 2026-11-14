import UIKit

// MARK: - Режим темы

enum ThemeMode: String, Codable, CaseIterable {
    case system, light, dark

    var interfaceStyle: UIUserInterfaceStyle {
        switch self {
        case .system: return .unspecified
        case .light: return .light
        case .dark: return .dark
        }
    }

    var title: String {
        switch self {
        case .system: return "Как в системе"
        case .light: return "Светлая"
        case .dark: return "Тёмная"
        }
    }
}

extension Notification.Name {
    static let chatThemeDidChange = Notification.Name("ChatLab.themeDidChange")
    static let chatWallpaperDidChange = Notification.Name("ChatLab.wallpaperDidChange")
}

/// Тема приложения. Все цвета — динамические (`UIColor { traits in … }`), поэтому
/// смена темы — это смена `overrideUserInterfaceStyle` окна; кешированные картинки
/// (пузыри) перерисовываются по `traitCollection`.
@MainActor
final class ThemeManager {
    static let shared = ThemeManager()

    private(set) var mode: ThemeMode
    private weak var window: UIWindow?
    private let defaults = UserDefaults.standard

    private init() {
        mode = ThemeMode(rawValue: UserDefaults.standard.string(forKey: "theme.mode") ?? "") ?? .system
    }

    func attach(window: UIWindow) {
        self.window = window
        window.overrideUserInterfaceStyle = mode.interfaceStyle
    }

    func setMode(_ mode: ThemeMode, animated: Bool) {
        self.mode = mode
        defaults.set(mode.rawValue, forKey: "theme.mode")
        guard let window else { return }
        let apply = { window.overrideUserInterfaceStyle = mode.interfaceStyle }
        if animated, !UIAccessibility.isReduceMotionEnabled {
            // Как Telegram: снимок старой темы растворяется поверх новой.
            if let snapshot = window.snapshotView(afterScreenUpdates: false) {
                window.addSubview(snapshot)
                apply()
                UIView.animate(withDuration: 0.3, delay: 0, options: [.curveEaseInOut]) {
                    snapshot.alpha = 0
                } completion: { _ in snapshot.removeFromSuperview() }
            } else {
                apply()
            }
        } else {
            apply()
        }
        NotificationCenter.default.post(name: .chatThemeDidChange, object: nil)
    }

    /// Итоговая тема окна прямо сейчас (с учётом системной).
    var isDark: Bool {
        (window?.traitCollection.userInterfaceStyle ?? UITraitCollection.current.userInterfaceStyle) == .dark
    }

    func toggle() {
        setMode(isDark ? .light : .dark, animated: true)
    }
}

// MARK: - Палитра

extension UIColor {
    convenience init(rgb: UInt32, alpha: CGFloat = 1) {
        self.init(
            red: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: alpha
        )
    }

    static func dynamic(light: UIColor, dark: UIColor) -> UIColor {
        UIColor { $0.userInterfaceStyle == .dark ? dark : light }
    }
}

/// Цвета чата по мотивам классической темы Telegram (день) и ночной темы.
enum Palette {
    static let accent = UIColor.dynamic(light: UIColor(rgb: 0x007AFF), dark: UIColor(rgb: 0x3E88F7))
    static let destructive = UIColor.systemRed

    static let incomingBubble = UIColor.dynamic(light: .white, dark: UIColor(rgb: 0x262628))
    static let outgoingBubble = UIColor.dynamic(light: UIColor(rgb: 0xE1FFC7), dark: UIColor(rgb: 0x2B5278))
    static let incomingBubbleHighlighted = UIColor.dynamic(light: UIColor(rgb: 0xD9D9D9), dark: UIColor(rgb: 0x3A3A3C))
    static let outgoingBubbleHighlighted = UIColor.dynamic(light: UIColor(rgb: 0xC3EBA6), dark: UIColor(rgb: 0x3B6896))

    static let incomingText = UIColor.dynamic(light: .black, dark: .white)
    static let outgoingText = UIColor.dynamic(light: .black, dark: .white)
    static let incomingMeta = UIColor.dynamic(light: UIColor(rgb: 0x8E8E93), dark: UIColor(rgb: 0x8D8E93))
    static let outgoingMeta = UIColor.dynamic(light: UIColor(rgb: 0x3FA03F, alpha: 0.85), dark: UIColor(rgb: 0x7DA8D3))
    static let outgoingCheck = UIColor.dynamic(light: UIColor(rgb: 0x2DA32D), dark: UIColor(rgb: 0x7DA8D3))
    static let incomingLink = UIColor.dynamic(light: UIColor(rgb: 0x007AFF), dark: UIColor(rgb: 0x6AB2F2))
    static let outgoingLink = UIColor.dynamic(light: UIColor(rgb: 0x004BAD), dark: UIColor(rgb: 0x9CCBFF))
    static let incomingAccent = UIColor.dynamic(light: UIColor(rgb: 0x007AFF), dark: UIColor(rgb: 0x6AB2F2))
    static let outgoingAccent = UIColor.dynamic(light: UIColor(rgb: 0x00A700), dark: UIColor(rgb: 0xB8DCFF))
    static let incomingSecondaryFill = UIColor.dynamic(light: UIColor(rgb: 0x007AFF, alpha: 0.1), dark: UIColor(rgb: 0x6AB2F2, alpha: 0.14))
    static let outgoingSecondaryFill = UIColor.dynamic(light: UIColor(rgb: 0x00A700, alpha: 0.1), dark: UIColor(rgb: 0xB8DCFF, alpha: 0.14))

    /// Плашки дат и служебных сообщений поверх обоев.
    static let serviceFill = UIColor.dynamic(light: UIColor(rgb: 0x000000, alpha: 0.2), dark: UIColor(rgb: 0x000000, alpha: 0.45))
    static let serviceText = UIColor.white

    static let panelBackground = UIColor.dynamic(light: UIColor(rgb: 0xF7F7F7, alpha: 0.86), dark: UIColor(rgb: 0x1C1C1D, alpha: 0.86))
    static let inputFieldBackground = UIColor.dynamic(light: .white, dark: UIColor(rgb: 0x060606))
    static let inputFieldBorder = UIColor.dynamic(light: UIColor(rgb: 0xD9DCE0), dark: UIColor(rgb: 0x2C2C2E))
    static let separator = UIColor.separator
    static let primaryText = UIColor.label
    static let secondaryText = UIColor.secondaryLabel
    static let groupedBackground = UIColor.systemGroupedBackground
    static let searchHighlight = UIColor.dynamic(light: UIColor(rgb: 0xFFD60A, alpha: 0.55), dark: UIColor(rgb: 0xFFD60A, alpha: 0.4))

    static func bubble(outgoing: Bool) -> UIColor { outgoing ? outgoingBubble : incomingBubble }
    static func text(outgoing: Bool) -> UIColor { outgoing ? outgoingText : incomingText }
    static func meta(outgoing: Bool) -> UIColor { outgoing ? outgoingMeta : incomingMeta }
    static func link(outgoing: Bool) -> UIColor { outgoing ? outgoingLink : incomingLink }
    static func accent(outgoing: Bool) -> UIColor { outgoing ? outgoingAccent : incomingAccent }
    static func secondaryFill(outgoing: Bool) -> UIColor { outgoing ? outgoingSecondaryFill : incomingSecondaryFill }

    /// Цвета аватаров-заглушек (градиенты Telegram по id пользователя).
    static let avatarGradients: [(UInt32, UInt32)] = [
        (0xFF885E, 0xFF516A), (0xFFCD6A, 0xFFA85C), (0x82B1FF, 0x665FFF), (0xA0DE7E, 0x54CB68),
        (0x53EDD6, 0x28C9B7), (0x72D5FD, 0x2A9EF1), (0xE0A2F3, 0xD669ED),
    ]
}

// MARK: - Шрифты

enum Fonts {
    /// Текст сообщения — 17 pt, как размер по умолчанию в Telegram.
    static var message: UIFont { UIFont.systemFont(ofSize: 17) }
    static var messageBold: UIFont { UIFont.systemFont(ofSize: 17, weight: .semibold) }
    static var largeEmoji: UIFont { UIFont.systemFont(ofSize: 52) }
    static var meta: UIFont { UIFont.italicSystemFont(ofSize: 11).withSize(11) }
    static var time: UIFont { UIFont.systemFont(ofSize: 11) }
    static var replyName: UIFont { UIFont.systemFont(ofSize: 14, weight: .semibold) }
    static var replyText: UIFont { UIFont.systemFont(ofSize: 14) }
    static var service: UIFont { UIFont.systemFont(ofSize: 13, weight: .medium) }
    static var fileName: UIFont { UIFont.systemFont(ofSize: 16, weight: .medium) }
    static var fileSize: UIFont { UIFont.systemFont(ofSize: 13) }
    static var reaction: UIFont { UIFont.systemFont(ofSize: 14, weight: .medium) }
}

// MARK: - Движение

/// Пружины и кривые. Параметры — по наблюдению за Telegram iOS и его исходникам
/// (`TELEGRAM_CHAT_ANALYSIS.md`): системная «клавиатурная» кривая для смены раскладки,
/// пружина 0.4–0.5 с без перелёта для ленты, с небольшим перелётом — для «живых» элементов.
enum Motion {
    /// Длительность раскладки ленты и панели ввода (у Telegram — 0.4 с, кривая клавиатуры).
    static let layoutDuration: TimeInterval = 0.4
    /// Кривая клавиатуры iOS (UIViewAnimationCurve(rawValue: 7)).
    static let keyboardCurve = UIView.AnimationOptions(rawValue: 7 << 16)

    static var reduceMotion: Bool { UIAccessibility.isReduceMotionEnabled }

    /// Анимация «как у раскладки Telegram»: кривая клавиатуры, 0.4 с.
    @MainActor
    static func layout(
        duration: TimeInterval = layoutDuration,
        delay: TimeInterval = 0,
        _ animations: @escaping () -> Void,
        completion: ((Bool) -> Void)? = nil
    ) {
        if reduceMotion || !UIView.areAnimationsEnabled {
            animations()
            completion?(true)
            return
        }
        UIView.animate(
            withDuration: duration, delay: delay,
            options: [keyboardCurve, .beginFromCurrentState, .allowUserInteraction],
            animations: animations, completion: completion
        )
    }

    /// Пружина без перелёта (лента, перестановка пузырей).
    @MainActor
    static func spring(
        duration: TimeInterval = 0.45,
        bounce: CGFloat = 0,
        initialVelocity: CGFloat = 0,
        _ animations: @escaping () -> Void,
        completion: ((Bool) -> Void)? = nil
    ) {
        if reduceMotion || !UIView.areAnimationsEnabled {
            animations()
            completion?(true)
            return
        }
        UIView.animate(
            springDuration: duration, bounce: bounce, initialSpringVelocity: initialVelocity,
            delay: 0, options: [.beginFromCurrentState, .allowUserInteraction],
            animations: animations, completion: completion
        )
    }

    /// Короткое растворение (появление/исчезание плашек).
    @MainActor
    static func fade(duration: TimeInterval = 0.2, _ animations: @escaping () -> Void, completion: ((Bool) -> Void)? = nil) {
        if !UIView.areAnimationsEnabled {
            animations()
            completion?(true)
            return
        }
        UIView.animate(
            withDuration: duration, delay: 0, options: [.curveEaseInOut, .beginFromCurrentState, .allowUserInteraction],
            animations: animations, completion: completion
        )
    }
}

// MARK: - Тактильный отклик

@MainActor
enum Haptics {
    private static let light = UIImpactFeedbackGenerator(style: .light)
    private static let medium = UIImpactFeedbackGenerator(style: .medium)
    private static let selectionGenerator = UISelectionFeedbackGenerator()
    private static let notification = UINotificationFeedbackGenerator()

    static func impact() { light.impactOccurred() }
    static func impactMedium() { medium.impactOccurred() }
    static func selection() { selectionGenerator.selectionChanged() }
    static func success() { notification.notificationOccurred(.success) }
    static func error() { notification.notificationOccurred(.error) }
    static func prepare() {
        light.prepare()
        selectionGenerator.prepare()
    }
}
