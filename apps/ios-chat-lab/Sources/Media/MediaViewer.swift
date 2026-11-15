import UIKit
import AVFoundation
import Photos

extension ChatViewController {
    /// Открыть галерею всех фото/видео/GIF переписки на сообщении `id` — с полётом из плитки.
    func openMedia(_ id: MessageID) {
        let items = store.messages.compactMap(MediaViewerItem.init(message:))
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        view.endEditing(true)
        AudioPlayerService.shared.pause()
        let viewer = MediaViewerController(items: items, startIndex: index, chat: self)
        present(viewer, animated: false)
    }

    /// Плитка сообщения в ленте, если она сейчас на экране.
    func visibleMediaTile(for id: MessageID) -> MediaTileView? {
        guard let tile = cell(for: id)?.mediaTile(for: id), tile.window != nil else { return nil }
        let frame = tile.convert(tile.bounds, to: nil)
        guard let windowBounds = tile.window?.bounds, frame.intersects(windowBounds.insetBy(dx: 0, dy: 40)) else { return nil }
        return tile
    }
}

/// Просмотрщик медиа по образцу `GalleryController` Telegram.
///
/// - Открытие: картинка летит из плитки пузыря — положение 0,21 с, размер 0,25 с по кривой
///   Telegram `.spring` (Безье 0.38, 0.70, 0.125, 1.0); фон проявляется линейно за 0,15 с.
/// - Закрытие жестом вниз/вверх: при |v| > 1000 pt/с или смещении > h/4 картинка улетает
///   обратно в плитку (0,25 с), иначе возвращается пружиной.
/// - Листание — страницы с зазором 20 pt; при смене страницы лента за просмотрщиком
///   подкручивается так, чтобы плитка текущего элемента была на экране (как у Telegram).
final class MediaViewerController: UIViewController, UIScrollViewDelegate, UIGestureRecognizerDelegate {
    private(set) var items: [MediaViewerItem]
    private(set) var currentIndex: Int
    private weak var chat: ChatViewController?

    private let backgroundView = UIView()
    private let pagingView = UIScrollView()
    private var pages: [Int: MediaViewerPage] = [:]
    private let pageGap: CGFloat = 20

    private let topBar = UIView()
    private let topGradient = CAGradientLayer()
    private let closeButton = UIButton(type: .system)
    private let authorLabel = UILabel()
    private let dateLabel = UILabel()
    private let counterLabel = UILabel()

    private let bottomBar = UIView()
    private let bottomGradient = CAGradientLayer()
    private let captionLabel = UILabel()
    private let shareButton = UIButton(type: .system)
    private let moreButton = UIButton(type: .system)
    private let videoControls = UIView()
    private let playButton = UIButton(type: .system)
    private let muteButton = UIButton(type: .system)
    private let scrubber = UISlider()
    private let currentTimeLabel = UILabel()
    private let totalTimeLabel = UILabel()

    private let singleTap = UITapGestureRecognizer()
    private let dismissPan = UIPanGestureRecognizer()
    private var chromeHidden = false
    private var isTransitioning = false
    private var isScrubbing = false
    private var timeObserver: (player: AVPlayer, token: Any)?
    private var startPlaceholder: UIImage?
    private var didAppearOnce = false
    /// Плитка, спрятанная на время перелёта.
    private weak var hiddenTile: MediaTileView?

