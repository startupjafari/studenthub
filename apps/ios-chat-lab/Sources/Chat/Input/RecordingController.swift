import UIKit
import AVFoundation

/// Запись голосовых и кружков с кнопки микрофона — жесты и пороги Telegram:
/// - удержание 0,19 с — запись (лёгкий тактильный отклик); касания чаще 0,4 с игнорируются;
/// - короткое касание переключает голос ↔ кружок;
/// - отмена: во время жеста |x| > 150 pt, при отпускании |x| > 100 pt или vx < −400 pt/с;
/// - закрепление: во время жеста |y| > 110 pt, при отпускании |y| > 60 pt или vy < −400 pt/с;
/// - запись короче 0,5 с отбрасывается с отрицательным откликом.
@MainActor
final class RecordingController: NSObject {
    enum Mode { case voice, video }
    enum State { case idle, recording, locked, preview }

    weak var chat: ChatViewController?
    private var panel: InputPanelView? { chat?.inputPanel }

    private(set) var state = State.idle
    private var mode = Mode.voice
    private var lastTouchTime: CFTimeInterval = 0
    private var startPoint: CGPoint = .zero
    private var startTime: CFTimeInterval = 0
    private var tickTimer: Timer?
    private var smoothedLevel: CGFloat = 0
    private var smoothedOffset: CGPoint = .zero

    // Голос.
    private var recorder: AVAudioRecorder?
    private var fileName: String?
    private var samples: [Float] = []
    private var recordedDuration: Double = 0
    private var previewPlayer: AVAudioPlayer?

    // Кружок.
    private let videoRecorder = VideoNoteRecorder()
    private var videoFinishing = false

    private var overlay: RecordingOverlayView?

    static let maxVideoDuration: Double = 60

    init(chat: ChatViewController) {
        self.chat = chat
        super.init()
    }

    func install() {
        guard let panel else { return }
        let long = UILongPressGestureRecognizer(target: self, action: #selector(handleLongPress(_:)))
        long.minimumPressDuration = 0.19
        long.allowableMovement = 10_000
        panel.micButton.addGestureRecognizer(long)
        let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap))
        tap.require(toFail: long)
        panel.micButton.addGestureRecognizer(tap)

