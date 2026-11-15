@preconcurrency import AVFoundation
import CoreImage
import MetalKit
import UIKit

/// Где на экране лежит холст 9:16 — общий расчёт для камеры, редактора и панелей:
/// при переходе камера → редактор кадр не сдвигается ни на точку.
enum StoryStageLayout {
    /// Высота нижней полосы управления под холстом (без безопасной зоны).
    static let bottomBar: CGFloat = 64

    static func canvasFrame(in bounds: CGSize, safeArea: UIEdgeInsets) -> CGRect {
        let available = bounds.height - safeArea.top - safeArea.bottom - bottomBar
        var width = bounds.width
        var height = width * 16 / 9
        if height > available {
            // Короткий экран (SE): холст по высоте, по центру.
            height = max(available, 0)
            width = height * 9 / 16
        }
        return CGRect(x: (bounds.width - width) / 2, y: safeArea.top, width: width, height: height)
    }

    /// Радиус скругления холста — как у углов экрана iPhone, только меньше.
    static let cornerRadius: CGFloat = 22
}

/// Обработанное фото на Metal: цепочка Core Image считается на GPU прямо в текстуру
/// экрана при каждом изменении ползунка — без промежуточного CGImage на CPU.
final class StoryPhotoView: MTKView {
    private let processor = StoryImageProcessor.shared
    private var source: CIImage?
    private(set) var processing = StoryProcessing()
    private lazy var commandQueue = device?.makeCommandQueue()

    init() {
        super.init(frame: .zero, device: StoryImageProcessor.shared.device)
        framebufferOnly = false
        enableSetNeedsDisplay = true
        isPaused = true
        autoResizeDrawable = true
        colorPixelFormat = .bgra8Unorm
        isOpaque = false
        backgroundColor = .clear
        layer.isOpaque = false
        contentMode = .redraw
        accessibilityIgnoresInvertColors = true
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError("init(coder:) не используется") }

    /// Уменьшенная копия исходника — ставится один раз при открытии медиа.
    /// Переворот при рендере в текстуру экрана. Закреплён тестом
    /// `StoryEditorRenderTests.testPhotoViewRenderIsUpright`: верх снимка — вверху.
    static let flipsDestination = false

    /// Отрисовать снимок в текстуру тем же путём, что и экран (для теста ориентации).
    static func render(_ image: CIImage, to texture: MTLTexture, commandBuffer: MTLCommandBuffer, context: CIContext) {
        let destination = CIRenderDestination(
            width: texture.width,
            height: texture.height,
            pixelFormat: texture.pixelFormat,
            commandBuffer: commandBuffer,
            mtlTextureProvider: { texture }
        )
        destination.isFlipped = flipsDestination
        _ = try? context.startTask(toRender: image, to: destination)
    }

    func setSource(_ image: CIImage?) {
        source = image
        setNeedsDisplay()
    }

    func setProcessing(_ processing: StoryProcessing) {
        guard processing != self.processing else { return }
        self.processing = processing
        setNeedsDisplay()
    }

    override func draw(_ rect: CGRect) {
        guard let source, let drawable = currentDrawable, let commandQueue,
              let buffer = commandQueue.makeCommandBuffer()
        else { return }
        let target = drawableSize
        guard target.width > 0, target.height > 0 else { return }
        var image = processor.process(source, processing)
        let extent = source.extent
        image = image.transformed(by: CGAffineTransform(
            scaleX: target.width / extent.width,
            y: target.height / extent.height
        ))
        let destination = CIRenderDestination(
            width: Int(target.width),
            height: Int(target.height),
            pixelFormat: colorPixelFormat,
            commandBuffer: buffer,
            mtlTextureProvider: { drawable.texture }
        )
        destination.isFlipped = Self.flipsDestination
        _ = try? processor.context.startTask(toClear: destination)
        _ = try? processor.context.startTask(toRender: image, to: destination)
        buffer.present(drawable)
        buffer.commit()
    }
}

