import Foundation
import UIKit
import os

/// Картинки в памяти.
///
/// Ключ — id файла (и ширина копии на сервере), а не ссылка: ссылки подписаны и
/// меняются при каждом обновлении ленты, и кэш по адресу промахивался бы всякий раз.
/// `NSCache` сам отпускает память, когда системе её не хватает; цена записи — байты
/// распакованного кадра.
///
/// На ключ хранится одна копия — самая крупная из декодированных: аватар, уже
/// показанный крупно, подходит и мелкой ячейке, а мелкая копия под крупную цель —
/// повод декодировать заново (`image(for:satisfying:)`).
final class ImageMemoryCache: @unchecked Sendable {
    static let shared = ImageMemoryCache()

    private final class Entry {
        let image: UIImage
        let isFullResolution: Bool
        let pixelWidth: Int
        let pixelHeight: Int

        init(_ decoded: DecodedImage) {
            image = decoded.image
            isFullResolution = decoded.isFullResolution
            pixelWidth = decoded.pixelWidth
            pixelHeight = decoded.pixelHeight
        }

        func satisfies(_ target: ImageTarget?) -> Bool {
            if isFullResolution { return true }
            guard let target else { return false }
            return target.isSatisfied(byWidth: pixelWidth, height: pixelHeight)
        }
    }

    private let cache: NSCache<NSString, Entry> = {
        let cache = NSCache<NSString, Entry>()
        cache.totalCostLimit = 80 * 1024 * 1024
        return cache
    }()

    private let lock = NSLock()
    private var generation = 0

    /// Растёт с каждой очисткой: загрузка, начатая до выхода из аккаунта, в кеш
    /// следующего человека свой кадр не положит.
    var currentGeneration: Int { lock.withLock { generation } }

    /// Любая копия по ключу — для первого кадра: показать сразу хоть что-то, а точную
    /// копию догрузить.
    func image(for key: String) -> UIImage? {
        cache.object(forKey: key as NSString)?.image
    }

    /// Копия, которой хватает под цель. `target == nil` — нужен полный кадр.
    func image(for key: String, satisfying target: ImageTarget?) -> UIImage? {
        guard let entry = cache.object(forKey: key as NSString), entry.satisfies(target) else { return nil }
        return entry.image
    }

    /// Выход из аккаунта: фото и аватары прежнего человека следующему ни к чему.
    func removeAll() {
        lock.withLock { generation += 1 }
        cache.removeAllObjects()
    }

    /// Положить готовую картинку как есть (кадр видео, превью): заменяет прежнюю.
    func store(_ image: UIImage, for key: String) {
        let decoded = DecodedImage(image: image, isFullResolution: false)
        cache.setObject(Entry(decoded), forKey: key as NSString, cost: decoded.byteCost)
    }

    /// Положить декодированную копию, если она крупнее той, что уже есть.
    func store(_ decoded: DecodedImage, for key: String) {
        if let existing = cache.object(forKey: key as NSString) {
            // Полный кадр уже есть — лучше не будет.
            if existing.isFullResolution { return }
            // Новая копия не полная и не крупнее — оставляем прежнюю.
            let existingArea = existing.pixelWidth * existing.pixelHeight
            let newArea = decoded.pixelWidth * decoded.pixelHeight
            if !decoded.isFullResolution, existingArea >= newArea { return }
        }
        cache.setObject(Entry(decoded), forKey: key as NSString, cost: decoded.byteCost)
    }

    /// Загрузка под размер `maxPixelSize` (длинная сторона в пикселях); `nil` — полный кадр.
    func load(_ url: URL, key: String, maxPixelSize: CGFloat? = nil) async -> UIImage? {
        await load(url, key: key, target: maxPixelSize.map { ImageTarget.longSide($0) })
    }

    /// Загрузка с декодированием вне главного потока под цель `target` (`nil` — полный
    /// кадр). Крупный JPEG, распакованный при первом показе, дёргает прокрутку; копия
    /// под размер вида делается прямо при декодировании (`ImageDownsampler`).
    func load(_ url: URL, key: String, target: ImageTarget?) async -> UIImage? {
        if let cached = image(for: key, satisfying: target) { return cached }
        let generation = currentGeneration
        let fetch = Signposts.images.beginInterval("ImageFetch")
        let loaded = try? await URLSession.shared.data(from: url)
        Signposts.images.endInterval("ImageFetch", fetch, "bytes: \(loaded?.0.count ?? 0)")
        guard
            let (data, response) = loaded,
            (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true
        else { return nil }
        // Ячейка ушла с экрана, пока шла сеть: декодировать уже незачем.
        guard !Task.isCancelled else { return nil }
        guard let decoded = await Self.decode(data, target: target) else { return nil }
        // Кеш очистили, пока шла загрузка (выход из аккаунта): кадр — не в кеш и не
        // на экран.
        guard currentGeneration == generation else { return nil }
        store(decoded, for: key)
        return image(for: key, satisfying: target) ?? decoded.image
    }

    /// Декодирование в отдельной задаче — явно не на главном потоке, кто бы ни звал.
    static func decode(_ data: Data, target: ImageTarget?) async -> DecodedImage? {
        await Task.detached(priority: Task.currentPriority) {
            let signpost = Signposts.images.beginInterval("ImageDecode")
            let decoded = ImageDownsampler.decode(data, target: target)
            Signposts.images.endInterval(
                "ImageDecode",
                signpost,
                "px: \(decoded?.pixelWidth ?? 0)x\(decoded?.pixelHeight ?? 0)"
            )
            return decoded
        }.value
    }
}
