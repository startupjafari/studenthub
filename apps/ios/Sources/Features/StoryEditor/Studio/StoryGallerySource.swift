@preconcurrency import AVFoundation
import Photos
import UIKit

struct StoryGalleryItem: Identifiable, Hashable, Sendable {
    let id: String
    let isVideo: Bool
    let duration: Double
}

struct StoryGalleryAlbum: Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    let count: Int
}

/// Медиа для галереи редактора: «Фото» или синтетика тестов.
@MainActor
protocol StoryGallerySource: AnyObject {
    func requestAccess() async -> Bool
    func albums() async -> [StoryGalleryAlbum]
    func load(album: StoryGalleryAlbum?) async -> [StoryGalleryItem]
    /// Миниатюра плитки: сначала грубая, затем точная. Кеш и прогрев — внутри.
    func thumbnail(for item: StoryGalleryItem, side: CGFloat) -> AsyncStream<UIImage>
    func appeared(_ item: StoryGalleryItem)
    func disappeared(_ item: StoryGalleryItem)
    /// Исходник в рабочую папку редактора — документ, готовый к правке.
    func importMedia(_ item: StoryGalleryItem, into workspace: StoryWorkspace) async throws -> StoryDocument
    /// Картинка для объекта «фото поверх» — без видео.
    func image(for item: StoryGalleryItem, maxSide: CGFloat) async throws -> UIImage
}

/// Галерея из «Фото». Миниатюры — общий кеш с прогревом окна (`PhotoThumbnails`, тот же,
/// что у листа вложений чата): оригиналы не декодируются, пока снимок не выбран.
@MainActor
final class StoryPhotosGallery: StoryGallerySource {
    private let feed = PhotoLibraryFeed()
    private let thumbnails = PhotoThumbnails()
    private var assets: [String: PHAsset] = [:]
    private var collections: [String: PhotoAlbum] = [:]
    private var side: CGFloat = 0

    func requestAccess() async -> Bool {
        switch PhotoAssets.status {
        case .authorized, .limited: return true
        case .notDetermined:
            let status = await PhotoAssets.requestAccess()
            return status == .authorized || status == .limited
        default: return false
        }
    }

    func albums() async -> [StoryGalleryAlbum] {
        let found = await Task.detached(priority: .userInitiated) { PhotoAssets.albums() }.value
        collections = Dictionary(found.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return found.map { StoryGalleryAlbum(id: $0.id, title: $0.title, count: $0.count) }
    }

    func load(album: StoryGalleryAlbum?) async -> [StoryGalleryItem] {
        let fetched = await feed.load(album.flatMap { collections[$0.id] })
        assets = Dictionary(fetched.map { ($0.localIdentifier, $0) }, uniquingKeysWith: { first, _ in first })
        if side > 0 { thumbnails.reset(fetched, side: side) }
        return fetched.map {
            StoryGalleryItem(id: $0.localIdentifier, isVideo: $0.mediaType == .video, duration: $0.duration)
        }
    }

    func thumbnail(for item: StoryGalleryItem, side: CGFloat) -> AsyncStream<UIImage> {
        if side != self.side {
            self.side = side
            thumbnails.reset(Array(assets.values), side: side)
        }
        guard let asset = assets[item.id] else { return AsyncStream { $0.finish() } }
        let source = thumbnails.images(for: asset)
        let thumbnails = thumbnails
        return AsyncStream { continuation in
            let task = Task { @MainActor in
                var inCloud = false
                for await delivery in source {
                    switch delivery {
                    case .image(let image, _): continuation.yield(image)
                    case .inCloud: inCloud = true
                    }
                }
                if inCloud, let image = await thumbnails.cloudImage(for: asset) { continuation.yield(image) }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    func appeared(_ item: StoryGalleryItem) { thumbnails.appeared(item.id) }
    func disappeared(_ item: StoryGalleryItem) { thumbnails.disappeared(item.id) }

    func importMedia(_ item: StoryGalleryItem, into workspace: StoryWorkspace) async throws -> StoryDocument {
        guard let asset = assets[item.id] else { throw PhotoAssets.Failure.unavailable }
        if asset.mediaType == .video {
            let url = try await PhotoAssets.movieFile(for: asset)
            return try await StoryMediaImport.videoDocument(at: url, workspace: workspace)
        }
        let image = try await image(for: item, maxSide: StoryMediaImport.maxPhotoSide)
        return try await Task.detached(priority: .userInitiated) {
            try StoryMediaImport.photoDocument(image, workspace: workspace)
        }.value
    }

    func image(for item: StoryGalleryItem, maxSide: CGFloat) async throws -> UIImage {
        guard let asset = assets[item.id] else { throw PhotoAssets.Failure.unavailable }
        let (data, _) = try await PhotoAssets.imageData(for: asset)
        return try await Task.detached(priority: .userInitiated) {
            guard let image = UIImage(data: data) else { throw PhotoAssets.Failure.unavailable }
            return StoryMediaImport.normalized(image, maxSide: maxSide)
        }.value
    }
}

/// Синтетическая галерея для UI-тестов: детерминированные снимки с номерами и пара
/// роликов — без разрешений и без «Фото» симулятора.
@MainActor
final class StorySyntheticGallery: StoryGallerySource {
    static let count = 60
    private var cache: [String: UIImage] = [:]

    func requestAccess() async -> Bool { true }

    func albums() async -> [StoryGalleryAlbum] {
        [StoryGalleryAlbum(id: "synthetic.videos", title: "Видео", count: Self.count / 7)]
    }

    func load(album: StoryGalleryAlbum?) async -> [StoryGalleryItem] {
        let all = (1...Self.count).map { index in
            StoryGalleryItem(id: "synthetic-\(index)", isVideo: index % 7 == 0, duration: index % 7 == 0 ? 3 : 0)
        }
        return album == nil ? all : all.filter(\.isVideo)
    }

    func thumbnail(for item: StoryGalleryItem, side: CGFloat) -> AsyncStream<UIImage> {
        let image = picture(item, size: CGSize(width: 240, height: 240))
        return AsyncStream { continuation in
            continuation.yield(image)
            continuation.finish()
        }
    }

    func appeared(_ item: StoryGalleryItem) {}
    func disappeared(_ item: StoryGalleryItem) {}

    func importMedia(_ item: StoryGalleryItem, into workspace: StoryWorkspace) async throws -> StoryDocument {
        let image = picture(item, size: CGSize(width: 1200, height: 1600))
        if item.isVideo {
            let url = workspace.url(for: workspace.newFile(extension: "mp4"))
            try await StorySyntheticVideo.write(frame: image, seconds: item.duration, to: url)
            return try await StoryMediaImport.videoDocument(at: url, workspace: workspace)
        }
        return try StoryMediaImport.photoDocument(image, workspace: workspace)
    }

    func image(for item: StoryGalleryItem, maxSide: CGFloat) async throws -> UIImage {
        picture(item, size: CGSize(width: 800, height: 600))
    }

    private func picture(_ item: StoryGalleryItem, size: CGSize) -> UIImage {
        let key = "\(item.id)-\(Int(size.width))"
        if let cached = cache[key] { return cached }
        let index = Int(item.id.split(separator: "-").last ?? "1") ?? 1
        let image = StorySimulatedCamera.frame(index: index, position: .back, size: size)
        cache[key] = image
        return image
    }
}
