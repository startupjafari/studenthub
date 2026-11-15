import UIKit
import AVFoundation

/// Элемент галереи: фото, видео или GIF из переписки.
struct MediaViewerItem: Hashable {
    enum Kind: Hashable { case photo, video, gif }

    let message: Message
    let kind: Kind
    let media: MediaRef

    var id: MessageID { message.id }

    init?(message: Message) {
        switch message.kind {
        case let .photo(media): kind = .photo; self.media = media
        case let .video(media): kind = .video; self.media = media
        case let .gif(media): kind = .gif; self.media = media
        default: return nil
        }
        self.message = message
    }

    /// Пропорции по метаданным — пока картинка не загружена.
    var aspectSize: CGSize {
        CGSize(width: max(1, media.width > 0 ? media.width : 4), height: max(1, media.height > 0 ? media.height : 3))
    }
}

/// Страница галереи. Фото — в `UIScrollView` с масштабом (1…max(fill, 4×), двойное касание),
/// видео — `AVPlayerLayer` поверх постера, GIF — анимированная картинка по кругу.
final class MediaViewerPage: UIView, UIScrollViewDelegate {
    let item: MediaViewerItem
    let scrollView = UIScrollView()
    let imageView = UIImageView()
    let doubleTap = UITapGestureRecognizer()
    private let spinner = UIActivityIndicatorView(style: .large)
    private let playerLayer = AVPlayerLayer()
    private(set) var player: AVPlayer?
    private var endObserver: NSObjectProtocol?
    private var readyObserver: NSObjectProtocol?
    private var lastLayoutSize: CGSize = .zero
    /// Видео играет, когда страница текущая (просмотрщик сам вызывает `play()`).
    var onPlaybackStateChange: (() -> Void)?

