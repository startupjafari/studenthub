import Photos
import Observation
import UIKit

/// Чтение «Фото» для листа вложений: недавние снимки и ролики, миниатюры, исходные
/// данные. Доступ спрашивается только когда человек открыл галерею в листе.
enum PhotoAssets {
    enum Failure: LocalizedError {
        case unavailable

        var errorDescription: String? {
            String(localized: "chats.attach.assetUnavailable", defaultValue: "Не удалось прочитать файл из «Фото»")
        }
    }

    static var status: PHAuthorizationStatus {
        PHPhotoLibrary.authorizationStatus(for: .readWrite)
    }

    static func requestAccess() async -> PHAuthorizationStatus {
        await PHPhotoLibrary.requestAuthorization(for: .readWrite)
    }

    /// Свежие снимки и ролики альбома (`nil` — вся медиатека), новые первыми. Выборка
    /// растёт с медиатекой — звать не с главного потока.
    static func fetch(in album: PhotoAlbum?, limit: Int = 300) -> PHFetchResult<PHAsset> {
        let options = mediaOptions
        options.fetchLimit = limit
        if let album { return PHAsset.fetchAssets(in: album.collection, options: options) }
        return PHAsset.fetchAssets(with: options)
    }

    static func array(_ result: PHFetchResult<PHAsset>) -> [PHAsset] {
        var assets: [PHAsset] = []
        assets.reserveCapacity(result.count)
        result.enumerateObjects { asset, _, _ in assets.append(asset) }
        return assets
    }

    /// Исходные байты снимка (из iCloud — с докачкой) и его тип.
    static func imageData(for asset: PHAsset) async throws -> (Data, String?) {
        let options = PHImageRequestOptions()
        options.isNetworkAccessAllowed = true
        options.deliveryMode = .highQualityFormat
        options.version = .current
        return try await withCheckedThrowingContinuation { continuation in
            PHImageManager.default().requestImageDataAndOrientation(for: asset, options: options) { data, uti, _, _ in
                if let data {
                    continuation.resume(returning: (data, uti))
                } else {
                    continuation.resume(throwing: Failure.unavailable)
                }
            }
        }
    }

    /// Ролик во временный файл — потоком, без чтения в память.
    static func movieFile(for asset: PHAsset) async throws -> URL {
        let resources = PHAssetResource.assetResources(for: asset)
        guard let resource = resources.first(where: { $0.type == .fullSizeVideo })
            ?? resources.first(where: { $0.type == .video })
        else { throw Failure.unavailable }
        let ext = (resource.originalFilename as NSString).pathExtension
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("asset-\(UUID().uuidString).\(ext.isEmpty ? "mov" : ext)")
        let options = PHAssetResourceRequestOptions()
        options.isNetworkAccessAllowed = true
        try await PHAssetResourceManager.default().writeData(for: resource, toFile: url, options: options)
        return url
    }
}

// MARK: - Альбомы

/// Альбом «Фото» для выбора в шапке «Галереи», как в Telegram: «Недавние», «Избранное»,
/// «Видео», «Селфи» и прочие системные, за ними — свои альбомы человека.
struct PhotoAlbum: Identifiable, Hashable {
    let id: String
    let title: String
    let count: Int
    let collection: PHAssetCollection
}

extension PhotoAssets {
    /// Системные альбомы в порядке «Фото»; пустые не показываем.
    private static let smartAlbums: [PHAssetCollectionSubtype] = [
        .smartAlbumUserLibrary,
        .smartAlbumFavorites,
        .smartAlbumVideos,
        .smartAlbumSelfPortraits,
        .smartAlbumLivePhotos,
        .smartAlbumDepthEffect,
        .smartAlbumPanoramas,
        .smartAlbumTimelapses,
        .smartAlbumSlomoVideos,
        .smartAlbumBursts,
        .smartAlbumScreenshots,
    ]

    private static var mediaOptions: PHFetchOptions {
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        // Видео выключено с сервера — роликов в сетке нет: плитку, которую не отправить,
        // лучше не показывать (подготовка всё равно откажет, `AttachmentStaging`).
        options.predicate = AttachmentStaging.videoAllowed
            ? NSPredicate(
                format: "mediaType == %d OR mediaType == %d",
                PHAssetMediaType.image.rawValue,
                PHAssetMediaType.video.rawValue
            )
            : NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
        return options
    }

