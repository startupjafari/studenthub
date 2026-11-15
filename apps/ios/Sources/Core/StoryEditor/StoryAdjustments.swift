import Foundation

/// Ползунок раздела «Обработка». Значения — в единицах ползунка (как у Telegram:
/// −100…100 или 0…100), перевод в параметры фильтров — `StoryImageProcessor`.
enum StoryAdjustmentTool: String, Codable, CaseIterable, Identifiable, Sendable {
    case enhance
    case exposure
    case brightness
    case contrast
    case saturation
    case warmth
    case tint
    case highlights
    case shadows
    case vignette
    case sharpen
    case fade

    var id: String { rawValue }

    var range: ClosedRange<Double> {
        switch self {
        case .enhance, .vignette, .sharpen, .fade: return 0...100
        default: return -100...100
        }
    }

    /// Ноль — «без изменений» у всех ползунков.
    var neutral: Double { 0 }

    /// Ползунок от середины (−100…100) или от левого края (0…100).
    var isBipolar: Bool { range.lowerBound < 0 }
}

/// Значения ползунков. Каждый параметр хранится сам по себе: изменение одного не
/// трогает остальные, и все применяются вместе.
struct StoryAdjustments: Codable, Equatable, Sendable {
    private(set) var values: [StoryAdjustmentTool: Double] = [:]

    static let identity = StoryAdjustments()

    subscript(tool: StoryAdjustmentTool) -> Double {
        get { values[tool] ?? tool.neutral }
        set {
            let clamped = newValue.clamped(to: tool.range)
            if abs(clamped - tool.neutral) < 0.5 {
                values[tool] = nil
            } else {
                values[tool] = clamped
            }
        }
    }

    var isIdentity: Bool { values.isEmpty }

    /// Ползунки, сдвинутые с нуля, — подсветка в списке инструментов.
    var changedTools: Set<StoryAdjustmentTool> { Set(values.keys) }

    mutating func reset(_ tool: StoryAdjustmentTool) {
        values[tool] = nil
    }
}

/// Размытие: нет, радиальное (круг резкости) или линейное (полоса резкости).
struct StoryBlur: Codable, Equatable, Sendable {
    enum Mode: String, Codable, CaseIterable, Sendable {
        case off
        case radial
        case linear
    }

    var mode: Mode = .off
    /// Центр зоны резкости в долях холста.
    var center: StoryPoint = .center
    /// Радиус круга (радиальное) или полуширина полосы (линейное) — доля ширины холста.
    var size: Double = 0.24
    /// Ширина перехода от резкого к размытому — доля `size`.
    var falloff: Double = 0.35
    /// Направление полосы (линейное), радианы.
    var angle: Double = 0
    /// Сила размытия 0…1.
    var intensity: Double = 0.6

    static let off = StoryBlur()

    var isActive: Bool { mode != .off && intensity > 0.001 }

    static let sizeRange: ClosedRange<Double> = 0.05...0.8
    static let falloffRange: ClosedRange<Double> = 0.1...1.5

    mutating func setSize(_ value: Double) { size = value.clamped(to: Self.sizeRange) }
    mutating func setIntensity(_ value: Double) { intensity = value.clamped(to: 0...1) }
    mutating func setCenter(_ point: StoryPoint) {
        center = StoryPoint(x: point.x.clamped(to: 0...1), y: point.y.clamped(to: 0...1))
    }

    /// Доля резкости в точке холста: 1 — резко, 0 — размыто полностью. Та же формула,
    /// что у маски в `StoryImageProcessor` — по ней тест сверяет зону фокуса.
    func sharpness(at point: StoryPoint, aspect: Double = StoryCanvasGeometry.aspect) -> Double {
        guard isActive else { return 1 }
        let dx = point.x - center.x
        let dy = (point.y - center.y) / aspect
        let distance: Double
        switch mode {
        case .off:
            return 1
        case .radial:
            distance = (dx * dx + dy * dy).squareRoot()
        case .linear:
            // Расстояние от оси полосы: ось проходит через центр под углом `angle`.
            distance = abs(-sin(angle) * dx + cos(angle) * dy)
        }
        let inner = size
        let outer = size * (1 + falloff)
        if distance <= inner { return 1 }
        if distance >= outer { return 0 }
        let t = (distance - inner) / (outer - inner)
        return 1 - t * t * (3 - 2 * t)
    }
}

