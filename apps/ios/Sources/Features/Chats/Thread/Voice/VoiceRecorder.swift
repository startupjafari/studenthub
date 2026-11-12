import AVFoundation
import Foundation
import Observation
import UIKit

/// Запись голосового сообщения: исполняет решения `VoiceRecordingMachine`.
///
/// Пишем сразу в файл, а не в память: минута речи — это мегабайт, и держать её в
/// процессе незачем. Имя файла начинается с `voice-` — по нему и сервер, и веб
/// узнают голосовое: отдельного типа сообщения в модели нет (PROJECT.md §9.1a).
@MainActor
@Observable
final class VoiceRecorder {
    private(set) var machine = VoiceRecordingMachine()
    /// Уровни сигнала для бегущей волны. Это настоящие показания микрофона, а не узор:
    /// по ним видно, записался ли звук вообще.
    private(set) var levels: [Float] = []
    /// Все уровни записи — волна для прослушивания перед отправкой.
    private(set) var envelope: [Float] = []
    private(set) var duration: TimeInterval = 0
    /// Подсказка над микрофоном («Удерживайте…»), гаснет сама.
    private(set) var hint: VoiceRecordingMachine.Hint?
    /// Прослушивание остановленной записи.
    let preview = VoicePreviewPlayer()

    /// Куда отдать готовое голосовое. Ставит панель ввода.
    @ObservationIgnored var onSend: ((OutgoingAttachment) async -> Void)?
    /// «Записывает голосовое…» у собеседников.
    @ObservationIgnored var onAnnounce: ((Bool) -> Void)?

    @ObservationIgnored private var recorder: AVAudioRecorder?
    @ObservationIgnored private var meter: Task<Void, Never>?
    @ObservationIgnored private var hintTask: Task<Void, Never>?
    @ObservationIgnored private var fileURL: URL?
    /// Остановленная запись ждёт решения: прослушать, удалить, отправить.
    @ObservationIgnored private var stopped: OutgoingAttachment?
    @ObservationIgnored private var observers: [NSObjectProtocol] = []

    /// Сколько столбиков помещается в строку записи. Старые отбрасываем: волна
    /// должна ехать, а не сжиматься в кашу.
    private static let visibleBars = 40

    var phase: VoiceRecordingMachine.Phase { machine.phase }

    init() {
        let center = NotificationCenter.default
        // Звонок, Siri, будильник: запись останавливается, но не теряется и не уходит
        // сама — остаётся на прослушивание.
        observers.append(center.addObserver(
            forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { [weak self] note in
            guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                AVAudioSession.InterruptionType(rawValue: raw) == .began
            else { return }
            MainActor.assumeIsolated { self?.interrupt() }
        })
        // Без фонового режима аудио система заглушит микрофон в фоне — останавливаем
        // сами, пока файл ещё цел.
        observers.append(center.addObserver(
            forName: UIApplication.willResignActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.interrupt() }
        })
    }

    deinit {
        observers.forEach(NotificationCenter.default.removeObserver)
    }

    // MARK: События

    func send(_ event: VoiceRecordingMachine.Event) {
        let effects = machine.handle(event)
        for effect in effects { perform(effect) }
    }

    /// Нажатие на микрофон: разрешение решает, начнётся ли запись сразу.
    func press() {
        send(.press(Self.permission))
    }

    func drag(_ offset: CGSize) { send(.drag(offset)) }
    func release() { send(.release(duration: currentDuration)) }
    func touchCancelled() { send(.touchCancelled(duration: currentDuration)) }
    func stop() { send(.tapStop(duration: currentDuration)) }
    func sendNow() { send(.tapSend) }
    func delete() { send(.tapDelete) }
    func dismissFailure() { send(.dismissFailure) }

    private func interrupt() {
        guard machine.isRecording else { return }
        send(.interrupted(duration: currentDuration))
    }

    private var currentDuration: TimeInterval {
        recorder?.currentTime ?? duration
    }

    private static var permission: VoiceRecordingMachine.Event.Permission {
        switch AVAudioApplication.shared.recordPermission {
        case .granted: return .granted
        case .denied: return .denied
        default: return .undetermined
        }
    }

    // MARK: Исполнение

    private func perform(_ effect: VoiceRecordingMachine.Effect) {
        switch effect {
        case .requestPermission:
            AVAudioApplication.requestRecordPermission { granted in
                Task { @MainActor [weak self] in
                    self?.send(.permissionResolved(granted: granted))
                }
            }
        case .startRecording:
            if !startRecording() { send(.recordingFailed) }
        case .finishRecording(let thenSend):
            guard let file = finishRecording() else {
                if thenSend { send(.prepared(ok: false)) } else { send(.tapDelete) }
                return
            }
            if thenSend {
                deliver(file)
            } else {
                stopped = file
                if let path = file.cachedPath { preview.load(URL(filePath: path), duration: duration) }
            }
        case .sendStopped:
            preview.stop()
            guard let file = stopped else {
                send(.prepared(ok: false))
                return
            }
            stopped = nil
            deliver(file)
        case .discardRecording:
            discard()
        case .haptic(let kind):
            Self.play(kind)
        case .showHint(let hint):
            show(hint)
        case .announce(let on):
            onAnnounce?(on)
        }
    }

