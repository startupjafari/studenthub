import UIKit
import os

/// Замер темпа кадров главного потока прямо в приложении.
///
/// Что меряет: интервалы между вызовами `CADisplayLink`. Если главный поток занят (раскладка,
/// декодирование, перерисовка), вызов приходит позже — это и есть рывок («hitch»). Порог —
/// интервал больше 1,5 ожидаемой длительности кадра (8,3 мс на 120 Гц, 16,7 мс на 60 Гц).
/// Это не замена Instruments → Animation Hitches (тот видит и рендер-сервер), но цифры
/// настоящие, считаются на устройстве и читаются UI-тестами.
///
/// Как читать из тестов: в окне висит невидимый элемент доступности `perf.summary`, его
/// `value` — JSON вида `{"fps":118.9,"hitches":0,"hitchRatioMsPerS":0,"worstMs":9.1,"frames":…}`.
///
/// Instruments/XCTest: каждое взаимодействие (`beginInteraction`/`endInteraction`) — интервал
/// os_signpost в подсистеме `kz.studenthub.chatlab`, категория `PointsOfInterest`, имя
/// `Interaction` (для `XCTOSSignpostMetric(subsystem:category:name:)`).
@MainActor
final class PerformanceMonitor {
    static let shared = PerformanceMonitor()

    static let signpostSubsystem = "kz.studenthub.chatlab"
    static let signpostName: StaticString = "Interaction"

    struct Stats: Codable {
        var frames = 0
        var hitches = 0
        /// Сумма «лишнего» времени рывков, мс.
        var hitchTimeMs: Double = 0
        var worstMs: Double = 0
        var seconds: Double = 0

        var fps: Double { seconds > 0 ? Double(frames) / seconds : 0 }
        var hitchRatioMsPerS: Double { seconds > 0 ? hitchTimeMs / seconds : 0 }

        mutating func add(intervalMs: Double, expectedMs: Double) {
            frames += 1
            seconds += intervalMs / 1000
            worstMs = max(worstMs, intervalMs)
            if intervalMs > expectedMs * 1.5 {
                hitches += 1
                hitchTimeMs += intervalMs - expectedMs
            }
        }

        var dictionary: [String: Any] {
            [
                "fps": round1(fps), "hitches": hitches, "hitchRatioMsPerS": round1(hitchRatioMsPerS),
                "worstMs": round1(worstMs), "frames": frames, "seconds": round1(seconds),
            ]
        }

        private func round1(_ value: Double) -> Double { (value * 10).rounded() / 10 }
    }

    /// Всё время активности (прокрутка, жесты, анимации, которые отметил код).
    private(set) var total = Stats()
    /// По именам взаимодействий («scroll», «contextMenu», …).
    private(set) var interactions: [String: Stats] = [:]
    /// Последняя секунда — для оверлея.
    private var window = Stats()
    private var windowStart: CFTimeInterval = 0

    private var link: CADisplayLink?
    private var lastTimestamp: CFTimeInterval = 0
    private var activeUntil: CFTimeInterval = 0
    private var activeNames: [String: OSSignpostIntervalState] = [:]
    private let signposter = OSSignposter(subsystem: PerformanceMonitor.signpostSubsystem, category: .pointsOfInterest)

    private var summaryLabel: UILabel?
    private var overlayLabel: UILabel?
    private var lastPublish: CFTimeInterval = 0

    private(set) var isOverlayVisible = false

    private init() {
        if ProcessInfo.processInfo.arguments.contains("-perfOverlay") {
            DispatchQueue.main.async { MainActor.assumeIsolated { self.setOverlayVisible(true) } }
        }
    }

    // MARK: Активность

    /// Прокрутка ленты: считаем кадры ещё 0,3 с после последнего события.
    func noteScroll() {
        markActive(for: 0.3)
    }

    /// Любая анимация, кадры которой стоит посчитать.
    func markActive(for duration: TimeInterval) {
        activeUntil = max(activeUntil, CACurrentMediaTime() + duration)
        ensureRunning()
    }

    func beginInteraction(_ name: String) {
        if activeNames[name] == nil {
            let id = signposter.makeSignpostID()
            activeNames[name] = signposter.beginInterval(Self.signpostName, id: id, "\(name, privacy: .public)")
        }
        ensureRunning()
    }

    func endInteraction(_ name: String) {
        guard let state = activeNames.removeValue(forKey: name) else { return }
        signposter.endInterval(Self.signpostName, state)
        markActive(for: 0.1)
        publish(force: true)
    }

    /// Обнулить счётчики (перед замером в тесте или из Debug Menu).
    func reset() {
        total = Stats()
        interactions = [:]
        window = Stats()
        windowStart = CACurrentMediaTime()
        publish(force: true)
    }

    // MARK: Display link

    private func ensureRunning() {
        installSummaryElementIfNeeded()
        if link == nil {
            let link = CADisplayLink(target: Proxy(self), selector: #selector(Proxy.tick(_:)))
            let maxFPS = Float(maxFramesPerSecond)
            link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: maxFPS, preferred: maxFPS)
            link.add(to: .main, forMode: .common)
            self.link = link
            lastTimestamp = 0
        }
        if link?.isPaused == true {
            link?.isPaused = false
            lastTimestamp = 0
        }
    }

