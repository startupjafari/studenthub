import UIKit

// ЗАГЛУШКА: монитор кадров — отдельный шаг.
@MainActor
final class PerformanceMonitor {
    static let shared = PerformanceMonitor()
    func noteScroll() {}
    func beginInteraction(_ name: String) {}
    func endInteraction(_ name: String) {}
}
