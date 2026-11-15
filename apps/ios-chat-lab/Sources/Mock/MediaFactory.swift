import UIKit
import AVFoundation
import CoreMedia
import CoreVideo
import ImageIO
import UniformTypeIdentifiers

extension Notification.Name {
    /// Файл медиа готов: `object` — имя файла (`String`).
    static let mediaFileReady = Notification.Name("ChatLab.mediaFileReady")
}

/// Каталог медиа на диске.
enum MediaStorage {
    nonisolated static var directory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ChatLab/Media", isDirectory: true)
    }

    nonisolated static func url(for file: String) -> URL {
        directory.appendingPathComponent(file)
    }

    nonisolated static func exists(_ file: String) -> Bool {
        FileManager.default.fileExists(atPath: url(for: file).path)
    }

    /// Новое имя для файла, который пользователь отправил сам (снимок, запись, документ).
    nonisolated static func makeUserFileName(extension ext: String) -> String {
        "user_\(UUID().uuidString.prefix(8)).\(ext)"
    }
}

/// Генерирует тестовые медиа при первом запуске: фото рисуются Core Graphics, видео и
/// кружки кодируются AVAssetWriter (H.264 + AAC), GIF — ImageIO, голосовые — AVAudioFile
/// (AAC), документы — PDF/текст/CSV. Всё на фоновой очереди; каждый готовый файл
/// публикуется уведомлением `.mediaFileReady` на главном потоке.
final class MediaFactory: @unchecked Sendable {
    static let shared = MediaFactory()

    private let queue = DispatchQueue(label: "ChatLab.media.factory", qos: .utility)
    private let lock = NSLock()
    private var generating = false

    /// Идёт ли генерация прямо сейчас (для Debug Menu).
    var isGenerating: Bool {
        lock.lock()
        defer { lock.unlock() }
        return generating
    }

    /// Создать недостающие файлы каталога. Существующие не трогает.
    func prepareIfNeeded() {
        try? FileManager.default.createDirectory(at: MediaStorage.directory, withIntermediateDirectories: true)
        guard beginGenerating() else { return }
        queue.async { [weak self] in
            self?.generateMissing()
            self?.endGenerating()
        }
    }

    /// Стереть каталог медиа и сгенерировать всё заново (Debug Menu).
    func regenerateAll() {
        queue.async { [weak self] in
            guard let self else { return }
            try? FileManager.default.removeItem(at: MediaStorage.directory)
            try? FileManager.default.createDirectory(at: MediaStorage.directory, withIntermediateDirectories: true)
            guard self.beginGenerating() else { return }
            self.generateMissing()
            self.endGenerating()
        }
    }

    private func beginGenerating() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if generating { return false }
        generating = true
        return true
    }

    private func endGenerating() {
        lock.lock()
        generating = false
        lock.unlock()
    }

    // MARK: Порядок генерации

    /// Аватар первым, затем дешёвое (фото, голос, файлы), затем GIF и видео.
    private var orderedSpecs: [MediaSpec] {
        let avatar = MediaCatalog.photos.filter { $0.file == MockChatService.peer.avatarFile }
        let photos = MediaCatalog.photos.filter { $0.file != MockChatService.peer.avatarFile }
        return avatar + photos + MediaCatalog.voices + MediaCatalog.files + MediaCatalog.gifs + MediaCatalog.videos + MediaCatalog.videoNotes
    }

    private func generateMissing() {
        let started = CFAbsoluteTimeGetCurrent()
        var produced = 0
        for spec in orderedSpecs where !MediaStorage.exists(spec.file) {
            autoreleasepool {
                let target = MediaStorage.url(for: spec.file)
                let temp = MediaStorage.directory.appendingPathComponent(".tmp-\(spec.file)")
                try? FileManager.default.removeItem(at: temp)
                do {
                    try generate(spec, to: temp)
                    try? FileManager.default.removeItem(at: target)
                    try FileManager.default.moveItem(at: temp, to: target)
                    produced += 1
                    publish(spec.file)
                } catch {
                    try? FileManager.default.removeItem(at: temp)
                    NSLog("ChatLab: не удалось сгенерировать \(spec.file): \(error)")
                }
            }
        }
        if produced > 0 {
            NSLog("ChatLab: сгенерировано медиа: \(produced) за \(String(format: "%.1f", CFAbsoluteTimeGetCurrent() - started)) с")
        }
    }

    private func publish(_ file: String) {
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: .mediaFileReady, object: file)
        }
    }

    private func generate(_ spec: MediaSpec, to url: URL) throws {
        let seed = spec.file.hashValueStable
        switch spec.kind {
        case .photo:
            try MediaGenerators.writePhoto(spec: spec, seed: seed, to: url)
        case .gif:
            try MediaGenerators.writeGIF(spec: spec, seed: seed, to: url)
        case .voice:
            try MediaGenerators.writeVoice(spec: spec, to: url)
        case .video:
            let scenes = [Scene.mountains, .sea, .city, .sunset, .coffee]
            let scene = scenes[(spec.theme - 4 + scenes.count * 4) % scenes.count]
            try MediaGenerators.writeVideo(
                to: url, width: Int(spec.width), height: Int(spec.height), duration: max(1, spec.duration),
                audio: nil
            ) { context, size, t in
                Scene.draw(scene, in: context, size: size, t: t, seed: seed, photographic: false)
            }
        case .videoNote:
            let duration = max(1, spec.duration)
            let envelope = MediaCatalog.waveform(seed: spec.file, duration: duration)
            try MediaGenerators.writeVideo(
                to: url, width: Int(spec.width), height: Int(spec.height), duration: duration,
                audio: { sampleRate in
                    Synth.speech(duration: duration, sampleRate: sampleRate, envelope: envelope, pitch: 175 + Double(seed % 40))
                }
            ) { context, size, t in
                Scene.drawTalkingFace(in: context, size: size, t: t, duration: duration, envelope: envelope, seed: seed)
            }
        case .file:
            try MediaGenerators.writeDocument(spec: spec, to: url)
        }
    }
}

// MARK: - Генераторы файлов

private enum MediaGenerators {
    static let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!

    // MARK: Фото

    static func writePhoto(spec: MediaSpec, seed: UInt64, to url: URL) throws {
        let size = CGSize(width: max(1, spec.width), height: max(1, spec.height))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        let scene = Scene.allCases[spec.theme % Scene.allCases.count]
        let data = renderer.jpegData(withCompressionQuality: 0.85) { context in
            Scene.draw(scene, in: context.cgContext, size: size, t: 0, seed: seed, photographic: true)
        }
        try data.write(to: url)
    }

    // MARK: GIF

