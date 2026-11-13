import SwiftUI
import XCTest

@testable import StudentHub

/// Физика системы анимаций (`Motion`) — без экрана: пружина считается покадрово,
/// как её рисовал бы дисплей на 60 и 120 Гц.
///
/// Статический снимок не видит движения, поэтому здесь проверяется сама траектория:
/// начало и конец, отсутствие скачков между кадрами, перелёт, время успокоения,
/// непрерывность при перехвате на лету.
final class MotionTests: XCTestCase {
    private static let refreshRates: [Double] = [60, 120]

    /// Траектория от 0 к 1 с шагом кадра до `duration` секунд.
    private func frames(_ spring: Spring, hz: Double, duration: Double = 1.5) -> [Double] {
        let step = 1 / hz
        return stride(from: 0.0, through: duration, by: step).map { spring.value(target: 1.0, time: $0) }
    }

    /// Первый момент, после которого значение навсегда в пределах `epsilon` от цели.
    private func settleTime(_ spring: Spring, epsilon: Double = 0.005, hz: Double = 240) -> Double {
        let values = frames(spring, hz: hz, duration: 3)
        var last = 0
        for (index, value) in values.enumerated() where abs(1 - value) > epsilon { last = index }
        return Double(last + 1) / hz
    }

    // MARK: - Начало, конец, отсутствие зависаний

    func testEverySpringStartsAtOriginAndReachesTarget() {
        for (name, spring) in allSprings {
            XCTAssertEqual(spring.value(target: 1.0, time: 0), 0, accuracy: 1e-9, "\(name): не с нуля")
            XCTAssertEqual(spring.value(target: 1.0, time: 2), 1, accuracy: 1e-3, "\(name): не доехала за 2 с")
            XCTAssertLessThan(settleTime(spring), 1.0, "\(name): успокаивается дольше секунды — «зависшее» состояние")
        }
    }

    // MARK: - Без перелёта там, где он не нужен

    func testCriticallyDampedSpringsNeverOvershootAndNeverGoBack() {
        for (name, spring) in [("calm", Motion.Springs.calm), ("snappy", Motion.Springs.snappy),
                               ("press", Motion.Springs.press)] {
            for hz in Self.refreshRates {
                let values = frames(spring, hz: hz)
                XCTAssertLessThanOrEqual(values.max() ?? 0, 1.001, "\(name)@\(Int(hz))Гц: перелёт")
                for (previous, next) in zip(values, values.dropFirst()) {
                    XCTAssertGreaterThanOrEqual(next, previous - 1e-9, "\(name)@\(Int(hz))Гц: откат назад")
                }
            }
        }
    }

    /// Telegram на iOS 26: `stiffness 555.027, damping 47.118` — ζ = 1 и успокоение
    /// около 0.383 с (константа 0.3832 в `ContainedViewLayoutTransition`).
    func testSnappyMatchesTelegramLayoutSpring() {
        XCTAssertEqual(Motion.Springs.snappy.dampingRatio, 1, accuracy: 0.01)
        let settle = settleTime(Motion.Springs.snappy, epsilon: 0.001)
        XCTAssertGreaterThan(settle, 0.3)
        XCTAssertLessThan(settle, 0.5)
    }

    // MARK: - Перелёт в пределах

    func testLivelyAndReleaseOvershootIsNoticeableButSmall() {
        for (name, spring, range) in [
            ("lively", Motion.Springs.lively, 0.005...0.12),
            ("release", Motion.Springs.release, 0.02...0.15),
            ("interactive", Motion.Springs.interactive, 0.0...0.05),
        ] {
            let overshoot = (frames(spring, hz: 240).max() ?? 1) - 1
            XCTAssertTrue(range.contains(overshoot), "\(name): перелёт \(overshoot) вне \(range)")
        }
    }

    // MARK: - Нет скачков между кадрами

