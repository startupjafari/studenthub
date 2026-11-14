import UIKit

// ЗАГЛУШКА: Debug Menu — отдельный шаг.
@MainActor
enum DebugMenu {
    static func present(from controller: UIViewController) {}
    static func installShakeTrigger(in window: UIWindow) {}
}
