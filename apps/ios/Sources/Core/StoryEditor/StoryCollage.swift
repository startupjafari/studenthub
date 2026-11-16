import Foundation

/// Раскладка коллажа камеры: ячейки — прямоугольники в долях холста 9:16.
enum StoryCollageLayout: String, Codable, CaseIterable, Identifiable, Sendable {
    case single
    /// Два кадра друг над другом.
    case twoStacked
    /// Два кадра рядом.
    case twoSideBySide
    /// Один сверху во всю ширину, два снизу.
    case threeTopWide
    /// Три полосы друг над другом.
    case threeStacked
    /// Сетка 2×2.
    case fourGrid
    /// Сетка 2×3.
    case sixGrid

    var id: String { rawValue }

    var cells: [StoryRect] {
        switch self {
        case .single:
            return [.unit]
        case .twoStacked:
            return Self.grid(columns: 1, rows: 2)
        case .twoSideBySide:
            return Self.grid(columns: 2, rows: 1)
        case .threeTopWide:
            return [
                StoryRect(x: 0, y: 0, width: 1, height: 0.5),
                StoryRect(x: 0, y: 0.5, width: 0.5, height: 0.5),
                StoryRect(x: 0.5, y: 0.5, width: 0.5, height: 0.5),
            ]
        case .threeStacked:
            return Self.grid(columns: 1, rows: 3)
        case .fourGrid:
            return Self.grid(columns: 2, rows: 2)
        case .sixGrid:
            return Self.grid(columns: 2, rows: 3)
        }
    }

    var count: Int { cells.count }

    private static func grid(columns: Int, rows: Int) -> [StoryRect] {
        let width = 1 / Double(columns)
        let height = 1 / Double(rows)
        return (0..<rows).flatMap { row in
            (0..<columns).map { column in
                StoryRect(x: Double(column) * width, y: Double(row) * height, width: width, height: height)
            }
        }
    }
}

/// Съёмка коллажа: какие ячейки заполнены и какая снимается сейчас.
///
/// Кадр — любой идентификатор снимка (`Frame`): модель не знает о картинках, поэтому
/// проверяется без камеры.
struct StoryCollageCapture<Frame: Equatable & Sendable>: Equatable, Sendable {
    private(set) var layout: StoryCollageLayout
    private(set) var frames: [Frame?]
    /// Ячейка с живой камерой. `nil` — все заполнены.
    private(set) var activeIndex: Int?

    init(layout: StoryCollageLayout) {
        self.layout = layout
        frames = Array(repeating: nil, count: layout.count)
        activeIndex = 0
    }

    var filledCount: Int { frames.lazy.filter { $0 != nil }.count }
    var isEmpty: Bool { filledCount == 0 }
    var isComplete: Bool { filledCount == layout.count }

    /// Снимок в активную ячейку; активной становится следующая пустая (по порядку,
    /// с началом сначала, если пустые остались только позади).
    mutating func capture(_ frame: Frame) {
        guard let index = activeIndex else { return }
        frames[index] = frame
        activeIndex = nextEmpty(after: index)
    }

    /// «Переснять» ячейку: кадр убирается, камера встаёт в эту ячейку.
    mutating func retake(_ index: Int) {
        guard frames.indices.contains(index) else { return }
        frames[index] = nil
        activeIndex = index
    }

    /// Выбрать пустую ячейку для съёмки (тап по пустой).
    mutating func activate(_ index: Int) {
        guard frames.indices.contains(index), frames[index] == nil else { return }
        activeIndex = index
    }

    /// Смена раскладки: снятые кадры переходят в новые ячейки по порядку; лишние
    /// (новая сетка меньше) отбрасываются — их возвращает `dropped`.
    @discardableResult
    mutating func change(to newLayout: StoryCollageLayout) -> [Frame] {
        let kept = frames.compactMap { $0 }
        var next = Array<Frame?>(repeating: nil, count: newLayout.count)
        for (index, frame) in kept.prefix(newLayout.count).enumerated() { next[index] = frame }
        let dropped = Array(kept.dropFirst(newLayout.count))
        layout = newLayout
        frames = next
        activeIndex = next.firstIndex { $0 == nil }
        return dropped
    }

    /// Смена раскладки потеряет кадры — спросить подтверждение.
    func wouldDropFrames(changingTo newLayout: StoryCollageLayout) -> Bool {
        filledCount > newLayout.count
    }

    private func nextEmpty(after index: Int) -> Int? {
        let order = Array(frames.indices.dropFirst(index + 1)) + Array(frames.indices.prefix(index + 1))
        return order.first { frames[$0] == nil }
    }
}

/// Порядок выбора в галерее: номер у плитки — позиция в этом списке. Снятие отметки
/// сдвигает номера следующих, но не меняет их взаимный порядок.
struct StoryGallerySelection: Equatable, Sendable {
    static let limit = 10

    private(set) var ids: [String] = []

    var isEmpty: Bool { ids.isEmpty }
    var count: Int { ids.count }

    /// Номер (с единицы) или `nil`, если не выбрано.
    func number(of id: String) -> Int? {
        ids.firstIndex(of: id).map { $0 + 1 }
    }

    /// Отметить или снять. Возвращает `false`, если упёрлись в предел.
    @discardableResult
    mutating func toggle(_ id: String) -> Bool {
        if let index = ids.firstIndex(of: id) {
            ids.remove(at: index)
            return true
        }
        guard ids.count < Self.limit else { return false }
        ids.append(id)
        return true
    }

    mutating func clear() { ids.removeAll() }
}
