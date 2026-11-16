import UIKit

/// Картинка из `data:` URL с кешем по самой строке: тот же QR при перерисовке экрана не
/// разбирается заново (P2-4 аудита).
enum DataURLImage {
    private static let cache: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 32
        return cache
    }()

    static func image(from string: String?) -> UIImage? {
        guard let string, !string.isEmpty else { return nil }
        let key = string as NSString
        if let known = cache.object(forKey: key) { return known }
        guard let data = DataURL.data(from: string), let image = UIImage(data: data) else { return nil }
        cache.setObject(image, forKey: key)
        return image
    }
}
