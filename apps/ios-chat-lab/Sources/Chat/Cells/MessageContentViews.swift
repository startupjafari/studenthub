import UIKit
import AVFoundation

// MARK: - Время и галочки

/// «изменено 12:45 ✓✓». Часы у отправляемого вращаются, вторая галочка появляется с анимацией.
final class MessageStatusView: UIView {
    private let label = UILabel()
    private let checksLayer = CAShapeLayer()
    private let secondCheckLayer = CAShapeLayer()
    private let clockLayer = CAShapeLayer()
    private let clockHandLayer = CAShapeLayer()
    private let pillView = UIView()
    private var status: DeliveryStatus?
    private var placement: MessageLayout.StatusPlacement = .inline

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        pillView.layer.cornerRadius = 9
        pillView.layer.cornerCurve = .continuous
        addSubview(pillView)
        label.font = Fonts.time
        addSubview(label)
        for shape in [checksLayer, secondCheckLayer, clockLayer, clockHandLayer] {
            shape.fillColor = nil
            shape.lineWidth = 1.3
            shape.lineCap = .round
            shape.lineJoin = .round
            layer.addSublayer(shape)
        }
        checksLayer.path = Self.checkPath(offsetX: 0)
        secondCheckLayer.path = Self.checkPath(offsetX: 4.5)
        clockLayer.path = UIBezierPath(ovalIn: CGRect(x: 0, y: 0, width: 11, height: 11)).cgPath
        let hands = UIBezierPath()
        hands.move(to: CGPoint(x: 5.5, y: 5.5))
        hands.addLine(to: CGPoint(x: 5.5, y: 2.5))
        hands.move(to: CGPoint(x: 5.5, y: 5.5))
        hands.addLine(to: CGPoint(x: 7.5, y: 5.5))
        clockHandLayer.path = hands.cgPath
        clockHandLayer.bounds = CGRect(x: 0, y: 0, width: 11, height: 11)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private static func checkPath(offsetX: CGFloat) -> CGPath {
        let path = UIBezierPath()
        path.move(to: CGPoint(x: offsetX + 0.5, y: 4.5))
        path.addLine(to: CGPoint(x: offsetX + 3.3, y: 7.3))
        path.addLine(to: CGPoint(x: offsetX + 9.5, y: 0.8))
        return path.cgPath
    }

