import UIKit

/// Слой рисунка.
///
/// Готовые штрихи лежат одной картинкой (перерисовывается только при новом штрихе,
/// отмене и очистке). Штрих под пальцем — отдельный векторный слой: на каждое
/// движение меняется только его контур, весь холст заново не рисуется. Ластик стирает
/// прямо в картинке готовых штрихов — по отрезку на движение.
final class StoryDrawingView: UIView {
    var tool = StoryDrawingTool()
    var onStrokeFinished: ((StoryStroke) -> Void)?
    /// Палец коснулся / отпустил — панели на время рисования прячутся.
    var onDrawingActive: ((Bool) -> Void)?

    private(set) var strokes: [StoryStroke] = []
    private let committedLayer = CALayer()
    private let liveLayer = CAShapeLayer()
    private let liveCoreLayer = CAShapeLayer()
    private var livePoints: [StoryPoint] = []
    private var activeTouch: UITouch?
    private var eraserContext: CGContext?
    private var renderedSize: CGSize = .zero

    override init(frame: CGRect) {
        super.init(frame: frame)
        isMultipleTouchEnabled = false
        backgroundColor = .clear
        committedLayer.contentsGravity = .resize
        layer.addSublayer(committedLayer)
        for shape in [liveLayer, liveCoreLayer] {
            shape.fillColor = nil
            shape.lineJoin = .round
            layer.addSublayer(shape)
        }
        isAccessibilityElement = true
        accessibilityIdentifier = "story.drawing.canvas"
        accessibilityLabel = String(localized: "stories.editor.drawing.canvas", defaultValue: "Холст рисунка")
        accessibilityTraits = .allowsDirectInteraction
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) не используется") }

    override func layoutSubviews() {
        super.layoutSubviews()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        committedLayer.frame = bounds
        liveLayer.frame = bounds
        liveCoreLayer.frame = bounds
        CATransaction.commit()
        if bounds.size != renderedSize { renderCommitted() }
    }

    /// Штрихи документа. Тот же набор — без перерисовки.
    func setStrokes(_ strokes: [StoryStroke]) {
        guard strokes != self.strokes else { return }
        self.strokes = strokes
        renderCommitted()
    }

    /// Число штрихов на экране — для UI-тестов (`accessibilityValue`).
    private func updateAccessibilityValue() {
        accessibilityValue = "\(strokes.count)"
    }

    // MARK: Касания

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard activeTouch == nil, let touch = touches.first else { return }
        activeTouch = touch
        livePoints = []
        add(touch.location(in: self))
        if tool.brush == .eraser { beginErasing() }
        updateLive(predicted: [])
        onDrawingActive?(true)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = activeTouch, touches.contains(touch) else { return }
        // Склеенные касания: на 120 Гц и с Pencil между кадрами приходят промежуточные
        // точки — без них быстрая линия выходит ломаной.
        let samples = event?.coalescedTouches(for: touch) ?? [touch]
        let before = livePoints.count
        for sample in samples { add(sample.location(in: self)) }
        if tool.brush == .eraser {
            eraseSegment(from: max(before - 1, 0))
        } else {
            let predicted = (event?.predictedTouches(for: touch) ?? []).map { metrics.normalized($0.location(in: self)) }
            updateLive(predicted: predicted)
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = activeTouch, touches.contains(touch) else { return }
        add(touch.location(in: self))
        finish(commit: true)
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = activeTouch, touches.contains(touch) else { return }
        finish(commit: !livePoints.isEmpty)
    }

    private var metrics: StoryCanvasMetrics { StoryCanvasMetrics(size: bounds.size) }

    private func add(_ location: CGPoint) {
        let clamped = CGPoint(x: min(max(location.x, 0), bounds.width), y: min(max(location.y, 0), bounds.height))
        StoryStrokeSmoothing.append(metrics.normalized(clamped), to: &livePoints)
    }

