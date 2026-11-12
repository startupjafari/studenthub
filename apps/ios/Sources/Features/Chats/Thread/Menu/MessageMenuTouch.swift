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

    func move(to point: CGPoint) { phase = .moving(point) }
    func release(at point: CGPoint) { phase = .released(point) }
    func reset() { phase = .idle }
}