    static func writeGIF(spec: MediaSpec, seed: UInt64, to url: URL) throws {
        let width = Int(max(1, spec.width))
        let height = Int(max(1, spec.height))
        let frames = 24
        guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.gif.identifier as CFString, frames, nil) else {
            throw FactoryError.encoder("GIF")
        }
        let fileProperties = [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]] as CFDictionary
        CGImageDestinationSetProperties(destination, fileProperties)
        let frameProperties = [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: 0.08]] as CFDictionary
        let scenes = [Scene.bokeh, .sea, .cat, .coffee]
        let scene = scenes[(spec.theme - 8 + scenes.count * 4) % scenes.count]
        for index in 0..<frames {
            try autoreleasepool {
                guard let context = CGContext(
                    data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: sRGB,
                    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
                ) else { throw FactoryError.encoder("GIF кадр") }
                context.translateBy(x: 0, y: CGFloat(height))
                context.scaleBy(x: 1, y: -1)
                Scene.draw(scene, in: context, size: CGSize(width: width, height: height), t: CGFloat(index) / CGFloat(frames), seed: seed, photographic: false)
                guard let image = context.makeImage() else { throw FactoryError.encoder("GIF кадр") }
                CGImageDestinationAddImage(destination, image, frameProperties)
            }
        }
        guard CGImageDestinationFinalize(destination) else { throw FactoryError.encoder("GIF finalize") }
    }

    // MARK: Голосовое

    static func writeVoice(spec: MediaSpec, to url: URL) throws {
        let duration = max(1, spec.duration)
        let sampleRate = 16_000.0
        let envelope = MediaCatalog.waveform(seed: spec.file, duration: duration)
        let samples = Synth.speech(duration: duration, sampleRate: sampleRate, envelope: envelope, pitch: 160 + Double(spec.file.hashValueStable % 60))
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 32_000,
        ]
        let file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
        let format = file.processingFormat
        let chunk = 8192
        var offset = 0
        while offset < samples.count {
            let count = min(chunk, samples.count - offset)
            guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count)),
                  let channel = buffer.floatChannelData?[0] else { throw FactoryError.encoder("PCM буфер") }
            for index in 0..<count {
                channel[index] = Float(samples[offset + index])
            }
            buffer.frameLength = AVAudioFrameCount(count)
            try file.write(from: buffer)
            offset += count
        }
        file.close()
    }

    // MARK: Видео

    /// Видео H.264 (+ AAC, если передан синтез звука). Обе дорожки питаются через
    /// `requestMediaDataWhenReady` — иначе писатель ждёт чередования дорожек и встаёт.
    static func writeVideo(
        to url: URL, width: Int, height: Int, duration: Double, fps: Int32 = 30,
        audio: ((Double) -> [Float])?,
        draw: @escaping (CGContext, CGSize, CGFloat) -> Void
    ) throws {
        // H.264 требует чётные размеры.
        let width = max(2, width & ~1)
        let height = max(2, height & ~1)
        let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: width * height * 3,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
            ],
        ])
        videoInput.expectsMediaDataInRealTime = false
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: videoInput, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
        ])
        guard writer.canAdd(videoInput) else { throw FactoryError.encoder("видео вход") }
        writer.add(videoInput)

        let sampleRate = 44_100.0
        var audioInput: AVAssetWriterInput?
        var audioSamples: [Int16] = []
        var audioFormat: CMAudioFormatDescription?
        if let audio {
            let input = AVAssetWriterInput(mediaType: .audio, outputSettings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: sampleRate,
                AVNumberOfChannelsKey: 1,
                AVEncoderBitRateKey: 64_000,
            ])
            input.expectsMediaDataInRealTime = false
            if writer.canAdd(input) {
                writer.add(input)
                audioInput = input
                audioSamples = audio(sampleRate).map { Int16(max(-1, min(1, $0)) * Float(Int16.max - 1)) }
                audioFormat = makePCMFormat(sampleRate: sampleRate)
            }
        }

        guard writer.startWriting() else { throw writer.error ?? FactoryError.encoder("startWriting") }
        writer.startSession(atSourceTime: .zero)

        let totalFrames = max(1, Int(duration * Double(fps)))
        let group = DispatchGroup()
        let state = WriterState()
        let size = CGSize(width: width, height: height)

        group.enter()
        videoInput.requestMediaDataWhenReady(on: DispatchQueue(label: "ChatLab.media.video")) {
            while videoInput.isReadyForMoreMediaData, !state.videoDone {
                let frame = state.nextVideoFrame
                if frame >= totalFrames || writer.status != .writing {
                    state.videoDone = true
                    videoInput.markAsFinished()
                    group.leave()
                    return
                }
                autoreleasepool {
                    guard let pool = adaptor.pixelBufferPool else { return }
                    var pixelBuffer: CVPixelBuffer?
                    CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pixelBuffer)
                    guard let pixelBuffer else { return }
                    CVPixelBufferLockBaseAddress(pixelBuffer, [])
                    if let context = CGContext(
                        data: CVPixelBufferGetBaseAddress(pixelBuffer), width: width, height: height, bitsPerComponent: 8,
                        bytesPerRow: CVPixelBufferGetBytesPerRow(pixelBuffer), space: sRGB,
                        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
                    ) {
                        context.translateBy(x: 0, y: CGFloat(height))
                        context.scaleBy(x: 1, y: -1)
                        draw(context, size, CGFloat(frame) / CGFloat(totalFrames))
                    }
                    CVPixelBufferUnlockBaseAddress(pixelBuffer, [])
                    adaptor.append(pixelBuffer, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: fps))
                }
                state.nextVideoFrame = frame + 1
            }
        }

        if let audioInput, let audioFormat {
            group.enter()
            let chunk = 4096
            audioInput.requestMediaDataWhenReady(on: DispatchQueue(label: "ChatLab.media.audio")) {
                while audioInput.isReadyForMoreMediaData, !state.audioDone {
                    let start = state.nextAudioSample
                    if start >= audioSamples.count || writer.status != .writing {
                        state.audioDone = true
                        audioInput.markAsFinished()
                        group.leave()
                        return
                    }
                    let count = min(chunk, audioSamples.count - start)
                    let buffer = audioSamples[start..<(start + count)].withUnsafeBufferPointer { pointer in
                        makeAudioSampleBuffer(pointer, start: start, sampleRate: sampleRate, format: audioFormat)
                    }
                    if let buffer { audioInput.append(buffer) }
                    state.nextAudioSample = start + count
                }
            }
        }

        group.wait()
        let finished = DispatchSemaphore(value: 0)
        writer.finishWriting { finished.signal() }
        finished.wait()
        if writer.status != .completed {
            throw writer.error ?? FactoryError.encoder("finishWriting \(writer.status.rawValue)")
        }
    }

    private final class WriterState: @unchecked Sendable {
        var nextVideoFrame = 0
        var nextAudioSample = 0
        var videoDone = false
        var audioDone = false
    }

    static func makePCMFormat(sampleRate: Double) -> CMAudioFormatDescription? {
        var description = AudioStreamBasicDescription(
            mSampleRate: sampleRate, mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked,
            mBytesPerPacket: 2, mFramesPerPacket: 1, mBytesPerFrame: 2, mChannelsPerFrame: 1, mBitsPerChannel: 16, mReserved: 0
        )
        var format: CMAudioFormatDescription?
        CMAudioFormatDescriptionCreate(
            allocator: kCFAllocatorDefault, asbd: &description, layoutSize: 0, layout: nil, magicCookieSize: 0,
            magicCookie: nil, extensions: nil, formatDescriptionOut: &format
        )
        return format
    }

    static func makeAudioSampleBuffer(
        _ samples: UnsafeBufferPointer<Int16>, start: Int, sampleRate: Double, format: CMAudioFormatDescription
    ) -> CMSampleBuffer? {
        let length = samples.count * MemoryLayout<Int16>.size
        var block: CMBlockBuffer?
        guard CMBlockBufferCreateWithMemoryBlock(
            allocator: kCFAllocatorDefault, memoryBlock: nil, blockLength: length, blockAllocator: kCFAllocatorDefault,
            customBlockSource: nil, offsetToData: 0, dataLength: length, flags: 0, blockBufferOut: &block
        ) == noErr, let block, let base = samples.baseAddress else { return nil }
        guard CMBlockBufferReplaceDataBytes(with: base, blockBuffer: block, offsetIntoDestination: 0, dataLength: length) == noErr else {
            return nil
        }
        var sampleBuffer: CMSampleBuffer?
        CMAudioSampleBufferCreateReadyWithPacketDescriptions(
            allocator: kCFAllocatorDefault, dataBuffer: block, formatDescription: format, sampleCount: samples.count,
            presentationTimeStamp: CMTime(value: CMTimeValue(start), timescale: CMTimeScale(sampleRate)),
            packetDescriptions: nil, sampleBufferOut: &sampleBuffer
        )
        return sampleBuffer
    }

    // MARK: Документы

    static func writeDocument(spec: MediaSpec, to url: URL) throws {
        switch spec.file {
        case "doc_01.pdf": try Documents.lease(to: url)
        case "doc_02.pdf": try Documents.tickets(to: url)
        case "doc_03.txt": try Data(Documents.shoppingList.utf8).write(to: url)
        case "doc_04.pdf": try Documents.presentation(to: url)
        case "doc_05.csv": try (Data([0xEF, 0xBB, 0xBF]) + Data(Documents.budgetCSV.utf8)).write(to: url)
        case "doc_06.pdf": try Documents.resume(to: url)
        default:
            if spec.file.hasSuffix(".pdf") {
                try Documents.lease(to: url)
            } else {
                try Data("Тестовый файл ChatLab".utf8).write(to: url)
            }
        }
    }
}

