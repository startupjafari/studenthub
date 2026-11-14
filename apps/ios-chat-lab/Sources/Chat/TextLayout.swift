import UIKit
import CoreText

/// Раскладка текста сообщения, посчитанная Core Text. Потокобезопасна: считается там, где
/// считают раскладку ленты, а ячейка только рисует. Цвета в раскладку не входят — их
/// подставляет отрисовка по текущей теме, поэтому смена темы раскладку не сбрасывает.
struct TextLayout {
    struct Link {
        var range: NSRange
        var url: URL
    }

    let string: String
    let font: UIFont
    /// Ширина коробки, в которой считались переносы. Рисовать нужно в ней же, иначе
    /// переносы могут разойтись на долю пункта.
    let boxWidth: CGFloat
    let size: CGSize
    let lastLineWidth: CGFloat
    let lineCount: Int
    let links: [Link]
    let frame: CTFrame

    static let linkAttribute = NSAttributedString.Key("ChatLab.link")

    private static let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)

    static func make(_ string: String, font: UIFont, maxWidth: CGFloat, detectLinks: Bool = true) -> TextLayout {
        var links: [Link] = []
        if detectLinks, let detector, string.contains(".") {
            let range = NSRange(string.startIndex..., in: string)
            for match in detector.matches(in: string, options: [], range: range) {
                if let url = match.url { links.append(Link(range: match.range, url: url)) }
            }
        }
        let attributed = baseAttributedString(string, font: font, links: links, textColor: nil, linkColor: nil)
        let framesetter = CTFramesetterCreateWithAttributedString(attributed)
        let path = CGPath(rect: CGRect(x: 0, y: 0, width: maxWidth, height: 100_000), transform: nil)
        let frame = CTFramesetterCreateFrame(framesetter, CFRange(location: 0, length: 0), path, nil)
        let lines = CTFrameGetLines(frame) as? [CTLine] ?? []
        var maxLineWidth: CGFloat = 0
        var lastWidth: CGFloat = 0
        for line in lines {
            let width = CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil)) - CGFloat(CTLineGetTrailingWhitespaceWidth(line))
            maxLineWidth = max(maxLineWidth, width)
            lastWidth = width
        }
        let suggested = CTFramesetterSuggestFrameSizeWithConstraints(
            framesetter, CFRange(location: 0, length: 0), nil, CGSize(width: maxWidth, height: .greatestFiniteMagnitude), nil
        )
        let size = CGSize(width: ceil(min(maxWidth, max(maxLineWidth, 1))), height: ceil(suggested.height))
        return TextLayout(
            string: string, font: font, boxWidth: maxWidth, size: size, lastLineWidth: ceil(lastWidth),
            lineCount: lines.count, links: links, frame: frame
        )
    }

    static func baseAttributedString(
        _ string: String, font: UIFont, links: [Link], textColor: UIColor?, linkColor: UIColor?
    ) -> NSAttributedString {
        var attributes: [NSAttributedString.Key: Any] = [.font: font]
        if let textColor { attributes[.foregroundColor] = textColor.cgColor }
        let result = NSMutableAttributedString(string: string, attributes: attributes)
        for link in links {
            result.addAttribute(linkAttribute, value: link.url, range: link.range)
            if let linkColor { result.addAttribute(.foregroundColor, value: linkColor.cgColor, range: link.range) }
        }
        return result
    }

    /// Индекс символа под точкой (координаты вида, ось Y вниз) — для нажатия на ссылку.
    func characterIndex(at point: CGPoint) -> Int? {
        let lines = CTFrameGetLines(frame) as? [CTLine] ?? []
        guard !lines.isEmpty else { return nil }
        var origins = [CGPoint](repeating: .zero, count: lines.count)
        CTFrameGetLineOrigins(frame, CFRange(location: 0, length: 0), &origins)
        let frameHeight: CGFloat = 100_000
        for (index, line) in lines.enumerated() {
            var ascent: CGFloat = 0
            var descent: CGFloat = 0
            var leading: CGFloat = 0
            let width = CGFloat(CTLineGetTypographicBounds(line, &ascent, &descent, &leading))
            let baselineY = frameHeight - origins[index].y
            let top = baselineY - ascent - 2
            let bottom = baselineY + descent + leading + 2
            if point.y >= top, point.y <= bottom {
                guard point.x <= origins[index].x + width + 4 else { return nil }
                let position = CTLineGetStringIndexForPosition(line, CGPoint(x: point.x - origins[index].x, y: 0))
                return position == kCFNotFound ? nil : position
            }
        }
        return nil
    }

    func link(at point: CGPoint) -> Link? {
        guard !links.isEmpty, let index = characterIndex(at: point) else { return nil }
        return links.first { NSLocationInRange(index, $0.range) || NSLocationInRange(index - 1, $0.range) }
    }

    /// Прямоугольники подстроки (подсветка найденного в поиске).
    func rects(for range: NSRange) -> [CGRect] {
        let lines = CTFrameGetLines(frame) as? [CTLine] ?? []
        var origins = [CGPoint](repeating: .zero, count: lines.count)
        CTFrameGetLineOrigins(frame, CFRange(location: 0, length: 0), &origins)
        let frameHeight: CGFloat = 100_000
        var result: [CGRect] = []
        for (index, line) in lines.enumerated() {
            let lineRange = CTLineGetStringRange(line)
            let intersectionStart = max(range.location, lineRange.location)
            let intersectionEnd = min(range.location + range.length, lineRange.location + lineRange.length)
            guard intersectionStart < intersectionEnd else { continue }
            var ascent: CGFloat = 0
            var descent: CGFloat = 0
            CTLineGetTypographicBounds(line, &ascent, &descent, nil)
            let startX = CTLineGetOffsetForStringIndex(line, intersectionStart, nil)
            let endX = CTLineGetOffsetForStringIndex(line, intersectionEnd, nil)
            let baselineY = frameHeight - origins[index].y
            result.append(CGRect(
                x: origins[index].x + startX - 1, y: baselineY - ascent - 1,
                width: endX - startX + 2, height: ascent + descent + 2
            ))
        }
        return result
    }
}