    func configure(text: String, status: DeliveryStatus?, outgoing: Bool, placement: MessageLayout.StatusPlacement, animated: Bool) {
        self.placement = placement
        label.text = text
        let onMedia = placement != .inline
        let textColor: UIColor = onMedia ? .white : Palette.meta(outgoing: outgoing)
        label.textColor = textColor
        pillView.isHidden = !onMedia
        pillView.backgroundColor = placement == .overlay ? UIColor.black.withAlphaComponent(0.45) : Palette.serviceFill
        let checkColor = (onMedia ? UIColor.white : (status == .read ? Palette.outgoingCheck : Palette.meta(outgoing: true)))
            .resolvedColor(with: traitCollection).cgColor
        for shape in [checksLayer, secondCheckLayer, clockLayer, clockHandLayer] {
            shape.strokeColor = checkColor
        }
        let previous = self.status
        self.status = status
        guard let status, outgoing else {
            [checksLayer, secondCheckLayer, clockLayer, clockHandLayer].forEach { $0.isHidden = true }
            setNeedsLayout()
            return
        }
        let isSending = status == .sending
        clockLayer.isHidden = !isSending
        clockHandLayer.isHidden = !isSending
        checksLayer.isHidden = isSending || status == .failed
        let showsSecond = status == .read || status == .delivered
        secondCheckLayer.isHidden = !showsSecond || status == .failed
        if isSending {
            if clockHandLayer.animation(forKey: "spin") == nil {
                let spin = CABasicAnimation(keyPath: "transform.rotation.z")
                spin.fromValue = 0
                spin.toValue = CGFloat.pi * 2
                spin.duration = 1.2
                spin.repeatCount = .infinity
                clockHandLayer.add(spin, forKey: "spin")
            }
        } else {
            clockHandLayer.removeAnimation(forKey: "spin")
        }
        if animated, showsSecond, previous != nil, previous != .read, previous != .delivered {
            // Вторая галочка «дописывается», как у Telegram.
            let draw = CABasicAnimation(keyPath: "strokeEnd")
            draw.fromValue = 0
            draw.toValue = 1
            draw.duration = 0.2
            secondCheckLayer.add(draw, forKey: "draw")
            let pop = CAKeyframeAnimation(keyPath: "transform.scale")
            pop.values = [1, 1.25, 1]
            pop.duration = 0.25
            checksLayer.add(pop, forKey: "pop")
        }
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        pillView.frame = bounds
        let hasChecks = !(checksLayer.isHidden && clockLayer.isHidden)
        let inset: CGFloat = placement == .inline ? 0 : 6
        let checksWidth: CGFloat = hasChecks ? BubbleMetrics.checksWidth : 0
        let labelSize = label.sizeThatFits(bounds.size)
        let labelY = (bounds.height - labelSize.height) / 2
        label.frame = CGRect(x: inset, y: labelY, width: bounds.width - inset * 2 - checksWidth, height: labelSize.height)
        let checksX = bounds.width - inset - checksWidth + 3
        let checksY = (bounds.height - 8) / 2
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        checksLayer.frame = CGRect(x: checksX, y: checksY, width: 15, height: 9)
        secondCheckLayer.frame = checksLayer.frame
        clockLayer.frame = CGRect(x: checksX + 2, y: (bounds.height - 11) / 2, width: 11, height: 11)
        clockHandLayer.position = CGPoint(x: clockLayer.frame.midX, y: clockLayer.frame.midY)
        CATransaction.commit()
    }
}

// MARK: - Цитата ответа

final class ReplyHeaderView: UIView {
    private let bar = UIView()
    private let nameLabel = UILabel()
    private let textLabel = UILabel()
    private let thumbnail = UIImageView()
    private var thumbFile: String?

    override init(frame: CGRect) {
        super.init(frame: frame)
        layer.cornerRadius = 6
        layer.cornerCurve = .continuous
        clipsToBounds = true
        bar.layer.cornerRadius = 1.5
        addSubview(bar)
        nameLabel.font = Fonts.replyName
        textLabel.font = Fonts.replyText
        addSubview(nameLabel)
        addSubview(textLabel)
        thumbnail.contentMode = .scaleAspectFill
        thumbnail.clipsToBounds = true
        thumbnail.layer.cornerRadius = 4
        addSubview(thumbnail)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(_ preview: ReplyPreview, outgoing: Bool, freeform: Bool) {
        let accent = freeform ? UIColor.white : Palette.accent(outgoing: outgoing)
        backgroundColor = freeform ? Palette.serviceFill : Palette.secondaryFill(outgoing: outgoing)
        bar.backgroundColor = accent
        nameLabel.textColor = accent
        nameLabel.text = preview.isDeleted ? "Удалённое сообщение" : preview.authorName
        textLabel.text = preview.isDeleted ? "" : preview.text.replacingOccurrences(of: "\n", with: " ")
        textLabel.textColor = freeform ? .white : Palette.text(outgoing: outgoing)
        thumbFile = preview.thumbnailFile
        thumbnail.isHidden = preview.thumbnailFile == nil
        thumbnail.image = nil
        if let file = preview.thumbnailFile {
            let source: ImagePipeline.Source = file.hasSuffix(".mp4") ? .videoFrame(file) : .photo(file)
            if let image = ImagePipeline.shared.load(source, pointSize: CGSize(width: 32, height: 32), completion: { [weak self] image in
                if self?.thumbFile == file { self?.thumbnail.image = image }
            }) {
                thumbnail.image = image
            }
        }
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        bar.frame = CGRect(x: 0, y: 0, width: 3, height: bounds.height)
        var x: CGFloat = 9
        if !thumbnail.isHidden {
            thumbnail.frame = CGRect(x: x, y: 4, width: bounds.height - 8, height: bounds.height - 8)
            x = thumbnail.frame.maxX + 6
        }
        nameLabel.frame = CGRect(x: x, y: 3, width: bounds.width - x - 6, height: 17)
        textLabel.frame = CGRect(x: x, y: 20, width: bounds.width - x - 6, height: 17)
    }
}

// MARK: - «Переслано от»

final class ForwardHeaderView: UIView {
    private let titleLabel = UILabel()
    private let nameLabel = UILabel()