enum FactoryError: Error {
    case encoder(String)
}

// MARK: - Звук

/// Синтез «речи»: гармоники основного тона с формантными пиками, слоги по ~4–5 Гц,
/// громкость — по форме волны каталога (то, что нарисовано, и слышно).
enum Synth {
    static func speech(duration: Double, sampleRate: Double, envelope: [UInt8], pitch: Double) -> [Float] {
        let count = Int(duration * sampleRate)
        var output = [Float](repeating: 0, count: count)
        var phase = 0.0
        var noiseState: UInt64 = 0x1234_5678
        let formants: [(center: Double, width: Double)] = [(650, 260), (1150, 320), (2500, 500)]
        let harmonics = 10
        for index in 0..<count {
            let time = Double(index) / sampleRate
            // Громкость по огибающей (64 значения на всю запись), с интерполяцией.
            let position = time / duration * Double(envelope.count - 1)
            let lower = min(envelope.count - 1, Int(position))
            let upper = min(envelope.count - 1, lower + 1)
            let fraction = position - Double(lower)
            let level = (Double(envelope[lower]) * (1 - fraction) + Double(envelope[upper]) * fraction) / 31
            // Слоги: огибающая 4.5 Гц, плавные паузы.
            let syllable = pow(sin(.pi * 4.5 * time), 2)
            let f0 = pitch + 25 * sin(2 * .pi * 0.6 * time) + 10 * sin(2 * .pi * 3.1 * time)
            phase += 2 * .pi * f0 / sampleRate
            if phase > 2 * .pi * 1000 { phase -= 2 * .pi * 1000 }
            // Форманты «плывут», будто меняются гласные.
            let drift = 1 + 0.15 * sin(2 * .pi * 1.7 * time)
            var sample = 0.0
            for k in 1...harmonics {
                let frequency = f0 * Double(k)
                var weight = 0.0
                for formant in formants {
                    let distance = (frequency - formant.center * drift) / formant.width
                    weight += exp(-distance * distance)
                }
                sample += sin(phase * Double(k)) * weight / Double(k).squareRoot()
            }
            // Немного шума — согласные.
            noiseState = noiseState &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
            let noise = Double(Int64(bitPattern: noiseState >> 11) % 1000) / 1000 * 0.08
            let amplitude = level * (0.25 + 0.75 * syllable)
            output[index] = Float((sample * 0.22 + noise * syllable) * amplitude)
        }
        // Мягкие края, без щелчков.
        let fade = min(count / 4, Int(sampleRate * 0.02))
        for index in 0..<fade {
            let gain = Float(index) / Float(max(1, fade))
            output[index] *= gain
            output[count - 1 - index] *= gain
        }
        return output
    }
}

// MARK: - Сюжеты картинок

/// Процедурные сюжеты. Рисуют в контексте с осью Y вниз. `t` ∈ [0, 1) — фаза анимации
/// (для видео и GIF движение периодично и закольцовывается).
enum Scene: Int, CaseIterable {
    case sunset, mountains, sea, city, coffee, cat, forest, bokeh

    static func color(_ rgb: UInt32, _ alpha: CGFloat = 1) -> CGColor {
        CGColor(
            srgbRed: CGFloat((rgb >> 16) & 0xFF) / 255, green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255, alpha: alpha
        )
    }

    static func mix(_ a: UInt32, _ b: UInt32, _ f: CGFloat) -> UInt32 {
        func channel(_ shift: UInt32) -> UInt32 {
            let ca = CGFloat((a >> shift) & 0xFF)
            let cb = CGFloat((b >> shift) & 0xFF)
            return UInt32(max(0, min(255, ca + (cb - ca) * f))) << shift
        }
        return channel(16) | channel(8) | channel(0)
    }

    static func gradient(_ context: CGContext, _ rect: CGRect, _ colors: [UInt32], horizontal: Bool = false) {
        let cgColors = colors.map { color($0) } as CFArray
        guard let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: cgColors, locations: nil) else { return }
        context.saveGState()
        context.clip(to: rect)
        let start = horizontal ? CGPoint(x: rect.minX, y: rect.midY) : CGPoint(x: rect.midX, y: rect.minY)
        let end = horizontal ? CGPoint(x: rect.maxX, y: rect.midY) : CGPoint(x: rect.midX, y: rect.maxY)
        context.drawLinearGradient(gradient, start: start, end: end, options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
        context.restoreGState()
    }

