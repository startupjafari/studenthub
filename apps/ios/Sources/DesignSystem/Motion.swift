import SwiftUI

/// Движение (DESIGN_SYSTEM §7).
///
/// Длительности — только для декоративного движения: элемент появился, цвет
/// сменился. У всего, что человек тянет пальцем, длительности нет вовсе — есть
/// пружина: она хранит позицию и скорость, поэтому смена цели на лету не даёт
/// разрыва, а перехват едущего элемента не вызывает прыжка.
enum Motion {
    enum Duration {
        /// Отклик на действие: нажатие, смена цвета.
        static let feedback: TimeInterval = 0.15
        /// Появление парящего слоя: меню, поповер, лист.
        static let layer: TimeInterval = 0.2
        /// Смена поверхности: переход панели, раскрытие блока.
        static let surface: TimeInterval = 0.3
        /// Оживление данных: рост полосы, счёт числа, вход плиток.
        static let data: TimeInterval = 0.5
    }

    /// Без перелёта: перемещение, возврат, всё спокойное.
    /// Веб: `damping: 1, response: 0.4` (`shared/lib/spring.ts`).
    static let calm = Animation.spring(duration: 0.4, bounce: 0)

    /// Лёгкий перелёт: шторка, строка списка — там, где жест сам нёс инерцию.
    /// Веб: `damping: 0.8, response: 0.3`; `bounce = 1 - damping`.
    static let lively = Animation.spring(duration: 0.3, bounce: 0.2)

    /// При включённом «уменьшении движения» показываем сразу конечное состояние,
    /// без броска и перелёта. Возврат `nil` означает «без анимации».
    static func respecting(_ animation: Animation, reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : animation
    }
}