    /// Первым — «Недавние» (вся медиатека), дальше системные и свои альбомы с числом
    /// снимков. Счёт идёт по каждому альбому — только вне главного потока.
    static func albums() -> [PhotoAlbum] {
        var albums: [PhotoAlbum] = []
        for subtype in smartAlbums {
            let found = PHAssetCollection.fetchAssetCollections(with: .smartAlbum, subtype: subtype, options: nil)
            found.enumerateObjects { collection, _, _ in
                let count = PHAsset.fetchAssets(in: collection, options: mediaOptions).count
                guard count > 0 || subtype == .smartAlbumUserLibrary else { return }
                albums.append(PhotoAlbum(
                    id: collection.localIdentifier,
                    title: collection.localizedTitle ?? "",
                    count: count,
                    collection: collection
                ))
            }
        }
        let own = PHCollectionList.fetchTopLevelUserCollections(with: nil)
        own.enumerateObjects { item, _, _ in
            guard let collection = item as? PHAssetCollection else { return }
            let count = PHAsset.fetchAssets(in: collection, options: mediaOptions).count
            guard count > 0 else { return }
            albums.append(PhotoAlbum(
                id: collection.localIdentifier,
                title: collection.localizedTitle ?? "",
                count: count,
                collection: collection
            ))
        }
        return albums
    }

    /// Обложка альбома — его самый свежий снимок.
    static func cover(of album: PhotoAlbum) -> PHAsset? {
        let options = mediaOptions
        options.fetchLimit = 1
        return PHAsset.fetchAssets(in: album.collection, options: options).firstObject
    }
}

/// Альбомы для шапки «Галереи» и выбранный из них. `selected == nil` — «Недавние».
@Observable
final class PhotoAlbumsModel {
    private(set) var albums: [PhotoAlbum] = []
    private(set) var covers: [String: UIImage] = [:]
    var selected: PhotoAlbum?
    /// Идущее чтение альбомов: повторный вызов заменяет его, а не идёт параллельно.
    @ObservationIgnored private var loading: Task<Void, Never>?

    /// Название в шапке: выбранный альбом или «Недавние».
    var title: String {
        selected?.title ?? albums.first?.title
            ?? String(localized: "chats.attach.recents", defaultValue: "Недавние")
    }

    /// Перечитать альбомы — после выдачи доступа к «Фото». Счёт снимков в каждом альбоме
    /// и обложки растут с медиатекой: они читаются в фоне, на главный — готовый список
    /// (при большой медиатеке лист вложений иначе подвисал на открытии).
    /// `displayScale` — масштаб экрана самого листа (`\.displayScale`), а не устаревший
    /// `UIScreen.main`: на внешнем экране он другой (IOS_RULES 12.1.1).
    @MainActor
    func load(displayScale: CGFloat) {
        let status = PhotoAssets.status
        guard status == .authorized || status == .limited else { return }
        loading?.cancel()
        loading = Task { [weak self] in
            let (found, covers) = await Task.detached(priority: .userInitiated) {
                let found = PhotoAssets.albums()
                var covers: [(String, PHAsset)] = []
                for album in found {
                    if let cover = PhotoAssets.cover(of: album) { covers.append((album.id, cover)) }
                }
                return (found, covers)
            }.value
            guard let self, !Task.isCancelled else { return }
            self.albums = found
            self.requestCovers(covers, scale: displayScale)
        }
    }

    @MainActor
    private func requestCovers(_ assets: [(String, PHAsset)], scale: CGFloat) {
        let manager = PHImageManager.default()
        let options = PHImageRequestOptions()
        options.deliveryMode = .opportunistic
        options.resizeMode = .fast
        options.isNetworkAccessAllowed = true
        let side = 30 * scale
        for (id, asset) in assets where covers[id] == nil {
            manager.requestImage(
                for: asset,
                targetSize: CGSize(width: side, height: side),
                contentMode: .aspectFill,
                options: options
            ) { [weak self] image, _ in
                guard let image else { return }
                // В меню картинка встаёт в своём размере — сводим к значку 30 точек.
                let icon = Self.icon(from: image)
                DispatchQueue.main.async { self?.covers[id] = icon }
            }
        }
    }

    private static func icon(from image: UIImage) -> UIImage {
        let side: CGFloat = 30
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: side, height: side))
        return renderer.image { _ in
            let rect = CGRect(x: 0, y: 0, width: side, height: side)
            UIBezierPath(roundedRect: rect, cornerRadius: 6).addClip()
            let scale = max(side / image.size.width, side / image.size.height)
            let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
            image.draw(in: CGRect(
                x: (side - size.width) / 2,
                y: (side - size.height) / 2,
                width: size.width,
                height: size.height
            ))
        }
        .withRenderingMode(.alwaysOriginal)
    }
}

// MARK: - Снимки сетки и изменения медиатеки

