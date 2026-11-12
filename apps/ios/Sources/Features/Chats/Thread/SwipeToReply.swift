import UIKit

/// Ответ свайпом влево, как в Telegram: пузырь уезжает за пальцем, справа проявляется
/// круглая стрелка; за порогом — лёгкий толчок, отпустил — ответ на это сообщение.
///
/// Жест — на ленте целиком (UIKit), а не в пузыре: он начинается только при явном
/// движении влево и не спорит с прокруткой, долгим нажатием (меню) и свайпом «назад»
/// от левого края.
@MainActor
final class SwipeToReply: NSObject, UIGestureRecognizerDelegate {
    /// Сообщение под пальцем, на которое можно ответить; `nil` — свайп не начинается.
    var target: (CGPoint) -> (cell: UICollectionViewCell, message: MessageRecord)? = { _ in nil }
    var onReply: (MessageRecord) -> Void = { _ in }

    private static let threshold: CGFloat = 64
    private static let arrowSide: CGFloat = 32

    private weak var collectionView: UICollectionView?
    private let pan = UIPanGestureRecognizer()
    private let arrow = UIImageView()
    private let feedback = UIImpactFeedbackGenerator(style: .light)
    private var cell: UICollectionViewCell?
    private var message: MessageRecord?
    private var armed = false

    func attach(to collectionView: UICollectionView) {
        self.collectionView = collectionView
        pan.addTarget(self, action: #selector(handle(_:)))
        pan.delegate = self
        collectionView.addGestureRecognizer(pan)
        // Прокрутка ждёт решения свайпа: он отказывается сразу, если движение не влево.
        collectionView.panGestureRecognizer.require(toFail: pan)

        let symbol = UIImage.SymbolConfiguration(pointSize: 15, weight: .semibold)
        arrow.image = UIImage(systemName: "arrowshape.turn.up.left.fill", withConfiguration: symbol)
        arrow.tintColor = .white
        arrow.contentMode = .center
        arrow.backgroundColor = UIColor.black.withAlphaComponent(0.35)
        arrow.frame = CGRect(x: 0, y: 0, width: Self.arrowSide, height: Self.arrowSide)
        arrow.layer.cornerRadius = Self.arrowSide / 2
        arrow.clipsToBounds = true
        arrow.isUserInteractionEnabled = false
        arrow.isAccessibilityElement = false
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard gestureRecognizer === pan, let collectionView else { return true }
        let velocity = pan.velocity(in: collectionView)
        guard velocity.x < 0, abs(velocity.x) > abs(velocity.y) * 1.5 else { return false }
        return target(pan.location(in: collectionView)) != nil
    }

    @objc private func handle(_ pan: UIPanGestureRecognizer) {
        guard let collectionView else { return }
        switch pan.state {
        case .began:
            guard let found = target(pan.location(in: collectionView)) else { return }
            cell = found.cell
            message = found.message
            armed = false
            feedback.prepare()
            arrow.alpha = 0
            arrow.transform = CGAffineTransform(scaleX: 0.4, y: 0.4)
            collectionView.addSubview(arrow)
            place(shift: 0)
        case .changed:
            guard let cell else { return }
            let pulled = max(0, -pan.translation(in: collectionView).x)
            // За порогом пузырь идёт туже — как резинка.
            let shift = pulled < Self.threshold ? pulled : Self.threshold + (pulled - Self.threshold) * 0.3
            cell.contentView.transform = CGAffineTransform(translationX: -shift, y: 0)
            place(shift: shift)
            let progress = min(1, shift / Self.threshold)
            arrow.alpha = progress
            let nowArmed = shift >= Self.threshold
            if nowArmed != armed {
                armed = nowArmed
                if armed { feedback.impactOccurred() }
                UIView.animate(withDuration: 0.2, delay: 0, usingSpringWithDamping: 0.5, initialSpringVelocity: 0, options: [.allowUserInteraction, .beginFromCurrentState]) {
                    self.arrow.transform = nowArmed ? .identity : CGAffineTransform(scaleX: 0.7, y: 0.7)
                }
            } else if !armed {
                let scale = 0.4 + 0.3 * progress
                arrow.transform = CGAffineTransform(scaleX: scale, y: scale)
            }
        case .ended, .cancelled, .failed:
            if pan.state == .ended, armed, let message { onReply(message) }
            reset()
        default:
            break
        }
    }

    /// Стрелка — посередине открывшегося справа места, не ближе к краю, чем на свой радиус.
    private func place(shift: CGFloat) {
        guard let cell else { return }
        let x = cell.frame.maxX - max(Self.arrowSide / 2 + 8, shift / 2)
        arrow.center = CGPoint(x: x, y: cell.frame.midY)
    }

    private func reset() {
        let cell = self.cell
        self.cell = nil
        message = nil
        armed = false
        let still = UIAccessibility.isReduceMotionEnabled
        UIView.animate(
            withDuration: still ? 0 : 0.35,
            delay: 0,
            usingSpringWithDamping: 0.8,
            initialSpringVelocity: 0,
            options: [.allowUserInteraction, .beginFromCurrentState]
        ) {
            cell?.contentView.transform = .identity
            self.arrow.alpha = 0
        } completion: { _ in
            // Новый свайп мог начаться, пока ехала эта анимация.
            if self.cell == nil { self.arrow.removeFromSuperview() }
        }
    }
}