    override init(frame: CGRect) {
        super.init(frame: frame)
        titleLabel.font = Fonts.replyText
        titleLabel.text = "Переслано от"
        nameLabel.font = Fonts.replyName
        addSubview(titleLabel)
        addSubview(nameLabel)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(name: String, outgoing: Bool) {
        titleLabel.textColor = Palette.accent(outgoing: outgoing)
        nameLabel.textColor = Palette.accent(outgoing: outgoing)
        nameLabel.text = name
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        titleLabel.frame = CGRect(x: 0, y: 0, width: bounds.width, height: 17)
        nameLabel.frame = CGRect(x: 0, y: 18, width: bounds.width, height: 17)
    }
}

// MARK: - Медиа

/// Плитка фото/видео/GIF. Картинка — из `ImagePipeline` (распакована в фоне).
final class MediaTileView: UIView {
    let imageView = UIImageView()
    private let playBadge = UIView()
    private let playIcon = UIImageView(image: UIImage(systemName: "play.fill"))
    private let durationPill = UILabel()
    private let gifBadge = UILabel()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private(set) var messageId: MessageID = 0
    private var requestedFile: String?
    private var isGIF = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        clipsToBounds = true
        backgroundColor = UIColor.secondarySystemFill
        imageView.contentMode = .scaleAspectFill
        imageView.clipsToBounds = true
        addSubview(imageView)
        playBadge.backgroundColor = UIColor.black.withAlphaComponent(0.45)
        playBadge.layer.cornerRadius = 22
        playBadge.isUserInteractionEnabled = false
        playIcon.tintColor = .white
        playIcon.contentMode = .scaleAspectFit
        playBadge.addSubview(playIcon)
        addSubview(playBadge)
        for label in [durationPill, gifBadge] {
            label.font = .systemFont(ofSize: 11, weight: .semibold)
            label.textColor = .white
            label.backgroundColor = UIColor.black.withAlphaComponent(0.45)
            label.textAlignment = .center
            label.layer.cornerRadius = 9
            label.layer.masksToBounds = true
            addSubview(label)
        }
        gifBadge.text = "GIF"
        spinner.color = .white
        addSubview(spinner)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(message: Message, size: CGSize) {
        messageId = message.id
        guard let media = message.kind.media else { return }
        isGIF = { if case .gif = message.kind { return true } else { return false } }()
        let isVideo = { if case .video = message.kind { return true } else { return false } }()
        playBadge.isHidden = !isVideo
        durationPill.isHidden = !isVideo
        durationPill.text = isVideo ? MessageLayoutEngine.formatDuration(media.duration) : nil
        gifBadge.isHidden = !isGIF
        load(media: media, kind: message.kind, size: size)
        accessibilityIdentifier = "media.\(message.id)"
    }

    private func load(media: MediaRef, kind: MessageKind, size: CGSize) {
        let file = media.file
        requestedFile = file
        guard MediaStorage.exists(file) else {
            imageView.image = nil
            spinner.startAnimating()
            return
        }
        spinner.stopAnimating()
        let source: ImagePipeline.Source
        switch kind {
        case .video: source = .videoFrame(file)
        case .gif: source = .gifPoster(file)
        default: source = .photo(file)
        }
        if let image = ImagePipeline.shared.load(source, pointSize: size, completion: { [weak self] image in
            guard let self, self.requestedFile == file, self.imageView.image == nil || self.isGIF == false else { return }
            self.imageView.image = image
            self.imageView.alpha = 0
            UIView.animate(withDuration: 0.15) { self.imageView.alpha = 1 }
            self.startGIFIfNeeded(file: file, size: size)
        }) {
            imageView.image = image
            imageView.alpha = 1
            startGIFIfNeeded(file: file, size: size)
        } else {
            imageView.image = nil
        }
    }

