import UIKit
import AVFoundation

/// Интерфейс записи поверх панели ввода: красная точка и таймер, подсказка «‹ Влево — отмена»,
/// круги Ø110/Ø160 под пальцем (внешний дышит уровнем микрофона), замок над кнопкой.
/// Для кружка — затемнение и круглый предпросмотр камеры с кольцом прогресса.
final class RecordingOverlayView: UIView {
    var onCancel: (() -> Void)?
    var onSend: (() -> Void)?
    var onStop: (() -> Void)?
    var onPreviewDelete: (() -> Void)?
    var onPreviewPlay: (() -> Void)?
    var onPreviewSeek: ((CGFloat) -> Void)?

    private let mode: RecordingController.Mode
    private let strip = UIVisualEffectView(effect: UIBlurEffect(style: .systemChromeMaterial))
    private let redDot = UIView()
    private let timerLabel = UILabel()
    private let hintLabel = UILabel()
    private let cancelButton = UIButton(type: .system)
    private let outerCircle = UIView()
    private let innerCircle = UIView()
    private let innerIcon = UIImageView()
    private let lockView = UIView()
    private let lockIcon = UIImageView(image: UIImage(systemName: "lock", withConfiguration: UIImage.SymbolConfiguration(pointSize: 16, weight: .medium)))
    private let lockArrow = UIImageView(image: UIImage(systemName: "chevron.up", withConfiguration: UIImage.SymbolConfiguration(pointSize: 12, weight: .semibold)))
    private let stopButton = UIButton(type: .system)
    private let sendTapArea = UIButton(type: .custom)

    // Кружок.
    private let dimView = UIView()
    private let videoContainer = UIView()
    private let ringLayer = CAShapeLayer()
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private let processingSpinner = UIActivityIndicatorView(style: .large)

    // Предпросмотр голосового.
    private let previewBar = UIView()
    private let previewTrash = UIButton(type: .system)
    private let previewPlay = UIButton(type: .system)
    private let previewWave = WaveformView()
    private let previewDuration = UILabel()
    private let previewSend = UIButton(type: .custom)

    private var micCenter: CGPoint = .zero
    private var panelFrame: CGRect = .zero
    private var isLocked = false
    private var isPreview = false
    private var previewDurationValue: Double = 0

