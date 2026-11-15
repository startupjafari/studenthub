import CoreImage
import CoreImage.CIFilterBuiltins
import Metal
import UIKit

/// Параметры обработки снимка — то, что меняет пиксели исходника.
struct StoryProcessing: Equatable, Sendable {
    var adjustments = StoryAdjustments.identity
    var blur = StoryBlur.off
    var curves = StoryToneCurves.identity

    var isIdentity: Bool { adjustments.isIdentity && !blur.isActive && curves.isIdentity }

    init(adjustments: StoryAdjustments = .identity, blur: StoryBlur = .off, curves: StoryToneCurves = .identity) {
        self.adjustments = adjustments
        self.blur = blur
        self.curves = curves
    }

    init(_ document: StoryDocument) {
        self.init(adjustments: document.adjustments, blur: document.blur, curves: document.curves)
    }
}

/// Обработка снимка Core Image: одна цепочка фильтров для предпросмотра (на уменьшенной
/// копии, на GPU), для кадров видео и для экспорта в полном размере.
///
/// Все радиусы и смещения считаются в долях ширины снимка, поэтому предпросмотр
/// 1200 px и экспорт 4000 px выглядят одинаково.
final class StoryImageProcessor: @unchecked Sendable {
    static let shared = StoryImageProcessor()

    let device: MTLDevice?
    /// Контекст на Metal: рендер в текстуру экрана без копии через CPU.
    let context: CIContext
    private let workingSpace = CGColorSpace(name: CGColorSpace.sRGB)!
    private let lock = NSLock()
    /// Автоулучшение считается один раз на исходник: анализ снимка дорогой.
    private var enhanceCache: [ObjectIdentifier: [CIFilter]] = [:]

    init() {
        device = MTLCreateSystemDefaultDevice()
        let options: [CIContextOption: Any] = [
            .cacheIntermediates: false,
            .name: "StoryEditor",
        ]
        if let device {
            context = CIContext(mtlDevice: device, options: options)
        } else {
            context = CIContext(options: options)
        }
    }