    /// GIF играет в ленте сам, без звука, по кругу.
    private func startGIFIfNeeded(file: String, size: CGSize) {
        guard isGIF else { return }
        ImagePipeline.shared.loadAnimated(file, maxPointSize: max(size.width, size.height)) { [weak self] image in
            guard let self, self.requestedFile == file, let image else { return }
            self.imageView.image = image
            self.imageView.startAnimating()
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        imageView.frame = bounds
        playBadge.frame = CGRect(x: bounds.midX - 22, y: bounds.midY - 22, width: 44, height: 44)
        playIcon.frame = CGRect(x: 14, y: 12, width: 18, height: 20)
        let durationWidth = (durationPill.text as NSString?)?.size(withAttributes: [.font: durationPill.font!]).width ?? 30
        durationPill.frame = CGRect(x: 6, y: 6, width: ceil(durationWidth) + 12, height: 18)
        gifBadge.frame = CGRect(x: 6, y: 6, width: 34, height: 18)
        spinner.center = CGPoint(x: bounds.midX, y: bounds.midY)
    }
}

/// Мозаика альбома (или одно медиа). Внешние углы — радиус пузыря, внутренние стыки — 2 pt.
final class MediaMosaicView: UIView {
    private(set) var tiles: [MediaTileView] = []

    override init(frame: CGRect) {
        super.init(frame: frame)
        clipsToBounds = true
        layer.cornerCurve = .continuous
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(messages: [Message], frames: [CGRect], roundsTop: Bool, roundsBottom: Bool) {
        while tiles.count < frames.count {
            let tile = MediaTileView()
            addSubview(tile)
            tiles.append(tile)
        }
        for (index, tile) in tiles.enumerated() {
            if index < frames.count, index < messages.count {
                tile.isHidden = false
                tile.frame = frames[index]
                tile.configure(message: messages[index], size: frames[index].size)
            } else {
                tile.isHidden = true
            }
        }
        layer.cornerRadius = BubbleMetrics.cornerRadius - BubbleMetrics.mediaInset
        var corners: CACornerMask = []
        if roundsTop { corners.formUnion([.layerMinXMinYCorner, .layerMaxXMinYCorner]) }
        if roundsBottom { corners.formUnion([.layerMinXMaxYCorner, .layerMaxXMaxYCorner]) }
        layer.maskedCorners = corners
        if corners.isEmpty { layer.cornerRadius = 4; layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner, .layerMinXMaxYCorner, .layerMaxXMaxYCorner] }
    }

    func tile(at point: CGPoint) -> MediaTileView? {
        tiles.first { !$0.isHidden && $0.frame.contains(point) }
    }

    func tile(for id: MessageID) -> MediaTileView? {
        tiles.first { !$0.isHidden && $0.messageId == id }
    }
}

// MARK: - Файл

final class FileBlockView: UIView {
    private let iconView = UIView()
    private let extLabel = UILabel()
    private let iconImage = UIImageView(image: UIImage(systemName: "doc.fill"))
    private let nameLabel = UILabel()
    private let sizeLabel = UILabel()