    private var maxFramesPerSecond: Int {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        return scene?.screen.maximumFramesPerSecond ?? 60
    }

    fileprivate func tick(_ link: CADisplayLink) {
        let now = link.timestamp
        let expectedMs = max(1, (link.targetTimestamp - link.timestamp) * 1000)
        defer { lastTimestamp = now }
        let isActive = now < activeUntil || !activeNames.isEmpty
        if lastTimestamp > 0, isActive || isOverlayVisible {
            let intervalMs = (now - lastTimestamp) * 1000
            // Пауза после простоя (ссылка была остановлена) — не рывок.
            if intervalMs < 1000 {
                if isActive {
                    total.add(intervalMs: intervalMs, expectedMs: expectedMs)
                    for name in activeNames.keys {
                        interactions[name, default: Stats()].add(intervalMs: intervalMs, expectedMs: expectedMs)
                    }
                }
                window.add(intervalMs: intervalMs, expectedMs: expectedMs)
            }
        }
        if now - windowStart > 1 {
            updateOverlay()
            window = Stats()
            windowStart = now
        }
        publish(force: false)
        if !isActive, !isOverlayVisible {
            // Простой: не держим экран на 120 Гц зря.
            link.isPaused = true
            publish(force: true)
        }
    }

    // MARK: Сводка

    var summaryDictionary: [String: Any] {
        var dictionary = total.dictionary
        dictionary["maxFps"] = maxFramesPerSecond
        dictionary["interactions"] = interactions.mapValues { $0.dictionary }
        return dictionary
    }

    var summaryString: String {
        guard let data = try? JSONSerialization.data(withJSONObject: summaryDictionary, options: [.sortedKeys]),
              let string = String(data: data, encoding: .utf8) else { return "{}" }
        return string
    }

    private func publish(force: Bool) {
        let now = CACurrentMediaTime()
        guard force || now - lastPublish > 0.25 else { return }
        lastPublish = now
        installSummaryElementIfNeeded()
        summaryLabel?.accessibilityValue = summaryString
    }

    private var keyWindow: UIWindow? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first { $0.isKeyWindow }
    }

    /// Невидимый (но доступный для XCUITest) элемент со сводкой.
    private func installSummaryElementIfNeeded() {
        guard summaryLabel?.window == nil, let window = keyWindow else { return }
        let label = UILabel(frame: CGRect(x: 0, y: window.bounds.height - 1, width: 1, height: 1))
        label.alpha = 0.02
        label.isUserInteractionEnabled = false
        label.isAccessibilityElement = true
        label.accessibilityIdentifier = "perf.summary"
        label.accessibilityLabel = "perf"
        label.accessibilityValue = summaryString
        label.autoresizingMask = [.flexibleTopMargin]
        window.addSubview(label)
        summaryLabel = label
    }

    // MARK: Оверлей

    func setOverlayVisible(_ visible: Bool) {
        isOverlayVisible = visible
        if visible {
            guard let window = keyWindow else { return }
            if overlayLabel == nil {
                let label = PaddedLabel()
                label.font = .monospacedDigitSystemFont(ofSize: 11, weight: .medium)
                label.textColor = .white
                label.backgroundColor = UIColor.black.withAlphaComponent(0.6)
                label.layer.cornerRadius = 6
                label.layer.masksToBounds = true
                label.isUserInteractionEnabled = false
                label.accessibilityIdentifier = "perf.overlay"
                overlayLabel = label
            }
            if let label = overlayLabel, label.superview !== window {
                window.addSubview(label)
            }
            updateOverlay()
            ensureRunning()
        } else {
            overlayLabel?.removeFromSuperview()
        }
    }

    private func updateOverlay() {
        guard isOverlayVisible, let label = overlayLabel, let window = label.window else { return }
        label.text = String(
            format: "%.0f fps · hitch %d · worst %.1f ms", window.isKeyWindow ? self.window.fps : 0,
            total.hitches, total.worstMs
        )
        label.sizeToFit()
        let top = window.safeAreaInsets.top + 2
        label.frame = CGRect(x: 8, y: top, width: label.bounds.width, height: label.bounds.height)
        window.bringSubviewToFront(label)
    }

    private final class Proxy: NSObject {
        weak var owner: PerformanceMonitor?
        init(_ owner: PerformanceMonitor) { self.owner = owner }
        @objc func tick(_ link: CADisplayLink) { MainActor.assumeIsolated { owner?.tick(link) } }
    }

    private final class PaddedLabel: UILabel {
        override func drawText(in rect: CGRect) { super.drawText(in: rect.insetBy(dx: 6, dy: 3)) }
        override var intrinsicContentSize: CGSize {
            let size = super.intrinsicContentSize
            return CGSize(width: size.width + 12, height: size.height + 6)
        }
        override func sizeThatFits(_ size: CGSize) -> CGSize {
            let fitted = super.sizeThatFits(size)
            return CGSize(width: fitted.width + 12, height: fitted.height + 6)
        }
    }
}