    /// Снимок с обработкой. Размер и положение (`extent`) — как у входа.
    func process(_ input: CIImage, _ processing: StoryProcessing) -> CIImage {
        guard !processing.isIdentity else { return input }
        let extent = input.extent
        guard extent.width > 1, extent.height > 1, extent.width.isFinite else { return input }
        let adjustments = processing.adjustments
        var image = input

        let enhance = adjustments[.enhance] / 100
        if enhance > 0 {
            var enhanced = image
            for filter in autoFilters(for: input) {
                filter.setValue(enhanced, forKey: kCIInputImageKey)
                enhanced = filter.outputImage ?? enhanced
            }
            let vibrance = CIFilter.vibrance()
            vibrance.inputImage = enhanced
            vibrance.amount = 0.35
            enhanced = vibrance.outputImage ?? enhanced
            let mix = CIFilter.dissolveTransition()
            mix.inputImage = image
            mix.targetImage = enhanced
            mix.time = Float(enhance)
            image = mix.outputImage?.cropped(to: extent) ?? image
        }

        let exposure = adjustments[.exposure] / 100
        if exposure != 0 {
            let filter = CIFilter.exposureAdjust()
            filter.inputImage = image
            filter.ev = Float(exposure * 1.5)
            image = filter.outputImage ?? image
        }

        let brightness = adjustments[.brightness] / 100
        let contrast = adjustments[.contrast] / 100
        let saturation = adjustments[.saturation] / 100
        if brightness != 0 || contrast != 0 || saturation != 0 {
            let filter = CIFilter.colorControls()
            filter.inputImage = image
            filter.brightness = Float(brightness * 0.25)
            filter.contrast = Float(1 + contrast * (contrast > 0 ? 0.5 : 0.4))
            filter.saturation = Float(1 + saturation)
            image = filter.outputImage ?? image
        }

        let warmth = adjustments[.warmth] / 100
        let tint = adjustments[.tint] / 100
        if warmth != 0 || tint != 0 {
            let filter = CIFilter.temperatureAndTint()
            filter.inputImage = image
            filter.neutral = CIVector(x: 6500, y: 0)
            // Цель выше нейтрали — снимок теплее: так фильтр компенсирует «холодный» свет.
            filter.targetNeutral = CIVector(x: 6500 + warmth * 2500, y: tint * 60)
            image = filter.outputImage ?? image
        }

        // Тени, света и выцветание — одна тоновая кривая по яркости.
        let shadows = adjustments[.shadows] / 100
        let highlights = adjustments[.highlights] / 100
        let fade = adjustments[.fade] / 100
        if shadows != 0 || highlights != 0 || fade != 0 {
            let filter = CIFilter.toneCurve()
            filter.inputImage = image
            filter.point0 = CGPoint(x: 0, y: fade * 0.18)
            filter.point1 = CGPoint(x: 0.25, y: (0.25 + shadows * 0.12 + fade * 0.08).clamped(to: 0...1))
            filter.point2 = CGPoint(x: 0.5, y: 0.5 + fade * 0.03)
            filter.point3 = CGPoint(x: 0.75, y: (0.75 + highlights * 0.12 - fade * 0.02).clamped(to: 0...1))
            filter.point4 = CGPoint(x: 1, y: 1 - fade * 0.06)
            image = filter.outputImage ?? image
        }

        if !processing.curves.isIdentity {
            let filter = CIFilter.colorCurves()
            filter.inputImage = image
            let table = processing.curves.table(count: 256)
            filter.curvesData = table.withUnsafeBufferPointer { Data(buffer: $0) }
            filter.curvesDomain = CIVector(x: 0, y: 1)
            filter.colorSpace = workingSpace
            image = filter.outputImage ?? image
        }

        let sharpen = adjustments[.sharpen] / 100
        if sharpen > 0 {
            let filter = CIFilter.sharpenLuminance()
            filter.inputImage = image
            filter.sharpness = Float(sharpen * 0.9)
            filter.radius = Float(max(1, extent.width / 1080 * 2))
            image = filter.outputImage ?? image
        }

        let vignette = adjustments[.vignette] / 100
        if vignette > 0 {
            let filter = CIFilter.vignetteEffect()
            filter.inputImage = image
            filter.center = CGPoint(x: extent.midX, y: extent.midY)
            filter.radius = Float(hypot(extent.width, extent.height) * 0.42)
            filter.intensity = Float(vignette * 0.9)
            filter.falloff = 0.6
            image = filter.outputImage ?? image
        }

        if processing.blur.isActive {
            image = applyBlur(processing.blur, to: image, extent: extent)
        }

        return image.cropped(to: extent)
    }

    /// Маска размытия: белое — размыто, чёрное — резко. Та же геометрия, что у
    /// `StoryBlur.sharpness` (центр и размер — в долях снимка, размер — от ширины).
    func blurMask(_ blur: StoryBlur, extent: CGRect) -> CIImage? {
        let width = extent.width
        // Координаты Core Image — от нижнего левого угла.
        let center = CGPoint(x: extent.minX + blur.center.x * width, y: extent.maxY - blur.center.y * extent.height)
        let inner = blur.size * width
        let outer = blur.size * (1 + blur.falloff) * width
        switch blur.mode {
        case .off:
            return nil
        case .radial:
            let gradient = CIFilter.radialGradient()
            gradient.center = center
            gradient.radius0 = Float(inner)
            gradient.radius1 = Float(outer)
            gradient.color0 = CIColor.black
            gradient.color1 = CIColor.white
            return gradient.outputImage?.cropped(to: extent)
        case .linear:
            // Нормаль к оси полосы на экране (y вниз) — (−sin, cos); в Core Image y вверх.
            let normal = CGPoint(x: -sin(blur.angle), y: -cos(blur.angle))
            func side(_ sign: CGFloat) -> CIImage? {
                let gradient = CIFilter.smoothLinearGradient()
                gradient.point0 = CGPoint(x: center.x + normal.x * inner * sign, y: center.y + normal.y * inner * sign)
                gradient.point1 = CGPoint(x: center.x + normal.x * outer * sign, y: center.y + normal.y * outer * sign)
                gradient.color0 = CIColor.black
                gradient.color1 = CIColor.white
                return gradient.outputImage
            }
            guard let first = side(1), let second = side(-1) else { return nil }
            let union = CIFilter.maximumCompositing()
            union.inputImage = first
            union.backgroundImage = second
            return union.outputImage?.cropped(to: extent)
        }
    }

