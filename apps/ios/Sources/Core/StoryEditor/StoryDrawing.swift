import Foundation

/// Кисть режима «Рисунок». Каждая — свой характер линии: толщина по умолчанию, предел
/// толщины, прозрачность и то, как штрих рисуется (`StoryStrokeRenderer`).
enum StoryBrush: String, Codable, CaseIterable, Sendable {
    /// Ручка: тонкая сплошная линия.
    case pen
    /// Маркер: широкий, плотный.
    case marker
    /// Неон: цветное свечение вокруг светлой сердцевины.
    case neon
    /// Выделитель: широкий полупрозрачный, перекрытия внутри штриха не темнеют.
    case highlighter
    /// Стрелка: линия ручки со стрелкой на конце — кисть особого эффекта.
    case arrow
    /// Ластик: стирает только рисунок, не фото и не объекты.
    case eraser

    /// Толщина по умолчанию — доля ширины холста (на 1080 px: ручка ≈ 13 px).
    var defaultWidth: Double {
        switch self {
        case .pen: return 0.012
        case .marker: return 0.03
        case .neon: return 0.016
        case .highlighter: return 0.05
        case .arrow: return 0.012
        case .eraser: return 0.05
        }
    }

    /// Пределы ползунка толщины.
    var widthRange: ClosedRange<Double> {
        switch self {
        case .pen, .arrow: return 0.004...0.04
        case .marker: return 0.012...0.08
        case .neon: return 0.006...0.05
        case .highlighter: return 0.02...0.12
        case .eraser: return 0.015...0.15
        }
    }

    /// Множитель прозрачности поверх цвета кисти.
    var opacity: Double {
        switch self {
        case .highlighter: return 0.45
        case .marker: return 0.92
        default: return 1
        }
    }

    /// Конец штриха прямоугольный (выделитель) или круглый (остальные).
    var hasSquareCap: Bool { self == .highlighter }

    /// Свечение неона — во сколько раз оно шире самой линии.
    var glowFactor: Double { self == .neon ? 1.6 : 0 }

    /// Кисть рисует цветом (ластику цвет не нужен).
    var usesColor: Bool { self != .eraser }
}

/// Один штрих — от касания до отпускания пальца. Точки — в долях холста.
struct StoryStroke: Codable, Equatable, Identifiable, Sendable {
    var id = UUID()
    var brush: StoryBrush
    var color: StoryColor
    /// Толщина — доля ширины холста.
    var width: Double
    var points: [StoryPoint]
}

/// Параметры инструмента рисования: выбранная кисть, цвет и толщина каждой кисти.
/// Сохраняются в черновике и возвращаются при повторном входе в режим.
struct StoryDrawingTool: Codable, Equatable, Sendable {
    var brush: StoryBrush = .pen
    var color: StoryColor = .white
    var widths: [StoryBrush: Double] = [:]

    func width(for brush: StoryBrush) -> Double {
        (widths[brush] ?? brush.defaultWidth).clamped(to: brush.widthRange)
    }

    mutating func setWidth(_ width: Double, for brush: StoryBrush) {
        widths[brush] = width.clamped(to: brush.widthRange)
    }

    /// Штрих, которым сейчас рисует палец.
    func stroke(points: [StoryPoint] = []) -> StoryStroke {
        StoryStroke(brush: brush, color: color, width: width(for: brush), points: points)
    }
}

/// Рисунок с историей отмены и повтора.
///
/// История — список действий, а не снимков слоя: «Отмена» снимает последнее действие,
/// «Очистить всё» — одно действие, которое возвращается одной отменой. После нового
/// штриха повтор сбрасывается — иначе повтор восстановил бы штрих поверх нового.
struct StoryDrawing: Codable, Equatable, Sendable {
    enum Action: Equatable, Sendable {
        case add(StoryStroke)
        case clear([StoryStroke])
    }

    private(set) var strokes: [StoryStroke] = []
    private(set) var undoStack: [Action] = []
    private(set) var redoStack: [Action] = []

    init(strokes: [StoryStroke] = []) {
        self.strokes = strokes
    }

    var isEmpty: Bool { strokes.isEmpty }
    var canUndo: Bool { !undoStack.isEmpty }
    var canRedo: Bool { !redoStack.isEmpty }

    /// Штрих короче двух точек всё равно рисуется — это точка от касания без движения.
    mutating func add(_ stroke: StoryStroke) {
        guard !stroke.points.isEmpty else { return }
        strokes.append(stroke)
        undoStack.append(.add(stroke))
        redoStack.removeAll()
    }

    /// Стирает все штрихи слоя. Пустой слой не даёт лишнего шага в истории.
    @discardableResult
    mutating func clearAll() -> Bool {
        guard !strokes.isEmpty else { return false }
        undoStack.append(.clear(strokes))
        strokes.removeAll()
        redoStack.removeAll()
        return true
    }

