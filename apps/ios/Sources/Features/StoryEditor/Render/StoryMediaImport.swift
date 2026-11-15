@preconcurrency import AVFoundation
import CoreImage
import CoreImage.CIFilterBuiltins
import UIKit

/// Перевод снятого и выбранного в файлы рабочей папки редактора.
enum StoryMediaImport {
    /// Длинная сторона фото в рабочей папке: экспорт 1080×1920, запас — на масштаб жестом.
    static let maxPhotoSide: CGFloat = 2560
    /// Самая длинная история-видео. Сервер берёт до 105 с, но и загрузка одним запросом
    /// ограничена 50 МБ — минута при битрейте экспорта в неё укладывается.
    static let maxVideoDuration: Double = 60

    /// Фото «как видит человек»: ориентация применена, длинная сторона ужата,
    /// при `cropAspect` — обрезка по центру (кадр камеры 3:4 → видимые 9:16).
    static func normalized(_ image: UIImage, cropAspect: CGFloat? = nil, maxSide: CGFloat = maxPhotoSide) -> UIImage {
        var source = CGRect(origin: .zero, size: image.size)
        if let cropAspect, cropAspect > 0, source.width > 0, source.height > 0 {
            let aspect = source.width / source.height
            if aspect > cropAspect {
                let width = source.height * cropAspect
                source = CGRect(x: (source.width - width) / 2, y: 0, width: width, height: source.height)
            } else {
                let height = source.width / cropAspect
                source = CGRect(x: 0, y: (source.height - height) / 2, width: source.width, height: height)
            }
        }
        let scale = min(1, maxSide / max(source.width, source.height))
        let size = CGSize(width: (source.width * scale).rounded(), height: (source.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(x: -source.minX * scale, y: -source.minY * scale, width: image.size.width * scale, height: image.size.height * scale))
        }
    }

    /// Положить фото в папку и собрать документ с фоном по краям снимка.
    static func photoDocument(_ image: UIImage, workspace: StoryWorkspace) throws -> StoryDocument {
        guard let data = image.jpegData(compressionQuality: 0.92) else { throw StoryCameraError.captureFailed }
        let file = try workspace.store(data, extension: "jpg")
        let size = StorySize(width: Double(image.size.width * image.scale), height: Double(image.size.height * image.scale))
        var document = StoryDocument(background: .photo(file: file, size: size))
        document.backdrop = backdropColors(for: image)
        return document
    }

    /// Видео: файл переносится в папку, длительность и размер кадра — с учётом поворота.
    static func videoDocument(at url: URL, workspace: StoryWorkspace) async throws -> StoryDocument {
        let asset = AVURLAsset(url: url)
        let duration = try await asset.load(.duration).seconds
        guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw MediaPreparation.Failure.unreadable }
        let natural = try await track.load(.naturalSize)
        let transform = try await track.load(.preferredTransform)
        let display = CGRect(origin: .zero, size: natural).applying(transform)
        let poster = MediaPreparation.thumbnail(ofVideoAt: url)
        let ext = url.pathExtension.isEmpty ? "mov" : url.pathExtension.lowercased()
        let file = try workspace.adopt(url, extension: ext)
        var document = StoryDocument(background: .video(
            file: file,
            size: StorySize(width: Double(abs(display.width)), height: Double(abs(display.height))),
            duration: duration
        ))
        if duration > maxVideoDuration {
            document.videoTrim = StoryTimeRange(start: 0, end: maxVideoDuration)
        }
        if let poster { document.backdrop = backdropColors(for: poster) }
        return document
    }

    /// Текстовая история: градиент из набора сервера.
    static func gradientDocument(_ key: String) -> StoryDocument {
        StoryDocument(background: .gradient(key))
    }

    /// Средние цвета верхней и нижней полосы снимка, притемнённые: так свободное место
    /// вокруг вписанного фото продолжает его, а не режет чёрными полями.
    static func backdropColors(for image: UIImage) -> [StoryColor] {
        guard let ci = CIImage(image: image) else { return [StoryColor(white: 0.12), StoryColor(white: 0.04)] }
        let extent = ci.extent
        let strip = extent.height * 0.12
        let top = CGRect(x: extent.minX, y: extent.maxY - strip, width: extent.width, height: strip)
        let bottom = CGRect(x: extent.minX, y: extent.minY, width: extent.width, height: strip)
        return [top, bottom].map { rect in
            let filter = CIFilter.areaAverage()
            filter.inputImage = ci
            filter.extent = rect
            var pixel = [UInt8](repeating: 0, count: 4)
            if let output = filter.outputImage {
                StoryImageProcessor.shared.context.render(
                    output,
                    toBitmap: &pixel,
                    rowBytes: 4,
                    bounds: CGRect(x: 0, y: 0, width: 1, height: 1),
                    format: .RGBA8,
                    colorSpace: CGColorSpace(name: CGColorSpace.sRGB)
                )
            }
            return StoryColor(red: Double(pixel[0]) / 255 * 0.7, green: Double(pixel[1]) / 255 * 0.7, blue: Double(pixel[2]) / 255 * 0.7)
        }
    }

    /// Коллаж в одну картинку 1080×1920: каждый кадр заполняет свою ячейку по центру.
    static func composeCollage(_ layout: StoryCollageLayout, images: [UIImage]) -> UIImage {
        let size = CGSize(width: StoryCanvasGeometry.exportSize.width, height: StoryCanvasGeometry.exportSize.height)
        let metrics = StoryCanvasMetrics(size: size)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.black.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            for (cell, image) in zip(layout.cells, images) {
                let rect = metrics.rect(cell)
                context.cgContext.saveGState()
                context.cgContext.clip(to: rect)
                let scale = max(rect.width / image.size.width, rect.height / image.size.height)
                let drawn = CGSize(width: image.size.width * scale, height: image.size.height * scale)
                image.draw(in: CGRect(x: rect.midX - drawn.width / 2, y: rect.midY - drawn.height / 2, width: drawn.width, height: drawn.height))
                context.cgContext.restoreGState()
            }
            // Тонкие разделители между кадрами — как у коллажа Telegram.
            UIColor.black.setStroke()
            for cell in layout.cells {
                let path = UIBezierPath(rect: metrics.rect(cell))
                path.lineWidth = 4
                path.stroke()
            }
        }
    }

    /// Пропорции ячейки коллажа на холсте 9:16 — по ним обрезается кадр камеры.
    static func aspect(of cell: StoryRect) -> CGFloat {
        CGFloat(cell.width * 9) / CGFloat(max(cell.height * 16, 0.0001))
    }
}