    /// Ни один кадр не переносит элемент дальше, чем на 20 % пути при 60 Гц (10 % при
    /// 120 Гц): больший шаг глаз видит как рывок, а не движение.
    ///
    /// Пружины нажатия (`press`, `release`) сюда не входят намеренно: они меняют масштаб
    /// на 4–12 %, и даже пятая часть этого пути за кадр — меньше процента размера.
    func testNoFrameJumpsAt60And120Hz() {
        for (name, spring) in movementSprings {
            for hz in Self.refreshRates {
                let values = frames(spring, hz: hz)
                let maxStep = zip(values, values.dropFirst()).map { abs($1 - $0) }.max() ?? 0
                let limit = hz == 60 ? 0.2 : 0.1
                XCTAssertLessThan(maxStep, limit, "\(name)@\(Int(hz))Гц: шаг кадра \(maxStep)")
            }
        }
    }

    /// Кнопка поддаётся под пальцем быстрее, чем возвращается: нажатие должно
    /// ощущаться мгновенным, а возврат — мягким.
    func testPressIsFasterThanRelease() {
        XCTAssertLessThan(settleTime(Motion.Springs.press), settleTime(Motion.Springs.release))
        XCTAssertLessThan(settleTime(Motion.Springs.press), 0.3)
    }

    // MARK: - Перехват на лету

    /// Анимацию 0→1 перехватили в середине и повели обратно к 0: положение и скорость в
    /// момент перехвата не рвутся, и новая траектория доходит до 0.
    func testRetargetMidFlightIsContinuous() {
        for (name, spring) in allSprings {
            let cut = 0.08
            let position = spring.value(target: 1.0, time: cut)
            let velocity = spring.velocity(target: 1.0, time: cut)

            let restart = spring.value(fromValue: position, toValue: 0.0, initialVelocity: velocity, time: 0)
            XCTAssertEqual(restart, position, accuracy: 1e-6, "\(name): прыжок положения при перехвате")

            // Первый кадр новой траектории идёт в ту же сторону, что и прежняя скорость
            // (инерция), а не сразу назад.
            let firstFrame = spring.value(fromValue: position, toValue: 0.0, initialVelocity: velocity, time: 1.0 / 120)
            XCTAssertGreaterThan(firstFrame, position - 0.02, "\(name): потеряна инерция при перехвате")

            let end = spring.value(fromValue: position, toValue: 0.0, initialVelocity: velocity, time: 2)
            XCTAssertEqual(end, 0, accuracy: 1e-3, "\(name): после перехвата не вернулась")
        }
    }

    /// Повторный запуск той же анимации даёт ту же траекторию — без накопленного
    /// состояния.
    func testRepeatedRunIsDeterministic() {
        let first = frames(Motion.Springs.snappy, hz: 120)
        let second = frames(Motion.Springs.snappy, hz: 120)
        XCTAssertEqual(first, second)
    }

    // MARK: - Уменьшение движения

    func testReduceMotionDropsAnimation() {
        XCTAssertNil(Motion.respecting(Motion.calm, reduceMotion: true))
        XCTAssertNotNil(Motion.respecting(Motion.calm, reduceMotion: false))
        XCTAssertEqual(Motion.respectingWithFade(Motion.lively, reduceMotion: true), Motion.fade)
        XCTAssertEqual(Motion.respectingWithFade(Motion.lively, reduceMotion: false), Motion.lively)
    }

    func testEnvironmentDefaultFollowsPolicy() {
        XCTAssertEqual(EnvironmentValues().motionReduced, Motion.isReducedNow)
        var environment = EnvironmentValues()
        environment.motionReduced = true
        XCTAssertTrue(environment.motionReduced)
    }

    // MARK: - Помощники

    /// Пружины, которые двигают элемент по экрану.
    private var movementSprings: [(String, Spring)] {
        [
            ("calm", Motion.Springs.calm),
            ("lively", Motion.Springs.lively),
            ("snappy", Motion.Springs.snappy),
            ("interactive", Motion.Springs.interactive),
        ]
    }

    private var allSprings: [(String, Spring)] {
        movementSprings + [("press", Motion.Springs.press), ("release", Motion.Springs.release)]
    }
}

/// Решения жестов: доехать или вернуть, сопротивление на краю, скорость пружины.
final class GesturePhysicsTests: XCTestCase {
    private let width: CGFloat = 393

    func testSlowShortDragCancels() {
        // Четверть экрана, палец почти остановился — возврат на место.
        XCTAssertFalse(GesturePhysics.shouldComplete(translation: width * 0.25, velocity: 20, extent: width))
    }