    static func glow(_ context: CGContext, center: CGPoint, radius: CGFloat, color rgb: UInt32, alpha: CGFloat) {
        let colors = [color(rgb, alpha), color(rgb, 0)] as CFArray
        guard let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: colors, locations: [0, 1]) else { return }
        context.drawRadialGradient(gradient, startCenter: center, startRadius: 0, endCenter: center, endRadius: radius, options: [])
    }

    static func unit(_ rng: inout SeededGenerator) -> CGFloat {
        CGFloat(rng.next() % 10_000) / 10_000
    }

    static func draw(_ scene: Scene, in context: CGContext, size: CGSize, t: CGFloat, seed: UInt64, photographic: Bool) {
        var rng = SeededGenerator(seed: seed)
        context.saveGState()
        switch scene {
        case .sunset: sunset(context, size, t, &rng)
        case .mountains: mountains(context, size, t, &rng)
        case .sea: sea(context, size, t, &rng)
        case .city: city(context, size, t, &rng)
        case .coffee: coffee(context, size, t, &rng)
        case .cat: cat(context, size, t, &rng)
        case .forest: forest(context, size, t, &rng)
        case .bokeh: bokeh(context, size, t, &rng)
        }
        context.restoreGState()
        if photographic { grain(context, size, &rng) }
    }

    /// Зерно и виньетка — чтобы картинка читалась как снимок, а не как плоская графика.
    static func grain(_ context: CGContext, _ size: CGSize, _ rng: inout SeededGenerator) {
        let dots = Int(size.width * size.height / 450)
        for _ in 0..<dots {
            let x = unit(&rng) * size.width
            let y = unit(&rng) * size.height
            let light = rng.next() % 2 == 0
            context.setFillColor(light ? color(0xFFFFFF, 0.05) : color(0x000000, 0.06))
            context.fill(CGRect(x: x, y: y, width: 1.5, height: 1.5))
        }
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        let radius = hypot(size.width, size.height) / 2
        let colors = [color(0x000000, 0), color(0x000000, 0.28)] as CFArray
        if let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: colors, locations: [0.55, 1]) {
            context.drawRadialGradient(gradient, startCenter: center, startRadius: 0, endCenter: center, endRadius: radius, options: [.drawsAfterEndLocation])
        }
    }

    /// Холмы синусоидами: `base` — средняя высота, `amplitude` — размах.
    static func hills(_ context: CGContext, _ size: CGSize, base: CGFloat, amplitude: CGFloat, frequency: CGFloat, phase: CGFloat, fill: CGColor) {
        let path = CGMutablePath()
        path.move(to: CGPoint(x: 0, y: size.height))
        let steps = 48
        for step in 0...steps {
            let x = size.width * CGFloat(step) / CGFloat(steps)
            let u = x / size.width
            let y = base - amplitude * (sin(u * .pi * frequency + phase) * 0.6 + sin(u * .pi * frequency * 2.3 + phase * 1.7) * 0.4)
            path.addLine(to: CGPoint(x: x, y: y))
        }
        path.addLine(to: CGPoint(x: size.width, y: size.height))
        path.closeSubpath()
        context.addPath(path)
        context.setFillColor(fill)
        context.fillPath()
    }

    static func sunset(_ context: CGContext, _ size: CGSize, _ t: CGFloat, _ rng: inout SeededGenerator) {
        let palettes: [[UInt32]] = [
            [0x2B1E4A, 0x8E3B6B, 0xF07D58, 0xFFD38A],
            [0x1D2B53, 0x7E2553, 0xFF6F59, 0xFFC857],
            [0x23395B, 0x406E8E, 0xF4A261, 0xF9E0AE],
        ]
        let palette = rng.pick(palettes)
        let rect = CGRect(origin: .zero, size: size)
        gradient(context, rect, palette)
        let sunX = size.width * (0.3 + unit(&rng) * 0.4)
        let sunY = size.height * (0.52 + 0.06 * sin(t * 2 * .pi))
        let radius = min(size.width, size.height) * 0.11
        glow(context, center: CGPoint(x: sunX, y: sunY), radius: radius * 4, color: 0xFFE7A8, alpha: 0.55)
        context.setFillColor(color(0xFFF1C9))
        context.fillEllipse(in: CGRect(x: sunX - radius, y: sunY - radius, width: radius * 2, height: radius * 2))
        // Облака-полоски.
        for index in 0..<5 {
            let y = size.height * (0.15 + 0.07 * CGFloat(index))
            let x = (unit(&rng) * size.width + t * size.width * 0.3).truncatingRemainder(dividingBy: size.width * 1.3) - size.width * 0.15
            context.setFillColor(color(0xFFB4A2, 0.25))
            context.fillEllipse(in: CGRect(x: x, y: y, width: size.width * 0.35, height: size.height * 0.018))
        }
        let layers: [UInt32] = [0x5B2C4E, 0x3E1F3D, 0x24132A]
        for (index, fill) in layers.enumerated() {
            hills(
                context, size, base: size.height * (0.66 + 0.1 * CGFloat(index)), amplitude: size.height * 0.05,
                frequency: 2 + CGFloat(index) + unit(&rng), phase: unit(&rng) * 6, fill: color(fill)
            )
        }
    }

    static func mountains(_ context: CGContext, _ size: CGSize, _ t: CGFloat, _ rng: inout SeededGenerator) {
        let skies: [[UInt32]] = [[0x4F86C6, 0x9CC3E6, 0xE8F1FA], [0xF6C28B, 0xF4A6A6, 0xB8C6E8], [0x2C3E73, 0x5D7EB5, 0xA9C6E8]]
        gradient(context, CGRect(origin: .zero, size: size), rng.pick(skies))
        // Облака дрейфуют.
        for _ in 0..<6 {
            let width = size.width * (0.18 + unit(&rng) * 0.2)
            let baseX = unit(&rng) * size.width
            let x = (baseX + t * size.width).truncatingRemainder(dividingBy: size.width + width) - width
            let y = size.height * (0.08 + unit(&rng) * 0.25)
            for puff in 0..<4 {
                let w = width * (0.4 + 0.15 * CGFloat(puff))
                context.setFillColor(color(0xFFFFFF, 0.55))
                context.fillEllipse(in: CGRect(x: x + CGFloat(puff) * width * 0.18, y: y - CGFloat(puff % 2) * width * 0.08, width: w, height: w * 0.45))
            }
        }
        let colors: [UInt32] = [0xA7B8CF, 0x7F93AF, 0x55677F, 0x2E3B4E]
        for layer in 0..<4 {
            let base = size.height * (0.42 + 0.13 * CGFloat(layer))
            let path = CGMutablePath()
            path.move(to: CGPoint(x: 0, y: size.height))
            var x: CGFloat = 0
            var peaks: [CGPoint] = []
            let step = size.width / CGFloat(8 + layer * 2)
            var high = true
            while x <= size.width + step {
                let y = high
                    ? base - size.height * (0.12 + unit(&rng) * 0.16) * (1 - CGFloat(layer) * 0.18)
                    : base - size.height * unit(&rng) * 0.05
                let point = CGPoint(x: x, y: y)
                path.addLine(to: point)
                if high { peaks.append(point) }
                high.toggle()
                x += step * (0.6 + unit(&rng) * 0.8)
            }
            path.addLine(to: CGPoint(x: size.width, y: size.height))
            path.closeSubpath()
            context.addPath(path)
            context.setFillColor(color(colors[layer]))
            context.fillPath()
            // Снег на вершинах дальних хребтов.
            if layer < 2 {
                context.setFillColor(color(0xF5F8FC, 0.95))
                for peak in peaks where peak.y < base - size.height * 0.1 {
                    let capWidth = size.width * 0.035
                    let capHeight = size.height * 0.04
                    let cap = CGMutablePath()
                    cap.move(to: peak)
                    cap.addLine(to: CGPoint(x: peak.x - capWidth, y: peak.y + capHeight))
                    cap.addLine(to: CGPoint(x: peak.x - capWidth * 0.3, y: peak.y + capHeight * 0.7))
                    cap.addLine(to: CGPoint(x: peak.x + capWidth * 0.2, y: peak.y + capHeight * 0.95))
                    cap.addLine(to: CGPoint(x: peak.x + capWidth, y: peak.y + capHeight))
                    cap.closeSubpath()
                    context.addPath(cap)
                    context.fillPath()
                }
            }
        }
    }

    static func sea(_ context: CGContext, _ size: CGSize, _ t: CGFloat, _ rng: inout SeededGenerator) {
        let horizon = size.height * (0.45 + unit(&rng) * 0.1)
        gradient(context, CGRect(x: 0, y: 0, width: size.width, height: horizon), [0x6CA6D9, 0xBFDDF2, 0xF7D9B5])
        gradient(context, CGRect(x: 0, y: horizon, width: size.width, height: size.height - horizon), [0x2E6F95, 0x154A6B, 0x0E3350])
        let sunX = size.width * (0.35 + unit(&rng) * 0.3)
        glow(context, center: CGPoint(x: sunX, y: horizon - size.height * 0.05), radius: size.width * 0.25, color: 0xFFF2D0, alpha: 0.7)
        // Дорожка солнца.
        for index in 0..<24 {
            let y = horizon + CGFloat(index) * (size.height - horizon) / 24
            let width = size.width * (0.04 + 0.012 * CGFloat(index)) * (0.6 + 0.4 * abs(sin(t * 2 * .pi + CGFloat(index))))
            context.setFillColor(color(0xFFF2D0, 0.5 - CGFloat(index) * 0.018))
            context.fill(CGRect(x: sunX - width / 2, y: y, width: width, height: 2))
        }
        // Волны.
        context.setLineWidth(max(1, size.height * 0.004))
        for row in 0..<14 {
            let y = horizon + (size.height - horizon) * (CGFloat(row) + 0.5) / 14
            let path = CGMutablePath()
            let amplitude = size.height * 0.004 * CGFloat(row + 1) * 0.5
            for step in 0...60 {
                let x = size.width * CGFloat(step) / 60
                let wave = sin(x / size.width * .pi * 12 + t * 2 * .pi * 2 + CGFloat(row)) * amplitude
                if step == 0 { path.move(to: CGPoint(x: x, y: y + wave)) } else { path.addLine(to: CGPoint(x: x, y: y + wave)) }
            }
            context.addPath(path)
            context.setStrokeColor(color(0xFFFFFF, 0.08 + CGFloat(row) * 0.008))
            context.strokePath()
        }
    }

    static func city(_ context: CGContext, _ size: CGSize, _ t: CGFloat, _ rng: inout SeededGenerator) {
        gradient(context, CGRect(origin: .zero, size: size), [0x0B1026, 0x2B2F5A, 0x5B4B7A])
        // Звёзды и луна.
        for _ in 0..<60 {
            context.setFillColor(color(0xFFFFFF, 0.3 + unit(&rng) * 0.5))
            context.fill(CGRect(x: unit(&rng) * size.width, y: unit(&rng) * size.height * 0.4, width: 1.5, height: 1.5))
        }
        let moon = CGPoint(x: size.width * (0.6 + unit(&rng) * 0.3), y: size.height * 0.18)
        glow(context, center: moon, radius: size.width * 0.12, color: 0xFFF6D8, alpha: 0.35)
        context.setFillColor(color(0xFFF6D8))
        let moonRadius = min(size.width, size.height) * 0.05
        context.fillEllipse(in: CGRect(x: moon.x - moonRadius, y: moon.y - moonRadius, width: moonRadius * 2, height: moonRadius * 2))
        let ground = size.height * 0.86
        var x: CGFloat = -size.width * 0.02
        let windowSize = max(2, size.width * 0.011)
        let flicker = Int(t * 6)
        var buildingIndex: UInt64 = 0
        while x < size.width {
            let width = size.width * (0.06 + unit(&rng) * 0.09)
            let height = size.height * (0.22 + unit(&rng) * 0.42)
            let rect = CGRect(x: x, y: ground - height, width: width, height: height)
            context.setFillColor(color(mix(0x15182B, 0x262B47, unit(&rng))))
            context.fill(rect)
            var wy = rect.minY + windowSize * 1.5
            var row: UInt64 = 0
            while wy < ground - windowSize * 2 {
                var wx = rect.minX + windowSize
                var column: UInt64 = 0
                while wx < rect.maxX - windowSize * 1.5 {
                    var hash = (buildingIndex &* 73_856_093) ^ (row &* 19_349_663) ^ (column &* 83_492_791)
                    hash ^= hash >> 13
                    var lit = hash % 100 < 38
                    if hash % 37 == 0, flicker % 2 == 1 { lit.toggle() }
                    if lit {
                        context.setFillColor(color(hash % 5 == 0 ? 0xBFE3FF : 0xFFD27A, 0.85))
                        context.fill(CGRect(x: wx, y: wy, width: windowSize, height: windowSize * 1.3))
                    }
                    wx += windowSize * 2
                    column += 1
                }
                wy += windowSize * 2.4
                row += 1
            }
            x += width + size.width * 0.005
            buildingIndex += 1
        }
        // Дорога и фары.
        context.setFillColor(color(0x101220))
        context.fill(CGRect(x: 0, y: ground, width: size.width, height: size.height - ground))
        for car in 0..<10 {
            let speed = 0.7 + CGFloat(car % 3) * 0.3
            let lane = car % 2 == 0
            var position = (CGFloat(car) / 10 + t * speed).truncatingRemainder(dividingBy: 1)
            if !lane { position = 1 - position }
            let carX = position * size.width * 1.2 - size.width * 0.1
            let y = ground + (size.height - ground) * (lane ? 0.35 : 0.7)
            let rgb: UInt32 = lane ? 0xFF4D4D : 0xFFF4C2
            glow(context, center: CGPoint(x: carX, y: y), radius: size.width * 0.03, color: rgb, alpha: 0.7)
            context.setFillColor(color(rgb))
            context.fillEllipse(in: CGRect(x: carX - 2, y: y - 2, width: 4, height: 4))
        }
    }

    static func coffee(_ context: CGContext, _ size: CGSize, _ t: CGFloat, _ rng: inout SeededGenerator) {
        let woods: [[UInt32]] = [[0x8B5A2B, 0x6E4421], [0xB08968, 0x7F5539], [0x5E3B24, 0x3E2716]]
        let wood = rng.pick(woods)
        gradient(context, CGRect(origin: .zero, size: size), wood, horizontal: true)
        // Волокна дерева.
        context.setLineWidth(max(1, size.height * 0.002))
        for _ in 0..<40 {
            let y = unit(&rng) * size.height
            let path = CGMutablePath()
            path.move(to: CGPoint(x: 0, y: y))
            path.addCurve(
                to: CGPoint(x: size.width, y: y + (unit(&rng) - 0.5) * size.height * 0.05),
                control1: CGPoint(x: size.width * 0.3, y: y + (unit(&rng) - 0.5) * size.height * 0.04),
                control2: CGPoint(x: size.width * 0.7, y: y + (unit(&rng) - 0.5) * size.height * 0.04)
            )
            context.addPath(path)
            context.setStrokeColor(color(0x000000, 0.08 + unit(&rng) * 0.08))
            context.strokePath()
        }
        let center = CGPoint(x: size.width * (0.45 + unit(&rng) * 0.1), y: size.height * 0.55)
        let r = min(size.width, size.height) * 0.33
        // Тень и блюдце.
        context.setFillColor(color(0x000000, 0.25))
        context.fillEllipse(in: CGRect(x: center.x - r + r * 0.08, y: center.y - r + r * 0.1, width: r * 2, height: r * 2))
        context.setFillColor(color(0xF4F1EC))
        context.fillEllipse(in: CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2))
        // Ручка.
        context.setFillColor(color(0xFFFFFF))
        let handle = CGRect(x: center.x + r * 0.62, y: center.y - r * 0.12, width: r * 0.38, height: r * 0.24)
        context.addPath(CGPath(roundedRect: handle, cornerWidth: r * 0.1, cornerHeight: r * 0.1, transform: nil))
        context.fillPath()
        let cup = r * 0.72
        context.fillEllipse(in: CGRect(x: center.x - cup, y: center.y - cup, width: cup * 2, height: cup * 2))
        let coffeeR = r * 0.6
        let crema = [color(0xD9B48A), color(0x8B5E3C), color(0x5A3A22)] as CFArray
        if let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: crema, locations: [0, 0.6, 1]) {
            context.saveGState()
            context.addEllipse(in: CGRect(x: center.x - coffeeR, y: center.y - coffeeR, width: coffeeR * 2, height: coffeeR * 2))
            context.clip()
            context.drawRadialGradient(gradient, startCenter: center, startRadius: 0, endCenter: center, endRadius: coffeeR, options: [])
            context.restoreGState()
        }
        // Латте-арт: сердце.
        let heart = CGMutablePath()
        let hs = coffeeR * 0.55
        heart.move(to: CGPoint(x: center.x, y: center.y + hs * 0.7))
        heart.addCurve(to: CGPoint(x: center.x - hs, y: center.y - hs * 0.2), control1: CGPoint(x: center.x - hs * 0.5, y: center.y + hs * 0.4), control2: CGPoint(x: center.x - hs, y: center.y + hs * 0.1))
        heart.addCurve(to: CGPoint(x: center.x, y: center.y - hs * 0.35), control1: CGPoint(x: center.x - hs, y: center.y - hs * 0.8), control2: CGPoint(x: center.x - hs * 0.15, y: center.y - hs * 0.75))
        heart.addCurve(to: CGPoint(x: center.x + hs, y: center.y - hs * 0.2), control1: CGPoint(x: center.x + hs * 0.15, y: center.y - hs * 0.75), control2: CGPoint(x: center.x + hs, y: center.y - hs * 0.8))
        heart.addCurve(to: CGPoint(x: center.x, y: center.y + hs * 0.7), control1: CGPoint(x: center.x + hs, y: center.y + hs * 0.1), control2: CGPoint(x: center.x + hs * 0.5, y: center.y + hs * 0.4))
        context.addPath(heart)
        context.setFillColor(color(0xF5E6D3, 0.92))
        context.fillPath()
        // Пар — только в анимации.
        if t > 0 {
            context.setLineWidth(r * 0.05)
            context.setLineCap(.round)
            for index in 0..<3 {
                let phase = (t + CGFloat(index) / 3).truncatingRemainder(dividingBy: 1)
                let x = center.x - r * 0.3 + CGFloat(index) * r * 0.3
                let y = center.y - cup - phase * r * 0.9
                let path = CGMutablePath()
                path.move(to: CGPoint(x: x, y: y + r * 0.3))
                path.addCurve(to: CGPoint(x: x, y: y - r * 0.2), control1: CGPoint(x: x + r * 0.15, y: y + r * 0.15), control2: CGPoint(x: x - r * 0.15, y: y))
                context.addPath(path)
                context.setStrokeColor(color(0xFFFFFF, 0.35 * (1 - phase)))
                context.strokePath()
            }
        }
    }

    static func cat(_ context: CGContext, _ size: CGSize, _ t: CGFloat, _ rng: inout SeededGenerator) {
        gradient(context, CGRect(origin: .zero, size: size), [0xF6D7B0, 0xE8A87C])
        // Окно со светом.
        let window = CGRect(x: size.width * 0.55, y: size.height * 0.08, width: size.width * 0.35, height: size.height * 0.45)
        gradient(context, window, [0xCFE8F7, 0xFFF4DE])
        context.setStrokeColor(color(0xFFFFFF))
        context.setLineWidth(max(2, size.width * 0.012))
        context.stroke(window)
        context.move(to: CGPoint(x: window.midX, y: window.minY))
        context.addLine(to: CGPoint(x: window.midX, y: window.maxY))
        context.strokePath()
        // Пол.
        context.setFillColor(color(0xB5835A))
        context.fill(CGRect(x: 0, y: size.height * 0.72, width: size.width, height: size.height * 0.28))
        let s = min(size.width, size.height)
        let base = CGPoint(x: size.width * (0.35 + unit(&rng) * 0.1), y: size.height * 0.74)
        let fur = color(rng.chance(0.5) ? 0x2B2B2B : 0x6B4A35)
        context.setFillColor(fur)
        // Хвост качается.
        let angle = sin(t * 2 * .pi) * 0.5
        let tail = CGMutablePath()
        tail.move(to: CGPoint(x: base.x + s * 0.16, y: base.y - s * 0.04))
        tail.addCurve(
            to: CGPoint(x: base.x + s * (0.3 + 0.08 * cos(angle)), y: base.y - s * (0.28 + 0.08 * sin(angle))),
            control1: CGPoint(x: base.x + s * 0.32, y: base.y - s * 0.02),
            control2: CGPoint(x: base.x + s * (0.36 + 0.05 * angle), y: base.y - s * 0.16)
        )
        context.addPath(tail)
        context.setStrokeColor(fur)
        context.setLineWidth(s * 0.035)
        context.setLineCap(.round)
        context.strokePath()
        // Тело, голова, уши.
        context.fillEllipse(in: CGRect(x: base.x - s * 0.18, y: base.y - s * 0.24, width: s * 0.36, height: s * 0.26))
        let head = CGRect(x: base.x - s * 0.17, y: base.y - s * 0.4, width: s * 0.2, height: s * 0.18)
        context.fillEllipse(in: head)
        for side in [0, 1] {
            let ear = CGMutablePath()
            let x = head.minX + (side == 0 ? s * 0.02 : s * 0.12)
            ear.move(to: CGPoint(x: x, y: head.minY + s * 0.04))
            ear.addLine(to: CGPoint(x: x + s * 0.03, y: head.minY - s * 0.04))
            ear.addLine(to: CGPoint(x: x + s * 0.06, y: head.minY + s * 0.03))
            ear.closeSubpath()
            context.addPath(ear)
            context.fillPath()
        }
        // Глаза.
        context.setFillColor(color(0xE8D44D))
        let blink = (t * 5).truncatingRemainder(dividingBy: 1) > 0.92 ? 0.15 : 1.0
        for dx in [s * 0.045, s * 0.125] {
            context.fillEllipse(in: CGRect(x: head.minX + dx, y: head.minY + s * 0.07, width: s * 0.03, height: s * 0.03 * blink))
        }
    }

    static func forest(_ context: CGContext, _ size: CGSize, _ t: CGFloat, _ rng: inout SeededGenerator) {
        gradient(context, CGRect(origin: .zero, size: size), [0xCFE7D3, 0x8CC2A0, 0x3E7C59])
        // Лучи.
        for index in 0..<4 {
            let x = size.width * (0.2 + 0.2 * CGFloat(index)) + sin(t * 2 * .pi + CGFloat(index)) * size.width * 0.02
            let ray = CGMutablePath()
            ray.move(to: CGPoint(x: x, y: 0))
            ray.addLine(to: CGPoint(x: x + size.width * 0.05, y: 0))
            ray.addLine(to: CGPoint(x: x + size.width * 0.25, y: size.height))
            ray.addLine(to: CGPoint(x: x + size.width * 0.12, y: size.height))
            ray.closeSubpath()
            context.addPath(ray)
            context.setFillColor(color(0xFFFFE0, 0.12))
            context.fillPath()
        }
        let layers: [UInt32] = [0x6FA382, 0x4C8565, 0x2F6046, 0x1B3D2C]
        for (layer, fill) in layers.enumerated() {
            let ground = size.height * (0.55 + 0.13 * CGFloat(layer))
            var x = -unit(&rng) * size.width * 0.05
            while x < size.width {
                let height = size.height * (0.25 + unit(&rng) * 0.2) * (0.7 + CGFloat(layer) * 0.15)
                let width = height * 0.45
                for tier in 0..<3 {
                    let tierTop = ground - height + CGFloat(tier) * height * 0.25
                    let tierWidth = width * (0.55 + 0.25 * CGFloat(tier))
                    let path = CGMutablePath()
                    path.move(to: CGPoint(x: x, y: tierTop))
                    path.addLine(to: CGPoint(x: x - tierWidth / 2, y: tierTop + height * 0.4))
                    path.addLine(to: CGPoint(x: x + tierWidth / 2, y: tierTop + height * 0.4))
                    path.closeSubpath()
                    context.addPath(path)
                    context.setFillColor(color(fill))
                    context.fillPath()
                }
                x += width * (0.5 + unit(&rng) * 0.6)
            }
            context.setFillColor(color(fill))
            context.fill(CGRect(x: 0, y: ground, width: size.width, height: size.height - ground))
        }
    }

    static func bokeh(_ context: CGContext, _ size: CGSize, _ t: CGFloat, _ rng: inout SeededGenerator) {
        gradient(context, CGRect(origin: .zero, size: size), [0x1A1A2E, 0x16213E, 0x0F3460])
        let palette: [UInt32] = [0xE94560, 0xF5B461, 0x53A8B6, 0xFFFFFF, 0xC77DFF]
        let scale = min(size.width, size.height)
        for _ in 0..<45 {
            let radius = scale * (0.02 + unit(&rng) * 0.1)
            let baseX = unit(&rng) * size.width
            let baseY = unit(&rng) * size.height
            let speed = 0.5 + unit(&rng)
            let phase = unit(&rng) * 2 * .pi
            let x = baseX + sin(t * 2 * .pi + phase) * scale * 0.04 * speed
            let y = baseY + cos(t * 2 * .pi + phase) * scale * 0.03 * speed
            let rgb = rng.pick(palette)
            let alpha = 0.12 + unit(&rng) * 0.25
            glow(context, center: CGPoint(x: x, y: y), radius: radius * 1.3, color: rgb, alpha: alpha)
            context.setFillColor(color(rgb, alpha * 0.7))
            context.fillEllipse(in: CGRect(x: x - radius, y: y - radius, width: radius * 2, height: radius * 2))
        }
    }

    // MARK: Кружок: «говорящее» лицо

    /// Стилизованное лицо: рот открывается по громкости записи, глаза моргают, фон
    /// медленно меняет оттенок. Приложение само обрезает кадр в круг.
    static func drawTalkingFace(in context: CGContext, size: CGSize, t: CGFloat, duration: Double, envelope: [UInt8], seed: UInt64) {
        var rng = SeededGenerator(seed: seed)
        let backgrounds: [[UInt32]] = [[0x8EC5FC, 0xE0C3FC], [0xFAD0C4, 0xFFD1FF], [0xA1C4FD, 0xC2E9FB], [0xD4FC79, 0x96E6A1]]
        let background = rng.pick(backgrounds)
        let shift = (sin(t * 2 * .pi) + 1) / 2
        gradient(context, CGRect(origin: .zero, size: size), [mix(background[0], background[1], shift), mix(background[1], background[0], shift)])
        let s = min(size.width, size.height)
        let sway = sin(t * 2 * .pi * 3) * s * 0.01
        let center = CGPoint(x: size.width / 2 + sway, y: size.height * 0.56)
        // Плечи.
        context.setFillColor(color(rng.pick([0x3D5A80, 0x6D597A, 0x2A9D8F, 0xE76F51])))
        context.fillEllipse(in: CGRect(x: center.x - s * 0.42, y: center.y + s * 0.26, width: s * 0.84, height: s * 0.6))
        // Волосы, голова.
        let hair = color(rng.pick([0x3B2A20, 0x6B4226, 0x1C1C1C, 0xA0522D]))
        context.setFillColor(hair)
        context.fillEllipse(in: CGRect(x: center.x - s * 0.27, y: center.y - s * 0.36, width: s * 0.54, height: s * 0.6))
        context.setFillColor(color(0xF2C9A5))
        let face = CGRect(x: center.x - s * 0.21, y: center.y - s * 0.26, width: s * 0.42, height: s * 0.5)
        context.fillEllipse(in: face)
        // Глаза моргают раз в ~3 секунды.
        let time = Double(t) * duration
        let blinking = time.truncatingRemainder(dividingBy: 3.1) < 0.12
        context.setFillColor(color(0x2B2B2B))
        for dx in [-s * 0.08, s * 0.08] {
            let eye = CGRect(x: center.x + dx - s * 0.025, y: center.y - s * 0.06, width: s * 0.05, height: blinking ? s * 0.008 : s * 0.05)
            context.fillEllipse(in: eye)
        }
        // Рот по громкости.
        let position = time / max(duration, 0.1) * Double(envelope.count - 1)
        let index = max(0, min(envelope.count - 1, Int(position)))
        let syllable = pow(sin(.pi * 4.5 * time), 2)
        let open = CGFloat(Double(envelope[index]) / 31 * (0.3 + 0.7 * syllable))
        let mouth = CGRect(x: center.x - s * 0.06, y: center.y + s * 0.1, width: s * 0.12, height: s * (0.012 + 0.06 * open))
        context.setFillColor(color(0x8E3B46))
        context.fillEllipse(in: mouth)
        // Щёки.
        context.setFillColor(color(0xF28C8C, 0.3))
        for dx in [-s * 0.13, s * 0.09] {
            context.fillEllipse(in: CGRect(x: center.x + dx, y: center.y + s * 0.04, width: s * 0.05, height: s * 0.03))
        }
    }
}

