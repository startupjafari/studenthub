import SwiftUI
import UIKit
import XCTest

/// Основа снимочных тестов: рисует SwiftUI-вид в настоящем окне и сравнивает с эталоном
/// (`SnapshotComparison`).
///
/// Каждый вид снимается в матрице «тема × размер экрана × размер шрифта». Матрица
/// небольшая намеренно: светлая и тёмная тема, самый узкий и самый широкий iPhone и
/// крупный шрифт — там, где ломается вёрстка, а не каждая комбинация подряд.
@MainActor
class SnapshotTestCase: XCTestCase {
    struct Device {
        let name: String
        let size: CGSize

        /// iPhone SE (3-го поколения) — самый узкий поддерживаемый экран.
        static let compact = Device(name: "se", size: CGSize(width: 375, height: 667))
        /// iPhone 16/17 — основной размер.
        static let regular = Device(name: "regular", size: CGSize(width: 393, height: 852))
        /// iPhone Pro Max — самый широкий.
        static let large = Device(name: "max", size: CGSize(width: 440, height: 956))
    }

    struct Variant {
        let device: Device
        let style: UIUserInterfaceStyle
        let category: UIContentSizeCategory

        var name: String {
            let theme = style == .dark ? "dark" : "light"
            let type: String
            switch category {
            case .large: type = "default"
            case .accessibilityExtraLarge: type = "ax2"
            case .extraExtraExtraLarge: type = "xxxl"
            default: type = category.rawValue
            }
            return "\(device.name)-\(theme)-\(type)"
        }

        /// Основная матрица: обе темы на основном экране, узкий экран и крупный шрифт.
        static let standard: [Variant] = [
            Variant(device: .regular, style: .light, category: .large),
            Variant(device: .regular, style: .dark, category: .large),
            Variant(device: .compact, style: .light, category: .large),
            Variant(device: .large, style: .light, category: .large),
            Variant(device: .regular, style: .light, category: .accessibilityExtraLarge),
        ]
    }

    /// Снять вид во всех вариантах и сравнить каждый с эталоном.
    ///
    /// `height` — `nil`: высота экрана устройства; число — компонент снимается в полосе
    /// этой высоты (строка списка, кнопка), а не в полном экране с пустотой под ним.
    func assertSnapshots<V: View>(
        of view: V,
        named name: String,
        height: CGFloat? = nil,
        variants: [Variant] = Variant.standard,
        tolerance: SnapshotComparison.Tolerance = .strict,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        for variant in variants {
            let size = CGSize(width: variant.device.size.width, height: height ?? variant.device.size.height)
            let image = render(view, size: size, style: variant.style, category: variant.category)
            SnapshotComparison.assert(
                image, named: "\(name)-\(variant.name)", suite: String(describing: type(of: self)),
                tolerance: tolerance, testCase: self, file: file, line: line)
        }
    }

    /// Нарисовать вид в окне заданного размера.
    ///
    /// Окно настоящее, а не голый `layer.render`: материалы, тени и `drawingGroup`
    /// без окна рисуются иначе, и снимок разошёлся бы с тем, что видит человек.
    func render<V: View>(
        _ view: V, size: CGSize, style: UIUserInterfaceStyle, category: UIContentSizeCategory
    ) -> UIImage {
        UIView.setAnimationsEnabled(false)
        defer { UIView.setAnimationsEnabled(true) }

        let root = view
            // Снимок — конечное состояние: ни неявных анимаций, ни явных `withAnimation`.
            .transaction {
                $0.animation = nil
                $0.disablesAnimations = true
            }
            .frame(width: size.width, height: size.height)
        let host = UIHostingController(rootView: root)
        host.traitOverrides.userInterfaceStyle = style
        host.traitOverrides.preferredContentSizeCategory = category

        // Окно — в сцене приложения-хоста. Без сцены окно на iOS 13+ не попадает на экран,
        // и `drawHierarchy` молча отдаёт прозрачную картинку (так и было в первом прогоне:
        // все эталоны вышли пустыми). Уровень — над интерфейсом хоста.
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
            ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        let window = scene.map { UIWindow(windowScene: $0) } ?? UIWindow()
        window.frame = CGRect(origin: .zero, size: size)
        window.windowLevel = .alert + 1
        window.overrideUserInterfaceStyle = style
        window.rootViewController = host
        window.isHidden = false
        host.view.frame = window.bounds
        window.layoutIfNeeded()
        // SwiftUI доводит раскладку в ближайших проходах цикла: `onAppear`, `task`,
        // асинхронные шрифты. Два коротких прохода стабильнее одного длинного.
        for _ in 0..<2 {
            RunLoop.main.run(until: Date().addingTimeInterval(0.05))
            window.layoutIfNeeded()
        }

        let format = UIGraphicsImageRendererFormat(for: window.traitCollection)
        format.opaque = false
        let image = UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { context in
            // `drawHierarchy` рисует как экран (материалы, размытие); не смог — слой
            // напрямую, чтобы снимок хотя бы не вышел пустым.
            if !window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) {
                window.layer.render(in: context.cgContext)
            }
        }
        window.isHidden = true
        window.rootViewController = nil
        return image
    }
}