    init(items: [MediaViewerItem], startIndex: Int, chat: ChatViewController) {
        self.items = items
        self.currentIndex = startIndex
        self.chat = chat
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .overFullScreen
        modalPresentationCapturesStatusBarAppearance = true
        startPlaceholder = chat.visibleMediaTile(for: items[startIndex].id)?.imageView.image
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    deinit {
        if let timeObserver { timeObserver.player.removeTimeObserver(timeObserver.token) }
    }

    override var prefersStatusBarHidden: Bool { chromeHidden || isTransitioning }
    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
    override var preferredStatusBarUpdateAnimation: UIStatusBarAnimation { .fade }
    override var prefersHomeIndicatorAutoHidden: Bool { chromeHidden }

    // MARK: Жизненный цикл

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        view.accessibilityIdentifier = "mediaViewer"
        view.accessibilityViewIsModal = true

        backgroundView.backgroundColor = .black
        backgroundView.frame = view.bounds
        backgroundView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(backgroundView)

        pagingView.isPagingEnabled = true
        pagingView.showsHorizontalScrollIndicator = false
        pagingView.showsVerticalScrollIndicator = false
        pagingView.contentInsetAdjustmentBehavior = .never
        pagingView.isDirectionalLockEnabled = true
        pagingView.alwaysBounceVertical = false
        pagingView.delegate = self
        pagingView.scrollsToTop = false
        view.addSubview(pagingView)

        setupChrome()

        singleTap.addTarget(self, action: #selector(handleSingleTap))
        view.addGestureRecognizer(singleTap)
        dismissPan.addTarget(self, action: #selector(handleDismissPan(_:)))
        dismissPan.delegate = self
        dismissPan.maximumNumberOfTouches = 1
        view.addGestureRecognizer(dismissPan)
        pagingView.panGestureRecognizer.require(toFail: dismissPan)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        layoutPaging()
        layoutChrome()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !didAppearOnce else { return }
        didAppearOnce = true
        animateIn()
    }

    // MARK: Страницы

    private var pageWidth: CGFloat { view.bounds.width + pageGap }

    private func layoutPaging() {
        let frame = CGRect(x: -pageGap / 2, y: 0, width: pageWidth, height: view.bounds.height)
        guard pagingView.frame != frame || pagingView.contentSize.width != pageWidth * CGFloat(items.count) else { return }
        pagingView.frame = frame
        pagingView.contentSize = CGSize(width: pageWidth * CGFloat(items.count), height: view.bounds.height)
        pagingView.contentOffset = CGPoint(x: pageWidth * CGFloat(currentIndex), y: 0)
        for (index, page) in pages {
            page.frame = pageFrame(index)
        }
        loadPagesAround(currentIndex)
    }

    private func pageFrame(_ index: Int) -> CGRect {
        CGRect(x: pageWidth * CGFloat(index) + pageGap / 2, y: 0, width: view.bounds.width, height: view.bounds.height)
    }

    private func loadPagesAround(_ index: Int) {
        let wanted = Set((index - 1)...(index + 1)).filter { $0 >= 0 && $0 < items.count }
        for (key, page) in pages where !wanted.contains(key) {
            page.pause()
            page.removeFromSuperview()
            pages.removeValue(forKey: key)
        }
        for key in wanted where pages[key] == nil {
            let placeholder = key == currentIndex && key == indexOfStart ? startPlaceholder : nil
            let page = MediaViewerPage(item: items[key], placeholder: placeholder)
            page.frame = pageFrame(key)
            page.onPlaybackStateChange = { [weak self, weak page] in
                guard let self, let page, self.pages[self.currentIndex] === page else { return }
                self.updateVideoControls()
            }
            singleTap.require(toFail: page.doubleTap)
            pagingView.addSubview(page)
            pages[key] = page
        }
    }

    private lazy var indexOfStart = currentIndex

    var currentPage: MediaViewerPage? { pages[currentIndex] }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        guard scrollView === pagingView, !isTransitioning, pageWidth > 0 else { return }
        let index = Int((scrollView.contentOffset.x / pageWidth).rounded())
        let clamped = max(0, min(items.count - 1, index))
        guard clamped != currentIndex else { return }
        currentPage?.pause()
        currentIndex = clamped
        loadPagesAround(clamped)
        updateChrome()
    }

    func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
        guard scrollView === pagingView else { return }
        pageDidSettle()
    }

