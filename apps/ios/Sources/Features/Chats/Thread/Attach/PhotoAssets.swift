import Photos
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
