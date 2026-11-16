import CoreGraphics
import Foundation
import ImageIO

/// Декодирование картинок с уменьшением прямо при чтении. Здесь, в ядре, — только то,
/// что не строит `UIImage`: размер оригинала нужен загрузчику (`ImageDownloads`) для
/// проверки байтов. Сборка готового кадра — `ImageDownsampler.decode` в
/// `DesignSystem/Images/ImageDecoding.swift`: ядро без UIKit (`docs/IOS_RULES.md` 9.1.3).
///
/// Только чистые функции без состояния — зовутся вне главного потока.
enum ImageDownsampler {
    /// Размер оригинала с учётом поворота из EXIF: снимок «на боку» хранится шириной
    /// вместо высоты, а копия строится уже повёрнутой.
    static func pixelSize(of source: CGImageSource) -> (width: Int, height: Int) {
        guard let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else {
            return (0, 0)
        }
        let width = (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue ?? 0
        let height = (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue ?? 0
        let orientation = (properties[kCGImagePropertyOrientation] as? NSNumber)?.intValue ?? 1
        return orientation >= 5 ? (height, width) : (width, height)
    }
}
