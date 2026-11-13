import Foundation

// Чистая часть своей раскладки ленты (шаг 2.5 плана аудита, идея `ListView` из
// Telegram-iOS): высота строки известна до показа — из кеша замеров или из оценки, — и
// позиции всех строк считаются заранее. Без UIKit: проверяется тестами.

/// Ключ замера строки: сообщение, его содержимое, ширина ленты и размер шрифта.
/// Сменилось что-то из этого — высоту надо мерить заново.
struct MessageHeightKey: Hashable {
    let id: String
    /// Отпечаток содержимого строки (`MessageTimeline.Item.hashValue` и режим выбора).
    let revision: Int
    let width: Int
    let category: String
}

/// Замеренные высоты строк. Только главный поток: пишет раскладка, читает раскладка.
final class MessageHeightCache {
    private var heights: [MessageHeightKey: Double] = [:]
    private let limit: Int

    init(limit: Int = 4000) {
        self.limit = limit
    }

    var count: Int { heights.count }

    func height(for key: MessageHeightKey) -> Double? {
        heights[key]
    }

    func store(_ height: Double, for key: MessageHeightKey) {
        // Переполнение — сбросить всё: ключи несут ширину и содержимое, и после поворота
        // экрана или смены шрифта старые замеры всё равно не пригодятся.
        if heights.count >= limit, heights[key] == nil { heights.removeAll(keepingCapacity: true) }
        heights[key] = height
    }

    func removeAll() {
        heights.removeAll()
    }
}

/// Оценка высоты пузыря до первого замера. Не точная — точнее прежних 44 pt для всех:
/// строка, впервые въезжающая сверху, меньше сдвигает то, что под пальцем.
enum MessageHeightEstimate {
    struct Input: Equatable {
        var textLength = 0
        var lineBreaks = 0
        /// Размеры одиночной медиаплитки в pt; `nil` — плитки нет.
        var media: (width: Double, height: Double)?
        var otherAttachments = 0
        var hasReply = false
        var showsName = false
        var hasReactions = false
        var isLastInGroup = false

        static func == (lhs: Input, rhs: Input) -> Bool {
            lhs.textLength == rhs.textLength && lhs.lineBreaks == rhs.lineBreaks
                && lhs.media?.width == rhs.media?.width && lhs.media?.height == rhs.media?.height
                && lhs.otherAttachments == rhs.otherAttachments && lhs.hasReply == rhs.hasReply
                && lhs.showsName == rhs.showsName && lhs.hasReactions == rhs.hasReactions
                && lhs.isLastInGroup == rhs.isLastInGroup
        }
    }

    struct Metrics {
        /// Ширина текста в пузыре, pt.
        var textWidth: Double
        var lineHeight: Double
        /// Средняя ширина символа основного шрифта, pt.
        var charWidth: Double
        /// Поля пузыря сверху и снизу вместе.
        var bubblePadding: Double = 14
        var nameHeight: Double = 18
        var replyHeight: Double = 44
        var reactionsHeight: Double = 30
        var fileRowHeight: Double = 52
        /// Отступ строки: внутри группы 1 + 1, у последней в группе 5 + 5.
        var groupGap: Double = 2
        var lastGap: Double = 10
    }

    static func estimate(_ input: Input, metrics: Metrics) -> Double {
        var height = metrics.bubblePadding
        if input.showsName { height += metrics.nameHeight }
        if input.hasReply { height += metrics.replyHeight }
        if let media = input.media { height += media.height }
        height += Double(input.otherAttachments) * metrics.fileRowHeight
        if input.textLength > 0 {
            let perLine = max(1, (metrics.textWidth / max(metrics.charWidth, 1)).rounded(.down))
            let wrapped = (Double(input.textLength) / perLine).rounded(.up)
            let lines = max(1, wrapped + Double(input.lineBreaks))
            height += lines * metrics.lineHeight
        }
        if input.hasReactions { height += metrics.reactionsHeight }
        height += input.isLastInGroup ? metrics.lastGap : metrics.groupGap
        return height.rounded(.up)
    }
}