    init(mode: RecordingController.Mode) {
        self.mode = mode
        super.init(frame: .zero)
        accessibilityIdentifier = "input.record.overlay"
        accessibilityViewIsModal = false

        dimView.backgroundColor = UIColor.black.withAlphaComponent(0.45)
        dimView.alpha = 0
        dimView.isUserInteractionEnabled = false
        if mode == .video { addSubview(dimView) }
        videoContainer.clipsToBounds = true
        videoContainer.backgroundColor = .black
        videoContainer.isUserInteractionEnabled = false
        if mode == .video { addSubview(videoContainer) }
        ringLayer.fillColor = nil
        ringLayer.strokeColor = UIColor.white.cgColor
        ringLayer.lineWidth = 4
        ringLayer.lineCap = .round
        ringLayer.strokeEnd = 0
        processingSpinner.color = .white
        processingSpinner.hidesWhenStopped = true

        addSubview(strip)
        redDot.backgroundColor = .systemRed
        redDot.layer.cornerRadius = 5
        strip.contentView.addSubview(redDot)
        timerLabel.font = .monospacedDigitSystemFont(ofSize: 17, weight: .regular)
        timerLabel.text = "0:00,0"
        timerLabel.accessibilityIdentifier = "input.record.timer"
        strip.contentView.addSubview(timerLabel)
        hintLabel.text = "‹ Влево — отмена"
        hintLabel.font = .systemFont(ofSize: 16)
        hintLabel.textColor = .secondaryLabel
        hintLabel.textAlignment = .center
        strip.contentView.addSubview(hintLabel)
        cancelButton.setTitle("Отмена", for: .normal)
        cancelButton.titleLabel?.font = .systemFont(ofSize: 17)
        cancelButton.alpha = 0
        cancelButton.accessibilityIdentifier = "input.record.cancel"
        cancelButton.addAction(UIAction { [weak self] _ in self?.onCancel?() }, for: .touchUpInside)
        strip.contentView.addSubview(cancelButton)

        lockView.backgroundColor = .secondarySystemBackground
        lockView.layer.cornerRadius = 20
        lockView.layer.borderWidth = 1 / 3
        lockView.layer.borderColor = UIColor.separator.cgColor
        lockView.accessibilityIdentifier = "input.record.lock"
        lockView.isAccessibilityElement = true
        lockView.accessibilityLabel = "Закрепить запись"
        lockIcon.tintColor = .secondaryLabel
        lockArrow.tintColor = .tertiaryLabel
        lockView.addSubview(lockIcon)
        lockView.addSubview(lockArrow)
        addSubview(lockView)
        stopButton.setImage(UIImage(systemName: "stop.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 16)), for: .normal)
        stopButton.tintColor = .systemRed
        stopButton.alpha = 0
        stopButton.accessibilityLabel = mode == .voice ? "Остановить запись" : "Отправить видеосообщение"
        stopButton.accessibilityIdentifier = "input.record.stop"
        stopButton.addAction(UIAction { [weak self] _ in self?.onStop?() }, for: .touchUpInside)
        lockView.addSubview(stopButton)

        outerCircle.backgroundColor = Palette.accent.withAlphaComponent(0.2)
        outerCircle.isUserInteractionEnabled = false
        innerCircle.backgroundColor = Palette.accent
        innerCircle.isUserInteractionEnabled = false
        innerIcon.tintColor = .white
        innerIcon.contentMode = .center
        innerIcon.image = UIImage(systemName: mode == .voice ? "mic.fill" : "video.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 26))
        innerCircle.addSubview(innerIcon)
        addSubview(outerCircle)
        addSubview(innerCircle)
        sendTapArea.accessibilityIdentifier = "input.record.send"
        sendTapArea.accessibilityLabel = "Отправить"
        sendTapArea.isUserInteractionEnabled = false
        sendTapArea.addAction(UIAction { [weak self] _ in self?.onSend?() }, for: .touchUpInside)
        addSubview(sendTapArea)

        setupPreviewBar()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func setupPreviewBar() {
        previewBar.alpha = 0
        previewBar.accessibilityIdentifier = "input.record.preview"
        previewTrash.setImage(UIImage(systemName: "trash", withConfiguration: UIImage.SymbolConfiguration(pointSize: 20)), for: .normal)
        previewTrash.tintColor = .systemRed
        previewTrash.accessibilityLabel = "Удалить запись"
        previewTrash.accessibilityIdentifier = "input.record.preview.delete"
        previewTrash.addAction(UIAction { [weak self] _ in self?.onPreviewDelete?() }, for: .touchUpInside)
        previewPlay.tintColor = .white
        previewPlay.backgroundColor = Palette.accent
        previewPlay.layer.cornerRadius = 15
        previewPlay.accessibilityIdentifier = "input.record.preview.play"
        previewPlay.addAction(UIAction { [weak self] _ in self?.onPreviewPlay?() }, for: .touchUpInside)
        setPreviewPlaying(false)
        previewWave.activeColor = Palette.accent
        previewWave.inactiveColor = Palette.accent.withAlphaComponent(0.35)
        previewWave.isUserInteractionEnabled = true
        previewWave.addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(scrub(_:))))
        previewWave.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(scrub(_:))))
        previewDuration.font = .monospacedDigitSystemFont(ofSize: 13, weight: .regular)
        previewDuration.textColor = .secondaryLabel
        previewSend.setImage(UIImage(systemName: "arrow.up", withConfiguration: UIImage.SymbolConfiguration(pointSize: 16, weight: .bold)), for: .normal)
        previewSend.tintColor = .white
        previewSend.backgroundColor = Palette.accent
        previewSend.layer.cornerRadius = 17
        previewSend.accessibilityLabel = "Отправить голосовое"
        previewSend.accessibilityIdentifier = "input.record.preview.send"
        previewSend.addAction(UIAction { [weak self] _ in self?.onSend?() }, for: .touchUpInside)
        for view in [previewTrash, previewPlay, previewWave, previewDuration, previewSend] as [UIView] { previewBar.addSubview(view) }
        strip.contentView.addSubview(previewBar)
    }