    init(item: MediaViewerItem, placeholder: UIImage?) {
        self.item = item
        super.init(frame: .zero)
        accessibilityIdentifier = "mediaViewer.page.\(item.id)"
        scrollView.delegate = self
        scrollView.showsVerticalScrollIndicator = false
        scrollView.showsHorizontalScrollIndicator = false
        scrollView.contentInsetAdjustmentBehavior = .never
        scrollView.decelerationRate = .fast
        scrollView.bouncesZoom = true
        addSubview(scrollView)
        imageView.contentMode = .scaleAspectFill
        imageView.clipsToBounds = true
        imageView.image = placeholder
        imageView.isAccessibilityElement = true
        imageView.accessibilityLabel = item.kind == .video ? "Видео" : (item.kind == .gif ? "GIF" : "Фотография")
        scrollView.addSubview(imageView)
        playerLayer.videoGravity = .resizeAspect
        imageView.layer.addSublayer(playerLayer)
        spinner.color = .white
        spinner.hidesWhenStopped = true
        addSubview(spinner)

        doubleTap.numberOfTapsRequired = 2
        doubleTap.addTarget(self, action: #selector(handleDoubleTap(_:)))
        doubleTap.isEnabled = item.kind == .photo
        addGestureRecognizer(doubleTap)

        readyObserver = NotificationCenter.default.addObserver(forName: .mediaFileReady, object: nil, queue: .main) { [weak self] note in
            MainActor.assumeIsolated {
                guard let self, let file = note.object as? String, file == self.item.media.file else { return }
                self.load()
            }
        }
        load()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    deinit {
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        if let readyObserver { NotificationCenter.default.removeObserver(readyObserver) }
    }

    // MARK: Загрузка

    private var displayScale: CGFloat {
        let scale = traitCollection.displayScale
        return scale > 0 ? scale : 3
    }

    func load() {
        let file = item.media.file
        guard MediaStorage.exists(file) else {
            if imageView.image == nil { spinner.startAnimating() }
            return
        }
        // Полный размер: экран × 2, чтобы при увеличении хватало деталей.
        let screen = window?.bounds.size ?? CGSize(width: 430, height: 932)
        let pointSize = CGSize(width: screen.width * 2, height: screen.height * 2)
        let source: ImagePipeline.Source
        switch item.kind {
        case .photo: source = .photo(file)
        case .video: source = .videoFrame(file)
        case .gif: source = .gifPoster(file)
        }
        if imageView.image == nil { spinner.startAnimating() }
        if let image = ImagePipeline.shared.load(source, pointSize: pointSize, scale: displayScale, completion: { [weak self] image in
            guard let self, let image else { return }
            self.setImage(image)
        }) {
            setImage(image)
        }
        if item.kind == .gif {
            ImagePipeline.shared.loadAnimated(file, maxPointSize: max(screen.width, screen.height)) { [weak self] image in
                guard let self, let image else { return }
                self.setImage(image)
                self.imageView.startAnimating()
            }
        }
        if item.kind == .video, player == nil {
            let player = AVPlayer(url: MediaStorage.url(for: file))
            player.actionAtItemEnd = .pause
            playerLayer.player = player
            self.player = player
            endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: player.currentItem, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated {
                    self?.player?.seek(to: .zero)
                    self?.onPlaybackStateChange?()
                }
            }
        }
    }

    private func setImage(_ image: UIImage) {
        spinner.stopAnimating()
        let sizeChanged = imageView.image?.size != image.size
        imageView.image = image
        if sizeChanged { resetZoomLayout() }
    }

    // MARK: Видео

    var isPlaying: Bool { (player?.rate ?? 0) > 0 }

    func play() {
        guard let player else { return }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        AudioPlayerService.shared.pause()
        player.play()
        onPlaybackStateChange?()
    }

    func pause() {
        player?.pause()
        onPlaybackStateChange?()
    }

    func togglePlayback() {
        if isPlaying { pause() } else { play() }
    }

    // MARK: Раскладка и масштаб

    /// Размер картинки, вписанной в экран.
    func fittedSize(in bounds: CGSize) -> CGSize {
        let source = imageView.image?.size ?? item.aspectSize
        guard source.width > 0, source.height > 0, bounds.width > 0, bounds.height > 0 else { return bounds }
        let scale = min(bounds.width / source.width, bounds.height / source.height)
        return CGSize(width: floor(source.width * scale), height: floor(source.height * scale))
    }

    /// Масштаб «заполнить экран» относительно вписанного.
    private var fillScale: CGFloat {
        let fitted = fittedSize(in: bounds.size)
        guard fitted.width > 0, fitted.height > 0 else { return 1 }
        return max(bounds.width / fitted.width, bounds.height / fitted.height)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        spinner.center = CGPoint(x: bounds.midX, y: bounds.midY)
        guard bounds.size != lastLayoutSize else { return }
        lastLayoutSize = bounds.size
        resetZoomLayout()
    }

    private func resetZoomLayout() {
        guard bounds.width > 0 else { return }
        scrollView.transform = .identity
        scrollView.frame = bounds
        scrollView.zoomScale = 1
        scrollView.minimumZoomScale = 1
        scrollView.maximumZoomScale = item.kind == .photo ? max(fillScale, 4) : 1
        let fitted = fittedSize(in: bounds.size)
        imageView.frame = CGRect(origin: .zero, size: fitted)
        scrollView.contentSize = fitted
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        playerLayer.frame = imageView.bounds
        CATransaction.commit()
        centerContent()
    }

    private func centerContent() {
        let content = imageView.frame.size
        let horizontal = max(0, (scrollView.bounds.width - content.width) / 2)
        let vertical = max(0, (scrollView.bounds.height - content.height) / 2)
        scrollView.contentInset = UIEdgeInsets(top: vertical, left: horizontal, bottom: vertical, right: horizontal)
    }

    var isZoomed: Bool { scrollView.zoomScale > scrollView.minimumZoomScale + 0.01 }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? {
        item.kind == .photo ? imageView : nil
    }

    func scrollViewDidZoom(_ scrollView: UIScrollView) {
        centerContent()
    }

    @objc private func handleDoubleTap(_ gesture: UITapGestureRecognizer) {
        guard item.kind == .photo else { return }
        if isZoomed {
            scrollView.setZoomScale(1, animated: true)
            return
        }
        let target = fillScale > 1.3 ? fillScale : min(2.5, scrollView.maximumZoomScale)
        let point = gesture.location(in: imageView)
        let size = CGSize(width: scrollView.bounds.width / target, height: scrollView.bounds.height / target)
        scrollView.zoom(to: CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width, height: size.height), animated: true)
    }

    /// Рамка показанной картинки в координатах `view` (с учётом сдвига при закрытии жестом).
    func displayedImageFrame(in view: UIView) -> CGRect {
        imageView.convert(imageView.bounds, to: view)
    }
}
