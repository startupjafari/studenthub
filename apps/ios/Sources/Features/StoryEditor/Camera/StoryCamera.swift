@preconcurrency import AVFoundation
import UIKit

/// Режим съёмки под кнопкой затвора. «Эфира» нет: у сервера нет трансляций, а кнопка
/// без действия хуже отсутствующей (ЧАСТЬ 2.2 задания — записано в отчёте).
enum StoryCaptureMode: String, CaseIterable, Identifiable, Sendable {
    case video
    case photo

    var id: String { rawValue }

    var title: String {
        switch self {
        case .video: return String(localized: "stories.camera.mode.video", defaultValue: "Видео")
        case .photo: return String(localized: "stories.camera.mode.photo", defaultValue: "Фото")
        }
    }
}

/// Вид кнопки затвора — по режиму и записи.
enum StoryShutterAppearance: Equatable, Sendable {
    /// Белый круг — фото.
    case photo
    /// Красный круг — готово к записи.
    case videoIdle
    /// Красный квадрат и кольцо прогресса — идёт запись.
    case recording

    init(mode: StoryCaptureMode, isRecording: Bool) {
        if isRecording {
            self = .recording
        } else {
            self = mode == .photo ? .photo : .videoIdle
        }
    }

    var accessibilityValue: String {
        switch self {
        case .photo: return "photo"
        case .videoIdle: return "video"
        case .recording: return "recording"
        }
    }
}

enum StoryFlashMode: String, CaseIterable, Sendable {
    case off
    case auto
    case on

    var next: StoryFlashMode {
        switch self {
        case .off: return .auto
        case .auto: return .on
        case .on: return .off
        }
    }

    var symbol: String {
        switch self {
        case .off: return "bolt.slash.fill"
        case .auto: return "bolt.badge.automatic.fill"
        case .on: return "bolt.fill"
        }
    }
}

enum StoryCameraPosition: Sendable {
    case back
    case front

    var avPosition: AVCaptureDevice.Position { self == .back ? .back : .front }
    var toggled: StoryCameraPosition { self == .back ? .front : .back }
}

enum StoryCameraError: LocalizedError {
    case unavailable
    case denied
    case captureFailed

    var errorDescription: String? {
        switch self {
        case .unavailable:
            return String(localized: "stories.camera.unavailable", defaultValue: "Камера недоступна на этом устройстве")
        case .denied:
            return String(localized: "stories.camera.denied", defaultValue: "Нет доступа к камере. Разрешите его в Настройках.")
        case .captureFailed:
            return String(localized: "stories.camera.failed", defaultValue: "Не удалось снять. Попробуйте ещё раз.")
        }
    }
}

/// Источник кадров для экрана камеры: настоящая камера или имитация в тестах и на
/// симуляторе. Экран и модель не знают, какая из них работает.
@MainActor
protocol StoryCameraSource: AnyObject {
    /// Вид предпросмотра. Один на всё время экрана: при смене камеры он не пересоздаётся.
    var previewView: UIView { get }
    var position: StoryCameraPosition { get }
    var hasFlash: Bool { get }
    var isRunning: Bool { get }

    func start(position: StoryCameraPosition) async throws
    func stop()
    func switchCamera() async
    func setFlash(_ mode: StoryFlashMode)
    func focus(at point: CGPoint)
    func zoom(by factor: CGFloat, began: Bool)
    /// Снимок, ориентированный вертикально, уже зеркальный для фронтальной камеры.
    func capturePhoto() async throws -> UIImage
    /// Запись — в `url`. Микрофон включается при первой записи.
    func startRecording(to url: URL) async throws
    func stopRecording() async throws -> URL
}