    func testShortFastFlickCompletes() {
        XCTAssertTrue(GesturePhysics.shouldComplete(translation: 40, velocity: 900, extent: width))
    }

    func testSlowDragPastHalfCompletes() {
        XCTAssertTrue(GesturePhysics.shouldComplete(translation: width * 0.55, velocity: 0, extent: width))
    }

    func testFlickBackCancelsEvenFarDrag() {
        XCTAssertFalse(GesturePhysics.shouldComplete(translation: width * 0.6, velocity: -1200, extent: width))
    }

    /// На широком экране порог не растёт бесконечно: 187.5 pt, как в UIKit 26.
    func testThresholdIsCappedOnWideExtent() {
        XCTAssertTrue(GesturePhysics.shouldComplete(translation: 190, velocity: 0, extent: 1000))
        XCTAssertFalse(GesturePhysics.shouldComplete(translation: 180, velocity: 0, extent: 1000))
    }

    func testDegenerateInputNeverCompletes() {
        XCTAssertFalse(GesturePhysics.shouldComplete(translation: 100, velocity: 100, extent: 0))
        XCTAssertFalse(GesturePhysics.shouldComplete(translation: .nan, velocity: 0, extent: width))
        XCTAssertFalse(GesturePhysics.shouldComplete(translation: 0, velocity: .infinity, extent: width))
    }

    func testRubberBandIsContinuousMonotonicAndBounded() {
        XCTAssertEqual(GesturePhysics.rubberBand(0, limit: 100), 0)
        var previous: CGFloat = 0
        for offset in stride(from: 1 as CGFloat, through: 2000, by: 7) {
            let banded = GesturePhysics.rubberBand(offset, limit: 100)
            XCTAssertGreaterThan(banded, previous, "сопротивление не монотонно на \(offset)")
            XCTAssertLessThan(banded, 100, "сопротивление вышло за предел на \(offset)")
            XCTAssertLessThan(banded, offset, "сопротивление тянет дальше пальца на \(offset)")
            previous = banded
        }
        // Около нуля наклон ≈ коэффициенту: без скачка при начале оттяжки.
        XCTAssertEqual(GesturePhysics.rubberBand(0.1, limit: 100) / 0.1, 0.55, accuracy: 0.01)
        XCTAssertEqual(GesturePhysics.rubberBand(-50, limit: 100), -GesturePhysics.rubberBand(50, limit: 100))
    }

    func testRelativeVelocityKeepsDirectionAndIsClamped() {
        XCTAssertEqual(GesturePhysics.relativeVelocity(500, from: 0, to: 250), 2, accuracy: 1e-9)
        XCTAssertEqual(GesturePhysics.relativeVelocity(-500, from: 250, to: 0), 2, accuracy: 1e-9)
        XCTAssertEqual(GesturePhysics.relativeVelocity(100_000, from: 0, to: 10), 40)
        XCTAssertEqual(GesturePhysics.relativeVelocity(500, from: 10, to: 10.2), 0, "почти на месте — без броска")
        XCTAssertEqual(GesturePhysics.relativeVelocity(.nan, from: 0, to: 100), 0)
    }

    func testProjectedEndFollowsScrollDeceleration() {
        XCTAssertEqual(GesturePhysics.projectedEnd(translation: 0, velocity: 0), 0)
        // 1000 pt/с с замедлением 0.998 — ≈ 499 pt вперёд, как у UIScrollView.
        XCTAssertEqual(GesturePhysics.projectedEnd(translation: 0, velocity: 1000), 499, accuracy: 1)
        XCTAssertLessThan(GesturePhysics.projectedEnd(translation: 0, velocity: -1000), 0)
    }
}

/// Частота кадров: на iPhone с ProMotion анимации приложения идут на 120 Гц только с
/// ключом `CADisableMinimumFrameDurationOnPhone` — без него iOS держит их на 60.
final class FrameRateTests: XCTestCase {
    func testAppAllowsProMotionFrameRates() {
        let value = Bundle.main.object(forInfoDictionaryKey: "CADisableMinimumFrameDurationOnPhone") as? Bool
        XCTAssertEqual(value, true, "в Info.plist нет CADisableMinimumFrameDurationOnPhone — анимации на 60 Гц")
    }
}