    /// Страница остановилась: видео — играть, лента за просмотрщиком — к текущему элементу.
    private func pageDidSettle() {
        for (index, page) in pages where index != currentIndex { page.pause() }
        if let page = currentPage, page.item.kind == .video { page.play() }
        attachTimeObserver()
        let id = items[currentIndex].id
        if let chat, chat.visibleMediaTile(for: id) == nil {
            chat.scrollToMessage(id, highlight: false, animated: false)
        }
        UIAccessibility.post(notification: .pageScrolled, argument: counterLabel.text)
    }

    // MARK: Оформление

    private func setupChrome() {
        topGradient.colors = [UIColor.black.withAlphaComponent(0.55).cgColor, UIColor.clear.cgColor]
        topBar.layer.addSublayer(topGradient)
        view.addSubview(topBar)

        closeButton.setImage(UIImage(systemName: "xmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .semibold)), for: .normal)
        closeButton.tintColor = .white
        closeButton.accessibilityLabel = "Закрыть"
        closeButton.accessibilityIdentifier = "mediaViewer.close"
        closeButton.addAction(UIAction { [weak self] _ in self?.close(velocity: 0) }, for: .touchUpInside)
        topBar.addSubview(closeButton)

        authorLabel.font = .systemFont(ofSize: 16, weight: .semibold)
        authorLabel.textColor = .white
        authorLabel.textAlignment = .center
        dateLabel.font = .systemFont(ofSize: 13)
        dateLabel.textColor = UIColor.white.withAlphaComponent(0.7)
        dateLabel.textAlignment = .center
        counterLabel.font = .monospacedDigitSystemFont(ofSize: 15, weight: .medium)
        counterLabel.textColor = .white
        counterLabel.textAlignment = .right
        counterLabel.accessibilityIdentifier = "mediaViewer.counter"
        [authorLabel, dateLabel, counterLabel].forEach(topBar.addSubview)

        bottomGradient.colors = [UIColor.clear.cgColor, UIColor.black.withAlphaComponent(0.6).cgColor]
        bottomBar.layer.addSublayer(bottomGradient)
        view.addSubview(bottomBar)

        captionLabel.font = .systemFont(ofSize: 16)
        captionLabel.textColor = .white
        captionLabel.numberOfLines = 4
        captionLabel.accessibilityIdentifier = "mediaViewer.caption"
        bottomBar.addSubview(captionLabel)

        shareButton.setImage(UIImage(systemName: "square.and.arrow.up", withConfiguration: UIImage.SymbolConfiguration(pointSize: 20)), for: .normal)
        shareButton.tintColor = .white
        shareButton.accessibilityLabel = "Поделиться"
        shareButton.accessibilityIdentifier = "mediaViewer.share"
        shareButton.addAction(UIAction { [weak self] _ in self?.share() }, for: .touchUpInside)
        bottomBar.addSubview(shareButton)

        moreButton.setImage(UIImage(systemName: "ellipsis.circle", withConfiguration: UIImage.SymbolConfiguration(pointSize: 20)), for: .normal)
        moreButton.tintColor = .white
        moreButton.accessibilityLabel = "Ещё"
        moreButton.accessibilityIdentifier = "mediaViewer.more"
        moreButton.showsMenuAsPrimaryAction = true
        moreButton.menu = makeMoreMenu()
        bottomBar.addSubview(moreButton)

        playButton.tintColor = .white
        playButton.accessibilityIdentifier = "mediaViewer.video.play"
        playButton.addAction(UIAction { [weak self] _ in self?.currentPage?.togglePlayback() }, for: .touchUpInside)
        muteButton.tintColor = .white
        muteButton.accessibilityIdentifier = "mediaViewer.video.mute"
        muteButton.addAction(UIAction { [weak self] _ in
            guard let player = self?.currentPage?.player else { return }
            player.isMuted.toggle()
            self?.updateVideoControls()
        }, for: .touchUpInside)
        scrubber.minimumTrackTintColor = .white
        scrubber.maximumTrackTintColor = UIColor.white.withAlphaComponent(0.3)
        scrubber.setThumbImage(Self.thumbImage(), for: .normal)
        scrubber.accessibilityIdentifier = "mediaViewer.video.scrubber"
        scrubber.accessibilityLabel = "Позиция видео"
        scrubber.addTarget(self, action: #selector(scrubBegan), for: .touchDown)
        scrubber.addTarget(self, action: #selector(scrubChanged), for: .valueChanged)
        scrubber.addTarget(self, action: #selector(scrubEnded), for: [.touchUpInside, .touchUpOutside, .touchCancel])
        for label in [currentTimeLabel, totalTimeLabel] {
            label.font = .monospacedDigitSystemFont(ofSize: 12, weight: .medium)
            label.textColor = .white
        }
        totalTimeLabel.textAlignment = .right
        [playButton, scrubber, currentTimeLabel, totalTimeLabel, muteButton].forEach(videoControls.addSubview)
        bottomBar.addSubview(videoControls)
        updateChrome()
    }

    private static func thumbImage() -> UIImage {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 14, height: 14))
        return renderer.image { _ in
            UIColor.white.setFill()
            UIBezierPath(ovalIn: CGRect(x: 0, y: 0, width: 14, height: 14)).fill()
        }
    }

    private func layoutChrome() {
        let safe = view.safeAreaInsets
        let topHeight = safe.top + 52
        topBar.frame = CGRect(x: 0, y: 0, width: view.bounds.width, height: topHeight + 24)
        topGradient.frame = topBar.bounds
        closeButton.frame = CGRect(x: 6, y: safe.top + 4, width: 44, height: 44)
        counterLabel.frame = CGRect(x: view.bounds.width - 96, y: safe.top + 4, width: 84, height: 44)
        authorLabel.frame = CGRect(x: 60, y: safe.top + 6, width: view.bounds.width - 120, height: 20)
        dateLabel.frame = CGRect(x: 60, y: safe.top + 27, width: view.bounds.width - 120, height: 17)

        let width = view.bounds.width
        let captionHeight = captionLabel.text?.isEmpty == false
            ? ceil(captionLabel.sizeThatFits(CGSize(width: width - 32, height: 120)).height) + 10 : 0
        let isVideo = items.indices.contains(currentIndex) && items[currentIndex].kind == .video
        let controlsHeight: CGFloat = isVideo ? 44 : 0
        let barHeight = captionHeight + controlsHeight + 50 + safe.bottom
        bottomBar.frame = CGRect(x: 0, y: view.bounds.height - barHeight, width: width, height: barHeight)
        bottomGradient.frame = CGRect(x: 0, y: -30, width: width, height: barHeight + 30)
        captionLabel.frame = CGRect(x: 16, y: 0, width: width - 32, height: captionHeight)
        videoControls.isHidden = !isVideo
        videoControls.frame = CGRect(x: 0, y: captionHeight, width: width, height: controlsHeight)
        playButton.frame = CGRect(x: 6, y: 0, width: 44, height: 44)
        muteButton.frame = CGRect(x: width - 50, y: 0, width: 44, height: 44)
        currentTimeLabel.frame = CGRect(x: 52, y: 0, width: 44, height: 44)
        totalTimeLabel.frame = CGRect(x: width - 100, y: 0, width: 46, height: 44)
        scrubber.frame = CGRect(x: 98, y: 0, width: width - 200, height: 44)
        let rowY = captionHeight + controlsHeight + 3
        shareButton.frame = CGRect(x: 6, y: rowY, width: 44, height: 44)
        moreButton.frame = CGRect(x: width - 50, y: rowY, width: 44, height: 44)
    }

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.setLocalizedDateFormatFromTemplate("d MMMM yyyy, HH:mm")
        return formatter
    }()

    private func updateChrome() {
        guard items.indices.contains(currentIndex) else { return }
        let item = items[currentIndex]
        authorLabel.text = item.message.isOutgoing ? "Вы" : (chat?.store.peer.displayName ?? "")
        dateLabel.text = Self.dateFormatter.string(from: item.message.date)
        counterLabel.text = "\(currentIndex + 1) из \(items.count)"
        counterLabel.accessibilityLabel = "\(currentIndex + 1) из \(items.count)"
        captionLabel.text = item.message.text.isEmpty ? nil : item.message.text
        updateVideoControls()
        view.setNeedsLayout()
    }

    private func updateVideoControls() {
        guard let page = currentPage, page.item.kind == .video else { return }
        let playing = page.isPlaying
        playButton.setImage(UIImage(systemName: playing ? "pause.fill" : "play.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 20)), for: .normal)
        playButton.accessibilityLabel = playing ? "Пауза" : "Воспроизвести"
        let muted = page.player?.isMuted ?? false
        muteButton.setImage(UIImage(systemName: muted ? "speaker.slash.fill" : "speaker.wave.2.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 17)), for: .normal)
        muteButton.accessibilityLabel = muted ? "Включить звук" : "Выключить звук"
        updateTimeLabels()
    }

    private func updateTimeLabels() {
        guard let player = currentPage?.player, let item = player.currentItem else { return }
        let duration = item.duration.seconds.isFinite ? item.duration.seconds : items[currentIndex].media.duration
        let current = player.currentTime().seconds.isFinite ? player.currentTime().seconds : 0
        currentTimeLabel.text = MessageLayoutEngine.formatDuration(current)
        totalTimeLabel.text = MessageLayoutEngine.formatDuration(duration)
        if !isScrubbing, duration > 0 {
            scrubber.value = Float(current / duration)
        }
    }

    private func attachTimeObserver() {
        if let timeObserver { timeObserver.player.removeTimeObserver(timeObserver.token) }
        timeObserver = nil
        guard let player = currentPage?.player else { return }
        let token = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 30), queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.updateTimeLabels() }
        }
        timeObserver = (player, token)
        updateVideoControls()
    }

    @objc private func scrubBegan() {
        isScrubbing = true
        currentPage?.player?.pause()
    }

    @objc private func scrubChanged() {
        guard let player = currentPage?.player, let item = player.currentItem, item.duration.seconds.isFinite else { return }
        let time = CMTime(seconds: Double(scrubber.value) * item.duration.seconds, preferredTimescale: 600)
        player.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero)
        currentTimeLabel.text = MessageLayoutEngine.formatDuration(time.seconds)
    }

    @objc private func scrubEnded() {
        isScrubbing = false
        currentPage?.play()
    }

    private func setChromeHidden(_ hidden: Bool, animated: Bool) {
        chromeHidden = hidden
        let apply = {
            self.topBar.alpha = hidden ? 0 : 1
            self.bottomBar.alpha = hidden ? 0 : 1
            self.setNeedsStatusBarAppearanceUpdate()
        }
        if animated { Motion.fade(duration: 0.2, apply) } else { apply() }
        topBar.isUserInteractionEnabled = !hidden
        bottomBar.isUserInteractionEnabled = !hidden
        setNeedsUpdateOfHomeIndicatorAutoHidden()
    }

    @objc private func handleSingleTap() {
        guard !isTransitioning else { return }
        setChromeHidden(!chromeHidden, animated: true)
    }

    // MARK: Действия

    private func makeMoreMenu() -> UIMenu {
        UIMenu(children: [
            UIDeferredMenuElement.uncached { [weak self] completion in
                MainActor.assumeIsolated {
                    guard let self else { return completion([]) }
                    completion([
                        UIAction(title: "Сохранить в Фото", image: UIImage(systemName: "square.and.arrow.down")) { [weak self] _ in self?.saveToPhotos() },
                        UIAction(title: "Перейти к сообщению", image: UIImage(systemName: "arrow.right.circle")) { [weak self] _ in self?.goToMessage() },
                        UIAction(title: "Удалить", image: UIImage(systemName: "trash"), attributes: .destructive) { [weak self] _ in self?.confirmDelete() },
                    ])
                }
            },
        ])
    }

    private var currentFileURL: URL? {
        guard items.indices.contains(currentIndex) else { return nil }
        let file = items[currentIndex].media.file
        return MediaStorage.exists(file) ? MediaStorage.url(for: file) : nil
    }

    private func share() {
        guard let url = currentFileURL else {
            Toast.show("Файл ещё готовится", icon: "hourglass", in: view, bottomInset: bottomBar.bounds.height)
            return
        }
        let activity = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        activity.popoverPresentationController?.sourceView = shareButton
        present(activity, animated: true)
    }

    private func saveToPhotos() {
        guard let url = currentFileURL else { return }
        let isVideo = items[currentIndex].kind == .video
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            DispatchQueue.main.async {
                MainActor.assumeIsolated { [weak self] in
                    guard let self else { return }
                    guard status == .authorized || status == .limited else {
                        Toast.show("Нет доступа к «Фото» — разрешите в Настройках", icon: "exclamationmark.triangle", in: self.view, bottomInset: self.bottomBar.bounds.height)
                        return
                    }
                    PHPhotoLibrary.shared().performChanges({
                        if isVideo {
                            PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: url)
                        } else {
                            PHAssetChangeRequest.creationRequestForAssetFromImage(atFileURL: url)
                        }
                    }, completionHandler: { success, _ in
                        DispatchQueue.main.async {
                            MainActor.assumeIsolated { [weak self] in
                                guard let self else { return }
                                Toast.show(success ? "Сохранено в «Фото»" : "Не удалось сохранить", icon: success ? "checkmark.circle" : "xmark.circle", in: self.view, bottomInset: self.bottomBar.bounds.height)
                            }
                        }
                    })
                }
            }
        }
    }