/// Настоящая камера.
///
/// Сессия настраивается и запускается на своей очереди: `startRunning` блокирует поток
/// на сотни миллисекунд, на главном это видно как замерший экран при открытии.
@MainActor
final class StoryCaptureController: NSObject, StoryCameraSource {
    let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "studenthub.story.camera", qos: .userInitiated)
    private let photoOutput = AVCapturePhotoOutput()
    private let movieOutput = AVCaptureMovieFileOutput()
    private var videoInput: AVCaptureDeviceInput?
    private var audioInput: AVCaptureDeviceInput?
    private var configured = false
    private(set) var position: StoryCameraPosition = .back
    private var flash: StoryFlashMode = .off
    private var photoDelegate: StoryPhotoCaptureDelegate?
    private var recordingDelegate: StoryRecordingDelegate?
    private var zoomStart: CGFloat = 1
    private let preview = StoryCapturePreviewView()

    var previewView: UIView { preview }
    var isRunning: Bool { session.isRunning }

    var hasFlash: Bool { videoInput?.device.hasFlash ?? false }

    static var isAvailable: Bool {
        AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) != nil
            || AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) != nil
    }

    override init() {
        super.init()
        preview.previewLayer.session = session
        preview.previewLayer.videoGravity = .resizeAspectFill
    }

    func start(position: StoryCameraPosition) async throws {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            break
        case .notDetermined:
            guard await AVCaptureDevice.requestAccess(for: .video) else { throw StoryCameraError.denied }
        default:
            throw StoryCameraError.denied
        }
        guard Self.isAvailable else { throw StoryCameraError.unavailable }
        self.position = position
        let session = session
        let photoOutput = photoOutput
        let movieOutput = movieOutput
        let needsConfiguration = !configured
        configured = true
        let input: AVCaptureDeviceInput? = try await withCheckedThrowingContinuation { continuation in
            sessionQueue.async {
                var added: AVCaptureDeviceInput?
                if needsConfiguration {
                    session.beginConfiguration()
                    session.sessionPreset = .high
                    if let device = Self.device(for: position), let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) {
                        session.addInput(input)
                        added = input
                    }
                    if session.canAddOutput(photoOutput) {
                        session.addOutput(photoOutput)
                        photoOutput.maxPhotoQualityPrioritization = .balanced
                    }
                    if session.canAddOutput(movieOutput) {
                        session.addOutput(movieOutput)
                        movieOutput.maxRecordedDuration = CMTime(seconds: StoryRoundVideoPayload.maxDuration, preferredTimescale: 600)
                    }
                    session.commitConfiguration()
                }
                if !session.isRunning { session.startRunning() }
                continuation.resume(returning: added)
            }
        }
        if let input { videoInput = input }
        if videoInput == nil { throw StoryCameraError.unavailable }
        if needsConfiguration, position != .back || videoInput?.device.position != position.avPosition {
            await reconfigure(to: position)
        }
        applyConnections()
    }

    func stop() {
        let session = session
        sessionQueue.async {
            if session.isRunning { session.stopRunning() }
        }
    }

    func switchCamera() async {
        await reconfigure(to: position.toggled)
    }

    private func reconfigure(to newPosition: StoryCameraPosition) async {
        guard let device = Self.device(for: newPosition), let input = try? AVCaptureDeviceInput(device: device) else { return }
        let session = session
        let old = videoInput
        let swapped: Bool = await withCheckedContinuation { continuation in
            sessionQueue.async {
                session.beginConfiguration()
                if let old { session.removeInput(old) }
                var ok = false
                if session.canAddInput(input) {
                    session.addInput(input)
                    ok = true
                } else if let old, session.canAddInput(old) {
                    session.addInput(old)
                }
                session.commitConfiguration()
                continuation.resume(returning: ok)
            }
        }
        if swapped {
            videoInput = input
            position = newPosition
            applyConnections()
        }
    }

    /// Вертикальная ориентация и зеркало фронтальной камеры — у снимка и записи так же,
    /// как в предпросмотре: человек получает то, что видел.
    private func applyConnections() {
        let mirrored = position == .front
        for connection in [photoOutput.connection(with: .video), movieOutput.connection(with: .video)].compactMap({ $0 }) {
            if connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
            if connection.isVideoMirroringSupported {
                connection.automaticallyAdjustsVideoMirroring = false
                connection.isVideoMirrored = mirrored
            }
        }
        if let connection = preview.previewLayer.connection, connection.isVideoRotationAngleSupported(90) {
            connection.videoRotationAngle = 90
        }
    }

    func setFlash(_ mode: StoryFlashMode) {
        flash = mode
    }

    func focus(at point: CGPoint) {
        guard let device = videoInput?.device else { return }
        let devicePoint = preview.previewLayer.captureDevicePointConverted(fromLayerPoint: point)
        sessionQueue.async {
            guard (try? device.lockForConfiguration()) != nil else { return }
            if device.isFocusPointOfInterestSupported, device.isFocusModeSupported(.autoFocus) {
                device.focusPointOfInterest = devicePoint
                device.focusMode = .autoFocus
            }
            if device.isExposurePointOfInterestSupported, device.isExposureModeSupported(.autoExpose) {
                device.exposurePointOfInterest = devicePoint
                device.exposureMode = .autoExpose
            }
            device.unlockForConfiguration()
        }
    }

    func zoom(by factor: CGFloat, began: Bool) {
        guard let device = videoInput?.device else { return }
        if began { zoomStart = device.videoZoomFactor }
        let target = min(max(zoomStart * factor, device.minAvailableVideoZoomFactor), min(device.maxAvailableVideoZoomFactor, 10))
        sessionQueue.async {
            guard (try? device.lockForConfiguration()) != nil else { return }
            device.videoZoomFactor = target
            device.unlockForConfiguration()
        }
    }

    func capturePhoto() async throws -> UIImage {
        let settings = AVCapturePhotoSettings()
        if photoOutput.supportedFlashModes.contains(flash.avMode) { settings.flashMode = flash.avMode }
        let data: Data = try await withCheckedThrowingContinuation { continuation in
            let delegate = StoryPhotoCaptureDelegate { result in continuation.resume(with: result) }
            photoDelegate = delegate
            photoOutput.capturePhoto(with: settings, delegate: delegate)
        }
        photoDelegate = nil
        guard let image = UIImage(data: data) else { throw StoryCameraError.captureFailed }
        return image
    }

    func startRecording(to url: URL) async throws {
        await ensureAudio()
        if flash == .on, let device = videoInput?.device, device.hasTorch {
            sessionQueue.async {
                guard (try? device.lockForConfiguration()) != nil else { return }
                device.torchMode = .on
                device.unlockForConfiguration()
            }
        }
        applyConnections()
        let delegate = StoryRecordingDelegate()
        recordingDelegate = delegate
        movieOutput.startRecording(to: url, recordingDelegate: delegate)
    }

    func stopRecording() async throws -> URL {
        guard let delegate = recordingDelegate else { throw StoryCameraError.captureFailed }
        if movieOutput.isRecording { movieOutput.stopRecording() }
        let url = try await delegate.finished()
        recordingDelegate = nil
        if let device = videoInput?.device, device.hasTorch, device.torchMode != .off {
            sessionQueue.async {
                guard (try? device.lockForConfiguration()) != nil else { return }
                device.torchMode = .off
                device.unlockForConfiguration()
            }
        }
        return url
    }

    /// Микрофон добавляется в сессию только перед первой записью: для фото он не нужен,
    /// и системный запрос не должен всплывать при открытии камеры.
    private func ensureAudio() async {
        guard audioInput == nil else { return }
        if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
            _ = await AVCaptureDevice.requestAccess(for: .audio)
        }
        guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized,
              let mic = AVCaptureDevice.default(for: .audio),
              let input = try? AVCaptureDeviceInput(device: mic)
        else { return }
        let session = session
        let added: Bool = await withCheckedContinuation { continuation in
            sessionQueue.async {
                session.beginConfiguration()
                let ok = session.canAddInput(input)
                if ok { session.addInput(input) }
                session.commitConfiguration()
                continuation.resume(returning: ok)
            }
        }
        if added { audioInput = input }
    }

    private nonisolated static func device(for position: StoryCameraPosition) -> AVCaptureDevice? {
        let types: [AVCaptureDevice.DeviceType] = position == .back
            ? [.builtInTripleCamera, .builtInDualWideCamera, .builtInDualCamera, .builtInWideAngleCamera]
            : [.builtInTrueDepthCamera, .builtInWideAngleCamera]
        let discovery = AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: position.avPosition)
        return discovery.devices.first
    }
}

