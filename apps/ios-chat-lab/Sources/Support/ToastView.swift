import UIKit

/// Плашка-уведомление над панелью ввода («Скопировано», «Переслано», «Удалено · Отменить»).
@MainActor
enum Toast {
    private static weak var current: ToastView?

    static func show(_ text: String, icon: String? = nil, in view: UIView, bottomInset: CGFloat, actionTitle: String? = nil, action: (() -> Void)? = nil) {
        current?.dismiss(animated: false)
        let toast = ToastView(text: text, icon: icon, actionTitle: actionTitle, action: action)
        view.addSubview(toast)
        let width = min(view.bounds.width - 16, 480)
        toast.frame = CGRect(x: (view.bounds.width - width) / 2, y: view.bounds.height - bottomInset - 60, width: width, height: 50)
        toast.present()
        current = toast
        UIAccessibility.post(notification: .announcement, argument: text)
    }
}

final class ToastView: UIView {
    private let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemMaterialDark))
    private let iconView = UIImageView()
    private let label = UILabel()
    private let button = UIButton(type: .system)
    private var hideWork: DispatchWorkItem?
    private let action: (() -> Void)?

    init(text: String, icon: String?, actionTitle: String?, action: (() -> Void)?) {
        self.action = action
        super.init(frame: .zero)
        layer.cornerRadius = 14
        layer.cornerCurve = .continuous
        clipsToBounds = true
        addSubview(blur)
        iconView.image = icon.flatMap { UIImage(systemName: $0) }
        iconView.tintColor = .white
        iconView.contentMode = .scaleAspectFit
        addSubview(iconView)
        label.text = text
        label.textColor = .white
        label.font = .systemFont(ofSize: 15)
        label.numberOfLines = 2
        addSubview(label)
        if let actionTitle {
            button.setTitle(actionTitle, for: .normal)
            button.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
            button.tintColor = UIColor(rgb: 0x5AC8FA)
            button.addAction(UIAction { [weak self] _ in
                self?.action?()
                self?.dismiss(animated: true)
            }, for: .touchUpInside)
            addSubview(button)
        }
        accessibilityIdentifier = "toast"
        isAccessibilityElement = false
        label.accessibilityIdentifier = "toast.text"
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        blur.frame = bounds
        let hasIcon = iconView.image != nil
        iconView.frame = CGRect(x: 14, y: (bounds.height - 22) / 2, width: 22, height: 22)
        let buttonWidth: CGFloat = button.superview == nil ? 0 : button.intrinsicContentSize.width + 24
        button.frame = CGRect(x: bounds.width - buttonWidth, y: 0, width: buttonWidth, height: bounds.height)
        let x: CGFloat = hasIcon ? 46 : 16
        label.frame = CGRect(x: x, y: 0, width: bounds.width - x - buttonWidth - 12, height: bounds.height)
    }

    func present() {
        alpha = 0
        transform = CGAffineTransform(translationX: 0, y: 20).scaledBy(x: 0.95, y: 0.95)
        Motion.spring(duration: 0.4, bounce: 0.15) {
            self.alpha = 1
            self.transform = .identity
        }
        let work = DispatchWorkItem { [weak self] in MainActor.assumeIsolated { self?.dismiss(animated: true) } }
        hideWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + (action == nil ? 2.2 : 4), execute: work)
    }

    func dismiss(animated: Bool) {
        hideWork?.cancel()
        guard animated else {
            removeFromSuperview()
            return
        }
        Motion.fade(duration: 0.2, {
            self.alpha = 0
            self.transform = CGAffineTransform(translationX: 0, y: 10)
        }, completion: { _ in self.removeFromSuperview() })
    }
}
