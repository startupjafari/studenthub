@preconcurrency import AVFoundation
import CoreImage
import CoreImage.CIFilterBuiltins
import UIKit

/// Готовый файл истории.
struct StoryExportResult: Sendable {
    let url: URL
    let mime: String
    let isVideo: Bool
    let preview: UIImage?

    /// В формате загрузки (`StoriesModel.publish`).
    func prepared() throws -> PreparedMedia {
        let data = try Data(contentsOf: url)
        guard data.count <= MediaPreparation.maxUploadBytes else { throw MediaPreparation.Failure.tooLarge }
        return PreparedMedia(data: data, mime: mime, filename: url.lastPathComponent, preview: preview)
    }
}

/// Финальный рендер истории: фото 1080×1920 (JPEG) или видео 1080×1920 (H.264, MP4).
///
/// Всё тяжёлое — вне главного потока. Направляющие размытия, рамки выделения и корзина —
/// виды холста, а не документа, поэтому в итог не попадают по построению.
enum StoryExporter {
    static let size = CGSize(width: StoryCanvasGeometry.exportSize.width, height: StoryCanvasGeometry.exportSize.height)
    /// Битрейт видео: минута — около 40 МБ, под предел загрузки одним запросом.
    static let videoBitrate = 5_000_000

    static func export(_ document: StoryDocument, workspace: StoryWorkspace) async throws -> StoryExportResult {
        if document.producesVideo {
            return try await exportVideo(document, workspace: workspace)
        }
        return try await Task.detached(priority: .userInitiated) {
            try exportPhoto(document, workspace: workspace)
        }.value
    }

    // MARK: Фото