extension StoryFlashMode {
    var avMode: AVCaptureDevice.FlashMode {
        switch self {
        case .off: return .off
        case .auto: return .auto
        case .on: return .on
        }
    }
}

final class StoryCapturePreviewView: UIView {
    override static var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
}

private final class StoryPhotoCaptureDelegate: NSObject, AVCapturePhotoCaptureDelegate, @unchecked Sendable {
    private let completion: (Result<Data, Error>) -> Void
    private var finished = false

    init(completion: @escaping (Result<Data, Error>) -> Void) {
        self.completion = completion
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        guard !finished else { return }
        finished = true
        if let data = photo.fileDataRepresentation() {
            completion(.success(data))
        } else {
            completion(.failure(error ?? StoryCameraError.captureFailed))
        }
    }
}

private final class StoryRecordingDelegate: NSObject, AVCaptureFileOutputRecordingDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var result: Result<URL, Error>?
    private var waiter: CheckedContinuation<URL, Error>?

    func fileOutput(_ output: AVCaptureFileOutput, didFinishRecordingTo outputFileURL: URL, from connections: [AVCaptureConnection], error: Error?) {
        // «Достигнут предел длительности» — тоже успешная запись.
        let reachedLimit = (error as NSError?)?.userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool ?? false
        let outcome: Result<URL, Error> = error == nil || reachedLimit ? .success(outputFileURL) : .failure(error!)
        lock.lock()
        if let waiter {
            self.waiter = nil
            lock.unlock()
            waiter.resume(with: outcome)
        } else {
            result = outcome
            lock.unlock()
        }
    }

    func finished() async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            lock.lock()
            if let result {
                lock.unlock()
                continuation.resume(with: result)
            } else {
                waiter = continuation
                lock.unlock()
            }
        }
    }
}