/// Снимки выбранного альбома для сетки листа и изменения «Фото», пока лист открыт.
///
/// Выборка и её разбор растут с медиатекой — всё на своей последовательной очереди, на
/// главный приходит готовый список. Изменение (снимок сделан, удалён в «Фото», отредактирован)
/// разбирается по последней выборке этой же очереди и отдаётся одним списком: сетка
/// применяет его одной операцией, без перечитывания с нуля при следующем открытии.
final class PhotoLibraryFeed: NSObject, PHPhotoLibraryChangeObserver, @unchecked Sendable {
    /// Изменение медиатеки: новый список снимков альбома (`nil` — альбом не задет) и само
    /// изменение — по нему сетка убирает из выбора удалённые снимки. `PHChange` и `PHAsset`
    /// неизменяемы, читать их можно из любого потока.
    struct Update: @unchecked Sendable {
        let change: PHChange
        let assets: [PHAsset]?
    }

    private let queue = DispatchQueue(label: "studenthub.photos.feed", qos: .userInitiated)
    /// Последняя выборка — только на `queue`.
    private var result: PHFetchResult<PHAsset>?
    /// Получатель изменений — только на `queue`.
    private var subscriber: AsyncStream<Update>.Continuation?
    /// Наблюдатель записан в «Фото» — только на главном (`load` зовёт сетка).
    private var registered = false

    deinit {
        if registered { PHPhotoLibrary.shared().unregisterChangeObserver(self) }
        subscriber?.finish()
    }

    /// Снимки альбома (`nil` — «Недавние»), выбранные в фоне.
    @MainActor
    func load(_ album: PhotoAlbum?) async -> [PHAsset] {
        if !registered {
            registered = true
            PHPhotoLibrary.shared().register(self)
        }
        return await withCheckedContinuation { continuation in
            queue.async { [self] in
                let fetched = PhotoAssets.fetch(in: album)
                result = fetched
                continuation.resume(returning: PhotoAssets.array(fetched))
            }
        }
    }

    /// Поток изменений для сетки на экране; новый вызов заменяет прежнего получателя.
    func changes() -> AsyncStream<Update> {
        let (stream, continuation) = AsyncStream.makeStream(of: Update.self)
        queue.async { [self] in
            subscriber?.finish()
            subscriber = continuation
        }
        return stream
    }

    func photoLibraryDidChange(_ change: PHChange) {
        queue.async { [self] in
            var assets: [PHAsset]?
            if let result, let details = change.changeDetails(for: result) {
                let after = details.fetchResultAfterChanges
                self.result = after
                assets = PhotoAssets.array(after)
            }
            subscriber?.yield(Update(change: change, assets: assets))
        }
    }
}

// MARK: - Миниатюры плиток

/// Миниатюры плиток листа вложений.
///
/// Плитка берёт снимок только с устройства (`opportunistic`, без сети): прокрутка сетки при
/// медиатеке в iCloud не гонит сеть и батарею. Снимок, которого на устройстве нет, плитка
/// докачивает сама, только простояв на экране, и не больше двух разом (`cloudImage`).
///
/// `PHCachingImageManager` греет окно вокруг видимых плиток тем же размером, режимом и
/// опциями, что у запроса плитки: кеш под другой размер бесполезен. Окно — по одному
/// вызову на всю добавленную или ушедшую часть.
@MainActor
final class PhotoThumbnails {
    enum Delivery {
        case image(UIImage, isFinal: Bool)
        /// На устройстве снимка нет — только в iCloud.
        case inCloud
    }

    /// Окно прогрева в плитках: два ряда позади видимых и четыре впереди (три колонки).
    nonisolated static let behind = 6
    nonisolated static let ahead = 12
    private static let networkSlots = 2

    private let manager = PHCachingImageManager()
    private var assets: [PHAsset] = []
    private var index: [String: Int] = [:]
    private var visible: Set<String> = []
    private var warmed: Range<Int> = 0..<0
    private var side: CGFloat = 0
    private var freeNetwork = PhotoThumbnails.networkSlots
    private var waiting: [CheckedContinuation<Void, Never>] = []

    private var targetSize: CGSize { CGSize(width: side, height: side) }

    private nonisolated static var localOptions: PHImageRequestOptions {
        let options = PHImageRequestOptions()
        options.deliveryMode = .opportunistic
        options.resizeMode = .fast
        options.isNetworkAccessAllowed = false
        return options
    }

    private nonisolated static var networkOptions: PHImageRequestOptions {
        let options = PHImageRequestOptions()
        options.deliveryMode = .highQualityFormat
        options.resizeMode = .fast
        options.isNetworkAccessAllowed = true
        return options
    }