    /// Кадр истории. `videoPoster` — кадр видео-фона для превью (у фото не нужен).
    static func renderPhoto(_ document: StoryDocument, workspace: StoryWorkspace, size: CGSize = size, videoPoster: UIImage? = nil) -> UIImage {
        let media = processedMedia(document, workspace: workspace) ?? videoPoster
        let images = EntityImages(workspace: workspace)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let metrics = StoryCanvasMetrics(size: size)
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            let cg = context.cgContext
            StoryComposer.drawBackdrop(document, in: cg, size: size)
            if let media { StoryComposer.drawMedia(media, document: document, in: cg, metrics: metrics) }
            StoryComposer.drawOverlay(
                document,
                entities: document.entities,
                includeDrawing: true,
                in: cg,
                metrics: metrics,
                image: images.image(named:)
            )
        }
    }

    private static func exportPhoto(_ document: StoryDocument, workspace: StoryWorkspace) throws -> StoryExportResult {
        let image = renderPhoto(document, workspace: workspace)
        guard let data = image.jpegData(compressionQuality: 0.9) else { throw MediaPreparation.Failure.unreadable }
        let url = workspace.url(for: "story-\(UUID().uuidString.prefix(8)).jpg")
        try data.write(to: url, options: .atomic)
        return StoryExportResult(url: url, mime: "image/jpeg", isVideo: false, preview: image.preparingThumbnail(of: CGSize(width: 360, height: 640)))
    }

    /// Обработанное фото фона в полный размер (до 2560 px по длинной стороне).
    private static func processedMedia(_ document: StoryDocument, workspace: StoryWorkspace) -> UIImage? {
        guard case let .photo(file, _) = document.background,
              let source = CIImage(contentsOf: workspace.url(for: file), options: [.applyOrientationProperty: true])
        else { return nil }
        let processed = StoryImageProcessor.shared.process(source, StoryProcessing(document))
        guard let cgImage = StoryImageProcessor.shared.render(processed) else { return nil }
        return UIImage(cgImage: cgImage)
    }

    private final class EntityImages: @unchecked Sendable {
        let workspace: StoryWorkspace
        private var cache: [String: UIImage] = [:]

        init(workspace: StoryWorkspace) {
            self.workspace = workspace
        }

        func image(named file: String) -> UIImage? {
            if let cached = cache[file] { return cached }
            let image = UIImage(contentsOfFile: workspace.url(for: file).path)
            cache[file] = image
            return image
        }
    }

    // MARK: Видео

    private static func exportVideo(_ document: StoryDocument, workspace: StoryWorkspace) async throws -> StoryExportResult {
        let composition = AVMutableComposition()
        let duration = min(document.duration ?? 5, StoryMediaImport.maxVideoDuration)
        let total = CMTime(seconds: duration, preferredTimescale: 600)
        let instruction = StoryCompositionInstruction(timeRange: CMTimeRange(start: .zero, duration: total))
        let renderSize = size
        let metrics = StoryCanvasMetrics(size: renderSize)

        // Фон: видео-дорожка или неподвижная картинка (фото с кружком).
        var base = UIImage()
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        if case let .video(file, pixelSize, sourceDuration) = document.background {
            let asset = AVURLAsset(url: workspace.url(for: file))
            let trim = document.videoTrim ?? StoryTimeRange(start: 0, end: sourceDuration)
            let range = CMTimeRange(
                start: CMTime(seconds: trim.start, preferredTimescale: 600),
                duration: CMTime(seconds: min(trim.length, duration), preferredTimescale: 600)
            )
            if let track = try await asset.loadTracks(withMediaType: .video).first,
               let target = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) {
                try target.insertTimeRange(range, of: track, at: .zero)
                let transform = try await track.load(.preferredTransform)
                let natural = try await track.load(.naturalSize)
                let frame = metrics.mediaFrame(for: pixelSize, transform: document.mediaTransform)
                instruction.background = .init(
                    trackID: target.trackID,
                    orientation: transform,
                    naturalSize: natural,
                    center: frame.center,
                    size: frame.size,
                    rotation: CGFloat(document.mediaTransform.rotation)
                )
            }
            if let audio = try await asset.loadTracks(withMediaType: .audio).first,
               let target = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
                try? target.insertTimeRange(range, of: audio, at: .zero)
            }
            instruction.processing = StoryProcessing(document)
            base = UIGraphicsImageRenderer(size: renderSize, format: format).image { context in
                StoryComposer.drawBackdrop(document, in: context.cgContext, size: renderSize)
            }
        } else {
            let media = processedMedia(document, workspace: workspace)
            base = UIGraphicsImageRenderer(size: renderSize, format: format).image { context in
                StoryComposer.drawBackdrop(document, in: context.cgContext, size: renderSize)
                if let media { StoryComposer.drawMedia(media, document: document, in: context.cgContext, metrics: metrics) }
            }
        }
        instruction.base = base.cgImage.map { CIImage(cgImage: $0) }

        // Слои поверх: рисунок и объекты кусками между кружками — порядок наложения
        // как на холсте.
        let images = EntityImages(workspace: workspace)
        let overlayFormat = UIGraphicsImageRendererFormat()
        overlayFormat.scale = 1
        overlayFormat.opaque = false
        var pending: [StoryEntity] = []
        var includeDrawing = true
        func flushStatic() {
            guard includeDrawing && !document.drawing.isEmpty || !pending.isEmpty else {
                includeDrawing = false
                return
            }
            let layerImage = UIGraphicsImageRenderer(size: renderSize, format: overlayFormat).image { context in
                StoryComposer.drawOverlay(document, entities: pending, includeDrawing: includeDrawing, in: context.cgContext, metrics: metrics, image: images.image(named:))
            }
            if let cg = layerImage.cgImage { instruction.layers.append(.image(CIImage(cgImage: cg))) }
            pending = []
            includeDrawing = false
        }
        for entity in document.entities.sorted(by: { $0.zIndex < $1.zIndex }) {
            guard case let .roundVideo(video) = entity.kind else {
                pending.append(entity)
                continue
            }
            flushStatic()
            let asset = AVURLAsset(url: workspace.url(for: video.file))
            guard let track = try await asset.loadTracks(withMediaType: .video).first,
                  let target = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
            else { continue }
            let trim = video.trim ?? StoryTimeRange(start: 0, end: video.duration)
            let start = CMTime(seconds: video.startTime, preferredTimescale: 600)
            let length = min(trim.length, max(duration - video.startTime, 0))
            guard length > 0.05 else { continue }
            let range = CMTimeRange(start: CMTime(seconds: trim.start, preferredTimescale: 600), duration: CMTime(seconds: length, preferredTimescale: 600))
            try target.insertTimeRange(range, of: track, at: start)
            if let audio = try await asset.loadTracks(withMediaType: .audio).first,
               let audioTarget = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
                try? audioTarget.insertTimeRange(range, of: audio, at: start)
            }
            let diameter = metrics.length(entity.size.width) * CGFloat(entity.scale)
            instruction.layers.append(.round(.init(
                trackID: target.trackID,
                orientation: try await track.load(.preferredTransform),
                naturalSize: try await track.load(.naturalSize),
                center: metrics.point(entity.center),
                diameter: diameter,
                mirrored: video.mirrored,
                opacity: CGFloat(entity.opacity)
            )))
        }
        flushStatic()

        let videoComposition = AVMutableVideoComposition()
        videoComposition.customVideoCompositorClass = StoryVideoCompositor.self
        videoComposition.renderSize = renderSize
        videoComposition.frameDuration = CMTime(value: 1, timescale: 30)
        instruction.requiredSourceTrackIDs = composition.tracks(withMediaType: .video).map { NSNumber(value: $0.trackID) }
        videoComposition.instructions = [instruction]

        let url = workspace.url(for: "story-\(UUID().uuidString.prefix(8)).mp4")
        try await StoryVideoWriter.write(
            composition: composition,
            videoComposition: videoComposition,
            duration: total,
            renderSize: renderSize,
            bitrate: videoBitrate,
            to: url
        )
        let preview = MediaPreparation.thumbnail(ofVideoAt: url)
        return StoryExportResult(url: url, mime: "video/mp4", isVideo: true, preview: preview)
    }
}