    private func goToMessage() {
        let id = items[currentIndex].id
        close(velocity: 0, flyBack: false) { [weak chat] in
            chat?.scrollToMessage(id)
        }
    }

    private func confirmDelete() {
        let item = items[currentIndex]
        let alert = UIAlertController(title: "Удалить \(item.kind == .video ? "видео" : "фото")?", message: nil, preferredStyle: .actionSheet)
        alert.addAction(UIAlertAction(title: "Удалить", style: .destructive) { [weak self] _ in self?.deleteCurrent() })
        alert.addAction(UIAlertAction(title: "Отмена", style: .cancel))
        alert.popoverPresentationController?.sourceView = moreButton
        present(alert, animated: true)
    }

    private func deleteCurrent() {
        let item = items[currentIndex]
        chat?.performDelete([item.id])
        if items.count == 1 {
            close(velocity: 0, flyBack: false)
            return
        }
        // Убрать страницу и показать соседнюю (следующую, если есть).
        pages.values.forEach {
            $0.pause()
            $0.removeFromSuperview()
        }
        pages.removeAll()
        items.remove(at: currentIndex)
        currentIndex = min(currentIndex, items.count - 1)
        indexOfStart = -1
        pagingView.contentSize = CGSize(width: pageWidth * CGFloat(items.count), height: view.bounds.height)
        pagingView.contentOffset = CGPoint(x: pageWidth * CGFloat(currentIndex), y: 0)
        loadPagesAround(currentIndex)
        updateChrome()
        currentPage?.alpha = 0
        Motion.fade(duration: 0.2) { self.currentPage?.alpha = 1 }
        pageDidSettle()
    }

