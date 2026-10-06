import AVFoundation
import Foundation
import Observation

/// Запись голосового сообщения.
///
/// Пишем сразу в файл, а не в память: минута речи — это мегабайт, и держать её в
/// процессе незачем. Имя файла начинается с `voice-` — по нему и сервер, и веб
/// узнают голосовое: отдельного типа сообщения в модели нет (PROJECT.md §9.1a).
@Observable
final class VoiceRecorder {
    private(set) var isRecording = false
    /// Уровни сигнала для волны. Это настоящие показания микрофона, а не узор:
    /// по ним видно, записался ли звук вообще.
    private(set) var levels: [Float] = []
    private(set) var duration: TimeInterval = 0

    private var recorder: AVAudioRecorder?
    private var meter: Task<Void, Never>?
    private var fileURL: URL?

    /// Сколько столбиков помещается в строку ввода. Старые отбрасываем: волна
    /// должна ехать, а не сжиматься в кашу.
    private static let visibleBars = 48

    @MainActor
    func start() async -> Bool {
        guard await requestPermission() else { return false }

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("voice-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]

        do {
            try AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .default)
            try AVAudioSession.sharedInstance().setActive(true)
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder.isMeteringEnabled = true
            guard recorder.record() else { return false }
            self.recorder = recorder
            fileURL = url
            isRecording = true
            levels = []
            duration = 0
            startMetering()
            return true
        } catch {
            return false
        }
    }

    /// Остановить и отдать файл. `nil` — записи не было или она пустая.
    @MainActor
    func stop() -> OutgoingAttachment? {
        meter?.cancel()
        meter = nil
        recorder?.stop()
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false)

        guard
            let url = fileURL,
            let data = try? Data(contentsOf: url),
            !data.isEmpty,
            duration >= 0.4
        else {
            cancel()
            return nil
        }
        recorder = nil
        fileURL = nil
        return OutgoingAttachment(
            data: data,
            mime: "audio/m4a",
            name: url.lastPathComponent,
            width: nil,
            height: nil,
            cachedPath: url.path
        )
    }

    /// Отменить: файл удаляем сразу — недописанное голосовое не нужно никому.
    @MainActor
    func cancel() {
        meter?.cancel()
        meter = nil
        recorder?.stop()
        recorder = nil
        isRecording = false
        if let fileURL { try? FileManager.default.removeItem(at: fileURL) }
        fileURL = nil
        levels = []
        duration = 0
        try? AVAudioSession.sharedInstance().setActive(false)
    }

    @MainActor
    private func startMetering() {
        meter = Task { @MainActor [weak self] in
            while !Task.isCancelled, let recorder = self?.recorder, recorder.isRecording {
                recorder.updateMeters()
                // Децибелы от -160 до 0 переводим в 0…1: иначе тихая речь — это
                // почти нулевая высота столбика.
                let power = recorder.averagePower(forChannel: 0)
                let level = max(0, min(1, (power + 50) / 50))
                self?.levels.append(level)
                if let count = self?.levels.count, count > VoiceRecorder.visibleBars {
                    self?.levels.removeFirst(count - VoiceRecorder.visibleBars)
                }
                self?.duration = recorder.currentTime
                try? await Task.sleep(for: .milliseconds(50))
            }
        }
    }

    private func requestPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }
}