/// Инструкция компоновщика: неподвижная основа, видео-фон и слои в порядке наложения.
final class StoryCompositionInstruction: NSObject, AVVideoCompositionInstructionProtocol, @unchecked Sendable {
    struct Placement {
        var trackID: CMPersistentTrackID
        var orientation: CGAffineTransform
        var naturalSize: CGSize
        var center: CGPoint
        var size: CGSize
        var rotation: CGFloat
    }

    struct RoundPlacement {
        var trackID: CMPersistentTrackID
        var orientation: CGAffineTransform
        var naturalSize: CGSize
        var center: CGPoint
        var diameter: CGFloat
        var mirrored: Bool
        var opacity: CGFloat
    }

    enum Layer {
        case image(CIImage)
        case round(RoundPlacement)
    }

    let timeRange: CMTimeRange
    let enablePostProcessing = false
    let containsTweening = true
    var requiredSourceTrackIDs: [NSValue]?
    let passthroughTrackID = kCMPersistentTrackID_Invalid

    var base: CIImage?
    var background: Placement?
    var processing = StoryProcessing()
    var layers: [Layer] = []

    init(timeRange: CMTimeRange) {
        self.timeRange = timeRange
    }
}

/// Компоновщик кадров истории на Core Image.
final class StoryVideoCompositor: NSObject, AVVideoCompositing, @unchecked Sendable {
    let sourcePixelBufferAttributes: [String: any Sendable]? = [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    ]
    let requiredPixelBufferAttributesForRenderContext: [String: any Sendable] = [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    ]
    private let queue = DispatchQueue(label: "studenthub.story.compositor", qos: .userInitiated)
    private let processor = StoryImageProcessor.shared

    func renderContextChanged(_ newRenderContext: AVVideoCompositionRenderContext) {}