/// Тональная кривая одного канала: пять точек по X (0, ¼, ½, ¾, 1), каждую двигают
/// по вертикали — тени, полутона, света. Как у Telegram: X точек закреплён, поэтому
/// кривая всегда остаётся функцией и не ломается при перетаскивании.
struct StoryToneCurve: Codable, Equatable, Sendable {
    static let xs: [Double] = [0, 0.25, 0.5, 0.75, 1]
    static let identity = StoryToneCurve()

    private(set) var ys: [Double] = StoryToneCurve.xs

    init(ys: [Double] = StoryToneCurve.xs) {
        precondition(ys.count == Self.xs.count, "у кривой пять точек")
        self.ys = ys.map { $0.clamped(to: 0...1) }
    }

    var isIdentity: Bool {
        zip(ys, Self.xs).allSatisfy { abs($0 - $1) < 0.001 }
    }

    mutating func setPoint(_ index: Int, y: Double) {
        guard ys.indices.contains(index) else { return }
        ys[index] = y.clamped(to: 0...1)
    }

    /// Значение кривой в точке 0…1: монотонный кубический сплайн (Фритч — Карлсон).
    /// Монотонность важна: обычный сплайн между близкими точками даёт «горб», и
    /// светлое место снимка темнеет — кривая на экране так себя не ведёт.
    func value(at x: Double) -> Double {
        let xs = Self.xs
        let x = x.clamped(to: 0...1)
        let n = xs.count
        var slopes = [Double](repeating: 0, count: n - 1)
        for i in 0..<(n - 1) {
            slopes[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i])
        }
        var tangents = [Double](repeating: 0, count: n)
        tangents[0] = slopes[0]
        tangents[n - 1] = slopes[n - 2]
        for i in 1..<(n - 1) {
            tangents[i] = slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2
        }
        for i in 0..<(n - 1) where slopes[i] == 0 {
            tangents[i] = 0
            tangents[i + 1] = 0
        }
        for i in 0..<(n - 1) where slopes[i] != 0 {
            let a = tangents[i] / slopes[i]
            let b = tangents[i + 1] / slopes[i]
            let h = a * a + b * b
            if h > 9 {
                let t = 3 / h.squareRoot()
                tangents[i] = t * a * slopes[i]
                tangents[i + 1] = t * b * slopes[i]
            }
        }
        var segment = n - 2
        for i in 0..<(n - 1) where x <= xs[i + 1] {
            segment = i
            break
        }
        let h = xs[segment + 1] - xs[segment]
        let t = (x - xs[segment]) / h
        let t2 = t * t
        let t3 = t2 * t
        let value = (2 * t3 - 3 * t2 + 1) * ys[segment]
            + (t3 - 2 * t2 + t) * h * tangents[segment]
            + (-2 * t3 + 3 * t2) * ys[segment + 1]
            + (t3 - t2) * h * tangents[segment + 1]
        return value.clamped(to: 0...1)
    }
}

/// Кривые: общая и по каналам. Общая применяется первой, затем канальная — так же
/// складывает их Telegram (и Photoshop).
struct StoryToneCurves: Codable, Equatable, Sendable {
    enum Channel: String, Codable, CaseIterable, Sendable {
        case all
        case red
        case green
        case blue
    }

    var all = StoryToneCurve.identity
    var red = StoryToneCurve.identity
    var green = StoryToneCurve.identity
    var blue = StoryToneCurve.identity

    static let identity = StoryToneCurves()

    var isIdentity: Bool { all.isIdentity && red.isIdentity && green.isIdentity && blue.isIdentity }

    subscript(channel: Channel) -> StoryToneCurve {
        get {
            switch channel {
            case .all: return all
            case .red: return red
            case .green: return green
            case .blue: return blue
            }
        }
        set {
            switch channel {
            case .all: all = newValue
            case .red: red = newValue
            case .green: green = newValue
            case .blue: blue = newValue
            }
        }
    }

    /// Таблица соответствия на `count` уровней: `[r, g, b, r, g, b, …]` — формат
    /// `CIColorCurves.inputCurvesData`.
    func table(count: Int = 256) -> [Float] {
        guard count > 1 else { return [] }
        var result: [Float] = []
        result.reserveCapacity(count * 3)
        for index in 0..<count {
            let x = Double(index) / Double(count - 1)
            let master = all.value(at: x)
            result.append(Float(red.value(at: master)))
            result.append(Float(green.value(at: master)))
            result.append(Float(blue.value(at: master)))
        }
        return result
    }
}