/// Видео-фон: зацикленный проигрыватель, обработка — на кадрах через Core Image.
final class StoryBackgroundVideoView: UIView {
    override static var layerClass: AnyClass { AVPlayerLayer.self }
    private var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }

    private var player: AVQueuePlayer?
    private var looper: AVPlayerLooper?
    private var url: URL?
    private var trim: StoryTimeRange?
    /// Параметры обработки читает поток видео-композиции.
    private let processingBox = StoryLockedBox(StoryProcessing())
    private var observers: [NSObjectProtocol] = []

    override init(frame: CGRect) {
        super.init(frame: frame)
        playerLayer.videoGravity = .resizeAspectFill
        isUserInteractionEnabled = false
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.player?.pause()
        })
        observers.append(center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.player?.play()
        })
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) не используется") }

    deinit {
        observers.forEach(NotificationCenter.default.removeObserver)
    }

    func load(url: URL, trim: StoryTimeRange?, muted: Bool = false) {
        guard url != self.url || trim != self.trim else { return }
        self.url = url
        self.trim = trim
        let asset = AVURLAsset(url: url)
        let item = AVPlayerItem(asset: asset)
        let box = processingBox
        let processor = StoryImageProcessor.shared
        item.videoComposition = AVVideoComposition(asset: asset) { request in
            let processed = processor.process(request.sourceImage, box.value)
            request.finish(with: processed, context: processor.context)
        }
        let queue = AVQueuePlayer()
        queue.isMuted = muted
        let range = trim.map {
            CMTimeRange(start: CMTime(seconds: $0.start, preferredTimescale: 600), end: CMTime(seconds: $0.end, preferredTimescale: 600))
        }
        looper = range.map { AVPlayerLooper(player: queue, templateItem: item, timeRange: $0) }
            ?? AVPlayerLooper(player: queue, templateItem: item)
        player = queue
        playerLayer.player = queue
        queue.play()
    }

    func setProcessing(_ processing: StoryProcessing) {
        guard processingBox.value != processing else { return }
        processingBox.value = processing
        // На паузе кадр не перерисуется сам — просим текущий заново.
        if player?.rate == 0, let item = player?.currentItem {
            item.seek(to: item.currentTime(), completionHandler: nil)
        }
    }

    func setPlaying(_ playing: Bool) {
        playing ? player?.play() : player?.pause()
    }

    func stop() {
        player?.pause()
        looper = nil
        player = nil
        playerLayer.player = nil
        url = nil
    }
}

/// Значение под замком — для параметров, которые читает чужой поток (видео-композиция).
final class StoryLockedBox<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: Value

    init(_ value: Value) {
        stored = value
    }

    var value: Value {
        get {
            lock.lock()
            defer { lock.unlock() }
            return stored
        }
        set {
            lock.lock()
            stored = newValue
            lock.unlock()
        }
    }
}

/// Медиа на холсте: фото (Metal) или видео, со сдвигом, масштабом и поворотом фона.
final class StoryMediaView: UIView {
    let photoView = StoryPhotoView()
    let videoView = StoryBackgroundVideoView()
    private var loadedKey: String?
    private var loadTask: Task<Void, Never>?

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        addSubview(photoView)
        addSubview(videoView)
        photoView.isHidden = true
        videoView.isHidden = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) не используется") }

    override func layoutSubviews() {
        super.layoutSubviews()
        photoView.frame = bounds
        videoView.frame = bounds
    }

    /// Показать фон документа. Повторный вызов с тем же файлом ничего не делает.
    func show(_ background: StoryBackgroundMedia, trim: StoryTimeRange?, workspace: StoryWorkspace, processing: StoryProcessing) {
        switch background {
        case let .photo(file, _):
            videoView.stop()
            videoView.isHidden = true
            photoView.isHidden = false
            photoView.setProcessing(processing)
            let key = "photo:\(file)"
            guard key != loadedKey else { return }
            loadedKey = key
            let url = workspace.url(for: file)
            loadTask?.cancel()
            loadTask = Task { [weak self] in
                let image = await Task.detached(priority: .userInitiated) { () -> CIImage? in
                    guard let image = CIImage(contentsOf: url, options: [.applyOrientationProperty: true]) else { return nil }
                    // Копия раскодируется и ужимается один раз: ленивый CIImage из файла
                    // заново читал бы JPEG на каждом сдвиге ползунка.
                    let proxy = StoryImageProcessor.proxy(of: image, maxSide: 2048)
                    guard let decoded = StoryImageProcessor.shared.render(proxy) else { return proxy }
                    return CIImage(cgImage: decoded)
                }.value
                guard !Task.isCancelled else { return }
                self?.photoView.setSource(image)
            }
        case let .video(file, _, _):
            photoView.isHidden = true
            photoView.setSource(nil)
            videoView.isHidden = false
            loadedKey = "video:\(file)"
            videoView.load(url: workspace.url(for: file), trim: trim)
            videoView.setProcessing(processing)
        case .gradient:
            loadedKey = nil
            photoView.isHidden = true
            videoView.stop()
            videoView.isHidden = true
        }
    }

    func setProcessing(_ processing: StoryProcessing) {
        photoView.setProcessing(processing)
        videoView.setProcessing(processing)
    }

    func stop() {
        loadTask?.cancel()
        videoView.stop()
    }
}