    func startRequest(_ request: AVAsynchronousVideoCompositionRequest) {
        queue.async { [processor] in
            guard let instruction = request.videoCompositionInstruction as? StoryCompositionInstruction,
                  let output = request.renderContext.newPixelBuffer()
            else {
                request.finish(with: StoryCameraError.captureFailed)
                return
            }
            let size = request.renderContext.size
            let canvas = CGRect(origin: .zero, size: size)
            var image = instruction.base ?? CIImage(color: .black).cropped(to: canvas)

            if let background = instruction.background, let buffer = request.sourceFrame(byTrackID: background.trackID) {
                var frame = Self.oriented(CIImage(cvPixelBuffer: buffer), transform: background.orientation)
                frame = processor.process(frame, instruction.processing)
                frame = Self.place(frame, center: background.center, size: background.size, rotation: background.rotation, canvasHeight: size.height)
                image = frame.composited(over: image)
            }
            for layer in instruction.layers {
                switch layer {
                case .image(let overlay):
                    image = overlay.composited(over: image)
                case .round(let round):
                    guard let buffer = request.sourceFrame(byTrackID: round.trackID) else { continue }
                    var frame = Self.oriented(CIImage(cvPixelBuffer: buffer), transform: round.orientation)
                    if round.mirrored {
                        frame = frame.transformed(by: CGAffineTransform(scaleX: -1, y: 1).translatedBy(x: -frame.extent.width, y: 0))
                    }
                    image = Self.circle(frame, center: round.center, diameter: round.diameter, opacity: round.opacity, canvasHeight: size.height)
                        .composited(over: image)
                }
            }
            processor.context.render(image.cropped(to: canvas), to: output, bounds: canvas, colorSpace: CGColorSpace(name: CGColorSpace.sRGB))
            request.finish(withComposedVideoFrame: output)
        }
    }

    func cancelAllPendingVideoCompositionRequests() {}

    /// Кадр дорожки в положении «как на экране»: `preferredTransform` задан в координатах
    /// с осью y вниз, у Core Image она вверх — переворачиваем до и после.
    static func oriented(_ image: CIImage, transform: CGAffineTransform) -> CIImage {
        let extent = image.extent
        let display = extent.applying(transform)
        let normalizedTransform = transform.concatenating(CGAffineTransform(translationX: -display.minX, y: -display.minY))
        let flipIn = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: extent.height)
        let flipOut = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: abs(display.height))
        let result = image.transformed(by: flipIn.concatenating(normalizedTransform).concatenating(flipOut))
        return result.transformed(by: CGAffineTransform(translationX: -result.extent.minX, y: -result.extent.minY))
    }

    /// Положить кадр (начало в 0,0) центром в точку холста (ось y вниз) нужного размера.
    static func place(_ image: CIImage, center: CGPoint, size: CGSize, rotation: CGFloat, canvasHeight: CGFloat) -> CIImage {
        let extent = image.extent
        guard extent.width > 0, extent.height > 0 else { return image }
        // Заполнить рамку без искажения (как aspect fill предпросмотра).
        let scale = max(size.width / extent.width, size.height / extent.height)
        let centered = image.transformed(by: CGAffineTransform(translationX: -extent.midX, y: -extent.midY)
            .concatenating(CGAffineTransform(scaleX: scale, y: scale)))
        let clipped = centered.cropped(to: CGRect(x: -size.width / 2, y: -size.height / 2, width: size.width, height: size.height))
        // Поворот по часовой на экране — против часовой в координатах с осью y вверх.
        return clipped.transformed(by: CGAffineTransform(rotationAngle: -rotation)
            .concatenating(CGAffineTransform(translationX: center.x, y: canvasHeight - center.y)))
    }

    /// Кадр кружка: квадрат по центру, маска-круг, нужный диаметр и место.
    static func circle(_ image: CIImage, center: CGPoint, diameter: CGFloat, opacity: CGFloat, canvasHeight: CGFloat) -> CIImage {
        let extent = image.extent
        let side = min(extent.width, extent.height)
        guard side > 0, diameter > 0 else { return CIImage.empty() }
        let square = image.cropped(to: CGRect(x: extent.midX - side / 2, y: extent.midY - side / 2, width: side, height: side))
        let scale = diameter / side
        let scaled = square
            .transformed(by: CGAffineTransform(translationX: -(extent.midX - side / 2), y: -(extent.midY - side / 2)))
            .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        let radius = diameter / 2
        let mask = CIFilter.radialGradient()
        mask.center = CGPoint(x: radius, y: radius)
        mask.radius0 = Float(radius - 1)
        mask.radius1 = Float(radius)
        mask.color0 = CIColor(red: 1, green: 1, blue: 1, alpha: opacity)
        mask.color1 = CIColor(red: 0, green: 0, blue: 0, alpha: 0)
        let blend = CIFilter.blendWithAlphaMask()
        blend.inputImage = scaled
        blend.backgroundImage = CIImage.empty()
        blend.maskImage = mask.outputImage?.cropped(to: CGRect(x: 0, y: 0, width: diameter, height: diameter))
        let masked = blend.outputImage ?? scaled
        return masked.transformed(by: CGAffineTransform(translationX: center.x - radius, y: canvasHeight - center.y - radius))
    }
}

