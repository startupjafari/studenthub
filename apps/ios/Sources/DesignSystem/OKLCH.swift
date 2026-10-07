import UIKit

/// Цвет в той же записи, что и токены платформы: `oklch(L C H)`.
///
/// Почему не шестнадцатеричные значения. Единственный источник правды для палитры —
/// `apps/web/src/app/globals.css`, и объявлена она в `oklch()` (DESIGN_SYSTEM §2.1).
/// Если переписать токены здесь в hex, любая правка палитры в вебе молча разойдётся
/// с приложением: заметит это человек на скриншоте, а не компилятор. Поэтому числа
/// копируются из CSS как есть, а перевод в sRGB делает код — ровно тот же, что у
/// браузера.
struct OKLCH: Equatable {
    let lightness: Double
    let chroma: Double
    /// Тон в градусах, как в CSS.
    let hue: Double

    init(_ lightness: Double, _ chroma: Double, _ hue: Double) {
        self.lightness = lightness
        self.chroma = chroma
        self.hue = hue
    }

    /// Компоненты sRGB в диапазоне 0…1.
    ///
    /// Матрицы и формулы — OKLab Бьёрна Оттоссона, та же математика, по которой
    /// `oklch()` считает браузер. Значения за пределами охвата sRGB обрезаются по
    /// краям: так же поступает и браузер, когда цвет не помещается в экран.
    var rgb: (red: Double, green: Double, blue: Double) {
        let radians = hue * .pi / 180
        let a = chroma * cos(radians)
        let b = chroma * sin(radians)

        // Куб считаем умножением, а не pow: у pow с дробным показателем
        // отрицательное основание даёт NaN, и один промах здесь красит экран в чёрное.
        let long = cube(lightness + 0.3963377774 * a + 0.2158037573 * b)
        let medium = cube(lightness - 0.1055613458 * a - 0.0638541728 * b)
        let short = cube(lightness - 0.0894841775 * a - 1.2914855480 * b)

        let linearRed = 4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short
        let linearGreen = -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short
        let linearBlue = -0.0041960863 * long - 0.7034186147 * medium + 1.7076147010 * short

        return (gamma(linearRed), gamma(linearGreen), gamma(linearBlue))
    }

    var uiColor: UIColor {
        let (red, green, blue) = rgb
        return UIColor(red: red, green: green, blue: blue, alpha: 1)
    }

    private func cube(_ value: Double) -> Double { value * value * value }

    /// Линейный sRGB → sRGB с гамма-коррекцией, с обрезкой по охвату.
    private func gamma(_ value: Double) -> Double {
        let clamped = min(max(value, 0), 1)
        return clamped <= 0.0031308
            ? 12.92 * clamped
            : 1.055 * pow(clamped, 1 / 2.4) - 0.055
    }
}
