import Foundation

/// Под какой размер готовить картинку: область на экране в пикселях и как картинка в
/// неё ложится. Декодируется копия не больше нужного — полный кадр в память не попадает.
///
/// Пиксели — целые: `CGSize` не `Hashable`, а цель — часть ключа загрузки (`.task(id:)`).
struct ImageTarget: Hashable, Sendable {
    enum Mode: Hashable, Sendable {
        /// Картинка заполняет область, лишнее обрезается (`.fill`).
        case fill
        /// Картинка целиком внутри области (`.fit`).
        case fit
    }

    let width: Int
    let height: Int
    let mode: Mode

    init(width: Int, height: Int, mode: Mode) {
        self.width = max(1, width)
        self.height = max(1, height)
        self.mode = mode
    }

    /// Длинная сторона не больше `side` пикселей — прежний `maxPixelSize`: аватар,
    /// миниатюра, кадр видео.
    static func longSide(_ side: CGFloat) -> ImageTarget {
        let pixels = max(1, Int(side.rounded(.up)))
        return ImageTarget(width: pixels, height: pixels, mode: .fit)
    }

    /// Область вида в точках → пиксели, округлённые вверх до ступени `step`: соседние
    /// размеры одной ячейки (анимация, полпикселя раскладки) дают одну цель и не
    /// перезапускают загрузку. `nil` — вид ещё не разложен.
    static func view(_ size: CGSize, scale: CGFloat, mode: Mode, step: Int = 32) -> ImageTarget? {
        guard size.width >= 1, size.height >= 1, scale > 0, step > 0 else { return nil }
        func bucket(_ points: CGFloat) -> Int {
            let pixels = Int((points * scale).rounded(.up))
            return ((pixels + step - 1) / step) * step
        }
        return ImageTarget(width: bucket(size.width), height: bucket(size.height), mode: mode)
    }

    /// Хватит ли копии `width × height` (тех же пропорций, что оригинал). Запас 10 %:
    /// копия чуть меньше области на глаз не отличима, а повторная загрузка заметна.
    func isSatisfied(byWidth pixelWidth: Int, height pixelHeight: Int) -> Bool {
        let needWidth = Double(width) * 0.9
        let needHeight = Double(height) * 0.9
        switch mode {
        case .fill: return Double(pixelWidth) >= needWidth && Double(pixelHeight) >= needHeight
        case .fit: return Double(pixelWidth) >= needWidth || Double(pixelHeight) >= needHeight
        }
    }

    /// Длинная сторона копии для снимка `sourceWidth × sourceHeight`: столько, чтобы
    /// заполнить (или вписаться в) область, но не больше оригинала.
    func longSide(sourceWidth: Int, sourceHeight: Int) -> Int {
        guard sourceWidth > 0, sourceHeight > 0 else { return max(width, height) }
        let scaleX = Double(width) / Double(sourceWidth)
        let scaleY = Double(height) / Double(sourceHeight)
        let scale = min(1, mode == .fill ? max(scaleX, scaleY) : min(scaleX, scaleY))
        return max(1, Int((Double(max(sourceWidth, sourceHeight)) * scale).rounded(.up)))
    }
}
