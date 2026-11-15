import Foundation

// Геометрия редактора историй. Всё, что лежит на холсте, хранится в долях холста 9:16
// (0…1 по обеим осям): так раскладка не зависит от экрана, на котором её собрали, и
// одинаково ложится в экспорт 1080×1920 и в просмотр на другом устройстве.
//
// Свои типы вместо CGPoint/CGRect: модель редактора собирается и тестируется и без
// UIKit (на Linux), а Codable у CoreGraphics-типов там не гарантирован.

/// Точка в долях холста.
struct StoryPoint: Codable, Hashable, Sendable {
    var x: Double
    var y: Double

    static let center = StoryPoint(x: 0.5, y: 0.5)
    static let zero = StoryPoint(x: 0, y: 0)

    func distance(to other: StoryPoint) -> Double {
        let dx = other.x - x
        let dy = other.y - y
        return (dx * dx + dy * dy).squareRoot()
    }

    static func + (lhs: StoryPoint, rhs: StoryPoint) -> StoryPoint {
        StoryPoint(x: lhs.x + rhs.x, y: lhs.y + rhs.y)
    }

    static func - (lhs: StoryPoint, rhs: StoryPoint) -> StoryPoint {
        StoryPoint(x: lhs.x - rhs.x, y: lhs.y - rhs.y)
    }

    static func * (lhs: StoryPoint, rhs: Double) -> StoryPoint {
        StoryPoint(x: lhs.x * rhs, y: lhs.y * rhs)
    }

    /// Середина отрезка — опорная точка сглаживания штриха.
    func midpoint(_ other: StoryPoint) -> StoryPoint {
        StoryPoint(x: (x + other.x) / 2, y: (y + other.y) / 2)
    }
}

/// Размер в пикселях исходника или в долях холста — по месту использования.
struct StorySize: Codable, Hashable, Sendable {
    var width: Double
    var height: Double

    var aspect: Double { height > 0 ? width / height : 1 }
}

/// Прямоугольник в долях холста.
struct StoryRect: Codable, Hashable, Sendable {
    var x: Double
    var y: Double
    var width: Double
    var height: Double

    static let unit = StoryRect(x: 0, y: 0, width: 1, height: 1)

    var center: StoryPoint { StoryPoint(x: x + width / 2, y: y + height / 2) }
    var maxX: Double { x + width }
    var maxY: Double { y + height }

    func contains(_ point: StoryPoint) -> Bool {
        point.x >= x && point.x <= maxX && point.y >= y && point.y <= maxY
    }
}

/// Холст истории: 9:16, экспорт 1080×1920 (как у Telegram).
enum StoryCanvasGeometry {
    static let aspect: Double = 9.0 / 16.0
    static let exportSize = StorySize(width: 1080, height: 1920)

    /// Где лежит исходник `media` (ширина/высота в пикселях), вписанный в холст целиком
    /// («Не растягивать исходное изображение»): доли холста. Остаток холста закрывает фон.
    static func fittedRect(for media: StorySize) -> StoryRect {
        guard media.width > 0, media.height > 0 else { return .unit }
        let mediaAspect = media.width / media.height
        if mediaAspect > aspect {
            // Шире холста: во всю ширину, полосы сверху и снизу.
            let height = aspect / mediaAspect
            return StoryRect(x: 0, y: (1 - height) / 2, width: 1, height: height)
        } else {
            let width = mediaAspect / aspect
            return StoryRect(x: (1 - width) / 2, y: 0, width: width, height: 1)
        }
    }

    /// Снимок почти 9:16 (камера телефона 3:4 сюда не попадает) заполняет холст без
    /// полос: разница меньше 8 % срезается по краям, как у Telegram.
    static func fillsCanvas(_ media: StorySize) -> Bool {
        guard media.width > 0, media.height > 0 else { return false }
        return abs(media.width / media.height - aspect) / aspect < 0.08
    }
}

/// Сдвиг, масштаб и поворот — у фона и у каждого объекта на холсте.
struct StoryTransform: Codable, Hashable, Sendable {
    /// Сдвиг центра в долях холста.
    var offset: StoryPoint = .zero
    var scale: Double = 1
    /// Радианы, по часовой стрелке (как у `CGAffineTransform` на экране).
    var rotation: Double = 0

    static let identity = StoryTransform()

    var isIdentity: Bool { self == .identity }

    /// Масштаб держим в границах: объект не схлопывается в точку и не раздувается так,
    /// что его уже не ухватить двумя пальцами.
    static func clampedScale(_ scale: Double, min lower: Double = 0.2, max upper: Double = 8) -> Double {
        Swift.min(Swift.max(scale, lower), upper)
    }
}

extension Double {
    /// Ограничение отрезком — для ползунков и долей.
    func clamped(to range: ClosedRange<Double>) -> Double {
        Swift.min(Swift.max(self, range.lowerBound), range.upperBound)
    }
}