/// Вид, который рисует `TextLayout`. Перерисовка — только при смене текста, темы или подсветки.
final class MessageTextView: UIView {
    var layout: TextLayout? { didSet { setNeedsDisplay() } }
    var textColor: UIColor = .label { didSet { setNeedsDisplay() } }
    var linkColor: UIColor = .link { didSet { setNeedsDisplay() } }
    var highlightQuery: String? { didSet { if oldValue != highlightQuery { setNeedsDisplay() } } }

    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        backgroundColor = .clear
        contentMode = .redraw
        isAccessibilityElement = false
        registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (view: MessageTextView, _) in view.setNeedsDisplay() }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func draw(_ rect: CGRect) {
        guard let layout, let context = UIGraphicsGetCurrentContext() else { return }
        if let query = highlightQuery, !query.isEmpty {
            let nsString = layout.string as NSString
            var searchRange = NSRange(location: 0, length: nsString.length)
            Palette.searchHighlight.setFill()
            while true {
                let found = nsString.range(of: query, options: [.caseInsensitive, .diacriticInsensitive], range: searchRange)
                guard found.location != NSNotFound else { break }
                for rect in layout.rects(for: found) {
                    UIBezierPath(roundedRect: rect, cornerRadius: 3).fill()
                }
                searchRange = NSRange(location: found.location + found.length, length: nsString.length - found.location - found.length)
            }
        }
        let attributed = TextLayout.baseAttributedString(
            layout.string, font: layout.font, links: layout.links,
            textColor: textColor.resolvedColor(with: traitCollection), linkColor: linkColor.resolvedColor(with: traitCollection)
        )
        let framesetter = CTFramesetterCreateWithAttributedString(attributed)
        // Та же коробка, что при замере; высота — ровно высота вида, текст прижат к верху.
        let path = CGPath(rect: CGRect(x: 0, y: 0, width: layout.boxWidth, height: bounds.height), transform: nil)
        let frame = CTFramesetterCreateFrame(framesetter, CFRange(location: 0, length: 0), path, nil)
        context.saveGState()
        context.textMatrix = .identity
        context.translateBy(x: 0, y: bounds.height)
        context.scaleBy(x: 1, y: -1)
        CTFrameDraw(frame, context)
        context.restoreGState()
    }

    func link(at point: CGPoint) -> URL? {
        // Координаты замера тоже «от верха текста», ось Y вниз — совпадают с видом.
        layout?.link(at: point)?.url
    }
}