/// Позиции заголовков дней и строк ленты сверху вниз.
struct MessageStackGeometry {
    struct Section: Equatable {
        var headerHeight: Double
        var itemHeights: [Double]
    }

    struct Frame: Equatable {
        var minY: Double
        var height: Double
        var maxY: Double { minY + height }
    }

    private(set) var sections: [Section]
    private(set) var headerFrames: [Frame] = []
    private(set) var itemFrames: [[Frame]] = []
    private(set) var contentHeight: Double = 0

    init(sections: [Section]) {
        self.sections = sections
        recompute(from: 0)
    }

    /// Новая высота строки. Возвращает разницу — на неё сдвинулось всё ниже.
    @discardableResult
    mutating func setHeight(_ height: Double, section: Int, item: Int) -> Double {
        guard sections.indices.contains(section), sections[section].itemHeights.indices.contains(item) else { return 0 }
        let delta = height - sections[section].itemHeights[item]
        guard abs(delta) > 0.0001 else { return 0 }
        sections[section].itemHeights[item] = height
        recompute(from: section)
        return delta
    }

    /// Строки и заголовки, пересекающие полосу `[top, bottom)`: секции — перебором (их
    /// десятки), строки внутри секции — двоичным поиском.
    func elements(from top: Double, to bottom: Double) -> (headers: [Int], items: [(section: Int, item: Int)]) {
        var headers: [Int] = []
        var items: [(Int, Int)] = []
        for section in sections.indices {
            let header = headerFrames[section]
            let last = itemFrames[section].last?.maxY ?? header.maxY
            guard last > top, header.minY < bottom else { continue }
            if header.maxY > top, header.minY < bottom { headers.append(section) }
            let frames = itemFrames[section]
            var low = 0
            var high = frames.count
            while low < high {
                let mid = (low + high) / 2
                if frames[mid].maxY <= top { low = mid + 1 } else { high = mid }
            }
            var index = low
            while index < frames.count, frames[index].minY < bottom {
                items.append((section, index))
                index += 1
            }
        }
        return (headers, items)
    }

    /// Строка сменила высоту целиком выше видимого верха — сдвиг прокрутки на разницу,
    /// иначе всё под пальцем уехало бы. Ниже верха или пересекая его — сдвига нет: эту
    /// строку человек видит, и она растёт вниз.
    static func offsetAdjustment(itemMinY: Double, delta: Double, visibleTop: Double) -> Double {
        itemMinY < visibleTop - 0.5 ? delta : 0
    }

    private mutating func recompute(from first: Int) {
        if headerFrames.count != sections.count || itemFrames.count != sections.count {
            headerFrames = Array(repeating: Frame(minY: 0, height: 0), count: sections.count)
            itemFrames = sections.map { Array(repeating: Frame(minY: 0, height: 0), count: $0.itemHeights.count) }
            return recompute(fromScratch: ())
        }
        var y = first > 0 ? (itemFrames[first - 1].last?.maxY ?? headerFrames[first - 1].maxY) : 0
        for section in first..<sections.count {
            headerFrames[section] = Frame(minY: y, height: sections[section].headerHeight)
            y += sections[section].headerHeight
            if itemFrames[section].count != sections[section].itemHeights.count {
                itemFrames[section] = Array(repeating: Frame(minY: 0, height: 0), count: sections[section].itemHeights.count)
            }
            for (index, height) in sections[section].itemHeights.enumerated() {
                itemFrames[section][index] = Frame(minY: y, height: height)
                y += height
            }
        }
        contentHeight = y
    }

    private mutating func recompute(fromScratch: Void) {
        var y = 0.0
        for section in sections.indices {
            headerFrames[section] = Frame(minY: y, height: sections[section].headerHeight)
            y += sections[section].headerHeight
            for (index, height) in sections[section].itemHeights.enumerated() {
                itemFrames[section][index] = Frame(minY: y, height: height)
                y += height
            }
        }
        contentHeight = y
    }
}
