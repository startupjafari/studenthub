import CoreGraphics
import Foundation
import ImageIO
import UIKit

/// Готовая к показу (уже распакованная) картинка.
///
/// `@unchecked Sendable`: `UIImage` неизменяема, а распакованный кадр после создания
/// никто не трогает — переносить его из фонового декодирования на главный поток можно.
struct DecodedImage: @unchecked Sendable {
    let image: UIImage
    /// Полный кадр оригинала: подходит под любую цель.
    let isFullResolution: Bool

    var pixelWidth: Int { image.cgImage?.width ?? Int(image.size.width * image.scale) }
    var pixelHeight: Int { image.cgImage?.height ?? Int(image.size.height * image.scale) }

    /// Память распакованного кадра — цена записи в `NSCache`.
    var byteCost: Int {
        if let cgImage = image.cgImage { return cgImage.bytesPerRow * cgImage.height }
        return pixelWidth * pixelHeight * 4
    }
}

/// Декодирование с уменьшением прямо при чтении (`CGImageSource`): из JPEG в 12 Мп для
/// плитки в 360 pt получается копия под плитку, а не 48 МБ распакованного кадра.
///
/// Только чистые функции без состояния — зовутся вне главного потока. Сам тип и размер
/// оригинала — в ядре (`Core/Images/ImageDownsampler.swift`): размер нужен загрузчику, а
/// ядро не знает `UIImage` (`docs/IOS_RULES.md` 9.1.3); здесь — сборка `UIImage`.
extension ImageDownsampler {
    static func decode(_ data: Data, target: ImageTarget?) -> DecodedImage? {
        let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else { return nil }
        let (sourceWidth, sourceHeight) = pixelSize(of: source)
        let longest = max(sourceWidth, sourceHeight)
        guard longest > 0 else {
            // Размеров в заголовке нет (редкий формат) — как раньше, целиком.
            guard let image = UIImage(data: data) else { return nil }
            return DecodedImage(image: image.preparingForDisplay() ?? image, isFullResolution: true)
        }
        let wanted = target.map { $0.longSide(sourceWidth: sourceWidth, sourceHeight: sourceHeight) } ?? longest
        let side = min(wanted, longest)
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            // Распаковать сейчас, в фоне, а не при первом показе на главном потоке.
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: side,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return DecodedImage(image: UIImage(cgImage: image), isFullResolution: side >= longest)
    }
}