/// Имитация камеры — для UI-тестов (mock API) и симулятора, где камеры нет.
///
/// Предпросмотр — живой градиент; снимок — картинка с номером кадра; запись —
/// настоящий MP4 нужной длины (AVAssetWriter), чтобы редактор видео работал по-честному.
@MainActor
final class StorySimulatedCamera: StoryCameraSource {
    private let preview = StorySimulatedPreviewView()
    private(set) var position: StoryCameraPosition = .back
    private(set) var isRunning = false
    private var shots = 0
    private var recordingURL: URL?
    private var recordingStarted: Date?

    var previewView: UIView { preview }
    var hasFlash: Bool { position == .back }

    func start(position: StoryCameraPosition) async throws {
        self.position = position
        preview.position = position
        isRunning = true
        preview.isAnimating = true
    }

    func stop() {
        isRunning = false
        preview.isAnimating = false
    }

    func switchCamera() async {
        position = position.toggled
        preview.position = position
    }

    func setFlash(_ mode: StoryFlashMode) {}
    func focus(at point: CGPoint) {}
    func zoom(by factor: CGFloat, began: Bool) {}

    func capturePhoto() async throws -> UIImage {
        shots += 1
        return Self.frame(index: shots, position: position, size: CGSize(width: 1080, height: 1920))
    }

    func startRecording(to url: URL) async throws {
        recordingURL = url
        recordingStarted = Date()
    }

    func stopRecording() async throws -> URL {
        guard let url = recordingURL, let started = recordingStarted else { throw StoryCameraError.captureFailed }
        recordingURL = nil
        let seconds = min(max(Date().timeIntervalSince(started), 1), 10)
        let frame = Self.frame(index: shots + 1, position: position, size: CGSize(width: 540, height: 960))
        try await StorySyntheticVideo.write(frame: frame, seconds: seconds, to: url)
        return url
    }