    private func finish(commit: Bool) {
        activeTouch = nil
        let stroke = tool.stroke(points: livePoints)
        livePoints = []
        eraserContext = nil
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        liveLayer.path = nil
        liveCoreLayer.path = nil
        CATransaction.commit()
        onDrawingActive?(false)
        guard commit, !stroke.points.isEmpty else {
            renderCommitted()
            return
        }
        // Штрих сразу в картинке готовых: кадр между отпусканием и ответом модели
        // не мигает пустотой.
        strokes.append(stroke)
        renderCommitted()
        onStrokeFinished?(stroke)
    }

    // MARK: Живой штрих

    private func updateLive(predicted: [StoryPoint]) {
        guard tool.brush != .eraser else { return }
        let stroke = tool.stroke(points: livePoints + predicted)
        let width = metrics.length(stroke.width)
        let brush = stroke.brush
        let path = CGMutablePath()
        path.addPath(StoryStrokeRenderer.path(for: stroke.points, metrics: metrics))
        if let arrow = StoryStrokeRenderer.arrowPath(for: stroke, metrics: metrics) { path.addPath(arrow) }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        liveLayer.path = path
        liveLayer.lineWidth = width
        liveLayer.lineCap = brush.hasSquareCap ? .square : .round
        switch brush {
        case .neon:
            liveLayer.strokeColor = stroke.color.cgColor
            liveLayer.shadowColor = stroke.color.cgColor
            liveLayer.shadowRadius = width * CGFloat(brush.glowFactor) / 2
            liveLayer.shadowOpacity = 1
            liveLayer.shadowOffset = .zero
            liveCoreLayer.path = path
            liveCoreLayer.lineWidth = width * 0.45
            liveCoreLayer.lineCap = .round
            liveCoreLayer.strokeColor = StoryStrokeRenderer.neonCore(of: stroke.color).cgColor
        default:
            liveLayer.shadowOpacity = 0
            liveLayer.strokeColor = stroke.color.withAlpha(stroke.color.alpha * brush.opacity).cgColor
            liveCoreLayer.path = nil
        }
        CATransaction.commit()
    }

    // MARK: Ластик

    private func beginErasing() {
        guard let context = makeContext() else { return }
        context.saveGState()
        context.translateBy(x: 0, y: CGFloat(context.height))
        context.scaleBy(x: CGFloat(context.width) / max(bounds.width, 1), y: -CGFloat(context.height) / max(bounds.height, 1))
        StoryStrokeRenderer.draw(strokes, in: context, metrics: metrics)
        context.restoreGState()
        eraserContext = context
        eraseSegment(from: 0)
    }

    private func eraseSegment(from index: Int) {
        guard let context = eraserContext, !livePoints.isEmpty else { return }
        let segment = Array(livePoints[min(index, livePoints.count - 1)...])
        var stroke = tool.stroke(points: segment)
        stroke.brush = .eraser
        context.saveGState()
        context.translateBy(x: 0, y: CGFloat(context.height))
        context.scaleBy(x: CGFloat(context.width) / max(bounds.width, 1), y: -CGFloat(context.height) / max(bounds.height, 1))
        StoryStrokeRenderer.draw(stroke, in: context, metrics: metrics)
        context.restoreGState()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        committedLayer.contents = context.makeImage()
        CATransaction.commit()
    }

    // MARK: Готовые штрихи

    private func renderCommitted() {
        renderedSize = bounds.size
        updateAccessibilityValue()
        guard !strokes.isEmpty, bounds.width > 0 else {
            committedLayer.contents = nil
            return
        }
        let format = UIGraphicsImageRendererFormat()
        format.scale = window?.screen.scale ?? traitCollection.displayScale
        format.opaque = false
        let image = UIGraphicsImageRenderer(size: bounds.size, format: format).image { context in
            StoryStrokeRenderer.draw(strokes, in: context.cgContext, metrics: metrics)
        }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        committedLayer.contents = image.cgImage
        CATransaction.commit()
    }

    private func makeContext() -> CGContext? {
        let scale = window?.screen.scale ?? traitCollection.displayScale
        let width = Int(bounds.width * scale)
        let height = Int(bounds.height * scale)
        guard width > 0, height > 0 else { return nil }
        return CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )
    }
}