    override init(frame: CGRect) {
        super.init(frame: frame)
        iconView.layer.cornerRadius = 23
        addSubview(iconView)
        iconImage.tintColor = .white
        iconImage.contentMode = .scaleAspectFit
        iconView.addSubview(iconImage)
        extLabel.font = .systemFont(ofSize: 9, weight: .bold)
        extLabel.textColor = .white
        extLabel.textAlignment = .center
        iconView.addSubview(extLabel)
        nameLabel.font = Fonts.fileName
        nameLabel.lineBreakMode = .byTruncatingMiddle
        sizeLabel.font = Fonts.fileSize
        addSubview(nameLabel)
        addSubview(sizeLabel)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(media: MediaRef, outgoing: Bool) {
        iconView.backgroundColor = Palette.accent(outgoing: outgoing)
        nameLabel.text = media.fileName ?? media.file
        nameLabel.textColor = Palette.text(outgoing: outgoing)
        sizeLabel.text = MessageLayoutEngine.formatFileSize(media.fileSize ?? 0)
        sizeLabel.textColor = Palette.meta(outgoing: outgoing)
        extLabel.text = (media.fileName as NSString?)?.pathExtension.uppercased()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        iconView.frame = CGRect(x: 0, y: 0, width: 46, height: 46)
        iconImage.frame = CGRect(x: 13, y: 9, width: 20, height: 22)
        extLabel.frame = CGRect(x: 0, y: 32, width: 46, height: 10)
        nameLabel.frame = CGRect(x: 56, y: 3, width: bounds.width - 56, height: 20)
        sizeLabel.frame = CGRect(x: 56, y: 25, width: bounds.width - 56, height: 17)
    }
}

// MARK: - Голосовое

/// Форма волны: столбики 2 pt через 1 pt, проигранная часть — цветом акцента.
final class WaveformView: UIView {
    var samples: [UInt8] = [] { didSet { setNeedsDisplay() } }
    var progress: CGFloat = 0 { didSet { if abs(oldValue - progress) > 0.001 { setNeedsDisplay() } } }
    var activeColor: UIColor = .systemBlue { didSet { setNeedsDisplay() } }
    var inactiveColor: UIColor = .systemGray { didSet { setNeedsDisplay() } }

    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        contentMode = .redraw
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func draw(_ rect: CGRect) {
        guard !samples.isEmpty else { return }
        let barWidth: CGFloat = 2
        let gap: CGFloat = 1
        let count = max(1, Int((bounds.width + gap) / (barWidth + gap)))
        for index in 0..<count {
            let sampleIndex = min(samples.count - 1, index * samples.count / count)
            let value = CGFloat(samples[sampleIndex]) / 31
            let height = max(2, value * bounds.height)
            let x = CGFloat(index) * (barWidth + gap)
            let rect = CGRect(x: x, y: bounds.height - height, width: barWidth, height: height)
            let played = x / bounds.width < progress
            (played ? activeColor : inactiveColor).resolvedColor(with: traitCollection).setFill()
            UIBezierPath(roundedRect: rect, cornerRadius: 1).fill()
        }
    }
}

final class VoiceBlockView: UIView {
    let playButton = UIView()
    private let playIcon = UIImageView()
    let waveform = WaveformView()
    private let durationLabel = UILabel()
    private let unreadDot = UIView()
    private(set) var messageId: MessageID = 0
    private var duration: Double = 0
    private var outgoing = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        playButton.layer.cornerRadius = 22
        addSubview(playButton)
        playIcon.tintColor = .white
        playIcon.contentMode = .center
        playButton.addSubview(playIcon)
        addSubview(waveform)
        durationLabel.font = .monospacedDigitSystemFont(ofSize: 11, weight: .regular)
        addSubview(durationLabel)
        unreadDot.layer.cornerRadius = 2.5
        addSubview(unreadDot)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(message: Message, media: MediaRef) {
        messageId = message.id
        duration = media.duration
        outgoing = message.isOutgoing
        playButton.backgroundColor = Palette.accent(outgoing: outgoing)
        waveform.samples = media.waveform ?? []
        waveform.activeColor = Palette.accent(outgoing: outgoing)
        waveform.inactiveColor = Palette.accent(outgoing: outgoing).withAlphaComponent(0.35)
        durationLabel.textColor = Palette.meta(outgoing: outgoing)
        unreadDot.backgroundColor = Palette.accent(outgoing: outgoing)
        unreadDot.isHidden = message.isConsumed || message.isOutgoing
        updatePlayback()
        accessibilityIdentifier = "voice.\(message.id)"
    }