    private func applyBlur(_ blur: StoryBlur, to image: CIImage, extent: CGRect) -> CIImage {
        guard let mask = blurMask(blur, extent: extent) else { return image }
        let filter = CIFilter.maskedVariableBlur()
        filter.inputImage = image.clampedToExtent()
        filter.mask = mask
        filter.radius = Float(blur.intensity * 0.02 * extent.width)
        return filter.outputImage?.cropped(to: extent) ?? image
    }

    private func autoFilters(for image: CIImage) -> [CIFilter] {
        let key = ObjectIdentifier(image)
        lock.lock()
        if let cached = enhanceCache[key] {
            lock.unlock()
            return cached
        }
        lock.unlock()
        let filters = image.autoAdjustmentFilters(options: [.redEye: false])
        lock.lock()
        if enhanceCache.count > 8 { enhanceCache.removeAll() }
        enhanceCache[key] = filters
        lock.unlock()
        return filters
    }

    // MARK: Растр

    /// CGImage обработанного снимка — для экспорта и тестов.
    func render(_ image: CIImage) -> CGImage? {
        context.createCGImage(image, from: image.extent, format: .RGBA8, colorSpace: workingSpace)
    }

    /// Гистограмма для «Кривых»: 64 корзины яркости и каналов R, G, B (0…1).
    func histogram(of image: CIImage, bins: Int = 64) -> StoryHistogram {
        let extent = image.extent
        let scale = min(1, 256 / max(extent.width, extent.height))
        let small = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let filter = CIFilter(name: "CIAreaHistogram") else { return .empty }
        filter.setValue(small, forKey: kCIInputImageKey)
        filter.setValue(CIVector(cgRect: small.extent), forKey: kCIInputExtentKey)
        filter.setValue(bins, forKey: "inputCount")
        filter.setValue(1, forKey: kCIInputScaleKey)
        guard let output = filter.outputImage else { return .empty }
        var raw = [Float](repeating: 0, count: bins * 4)
        raw.withUnsafeMutableBytes { buffer in
            context.render(
                output,
                toBitmap: buffer.baseAddress!,
                rowBytes: bins * 4 * MemoryLayout<Float>.size,
                bounds: CGRect(x: 0, y: 0, width: bins, height: 1),
                format: .RGBAf,
                colorSpace: nil
            )
        }
        var red: [Double] = []
        var green: [Double] = []
        var blue: [Double] = []
        for index in 0..<bins {
            red.append(Double(raw[index * 4]))
            green.append(Double(raw[index * 4 + 1]))
            blue.append(Double(raw[index * 4 + 2]))
        }
        let luma = (0..<bins).map { 0.299 * red[$0] + 0.587 * green[$0] + 0.114 * blue[$0] }
        return StoryHistogram(luminance: luma, red: red, green: green, blue: blue).normalized()
    }

    /// Уменьшенная копия для предпросмотра: длинная сторона не больше `maxSide` пикселей.
    static func proxy(of image: CIImage, maxSide: CGFloat) -> CIImage {
        let extent = image.extent
        let longest = max(extent.width, extent.height)
        guard longest > maxSide else { return image }
        let scale = maxSide / longest
        let filter = CIFilter.lanczosScaleTransform()
        filter.inputImage = image
        filter.scale = Float(scale)
        filter.aspectRatio = 1
        let output = filter.outputImage ?? image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        return output.transformed(by: CGAffineTransform(translationX: -output.extent.minX, y: -output.extent.minY))
    }
}

/// Гистограмма «Кривых».
struct StoryHistogram: Equatable, Sendable {
    var luminance: [Double]
    var red: [Double]
    var green: [Double]
    var blue: [Double]

    static let empty = StoryHistogram(luminance: [], red: [], green: [], blue: [])

    func values(for channel: StoryToneCurves.Channel) -> [Double] {
        switch channel {
        case .all: return luminance
        case .red: return red
        case .green: return green
        case .blue: return blue
        }
    }

    /// Высоты 0…1 относительно самой высокой корзины (всех каналов вместе).
    func normalized() -> StoryHistogram {
        let peak = max((luminance + red + green + blue).max() ?? 0, .leastNonzeroMagnitude)
        return StoryHistogram(
            luminance: luminance.map { $0 / peak },
            red: red.map { $0 / peak },
            green: green.map { $0 / peak },
            blue: blue.map { $0 / peak }
        )
    }
}
