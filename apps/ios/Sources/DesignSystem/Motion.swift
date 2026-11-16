import SwiftUI
import UIKit

/// Движение (DESIGN_SYSTEM §7) — единая система анимаций приложения.
///
/// Длительности — только для декоративного движения: элемент появился, цвет
/// сменился. У всего, что человек тянет пальцем, длительности нет вовсе — есть
/// пружина: она хранит позицию и скорость, поэтому смена цели на лету не даёт
/// разрыва, а перехват едущего элемента не вызывает прыжка.
///
/// Пружины заданы значениями `Spring`, а анимации построены из них: так у каждой
/// кривой есть проверяемая физика (`MotionTests` считают кадры при 60 и 120 Гц,
/// время успокоения и перелёт), а не только имя.
///
/// Параметры сверены с Telegram-iOS (`ContainedViewLayoutTransition`,
/// `NavigationTransitionSpring`, `PlainButtonComponent`): берём принципы и числа,
/// а не код.
enum Motion {
    enum Duration {
        /// Отклик на действие: нажатие, смена цвета.
        static let feedback: TimeInterval = 0.15
        /// Появление парящего слоя: меню, поповер, лист.
        static let layer: TimeInterval = 0.2
        /// Смена прозрачности и размытия (Telegram: 0.25 easeInOut).
        static let fade: TimeInterval = 0.25
        /// Смена поверхности: переход панели, раскрытие блока.
        static let surface: TimeInterval = 0.3
        /// Оживление данных: рост полосы, счёт числа, вход плиток.
        static let data: TimeInterval = 0.5
    }

    /// Пружины как физика — для расчёта и тестов.
    enum Springs {
        /// Без перелёта: перемещение, возврат, всё спокойное.
        /// Веб: `damping: 1, response: 0.4` (`shared/lib/spring.ts`).
        static let calm = Spring(duration: 0.4, bounce: 0)

        /// Лёгкий перелёт: шторка, строка списка — там, где жест сам нёс инерцию.
        /// Веб: `damping: 0.8, response: 0.3`; `bounce = 1 - damping`.
        static let lively = Spring(duration: 0.3, bounce: 0.2)

        /// Раскладка «как в Telegram»: критическое затухание, отклик ≈0.27 с, успокоение
        /// ≈0.38 с. Telegram на iOS 26: `mass 1, stiffness 555.027, damping 47.118`
        /// (ζ = 1). Для переключателей, индикаторов, меню, смены вкладок в панелях —
        /// всего, что должно ощущаться мгновенным, но не прыгать.
        static let snappy = Spring(mass: 1, stiffness: 555.027, damping: 47.118)

        /// Отпускание жеста: доезд или возврат с сохранением скорости пальца.
        /// Telegram (возврат свайпом, UIKit 26): ζ 0.85, отклик 0.3.
        static let interactive = Spring(response: 0.3, dampingRatio: 0.85)

        /// Палец лёг на кнопку: быстро и без перелёта.
        static let press = Spring(response: 0.18, dampingRatio: 1)

        /// Палец отпустил кнопку: возврат с маленьким перелётом — у Telegram это
        /// `(w+2)/w` после `(w-8)/w`, то есть ~2 % сверх исходного размера.
        static let release = Spring(response: 0.32, dampingRatio: 0.62)
    }

    /// Без перелёта: перемещение, возврат, всё спокойное.
    static let calm = Animation.spring(Springs.calm)
    /// Лёгкий перелёт: шторка, строка списка.
    static let lively = Animation.spring(Springs.lively)
    /// Мгновенная, но плавная смена раскладки (переключатели, индикаторы, меню).
    static let snappy = Animation.spring(Springs.snappy)
    /// Доезд жеста без скорости (отмена системой, нажатие вместо свайпа).
    static let interactive = Animation.spring(Springs.interactive)
    /// Нажатие и отпускание кнопки.
    static let press = Animation.spring(Springs.press)
    static let release = Animation.spring(Springs.release)
    /// Смена прозрачности: появление подписи, затемнение.
    static let fade = Animation.easeInOut(duration: Duration.fade)

    /// Доезд после жеста, продолжающий скорость пальца: от `current` к `target` при
    /// скорости `velocity` (pt/с, знак — по той же оси). Без этого элемент на отпускании
    /// сначала тормозит до нуля и только потом едет — тот самый «рывок».
    static func release(from current: CGFloat, to target: CGFloat, velocity: CGFloat) -> Animation {
        .interpolatingSpring(
            Springs.interactive,
            initialVelocity: GesturePhysics.relativeVelocity(velocity, from: current, to: target)
        )
    }