// MARK: - Документы

private enum Documents {
    static let a4 = CGRect(x: 0, y: 0, width: 595, height: 842)

    static func text(_ string: String, in rect: CGRect, size: CGFloat, weight: UIFont.Weight = .regular, color: UIColor = .black, alignment: NSTextAlignment = .left) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = alignment
        paragraph.lineSpacing = size * 0.25
        let attributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: size, weight: weight),
            .foregroundColor: color,
            .paragraphStyle: paragraph,
        ]
        (string as NSString).draw(with: rect, options: [.usesLineFragmentOrigin], attributes: attributes, context: nil)
    }

    static func lease(to url: URL) throws {
        let renderer = UIGraphicsPDFRenderer(bounds: a4)
        try renderer.writePDF(to: url) { context in
            context.beginPage()
            text("ДОГОВОР АРЕНДЫ ЖИЛОГО ПОМЕЩЕНИЯ № 14/2026", in: CGRect(x: 50, y: 50, width: 495, height: 24), size: 15, weight: .bold, alignment: .center)
            text("г. Алматы                                                                                     «1» октября 2026 г.", in: CGRect(x: 50, y: 84, width: 495, height: 16), size: 10)
            let body = """
            Иванова Мария Сергеевна (далее — «Арендодатель»), с одной стороны, и Соколова Алина Викторовна (далее — «Арендатор»), с другой стороны, заключили настоящий договор о нижеследующем.

            1. ПРЕДМЕТ ДОГОВОРА
            1.1. Арендодатель передаёт, а Арендатор принимает во временное пользование двухкомнатную квартиру общей площадью 54 кв. м, расположенную по адресу: г. Алматы, пр. Абая, д. 00, кв. 00 (адрес изменён для примера).
            1.2. Квартира передаётся с мебелью и бытовой техникой согласно акту приёма-передачи (Приложение 1).

            2. СРОК АРЕНДЫ
            2.1. Договор заключён сроком на 11 (одиннадцать) месяцев с 1 октября 2026 г.
            2.2. По окончании срока договор может быть продлён по соглашению сторон.

            3. АРЕНДНАЯ ПЛАТА И ПОРЯДОК РАСЧЁТОВ
            3.1. Ежемесячная арендная плата составляет 250 000 (двести пятьдесят тысяч) тенге.
            3.2. Оплата производится не позднее 5 числа текущего месяца.
            3.3. При подписании договора Арендатор вносит залог в размере одной месячной платы.
            3.4. Коммунальные платежи оплачиваются Арендатором по показаниям счётчиков.

            4. ОБЯЗАННОСТИ СТОРОН
            4.1. Арендатор обязуется бережно относиться к имуществу и своевременно вносить плату.
            4.2. Арендатору разрешается проживание с домашним животным (кот) при условии возмещения возможного ущерба.
            4.3. Арендодатель обязуется не посещать квартиру без предварительного согласования.
            """
            text(body, in: CGRect(x: 50, y: 116, width: 495, height: 680), size: 10.5)
            context.beginPage()
            let tail = """
            5. ОТВЕТСТВЕННОСТЬ СТОРОН
            5.1. За просрочку арендной платы Арендатор уплачивает пеню 0,1% от суммы за каждый день просрочки.
            5.2. Стороны освобождаются от ответственности при обстоятельствах непреодолимой силы.

            6. РАСТОРЖЕНИЕ ДОГОВОРА
            6.1. Каждая из сторон вправе расторгнуть договор, письменно предупредив другую сторону не менее чем за 30 дней.
            6.2. Залог возвращается Арендатору в течение 7 дней после передачи квартиры при отсутствии ущерба.

            7. ЗАКЛЮЧИТЕЛЬНЫЕ ПОЛОЖЕНИЯ
            7.1. Договор составлен в двух экземплярах, имеющих равную юридическую силу.
            7.2. Документ создан для демонстрации приложения; все данные вымышлены.
            """
            text(tail, in: CGRect(x: 50, y: 50, width: 495, height: 400), size: 10.5)
            text("Арендодатель: ____________ / Иванова М. С.", in: CGRect(x: 50, y: 520, width: 495, height: 16), size: 11)
            text("Арендатор:      ____________ / Соколова А. В.", in: CGRect(x: 50, y: 560, width: 495, height: 16), size: 11)
        }
    }

    static func tickets(to url: URL) throws {
        let renderer = UIGraphicsPDFRenderer(bounds: a4)
        try renderer.writePDF(to: url) { context in
            context.beginPage()
            text("Электронные проездные документы", in: CGRect(x: 50, y: 40, width: 495, height: 22), size: 16, weight: .bold)
            text("Демонстрационный документ. Не является билетом.", in: CGRect(x: 50, y: 66, width: 495, height: 14), size: 9, color: .gray)
            let passengers = [("СОКОЛОВА АЛИНА", "23"), ("ПАССАЖИР ВТОРОЙ", "24")]
            for (index, passenger) in passengers.enumerated() {
                let box = CGRect(x: 50, y: 100 + CGFloat(index) * 320, width: 495, height: 290)
                let cg = context.cgContext
                cg.setStrokeColor(UIColor(white: 0.75, alpha: 1).cgColor)
                cg.setLineWidth(1)
                cg.stroke(box)
                cg.setFillColor(UIColor(red: 0.12, green: 0.42, blue: 0.75, alpha: 1).cgColor)
                cg.fill(CGRect(x: box.minX, y: box.minY, width: box.width, height: 36))
                text("Поезд № 001Х «Тальго» · Алматы-2 → Астана Нурлы Жол", in: CGRect(x: box.minX + 14, y: box.minY + 10, width: box.width - 28, height: 18), size: 12, weight: .semibold, color: .white)
                let details = """
                Отправление: 14.11.2026 18:10 (время местное)
                Прибытие: 15.11.2026 07:05
                Вагон: 7 (купе)     Место: \(passenger.1)
                Пассажир: \(passenger.0)
                Документ: удостоверение личности № ••••\(4512 + index)
                Стоимость: 28 450 ₸ (включая сервисный сбор)
                Номер заказа: 7710-23\(index)8-ALA
                """
                text(details, in: CGRect(x: box.minX + 14, y: box.minY + 50, width: 300, height: 220), size: 11)
                // Квадрат-«код» (узор, а не настоящий QR).
                var rng = SeededGenerator(seed: UInt64(77 + index))
                let codeRect = CGRect(x: box.maxX - 170, y: box.minY + 60, width: 150, height: 150)
                let cells = 25
                let cell = codeRect.width / CGFloat(cells)
                cg.setFillColor(UIColor.black.cgColor)
                for row in 0..<cells {
                    for column in 0..<cells {
                        let finder = (row < 7 && column < 7) || (row < 7 && column >= cells - 7) || (row >= cells - 7 && column < 7)
                        let filled: Bool
                        if finder {
                            let r = row < 7 ? row : row - (cells - 7)
                            let c = column < 7 ? column : column - (cells - 7)
                            filled = r == 0 || r == 6 || c == 0 || c == 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)
                        } else {
                            filled = rng.next() % 2 == 0
                        }
                        if filled { cg.fill(CGRect(x: codeRect.minX + CGFloat(column) * cell, y: codeRect.minY + CGFloat(row) * cell, width: cell, height: cell)) }
                    }
                }
            }
        }
    }

    static let shoppingList = """
    Список покупок (суббота)

    [ ] Молоко 2,5% — 2 шт
    [ ] Хлеб бородинский
    [ ] Яйца — десяток
    [x] Кофе в зёрнах (эфиопия, светлая обжарка)
    [ ] Корм для Пикселя (лосось) — 3 пачки
    [ ] Яблоки кислые для шарлотки — 1 кг
    [ ] Сахар
    [ ] Сыр сулугуни
    [ ] Помидоры, огурцы, зелень
    [x] Батарейки АА для пульта
    [ ] Мешки для мусора
    [ ] Средство для мытья посуды

    Не забыть: забрать посылку на почте до 18:00!
    """

    static let budgetCSV = """
    Статья;Дата;Сумма, ₸;Кто платит;Комментарий
    Билеты на поезд Алматы — Астана;01.11.2026;56900;Пополам;Купе, вагон 7
    Апартаменты у Байтерека (2 ночи);03.11.2026;48000;Пополам;Бронь подтверждена
    Обратные авиабилеты;03.11.2026;62000;Пополам;Багаж 20 кг
    Такси из аэропорта;16.11.2026;6500;Алина;
    Музей и выставки;15.11.2026;8000;Пополам;Студенческая скидка не действует
    Еда и кофе;15.11.2026;35000;Пополам;Примерно
    Сувениры;16.11.2026;12000;Каждый сам;
    Итого;;228400;;
    """

    static func presentation(to url: URL) throws {
        let landscape = CGRect(x: 0, y: 0, width: 842, height: 595)
        let renderer = UIGraphicsPDFRenderer(bounds: landscape)
        let slides: [(String, [String])] = [
            ("Фотопроект «Старые дворы Алматы»", ["Автор: Алина Соколова", "Выставка · ноябрь 2026", "Документ для демонстрации"]),
            ("Идея", ["Год съёмки в 30 дворах центра города", "Разное время суток и сезоны", "Люди, детали, свет"]),
            ("Как снимали", ["Плёнка 35 мм и цифровая камера", "Рассветы — с 6:00 до 8:00", "Без постановки и вспышки"]),
            ("Цифры проекта", ["40 отобранных кадров", "15 работ на выставке", "3 партнёра-кофейни"]),
            ("Планы", ["Фотокнига к весне 2027", "Передвижная выставка", "Открытые прогулки с камерой"]),
        ]
        try renderer.writePDF(to: url) { context in
            for (index, slide) in slides.enumerated() {
                context.beginPage()
                let cg = context.cgContext
                cg.setFillColor(UIColor(red: 0.98, green: 0.96, blue: 0.93, alpha: 1).cgColor)
                cg.fill(landscape)
                cg.setFillColor(UIColor(red: 0.85, green: 0.45, blue: 0.3, alpha: 1).cgColor)
                cg.fill(CGRect(x: 0, y: 0, width: 16, height: landscape.height))
                text(slide.0, in: CGRect(x: 60, y: 60, width: 720, height: 50), size: 30, weight: .bold)
                for (line, bullet) in slide.1.enumerated() {
                    text("•  " + bullet, in: CGRect(x: 70, y: 150 + CGFloat(line) * 46, width: 420, height: 40), size: 20)
                }
                if index == 3 {
                    // Столбчатая диаграмма.
                    let values: [CGFloat] = [40, 15, 3, 30]
                    let labels = ["кадров", "на выставке", "партнёров", "дворов"]
                    for (bar, value) in values.enumerated() {
                        let height = value / 40 * 260
                        let rect = CGRect(x: 520 + CGFloat(bar) * 70, y: 480 - height, width: 44, height: height)
                        cg.setFillColor(UIColor(red: 0.2, green: 0.45 + CGFloat(bar) * 0.1, blue: 0.7, alpha: 1).cgColor)
                        cg.fill(rect)
                        text(labels[bar], in: CGRect(x: rect.minX - 13, y: 490, width: 70, height: 30), size: 10, alignment: .center)
                    }
                } else {
                    // Цветной «снимок»-заглушка из сюжетов.
                    let photo = CGRect(x: 520, y: 150, width: 260, height: 330)
                    cg.saveGState()
                    cg.clip(to: photo)
                    cg.translateBy(x: photo.minX, y: photo.minY)
                    Scene.draw(Scene.allCases[(index * 3) % Scene.allCases.count], in: cg, size: photo.size, t: 0, seed: UInt64(100 + index), photographic: false)
                    cg.restoreGState()
                }
                text("\(index + 1) / \(slides.count)", in: CGRect(x: 740, y: 550, width: 60, height: 20), size: 11, color: .gray, alignment: .right)
            }
        }
    }

    static func resume(to url: URL) throws {
        let renderer = UIGraphicsPDFRenderer(bounds: a4)
        try renderer.writePDF(to: url) { context in
            context.beginPage()
            let cg = context.cgContext
            cg.setFillColor(UIColor(red: 0.16, green: 0.24, blue: 0.36, alpha: 1).cgColor)
            cg.fill(CGRect(x: 0, y: 0, width: a4.width, height: 120))
            text("Алина Соколова", in: CGRect(x: 50, y: 34, width: 495, height: 34), size: 26, weight: .bold, color: .white)
            text("Фотограф · портрет, предметная и пейзажная съёмка · Алматы", in: CGRect(x: 50, y: 74, width: 495, height: 18), size: 12, color: UIColor(white: 0.9, alpha: 1))
            let body = """
            КОНТАКТЫ
            Телеграм: @alina_sokol (вымышленный) · Телефон: +7 700 555 01 23 (вымышленный)

            ОПЫТ
            2023 — н. в.   Фотограф-фрилансер
            Съёмки для кофеен, ресторанов и небольших брендов одежды. Серия «Кофе города» для сети из 12 кофеен.

            2020 — 2023   Фотограф, рекламное агентство «Горизонт» (вымышленное)
            Предметная съёмка для каталогов, ретушь, работа со светом в студии.

            2018 — 2020   Ассистент фотографа, свадебная студия
            Подготовка оборудования, второй ракурс, отбор и цветокоррекция.

            ОБРАЗОВАНИЕ
            Казахская академия искусств (вымышленный выпуск 2018), бакалавр, фотография и медиа.
            Курсы: портретная съёмка (2026), колористика в Capture One (2024).

            НАВЫКИ
            Lightroom, Capture One, Photoshop · студийный и импульсный свет · плёночная фотография · пейзаж в горах.

            ПРОЕКТЫ
            «Старые дворы Алматы» — персональная выставка, 2026.
            Фотопрогулки «Город на рассвете» — 20+ встреч.

            Документ создан для демонстрации приложения; все данные вымышлены.
            """
            text(body, in: CGRect(x: 50, y: 150, width: 495, height: 660), size: 11)
        }
    }
}
