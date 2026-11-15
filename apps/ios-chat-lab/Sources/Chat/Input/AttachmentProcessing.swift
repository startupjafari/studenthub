import UIKit
import AVFoundation
import ImageIO
import UniformTypeIdentifiers

/// Выбранное, но ещё не отправленное вложение.
enum PendingAttachment {
    /// Фото из медиатеки — исходные байты (HEIC/JPEG/PNG).
    case imageData(Data)
    /// Снимок с камеры.
    case image(UIImage)
    /// Видео во временном файле.
    case video(URL)
    /// Тестовое фото из каталога (уже лежит в `MediaStorage`).
    case catalog(MediaSpec)

    var isVideo: Bool {
        if case .video = self { return true }
        if case let .catalog(spec) = self { return spec.kind == .video }
        return false
    }
}

/// Перенос вложений в каталог медиа: фото — JPEG не больше 2048 px, видео — копия файла,
/// размеры и длительность — из самих файлов. Всё вне главного потока.
enum AttachmentProcessing {
    static let maxImagePixel: CGFloat = 2048

    static func thumbnail(for attachment: PendingAttachment, maxPixel: CGFloat) -> UIImage? {
        switch attachment {
        case let .imageData(data):
            guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
            return downsample(source, maxPixel: maxPixel).map { UIImage(cgImage: $0) }
        case let .image(image):
            return image.preparingThumbnail(of: CGSize(width: maxPixel, height: maxPixel * image.size.height / max(1, image.size.width)))
        case let .video(url):
            return ImagePipeline.videoFrame(url: url, maxPixel: maxPixel)
        case let .catalog(spec):
            let url = MediaStorage.url(for: spec.file)
            return spec.kind == .video ? ImagePipeline.videoFrame(url: url, maxPixel: maxPixel) : ImagePipeline.downsample(url: url, maxPixel: maxPixel)
        }
    }

    static func process(_ attachment: PendingAttachment) async throws -> MessageKind {
        try FileManager.default.createDirectory(at: MediaStorage.directory, withIntermediateDirectories: true)
        switch attachment {
        case let .catalog(spec):
            return spec.messageKind
        case let .imageData(data):
            guard let source = CGImageSourceCreateWithData(data as CFData, nil), let image = downsample(source, maxPixel: maxImagePixel) else {
                throw AttachmentError.unreadable
            }
            return try storeJPEG(image)
        case let .image(image):
            let normalized = normalizedCGImage(image)
            guard let normalized else { throw AttachmentError.unreadable }
            return try storeJPEG(normalized)
        case let .video(url):
            return try await storeVideo(url)
        }
    }

    static func storeFile(from url: URL) throws -> MessageKind {
        try FileManager.default.createDirectory(at: MediaStorage.directory, withIntermediateDirectories: true)
        let accessing = url.startAccessingSecurityScopedResource()
        defer { if accessing { url.stopAccessingSecurityScopedResource() } }
        let ext = url.pathExtension.isEmpty ? "bin" : url.pathExtension.lowercased()
        let name = MediaStorage.makeUserFileName(extension: ext)
        try FileManager.default.copyItem(at: url, to: MediaStorage.url(for: name))
        let size = (try? FileManager.default.attributesOfItem(atPath: MediaStorage.url(for: name).path)[.size] as? NSNumber)?.int64Value
        let mime = UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
        return .file(MediaRef(file: name, fileName: url.lastPathComponent, fileSize: size, mimeType: mime))
    }

    // MARK: Внутреннее

    enum AttachmentError: LocalizedError {
        case unreadable
        case writeFailed

        var errorDescription: String? {
            switch self {
            case .unreadable: return "Не удалось прочитать файл"
            case .writeFailed: return "Не удалось сохранить файл"
            }
        }
    }

    private static func downsample(_ source: CGImageSource, maxPixel: CGFloat) -> CGImage? {
        let options = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ] as CFDictionary
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options)
    }

    /// Снимок камеры с учётом ориентации, не больше 2048 px.
    private static func normalizedCGImage(_ image: UIImage) -> CGImage? {
        let scale = min(1, maxImagePixel / max(image.size.width, image.size.height))
        let size = CGSize(width: floor(image.size.width * scale), height: floor(image.size.height * scale))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }.cgImage
    }

    private static func storeJPEG(_ image: CGImage) throws -> MessageKind {
        let name = MediaStorage.makeUserFileName(extension: "jpg")
        let url = MediaStorage.url(for: name)
        guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw AttachmentError.writeFailed
        }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw AttachmentError.writeFailed }
        let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value
        return .photo(MediaRef(
            file: name, width: Double(image.width), height: Double(image.height),
            fileName: "IMG.jpg", fileSize: size, mimeType: "image/jpeg"
        ))
    }

    private static func storeVideo(_ source: URL) async throws -> MessageKind {
        let ext = source.pathExtension.isEmpty ? "mov" : source.pathExtension.lowercased()
        let name = MediaStorage.makeUserFileName(extension: ext)
        let destination = MediaStorage.url(for: name)
        try FileManager.default.copyItem(at: source, to: destination)
        let asset = AVURLAsset(url: destination)
        let duration = try await asset.load(.duration).seconds
        var width: Double = 0
        var height: Double = 0
        if let track = try await asset.loadTracks(withMediaType: .video).first {
            let (natural, transform) = try await track.load(.naturalSize, .preferredTransform)
            let rect = CGRect(origin: .zero, size: natural).applying(transform)
            width = abs(rect.width)
            height = abs(rect.height)
        }
        let size = (try? FileManager.default.attributesOfItem(atPath: destination.path)[.size] as? NSNumber)?.int64Value
        return .video(MediaRef(
            file: name, width: width, height: height, duration: duration.isFinite ? duration : 0,
            fileName: source.lastPathComponent, fileSize: size, mimeType: UTType(filenameExtension: ext)?.preferredMIMEType ?? "video/quicktime"
        ))
    }
}
