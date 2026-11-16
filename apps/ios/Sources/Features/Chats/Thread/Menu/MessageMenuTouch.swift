import Observation
import UIKit

/// Палец, которым открыли меню сообщения, — как в Telegram: долгое нажатие открывает
/// меню, и, не отрывая пальца, его ведут к пункту и отпускают.
///
/// Касание началось в ленте (UIKit) и ей же принадлежит до конца: меню поверх его не
/// получает. Поэтому лента сообщает сюда, где палец (в координатах окна) и где его
/// отпустили, а меню по этим точкам подсвечивает и выбирает пункт.
@MainActor
@Observable
final class MessageMenuTouch {
    static let shared = MessageMenuTouch()

    enum Phase: Equatable {
        case idle
        /// Палец ещё на экране, здесь.
        case moving(CGPoint)
        /// Палец отпустили здесь.
        case released(CGPoint)
    }

    private(set) var phase: Phase = .idle

    /// Сдвиг, после которого палец «ведут» к пункту, а не просто держат.
    static let dragThreshold: CGFloat = 10

    /// Где нажали; `nil` — касания нет.
    @ObservationIgnored private var start: CGPoint?
    @ObservationIgnored private var dragged = false

    /// Долгое нажатие сработало здесь. У нижних сообщений меню раскрывается прямо под
    /// пальцем: отпускание на месте нажатия — не выбор пункта, меню остаётся, как в Telegram.
    func begin(at point: CGPoint) {
        start = point
        dragged = false
        phase = .idle
    }

    func move(to point: CGPoint) {
        if !dragged, let start, hypot(point.x - start.x, point.y - start.y) < Self.dragThreshold { return }
        dragged = true
        phase = .moving(point)
    }

    func release(at point: CGPoint) {
        let wasDragged = dragged
        start = nil
        dragged = false
        phase = wasDragged ? .released(point) : .idle
    }

    func reset() {
        start = nil
        dragged = false
        phase = .idle
    }
}