    /// Пропускать касания мимо своих кнопок — к ленте под оверлеем.
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        if hit === self || hit === dimView || hit === videoContainer { return nil }
        if hit === strip || hit === strip.contentView { return isPreview || isLocked ? hit : nil }
        return hit
    }

    // MARK: Появление

    func present(panelFrame: CGRect, micCenter: CGPoint, previewLayer: AVCaptureVideoPreviewLayer?) {
        self.panelFrame = panelFrame
        self.micCenter = micCenter
        if let previewLayer {
            previewLayer.videoGravity = .resizeAspectFill
            videoContainer.layer.addSublayer(previewLayer)
            videoContainer.layer.addSublayer(ringLayer)
            self.previewLayer = previewLayer
            videoContainer.addSubview(processingSpinner)
        }
        layoutStatic()

        // Круги появляются за 0,5 с с затуханием 0,55 (пружина с перелётом).
        innerCircle.transform = CGAffineTransform(scaleX: 0.2, y: 0.2)
        outerCircle.transform = CGAffineTransform(scaleX: 0.2, y: 0.2)
        innerCircle.alpha = 0
        outerCircle.alpha = 0
        strip.alpha = 0
        hintLabel.transform = CGAffineTransform(translationX: 40, y: 0)
        lockView.alpha = 0
        lockView.transform = CGAffineTransform(translationX: 0, y: 30)
        videoContainer.transform = CGAffineTransform(scaleX: 0.3, y: 0.3)
        videoContainer.alpha = 0
        let reduce = Motion.reduceMotion
        UIView.animate(withDuration: reduce ? 0 : 0.5, delay: 0, usingSpringWithDamping: 0.55, initialSpringVelocity: 0, options: [.allowUserInteraction]) {
            self.innerCircle.transform = .identity
            self.outerCircle.transform = .identity
            self.innerCircle.alpha = 1
            self.outerCircle.alpha = 1
            self.lockView.alpha = 1
            self.lockView.transform = .identity
            self.videoContainer.transform = .identity
            self.videoContainer.alpha = 1
        }
        UIView.animate(withDuration: reduce ? 0 : 0.2) {
            self.strip.alpha = 1
            self.hintLabel.transform = .identity
            self.dimView.alpha = 1
        }
        let blink = CABasicAnimation(keyPath: "opacity")
        blink.fromValue = 1
        blink.toValue = 0.2
        blink.duration = 0.5
        blink.autoreverses = true
        blink.repeatCount = .infinity
        redDot.layer.add(blink, forKey: "blink")
        UIAccessibility.post(notification: .announcement, argument: mode == .voice ? "Идёт запись голосового" : "Идёт запись видеосообщения")
    }

    private func layoutStatic() {
        dimView.frame = bounds
        // Полоса — над панелью ввода, выше на 50 pt не уходит.
        strip.frame = CGRect(x: 0, y: panelFrame.maxY - 52, width: bounds.width, height: 52 + max(0, bounds.height - panelFrame.maxY))
        redDot.frame = CGRect(x: 16, y: 21, width: 10, height: 10)
        timerLabel.frame = CGRect(x: 34, y: 14, width: 80, height: 24)
        hintLabel.frame = CGRect(x: 110, y: 14, width: bounds.width - 220, height: 24)
        cancelButton.frame = hintLabel.frame
        innerCircle.bounds = CGRect(x: 0, y: 0, width: 110, height: 110)
        innerCircle.layer.cornerRadius = 55
        innerIcon.frame = innerCircle.bounds
        outerCircle.bounds = CGRect(x: 0, y: 0, width: 160, height: 160)
        outerCircle.layer.cornerRadius = 80
        innerCircle.center = micCenter
        outerCircle.center = micCenter
        sendTapArea.frame = CGRect(x: micCenter.x - 40, y: micCenter.y - 40, width: 80, height: 80)
        lockView.frame = CGRect(x: micCenter.x - 20, y: micCenter.y - 70 - 110, width: 40, height: 72)
        lockIcon.frame = CGRect(x: 0, y: 8, width: 40, height: 24)
        lockArrow.frame = CGRect(x: 0, y: 40, width: 40, height: 20)
        stopButton.frame = CGRect(x: 0, y: 16, width: 40, height: 40)
        let diameter = floor(bounds.width * 0.7)
        videoContainer.bounds = CGRect(x: 0, y: 0, width: diameter, height: diameter)
        videoContainer.center = CGPoint(x: bounds.midX, y: max(diameter / 2 + safeAreaInsets.top + 40, (panelFrame.minY - 200) / 2 + 40))
        videoContainer.layer.cornerRadius = diameter / 2
        previewLayer?.frame = videoContainer.bounds
        ringLayer.frame = videoContainer.bounds
        ringLayer.path = UIBezierPath(
            arcCenter: CGPoint(x: diameter / 2, y: diameter / 2), radius: diameter / 2 - 2,
            startAngle: -.pi / 2, endAngle: .pi * 1.5, clockwise: true
        ).cgPath
        processingSpinner.center = CGPoint(x: diameter / 2, y: diameter / 2)
        let barX: CGFloat = 0
        previewBar.frame = CGRect(x: barX, y: 6, width: bounds.width, height: 40)
        previewTrash.frame = CGRect(x: 4, y: 0, width: 44, height: 40)
        previewPlay.frame = CGRect(x: 52, y: 5, width: 30, height: 30)
        previewSend.frame = CGRect(x: bounds.width - 6 - 39, y: 3, width: 34, height: 34)
        previewDuration.frame = CGRect(x: previewSend.frame.minX - 50, y: 10, width: 44, height: 20)
        previewWave.frame = CGRect(x: 90, y: 11, width: previewDuration.frame.minX - 96, height: 18)
    }

    // MARK: Ход записи

    func update(elapsed: Double, level: CGFloat, maxDuration: Double?) {
        let tenths = Int(elapsed * 10) % 10
        let seconds = Int(elapsed)
        timerLabel.text = String(format: "%d:%02d,%d", seconds / 60, seconds % 60, tenths)
        if !isPreview, !isLocked {
            // Внешний круг дышит уровнем микрофона.
            let scale = 1 + min(0.6, level * 0.8)
            outerCircle.transform = CGAffineTransform(scaleX: scale, y: scale)
        }
        if let maxDuration {
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            ringLayer.strokeEnd = CGFloat(min(1, elapsed / maxDuration))
            CATransaction.commit()
        }
    }

    /// Палец ведёт круги; внутренний сжимается до 0,4 по мере ухода влево, подсказка едет следом.
    func updateDrag(offset: CGPoint, rawX: CGFloat, lockProgress: CGFloat) {
        guard !isLocked else { return }
        innerCircle.center = CGPoint(x: micCenter.x + offset.x, y: micCenter.y + offset.y)
        outerCircle.center = innerCircle.center
        let innerScale = max(0.4, 1 - abs(rawX) / 300)
        innerCircle.transform = CGAffineTransform(scaleX: innerScale, y: innerScale)
        hintLabel.transform = CGAffineTransform(translationX: rawX * 0.5, y: 0)
        hintLabel.alpha = max(0, 1 - abs(rawX) / 150)
        lockView.transform = CGAffineTransform(translationX: 0, y: -lockProgress * 30)
        lockArrow.alpha = 1 - lockProgress
    }

    func setLocked() {
        isLocked = true
        sendTapArea.isUserInteractionEnabled = true
        innerIcon.image = UIImage(systemName: "arrow.up", withConfiguration: UIImage.SymbolConfiguration(pointSize: 28, weight: .bold))
        Motion.spring(duration: 0.4, bounce: 0.2) {
            self.innerCircle.center = self.micCenter
            self.outerCircle.center = self.micCenter
            self.innerCircle.transform = CGAffineTransform(scaleX: 0.7, y: 0.7)
            self.outerCircle.alpha = 0
            self.lockView.transform = .identity
            self.lockIcon.alpha = 0
            self.lockArrow.alpha = 0
            self.stopButton.alpha = 1
            self.hintLabel.alpha = 0
            self.cancelButton.alpha = 1
        }
        UIAccessibility.post(notification: .announcement, argument: "Запись закреплена")
    }

    func showProcessing() {
        processingSpinner.startAnimating()
        sendTapArea.isUserInteractionEnabled = false
        stopButton.isEnabled = false
    }

    // MARK: Предпросмотр

    func showPreview(waveform: [UInt8], duration: Double) {
        isPreview = true
        previewDurationValue = duration
        previewWave.samples = waveform
        previewWave.progress = 0
        previewDuration.text = MessageLayoutEngine.formatDuration(duration)
        redDot.layer.removeAllAnimations()
        Motion.layout {
            self.previewBar.alpha = 1
            self.redDot.alpha = 0
            self.timerLabel.alpha = 0
            self.cancelButton.alpha = 0
            self.innerCircle.alpha = 0
            self.outerCircle.alpha = 0
            self.lockView.alpha = 0
        }
        sendTapArea.isUserInteractionEnabled = false
        UIAccessibility.post(notification: .layoutChanged, argument: previewPlay)
    }

    func setPreviewPlaying(_ playing: Bool) {
        previewPlay.setImage(UIImage(systemName: playing ? "pause.fill" : "play.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 13, weight: .bold)), for: .normal)
        previewPlay.accessibilityLabel = playing ? "Пауза" : "Прослушать"
    }

    func setPreviewProgress(_ progress: CGFloat, current: Double) {
        previewWave.progress = progress
        previewDuration.text = MessageLayoutEngine.formatDuration(current)
    }

    @objc private func scrub(_ gesture: UIGestureRecognizer) {
        let x = gesture.location(in: previewWave).x
        onPreviewSeek?(max(0, min(1, x / max(1, previewWave.bounds.width))))
    }

    // MARK: Уход

    func dismiss(cancelled: Bool) {
        redDot.layer.removeAllAnimations()
        let duration = Motion.reduceMotion ? 0 : 0.25
        UIView.animate(withDuration: duration, delay: 0, options: [.curveEaseIn, .beginFromCurrentState]) {
            self.alpha = 0
            if cancelled {
                self.innerCircle.transform = CGAffineTransform(scaleX: 0.1, y: 0.1)
                self.redDot.transform = CGAffineTransform(translationX: 0, y: 20)
            } else {
                self.innerCircle.transform = CGAffineTransform(scaleX: 0.5, y: 0.5)
            }
            self.videoContainer.transform = CGAffineTransform(scaleX: 0.3, y: 0.3)
        } completion: { _ in
            self.previewLayer?.removeFromSuperlayer()
            self.removeFromSuperview()
        }
    }
}
