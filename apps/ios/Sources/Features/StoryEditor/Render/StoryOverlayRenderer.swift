import UIKit

/// Перевод долей холста в точки конкретного холста.
struct StoryCanvasMetrics {
    let size: CGSize

    var width: CGFloat { size.width }

    func point(_ point: StoryPoint) -> CGPoint {
        CGPoint(x: CGFloat(point.x) * size.width, y: CGFloat(point.y) * size.height)
    }

    func normalized(_ point: CGPoint) -> StoryPoint {
        StoryPoint(x: Double(point.x / max(size.width, 1)), y: Double(point.y / max(size.height, 1)))
    }

    func rect(_ rect: StoryRect) -> CGRect {
        CGRect(
            x: CGFloat(rect.x) * size.width,
            y: CGFloat(rect.y) * size.height,
            width: CGFloat(rect.width) * size.width,
            height: CGFloat(rect.height) * size.height
        )
    }

    /// Размер в долях ширины холста → точки.
    func length(_ value: Double) -> CGFloat { CGFloat(value) * size.width }

    /// Рамка медиа на холсте: вписанный прямоугольник со сдвигом и масштабом фона
    /// (поворот — отдельно, вокруг центра).
    func mediaFrame(for media: StorySize, transform: StoryTransform) -> (center: CGPoint, size: CGSize) {
        let fitted = rect(StoryCanvasGeometry.fillsCanvas(media) ? .unit : StoryCanvasGeometry.fittedRect(for: media))
        let center = CGPoint(
            x: fitted.midX + CGFloat(transform.offset.x) * size.width,
            y: fitted.midY + CGFloat(transform.offset.y) * size.height
        )
        var fittedSize = fitted.size
        if StoryCanvasGeometry.fillsCanvas(media) {
            // Почти 9:16 — заполняем холст целиком (обрезка по короткой стороне).
            let mediaAspect = CGFloat(media.aspect)
            let canvasAspect = size.width / size.height
            fittedSize = mediaAspect > canvasAspect
                ? CGSize(width: size.height * mediaAspect, height: size.height)
                : CGSize(width: size.width, height: size.width / mediaAspect)
        }
        let scale = CGFloat(transform.scale)
        return (center, CGSize(width: fittedSize.width * scale, height: fittedSize.height * scale))
    }
}

/// Штрихи рисунка — контур и отрисовка всех кистей.
enum StoryStrokeRenderer {
    static func path(for points: [StoryPoint], metrics: StoryCanvasMetrics) -> CGPath {
        let path = CGMutablePath()
        for element in StoryStrokeSmoothing.elements(for: points) {
            switch element {
            case .move(let point): path.move(to: metrics.point(point))
            case .line(let point): path.addLine(to: metrics.point(point))
            case let .quad(to, control): path.addQuadCurve(to: metrics.point(to), control: metrics.point(control))
            }
        }
        return path
    }

    /// Усы стрелки — отдельный контур, той же толщины.
    static func arrowPath(for stroke: StoryStroke, metrics: StoryCanvasMetrics) -> CGPath? {
        guard stroke.brush == .arrow,
              let head = StoryStrokeSmoothing.arrowHead(for: stroke.points, width: stroke.width)
        else { return nil }
        let path = CGMutablePath()
        path.move(to: metrics.point(head.left))
        path.addLine(to: metrics.point(head.tip))
        path.addLine(to: metrics.point(head.right))
        return path
    }

    /// Все штрихи — в отдельном прозрачном слое: ластик стирает только рисунок.
    static func draw(_ strokes: [StoryStroke], in context: CGContext, metrics: StoryCanvasMetrics) {
        guard !strokes.isEmpty else { return }
        context.saveGState()
        context.beginTransparencyLayer(auxiliaryInfo: nil)
        for stroke in strokes { draw(stroke, in: context, metrics: metrics) }
        context.endTransparencyLayer()
        context.restoreGState()
    }

    static func draw(_ stroke: StoryStroke, in context: CGContext, metrics: StoryCanvasMetrics) {
        let path = path(for: stroke.points, metrics: metrics)
        let width = metrics.length(stroke.width)
        let brush = stroke.brush
        context.saveGState()
        context.setLineWidth(width)
        context.setLineCap(brush.hasSquareCap ? .square : .round)
        context.setLineJoin(.round)
        switch brush {
        case .eraser:
            context.setBlendMode(.clear)
            context.setStrokeColor(UIColor.black.cgColor)
            context.addPath(path)
            context.strokePath()
        case .neon:
            let color = stroke.color.uiColor
            context.setShadow(offset: .zero, blur: width * CGFloat(brush.glowFactor), color: color.cgColor)
            context.setStrokeColor(color.cgColor)
            context.addPath(path)
            context.strokePath()
            context.setShadow(offset: .zero, blur: 0, color: nil)
            context.setLineWidth(width * 0.45)
            context.setStrokeColor(neonCore(of: stroke.color).cgColor)
            context.addPath(path)
            context.strokePath()
        default:
            let color = stroke.color.withAlpha(stroke.color.alpha * brush.opacity)
            context.setStrokeColor(color.cgColor)
            context.addPath(path)
            if let arrow = arrowPath(for: stroke, metrics: metrics) { context.addPath(arrow) }
            context.strokePath()
        }
        context.restoreGState()
    }