    func updatePlayback() {
        let player = AudioPlayerService.shared
        let playing = player.isPlaying(messageId)
        let isCurrent = player.currentId == messageId
        let configuration = UIImage.SymbolConfiguration(pointSize: 18, weight: .bold)
        playIcon.image = UIImage(systemName: playing ? "pause.fill" : "play.fill", withConfiguration: configuration)
        waveform.progress = CGFloat(player.progress(for: messageId))
        let shown = isCurrent ? player.currentTime : duration
        durationLabel.text = MessageLayoutEngine.formatDuration(shown)
        if isCurrent { unreadDot.isHidden = true }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        playButton.frame = CGRect(x: 0, y: 0, width: 44, height: 44)
        playIcon.frame = playButton.bounds.offsetBy(dx: 1, dy: 0)
        waveform.frame = CGRect(x: 54, y: 6, width: bounds.width - 54, height: 18)
        durationLabel.sizeToFit()
        durationLabel.frame.origin = CGPoint(x: 54, y: 28)
        unreadDot.frame = CGRect(x: durationLabel.frame.maxX + 4, y: durationLabel.frame.midY - 2.5, width: 5, height: 5)
    }
}

// MARK: - Кружок

/// Видеосообщение: в ленте играет само без звука по кругу; по нажатию — со звуком и
/// кольцом прогресса.
final class VideoNoteView: UIView {
    private let thumbnail = UIImageView()
    private let playerLayer = AVPlayerLayer()
    private let progressLayer = CAShapeLayer()
    private let mutedBadge = UIImageView(image: UIImage(systemName: "speaker.slash.fill"))
    private var player: AVQueuePlayer?
    private var looper: AVPlayerLooper?
    private(set) var messageId: MessageID = 0
    private var file: String?
    private var timeObserver: Any?
    private(set) var isPlayingWithSound = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        clipsToBounds = true
        thumbnail.contentMode = .scaleAspectFill
        addSubview(thumbnail)
        playerLayer.videoGravity = .resizeAspectFill
        layer.addSublayer(playerLayer)
        progressLayer.fillColor = nil
        progressLayer.strokeColor = UIColor.white.cgColor
        progressLayer.lineWidth = 3
        progressLayer.lineCap = .round
        progressLayer.strokeEnd = 0
        layer.addSublayer(progressLayer)
        mutedBadge.tintColor = .white
        mutedBadge.backgroundColor = UIColor.black.withAlphaComponent(0.4)
        mutedBadge.contentMode = .center
        mutedBadge.layer.cornerRadius = 11
        mutedBadge.clipsToBounds = true
        addSubview(mutedBadge)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    deinit {
        if let timeObserver { player?.removeTimeObserver(timeObserver) }
    }

    func configure(message: Message, media: MediaRef) {
        if file != media.file { stop() }
        messageId = message.id
        file = media.file
        accessibilityIdentifier = "videoNote.\(message.id)"
        let size = bounds.size == .zero ? CGSize(width: 220, height: 220) : bounds.size
        if let image = ImagePipeline.shared.load(.videoFrame(media.file), pointSize: size, completion: { [weak self] image in
            if self?.file == media.file { self?.thumbnail.image = image }
        }) {
            thumbnail.image = image
        } else {
            thumbnail.image = nil
        }
    }

    /// Ячейка на экране — тихое проигрывание по кругу.
    func startMuted() {
        guard player == nil, let file, MediaStorage.exists(file) else { return }
        let item = AVPlayerItem(url: MediaStorage.url(for: file))
        let player = AVQueuePlayer()
        player.isMuted = true
        player.preventsDisplaySleepDuringVideoPlayback = false
        looper = AVPlayerLooper(player: player, templateItem: item)
        playerLayer.player = player
        self.player = player
        player.play()
        isPlayingWithSound = false
        mutedBadge.isHidden = false
    }

    func stop() {
        if let timeObserver { player?.removeTimeObserver(timeObserver) }
        timeObserver = nil
        player?.pause()
        playerLayer.player = nil
        looper = nil
        player = nil
        isPlayingWithSound = false
        progressLayer.strokeEnd = 0
    }

