import UIKit

/// Кривая Безье (как CAMediaTimingFunction), вычисляемая покадрово — для анимаций, которые
/// ведёт display link (прокрутка к сообщению: ячейки должны подгружаться на каждом кадре,
/// а анимация `bounds` через UIView этого не делает).
struct BezierCurve {
    let p1: CGPoint
    let p2: CGPoint

    /// Кривая `.spring` Telegram для произвольной длительности.
    static let telegramSpring = BezierCurve(p1: CGPoint(x: 0.38, y: 0.70), p2: CGPoint(x: 0.125, y: 1.0))
    /// Вертикаль полёта отправленного сообщения.
    static let sendVertical = BezierCurve(p1: CGPoint(x: 0.199, y: 0.011), p2: CGPoint(x: 0.279, y: 0.910))
    /// Горизонталь полёта отправленного сообщения.
    static let sendHorizontal = BezierCurve(p1: CGPoint(x: 0.23, y: 1.0), p2: CGPoint(x: 0.32, y: 1.0))

    var timingFunction: CAMediaTimingFunction {
        CAMediaTimingFunction(controlPoints: Float(p1.x), Float(p1.y), Float(p2.x), Float(p2.y))
    }

    func value(at t: CGFloat) -> CGFloat {
        guard t > 0 else { return 0 }
        guard t < 1 else { return 1 }
        // Найти параметр s, при котором x(s) = t (Ньютон + бисекция), вернуть y(s).
        func bezier(_ s: CGFloat, _ a: CGFloat, _ b: CGFloat) -> CGFloat {
            let inv = 1 - s
            return 3 * inv * inv * s * a + 3 * inv * s * s * b + s * s * s
        }
        func derivative(_ s: CGFloat, _ a: CGFloat, _ b: CGFloat) -> CGFloat {
            let inv = 1 - s
            return 3 * inv * inv * a + 6 * inv * s * (b - a) + 3 * s * s * (1 - b)
        }
        var s = t
        for _ in 0..<8 {
            let x = bezier(s, p1.x, p2.x) - t
            let d = derivative(s, p1.x, p2.x)
            if abs(x) < 1e-5 { break }
            if abs(d) < 1e-6 { break }
            s -= x / d
        }
        if s < 0 || s > 1 || abs(bezier(s, p1.x, p2.x) - t) > 1e-3 {
            var low: CGFloat = 0
            var high: CGFloat = 1
            s = t
            for _ in 0..<30 {
                let x = bezier(s, p1.x, p2.x)
                if abs(x - t) < 1e-5 { break }
                if x < t { low = s } else { high = s }
                s = (low + high) / 2
            }
        }
        return bezier(s, p1.y, p2.y)
    }
}

/// Плавная прокрутка display link'ом: прерывается касанием (как прокрутка Telegram к сообщению).
@MainActor
final class ScrollAnimator {
    private weak var scrollView: UIScrollView?
    private var displayLink: CADisplayLink?
    private var start: CGFloat = 0
    private var target: CGFloat = 0
    private var startTime: CFTimeInterval = 0
    private var duration: CFTimeInterval = 0.4
    private var curve = BezierCurve.telegramSpring
    private var completion: (() -> Void)?

    init(scrollView: UIScrollView) {
        self.scrollView = scrollView
    }

    var isAnimating: Bool { displayLink != nil }

    func animate(to offsetY: CGFloat, duration: CFTimeInterval = 0.4, curve: BezierCurve = .telegramSpring, completion: (() -> Void)? = nil) {
        guard let scrollView else { return }
        cancel()
        if Motion.reduceMotion || !UIView.areAnimationsEnabled || abs(scrollView.contentOffset.y - offsetY) < 0.5 {
            scrollView.contentOffset.y = offsetY
            completion?()
            return
        }
        start = scrollView.contentOffset.y
        target = offsetY
        self.duration = duration
        self.curve = curve
        self.completion = completion
        startTime = CACurrentMediaTime()
        let link = CADisplayLink(target: DisplayLinkProxy(self), selector: #selector(DisplayLinkProxy.tick))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    func cancel() {
        displayLink?.invalidate()
        displayLink = nil
        completion = nil
    }

    fileprivate func tick() {
        guard let scrollView else { cancel(); return }
        if scrollView.isTracking {
            // Палец на экране — анимация уступает жесту.
            cancel()
            return
        }
        let t = min(1, (CACurrentMediaTime() - startTime) / duration)
        let value = curve.value(at: CGFloat(t))
        scrollView.contentOffset.y = start + (target - start) * value
        if t >= 1 {
            let completion = self.completion
            cancel()
            completion?()
        }
    }

    private final class DisplayLinkProxy: NSObject {
        weak var owner: ScrollAnimator?
        init(_ owner: ScrollAnimator) { self.owner = owner }
        @objc func tick() { MainActor.assumeIsolated { owner?.tick() } }
    }
}