    // MARK: Открытие

    private func animateIn() {
        let id = items[currentIndex].id
        guard let page = currentPage else { return }
        view.layoutIfNeeded()
        let targetFrame = page.displayedImageFrame(in: view)
        guard !Motion.reduceMotion, UIView.areAnimationsEnabled,
              let tile = chat?.visibleMediaTile(for: id), let image = tile.imageView.image ?? page.imageView.image else {
            // Растворение (уменьшение движения или нет плитки на экране).
            view.alpha = 0
            Motion.fade(duration: 0.2, { self.view.alpha = 1 }, completion: { _ in self.pageDidSettle() })
            return
        }
        isTransitioning = true
        setNeedsStatusBarAppearanceUpdate()
        let sourceFrame = tile.convert(tile.bounds, to: view)
        let sourceRadius = tile.superview?.layer.cornerRadius ?? 0
        tile.alpha = 0
        hiddenTile = tile
        page.isHidden = true
        topBar.alpha = 0
        bottomBar.alpha = 0
        backgroundView.alpha = 0

        let flyer = makeFlyer(image: image, frame: sourceFrame, radius: sourceRadius)
        view.insertSubview(flyer, aboveSubview: pagingView)
        animateFlyer(flyer, to: targetFrame, radius: 0, positionDuration: 0.21, sizeDuration: 0.25) { [weak self] in
            guard let self else { return }
            page.isHidden = false
            flyer.removeFromSuperview()
            self.restoreHiddenTile()
            self.isTransitioning = false
            self.setNeedsStatusBarAppearanceUpdate()
            self.pageDidSettle()
        }
        UIView.animate(withDuration: 0.15, delay: 0, options: [.curveLinear]) {
            self.backgroundView.alpha = 1
        }
        UIView.animate(withDuration: 0.2, delay: 0.1, options: [.curveEaseOut]) {
            self.topBar.alpha = 1
            self.bottomBar.alpha = 1
        }
    }