    @discardableResult
    mutating func undo() -> Bool {
        guard let action = undoStack.popLast() else { return false }
        switch action {
        case .add(let stroke):
            if let index = strokes.lastIndex(where: { $0.id == stroke.id }) { strokes.remove(at: index) }
        case .clear(let previous):
            strokes = previous
        }
        redoStack.append(action)
        return true
    }

    @discardableResult
    mutating func redo() -> Bool {
        guard let action = redoStack.popLast() else { return false }
        switch action {
        case .add(let stroke):
            strokes.append(stroke)
        case .clear:
            strokes.removeAll()
        }
        undoStack.append(action)
        return true
    }

    /// История отмены — только на время правки: в черновик уходят штрихи.
    private enum CodingKeys: String, CodingKey {
        case strokes
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        strokes = try container.decodeIfPresent([StoryStroke].self, forKey: .strokes) ?? []
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(strokes, forKey: .strokes)
    }

    /// Равенство — по видимому рисунку: история отмены не делает документ «изменённым».
    static func == (lhs: StoryDrawing, rhs: StoryDrawing) -> Bool {
        lhs.strokes == rhs.strokes
    }
}

/// Элемент контура штриха — общий для экрана (CGPath) и экспорта.
enum StoryPathElement: Equatable, Sendable {
    case move(StoryPoint)
    case line(StoryPoint)
    case quad(to: StoryPoint, control: StoryPoint)
}

/// Сглаживание траектории пальца.
///
/// Касания приходят ломаной с шагом в несколько точек; кривая строится квадратичными
/// сегментами через середины соседних отрезков, а сами точки касания становятся
/// контрольными. Линия проходит рядом с пальцем без углов, и каждая новая точка
/// меняет только хвост контура — экран дорисовывает конец, а не весь штрих.
enum StoryStrokeSmoothing {
    /// Точки ближе этого (доля ширины холста) отбрасываются: дрожь пальца не даёт зубцов.
    static let minimumStep = 0.0025

    /// Добавить точку касания, если она отошла от последней достаточно далеко.
    /// Возвращает `true`, если точка принята.
    @discardableResult
    static func append(_ point: StoryPoint, to points: inout [StoryPoint], minimumStep: Double = minimumStep) -> Bool {
        if let last = points.last, last.distance(to: point) < minimumStep { return false }
        points.append(point)
        return true
    }

    static func elements(for points: [StoryPoint]) -> [StoryPathElement] {
        guard let first = points.first else { return [] }
        guard points.count > 2 else {
            // Точка — отрезок нулевой длины: с круглым концом он рисуется кружком.
            return [.move(first), .line(points.count == 2 ? points[1] : first)]
        }
        var result: [StoryPathElement] = [.move(first), .line(first.midpoint(points[1]))]
        for index in 1..<(points.count - 1) {
            result.append(.quad(to: points[index].midpoint(points[index + 1]), control: points[index]))
        }
        result.append(.line(points[points.count - 1]))
        return result
    }

    /// Наконечник стрелки: два «уса» от острия назад под углом ±30° к направлению
    /// последнего участка штриха. Направление берётся по точке, отстоящей от конца
    /// хотя бы на `reach` — иначе дрожь последних миллиметров крутит стрелку.
    static func arrowHead(for points: [StoryPoint], width: Double, aspect: Double = StoryCanvas.aspect) -> (left: StoryPoint, tip: StoryPoint, right: StoryPoint)? {
        guard let tip = points.last, points.count > 1 else { return nil }
        let reach = max(width * 3, 0.02)
        // Доли холста по осям не равны (9:16): угол считаем в «квадратных» единицах.
        func square(_ point: StoryPoint) -> StoryPoint { StoryPoint(x: point.x, y: point.y / aspect) }
        let tipSquare = square(tip)
        var base = points[0]
        for point in points.reversed().dropFirst() where square(point).distance(to: tipSquare) >= reach {
            base = point
            break
        }
        let baseSquare = square(base)
        let dx = tipSquare.x - baseSquare.x
        let dy = tipSquare.y - baseSquare.y
        let length = (dx * dx + dy * dy).squareRoot()
        guard length > 0 else { return nil }
        let angle = atan2(dy, dx)
        let size = max(width * 4, 0.03)
        func wing(_ delta: Double) -> StoryPoint {
            let a = angle + .pi - delta
            return StoryPoint(x: tipSquare.x + cos(a) * size, y: (tipSquare.y + sin(a) * size) * aspect)
        }
        return (wing(.pi / 6), tip, wing(-.pi / 6))
    }
}