    /// При включённом «уменьшении движения» показываем сразу конечное состояние,
    /// без броска и перелёта. Возврат `nil` означает «без анимации».
    static func respecting(_ animation: Animation, reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : animation
    }

    /// Как `respecting`, но вместо пропуска — короткое растворение: для смены
    /// содержимого, где мгновенная подмена выглядит как мигание.
    static func respectingWithFade(_ animation: Animation, reduceMotion: Bool) -> Animation {
        reduceMotion ? fade : animation
    }

    // MARK: - Уменьшение движения

    /// Принудительное уменьшение движения для UI-тестов (`SH_UITEST_REDUCE_MOTION=1`).
    /// Системную настройку из теста не переключить, а проверить оба режима нужно.
    static let forcedReduce: Bool = {
        #if DEBUG
            ProcessInfo.processInfo.environment["SH_UITEST_REDUCE_MOTION"] == "1"
        #else
            false
        #endif
    }()

    /// Для UIKit-кода, где нет окружения SwiftUI: системная настройка или тестовая.
    static var isReducedNow: Bool { UIAccessibility.isReduceMotionEnabled || forcedReduce }
}

/// `withAnimation`, уважающий уменьшение движения: при нём изменение применяется сразу.
/// Для мест без окружения SwiftUI под рукой (действия, замыкания, прокрутка к якорю) —
/// вместо голого `withAnimation { }`, который анимирует всегда и кривой по умолчанию.
@discardableResult
func withMotion<Result>(_ animation: Animation = Motion.snappy, _ body: () throws -> Result) rethrows -> Result {
    try withAnimation(Motion.isReducedNow ? nil : animation, body)
}

// MARK: - Окружение

private struct MotionReducedKey: EnvironmentKey {
    static var defaultValue: Bool { Motion.isReducedNow }
}

extension EnvironmentValues {
    /// Уменьшать ли движение: системная настройка «Уменьшение движения» или тестовая
    /// подмена. Читать вместо `accessibilityReduceMotion` — та только для чтения, и
    /// UI-тест не может её включить.
    var motionReduced: Bool {
        get { self[MotionReducedKey.self] }
        set { self[MotionReducedKey.self] = newValue }
    }
}

/// Корень приложения передаёт вниз `motionReduced`, следя за системной настройкой.
private struct MotionPolicyModifier: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var system

    func body(content: Content) -> some View {
        content.environment(\.motionReduced, system || Motion.forcedReduce)
    }
}

extension View {
    /// Повесить на корень сцены (и на корень отдельных окон, если появятся).
    func motionPolicy() -> some View { modifier(MotionPolicyModifier()) }
}

// MARK: - Переходы

extension AnyTransition {
    /// Парящий слой: меню, поповер, тост — растёт из 94 % и проявляется.
    static var motionPop: AnyTransition { .scale(scale: 0.94).combined(with: .opacity) }

    /// Панель снизу: приезжает от края и проявляется.
    static var motionRise: AnyTransition { .move(edge: .bottom).combined(with: .opacity) }

    /// Смена содержимого на месте: старое уходит, новое приходит с лёгким сдвигом.
    static var motionSwap: AnyTransition {
        .asymmetric(
            insertion: .offset(y: 6).combined(with: .opacity),
            removal: .opacity
        )
    }

    /// При уменьшении движения любой переход становится растворением.
    static func motion(_ transition: AnyTransition, reduced: Bool) -> AnyTransition {
        reduced ? .opacity : transition
    }
}

// MARK: - Нажатие

/// Кнопка, которая слегка поддаётся под пальцем и возвращается с маленьким перелётом
/// (Telegram `PlainButtonComponent`). Для карточек, плиток, круглых кнопок действий —
/// не для текстовых ссылок в строке, им хватает системного затемнения.
///
/// При уменьшении движения размер не меняется — только затемнение.
struct PressableButtonStyle: ButtonStyle {
    /// Насколько уменьшить: 0.96 для карточки, 0.9 для круглой иконки.
    var scale: CGFloat = 0.96

    func makeBody(configuration: Configuration) -> some View {
        PressableLabel(configuration: configuration, scale: scale)
    }
}

private struct PressableLabel: View {
    let configuration: ButtonStyleConfiguration
    let scale: CGFloat
    @Environment(\.motionReduced) private var reduced