    private func makeFlyer(image: UIImage, frame: CGRect, radius: CGFloat) -> UIImageView {
        let flyer = UIImageView(image: image)
        flyer.contentMode = .scaleAspectFill
        flyer.clipsToBounds = true
        flyer.layer.cornerRadius = radius
        flyer.layer.cornerCurve = .continuous
        flyer.frame = frame
        return flyer
    }

    /// Положение и размер — отдельными аниматорами с разной длительностью (как у Telegram),
    /// радиус скругления — `CABasicAnimation` той же кривой.
    private func animateFlyer(
        _ flyer: UIView, to frame: CGRect, radius: CGFloat, positionDuration: TimeInterval, sizeDuration: TimeInterval,
        completion: @escaping () -> Void
    ) {
        let curve = BezierCurve.telegramSpring
        let position = UIViewPropertyAnimator(duration: positionDuration, controlPoint1: curve.p1, controlPoint2: curve.p2) {
            flyer.center = CGPoint(x: frame.midX, y: frame.midY)
        }
        let size = UIViewPropertyAnimator(duration: sizeDuration, controlPoint1: curve.p1, controlPoint2: curve.p2) {
            flyer.bounds = CGRect(origin: .zero, size: frame.size)
        }
        let corner = CABasicAnimation(keyPath: "cornerRadius")
        corner.fromValue = flyer.layer.cornerRadius
        corner.toValue = radius
        corner.duration = sizeDuration
        corner.timingFunction = curve.timingFunction
        flyer.layer.cornerRadius = radius
        flyer.layer.add(corner, forKey: "cornerRadius")
        size.addCompletion { _ in completion() }
        position.startAnimation()
        size.startAnimation()
    }

