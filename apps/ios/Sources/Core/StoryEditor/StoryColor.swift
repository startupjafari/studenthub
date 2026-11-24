import Foundation

/// Цвет редактора историй: RGBA в долях 0…1. Хранится в черновике и применяется к
/// кисти и тексту; прозрачность — часть цвета (ползунок «Непрозрачность»
/// выбора цвета).
struct StoryColor: Codable, Hashable, Sendable {
    var red: Double
    var green: Double
    var blue: Double
    var alpha: Double

    init(red: Double, green: Double, blue: Double, alpha: Double = 1) {
        self.red = red.clamped(to: 0...1)
        self.green = green.clamped(to: 0...1)
        self.blue = blue.clamped(to: 0...1)
        self.alpha = alpha.clamped(to: 0...1)
    }

    init(white: Double, alpha: Double = 1) {
        self.init(red: white, green: white, blue: white, alpha: alpha)
    }

    /// `#RRGGBB` или `#RRGGBBAA`, с решёткой или без.
    init?(hex: String) {
        var string = hex.trimmingCharacters(in: .whitespaces).uppercased()
        if string.hasPrefix("#") { string.removeFirst() }
        guard string.count == 6 || string.count == 8, let value = UInt64(string, radix: 16) else { return nil }
        if string.count == 6 {
            self.init(
                red: Double((value >> 16) & 0xFF) / 255,
                green: Double((value >> 8) & 0xFF) / 255,
                blue: Double(value & 0xFF) / 255
            )
        } else {
            self.init(
                red: Double((value >> 24) & 0xFF) / 255,
                green: Double((value >> 16) & 0xFF) / 255,
                blue: Double((value >> 8) & 0xFF) / 255,
                alpha: Double(value & 0xFF) / 255
            )
        }
    }

    /// Тон, насыщенность, яркость — 0…1, как у `UIColor(hue:saturation:brightness:)`.
    init(hue: Double, saturation: Double, brightness: Double, alpha: Double = 1) {
        let h = (hue - hue.rounded(.down)) * 6
        let s = saturation.clamped(to: 0...1)
        let v = brightness.clamped(to: 0...1)
        let sector = Int(h) % 6
        let f = h - Double(Int(h))
        let p = v * (1 - s)
        let q = v * (1 - s * f)
        let t = v * (1 - s * (1 - f))
        let (r, g, b): (Double, Double, Double)
        switch sector {
        case 0: (r, g, b) = (v, t, p)
        case 1: (r, g, b) = (q, v, p)
        case 2: (r, g, b) = (p, v, t)
        case 3: (r, g, b) = (p, q, v)
        case 4: (r, g, b) = (t, p, v)
        default: (r, g, b) = (v, p, q)
        }
        self.init(red: r, green: g, blue: b, alpha: alpha)
    }

    var hex: String {
        let r = Int((red * 255).rounded())
        let g = Int((green * 255).rounded())
        let b = Int((blue * 255).rounded())
        return String(format: "#%02X%02X%02X", r, g, b)
    }

    /// Тон, насыщенность, яркость (0…1). У серого тон — 0.
    var hsb: (hue: Double, saturation: Double, brightness: Double) {
        let maxValue = max(red, green, blue)
        let minValue = min(red, green, blue)
        let delta = maxValue - minValue
        var hue = 0.0
        if delta > 0 {
            if maxValue == red {
                hue = ((green - blue) / delta).truncatingRemainder(dividingBy: 6)
            } else if maxValue == green {
                hue = (blue - red) / delta + 2
            } else {
                hue = (red - green) / delta + 4
            }
            hue /= 6
            if hue < 0 { hue += 1 }
        }
        let saturation = maxValue > 0 ? delta / maxValue : 0
        return (hue, saturation, maxValue)
    }

    /// Относительная яркость (WCAG) — чем подписать цветную подложку: белым или чёрным.
    var luminance: Double {
        func linear(_ c: Double) -> Double { c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
    }

    var isLight: Bool { luminance > 0.5 }

    func withAlpha(_ alpha: Double) -> StoryColor {
        StoryColor(red: red, green: green, blue: blue, alpha: alpha)
    }

    /// Тот же цвет без прозрачности — для кружка-образца и сравнения пресетов.
    var opaque: StoryColor { withAlpha(1) }

    /// Совпадает ли цвет с другим с точностью до восьми бит на канал.
    func matches(_ other: StoryColor, includingAlpha: Bool = false) -> Bool {
        hex == other.hex && (!includingAlpha || abs(alpha - other.alpha) < 0.5 / 255)
    }

    static let white = StoryColor(white: 1)
    static let black = StoryColor(white: 0)

    /// Быстрые цвета под кистями и в выборе цвета: те же оттенки, что у Telegram, но из
    /// системной палитры iOS (как остальной интерфейс StudentHub).
    static let presets: [StoryColor] = [
        .white,
        .black,
        StoryColor(hex: "#0A84FF")!,  // синий
        StoryColor(hex: "#30D158")!,  // зелёный
        StoryColor(hex: "#FFD60A")!,  // жёлтый
        StoryColor(hex: "#FF9F0A")!,  // оранжевый
        StoryColor(hex: "#FF453A")!,  // красный
        StoryColor(hex: "#BF5AF2")!,  // фиолетовый
        StoryColor(hex: "#FF375F")!,  // розовый
    ]

    /// Сетка «Палитра»: верхний ряд — серые от белого к чёрному, ниже — 12 тонов, от
    /// тёмных оттенков к светлым (как сетка системного выбора цвета iOS).
    static func paletteGrid(columns: Int = 12, rows: Int = 10) -> [[StoryColor]] {
        guard columns > 1, rows > 1 else { return [] }
        var grid: [[StoryColor]] = []
        grid.append((0..<columns).map { column in
            StoryColor(white: 1 - Double(column) / Double(columns - 1))
        })
        for row in 1..<rows {
            // Строки 1…rows-1: от глубокого тёмного (низкая яркость) через насыщенный к
            // пастельному (низкая насыщенность).
            let t = Double(row - 1) / Double(max(rows - 2, 1))
            let brightness = t < 0.5 ? 0.35 + t * 1.3 : 1
            let saturation = t < 0.5 ? 1 : 1 - (t - 0.5) * 1.5
            grid.append((0..<columns).map { column in
                StoryColor(
                    hue: Double(column) / Double(columns),
                    saturation: saturation,
                    brightness: brightness
                )
            })
        }
        return grid
    }
}
