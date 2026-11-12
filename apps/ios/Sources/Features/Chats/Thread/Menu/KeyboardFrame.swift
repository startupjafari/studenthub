import UIKit

/// Где сейчас клавиатура — в координатах экрана.
///
/// Клавиатура живёт в своём окне поверх приложения, и полноэкранное меню сообщения её не
/// закрывает. Меню раскладывается над ней, а не под ней — для этого и нужна её рамка в
/// момент открытия. Наблюдатель включается при входе в переписку.
@MainActor
final class KeyboardFrame {
    static let shared = KeyboardFrame()

    /// Верх клавиатуры; `nil` — клавиатура спрятана.
    private(set) var top: CGFloat?
    /// Высота последней показанной клавиатуры — панель emoji встаёт на её место той же
    /// высоты, и поле ввода не прыгает.
    private(set) var lastHeight: CGFloat?

    private var observers: [NSObjectProtocol] = []

    private init() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(
            forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: .main
        ) { [weak self] note in
            guard let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
            MainActor.assumeIsolated {
                let screen = UIScreen.main.bounds.height
                let visible = frame.minY < screen - 1 && frame.height > 0
                self?.top = visible ? frame.minY : nil
                if visible, frame.height > 200 { self?.lastHeight = screen - frame.minY }
            }
        })
        observers.append(center.addObserver(
            forName: UIResponder.keyboardWillHideNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.top = nil }
        })
    }

    /// Включить наблюдение заранее, чтобы к первому меню рамка уже была известна.
    func start() {}
}