    /// Новый список снимков сетки: прогрев начинается заново.
    func reset(_ assets: [PHAsset], side: CGFloat) {
        manager.stopCachingImagesForAllAssets()
        self.assets = assets
        self.side = side
        index = Dictionary(assets.enumerated().map { ($1.localIdentifier, $0) }, uniquingKeysWith: { first, _ in first })
        warmed = 0..<0
        rewarm()
    }

    func appeared(_ id: String) {
        visible.insert(id)
        rewarm()
    }

    func disappeared(_ id: String) {
        visible.remove(id)
        rewarm()
    }

    /// Окно прогрева вокруг видимых плиток в границах списка.
    nonisolated static func window(visible: [Int], count: Int, behind: Int, ahead: Int) -> Range<Int> {
        guard count > 0, let low = visible.min(), let high = visible.max() else { return 0..<0 }
        let lower = min(max(0, low - behind), count)
        return lower..<max(lower, min(count, high + ahead + 1))
    }

    private func rewarm() {
        guard side > 0 else { return }
        let window = Self.window(
            visible: visible.compactMap { index[$0] },
            count: assets.count,
            behind: Self.behind,
            ahead: Self.ahead
        )
        guard window != warmed else { return }
        let old = warmed
        warmed = window
        let stop = old.filter { !window.contains($0) }.map { assets[$0] }
        let start = window.filter { !old.contains($0) }.map { assets[$0] }
        if !stop.isEmpty {
            manager.stopCachingImages(for: stop, targetSize: targetSize, contentMode: .aspectFill, options: Self.localOptions)
        }
        if !start.isEmpty {
            manager.startCachingImages(for: start, targetSize: targetSize, contentMode: .aspectFill, options: Self.localOptions)
        }
    }

    /// Миниатюра с устройства: сначала грубая, затем точная; снимка нет — `.inCloud`.
    /// Плитка ушла — запрос отменяется.
    func images(for asset: PHAsset) -> AsyncStream<Delivery> {
        let manager = manager
        let size = targetSize
        return AsyncStream { continuation in
            let id = manager.requestImage(
                for: asset,
                targetSize: size,
                contentMode: .aspectFill,
                options: Self.localOptions
            ) { image, info in
                let degraded = (info?[PHImageResultIsDegradedKey] as? Bool) ?? false
                if let image { continuation.yield(.image(image, isFinal: !degraded)) }
                guard !degraded else { return }
                if image == nil, (info?[PHImageResultIsInCloudKey] as? Bool) == true {
                    continuation.yield(.inCloud)
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in manager.cancelImageRequest(id) }
        }
    }

    /// Миниатюра снимка, который есть только в iCloud. Разом — не больше двух загрузок,
    /// свежая плитка первой: ранние могли уже уехать при прокрутке.
    func cloudImage(for asset: PHAsset) async -> UIImage? {
        await acquireNetwork()
        defer { releaseNetwork() }
        guard !Task.isCancelled else { return nil }
        let request = CloudRequest()
        let manager = manager
        let size = targetSize
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                request.start(continuation) {
                    manager.requestImage(
                        for: asset,
                        targetSize: size,
                        contentMode: .aspectFill,
                        options: Self.networkOptions
                    ) { image, _ in
                        request.finish(image)
                    }
                }
            }
        } onCancel: {
            request.cancel(manager)
        }
    }

    private func acquireNetwork() async {
        if freeNetwork > 0 {
            freeNetwork -= 1
            return
        }
        await withCheckedContinuation { waiting.append($0) }
    }

    private func releaseNetwork() {
        if let next = waiting.popLast() {
            next.resume()
        } else {
            freeNetwork += 1
        }
    }
}

/// Один запрос снимка из iCloud: ответ или отмена завершают ожидание ровно один раз —
/// у отменённого запроса «Фото» может и не позвать обработчик.
private final class CloudRequest: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<UIImage?, Never>?
    private var id = PHInvalidImageRequestID
    private var cancelled = false

    func start(_ continuation: CheckedContinuation<UIImage?, Never>, request: () -> PHImageRequestID) {
        let alreadyCancelled = lock.withLock {
            self.continuation = continuation
            return cancelled
        }
        if alreadyCancelled {
            finish(nil)
            return
        }
        let id = request()
        lock.withLock { self.id = id }
    }

    func finish(_ image: UIImage?) {
        let waiting = lock.withLock {
            defer { continuation = nil }
            return continuation
        }
        waiting?.resume(returning: image)
    }

    func cancel(_ manager: PHImageManager) {
        let id = lock.withLock {
            cancelled = true
            return self.id
        }
        if id != PHInvalidImageRequestID { manager.cancelImageRequest(id) }
        finish(nil)
    }
}
