import UIKit
import XCTest

/// Сравнение снимка экрана с эталоном — без сторонних библиотек.
///
/// Один файл на два набора: in-process снимки компонентов (`StudentHubSnapshotTests`)
/// и полноэкранные снимки из XCUITest (`StudentHubUITests`). Поэтому здесь только
/// UIKit и XCTest, без `@testable import`.
///
/// Эталоны лежат рядом с тестом: `<папка теста>/__Snapshots__/<среда>/<набор>/<имя>.png`.
/// Среда — мажорная версия iOS и масштаб экрана (`ios26@3x`): шрифты и материалы между
/// мажорами рисуются по-разному, и сравнивать их друг с другом бессмысленно.
///
/// Переменные окружения (раннер получает их как `TEST_RUNNER_<имя>`):
/// - `SNAPSHOT_RECORD=1` — записать эталоны заново; тест при этом падает, чтобы запись
///   не сошла за проверку;
/// - `SNAPSHOT_STRICT=1` — нет эталона = ошибка (CI). Без флага недостающий эталон
///   записывается, и тест тоже падает с пометкой «записан»;
/// - `SNAPSHOT_ARTIFACTS` — каталог, куда при расхождении кладутся
///   `reference.png` / `actual.png` / `diff.png`. По умолчанию — временный каталог;
///   те же три картинки всегда прикладываются к тесту в `.xcresult`.
enum SnapshotComparison {
    /// Насколько строго сравнивать.
    struct Tolerance {
        /// Разница канала (0…255), ниже которой пиксель считается совпавшим: сглаживание
        /// краёв на одной и той же среде иногда отличается на единицы.
        var channel: UInt8 = 6
        /// Доля пикселей, которым разрешено отличаться сильнее `channel`.
        var fraction: Double = 0.0005

        static let strict = Tolerance()
        /// Полноэкранные снимки из XCUITest: курсор ввода и сглаживание теней.
        static let screen = Tolerance(channel: 10, fraction: 0.002)
    }

    struct Mismatch: CustomStringConvertible {
        let reference: UIImage
        let actual: UIImage
        let diff: UIImage?
        let differingPixels: Int
        let totalPixels: Int
        let sizeMismatch: Bool

        var description: String {
            if sizeMismatch {
                return "размер изменился: эталон \(Self.size(reference)), сейчас \(Self.size(actual))"
            }
            let share = Double(differingPixels) / Double(max(totalPixels, 1)) * 100
            return String(format: "отличается %d пикс. из %d (%.3f%%)", differingPixels, totalPixels, share)
        }

        private static func size(_ image: UIImage) -> String {
            "\(Int(image.size.width * image.scale))×\(Int(image.size.height * image.scale))"
        }
    }

    // MARK: - Проверка

    /// Сравнить `image` с эталоном `name` из набора `suite`. Возвращает без ошибки,
    /// если совпало; иначе отмечает тест упавшим и прикладывает картинки.
    static func assert(
        _ image: UIImage,
        named name: String,
        suite: String,
        tolerance: Tolerance = .strict,
        testCase: XCTestCase,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let environment = ProcessInfo.processInfo.environment
        let record = environment["SNAPSHOT_RECORD"] == "1"
        let strict = environment["SNAPSHOT_STRICT"] == "1"
        let referenceURL = referenceDirectory(file: file, suite: suite)
            .appendingPathComponent(sanitized(name) + ".png")

        guard let actualData = image.pngData() else {
            XCTFail("снимок «\(name)» не кодируется в PNG", file: file, line: line)
            return
        }
        // Пустой (целиком прозрачный или одноцветный) снимок — не эталон и не проверка:
        // вид не нарисовался. Такой нельзя ни записать, ни сравнить.
        if isBlank(image) {
            attach(image, name: "\(name) — пустой", to: testCase)
            XCTFail("Снимок «\(name)» пустой: вид не нарисовался (окно вне сцены?).", file: file, line: line)
            return
        }

        if record || (!strict && !FileManager.default.fileExists(atPath: referenceURL.path)) {
            do {
                try FileManager.default.createDirectory(
                    at: referenceURL.deletingLastPathComponent(), withIntermediateDirectories: true)
                try actualData.write(to: referenceURL)
            } catch {
                XCTFail("не записался эталон «\(name)»: \(error)", file: file, line: line)
                return
            }
            attach(image, name: "\(name) — записан", to: testCase)
            XCTFail(
                "Эталон «\(name)» записан в \(referenceURL.path). Проверьте картинку глазами и закоммитьте; "
                    + "повторный прогон без SNAPSHOT_RECORD сравнит с ним.",
                file: file, line: line)
            return
        }

        guard let referenceData = try? Data(contentsOf: referenceURL),
            let reference = UIImage(data: referenceData, scale: image.scale)
        else {
            attach(image, name: "\(name) — actual", to: testCase)
            XCTFail(
                "Нет эталона «\(name)» (\(referenceURL.path)). Запишите его прогоном с SNAPSHOT_RECORD=1.",
                file: file, line: line)
            return
        }

        guard let mismatch = compare(reference: reference, actual: image, tolerance: tolerance) else { return }

        attach(mismatch.reference, name: "\(name) — reference", to: testCase)
        attach(mismatch.actual, name: "\(name) — actual", to: testCase)
        if let diff = mismatch.diff { attach(diff, name: "\(name) — diff", to: testCase) }
        let saved = saveArtifacts(mismatch, suite: suite, name: name)
        XCTFail(
            "Снимок «\(name)» разошёлся с эталоном: \(mismatch)."
                + (saved.map { " Картинки: \($0.path)" } ?? ""),
            file: file, line: line)
    }

    // MARK: - Сравнение пикселей

