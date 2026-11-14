import QuartzCore
import UIKit
import os

/// Замер плавности прокрутки ленты — по факту, а не на глаз.
///
/// Пока ленту ведёт палец или она катится по инерции, `CADisplayLink` отмечает каждый кадр.
/// Кадр, пришедший позже, чем в полтора своих интервала, — рывок; его опоздание сверх
/// интервала копится во «время рывков». Отношение этого времени к длительности прокрутки
/// (мс на секунду) — та же мера, что hitch ratio у Apple: до 5 мс/с глазу незаметно,
/// от 10 мс/с рывки видны.
///
/// Вторая половина — на что ушло время главного потока за ту же прокрутку: проход
/// раскладки ленты, замер ячеек, сборка секций, применение среза, пересчёт высоты уже
/// стоящей строки. Так видно не только «рвёт», но и что именно рвёт.
///
/// Только отладочная сборка. Отчёт уходит в системный лог (категория `ScrollJank`; на
/// телефоне — `idevicesyslog -m ScrollJank`) и в `accessibilityValue` ленты, откуда его
/// читает замер `ScrollSmoothnessTests`.
@MainActor
final class ScrollJankMonitor: NSObject {
    static let shared = ScrollJankMonitor()

    private override init() {}

    /// Участки работы главного потока, которые меряются.
    enum Work: String, CaseIterable {
        /// Весь проход раскладки ленты (`layoutSubviews`): расстановка, выдача ячеек и их замер.
        case layout
        /// Замер ячейки по содержимому (`preferredLayoutAttributesFitting`) — раскладка SwiftUI.
        case sizing
        /// Наполнение ячейки (`CellRegistration`): сборка `UIHostingConfiguration`.
        case configure
        /// Сборка секции дня раскладкой (`estimatedSection`).
        case section
        /// Применение среза (`dataSource.apply`).
        case apply
    }

    /// Итог прокрутки (или нескольких подряд).
    struct Report: CustomStringConvertible {
        var scrolls = 0
        var duration: CFTimeInterval = 0
        var frames = 0
        var hitches = 0
        var hitchTime: CFTimeInterval = 0
        var worstFrame: CFTimeInterval = 0
        var expectedFrame: CFTimeInterval = 0
        var workTime: [Work: CFTimeInterval] = [:]
        var workCount: [Work: Int] = [:]
        /// Строка, уже стоящая в ленте, сменила высоту после замера.
        var remeasures = 0
        /// Из них — строки выше видимого: их рост сдвигает ленту под пальцем.
        var remeasuresAbove = 0

        /// Время рывков на секунду прокрутки, мс/с.
        var hitchRatio: Double {
            duration > 0 ? hitchTime * 1000 / duration : 0
        }

        var description: String {
            var parts = [
                "scrolls=\(scrolls)",
                String(format: "duration=%.2fs", duration),
                "frames=\(frames)",
                "hitches=\(hitches)",
                String(format: "hitchRatio=%.1fms/s", hitchRatio),
                String(format: "worst=%.1fms", worstFrame * 1000),
                String(format: "frame=%.1fms", expectedFrame * 1000),
                "remeasure=\(remeasures)",
                "remeasureAbove=\(remeasuresAbove)",
            ]
            for work in Work.allCases {
                let time = (workTime[work] ?? 0) * 1000
                parts.append(String(format: "%@=%.1fms/%d", work.rawValue, time, workCount[work] ?? 0))
            }
            return parts.joined(separator: " ")
        }
    }

    #if DEBUG
        static let isEnabled = true
    #else
        static let isEnabled = false
    #endif

    private(set) var report = Report()
    /// Лента, в чьё `accessibilityValue` пишется отчёт (для замера в UI-тестах).
    weak var reportTarget: UIView?

    private var link: CADisplayLink?
    private var lastFrame: CFTimeInterval = 0
    private var startedAt: CFTimeInterval = 0
    private let log = Logger(subsystem: "kz.studenthub", category: "ScrollJank")

    var isScrolling: Bool { link != nil }

    /// Палец взял ленту. Повторный вызов посреди прокрутки (взмах по катящейся) — та же прокрутка.
    func begin() {
        guard Self.isEnabled, link == nil else { return }
        let link = CADisplayLink(target: self, selector: #selector(frame(_:)))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
        link.add(to: .main, forMode: .common)
        self.link = link
        lastFrame = 0
        startedAt = CACurrentMediaTime()
        report.scrolls += 1
        reportTarget?.accessibilityValue = "active=1 \(report.description)"
    }

    /// Лента встала.
    func end() {
        guard let link else { return }
        link.invalidate()
        self.link = nil
        report.duration += CACurrentMediaTime() - startedAt
        log.notice("ScrollJank \(self.report.description, privacy: .public)")
        reportTarget?.accessibilityValue = "active=0 \(report.description)"
    }

    /// Сбросить накопленное — новый замер.
    func reset() {
        report = Report()
        reportTarget?.accessibilityValue = nil
    }

    /// Засечь участок работы. Вне прокрутки не копится: замер — про кадры под пальцем.
    func measure<T>(_ work: Work, _ body: () -> T) -> T {
        guard Self.isEnabled, link != nil else { return body() }
        let start = CACurrentMediaTime()
        let result = body()
        report.workTime[work, default: 0] += CACurrentMediaTime() - start
        report.workCount[work, default: 0] += 1
        return result
    }

    func noteRemeasure(above: Bool) {
        guard Self.isEnabled, link != nil else { return }
        report.remeasures += 1
        if above { report.remeasuresAbove += 1 }
    }

    @objc private func frame(_ link: CADisplayLink) {
        let now = link.timestamp
        let expected = link.targetTimestamp - link.timestamp
        defer { lastFrame = now }
        guard lastFrame > 0, expected > 0 else { return }
        let interval = now - lastFrame
        report.frames += 1
        report.expectedFrame = expected
        report.worstFrame = max(report.worstFrame, interval)
        if interval > expected * 1.5 {
            report.hitches += 1
            report.hitchTime += interval - expected
        }
    }
}
