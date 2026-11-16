@preconcurrency import AVFoundation
import UIKit

/// Объект на холсте. Рисует себя тем же кодом, что экспорт (`StoryEntityRenderer`);
/// положение, масштаб и поворот — через `center` и `transform`, чтобы жест двигал
/// готовую картинку, а не перерисовывал её.
class StoryEntityView: UIView {
    private(set) var entity: StoryEntity
    var canvasWidth: CGFloat = 1 {
        didSet { if canvasWidth != oldValue { relayout() } }
    }
    var imageProvider: (String) -> UIImage? = { _ in nil }

    /// Во время жеста положение задаёт жест, а не модель.
    var isGestureActive = false

    init(entity: StoryEntity) {
        self.entity = entity
        super.init(frame: .zero)
        backgroundColor = .clear
        isOpaque = false
        contentMode = .redraw
        isAccessibilityElement = true
        accessibilityIdentifier = "story.entity.\(entity.accessibilityKind)"
        updateAccessibility()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) не используется") }

    func update(_ entity: StoryEntity) {
        let contentChanged = entity.kind != self.entity.kind || entity.size != self.entity.size
        self.entity = entity
        if contentChanged {
            relayout()
            setNeedsDisplay()
        } else if !isGestureActive {
            applyPlacement()
        }
        updateAccessibility()
    }

    /// Положение из модели (доли холста) → центр и трансформ.
    func applyPlacement(in canvasSize: CGSize? = nil) {
        guard let size = canvasSize ?? superview?.bounds.size, size.width > 0 else { return }
        let metrics = StoryCanvasMetrics(size: size)
        center = metrics.point(entity.center)
        transform = CGAffineTransform(rotationAngle: CGFloat(entity.rotation)).scaledBy(x: CGFloat(entity.scale), y: CGFloat(entity.scale))
        alpha = CGFloat(entity.opacity)
        // Увеличенная надпись не мылится: растр — под итоговый масштаб.
        let screen = window?.screen.scale ?? traitCollection.displayScale
        let wanted = min(screen * max(CGFloat(entity.scale), 1), 8)
        if abs(layer.contentsScale - wanted) > 0.25 {
            contentScaleFactor = wanted
            setNeedsDisplay()
        }
    }

    func relayout() {
        let size = StoryEntityRenderer.baseSize(of: entity, canvasWidth: canvasWidth)
        let savedTransform = transform
        transform = .identity
        bounds = CGRect(origin: .zero, size: size)
        transform = savedTransform
        applyPlacement()
    }

    override func draw(_ rect: CGRect) {
        guard let context = UIGraphicsGetCurrentContext() else { return }
        StoryEntityRenderer.draw(entity, in: context, size: bounds.size, canvasWidth: canvasWidth, image: imageProvider)
    }

    /// Мелкий объект ловится и пальцем рядом: зона касания не меньше 44 pt на экране.
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        let scale = max(CGFloat(entity.scale), 0.01)
        let minimum = 44 / scale
        let dx = max(0, (minimum - bounds.width) / 2)
        let dy = max(0, (minimum - bounds.height) / 2)
        return bounds.insetBy(dx: -dx, dy: -dy).contains(point)
    }

    private func updateAccessibility() {
        switch entity.kind {
        case .text(let payload):
            accessibilityLabel = payload.text
            accessibilityValue = "\(payload.font.rawValue),\(payload.style.rawValue),\(payload.color.hex)"
        case .emoji(let emoji):
            accessibilityLabel = emoji
        case .shape(let shape):
            accessibilityLabel = String(localized: "stories.editor.shape", defaultValue: "Фигура")
            accessibilityValue = shape.shape.rawValue
        case .image:
            accessibilityLabel = String(localized: "stories.editor.image", defaultValue: "Картинка")
        case .roundVideo:
            accessibilityLabel = String(localized: "stories.editor.roundVideo", defaultValue: "Круглое видео")
        }
        accessibilityHint = String(
            localized: "stories.editor.entity.hint",
            defaultValue: "Перетащите одним пальцем, двумя — масштаб и поворот"
        )
    }
}

/// Круглое видео: зацикленный ролик в круге, без рамки и фона вокруг.
final class StoryRoundVideoEntityView: StoryEntityView {
    private let playerLayer = AVPlayerLayer()
    private var player: AVQueuePlayer?
    private var looper: AVPlayerLooper?
    private var loadedFile: String?
    var urlProvider: (String) -> URL? = { _ in nil }

    override init(entity: StoryEntity) {
        super.init(entity: entity)
        playerLayer.videoGravity = .resizeAspectFill
        layer.addSublayer(playerLayer)
        layer.masksToBounds = true
        loadIfNeeded()
    }

    override func update(_ entity: StoryEntity) {
        super.update(entity)
        loadIfNeeded()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        layer.cornerRadius = bounds.width / 2
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        playerLayer.frame = bounds
        CATransaction.commit()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        loadIfNeeded()
        window == nil ? player?.pause() : player?.play()
    }

    /// Круг — зона касания по окружности, а не по квадрату.
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        let radius = max(bounds.width / 2, 22 / max(CGFloat(entity.scale), 0.01))
        return hypot(point.x - bounds.midX, point.y - bounds.midY) <= radius
    }

    private func loadIfNeeded() {
        guard case let .roundVideo(video) = entity.kind, video.file != loadedFile, let url = urlProvider(video.file) else {
            if case let .roundVideo(video) = entity.kind {
                playerLayer.setAffineTransform(video.mirrored ? CGAffineTransform(scaleX: -1, y: 1) : .identity)
            }
            return
        }
        loadedFile = video.file
        let item = AVPlayerItem(url: url)
        let queue = AVQueuePlayer()
        queue.isMuted = true
        looper = AVPlayerLooper(player: queue, templateItem: item)
        player = queue
        playerLayer.player = queue
        playerLayer.setAffineTransform(video.mirrored ? CGAffineTransform(scaleX: -1, y: 1) : .identity)
        if window != nil { queue.play() }
    }

    func stop() {
        player?.pause()
        looper = nil
        player = nil
        playerLayer.player = nil
        loadedFile = nil
    }
}

extension StoryEntity {
    /// Тип объекта в идентификаторе доступности — по нему UI-тесты считают надписи.
    var accessibilityKind: String {
        switch kind {
        case .text: return "text"
        case .emoji: return "emoji"
        case .shape: return "shape"
        case .image: return "image"
        case .roundVideo: return "roundVideo"
        }
    }
}