    /// Сердцевина неона — почти белая с оттенком цвета.
    static func neonCore(of color: StoryColor) -> StoryColor {
        StoryColor(
            red: 1 - (1 - color.red) * 0.25,
            green: 1 - (1 - color.green) * 0.25,
            blue: 1 - (1 - color.blue) * 0.25,
            alpha: color.alpha
        )
    }
}

/// Объекты холста: размер и отрисовка в собственных координатах (левый верх — 0,0).
enum StoryEntityRenderer {
    /// Размер объекта до масштаба на холсте шириной `canvasWidth`.
    static func baseSize(of entity: StoryEntity, canvasWidth: CGFloat) -> CGSize {
        if case let .text(payload) = entity.kind {
            return StoryTextLayout(payload: payload, canvasWidth: canvasWidth).size
        }
        return CGSize(width: CGFloat(entity.size.width) * canvasWidth, height: CGFloat(entity.size.height) * canvasWidth)
    }

    /// Нарисовать содержимое. Кружок видео рисует сам видеослой — здесь только рамка-заглушка.
    static func draw(
        _ entity: StoryEntity,
        in context: CGContext,
        size: CGSize,
        canvasWidth: CGFloat,
        image: (String) -> UIImage?
    ) {
        switch entity.kind {
        case .text(let payload):
            StoryTextLayout(payload: payload, canvasWidth: canvasWidth).draw(in: context)
        case .image(let payload):
            guard let picture = image(payload.file) else { return }
            UIGraphicsPushContext(context)
            let path = UIBezierPath(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: size.width * 0.06)
            path.addClip()
            picture.draw(in: CGRect(origin: .zero, size: size))
            UIGraphicsPopContext()
        case .roundVideo:
            break
        }
    }

    /// Положить объект на холст: перенос в центр, поворот, масштаб.
    static func place(_ entity: StoryEntity, in context: CGContext, metrics: StoryCanvasMetrics, image: (String) -> UIImage?) {
        let size = baseSize(of: entity, canvasWidth: metrics.width)
        context.saveGState()
        let center = metrics.point(entity.center)
        context.translateBy(x: center.x, y: center.y)
        context.rotate(by: CGFloat(entity.rotation))
        context.scaleBy(x: CGFloat(entity.scale), y: CGFloat(entity.scale))
        context.translateBy(x: -size.width / 2, y: -size.height / 2)
        context.setAlpha(CGFloat(entity.opacity))
        draw(entity, in: context, size: size, canvasWidth: metrics.width, image: image)
        context.restoreGState()
    }
}

/// Сборка кадра истории: фон, медиа, рисунок, объекты. Для экспорта фото и для
/// неподвижных слоёв видео.
enum StoryComposer {
    /// Фон вокруг вписанного медиа или градиент текстовой истории.
    static func drawBackdrop(_ document: StoryDocument, in context: CGContext, size: CGSize) {
        let colors: [CGColor]
        if case let .gradient(key) = document.background {
            colors = StoryBackground.colors(key).map { rgb in
                UIColor(
                    red: CGFloat((rgb >> 16) & 0xFF) / 255,
                    green: CGFloat((rgb >> 8) & 0xFF) / 255,
                    blue: CGFloat(rgb & 0xFF) / 255,
                    alpha: 1
                ).cgColor
            }
        } else {
            colors = document.backdrop.map(\.cgColor)
        }
        guard let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors as CFArray, locations: nil) else { return }
        let diagonal = document.background.isGradient
        context.drawLinearGradient(
            gradient,
            start: .zero,
            end: diagonal ? CGPoint(x: size.width, y: size.height) : CGPoint(x: 0, y: size.height),
            options: [.drawsBeforeStartLocation, .drawsAfterEndLocation]
        )
    }

    /// Медиа на холсте со сдвигом, масштабом и поворотом фона.
    static func drawMedia(_ image: UIImage, document: StoryDocument, in context: CGContext, metrics: StoryCanvasMetrics) {
        let frame = metrics.mediaFrame(for: document.background.pixelSize, transform: document.mediaTransform)
        context.saveGState()
        context.translateBy(x: frame.center.x, y: frame.center.y)
        context.rotate(by: CGFloat(document.mediaTransform.rotation))
        UIGraphicsPushContext(context)
        image.draw(in: CGRect(x: -frame.size.width / 2, y: -frame.size.height / 2, width: frame.size.width, height: frame.size.height))
        UIGraphicsPopContext()
        context.restoreGState()
    }

    /// Рисунок и объекты. `entities` — какие объекты рисовать (для видео — слои между кружками).
    static func drawOverlay(
        _ document: StoryDocument,
        entities: [StoryEntity],
        includeDrawing: Bool,
        in context: CGContext,
        metrics: StoryCanvasMetrics,
        image: (String) -> UIImage?
    ) {
        if includeDrawing {
            StoryStrokeRenderer.draw(document.drawing.strokes, in: context, metrics: metrics)
        }
        for entity in entities.sorted(by: { $0.zIndex < $1.zIndex }) {
            StoryEntityRenderer.place(entity, in: context, metrics: metrics, image: image)
        }
    }
}

extension StoryBackgroundMedia {
    var isGradient: Bool {
        if case .gradient = self { return true }
        return false
    }
}
