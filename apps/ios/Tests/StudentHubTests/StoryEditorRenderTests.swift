import AVFoundation
import CoreImage
import CoreImage.CIFilterBuiltins
import Metal
import XCTest

@testable import StudentHub

/// Рендер редактора историй на настоящих пикселях: обработка меняет снимок, экспорт
/// содержит надписи и рисунок и не содержит направляющих, видео собирается в MP4.
/// Ползунок, который «двигается», но не меняет пиксели, эти тесты ловят.
final class StoryEditorRenderTests: XCTestCase {
    private let processor = StoryImageProcessor.shared
    private var root: URL!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("StoryRenderTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    // MARK: Помощники

    private func solid(_ red: Double, _ green: Double, _ blue: Double, size: CGSize = CGSize(width: 64, height: 64)) -> CIImage {
        CIImage(color: CIColor(red: red, green: green, blue: blue)).cropped(to: CGRect(origin: .zero, size: size))
    }

    /// Горизонтальный градиент (по умолчанию чёрный → белый).
    private func ramp(size: CGSize = CGSize(width: 256, height: 16), from: CIColor = .black, to: CIColor = .white) -> CIImage {
        let filter = CIFilter.linearGradient()
        filter.point0 = .zero
        filter.point1 = CGPoint(x: size.width, y: 0)
        filter.color0 = from
        filter.color1 = to
        return filter.outputImage!.cropped(to: CGRect(origin: .zero, size: size))
    }

    /// Мелкие полосы — резкость видна по разнице соседних пикселей.
    private func stripes(size: CGSize) -> CIImage {
        let filter = CIFilter.stripesGenerator()
        filter.color0 = .white
        filter.color1 = .black
        filter.width = 2
        filter.center = .zero
        return filter.outputImage!.cropped(to: CGRect(origin: .zero, size: size))
    }

    private func bitmap(_ image: CIImage) -> (pixels: [UInt8], width: Int, height: Int) {
        let width = Int(image.extent.width)
        let height = Int(image.extent.height)
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        processor.context.render(
            image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY)),
            toBitmap: &pixels,
            rowBytes: width * 4,
            bounds: CGRect(x: 0, y: 0, width: width, height: height),
            format: .RGBA8,
            colorSpace: CGColorSpace(name: CGColorSpace.sRGB)
        )
        return (pixels, width, height)
    }

    /// Пиксель (x, y от левого верха) — RGB 0…1.
    private func pixel(_ image: CIImage, x: Int, y: Int) -> (r: Double, g: Double, b: Double) {
        let map = bitmap(image)
        let index = (y * map.width + x) * 4
        return (Double(map.pixels[index]) / 255, Double(map.pixels[index + 1]) / 255, Double(map.pixels[index + 2]) / 255)
    }

    private func mean(_ image: CIImage) -> Double {
        let map = bitmap(image)
        var sum = 0.0
        for index in stride(from: 0, to: map.pixels.count, by: 4) {
            sum += (Double(map.pixels[index]) + Double(map.pixels[index + 1]) + Double(map.pixels[index + 2])) / 3
        }
        return sum / Double(map.width * map.height) / 255
    }

    /// Средняя разница соседних пикселей в квадрате — мера резкости.
    private func sharpness(_ image: CIImage, around point: CGPoint, radius: Int = 6) -> Double {
        let map = bitmap(image)
        var total = 0.0
        var count = 0
        let cx = Int(point.x)
        let cy = Int(point.y)
        for y in max(cy - radius, 0)..<min(cy + radius, map.height) {
            for x in max(cx - radius, 0)..<min(cx + radius, map.width - 1) {
                let a = Double(map.pixels[(y * map.width + x) * 4])
                let b = Double(map.pixels[(y * map.width + x + 1) * 4])
                total += abs(a - b)
                count += 1
            }
        }
        return total / Double(max(count, 1)) / 255
    }

    private func photoDocument(_ image: UIImage) throws -> (StoryDocument, StoryWorkspace) {
        let workspace = try StoryWorkspace.make(root: root)
        let document = try StoryMediaImport.photoDocument(image, workspace: workspace)
        return (document, workspace)
    }

    private func uniformImage(_ color: UIColor, size: CGSize = CGSize(width: 1080, height: 1920)) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            color.setFill()
            context.fill(CGRect(origin: .zero, size: size))
        }
    }

    // MARK: Обработка

    func testBrightnessRaisesLuminance() {
        let input = solid(0.4, 0.4, 0.4)
        var adjustments = StoryAdjustments()
        adjustments[.brightness] = 60
        let output = processor.process(input, StoryProcessing(adjustments: adjustments))
        XCTAssertGreaterThan(mean(output), mean(input) + 0.05)
        XCTAssertEqual(output.extent, input.extent, "обработка не меняет размер")
    }

    /// Тест 7 задания: яркость и контраст применяются одновременно.
    func testBrightnessAndContrastApplyTogether() {
        let input = ramp()
        var brightness = StoryAdjustments()
        brightness[.brightness] = 40
        var contrast = StoryAdjustments()
        contrast[.contrast] = 60
        var both = brightness
        both[.contrast] = 60

        let onlyBrightness = processor.process(input, StoryProcessing(adjustments: brightness))
        let onlyContrast = processor.process(input, StoryProcessing(adjustments: contrast))
        let combined = processor.process(input, StoryProcessing(adjustments: both))

        let dark = 40
        let probeBrightness = pixel(onlyBrightness, x: dark, y: 8).r
        let probeContrast = pixel(onlyContrast, x: dark, y: 8).r
        let probeBoth = pixel(combined, x: dark, y: 8).r
        XCTAssertNotEqual(probeBoth, probeBrightness, accuracy: 0.01, "контраст не применился вместе с яркостью")
        XCTAssertNotEqual(probeBoth, probeContrast, accuracy: 0.01, "яркость не применилась вместе с контрастом")
    }

    func testIdentityProcessingReturnsInput() {
        let input = solid(0.2, 0.5, 0.7)
        XCTAssertTrue(processor.process(input, StoryProcessing()) === input)
    }

    func testCurveMidpointBrightensMidtones() {
        let input = solid(0.5, 0.5, 0.5)
        var curves = StoryToneCurves()
        curves.all.setPoint(2, y: 0.75)
        let output = processor.process(input, StoryProcessing(curves: curves))
        XCTAssertGreaterThan(pixel(output, x: 4, y: 4).r, pixel(input, x: 4, y: 4).r + 0.08, "кривая не изменила снимок")
    }

    func testRedCurveTouchesOnlyRed() {
        let input = solid(0.5, 0.5, 0.5)
        var curves = StoryToneCurves()
        curves.red.setPoint(2, y: 0.8)
        let output = pixel(processor.process(input, StoryProcessing(curves: curves)), x: 4, y: 4)
        XCTAssertGreaterThan(output.r, output.g + 0.1)
        XCTAssertEqual(output.g, output.b, accuracy: 0.02)
    }

    func testWarmthShiftsTowardsRed() {
        let input = solid(0.5, 0.5, 0.5)
        var adjustments = StoryAdjustments()
        adjustments[.warmth] = 80
        let warm = pixel(processor.process(input, StoryProcessing(adjustments: adjustments)), x: 4, y: 4)
        XCTAssertGreaterThan(warm.r, warm.b + 0.03, "тепло должно сдвигать к красному")
        adjustments[.warmth] = -80
        let cold = pixel(processor.process(input, StoryProcessing(adjustments: adjustments)), x: 4, y: 4)
        XCTAssertGreaterThan(cold.b, cold.r + 0.03, "холод — к синему")
    }

    func testEveryAdjustmentChangesPixels() {
        // Цветной градиент: насыщенность, «улучшить» и оттенок на сером ничего бы не меняли.
        let input = ramp(
            size: CGSize(width: 256, height: 64),
            from: CIColor(red: 0.2, green: 0.1, blue: 0.6),
            to: CIColor(red: 0.9, green: 0.8, blue: 0.3)
        )
        let before = bitmap(input).pixels
        for tool in StoryAdjustmentTool.allCases {
            var adjustments = StoryAdjustments()
            adjustments[tool] = tool.range.upperBound * 0.8
            let after = bitmap(processor.process(input, StoryProcessing(adjustments: adjustments))).pixels
            XCTAssertNotEqual(after, before, "ползунок «\(tool.rawValue)» не меняет снимок")
        }
    }

    func testRadialBlurKeepsFocusSharpAndBlursOutside() {
        let size = CGSize(width: 200, height: 200)
        let input = stripes(size: size)
        var blur = StoryBlur()
        blur.mode = .radial
        blur.center = StoryPoint(x: 0.5, y: 0.5)
        blur.size = 0.15
        blur.intensity = 1
        let output = processor.process(input, StoryProcessing(blur: blur))
        let center = sharpness(output, around: CGPoint(x: 100, y: 100))
        let corner = sharpness(output, around: CGPoint(x: 12, y: 12))
        XCTAssertGreaterThan(center, sharpness(input, around: CGPoint(x: 100, y: 100)) * 0.7, "в фокусе стало мыльно")
        XCTAssertLessThan(corner, center * 0.5, "за пределами фокуса нет размытия")
    }

    func testLinearBlurBandFollowsCenter() {
        // Полоса вертикальная (угол 90°): проверка по горизонтали не зависит от того,
        // в каком порядке Core Image кладёт строки в буфер.
        let size = CGSize(width: 200, height: 200)
        let input = stripes(size: size)
        var blur = StoryBlur()
        blur.mode = .linear
        blur.angle = .pi / 2
        blur.size = 0.08
        blur.intensity = 1
        blur.setCenter(StoryPoint(x: 0.2, y: 0.5))
        let output = processor.process(input, StoryProcessing(blur: blur))
        XCTAssertGreaterThan(sharpness(output, around: CGPoint(x: 40, y: 100)), sharpness(output, around: CGPoint(x: 160, y: 100)) * 2,
                             "полоса резкости не сдвинулась вслед за центром")
    }

    // MARK: Экспорт фото

    /// Тест 7 задания: направляющие размытия в экспорт не попадают.
    func testExportedPhotoHasNoBlurGuides() async throws {
        let (base, workspace) = try photoDocument(uniformImage(UIColor(white: 0.3, alpha: 1)))
        var document = base
        document.blur.mode = .linear
        document.blur.setCenter(StoryPoint(x: 0.5, y: 0.3))
        document.blur.size = 0.1

        let result = try await StoryExporter.export(document, workspace: workspace)
        XCTAssertEqual(result.mime, "image/jpeg")
        let image = try XCTUnwrap(UIImage(contentsOfFile: result.url.path)?.cgImage)
        XCTAssertEqual(image.width, 1080)
        XCTAssertEqual(image.height, 1920)
        // Однотонный снимок после размытия — однотонный: белой линии (направляющей) нет
        // ни на границе резкой зоны, ни на конце перехода.
        let bandEdges = [0.3 - 0.1 * 9 / 16, 0.3 + 0.1 * 9 / 16, 0.3 - 0.135 * 9 / 16, 0.3 + 0.135 * 9 / 16]
        for edge in bandEdges {
            for column in stride(from: 20, to: 1060, by: 40) {
                let sample = try XCTUnwrap(StoryPixelSampler.color(in: image, x: column, y: Int(edge * 1920)))
                XCTAssertLessThan(sample.luminance, 0.25, "в экспорте светлая полоса — похоже на направляющую")
            }
        }
    }

    func testExportedPhotoContainsTextAndDrawing() throws {
        let (base, workspace) = try photoDocument(uniformImage(.black))
        var document = base
        var text = StoryTextPayload(text: "ТЕКСТ")
        text.style = .filled
        text.color = .white
        document.add(.text(text), center: StoryPoint(x: 0.5, y: 0.25), size: StorySize(width: 0.5, height: 0.1))
        document.drawing.add(StoryStroke(
            brush: .marker,
            color: StoryColor(hex: "#FF0000")!,
            width: 0.04,
            points: [StoryPoint(x: 0.2, y: 0.7), StoryPoint(x: 0.8, y: 0.7)]
        ))

        let image = try XCTUnwrap(StoryExporter.renderPhoto(document, workspace: workspace).cgImage)
        let stroke = try XCTUnwrap(StoryPixelSampler.color(in: image, x: 540, y: Int(0.7 * 1920)))
        XCTAssertGreaterThan(stroke.red, 0.8, "штрих не попал в экспорт")
        XCTAssertLessThan(stroke.green, 0.2)
        // Подложка надписи — белая, у края плашки (не на букве).
        let layout = StoryTextLayout(payload: text, canvasWidth: 1080)
        let plateEdge = CGPoint(x: 540 - layout.size.width / 2 + 6, y: 0.25 * 1920)
        let plate = try XCTUnwrap(StoryPixelSampler.color(in: image, x: Int(plateEdge.x), y: Int(plateEdge.y)))
        XCTAssertGreaterThan(plate.luminance, 0.8, "подложка надписи не попала в экспорт")
    }

    func testEraserRemovesOnlyDrawing() throws {
        let (base, workspace) = try photoDocument(uniformImage(UIColor(red: 0, green: 0, blue: 1, alpha: 1)))
        var document = base
        let line = [StoryPoint(x: 0.1, y: 0.5), StoryPoint(x: 0.9, y: 0.5)]
        document.drawing.add(StoryStroke(brush: .marker, color: .white, width: 0.05, points: line))
        document.drawing.add(StoryStroke(brush: .eraser, color: .white, width: 0.08, points: line))
        let image = try XCTUnwrap(StoryExporter.renderPhoto(document, workspace: workspace).cgImage)
        let sample = try XCTUnwrap(StoryPixelSampler.color(in: image, x: 540, y: 960))
        XCTAssertGreaterThan(sample.blue, 0.9, "ластик стёр фото или не стёр штрих")
        XCTAssertLessThan(sample.red, 0.1)
    }

    func testCollagePutsFramesIntoCells() {
        let colors: [UIColor] = [.red, .green, .blue, .yellow]
        let frames = colors.map { uniformImage($0, size: CGSize(width: 300, height: 400)) }
        let collage = StoryMediaImport.composeCollage(.fourGrid, images: frames).cgImage!
        let probes = [(270, 480), (810, 480), (270, 1440), (810, 1440)]
        for (color, probe) in zip(colors.map(StoryColor.init), probes) {
            let sample = StoryPixelSampler.color(in: collage, x: probe.0, y: probe.1)!
            XCTAssertEqual(sample.red, color.red, accuracy: 0.05)
            XCTAssertEqual(sample.green, color.green, accuracy: 0.05)
            XCTAssertEqual(sample.blue, color.blue, accuracy: 0.05)
        }
    }

    func testCameraFrameIsCroppedToVisible916() {
        let frame = uniformImage(.gray, size: CGSize(width: 3024, height: 4032))
        let normalized = StoryMediaImport.normalized(frame, cropAspect: 9.0 / 16.0)
        XCTAssertEqual(normalized.size.width / normalized.size.height, 9.0 / 16.0, accuracy: 0.01)
        XCTAssertLessThanOrEqual(max(normalized.size.width, normalized.size.height), StoryMediaImport.maxPhotoSide)
    }

    // MARK: Надпись

    func testPlateCoversEveryLine() throws {
        var payload = StoryTextPayload(text: "Короткая\nочень длинная вторая строка\nтри")
        payload.style = .filled
        // Кегль — доля ширины холста, поэтому переносов нет только при мелком шрифте:
        // самая длинная строка (~27 знаков) уже 86 % холста — строк ровно три.
        payload.fontSize = 0.04
        let layout = StoryTextLayout(payload: payload, canvasWidth: 1080)
        let plate = try XCTUnwrap(layout.platePath())
        XCTAssertEqual(layout.lineRects.count, 3)
        for line in layout.lineRects {
            XCTAssertTrue(plate.contains(CGPoint(x: line.midX, y: line.midY)), "строка вне подложки")
        }
        XCTAssertLessThanOrEqual(layout.size.width, 1080 * StoryTextLayout.maxWidthFraction + 1)
    }

    func testEmptyLineBreaksPlate() throws {
        var payload = StoryTextPayload(text: "раз\n\nдва")
        payload.style = .filled
        let layout = StoryTextLayout(payload: payload, canvasWidth: 390)
        let plate = try XCTUnwrap(layout.platePath())
        let middle = layout.lineRects[1]
        XCTAssertFalse(plate.contains(CGPoint(x: layout.size.width / 2, y: middle.midY)), "пустая строка залита подложкой")
    }

    // MARK: Видео

    func testPhotoWithRoundVideoExportsMP4() async throws {
        let (base, workspace) = try photoDocument(uniformImage(.darkGray))
        var document = base
        let roundFile = workspace.newFile(extension: "mp4")
        try await StorySyntheticVideo.write(
            frame: StorySimulatedCamera.frame(index: 1, position: .front, size: CGSize(width: 360, height: 640)),
            seconds: 2,
            to: workspace.url(for: roundFile)
        )
        document.add(.roundVideo(StoryRoundVideoPayload(file: roundFile, duration: 2)), center: StoryPoint(x: 0.5, y: 0.4), size: StorySize(width: 0.45, height: 0.45))
        document.add(.text(StoryTextPayload(text: "🔥")), center: StoryPoint(x: 0.2, y: 0.8), size: StorySize(width: 0.2, height: 0.2))
        XCTAssertTrue(document.producesVideo)

        let result = try await StoryExporter.export(document, workspace: workspace)
        XCTAssertEqual(result.mime, "video/mp4")
        let asset = AVURLAsset(url: result.url)
        let duration = try await asset.load(.duration).seconds
        XCTAssertEqual(duration, 2, accuracy: 0.3)
        let tracks = try await asset.loadTracks(withMediaType: .video)
        let track = try XCTUnwrap(tracks.first)
        let size = try await track.load(.naturalSize)
        XCTAssertEqual(size.width, 1080)
        XCTAssertEqual(size.height, 1920)
        _ = try result.prepared()
    }

    func testTrimmedVideoBackgroundExports() async throws {
        let workspace = try StoryWorkspace.make(root: root)
        let source = root.appendingPathComponent("source.mp4")
        try await StorySyntheticVideo.write(
            frame: StorySimulatedCamera.frame(index: 2, position: .back, size: CGSize(width: 540, height: 960)),
            seconds: 3,
            to: source
        )
        var document = try await StoryMediaImport.videoDocument(at: source, workspace: workspace)
        document.videoTrim = StoryTimeRange(start: 0.5, end: 2)
        document.adjustments[.saturation] = -100
        let result = try await StoryExporter.export(document, workspace: workspace)
        let duration = try await AVURLAsset(url: result.url).load(.duration).seconds
        XCTAssertEqual(duration, 1.5, accuracy: 0.3, "обрезка видео не учтена")
    }

    /// Фото на экране — через `CIRenderDestination` в текстуру Metal. Строка 0 текстуры —
    /// верх экрана; у Core Image верх — большие y. Верх снимка должен оказаться вверху.
    func testPhotoViewRenderIsUpright() throws {
        guard let device = processor.device, let queue = device.makeCommandQueue() else {
            throw XCTSkip("нет Metal")
        }
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: 4, height: 8, mipmapped: false)
        descriptor.usage = [.renderTarget, .shaderWrite, .shaderRead]
        descriptor.storageMode = .shared
        let texture = try XCTUnwrap(device.makeTexture(descriptor: descriptor))
        let top = CIImage(color: CIColor(red: 1, green: 0, blue: 0)).cropped(to: CGRect(x: 0, y: 4, width: 4, height: 4))
        let bottom = CIImage(color: CIColor(red: 0, green: 0, blue: 1)).cropped(to: CGRect(x: 0, y: 0, width: 4, height: 4))
        let buffer = try XCTUnwrap(queue.makeCommandBuffer())
        StoryPhotoView.render(top.composited(over: bottom), to: texture, commandBuffer: buffer, context: processor.context)
        buffer.commit()
        buffer.waitUntilCompleted()
        var row = [UInt8](repeating: 0, count: 4 * 4)
        texture.getBytes(&row, bytesPerRow: 16, from: MTLRegionMake2D(0, 0, 4, 1), mipmapLevel: 0)
        // BGRA: красный — третий байт.
        XCTAssertGreaterThan(row[2], 200, "верх снимка на экране внизу — перевернуть CIRenderDestination")
        XCTAssertLessThan(row[0], 50)
    }

    func testOrientationOfPortraitTrack() {
        // Кадр 200×100, повёрнутый на 90° (как пишет камера iPhone вертикально).
        let image = solid(1, 0, 0, size: CGSize(width: 200, height: 100))
        let rotated = StoryVideoCompositor.oriented(image, transform: CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: 100, ty: 0))
        XCTAssertEqual(rotated.extent.width, 100, accuracy: 0.5)
        XCTAssertEqual(rotated.extent.height, 200, accuracy: 0.5)
        XCTAssertEqual(rotated.extent.origin, .zero)
    }
}
