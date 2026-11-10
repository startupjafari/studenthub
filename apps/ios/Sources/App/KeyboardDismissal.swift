import SwiftUI
import UIKit

/// Касание вне поля ввода снимает фокус и прячет клавиатуру — на всех экранах и листах.
///
/// Один распознаватель на окно, а не модификатор на каждом экране: экранов сотни, и
/// любой забытый оставил бы клавиатуру висеть. Распознаватель ничего не перехватывает
/// (`cancelsTouchesInView = false`, одновременно с остальными жестами): кнопка под
/// пальцем срабатывает как обычно, лента прокручивается, а фокус просто уходит.
///
/// Касание самого поля (или другого поля) распознаватель не получает: фокус переходит
/// туда без того, чтобы клавиатура мигнула.
@MainActor
enum KeyboardDismissal {
    private static var installed = Set<ObjectIdentifier>()
    private static let delegate = TouchFilter()
    /// Зоны, касание которых фокус не снимает: панель ввода чата («отправить» не должно
    /// прятать клавиатуру), коробка поля формы (касание мимо строки текста ставит фокус).
    /// Координаты — окна.
    fileprivate static var keepZones: [UUID: CGRect] = [:]

    /// Ставится при запуске: каждое окно, ставшее ключевым, получает распознаватель.
    static func install() {
        NotificationCenter.default.addObserver(
            forName: UIWindow.didBecomeKeyNotification,
            object: nil,
            queue: .main
        ) { note in
            guard let window = note.object as? UIWindow else { return }
            MainActor.assumeIsolated { attach(to: window) }
        }
    }

    private static func attach(to window: UIWindow) {
        let id = ObjectIdentifier(window)
        guard !installed.contains(id) else { return }
        installed.insert(id)

        let tap = UITapGestureRecognizer(target: delegate, action: #selector(TouchFilter.dismiss(_:)))
        tap.cancelsTouchesInView = false
        tap.delaysTouchesBegan = false
        tap.delaysTouchesEnded = false
        tap.delegate = delegate
        window.addGestureRecognizer(tap)
    }

    @MainActor
    private final class TouchFilter: NSObject, UIGestureRecognizerDelegate {
        @objc func dismiss(_ recognizer: UITapGestureRecognizer) {
            recognizer.view?.endEditing(true)
        }

        /// Касание поля ввода — не наше: там фокус и должен быть.
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            if let window = touch.window {
                let point = touch.location(in: window)
                if KeyboardDismissal.keepZones.values.contains(where: { $0.contains(point) }) { return false }
            }
            var view = touch.view
            while let current = view {
                if current is UITextField || current is UITextView || current is UISearchBar { return false }
                view = current.superview
            }
            return true
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            true
        }
    }
}

extension View {
    /// Касание этой области не снимает фокус с поля ввода (`KeyboardDismissal`).
    func keepsKeyboardOnTap() -> some View {
        modifier(KeepsKeyboardZone())
    }
}

private struct KeepsKeyboardZone: ViewModifier {
    @State private var id = UUID()

    func body(content: Content) -> some View {
        content
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { frame in
                KeyboardDismissal.keepZones[id] = frame
            }
            .onDisappear { KeyboardDismissal.keepZones[id] = nil }
    }
}
