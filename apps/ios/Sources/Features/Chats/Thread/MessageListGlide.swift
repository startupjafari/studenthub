import QuartzCore
import UIKit

/// Плавная прокрутка ленты к низу, цель которой читается заново на каждом кадре.
///
/// Системная `setContentOffset(_:animated:)` едет к низу, посчитанному в момент вызова.
/// Новое сообщение в этот момент стоит в ленте по оценочной высоте и меряет себя, только
/// въехав на экран, — посреди анимации. Низ уезжал, анимация доезжала до старого места,
/// и лента второй анимацией догоняла настоящий низ: рывок в конце каждой отправки. Здесь
/// цель живая: сообщение досчитало высоту, поле ввода сменило высоту, у последнего пузыря
/// выросла строка реакций — пружина просто продолжает движение к новому низу, не теряя
/// скорости.
///
/// Пружина критически затухающая, по точному решению на каждом кадре: без перелёта и
/// устойчиво при любом шаге кадра.
@MainActor
final class MessageListGlide {
    weak var scrollView: UIScrollView?
    /// Где низ ленты сейчас.
    var target: () -> CGFloat = { 0 }
    /// Лента встала на низ.
    var onFinish: () -> Void = {}

    private var link: CADisplayLink?
    private var velocity: CGFloat = 0
    private var lastTimestamp: CFTimeInterval?

    /// Время отклика как у `Motion.lively` (0,3 с), но без отскока: лента у края не
    /// пружинит.
    private static let omega: CGFloat = 2 * .pi / 0.3

    var isRunning: Bool { link != nil }

    /// Начать движение к низу. Идущее движение не перезапускается — оно и так едет к
    /// живой цели, а перезапуск обнулил бы скорость.
    func start() {
        guard link == nil else { return }
        velocity = 0
        lastTimestamp = nil
        let link = CADisplayLink(target: Ticker(owner: self), selector: #selector(Ticker.tick(_:)))
        link.add(to: .main, forMode: .common)
        self.link = link
    }

    func stop() {
        link?.invalidate()
        link = nil
        velocity = 0
    }

    fileprivate func tick(_ link: CADisplayLink) {
        // Палец на ленте — двигает её человек.
        guard let scrollView, !scrollView.isTracking else {
            stop()
            return
        }
        let now = link.targetTimestamp
        // Первый кадр и кадр после паузы (приложение уходило в фон) — шаг одного кадра.
        let step = lastTimestamp.map { now - $0 } ?? link.duration
        let dt = CGFloat(min(max(step, 0), 1.0 / 30))
        lastTimestamp = now

        let goal = target()
        let w = Self.omega
        let x0 = scrollView.contentOffset.y - goal
        let v0 = velocity
        let decay = exp(-w * dt)
        let x = (x0 + (v0 + w * x0) * dt) * decay
        let v = (v0 - w * (v0 + w * x0) * dt) * decay
        if abs(x) < 0.5, abs(v) < 10 {
            if abs(scrollView.contentOffset.y - goal) > 0.01 {
                scrollView.contentOffset.y = goal
            }
            stop()
            onFinish()
            return
        }
        velocity = v
        scrollView.contentOffset.y = goal + x
    }
}

/// Цель `CADisplayLink`: ссылка держит её сильно, а пружину — нет. Пропала лента — ссылка
/// снимает себя сама.
@MainActor
private final class Ticker: NSObject {
    weak var owner: MessageListGlide?

    init(owner: MessageListGlide) {
        self.owner = owner
    }

    @objc func tick(_ link: CADisplayLink) {
        guard let owner else {
            link.invalidate()
            return
        }
        owner.tick(link)
    }
}

/// Лента, сообщающая о смене высоты содержимого: досчёт высоты пузыря, догрузка картинки,
/// реакция меняют её без прокрутки, и иначе об этом не узнать.
final class MessageCollectionView: UICollectionView {
    /// Высота содержимого сменилась; аргумент — прежняя.
    var onContentHeightChange: ((CGFloat) -> Void)?

    override var contentSize: CGSize {
        didSet {
            guard abs(oldValue.height - contentSize.height) > 0.5 else { return }
            onContentHeightChange?(oldValue.height)
        }
    }
}