    var body: some View {
        configuration.label
            .contentShape(Rectangle())
            .scaleEffect(configuration.isPressed && !reduced ? scale : 1)
            .opacity(configuration.isPressed ? (reduced ? 0.55 : 0.85) : 1)
            .animation(configuration.isPressed ? Motion.press : Motion.release, value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == PressableButtonStyle {
    /// Карточка или плитка.
    static var pressable: PressableButtonStyle { PressableButtonStyle() }
    /// Круглая кнопка-иконка — поддаётся сильнее, она меньше.
    static var pressableIcon: PressableButtonStyle { PressableButtonStyle(scale: 0.88) }
}

// MARK: - Физика жестов

/// Решения жестов без SwiftUI: доезжать или вернуть, сопротивление на краю, скорость
/// для пружины. Отдельно — чтобы проверять тестами каждое правило.
enum GesturePhysics {
    /// Сколько секунд «вперёд» прикидывать полёт пальца при отпускании (UIKit 26 и
    /// Telegram — 0.35).
    static let projectionTime: CGFloat = 0.35

    /// Доезжать ли жест до конца (закрыть, перелистнуть, вернуться назад).
    ///
    /// Правило Telegram/UIKit 26: точка, куда палец долетел бы за 0.35 с, дальше
    /// `min(187.5, extent / 2)`. Медленно на четверть — возврат; коротко, но броском —
    /// доезд; бросок против направления отменяет даже далеко утянутый жест.
    static func shouldComplete(translation: CGFloat, velocity: CGFloat, extent: CGFloat) -> Bool {
        guard extent > 0, translation.isFinite, velocity.isFinite else { return false }
        let projected = translation + velocity * projectionTime
        return projected > min(187.5, extent * 0.5)
    }

    /// Сопротивление за пределом: смещение растёт всё медленнее и не превышает `limit`
    /// (как у `UIScrollView` за краем). Непрерывно в нуле, знак сохраняется.
    static func rubberBand(_ offset: CGFloat, limit: CGFloat, coefficient: CGFloat = 0.55) -> CGFloat {
        guard limit > 0, offset != 0 else { return 0 }
        let magnitude = abs(offset)
        let banded = (1 - 1 / (magnitude * coefficient / limit + 1)) * limit
        return offset < 0 ? -banded : banded
    }

    /// Скорость пальца в единицах пружины SwiftUI: доля оставшегося пути в секунду.
    /// Ограничена, чтобы случайный рывок датчика не выстрелил элемент.
    static func relativeVelocity(_ velocity: CGFloat, from current: CGFloat, to target: CGFloat) -> Double {
        let distance = target - current
        guard abs(distance) > 0.5, velocity.isFinite else { return 0 }
        let relative = Double(velocity / distance)
        return min(max(relative, -40), 40)
    }

    /// Куда долетит прокрутка/бросок с замедлением как у `UIScrollView` (`normal`).
    static func projectedEnd(translation: CGFloat, velocity: CGFloat, decelerationRate: CGFloat = 0.998) -> CGFloat {
        translation + (velocity / 1000) * decelerationRate / (1 - decelerationRate)
    }
}

// MARK: - Тактильный отклик

/// Тактильный отклик с заранее созданными генераторами (Telegram `HapticFeedback`):
/// генератор, созданный в момент события, отвечает с задержкой в десятки мс.
@MainActor
enum Haptics {
    private static let selection = UISelectionFeedbackGenerator()
    private static let notification = UINotificationFeedbackGenerator()
    private static var impacts: [UIImpactFeedbackGenerator.FeedbackStyle: UIImpactFeedbackGenerator] = [:]

    /// Перед вероятным событием (палец лёг на элемент) — разбудить движок.
    static func prepareTap() { selection.prepare() }
    static func prepareImpact(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .light) {
        impact(for: style).prepare()
    }

    /// Смена выбора: вкладка, сегмент, пункт меню под пальцем.
    static func tap() { selection.selectionChanged() }

    /// Порог жеста пройден (свайп ответа взведён, меню раскрылось).
    static func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .light, intensity: CGFloat = 1) {
        impact(for: style).impactOccurred(intensity: intensity)
    }

    static func success() { notification.notificationOccurred(.success) }
    static func error() { notification.notificationOccurred(.error) }

    private static func impact(for style: UIImpactFeedbackGenerator.FeedbackStyle) -> UIImpactFeedbackGenerator {
        if let generator = impacts[style] { return generator }
        let generator = UIImpactFeedbackGenerator(style: style)
        impacts[style] = generator
        return generator
    }
}
