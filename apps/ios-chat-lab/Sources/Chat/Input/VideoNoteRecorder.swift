import AVFoundation
import UIKit

/// Запись видеосообщения: фронтальная камера (+ микрофон, если разрешён) в .mov, затем
/// перепаковка в .mp4 без перекодирования. Сессия живёт на своей очереди — запуск камеры
/// не держит главный поток.
final class VideoNoteRecorder: NSObject, AVCaptureFileOutputRecordingDelegate, @unchecked Sendable {
    let session = AVCaptureSession()
    private let output = AVCaptureMovieFileOutput()
    private let queue = DispatchQueue(label: "ChatLab.videoNote.session", qos: .userInitiated)
    private var configuredWithAudio: Bool?
    private var discardCurrent = false
    private var startedAt: Date?

    /// Готовое видеосообщение (или nil при ошибке/отмене). Главный поток.
    var onFinish: (@MainActor (MediaRef?) -> Void)?

    private(set) lazy var previewLayer: AVCaptureVideoPreviewLayer = {
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        return layer
    }()

    static var isCameraAvailable: Bool {
        AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) != nil
    }

    func start(includeAudio: Bool, maxDuration: Double) {
        discardCurrent = false
        queue.async { [self] in
            if configuredWithAudio != includeAudio { configure(includeAudio: includeAudio) }
            output.maxRecordedDuration = CMTime(seconds: maxDuration, preferredTimescale: 600)
            if !session.isRunning { session.startRunning() }
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("round_\(UUID().uuidString).mov")
            if let connection = output.connection(with: .video), connection.isVideoMirroringSupported {
                connection.isVideoMirrored = true
            }
            startedAt = Date()
            output.startRecording(to: url, recordingDelegate: self)
        }
    }

    private func configure(includeAudio: Bool) {
        session.beginConfiguration()
        session.sessionPreset = .high
        session.inputs.forEach { session.removeInput($0) }
        if let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front),
           let input = try? AVCaptureDeviceInput(device: camera), session.canAddInput(input) {
            session.addInput(input)
        }
        if includeAudio, let mic = AVCaptureDevice.default(for: .audio),
           let input = try? AVCaptureDeviceInput(device: mic), session.canAddInput(input) {
            session.addInput(input)
        }
        if !session.outputs.contains(output), session.canAddOutput(output) {
            session.addOutput(output)
        }
        session.commitConfiguration()
        configuredWithAudio = includeAudio
    }

    func stop(discard: Bool) {
        queue.async { [self] in
            discardCurrent = discard
            if output.isRecording {
                output.stopRecording()
            } else {
                session.stopRunning()
                if discard { deliver(nil) }
            }
        }
    }

    // MARK: AVCaptureFileOutputRecordingDelegate

    func fileOutput(_ output: AVCaptureFileOutput, didFinishRecordingTo outputFileURL: URL, from connections: [AVCaptureConnection], error: Error?) {
        queue.async { [self] in session.stopRunning() }
        // Достигнут предел длительности — тоже успешная запись.
        let reachedLimit = (error as NSError?)?.userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool ?? false
        if discardCurrent || (error != nil && !reachedLimit) {
            try? FileManager.default.removeItem(at: outputFileURL)
            deliver(nil)
            return
        }
        Task.detached(priority: .userInitiated) { [self] in
            let media = await Self.export(outputFileURL)
            try? FileManager.default.removeItem(at: outputFileURL)
            deliver(media)
        }
    }

    private func deliver(_ media: MediaRef?) {
        DispatchQueue.main.async { [self] in
            MainActor.assumeIsolated {
                let handler = onFinish
                onFinish = nil
                handler?(media)
            }
        }
    }

    /// .mov → .mp4 в каталог медиа без перекодирования.
    static func export(_ source: URL) async -> MediaRef? {
        let asset = AVURLAsset(url: source)
        let name = MediaStorage.makeUserFileName(extension: "mp4")
        let destination = MediaStorage.url(for: name)
        try? FileManager.default.createDirectory(at: MediaStorage.directory, withIntermediateDirectories: true)
        guard let exporter = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough) else { return nil }
        do {
            try await exporter.export(to: destination, as: .mp4)
            let duration = try await asset.load(.duration).seconds
            let size = (try? FileManager.default.attributesOfItem(atPath: destination.path)[.size] as? NSNumber)?.int64Value
            return MediaRef(
                file: name, width: 384, height: 384, duration: duration.isFinite ? duration : 0,
                waveform: nil, fileName: nil, fileSize: size, mimeType: "video/mp4"
            )
        } catch {
            NSLog("ChatLab: не удалось сохранить кружок: \(error)")
            return nil
        }
    }
}