/// Запись композиции в MP4 с заданным битрейтом: `AVAssetExportSession` битрейт не
/// задаёт, и минутная история выходила бы больше предела загрузки.
enum StoryVideoWriter {
    static func write(
        composition: AVComposition,
        videoComposition: AVVideoComposition,
        duration: CMTime,
        renderSize: CGSize,
        bitrate: Int,
        to url: URL
    ) async throws {
        try? FileManager.default.removeItem(at: url)
        let reader = try AVAssetReader(asset: composition)
        reader.timeRange = CMTimeRange(start: .zero, duration: duration)
        let videoTracks = composition.tracks(withMediaType: .video)
        let videoOutput = AVAssetReaderVideoCompositionOutput(videoTracks: videoTracks, videoSettings: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        ])
        videoOutput.videoComposition = videoComposition
        videoOutput.alwaysCopiesSampleData = false
        reader.add(videoOutput)
        let audioTracks = composition.tracks(withMediaType: .audio)
        var audioOutput: AVAssetReaderAudioMixOutput?
        if !audioTracks.isEmpty {
            let output = AVAssetReaderAudioMixOutput(audioTracks: audioTracks, audioSettings: [
                AVFormatIDKey: kAudioFormatLinearPCM,
            ])
            reader.add(output)
            audioOutput = output
        }

        let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        writer.shouldOptimizeForNetworkUse = true
        let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: Int(renderSize.width),
            AVVideoHeightKey: Int(renderSize.height),
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: bitrate,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                AVVideoMaxKeyFrameIntervalKey: 60,
            ],
        ])
        videoInput.expectsMediaDataInRealTime = false
        writer.add(videoInput)
        var audioInput: AVAssetWriterInput?
        if audioOutput != nil {
            let input = AVAssetWriterInput(mediaType: .audio, outputSettings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVNumberOfChannelsKey: 2,
                AVSampleRateKey: 44_100,
                AVEncoderBitRateKey: 128_000,
            ])
            input.expectsMediaDataInRealTime = false
            writer.add(input)
            audioInput = input
        }

        guard reader.startReading() else { throw reader.error ?? StoryCameraError.captureFailed }
        guard writer.startWriting() else { throw writer.error ?? StoryCameraError.captureFailed }
        writer.startSession(atSourceTime: .zero)

        var pairs: [(AVAssetReaderOutput, AVAssetWriterInput)] = [(videoOutput, videoInput)]
        if let audioOutput, let audioInput { pairs.append((audioOutput, audioInput)) }
        await withTaskGroup(of: Void.self) { group in
            for (index, pair) in pairs.enumerated() {
                let box = StoryLockedBox(pair)
                group.addTask {
                    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                        let queue = DispatchQueue(label: "studenthub.story.writer.\(index)")
                        let done = StoryLockedBox(false)
                        box.value.1.requestMediaDataWhenReady(on: queue) {
                            // Пара читается внутри: читатель и запись не Sendable, коробка — да.
                            let (output, input) = box.value
                            while input.isReadyForMoreMediaData, !done.value {
                                if let sample = output.copyNextSampleBuffer(), input.append(sample) { continue }
                                input.markAsFinished()
                                done.value = true
                                continuation.resume()
                            }
                        }
                    }
                }
            }
        }
        if reader.status == .failed {
            writer.cancelWriting()
            throw reader.error ?? StoryCameraError.captureFailed
        }
        await writer.finishWriting()
        if writer.status != .completed { throw writer.error ?? StoryCameraError.captureFailed }
    }
}