    /// `nil` — совпало в пределах допуска.
    static func compare(reference: UIImage, actual: UIImage, tolerance: Tolerance) -> Mismatch? {
        guard let left = RGBA(reference), let right = RGBA(actual) else {
            return Mismatch(reference: reference, actual: actual, diff: nil,
                            differingPixels: 0, totalPixels: 0, sizeMismatch: true)
        }
        guard left.width == right.width, left.height == right.height else {
            return Mismatch(reference: reference, actual: actual, diff: nil,
                            differingPixels: 0, totalPixels: 0, sizeMismatch: true)
        }

        let total = left.width * left.height
        var differing = 0
        var diffPixels = [UInt8](repeating: 0, count: total * 4)
        for index in 0..<total {
            let offset = index * 4
            var maxDelta: UInt8 = 0
            for channel in 0..<4 {
                let a = left.pixels[offset + channel]
                let b = right.pixels[offset + channel]
                maxDelta = max(maxDelta, a > b ? a - b : b - a)
            }
            if maxDelta > tolerance.channel {
                differing += 1
                // Расхождение — ярко-красным.
                diffPixels[offset] = 255
                diffPixels[offset + 1] = 0
                diffPixels[offset + 2] = 0
                diffPixels[offset + 3] = 255
            } else {
                // Совпавшее — бледной серой подложкой, чтобы было видно, где именно.
                let gray = UInt8((Int(right.pixels[offset]) + Int(right.pixels[offset + 1])
                    + Int(right.pixels[offset + 2])) / 3 / 4 + 190)
                diffPixels[offset] = gray
                diffPixels[offset + 1] = gray
                diffPixels[offset + 2] = gray
                diffPixels[offset + 3] = 255
            }
        }

        guard Double(differing) / Double(max(total, 1)) > tolerance.fraction else { return nil }
        let diff = RGBA(width: left.width, height: left.height, pixels: diffPixels).image(scale: actual.scale)
        return Mismatch(reference: reference, actual: actual, diff: diff,
                        differingPixels: differing, totalPixels: total, sizeMismatch: false)
    }

    /// Все пиксели одинаковы (в том числе полностью прозрачны).
    static func isBlank(_ image: UIImage) -> Bool {
        guard let rgba = RGBA(image), rgba.pixels.count >= 4 else { return true }
        let first = rgba.pixels[0..<4]
        var offset = 4
        while offset < rgba.pixels.count {
            if rgba.pixels[offset..<offset + 4].elementsEqual(first) == false { return false }
            offset += 4
        }
        return true
    }

    // MARK: - Пути и артефакты

    /// `ios26@3x`: эталоны одной среды не сравниваются с другой.
    static var environmentKey: String {
        let major = ProcessInfo.processInfo.operatingSystemVersion.majorVersion
        let scale = Int(UIScreen.main.scale)
        return "ios\(major)@\(scale)x"
    }

    static func referenceDirectory(file: StaticString, suite: String) -> URL {
        URL(fileURLWithPath: "\(file)")
            .deletingLastPathComponent()
            .appendingPathComponent("__Snapshots__")
            .appendingPathComponent(environmentKey)
            .appendingPathComponent(sanitized(suite))
    }

    private static func saveArtifacts(_ mismatch: Mismatch, suite: String, name: String) -> URL? {
        let root = ProcessInfo.processInfo.environment["SNAPSHOT_ARTIFACTS"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.temporaryDirectory.appendingPathComponent("snapshot-failures")
        let directory = root
            .appendingPathComponent(environmentKey)
            .appendingPathComponent(sanitized(suite))
            .appendingPathComponent(sanitized(name))
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try mismatch.reference.pngData()?.write(to: directory.appendingPathComponent("reference.png"))
            try mismatch.actual.pngData()?.write(to: directory.appendingPathComponent("actual.png"))
            try mismatch.diff?.pngData()?.write(to: directory.appendingPathComponent("diff.png"))
            return directory
        } catch {
            return nil
        }
    }

    private static func attach(_ image: UIImage, name: String, to testCase: XCTestCase) {
        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        testCase.add(attachment)
    }

    static func sanitized(_ name: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_."))
        return String(name.unicodeScalars.map { allowed.contains($0) ? Character($0) : "_" })
    }
}

/// Пиксели в одном формате (sRGB, RGBA8, без предумножения не гонимся — оба снимка
/// проходят один и тот же путь).
private struct RGBA {
    let width: Int
    let height: Int
    let pixels: [UInt8]

    init(width: Int, height: Int, pixels: [UInt8]) {
        self.width = width
        self.height = height
        self.pixels = pixels
    }

    init?(_ image: UIImage) {
        guard let cgImage = image.cgImage else { return nil }
        // Локальные копии: замыкание ниже не может захватить `self` до того, как
        // задан `pixels`.
        let width = cgImage.width
        let height = cgImage.height
        self.width = width
        self.height = height
        var buffer = [UInt8](repeating: 0, count: width * height * 4)
        let drawn: Bool = buffer.withUnsafeMutableBytes { raw in
            guard let context = CGContext(
                data: raw.baseAddress, width: width, height: height, bitsPerComponent: 8,
                bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            else { return false }
            context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard drawn else { return nil }
        pixels = buffer
    }

    func image(scale: CGFloat) -> UIImage? {
        var copy = pixels
        return copy.withUnsafeMutableBytes { raw -> UIImage? in
            guard let context = CGContext(
                data: raw.baseAddress, width: width, height: height, bitsPerComponent: 8,
                bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
                let cgImage = context.makeImage()
            else { return nil }
            return UIImage(cgImage: cgImage, scale: scale, orientation: .up)
        }
    }
}