    static func frame(index: Int, position: StoryCameraPosition, size: CGSize) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            let hue = CGFloat(index % 12) / 12
            let colors = [
                UIColor(hue: hue, saturation: 0.7, brightness: 0.9, alpha: 1).cgColor,
                UIColor(hue: (hue + 0.3).truncatingRemainder(dividingBy: 1), saturation: 0.8, brightness: 0.5, alpha: 1).cgColor,
            ]
            let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors as CFArray, locations: nil)!
            context.cgContext.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: size.width, y: size.height), options: [])
            let text = "\(position == .front ? "◐" : "●") \(index)" as NSString
            let attributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: size.width * 0.18, weight: .bold),
                .foregroundColor: UIColor.white,
            ]
            let bounds = text.size(withAttributes: attributes)
            text.draw(at: CGPoint(x: (size.width - bounds.width) / 2, y: (size.height - bounds.height) / 2), withAttributes: attributes)
        }
    }
}

/// Живой предпросмотр имитации: градиент медленно меняет тон.
final class StorySimulatedPreviewView: UIView {
    private let gradient = CAGradientLayer()
    var position: StoryCameraPosition = .back {
        didSet { updateColors() }
    }

    var isAnimating = false {
        didSet {
            if isAnimating {
                let animation = CABasicAnimation(keyPath: "startPoint")
                animation.fromValue = CGPoint(x: 0, y: 0)
                animation.toValue = CGPoint(x: 1, y: 0)
                animation.duration = 3
                animation.autoreverses = true
                animation.repeatCount = .infinity
                gradient.add(animation, forKey: "drift")
            } else {
                gradient.removeAllAnimations()
            }
        }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        layer.addSublayer(gradient)
        gradient.startPoint = .zero
        gradient.endPoint = CGPoint(x: 1, y: 1)
        updateColors()
        accessibilityIdentifier = "story.camera.preview"
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) не используется") }

    override func layoutSubviews() {
        super.layoutSubviews()
        gradient.frame = bounds
    }

    private func updateColors() {
        gradient.colors = position == .back
            ? [UIColor.systemTeal.cgColor, UIColor.systemIndigo.cgColor]
            : [UIColor.systemPink.cgColor, UIColor.systemOrange.cgColor]
        accessibilityValue = position == .back ? "back" : "front"
    }
}

/// Короткий MP4 из одной картинки — запись имитации камеры и тестовые медиа.
enum StorySyntheticVideo {
    static func write(frame: UIImage, seconds: Double, to url: URL, fps: Int32 = 15) async throws {
        try? FileManager.default.removeItem(at: url)
        guard let cgImage = frame.cgImage else { throw StoryCameraError.captureFailed }
        let width = cgImage.width - cgImage.width % 2
        let height = cgImage.height - cgImage.height % 2
        let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
        ])
        input.expectsMediaDataInRealTime = false
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
        ])
        writer.add(input)
        guard writer.startWriting() else { throw writer.error ?? StoryCameraError.captureFailed }
        writer.startSession(atSourceTime: .zero)
        let total = Int(seconds * Double(fps))
        for index in 0..<max(total, 2) {
            while !input.isReadyForMoreMediaData { try await Task.sleep(nanoseconds: 2_000_000) }
            guard let pool = adaptor.pixelBufferPool else { break }
            var buffer: CVPixelBuffer?
            CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer)
            guard let buffer else { break }
            CVPixelBufferLockBaseAddress(buffer, [])
            if let context = CGContext(
                data: CVPixelBufferGetBaseAddress(buffer),
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
            ) {
                context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
                // Полоса-бегунок: кадры отличаются, видно, что ролик идёт.
                context.setFillColor(UIColor.white.cgColor)
                let progress = CGFloat(index) / CGFloat(max(total, 2))
                context.fill(CGRect(x: 0, y: 0, width: CGFloat(width) * progress, height: 12))
            }
            CVPixelBufferUnlockBaseAddress(buffer, [])
            adaptor.append(buffer, withPresentationTime: CMTime(value: CMTimeValue(index), timescale: fps))
        }
        input.markAsFinished()
        await writer.finishWriting()
        if writer.status != .completed { throw writer.error ?? StoryCameraError.captureFailed }
    }
}
