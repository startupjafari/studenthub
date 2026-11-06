package kz.studenthub.app.designsystem

import androidx.compose.ui.graphics.Color
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin

/**
 * Цвет в той же записи, что и токены платформы: `oklch(L C H)`.
 *
 * Единственный источник правды для палитры — `apps/web/src/app/globals.css`, и
 * объявлена она в `oklch()` (DESIGN_SYSTEM §2.1). Если переписать токены в hex, любая
 * правка палитры в вебе молча разойдётся с приложением. Поэтому числа копируются из
 * CSS как есть, а перевод в sRGB делает код — та же математика OKLab, что у браузера
 * и у iOS-клиента (`DesignSystem/OKLCH.swift`).
 */
data class Oklch(val lightness: Double, val chroma: Double, val hue: Double) {

    /** Компоненты sRGB в диапазоне 0…1; за охватом sRGB — обрезка по краям, как в браузере. */
    fun rgb(): Triple<Double, Double, Double> {
        val radians = hue * Math.PI / 180
        val a = chroma * cos(radians)
        val b = chroma * sin(radians)

        // Куб умножением, а не pow: pow с дробным показателем от отрицательного
        // основания даёт NaN, и один промах красит экран в чёрное.
        val long = cube(lightness + 0.3963377774 * a + 0.2158037573 * b)
        val medium = cube(lightness - 0.1055613458 * a - 0.0638541728 * b)
        val short = cube(lightness - 0.0894841775 * a - 1.2914855480 * b)

        val linearRed = 4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short
        val linearGreen = -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short
        val linearBlue = -0.0041960863 * long - 0.7034186147 * medium + 1.7076147010 * short

        return Triple(gamma(linearRed), gamma(linearGreen), gamma(linearBlue))
    }

    fun toColor(): Color {
        val (red, green, blue) = rgb()
        return Color(red.toFloat(), green.toFloat(), blue.toFloat())
    }

    private fun cube(value: Double) = value * value * value

    /** Линейный sRGB → sRGB с гамма-коррекцией, с обрезкой по охвату. */
    private fun gamma(value: Double): Double {
        val clamped = value.coerceIn(0.0, 1.0)
        return if (clamped <= 0.0031308) 12.92 * clamped else 1.055 * clamped.pow(1 / 2.4) - 0.055
    }
}