    /// Нажатие: звук с начала и кольцо прогресса; повторное — снова без звука.
    func toggleSound() {
        if player == nil { startMuted() }
        guard let player else { return }
        if isPlayingWithSound {
            player.isMuted = true
            isPlayingWithSound = false
            mutedBadge.isHidden = false
            if let timeObserver { player.removeTimeObserver(timeObserver) }
            timeObserver = nil
            progressLayer.strokeEnd = 0
            return
        }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        AudioPlayerService.shared.stop()
        player.seek(to: .zero)
        player.isMuted = false
        player.play()
        isPlayingWithSound = true
        mutedBadge.isHidden = true
        ChatStore.shared.markConsumed(messageId)
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 30), queue: .main) { [weak self] time in
            MainActor.assumeIsolated {
                guard let self, let item = self.player?.currentItem else { return }
                let duration = item.duration.seconds
                guard duration.isFinite, duration > 0 else { return }
                CATransaction.begin()
                CATransaction.setDisableActions(true)
                self.progressLayer.strokeEnd = CGFloat(time.seconds / duration)
                CATransaction.commit()
            }
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        layer.cornerRadius = bounds.width / 2
        thumbnail.frame = bounds
        playerLayer.frame = bounds
        progressLayer.frame = bounds
        progressLayer.path = UIBezierPath(
            arcCenter: CGPoint(x: bounds.midX, y: bounds.midY), radius: bounds.width / 2 - 3,
            startAngle: -.pi / 2, endAngle: .pi * 1.5, clockwise: true
        ).cgPath
        mutedBadge.frame = CGRect(x: bounds.midX - 11, y: bounds.maxY - 30, width: 22, height: 22)
    }
}

// MARK: - Реакции

final class ReactionChipView: UIView {
    private let emojiLabel = UILabel()
    private let countLabel = UILabel()
    private(set) var emoji = ""

    override init(frame: CGRect) {
        super.init(frame: frame)
        layer.cornerCurve = .continuous
        emojiLabel.font = .systemFont(ofSize: 16)
        emojiLabel.textAlignment = .center
        countLabel.font = Fonts.reaction
        addSubview(emojiLabel)
        addSubview(countLabel)
        isAccessibilityElement = true
        accessibilityTraits = .button
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(_ chip: ReactionChipLayout, outgoing: Bool, freeform: Bool) {
        emoji = chip.emoji
        emojiLabel.text = chip.emoji
        countLabel.text = chip.count > 1 ? "\(chip.count)" : nil
        let accent = freeform ? UIColor.white : Palette.accent(outgoing: outgoing)
        if chip.isMine {
            backgroundColor = freeform ? Palette.serviceFill : accent
            countLabel.textColor = freeform ? .white : Palette.bubble(outgoing: outgoing)
        } else {
            backgroundColor = freeform ? Palette.serviceFill : Palette.secondaryFill(outgoing: outgoing)
            countLabel.textColor = accent
        }
        accessibilityIdentifier = "reaction.\(chip.emoji)"
        accessibilityLabel = "Реакция \(chip.emoji)\(chip.isMine ? ", ваша" : "")"
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        layer.cornerRadius = bounds.height / 2
        if countLabel.text == nil {
            emojiLabel.frame = bounds
        } else {
            emojiLabel.frame = CGRect(x: 6, y: 0, width: 24, height: bounds.height)
            countLabel.frame = CGRect(x: 32, y: 0, width: bounds.width - 36, height: bounds.height)
        }
    }

    /// Появление новой реакции — пружина из точки, как у Telegram.
    func animateAppearance() {
        guard !Motion.reduceMotion else { return }
        transform = CGAffineTransform(scaleX: 0.2, y: 0.2)
        alpha = 0
        Motion.spring(duration: 0.4, bounce: 0.35) {
            self.transform = .identity
            self.alpha = 1
        }
    }
}
