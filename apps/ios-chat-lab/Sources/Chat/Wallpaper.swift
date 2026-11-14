import UIKit

/// Обои чата: четырёхцветный градиент Telegram (цвета в четырёх точках, плавно смешанные)
/// и узор поверх. При отправке сообщения точки градиента поворачиваются на шаг — фирменное
/// движение фона Telegram.
struct WallpaperPreset: Hashable {
    var id: String
    var title: String
    var light: [UInt32]
    var dark: [UInt32]
    var hasPattern: Bool

    static let defaultId = "classic"

    static let all: [WallpaperPreset] = [
        WallpaperPreset(id: "classic", title: "Классика", light: [0xDBDDBB, 0x6BA587, 0xD5D88D, 0x88B884], dark: [0x0F2B23, 0x1B3D31, 0x10241D, 0x2A4436], hasPattern: true),
        WallpaperPreset(id: "ocean", title: "Океан", light: [0x94DAE9, 0x7BB0EB, 0xB4E3D4, 0x6C8FD8], dark: [0x0E2639, 0x173A5C, 0x0B1E2E, 0x1F3F66], hasPattern: true),
        WallpaperPreset(id: "sunset", title: "Закат", light: [0xF8C9A0, 0xEE9F8A, 0xF4E1A8, 0xD88FB5], dark: [0x3A1F2B, 0x4B2733, 0x2A1820, 0x553041], hasPattern: true),
        WallpaperPreset(id: "lavender", title: "Лаванда", light: [0xE4D6F7, 0xB9A6E8, 0xF2E3F2, 0xA3B4EE], dark: [0x231C36, 0x2E2447, 0x1A1529, 0x342C57], hasPattern: true),
        WallpaperPreset(id: "mint", title: "Мята", light: [0xD6F5E3, 0xA6E1C5, 0xEFF8D9, 0x8FD3B6], dark: [0x112821, 0x173A2E, 0x0D1F19, 0x1E4537], hasPattern: false),
        WallpaperPreset(id: "plain", title: "Без узора", light: [0xE6EBEE, 0xE6EBEE, 0xE6EBEE, 0xE6EBEE], dark: [0x0F0F0F, 0x0F0F0F, 0x0F0F0F, 0x0F0F0F], hasPattern: false),
    ]

    static func preset(id: String) -> WallpaperPreset { all.first { $0.id == id } ?? all[0] }

    func colors(dark isDark: Bool) -> [UIColor] { (isDark ? dark : light).map { UIColor(rgb: $0) } }
}

final class WallpaperView: UIView {
    private let gradientView = UIImageView()
    private let patternView = UIView()
    private var preset = WallpaperPreset.preset(id: WallpaperPreset.defaultId)
    /// Положение точек: 8 позиций по кругу, как у Telegram.
    private var phase = 0
    private var displayLink: CADisplayLink?
    private var animationStart: CFTimeInterval = 0
    private var fromPhase = 0
    private static let animationDuration: CFTimeInterval = 0.5

    /// Позиции четырёх точек градиента (доли ширины/высоты) для 8 фаз.
    private static let positions: [CGPoint] = [
        CGPoint(x: 0.80, y: 0.10), CGPoint(x: 0.60, y: 0.20), CGPoint(x: 0.35, y: 0.25), CGPoint(x: 0.25, y: 0.60),
        CGPoint(x: 0.20, y: 0.90), CGPoint(x: 0.40, y: 0.80), CGPoint(x: 0.65, y: 0.75), CGPoint(x: 0.75, y: 0.40),
    ]

    override init(frame: CGRect) {
        super.init(frame: frame)
        gradientView.contentMode = .scaleToFill
        gradientView.layer.magnificationFilter = .linear
        addSubview(gradientView)
        addSubview(patternView)
        isUserInteractionEnabled = false
        accessibilityIdentifier = "wallpaper"
        registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (view: WallpaperView, _) in view.render() }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func apply(_ preset: WallpaperPreset) {
        self.preset = preset
        render()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        gradientView.frame = bounds
        patternView.frame = bounds
        if patternView.backgroundColor == nil || patternView.bounds.size != bounds.size { renderPattern() }
    }

    private func render() {
        gradientView.image = Self.renderGradient(colors: preset.colors(dark: traitCollection.userInterfaceStyle == .dark), phase: CGFloat(phase))
        renderPattern()
    }

    private func renderPattern() {
        patternView.isHidden = !preset.hasPattern
        guard preset.hasPattern else { return }
        let dark = traitCollection.userInterfaceStyle == .dark
        patternView.backgroundColor = UIColor(patternImage: Self.patternTile(dark: dark))
    }

