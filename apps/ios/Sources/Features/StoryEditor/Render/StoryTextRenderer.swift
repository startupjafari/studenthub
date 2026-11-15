import UIKit

extension StoryFont {
    /// Название в выборе шрифта.
    var displayName: String {
        switch self {
        case .system: return "San Francisco"
        case .rounded: return "SF Rounded"
        case .serif: return "New York"
        case .mono: return "SF Mono"
        case .typewriter: return "Typewriter"
        case .handwriting: return "Noteworthy"
        }
    }

    func uiFont(size: CGFloat) -> UIFont {
        let base = UIFont.systemFont(ofSize: size, weight: .semibold)
        switch self {
        case .system:
            return base
        case .rounded:
            return base.fontDescriptor.withDesign(.rounded).map { UIFont(descriptor: $0, size: size) } ?? base
        case .serif:
            let bold = UIFont.systemFont(ofSize: size, weight: .bold)
            return bold.fontDescriptor.withDesign(.serif).map { UIFont(descriptor: $0, size: size) } ?? bold
        case .mono:
            return .monospacedSystemFont(ofSize: size, weight: .semibold)
        case .typewriter:
            return UIFont(name: "AmericanTypewriter-Semibold", size: size) ?? base
        case .handwriting:
            return UIFont(name: "Noteworthy-Bold", size: size) ?? base
        }
    }
}

extension StoryColor {
    var uiColor: UIColor { UIColor(red: red, green: green, blue: blue, alpha: alpha) }
    var cgColor: CGColor { uiColor.cgColor }

    init(_ color: UIColor) {
        var r: CGFloat = 0
        var g: CGFloat = 0
        var b: CGFloat = 0
        var a: CGFloat = 0
        if !color.getRed(&r, green: &g, blue: &b, alpha: &a) {
            var white: CGFloat = 0
            color.getWhite(&white, alpha: &a)
            (r, g, b) = (white, white, white)
        }
        self.init(red: r, green: g, blue: b, alpha: a)
    }
}

/// Раскладка надписи: строки, подложка и отрисовка. Один код для экрана и для экспорта —
/// надпись в готовой истории совпадает с тем, что было в редакторе.
///
/// Размеры — в единицах холста шириной `canvasWidth` (точки экрана или пиксели экспорта).
struct StoryTextLayout {
    let payload: StoryTextPayload
    let canvasWidth: CGFloat
    let attributed: NSAttributedString
    /// Прямоугольники строк (без отступов подложки), начало — левый верх надписи.
    let lineRects: [CGRect]
    /// Размер надписи вместе с подложкой.
    let size: CGSize
    let padding: CGSize

    /// Самая широкая надпись — 86 % холста, дальше перенос.
    static let maxWidthFraction: CGFloat = 0.86
    /// Запас ширины при отрисовке строк: раскладка по ровной ширине самой длинной строки
    /// могла бы перенести её последнее слово, хотя при измерении оно поместилось.
    static let wrapSlack: CGFloat = 2

    init(payload: StoryTextPayload, canvasWidth: CGFloat, text overrideText: String? = nil) {
        self.payload = payload
        self.canvasWidth = canvasWidth
        let fontSize = max(4, CGFloat(payload.fontSize) * canvasWidth)
        let font = payload.font.uiFont(size: fontSize)
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = payload.alignment.nsAlignment
        paragraph.lineBreakMode = .byWordWrapping
        paragraph.lineSpacing = 0
        var attributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: payload.glyphColor.uiColor,
            .paragraphStyle: paragraph,
        ]
        switch payload.style {
        case .outline:
            attributes[.strokeColor] = (payload.color.isLight ? StoryColor.black : StoryColor.white).uiColor
            attributes[.strokeWidth] = -6.0
        case .shadow:
            let shadow = NSShadow()
            shadow.shadowColor = UIColor.black.withAlphaComponent(0.55)
            shadow.shadowBlurRadius = fontSize * 0.18
            shadow.shadowOffset = CGSize(width: 0, height: fontSize * 0.04)
            attributes[.shadow] = shadow
        default:
            break
        }
        let text = overrideText ?? payload.text
        // Пустая строка всё равно даёт высоту курсора.
        let attributed = NSAttributedString(string: text.isEmpty ? " " : text, attributes: attributes)
        self.attributed = attributed