    private func restoreHiddenTile() {
        hiddenTile?.alpha = 1
        hiddenTile = nil
    }

    // MARK: Закрытие

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard gestureRecognizer === dismissPan else { return true }
        guard !isTransitioning, let page = currentPage, !page.isZoomed else { return false }
        let velocity = dismissPan.velocity(in: view)
        return abs(velocity.y) > abs(velocity.x)
    }

    /// Фон гаснет на 1 − |d|/300 (у Telegram делитель 80 — в его единицах прокрутки на 3h;
    /// с прямым смещением пальца 80 pt гасят фон почти мгновенно, поэтому мягче), подписи —
    /// на 1 − |d|/50, как у Telegram.
    @objc private func handleDismissPan(_ gesture: UIPanGestureRecognizer) {
        guard let page = currentPage else { return }
        let translation = gesture.translation(in: view)
        let distance = translation.y
        switch gesture.state {
        case .began:
            page.pause()
        case .changed:
            page.scrollView.transform = CGAffineTransform(translationX: translation.x * 0.3, y: distance)
            backgroundView.alpha = max(0, 1 - abs(distance) / 300)
            let chromeAlpha = chromeHidden ? 0 : max(0, 1 - abs(distance) / 50)
            topBar.alpha = chromeAlpha
            bottomBar.alpha = chromeAlpha
        case .ended, .cancelled:
            let velocity = gesture.velocity(in: view).y
            if gesture.state == .ended, abs(velocity) > 1000 || abs(distance) > view.bounds.height / 4 {
                close(velocity: velocity)
            } else {
                Motion.spring(duration: 0.45, {
                    page.scrollView.transform = .identity
                    self.backgroundView.alpha = 1
                    self.topBar.alpha = self.chromeHidden ? 0 : 1
                    self.bottomBar.alpha = self.chromeHidden ? 0 : 1
                }, completion: { _ in
                    if page.item.kind == .video { page.play() }
                })
            }
        default:
            break
        }
    }

    /// Закрыть: картинка улетает в свою плитку в ленте (0,25 с, кривая `.spring` Telegram),
    /// фон гаснет за 0,2 с. Если плитки на экране нет — растворение со сжатием.
    func close(velocity: CGFloat, flyBack: Bool = true, completion: (() -> Void)? = nil) {
        guard !isTransitioning else { return }
        isTransitioning = true
        if let timeObserver { timeObserver.player.removeTimeObserver(timeObserver.token) }
        timeObserver = nil
        pages.values.forEach { $0.pause() }
        let finish = { [weak self] in
            guard let self else { return }
            self.restoreHiddenTile()
            self.dismiss(animated: false, completion: completion)
        }
        guard let page = currentPage else {
            finish()
            return
        }
        let id = items[currentIndex].id
        let tile = flyBack && !Motion.reduceMotion && UIView.areAnimationsEnabled ? chat?.visibleMediaTile(for: id) : nil
        guard let tile, let image = page.imageView.image else {
            // Растворение со сжатием и с продолжением движения пальца.
            Motion.fade(duration: 0.2, {
                self.view.alpha = 0
                if !Motion.reduceMotion {
                    let push: CGFloat = velocity == 0 ? 0 : (velocity > 0 ? 80 : -80)
                    page.scrollView.transform = page.scrollView.transform.translatedBy(x: 0, y: push).scaledBy(x: 0.9, y: 0.9)
                }
            }, completion: { _ in finish() })
            return
        }
        let startFrame = page.displayedImageFrame(in: view)
        let targetFrame = tile.convert(tile.bounds, to: view)
        let radius = tile.superview?.layer.cornerRadius ?? 0
        tile.alpha = 0
        hiddenTile = tile
        page.isHidden = true
        let flyer = makeFlyer(image: image, frame: startFrame, radius: 0)
        view.insertSubview(flyer, aboveSubview: pagingView)
        setNeedsStatusBarAppearanceUpdate()
        UIView.animate(withDuration: 0.2) {
            self.backgroundView.alpha = 0
            self.topBar.alpha = 0
            self.bottomBar.alpha = 0
        }
        animateFlyer(flyer, to: targetFrame, radius: radius, positionDuration: 0.25, sizeDuration: 0.25) {
            finish()
        }
    }

    override func accessibilityPerformEscape() -> Bool {
        close(velocity: 0)
        return true
    }
}
