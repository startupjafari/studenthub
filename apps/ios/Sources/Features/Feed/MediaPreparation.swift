import AVFoundation
import CoreTransferable
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Файл, готовый к загрузке: тело, тип и превью для редактора.
struct PreparedMedia: Identifiable, Equatable {
    let id = UUID()
    let data: Data
    let mime: String
    let filename: String
    let preview: UIImage?
    var isVideo: Bool { mime.hasPrefix("video/") }

    static func == (lhs: PreparedMedia, rhs: PreparedMedia) -> Bool { lhs.id == rhs.id }
}

/// Перевод выбранного в галерее в то, что принимает сервер.
///
/// Камера iPhone снимает в HEIC и MOV. Сервер берёт фото JPEG/PNG/WebP и видео MP4 (для
/// историй — только MP4), поэтому фото перекодируется в JPEG с ужатием длинной стороны,
/// а видео — в MP4. Заодно ужатие держит фото под порогом загрузки одним запросом.
enum MediaPreparation {
    /// Больше — загрузка частями (план 21.A4), которой в приложении пока нет.
    static let maxUploadBytes = 50 * 1024 * 1024
    private static let maxImageSide: CGFloat = 2560

    enum Failure: LocalizedError {
        case unreadable
        case tooLarge

        var errorDescription: String? {
            switch self {
            case .unreadable:
                return String(localized: "media.unreadable", defaultValue: "Не удалось прочитать файл")
            case .tooLarge:
                return String(
                    localized: "media.tooLarge",
                    defaultValue: "Файл больше 50 МБ — загрузите его через веб-версию"
                )
            }
        }
    }

    static func prepare(_ item: PhotosPickerItem) async throws -> PreparedMedia {
        if item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) }) {
            guard let movie = try await item.loadTransferable(type: PickedMovie.self) else {
                throw Failure.unreadable
            }
            return try await prepareVideo(at: movie.url)
        }
        guard let data = try await item.loadTransferable(type: Data.self) else { throw Failure.unreadable }
        return try prepareImage(data)
    }

    static func prepareImage(_ data: Data) throws -> PreparedMedia {
        guard let image = UIImage(data: data) else { throw Failure.unreadable }
        return try prepareImage(image)
    }

    /// Снимок камеры приходит готовой картинкой — тот же путь без чтения из байтов.
    static func prepareImage(_ image: UIImage) throws -> PreparedMedia {
        let scaled = image.scaledDown(toLongestSide: maxImageSide)
        guard let jpeg = scaled.jpegData(compressionQuality: 0.85) else { throw Failure.unreadable }
        return PreparedMedia(
            data: jpeg,
            mime: "image/jpeg",
            filename: "photo.jpg",
            preview: scaled.preparingThumbnail(of: CGSize(width: 300, height: 300)) ?? scaled
        )
    }

    static func prepareVideo(at source: URL) async throws -> PreparedMedia {
        let output = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("mp4")
        try await exportMP4(from: source, to: output)
        defer { try? FileManager.default.removeItem(at: output) }
        guard let data = try? Data(contentsOf: output) else { throw Failure.unreadable }
        guard data.count <= maxUploadBytes else { throw Failure.tooLarge }
        return PreparedMedia(data: data, mime: "video/mp4", filename: "video.mp4", preview: thumbnail(of: AVURLAsset(url: source)))
    }

    /// Ролик из галереи — копией во временном каталоге, а не в памяти. `nil` — выбрано
    /// не видео. Нужен там, где крупное уходит частями (вложения чата).
    static func movieFile(from item: PhotosPickerItem) async throws -> URL? {
        guard item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) }) else { return nil }
        guard let movie = try await item.loadTransferable(type: PickedMovie.self) else { throw Failure.unreadable }
        return movie.url
    }

    /// Перевести ролик в MP4 файлом на диске: сервер MOV камеры iPhone не берёт.
    static func exportMP4(from source: URL, to output: URL) async throws {
        let asset = AVURLAsset(url: source)
        guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset1280x720) else {
            throw Failure.unreadable
        }
        export.outputURL = output
        export.outputFileType = .mp4
        export.shouldOptimizeForNetworkUse = true
        await export.export()
        guard export.status == .completed else { throw Failure.unreadable }
    }

    static func thumbnail(ofVideoAt url: URL) -> UIImage? {
        thumbnail(of: AVURLAsset(url: url))
    }

    private static func thumbnail(of asset: AVAsset) -> UIImage? {
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 300, height: 300)
        return (try? generator.copyCGImage(at: .zero, actualTime: nil)).map(UIImage.init(cgImage:))
    }
}

/// Видео из галереи файлом, а не `Data`: ролик в сотню мегабайт целиком в памяти не
/// нужен, экспорт читает его с диска.
private struct PickedMovie: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { movie in
            SentTransferredFile(movie.url)
        } importing: { received in
            let copy = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString)
                .appendingPathExtension(received.file.pathExtension)
            try FileManager.default.copyItem(at: received.file, to: copy)
            return PickedMovie(url: copy)
        }
    }
}

extension UIImage {
    fileprivate func scaledDown(toLongestSide side: CGFloat) -> UIImage {
        let longest = max(size.width, size.height)
        guard longest > side else { return self }
        let factor = side / longest
        let target = CGSize(width: (size.width * factor).rounded(), height: (size.height * factor).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: target))
        }
    }
}
