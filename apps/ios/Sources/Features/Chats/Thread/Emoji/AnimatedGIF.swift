import ImageIO
import SwiftUI
import UIKit

/// Анимированные GIF в ленте и панели GIF.
///
/// SwiftUI `Image` анимацию не проигрывает — кадры отдаются `UIImageView`. Кадры
/// уменьшаются и их число ограничено: десяток GIF на экране не должен съедать сотни
/// мегабайт.
enum AnimatedGIF {
    /// Больше кадров — прореживаем, сохраняя общую длительность.
    static let maxFrames = 48
    static let maxSide: CGFloat = 360

    private static let cache: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 12
        return cache
    }()

    static func cached(_ key: String) -> UIImage? { cache.object(forKey: key as NSString) }

    /// Кадры GIF с длительностями; один кадр — обычная картинка.
    static func decode(_ data: Data, maxPixelSize: CGFloat, key: String? = nil) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let count = CGImageSourceGetCount(source)
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: min(maxPixelSize, maxSide),
        ]
        guard count > 1 else {
            return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary).map(UIImage.init(cgImage:))
        }
        let step = max(1, Int((Double(count) / Double(maxFrames)).rounded(.up)))
        var frames: [UIImage] = []
        var total: Double = 0
        for index in stride(from: 0, to: count, by: step) {
            guard let frame = CGImageSourceCreateThumbnailAtIndex(source, index, options as CFDictionary) else { continue }
            frames.append(UIImage(cgImage: frame))
            for skipped in index..<min(index + step, count) { total += delay(source, at: skipped) }
        }
        guard !frames.isEmpty else { return nil }
        let image = UIImage.animatedImage(with: frames, duration: max(total, 0.1)) ?? frames[0]
        if let key { cache.setObject(image, forKey: key as NSString) }
        return image
    }

    private static func delay(_ source: CGImageSource, at index: Int) -> Double {
        guard
            let properties = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any],
            let gif = properties[kCGImagePropertyGIFDictionary] as? [CFString: Any]
        else { return 0.1 }
        let value = (gif[kCGImagePropertyGIFUnclampedDelayTime] as? Double) ?? (gif[kCGImagePropertyGIFDelayTime] as? Double) ?? 0.1
        // Как браузеры: слишком короткая задержка — 0,1 с.
        return value < 0.02 ? 0.1 : value
    }
}

/// `UIImageView` для анимированной картинки; без движения — первый кадр.
struct AnimatedImageView: UIViewRepresentable {
    let image: UIImage
    var contentMode: UIView.ContentMode = .scaleAspectFill

    @Environment(\.motionReduced) private var reduceMotion

    func makeUIView(context: Context) -> UIImageView {
        let view = UIImageView()
        view.clipsToBounds = true
        view.setContentHuggingPriority(.defaultLow, for: .horizontal)
        view.setContentHuggingPriority(.defaultLow, for: .vertical)
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        return view
    }

    func updateUIView(_ view: UIImageView, context: Context) {
        view.contentMode = contentMode
        let shown = reduceMotion ? (image.images?.first ?? image) : image
        if view.image !== shown { view.image = shown }
    }
}