        padding = CGSize(width: fontSize * 0.38, height: fontSize * 0.16)
        let maxWidth = canvasWidth * Self.maxWidthFraction - padding.width * 2
        let storage = NSTextStorage(attributedString: attributed)
        let manager = NSLayoutManager()
        let container = NSTextContainer(size: CGSize(width: maxWidth, height: .greatestFiniteMagnitude))
        container.lineFragmentPadding = 0
        manager.addTextContainer(container)
        storage.addLayoutManager(manager)
        manager.ensureLayout(for: container)

        var lines: [CGRect] = []
        manager.enumerateLineFragments(forGlyphRange: NSRange(location: 0, length: manager.numberOfGlyphs)) { _, used, _, glyphRange, _ in
            let characters = manager.characterRange(forGlyphRange: glyphRange, actualGlyphRange: nil)
            let content = (attributed.string as NSString).substring(with: characters)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            var rect = used
            if content.isEmpty {
                // Пустая строка (двойной перенос) — без подложки, но с высотой.
                rect.size.width = 0
            }
            lines.append(rect)
        }
        if manager.extraLineFragmentRect.height > 0, text.hasSuffix("\n") {
            var extra = manager.extraLineFragmentRect
            extra.size.width = 0
            lines.append(extra)
        }
        let contentWidth = max(lines.map(\.width).max() ?? 0, fontSize * 0.3)
        let contentHeight = lines.last.map { $0.maxY } ?? font.lineHeight
        // Выравнивание строк внутри ширины самой длинной.
        let inset = padding
        let alignment = payload.alignment
        lineRects = lines.map { line in
            var rect = line
            switch alignment {
            case .left: rect.origin.x = inset.width
            case .center: rect.origin.x = inset.width + (contentWidth - line.width) / 2
            case .right: rect.origin.x = inset.width + contentWidth - line.width
            }
            rect.origin.y += inset.height
            return rect
        }
        size = CGSize(width: contentWidth + padding.width * 2, height: contentHeight + padding.height * 2)
    }

    /// Размер в долях ширины холста — для `StoryEntity.size`.
    var normalizedSize: StorySize {
        StorySize(width: Double(size.width / canvasWidth), height: Double(size.height / canvasWidth))
    }

    /// Контур подложки: строки, сросшиеся в одну фигуру со скруглёнными выпуклыми и
    /// вогнутыми углами — как подложка Telegram, а не стопка отдельных плашек.
    func platePath() -> CGPath? {
        let fontSize = CGFloat(payload.fontSize) * canvasWidth
        let radius = fontSize * 0.28
        let rows = lineRects.filter { $0.width > 0 }.map { $0.insetBy(dx: -padding.width, dy: 0) }
        guard !rows.isEmpty else { return nil }
        // Соседние строки — один блок; пустая строка между ними разрывает подложку.
        var blocks: [[CGRect]] = []
        for row in rows {
            if let last = blocks.last?.last, row.minY - last.maxY < fontSize * 0.25 {
                blocks[blocks.count - 1].append(
                    CGRect(x: row.minX, y: last.maxY, width: row.width, height: row.maxY - last.maxY)
                )
            } else {
                blocks.append([row])
            }
        }
        let path = CGMutablePath()
        for var block in blocks {
            // Края соседних строк ближе двух радиусов выравниваем — иначе на стыке зубец.
            for _ in 0..<2 where block.count > 1 {
                for index in 0..<(block.count - 1) {
                    let upper = block[index]
                    let lower = block[index + 1]
                    var minX = (upper.minX, lower.minX)
                    var maxX = (upper.maxX, lower.maxX)
                    if abs(upper.minX - lower.minX) < radius * 2 {
                        let edge = min(upper.minX, lower.minX)
                        minX = (edge, edge)
                    }
                    if abs(upper.maxX - lower.maxX) < radius * 2 {
                        let edge = max(upper.maxX, lower.maxX)
                        maxX = (edge, edge)
                    }
                    block[index] = CGRect(x: minX.0, y: upper.minY, width: maxX.0 - minX.0, height: upper.height)
                    block[index + 1] = CGRect(x: minX.1, y: lower.minY, width: maxX.1 - minX.1, height: lower.height)
                }
            }
            block[0].origin.y -= padding.height
            block[0].size.height += padding.height
            block[block.count - 1].size.height += padding.height
            path.addPath(Self.roundedOutline(of: block, radius: radius))
        }
        return path
    }

    /// Нарисовать надпись (и подложку) в контексте; начало — левый верх надписи.
    func draw(in context: CGContext) {
        if let plateColor = payload.plateColor, let path = platePath() {
            context.saveGState()
            context.addPath(path)
            context.setFillColor(plateColor.cgColor)
            context.fillPath()
            context.restoreGState()
        }
        UIGraphicsPushContext(context)
        let origin = CGPoint(x: padding.width, y: padding.height)
        let slack = Self.wrapSlack
        let rect = CGRect(
            origin: CGPoint(x: origin.x - slack / 2, y: origin.y),
            size: CGSize(width: size.width - padding.width * 2 + slack, height: size.height - padding.height * 2 + 1)
        )
        attributed.draw(with: rect, options: [.usesLineFragmentOrigin], context: nil)
        UIGraphicsPopContext()
    }

    // MARK: Контур

    /// Ступенчатый контур стопки прямоугольников со скруглением каждой вершины. Радиус
    /// вершины не больше половины соседних рёбер — короткая ступенька не выворачивается.
    static func roundedOutline(of rows: [CGRect], radius: CGFloat) -> CGPath {
        var vertices: [CGPoint] = []
        guard let first = rows.first, let last = rows.last else { return CGMutablePath() }
        vertices.append(CGPoint(x: first.minX, y: first.minY))
        vertices.append(CGPoint(x: first.maxX, y: first.minY))
        for index in 0..<(rows.count - 1) {
            let current = rows[index]
            let next = rows[index + 1]
            if abs(current.maxX - next.maxX) > 0.5 {
                vertices.append(CGPoint(x: current.maxX, y: current.maxY))
                vertices.append(CGPoint(x: next.maxX, y: current.maxY))
            }
        }
        vertices.append(CGPoint(x: last.maxX, y: last.maxY))
        vertices.append(CGPoint(x: last.minX, y: last.maxY))
        for index in stride(from: rows.count - 1, to: 0, by: -1) {
            let current = rows[index]
            let previous = rows[index - 1]
            if abs(current.minX - previous.minX) > 0.5 {
                vertices.append(CGPoint(x: current.minX, y: current.minY))
                vertices.append(CGPoint(x: previous.minX, y: current.minY))
            }
        }
        let path = CGMutablePath()
        let count = vertices.count
        func distance(_ a: CGPoint, _ b: CGPoint) -> CGFloat { hypot(b.x - a.x, b.y - a.y) }
        let start = CGPoint(
            x: (vertices[0].x + vertices[1].x) / 2,
            y: (vertices[0].y + vertices[1].y) / 2
        )
        path.move(to: start)
        for offset in 1...count {
            let corner = vertices[offset % count]
            let previous = vertices[(offset - 1) % count]
            let next = vertices[(offset + 1) % count]
            let limit = min(distance(previous, corner), distance(corner, next)) / 2
            path.addArc(tangent1End: corner, tangent2End: next, radius: min(radius, limit))
        }
        path.closeSubpath()
        return path
    }
}

extension StoryTextAlignment {
    var nsAlignment: NSTextAlignment {
        switch self {
        case .left: return .left
        case .center: return .center
        case .right: return .right
        }
    }

    var symbol: String {
        switch self {
        case .left: return "text.alignleft"
        case .center: return "text.aligncenter"
        case .right: return "text.alignright"
        }
    }
}
