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

    /// Свежие снимки и ролики, новые первыми.
    static func recent(limit: Int = 300) -> [PHAsset] {
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        options.predicate = NSPredicate(
            format: "mediaType == %d OR mediaType == %d",
            PHAssetMediaType.image.rawValue,
            PHAssetMediaType.video.rawValue
        )
        options.fetchLimit = limit
        let result = PHAsset.fetchAssets(with: options)
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
        options.predicate = NSPredicate(
            format: "mediaType == %d OR mediaType == %d",
            PHAssetMediaType.image.rawValue,
            PHAssetMediaType.video.rawValue
        )
        return options
    }

    /// Первым — «Недавние» (вся медиатека), дальше системные и свои альбомы с числом
    /// снимков.
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

    /// Снимки и ролики альбома, новые первыми.
    static func assets(in album: PhotoAlbum, limit: Int = 300) -> [PHAsset] {
        let options = mediaOptions
        options.fetchLimit = limit
        let result = PHAsset.fetchAssets(in: album.collection, options: options)
        var assets: [PHAsset] = []
        assets.reserveCapacity(result.count)
        result.enumerateObjects { asset, _, _ in assets.append(asset) }
        return assets
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

    /// Название в шапке: выбранный альбом или «Недавние».
    var title: String {
        selected?.title ?? albums.first?.title
            ?? String(localized: "chats.attach.recents", defaultValue: "Недавние")
    }

    /// Перечитать альбомы — после выдачи доступа к «Фото».
    @MainActor
    func load() {
        let status = PhotoAssets.status
        guard status == .authorized || status == .limited else { return }
        albums = PhotoAssets.albums()
        let manager = PHImageManager.default()
        let options = PHImageRequestOptions()
        options.deliveryMode = .opportunistic
        options.resizeMode = .fast
        options.isNetworkAccessAllowed = true
        let side = 30 * UIScreen.main.scale
        for album in albums where covers[album.id] == nil {
            guard let asset = PhotoAssets.cover(of: album) else { continue }
            manager.requestImage(
                for: asset,
                targetSize: CGSize(width: side, height: side),
                contentMode: .aspectFill,
                options: options
            ) { [weak self] image, _ in
                guard let image else { return }
                // В меню картинка встаёт в своём размере — сводим к значку 30 точек.
                let icon = Self.icon(from: image)
                DispatchQueue.main.async { self?.covers[album.id] = icon }
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
