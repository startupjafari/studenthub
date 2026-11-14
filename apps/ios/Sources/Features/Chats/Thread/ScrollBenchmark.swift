import QuartzCore
import UIKit
import os

/// Прокрутка ленты самим приложением — для замера без XCUITest (`scripts/test.sh bench`).
///
/// Замер через UI-тест мерил в основном сам тест: раннер включает в приложении
/// доступность и на каждом взмахе опрашивает дерево элементов на главном потоке, и
/// проход раскладки ленты дорожал вдвое. Здесь приложение запускается обычным
/// `simctl launch`, чат открывается ссылкой, а взмахи делает этот тип: скорость и
/// торможение — как у `UIScrollView` (`decelerationRate.normal`, 0,998 за мс).
///
/// Сценарий тот же, что у `ScrollSmoothnessTests`: восемь взмахов вверх через историю с
/// догрузкой страниц, затем четыре обратно. Итог — две строки `SCROLL_BENCH` (после
/// взмахов вверх и за весь прогон) в `tmp/scroll-bench.txt` контейнера приложения и в
/// системном логе. Только отладочная сборка, включается `SH_SCROLL_BENCH=<имя>`.
@MainActor
final class ScrollBenchmark: NSObject {
    /// Имя прогона из окружения; `nil` — замер не просили.
    static let requested: String? = {
        #if DEBUG
            let value = ProcessInfo.processInfo.environment["SH_SCROLL_BENCH"] ?? ""
            return value.isEmpty ? nil : value
        #else
            return nil
        #endif
    }()

    /// Скорость взмаха, pt/с: быстрый взмах пальцем.
    private static let flingSpeed: CGFloat = 7000
    private static let deceleration: CGFloat = 0.998

    private static var running: ScrollBenchmark?

    private let name: String
    private weak var scrollView: UIScrollView?
    private var flings: [CGFloat]
    private var link: CADisplayLink?
    private var velocity: CGFloat = 0
    private var lastTick: CFTimeInterval = 0
    private var lines: [String] = []
    private let log = Logger(subsystem: "kz.studenthub", category: "ScrollJank")

    private init(name: String, scrollView: UIScrollView) {
        self.name = name
        self.scrollView = scrollView
        // Вверх — к старым сообщениям, смещение уменьшается.
        flings = Array(repeating: -Self.flingSpeed, count: 8) + Array(repeating: Self.flingSpeed, count: 4)
    }

    /// Лента расставлена — через полторы секунды покоя начать, если замер просили.
    static func startIfRequested(on scrollView: UIScrollView) {
        guard let name = requested, running == nil else { return }
        let benchmark = ScrollBenchmark(name: name, scrollView: scrollView)
        running = benchmark
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(1500))
            benchmark.start()
        }
    }

    private func start() {
        ScrollJankMonitor.shared.reset()
        ScrollJankMonitor.shared.begin()
        nextFling()
    }

    private func nextFling() {
        guard !flings.isEmpty else { return finish() }
        // Смена направления — снимок «после взмахов вверх» и новая прокрутка.
        if let next = flings.first, next > 0, lines.isEmpty {
            ScrollJankMonitor.shared.end()
            lines.append("SCROLL_BENCH variant=\(name) older \(ScrollJankMonitor.shared.report)")
            ScrollJankMonitor.shared.begin()
        }
        velocity = flings.removeFirst()
        lastTick = 0
        let link = CADisplayLink(target: self, selector: #selector(tick(_:)))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
        link.add(to: .main, forMode: .common)
        self.link = link
    }

    @objc private func tick(_ link: CADisplayLink) {
        guard let scrollView else { return finish() }
        defer { lastTick = link.timestamp }
        guard lastTick > 0 else { return }
        let elapsed = link.timestamp - lastTick
        let inset = scrollView.adjustedContentInset
        let lowest = -inset.top
        let highest = max(lowest, scrollView.contentSize.height - scrollView.bounds.height + inset.bottom)
        let target = scrollView.contentOffset.y + velocity * elapsed
        let clamped = min(max(target, lowest), highest)
        scrollView.contentOffset.y = clamped
        velocity *= pow(Self.deceleration, elapsed * 1000)
        // Упёрлись в край или взмах выдохся — следующий. У края загруженного — как
        // человек, с паузой: страница догрузки успевает приехать.
        let hitEdge = clamped != target
        if hitEdge || abs(velocity) < 30 {
            link.invalidate()
            self.link = nil
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(hitEdge ? 400 : 50))
                self.nextFling()
            }
        }
    }

    private func finish() {
        link?.invalidate()
        link = nil
        ScrollJankMonitor.shared.end()
        lines.append("SCROLL_BENCH variant=\(name) total \(ScrollJankMonitor.shared.report)")
        let text = lines.joined(separator: "\n") + "\n"
        for line in lines { log.notice("\(line, privacy: .public)") }
        let file = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("scroll-bench.txt")
        try? text.write(to: file, atomically: true, encoding: .utf8)
        Self.running = nil
    }
}