    private func deliver(_ file: OutgoingAttachment) {
        send(.prepared(ok: true))
        levels = []
        envelope = []
        duration = 0
        let onSend = onSend
        Task { @MainActor [weak self] in
            await onSend?(file)
            self?.send(.uploadFinished)
        }
    }

    private func startRecording() -> Bool {
        // Микрофон и динамик сразу — играющее голосовое попало бы в запись.
        VoicePlayer.pauseActive()
        preview.stop()

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("voice-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]
        do {
            let session = AVAudioSession.sharedInstance()
            // Динамик, а не разговорный: прослушивание записи иначе шло бы в ухо.
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true)
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder.isMeteringEnabled = true
            guard recorder.record() else { return false }
            self.recorder = recorder
            fileURL = url
            levels = []
            envelope = []
            duration = 0
            startMetering()
            return true
        } catch {
            return false
        }
    }

    /// Остановить и отдать файл. `nil` — записи не было или она пустая.
    private func finishRecording() -> OutgoingAttachment? {
        meter?.cancel()
        meter = nil
        if let recorder {
            duration = recorder.currentTime
            recorder.stop()
        }
        recorder = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        guard let url = fileURL,
            let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue,
            size > 0
        else {
            discard()
            return nil
        }
        fileURL = nil
        return OutgoingAttachment(
            data: try? Data(contentsOf: url),
            mime: "audio/m4a",
            name: url.lastPathComponent,
            width: nil,
            height: nil,
            cachedPath: url.path
        )
    }

    /// Отменить: файл удаляем сразу — недописанное голосовое не нужно никому.
    private func discard() {
        meter?.cancel()
        meter = nil
        recorder?.stop()
        recorder = nil
        preview.stop()
        if let fileURL { try? FileManager.default.removeItem(at: fileURL) }
        if let path = stopped?.cachedPath { try? FileManager.default.removeItem(atPath: path) }
        fileURL = nil
        stopped = nil
        levels = []
        envelope = []
        duration = 0
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func startMetering() {
        meter = Task { @MainActor [weak self] in
            while !Task.isCancelled, let self, let recorder = self.recorder, recorder.isRecording {
                recorder.updateMeters()
                // Децибелы от -160 до 0 переводим в 0…1: иначе тихая речь — это
                // почти нулевая высота столбика.
                let power = recorder.averagePower(forChannel: 0)
                let level = max(0, min(1, (power + 50) / 50))
                self.levels.append(level)
                if self.levels.count > Self.visibleBars {
                    self.levels.removeFirst(self.levels.count - Self.visibleBars)
                }
                self.envelope.append(level)
                self.duration = recorder.currentTime
                try? await Task.sleep(for: .milliseconds(50))
            }
        }
    }

    private func show(_ hint: VoiceRecordingMachine.Hint) {
        hintTask?.cancel()
        self.hint = hint
        hintTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            self?.hint = nil
        }
    }

    private static func play(_ haptic: VoiceRecordingMachine.Haptic) {
        switch haptic {
        case .start: UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        case .lock: UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
        case .cancel: UINotificationFeedbackGenerator().notificationOccurred(.warning)
        case .send: UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
    }
}

/// Прослушивание своей записи до отправки — локальный файл, свой проигрыватель: общий
/// `VoicePlayback` ведёт пузыри ленты и о черновике знать не должен.
@MainActor
@Observable
final class VoicePreviewPlayer: NSObject, AVAudioPlayerDelegate {
    private(set) var isPlaying = false
    private(set) var progress: Double = 0
    private(set) var duration: TimeInterval = 0

    @ObservationIgnored private var player: AVAudioPlayer?
    @ObservationIgnored private var ticker: Task<Void, Never>?

    func load(_ url: URL, duration: TimeInterval) {
        stop()
        player = try? AVAudioPlayer(contentsOf: url)
        player?.delegate = self
        player?.prepareToPlay()
        self.duration = player?.duration ?? duration
        progress = 0
    }

    func toggle() {
        guard let player else { return }
        if player.isPlaying {
            player.pause()
            isPlaying = false
            ticker?.cancel()
        } else {
            VoicePlayer.pauseActive()
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
            try? AVAudioSession.sharedInstance().setActive(true)
            player.play()
            isPlaying = true
            tick()
        }
    }

    func seek(to fraction: Double) {
        guard let player else { return }
        player.currentTime = player.duration * min(max(fraction, 0), 1)
        progress = fraction
    }

    func stop() {
        ticker?.cancel()
        player?.stop()
        player = nil
        isPlaying = false
        progress = 0
    }

    private func tick() {
        ticker?.cancel()
        ticker = Task { @MainActor [weak self] in
            while !Task.isCancelled, let self, let player = self.player, player.isPlaying {
                self.progress = player.duration > 0 ? player.currentTime / player.duration : 0
                try? await Task.sleep(for: .milliseconds(50))
            }
        }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor [weak self] in
            self?.isPlaying = false
            self?.progress = 0
            self?.ticker?.cancel()
        }
    }
}
