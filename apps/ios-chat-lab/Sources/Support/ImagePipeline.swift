import UIKit
import ImageIO
import AVFoundation

/// Декодирование картинок вне главного потока и кеш готовых (уже распакованных) изображений.
/// Как `TransformImageNode` у Telegram: ячейка просит картинку нужного размера, получает
/// её из кеша сразу или асинхронно, и проверяет, что запрос всё ещё её.
final class ImagePipeline: @unchecked Sendable {
    static let shared = ImagePipeline()

    enum Source: Hashable {
        /// Фото (JPEG/PNG) — уменьшение до размера на экране.
        case photo(String)
        /// Первый кадр видео/кружка.
        case videoFrame(String)
        /// Первый кадр GIF.
        case gifPoster(String)
    }

    private let cache = NSCache<NSString, UIImage>()
    private let animatedCache = NSCache<NSString, UIImage>()
    private let queue = DispatchQueue(label: "ChatLab.images", qos: .userInitiated, attributes: .concurrent)
    private let lock = NSLock()
    private var inFlight: [String: [(UIImage?) -> Void]] = [:]

    private init() {
        cache.totalCostLimit = 96 * 1024 * 1024
        animatedCache.countLimit = 8
    }

    private func key(_ source: Source, pixelSize: CGSize) -> String {
        // Размер округляем вверх до 64 px, чтобы соседние размеры брали одну копию.
        let bucket = { (value: CGFloat) in Int(ceil(value / 64) * 64) }
        return "\(source)-\(bucket(pixelSize.width))x\(bucket(pixelSize.height))"
    }

    func cachedImage(_ source: Source, pointSize: CGSize, scale: CGFloat = UIScreen.main.scale) -> UIImage? {
        cache.object(forKey: key(source, pixelSize: pointSize.applying(.init(scaleX: scale, y: scale))) as NSString)
    }

    /// Картинка нужного размера. Завершение — на главном потоке; если картинка в кеше,
    /// возвращается сразу (синхронно) и завершение не вызывается.
    @discardableResult
    func load(
        _ source: Source, pointSize: CGSize, scale: CGFloat = UIScreen.main.scale,
        completion: @escaping @MainActor (UIImage?) -> Void
    ) -> UIImage? {
        let pixelSize = CGSize(width: pointSize.width * scale, height: pointSize.height * scale)
        let cacheKey = key(source, pixelSize: pixelSize)
        if let image = cache.object(forKey: cacheKey as NSString) { return image }

        lock.lock()
        let deliver: (UIImage?) -> Void = { image in
            DispatchQueue.main.async { MainActor.assumeIsolated { completion(image) } }
        }
        if inFlight[cacheKey] != nil {
            inFlight[cacheKey]?.append(deliver)
            lock.unlock()
            return nil
        }
        inFlight[cacheKey] = [deliver]
        lock.unlock()

        queue.async { [weak self] in
            guard let self else { return }
            let image = Self.decode(source, maxPixel: max(pixelSize.width, pixelSize.height))
            if let image {
                let cost = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
                self.cache.setObject(image, forKey: cacheKey as NSString, cost: cost)
            }
            self.lock.lock()
            let callbacks = self.inFlight.removeValue(forKey: cacheKey) ?? []
            self.lock.unlock()
            callbacks.forEach { $0(image) }
        }
        return nil
    }

    /// Предзагрузка ближайших к экрану медиа (вызывает лента из `prefetchItemsAt`).
    func prefetch(_ source: Source, pointSize: CGSize) {
        load(source, pointSize: pointSize) { _ in }
    }

    /// Анимированный GIF целиком (кадры распакованы заранее).
    func loadAnimated(_ file: String, maxPointSize: CGFloat, completion: @escaping @MainActor (UIImage?) -> Void) {
        if let image = animatedCache.object(forKey: file as NSString) {
            MainActor.assumeIsolated { completion(image) }
            return
        }
        let scale = UIScreen.main.scale
        queue.async { [weak self] in
            let image = Self.decodeGIF(MediaStorage.url(for: file), maxPixel: maxPointSize * scale)
            if let image { self?.animatedCache.setObject(image, forKey: file as NSString) }
            DispatchQueue.main.async { MainActor.assumeIsolated { completion(image) } }
        }
    }

    // MARK: Декодирование

    static func decode(_ source: Source, maxPixel: CGFloat) -> UIImage? {
        switch source {
        case let .photo(file), let .gifPoster(file):
            return downsample(url: MediaStorage.url(for: file), maxPixel: maxPixel)
        case let .videoFrame(file):
            return videoFrame(url: MediaStorage.url(for: file), maxPixel: maxPixel)
        }
    }

    static func downsample(url: URL, maxPixel: CGFloat) -> UIImage? {
        let options = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithURL(url as CFURL, options) else { return nil }
        let thumbnailOptions = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: max(1, maxPixel),
        ] as CFDictionary
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbnailOptions) else { return nil }
        return UIImage(cgImage: image)
    }

    static func videoFrame(url: URL, maxPixel: CGFloat) -> UIImage? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let asset = AVURLAsset(url: url)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: maxPixel, height: maxPixel)
        generator.requestedTimeToleranceBefore = .zero
        generator.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 2)
        let semaphore = DispatchSemaphore(value: 0)
        var result: CGImage?
        generator.generateCGImageAsynchronously(for: CMTime(value: 1, timescale: 10)) { image, _, _ in
            result = image
            semaphore.signal()
        }
        _ = semaphore.wait(timeout: .now() + 5)
        guard let result else { return nil }
        // Принудительная распаковка, чтобы главный поток не декодировал при показе.
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: result.width, height: result.height), format: {
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            format.opaque = true
            return format
        }())
        return renderer.image { _ in UIImage(cgImage: result).draw(at: .zero) }
    }

    static func decodeGIF(_ url: URL, maxPixel: CGFloat) -> UIImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        let count = CGImageSourceGetCount(source)
        guard count > 0 else { return nil }
        var frames: [UIImage] = []
        var duration: Double = 0
        let options = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: max(1, maxPixel),
        ] as CFDictionary
        for index in 0..<count {
            guard let frame = CGImageSourceCreateThumbnailAtIndex(source, index, options) else { continue }
            frames.append(UIImage(cgImage: frame))
            if let properties = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any],
               let gif = properties[kCGImagePropertyGIFDictionary] as? [CFString: Any] {
                let delay = (gif[kCGImagePropertyGIFUnclampedDelayTime] as? Double) ?? (gif[kCGImagePropertyGIFDelayTime] as? Double) ?? 0.1
                duration += delay < 0.02 ? 0.1 : delay
            } else {
                duration += 0.1
            }
        }
        return UIImage.animatedImage(with: frames, duration: duration)
    }
}