        if LaunchOptions.uiTesting {
            // Путь для UI-тестов без микрофона: отправить тестовое голосовое.
            panel.micButton.accessibilityCustomActions = [
                UIAccessibilityCustomAction(name: "Записать тестовое голосовое") { [weak self] _ in
                    guard let panel = self?.panel else { return false }
                    panel.delegate?.inputPanel(panel, didRecordVoice: MediaCatalog.voices[0].ref)
                    return true
                },
                UIAccessibilityCustomAction(name: "Записать тестовый кружок") { [weak self] _ in
                    guard let panel = self?.panel else { return false }
                    panel.delegate?.inputPanel(panel, didRecordVideoNote: MediaCatalog.videoNotes[0].ref)
                    return true
                },
            ]
        }
    }

    // MARK: Касание: голос ↔ кружок

    @objc private func handleTap() {
        let now = CACurrentMediaTime()
        guard now - lastTouchTime > 0.4, let panel, let chat else { return }
        lastTouchTime = now
        Haptics.selection()
        UIView.transition(with: panel.micButton, duration: Motion.reduceMotion ? 0 : 0.2, options: [.transitionFlipFromBottom]) {
            panel.recordsVideoNote.toggle()
        }
        Toast.show(
            panel.recordsVideoNote ? "Удерживайте, чтобы записать видеосообщение" : "Удерживайте, чтобы записать голосовое",
            icon: panel.recordsVideoNote ? "video" : "mic", in: chat.view, bottomInset: chat.bottomVisualInset
        )
    }

    // MARK: Жест записи

    @objc private func handleLongPress(_ gesture: UILongPressGestureRecognizer) {
        guard let chat else { return }
        let location = gesture.location(in: chat.view)
        switch gesture.state {
        case .began:
            let now = CACurrentMediaTime()
            guard state == .idle, now - lastTouchTime > 0.4 else { return }
            lastTouchTime = now
            startPoint = location
            smoothedOffset = .zero
            mode = (panel?.recordsVideoNote ?? false) ? .video : .voice
            begin()
        case .changed:
            guard state == .recording else { return }
            recordSample(location)
            let x = min(0, location.x - startPoint.x)
            let y = min(0, location.y - startPoint.y)
            if abs(x) > 150 {
                cancel()
                return
            }
            if abs(y) > 110 {
                lock()
                return
            }
            // Сглаживание положения круга 0,7/0,3 — как у Telegram.
            smoothedOffset = CGPoint(x: smoothedOffset.x * 0.7 + x * 0.3, y: smoothedOffset.y * 0.7 + y * 0.3)
            overlay?.updateDrag(offset: smoothedOffset, rawX: x, lockProgress: min(1, abs(y) / 105))
        case .ended:
            guard state == .recording else { return }
            let x = min(0, location.x - startPoint.x)
            let y = min(0, location.y - startPoint.y)
            recordSample(location)
            let velocity = panVelocity(gesture)
            if abs(x) > 100 || velocity.x < -400 {
                cancel()
            } else if abs(y) > 60 || velocity.y < -400 {
                lock()
            } else {
                finishAndSend()
            }
        case .cancelled, .failed:
            if state == .recording { cancel() }
        default:
            break
        }
    }

    /// У долгого нажатия нет скорости — считаем по двум последним точкам.
    private var lastSamples: [(CGPoint, CFTimeInterval)] = []
    private func panVelocity(_ gesture: UILongPressGestureRecognizer) -> CGPoint {
        guard lastSamples.count >= 2, let first = lastSamples.first, let last = lastSamples.last else { return .zero }
        let dt = max(0.001, last.1 - first.1)
        return CGPoint(x: (last.0.x - first.0.x) / dt, y: (last.0.y - first.0.y) / dt)
    }

    private func recordSample(_ point: CGPoint) {
        let now = CACurrentMediaTime()
        lastSamples.append((point, now))
        lastSamples.removeAll { now - $0.1 > 0.1 }
    }

    // MARK: Начало

    private func begin() {
        switch mode {
        case .voice: beginVoice()
        case .video: beginVideo()
        }
    }

    private func beginVoice() {
        switch AVAudioApplication.shared.recordPermission {
        case .granted:
            startVoice()
        case .undetermined:
            AVAudioApplication.requestRecordPermission { _ in }
        default:
            showPermissionDenied(title: "Нет доступа к микрофону", message: "Разрешите доступ к микрофону в настройках, чтобы записывать голосовые сообщения.")
        }
    }

    private func startVoice() {
        AudioPlayerService.shared.stop()
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true)
            try FileManager.default.createDirectory(at: MediaStorage.directory, withIntermediateDirectories: true)
            let name = MediaStorage.makeUserFileName(extension: "m4a")
            let settings: [String: Any] = [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
            ]
            let recorder = try AVAudioRecorder(url: MediaStorage.url(for: name), settings: settings)
            recorder.isMeteringEnabled = true
            guard recorder.record() else { throw NSError(domain: "ChatLab.record", code: 1) }
            self.recorder = recorder
            fileName = name
        } catch {
            NSLog("ChatLab: запись не началась: \(error)")
            Haptics.error()
            return
        }
        samples = []
        startRecordingUI()
    }

    private func beginVideo() {
        guard VideoNoteRecorder.isCameraAvailable else {
            showCameraUnavailable(reason: "На этом устройстве нет фронтальной камеры.")
            return
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            startVideo()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { _ in
                AVCaptureDevice.requestAccess(for: .audio) { _ in }
            }
        default:
            showCameraUnavailable(reason: "Нет доступа к камере. Разрешите его в настройках.")
        }
    }

    private func startVideo() {
        AudioPlayerService.shared.stop()
        let withAudio = AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
        videoFinishing = false
        videoRecorder.start(includeAudio: withAudio, maxDuration: Self.maxVideoDuration)
        startRecordingUI()
    }

    private func startRecordingUI() {
        guard let chat, let panel else { return }
        state = .recording
        startTime = CACurrentMediaTime()
        smoothedLevel = 0
        Haptics.impact()
        let overlay = RecordingOverlayView(mode: mode)
        overlay.frame = chat.view.bounds
        overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        chat.view.addSubview(overlay)
        let micCenter = panel.convert(panel.micButton.center, to: chat.view)
        overlay.present(panelFrame: panel.frame, micCenter: micCenter, previewLayer: mode == .video ? videoRecorder.previewLayer : nil)
        overlay.onCancel = { [weak self] in self?.cancel() }
        overlay.onSend = { [weak self] in self?.finishAndSend() }
        overlay.onStop = { [weak self] in self?.stopToPreview() }
        overlay.onPreviewDelete = { [weak self] in self?.deletePreview() }
        overlay.onPreviewPlay = { [weak self] in self?.togglePreviewPlayback() }
        overlay.onPreviewSeek = { [weak self] fraction in self?.seekPreview(fraction) }
        self.overlay = overlay
        lastSamples = []
        let timer = Timer(timeInterval: 1.0 / 30, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        RunLoop.main.add(timer, forMode: .common)
        tickTimer = timer
        if mode == .video { MockChatService.shared.setPresence(.online) }
    }

    private func tick() {
        let elapsed = CACurrentMediaTime() - startTime
        var level: CGFloat = 0
        switch mode {
        case .voice:
            guard let recorder else { return }
            recorder.updateMeters()
            let power = recorder.averagePower(forChannel: 0)
            let linear = Float(pow(10, Double(power) / 20))
            samples.append(linear * 32_767)
            level = CGFloat(min(1, max(0, (power + 50) / 50)))
        case .video:
            level = 0.3 + 0.2 * CGFloat(sin(elapsed * 4))
            if elapsed >= Self.maxVideoDuration { finishAndSend() }
        }
        // Уровень микрофона сглаживается 0,9/0,1.
        smoothedLevel = smoothedLevel * 0.9 + level * 0.1
        overlay?.update(elapsed: elapsed, level: smoothedLevel, maxDuration: mode == .video ? Self.maxVideoDuration : nil)
    }

    // MARK: Закрепление, остановка, предпросмотр

    private func lock() {
        guard state == .recording else { return }
        state = .locked
        Haptics.impact()
        overlay?.setLocked()
    }

    private func stopToPreview() {
        guard mode == .voice, let recorder else {
            finishAndSend()
            return
        }
        let duration = recorder.currentTime
        recorder.stop()
        tickTimer?.invalidate()
        tickTimer = nil
        guard duration >= 0.5 else {
            dropShortRecording()
            return
        }
        recordedDuration = duration
        state = .preview
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        let waveform = Self.makeWaveform(samples)
        overlay?.showPreview(waveform: waveform, duration: duration)
    }

    private func togglePreviewPlayback() {
        guard let fileName else { return }
        if previewPlayer == nil {
            previewPlayer = try? AVAudioPlayer(contentsOf: MediaStorage.url(for: fileName))
            previewPlayer?.prepareToPlay()
        }
        guard let player = previewPlayer else { return }
        if player.isPlaying {
            player.pause()
            tickTimer?.invalidate()
            tickTimer = nil
        } else {
            try? AVAudioSession.sharedInstance().setActive(true)
            player.play()
            let timer = Timer(timeInterval: 1.0 / 30, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.previewTick() }
            }
            RunLoop.main.add(timer, forMode: .common)
            tickTimer = timer
        }
        overlay?.setPreviewPlaying(player.isPlaying)
    }

    private func previewTick() {
        guard let player = previewPlayer else { return }
        let progress = player.duration > 0 ? player.currentTime / player.duration : 0
        overlay?.setPreviewProgress(CGFloat(progress), current: player.isPlaying ? player.currentTime : recordedDuration)
        if !player.isPlaying {
            tickTimer?.invalidate()
            tickTimer = nil
            overlay?.setPreviewPlaying(false)
            overlay?.setPreviewProgress(0, current: recordedDuration)
        }
    }

    private func seekPreview(_ fraction: CGFloat) {
        if previewPlayer == nil, let fileName {
            previewPlayer = try? AVAudioPlayer(contentsOf: MediaStorage.url(for: fileName))
        }
        guard let player = previewPlayer else { return }
        player.currentTime = Double(max(0, min(1, fraction))) * player.duration
        overlay?.setPreviewProgress(fraction, current: player.currentTime)
    }

    private func deletePreview() {
        previewPlayer?.stop()
        previewPlayer = nil
        if let fileName { try? FileManager.default.removeItem(at: MediaStorage.url(for: fileName)) }
        fileName = nil
        Haptics.impact()
        finishUI(cancelled: true)
    }

    // MARK: Отправка и отмена

    private func finishAndSend() {
        switch mode {
        case .voice: finishVoice()
        case .video: finishVideo()
        }
    }

    private func finishVoice() {
        let duration: Double
        if state == .preview {
            previewPlayer?.stop()
            previewPlayer = nil
            duration = recordedDuration
        } else {
            guard let recorder else { return }
            duration = recorder.currentTime
            recorder.stop()
        }
        tickTimer?.invalidate()
        tickTimer = nil
        recorder = nil
        guard duration >= 0.5, let fileName else {
            dropShortRecording()
            return
        }
        let size = (try? FileManager.default.attributesOfItem(atPath: MediaStorage.url(for: fileName).path)[.size] as? NSNumber)?.int64Value
        let media = MediaRef(
            file: fileName, duration: duration, waveform: Self.makeWaveform(samples),
            fileName: nil, fileSize: size, mimeType: "audio/mp4"
        )
        self.fileName = nil
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        finishUI(cancelled: false)
        if let panel { panel.delegate?.inputPanel(panel, didRecordVoice: media) }
    }

    private func finishVideo() {
        guard !videoFinishing else { return }
        videoFinishing = true
        let elapsed = CACurrentMediaTime() - startTime
        tickTimer?.invalidate()
        tickTimer = nil
        guard elapsed >= 0.5 else {
            videoRecorder.stop(discard: true)
            dropShortRecording()
            return
        }
        overlay?.showProcessing()
        videoRecorder.onFinish = { [weak self] media in
            guard let self else { return }
            self.finishUI(cancelled: media == nil)
            if let media, let panel = self.panel {
                panel.delegate?.inputPanel(panel, didRecordVideoNote: media)
            } else if media == nil {
                Haptics.error()
            }
        }
        videoRecorder.stop(discard: false)
    }

    private func dropShortRecording() {
        if let fileName { try? FileManager.default.removeItem(at: MediaStorage.url(for: fileName)) }
        fileName = nil
        recorder = nil
        Haptics.error()
        finishUI(cancelled: true)
        if let chat {
            Toast.show("Удерживайте кнопку, чтобы записать", icon: mode == .video ? "video" : "mic", in: chat.view, bottomInset: chat.bottomVisualInset)
        }
    }

    func cancel() {
        guard state != .idle else { return }
        tickTimer?.invalidate()
        tickTimer = nil
        switch mode {
        case .voice:
            recorder?.stop()
            recorder?.deleteRecording()
            recorder = nil
            previewPlayer?.stop()
            previewPlayer = nil
            fileName = nil
        case .video:
            videoRecorder.stop(discard: true)
        }
        Haptics.impact()
        finishUI(cancelled: true)
    }

    private func finishUI(cancelled: Bool) {
        state = .idle
        lastTouchTime = CACurrentMediaTime()
        let overlay = self.overlay
        self.overlay = nil
        overlay?.dismiss(cancelled: cancelled)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    // MARK: Разрешения

    private func showPermissionDenied(title: String, message: String) {
        guard let chat else { return }
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Отмена", style: .cancel))
        alert.addAction(UIAlertAction(title: "Настройки", style: .default) { _ in
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
        })
        chat.present(alert, animated: true)
    }

    /// Нет камеры (симулятор) или доступа: настоящий запасной путь — тестовый кружок.
    private func showCameraUnavailable(reason: String) {
        guard let chat else { return }
        let alert = UIAlertController(title: "Камера недоступна", message: reason, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Отправить тестовый кружок", style: .default) { [weak self] _ in
            guard let panel = self?.panel else { return }
            let spec = MediaCatalog.videoNotes[Int.random(in: 0..<MediaCatalog.videoNotes.count)]
            panel.delegate?.inputPanel(panel, didRecordVideoNote: spec.ref)
        })
        if AVCaptureDevice.authorizationStatus(for: .video) == .denied {
            alert.addAction(UIAlertAction(title: "Настройки", style: .default) { _ in
                if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            })
        }
        alert.addAction(UIAlertAction(title: "Отмена", style: .cancel))
        chat.present(alert, animated: true)
    }

    // MARK: Форма волны

    /// 100 значений по 5 бит (0…31), как у Telegram: громкость в корзинах, нормировка на
    /// `max(2500, среднее · 1,8)` — тихая запись не превращается в сплошной шум.
    nonisolated static func makeWaveform(_ samples: [Float], count: Int = 100) -> [UInt8] {
        guard !samples.isEmpty else { return [UInt8](repeating: 1, count: count) }
        var bins = [Float](repeating: 0, count: count)
        for (index, sample) in samples.enumerated() {
            let bin = min(count - 1, index * count / samples.count)
            bins[bin] = max(bins[bin], sample)
        }
        // Корзины без сэмплов (короткая запись) — соседнее значение.
        for index in bins.indices where bins[index] == 0 && index > 0 { bins[index] = bins[index - 1] }
        let mean = bins.reduce(0, +) / Float(count)
        let norm = max(2500, mean * 1.8)
        return bins.map { UInt8(max(0, min(31, Int($0 / norm * 31)))) }
    }
}