    /// Шаг градиента при отправке сообщения: точки плавно переезжают на следующую позицию.
    func advance() {
        guard !Motion.reduceMotion, UIView.areAnimationsEnabled else {
            phase = (phase + 1) % 8
            render()
            return
        }
        fromPhase = phase
        phase = (phase + 1) % 8
        animationStart = CACurrentMediaTime()
        if displayLink == nil {
            let link = CADisplayLink(target: self, selector: #selector(step))
            link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
            link.add(to: .main, forMode: .common)
            displayLink = link
        }
    }

    @objc private func step() {
        let t = min(1, (CACurrentMediaTime() - animationStart) / Self.animationDuration)
        // Плавное начало и конец (как кривая Telegram для фона).
        let eased = t < 0.5 ? 2 * t * t : 1 - pow(-2 * t + 2, 2) / 2
        let current = CGFloat(fromPhase) + CGFloat(eased)
        gradientView.image = Self.renderGradient(colors: preset.colors(dark: traitCollection.userInterfaceStyle == .dark), phase: current)
        if t >= 1 {
            displayLink?.invalidate()
            displayLink = nil
        }
    }

    /// Градиент рисуется в 60×60 и растягивается — так же делает Telegram: крупное
    /// размытие бесплатно даёт билинейное увеличение, а кадр стоит доли миллисекунды.
    static func renderGradient(colors: [UIColor], phase: CGFloat) -> UIImage {
        let size = 60
        var pixels = [UInt8](repeating: 255, count: size * size * 4)
        var components: [(CGFloat, CGFloat, CGFloat)] = colors.map { color in
            var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
            color.getRed(&r, green: &g, blue: &b, alpha: &a)
            return (r, g, b)
        }
        while components.count < 4 { components.append(components.last ?? (1, 1, 1)) }
        let points: [CGPoint] = (0..<4).map { index in
            let position = phase + CGFloat(index * 2)
            let base = Int(floor(position)) % 8
            let next = (base + 1) % 8
            let fraction = position - floor(position)
            let a = positions[(base + 8) % 8]
            let b = positions[next]
            return CGPoint(x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction)
        }
        for y in 0..<size {
            for x in 0..<size {
                let px = CGFloat(x) / CGFloat(size - 1)
                let py = CGFloat(y) / CGFloat(size - 1)
                var weights: [CGFloat] = []
                var total: CGFloat = 0
                for point in points {
                    let distance = max(0.0001, hypot(px - point.x, py - point.y))
                    let weight = 1 / pow(distance, 3)
                    weights.append(weight)
                    total += weight
                }
                var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0
                for index in 0..<4 {
                    let w = weights[index] / total
                    r += components[index].0 * w
                    g += components[index].1 * w
                    b += components[index].2 * w
                }
                let offset = (y * size + x) * 4
                pixels[offset] = UInt8(max(0, min(255, r * 255)))
                pixels[offset + 1] = UInt8(max(0, min(255, g * 255)))
                pixels[offset + 2] = UInt8(max(0, min(255, b * 255)))
            }
        }
        let provider = CGDataProvider(data: Data(pixels) as CFData)!
        let image = CGImage(
            width: size, height: size, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: size * 4,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
            provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent
        )!
        return UIImage(cgImage: image)
    }

    private static var patternCache: [Bool: UIImage] = [:]

    /// Плитка узора: свои значки (SF Symbols) вразброс, полупрозрачные — по мотивам
    /// «дудл»-узоров Telegram, без их рисунков.
    static func patternTile(dark: Bool) -> UIImage {
        if let cached = patternCache[dark] { return cached }
        let symbols = ["heart", "star", "music.note", "camera", "airplane", "leaf", "cup.and.saucer", "bicycle", "moon", "cloud", "gift", "pawprint", "book", "paperplane", "sun.max", "umbrella"]
        let size = CGSize(width: 240, height: 240)
        var rng = SeededGenerator(seed: 42)
        let renderer = UIGraphicsImageRenderer(size: size)
        let image = renderer.image { _ in
            let color = dark ? UIColor.white.withAlphaComponent(0.06) : UIColor.black.withAlphaComponent(0.08)
            for row in 0..<4 {
                for column in 0..<4 {
                    let name = symbols[(row * 4 + column + Int(rng.next() % 3)) % symbols.count]
                    let pointSize = CGFloat(rng.int(16...24))
                    guard let symbol = UIImage(systemName: name, withConfiguration: UIImage.SymbolConfiguration(pointSize: pointSize, weight: .regular))?
                        .withTintColor(color, renderingMode: .alwaysOriginal) else { continue }
                    let x = CGFloat(column) * 60 + CGFloat(rng.int(4...26)) + (row % 2 == 0 ? 0 : 14)
                    let y = CGFloat(row) * 60 + CGFloat(rng.int(4...26))
                    symbol.draw(at: CGPoint(x: x.truncatingRemainder(dividingBy: size.width), y: y))
                }
            }
        }
        patternCache[dark] = image
        return image
    }
}
