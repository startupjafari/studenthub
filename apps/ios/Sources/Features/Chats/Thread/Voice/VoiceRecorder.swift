import AVFoundation
import Foundation
import Observation
import UIKit

/// Запись голосового сообщения: исполняет решения `VoiceRecordingMachine`.
///
/// Пишем сразу в файл, а не в память: минута речи — это мегабайт, и держать её в
/// процессе незачем. Имя файла начинается с `voice-` — по нему и сервер, и веб
/// узнают голосовое: отдельного типа сообщения в модели нет (PROJECT.md §9.1a).
///
/// Сессия звука и рекордер живут на своей очереди (`VoiceAudio`): здесь — только
/// состояние и решения. Жест ведёт запись с первого касания, а звук пойдёт в файл,
/// когда сессия включится.
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

    /// Идущая запись: файл и — когда сессия включилась — рекордер.
    @ObservationIgnored private var take: VoiceTake?
    @ObservationIgnored private var meter: Task<Void, Never>?
    @ObservationIgnored private var hintTask: Task<Void, Never>?
    /// Остановленная запись ждёт решения: прослушать, удалить, отправить.
    @ObservationIgnored private var stopped: OutgoingAttachment?
    /// Остановка дописывает файл на очереди звука; «отправить» из прослушивания ждёт её,
    /// а не считает запись пустой.
    @ObservationIgnored private var finishing: Task<Void, Never>?
    /// Когда палец лёг на микрофон: долгое удержание без звука — не «короткое касание».
    @ObservationIgnored private var pressedAt: Date?
    /// Каждая новая запись и каждая отмена — новое поколение: запоздавший конец
    /// прежней не трогает текущую.
    @ObservationIgnored private var generation = 0
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
        // сами, пока файл ещё цел. Именно уход в фон, а не потеря активности: шторка
        // уведомлений или пункт управления поверх чата запись не обрывают, как и в
        // Telegram.
        observers.append(center.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
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
        pressedAt = Date()
        send(.press(Self.permission))
    }

    func drag(_ offset: CGSize) { send(.drag(offset)) }
    func release() {
        let held = pressedAt.map { Date().timeIntervalSince($0) } ?? 0
        send(.release(duration: currentDuration, held: held))
    }
    func touchCancelled() { send(.touchCancelled(duration: currentDuration)) }
    func stop() { send(.tapStop(duration: currentDuration)) }
    func sendNow() { send(.tapSend) }
    func delete() { send(.tapDelete) }
    func dismissFailure() { send(.dismissFailure) }
    /// Панель ввода ушла: незаконченное не уходит само и не держит микрофон.
    func abandon() { send(.abandon) }

    private func interrupt() {
        guard machine.isRecording else { return }
        send(.interrupted(duration: currentDuration))
    }

    /// Сколько записано. Пока сессия включается, рекордера ещё нет — ноль, и отпускание
    /// в это время считается касанием, а не голосовым. Прерванный системой рекордер
    /// сбрасывает своё время в ноль — тогда верим последнему замеру: иначе голосовое,
    /// оборванное звонком, считалось бы пустым и удалялось.
    private var currentDuration: TimeInterval {
        guard let take else { return duration }
        return max(take.recorder?.currentTime ?? 0, duration)
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
            startRecording()
        case .finishRecording(let thenSend):
            finishRecording(thenSend: thenSend)
        case .sendStopped:
            sendStopped()
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
        // Прослушивание могло включить сессию на проигрывание — отпускаем её.
        VoiceAudio.shared.relinquish()
        let onSend = onSend
        Task { @MainActor [weak self] in
            await onSend?(file)
            self?.send(.uploadFinished)
        }
    }

    /// Запись начинается сразу: фаза уже «идёт запись», а сессию и рекордер включает
    /// очередь звука. Раньше это делалось здесь же, на главной очереди, и после
    /// проигрывания голосового занимало до пары секунд: экран замирал под пальцем, а
    /// отпускание доходило уже до только что начатой записи — вместо голосового
    /// «Удерживайте, чтобы записать».
    private func startRecording() {
        // Микрофон и динамик сразу — играющее голосовое попало бы в запись.
        VoicePlayer.pauseActive()
        preview.stop()
        stopMetering()

        generation += 1
        let take = VoiceTake(url: FileManager.default.temporaryDirectory
            .appendingPathComponent("voice-\(UUID().uuidString).m4a"))
        self.take = take
        levels = []
        envelope = []
        duration = 0

        Task { @MainActor [weak self] in
            let started = await VoiceAudio.shared.start(take)
            // Запись уже остановлена или отменена — рекордер разберёт очередь звука:
            // остановка встала в неё следом за запуском.
            guard let self, self.take === take else { return }
            if started {
                self.startMetering(take)
            } else if !take.isCancelled {
                self.send(.recordingFailed)
            }
        }
    }

    /// Остановить запись. Файл дописывается на очереди звука; отправка или
    /// прослушивание — когда он закрыт и проверен.
    private func finishRecording(thenSend: Bool) {
        let recorded = currentDuration
        stopMetering()
        let take = take
        self.take = nil
        duration = recorded
        let generation = generation

        finishing = Task { @MainActor [weak self] in
            var result: VoiceTakeResult?
            var file: OutgoingAttachment?
            if let take, let finished = await VoiceAudio.shared.finish(take) {
                result = finished
                file = Self.attachment(at: take.url)
            }
            guard let self else { return }
            if thenSend {
                if let file { self.deliver(file) } else { self.send(.prepared(ok: false)) }
                return
            }
            // Пока файл дописывался, запись могли удалить — тогда он никому не нужен.
            guard generation == self.generation else {
                if let path = file?.cachedPath { try? FileManager.default.removeItem(atPath: path) }
                return
            }
            guard let file, let path = file.cachedPath else {
                self.send(.prepared(ok: false))
                return
            }
            self.stopped = file
            if let seconds = result?.duration, seconds > 0 { self.duration = seconds }
            self.preview.load(URL(filePath: path), duration: self.duration)
        }
    }

    /// «Отправить» из прослушивания. Если файл ещё дописывается — ждём его, а не
    /// считаем запись пустой.
    private func sendStopped() {
        preview.stop()
        let pending = finishing
        Task { @MainActor [weak self] in
            await pending?.value
            guard let self else { return }
            guard let file = self.stopped else {
                self.send(.prepared(ok: false))
                return
            }
            self.stopped = nil
            self.deliver(file)
        }
    }

    private static func attachment(at url: URL) -> OutgoingAttachment {
        // Тело не читаем в память: загрузчик берёт файл с диска (`cachedPath`), а
        // размер — из его атрибутов.
        OutgoingAttachment(
            data: nil,
            mime: "audio/m4a",
            name: url.lastPathComponent,
            width: nil,
            height: nil,
            cachedPath: url.path
        )
    }

    /// Отменить: файл удаляем сразу — недописанное голосовое не нужно никому.
    private func discard() {
        generation += 1
        stopMetering()
        if let take {
            VoiceAudio.shared.discard(take)
        } else {
            VoiceAudio.shared.relinquish()
        }
        take = nil
        preview.stop()
        if let path = stopped?.cachedPath { try? FileManager.default.removeItem(atPath: path) }
        stopped = nil
        levels = []
        envelope = []
        duration = 0
    }

    private func startMetering(_ take: VoiceTake) {
        meter?.cancel()
        meter = Task { @MainActor [weak self] in
            while !Task.isCancelled, let self, self.take === take,
                let recorder = take.recorder, recorder.isRecording
            {
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

    private func stopMetering() {
        meter?.cancel()
        meter = nil
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

// MARK: - Очередь звука

/// Одна запись: файл и рекордер. Её видят главная очередь (уровни, время) и очередь
/// звука (запуск, остановка), поэтому рекордер и флаг отмены — под замком.
final class VoiceTake: @unchecked Sendable {
    let url: URL
    private let lock = NSLock()
    private var cancelled = false
    private var current: AVAudioRecorder?

    init(url: URL) {
        self.url = url
    }

    var isCancelled: Bool { lock.withLock { cancelled } }

    func cancel() { lock.withLock { cancelled = true } }

    /// Рекордер появляется, когда сессия включилась и запись пошла.
    var recorder: AVAudioRecorder? {
        get { lock.withLock { current } }
        set { lock.withLock { current = newValue } }
    }
}

/// Итог остановки: файл дописан и не пустой. Длительность — из самого файла, если
/// его удалось прочитать.
struct VoiceTakeResult: Sendable {
    let duration: TimeInterval?
}

/// Сессия звука и рекордер — на своей последовательной очереди, не на главной.
///
/// `setCategory`, `setActive` и первый `record()` занимают от десятков миллисекунд до
/// пары секунд: смена маршрута после проигрывания голосового, холодный микрофон. На
/// главной очереди это замораживало экран под пальцем. Очередь последовательная:
/// запуск, остановка и выключение сессии идут строго по порядку, сколько бы касаний ни
/// пришло подряд, — остановка всегда застаёт уже запущенный рекордер.
final class VoiceAudio: @unchecked Sendable {
    static let shared = VoiceAudio()

    private let queue = DispatchQueue(label: "studenthub.voice-audio", qos: .userInitiated)
    /// Сколько записей держат сессию. Только на очереди.
    private var holders = 0
    /// Поколение отложенного выключения: новое включение отменяет прежнее. Только на
    /// очереди.
    private var epoch = 0

    private static let settings: [String: Any] = [
        AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
        AVSampleRateKey: 44_100,
        AVNumberOfChannelsKey: 1,
        AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
    ]

    /// Включить сессию и начать запись. `false` — микрофон недоступен или запись уже
    /// отменили, пока сессия включалась (`VoiceTake.isCancelled` различает).
    func start(_ take: VoiceTake) async -> Bool {
        await withCheckedContinuation { continuation in
            queue.async {
                continuation.resume(returning: self.begin(take))
            }
        }
    }

    /// Остановить и проверить файл. `nil` — записи не было или файл пустой (тогда он
    /// удалён).
    func finish(_ take: VoiceTake) async -> VoiceTakeResult? {
        await withCheckedContinuation { continuation in
            queue.async {
                continuation.resume(returning: self.end(take, keep: true))
            }
        }
    }

    /// Отмена: остановить и удалить файл. Запуск, ещё ждущий в очереди, увидит флаг и
    /// не начнёт запись вовсе.
    func discard(_ take: VoiceTake) {
        take.cancel()
        queue.async {
            _ = self.end(take, keep: false)
        }
    }

    /// Сессия больше не нужна записи (прослушивание закончено, голосовое ушло).
    func relinquish() {
        queue.async {
            self.scheduleDeactivation()
        }
    }

    /// Прослушивание своей записи: проигрывание, а не запись — наушники и громкий
    /// динамик как у голосовых в ленте.
    func activatePlayback() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            queue.async {
                self.epoch += 1
                let session = AVAudioSession.sharedInstance()
                if session.category != .playback || session.mode != .spokenAudio {
                    try? session.setCategory(.playback, mode: .spokenAudio)
                }
                try? session.setActive(true)
                continuation.resume()
            }
        }
    }

    // MARK: На очереди

    private func begin(_ take: VoiceTake) -> Bool {
        guard !take.isCancelled else { return false }
        epoch += 1
        do {
            let session = AVAudioSession.sharedInstance()
            // Категорию меняем, только если она другая: повторная установка той же
            // всё равно перестраивает маршрут.
            if session.category != .playAndRecord || session.mode != .default
                || !session.categoryOptions.contains(.defaultToSpeaker)
            {
                // Динамик, а не разговорный: прослушивание записи иначе шло бы в ухо.
                try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            }
            try session.setActive(true)
            // Палец отпустили, пока включалась сессия, — файл уже не нужен.
            guard !take.isCancelled else {
                scheduleDeactivation()
                return false
            }
            let recorder = try AVAudioRecorder(url: take.url, settings: Self.settings)
            recorder.isMeteringEnabled = true
            guard recorder.prepareToRecord(), !take.isCancelled, recorder.record() else {
                recorder.stop()
                try? FileManager.default.removeItem(at: take.url)
                scheduleDeactivation()
                return false
            }
            take.recorder = recorder
            holders += 1
            return true
        } catch {
            try? FileManager.default.removeItem(at: take.url)
            scheduleDeactivation()
            return false
        }
    }

    private func end(_ take: VoiceTake, keep: Bool) -> VoiceTakeResult? {
        defer { scheduleDeactivation() }
        guard let recorder = take.recorder else {
            try? FileManager.default.removeItem(at: take.url)
            return nil
        }
        take.recorder = nil
        // `stop()` закрывает файл: после возврата он дописан целиком.
        recorder.stop()
        holders = max(0, holders - 1)
        let attributes = try? FileManager.default.attributesOfItem(atPath: take.url.path)
        let size = (attributes?[.size] as? NSNumber)?.intValue ?? 0
        guard keep, size > 0 else {
            try? FileManager.default.removeItem(at: take.url)
            return nil
        }
        let file = try? AVAudioFile(forReading: take.url)
        let duration = file.flatMap { file -> TimeInterval? in
            let rate = file.fileFormat.sampleRate
            return rate > 0 ? Double(file.length) / rate : nil
        }
        return VoiceTakeResult(duration: duration)
    }

    /// Сессию гасим не сразу: следующее голосовое подряд не ждёт её повторного
    /// включения, а музыка других приложений вернётся через секунду. Если сессию уже
    /// взяло проигрывание (категория сменилась) — не трогаем: выключение оборвало бы
    /// звук.
    private func scheduleDeactivation() {
        guard holders == 0 else { return }
        epoch += 1
        let mine = epoch
        queue.asyncAfter(deadline: .now() + 1) {
            guard self.holders == 0, self.epoch == mine else { return }
            let session = AVAudioSession.sharedInstance()
            guard session.category == .playAndRecord else { return }
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
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
        // По своему флагу, а не по `player.isPlaying`: пока сессия переключается на
        // проигрывание, плеер ещё молчит, и второе касание запускало бы его повторно.
        if isPlaying {
            player.pause()
            isPlaying = false
            ticker?.cancel()
        } else {
            VoicePlayer.pauseActive()
            isPlaying = true
            // Сессию переключает очередь звука: смена категории после записи на главной
            // очереди подвешивала экран.
            Task { @MainActor [weak self] in
                await VoiceAudio.shared.activatePlayback()
                guard let self, self.isPlaying, self.player === player else { return }
                player.play()
                self.tick()
            }
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
