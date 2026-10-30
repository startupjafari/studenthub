package kz.studenthub.app.designsystem

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color

/**
 * Токены цвета StudentHub.
 *
 * Имена повторяют `globals.css` один в один, значения скопированы оттуда же
 * (DESIGN_SYSTEM §2.1) — тем же списком, что `Palette.swift` в iOS. Светлая и тёмная
 * темы — два экземпляра одного набора, поэтому экраны тему не упоминают:
 * `AppTheme.colors.card` верен в обеих.
 *
 * Статусные токены в тёмной теме не переопределены — так устроен веб.
 */
@Immutable
data class Palette(
    // Поверхности
    val background: Color,
    val foreground: Color,
    val card: Color,
    val cardForeground: Color,
    val popover: Color,
    val popoverForeground: Color,
    /** Подложка модальных окон: затемняет фон в обеих темах. */
    val overlay: Color,
    // Действия
    val primary: Color,
    val primaryForeground: Color,
    val secondary: Color,
    val secondaryForeground: Color,
    val accent: Color,
    val accentForeground: Color,
    // Приглушённое
    val muted: Color,
    val mutedForeground: Color,
    // Статусы
    val destructive: Color,
    val success: Color,
    val successForeground: Color,
    val warning: Color,
    val warningForeground: Color,
    val info: Color,
    val infoForeground: Color,
    // Линии и фокус
    val border: Color,
    val input: Color,
    val ring: Color,
    // Данные
    val chart1: Color,
    val chart2: Color,
    val chart3: Color,
    val chart4: Color,
    val chart5: Color,
) {
    companion object {
        private fun c(l: Double, ch: Double, h: Double) = Oklch(l, ch, h).toColor()

        private val white = c(1.0, 0.0, 0.0)
        private val ink = c(0.145, 0.0, 0.0)
        private val success = c(0.522, 0.114, 162.5)
        private val warning = c(0.543, 0.119, 70.1)
        private val info = c(0.543, 0.188, 259.8)
        private val chart3 = c(0.696, 0.149, 162.5)
        private val chart4 = c(0.769, 0.165, 70.1)

        val Light = Palette(
            background = white,
            foreground = ink,
            card = white,
            cardForeground = ink,
            popover = white,
            popoverForeground = ink,
            overlay = ink,
            primary = c(0.546, 0.215, 262.9),
            primaryForeground = white,
            secondary = c(0.967, 0.003, 264.5),
            secondaryForeground = c(0.205, 0.0, 0.0),
            accent = c(0.967, 0.003, 264.5),
            accentForeground = c(0.205, 0.0, 0.0),
            muted = c(0.967, 0.003, 264.5),
            mutedForeground = c(0.545, 0.023, 264.4),
            destructive = c(0.561, 0.208, 25.3),
            success = success,
            successForeground = white,
            warning = warning,
            warningForeground = ink,
            info = info,
            infoForeground = white,
            border = c(0.928, 0.006, 264.5),
            input = c(0.668, 0.006, 264.5),
            ring = c(0.546, 0.215, 262.9),
            chart1 = c(0.546, 0.215, 262.9),
            chart2 = c(0.623, 0.188, 259.8),
            chart3 = chart3,
            chart4 = chart4,
            chart5 = c(0.637, 0.208, 25.3),
        )

        val Dark = Palette(
            background = c(0.177, 0.009, 264.3),
            foreground = c(0.967, 0.003, 264.5),
            card = c(0.214, 0.019, 266.1),
            cardForeground = c(0.967, 0.003, 264.5),
            popover = c(0.214, 0.019, 266.1),
            popoverForeground = c(0.967, 0.003, 264.5),
            overlay = c(0.09, 0.008, 264.3),
            primary = c(0.573, 0.188, 259.8),
            primaryForeground = white,
            secondary = c(0.261, 0.024, 267.1),
            secondaryForeground = c(0.967, 0.003, 264.5),
            accent = c(0.261, 0.024, 267.1),
            accentForeground = c(0.967, 0.003, 264.5),
            muted = c(0.261, 0.024, 267.1),
            mutedForeground = c(0.714, 0.019, 261.3),
            destructive = c(0.711, 0.166, 22.2),
            success = success,
            successForeground = white,
            warning = warning,
            warningForeground = ink,
            info = info,
            infoForeground = white,
            border = c(0.311, 0.022, 259.4),
            input = c(0.49, 0.025, 260.1),
            ring = c(0.623, 0.188, 259.8),
            chart1 = c(0.623, 0.188, 259.8),
            chart2 = c(0.546, 0.215, 262.9),
            chart3 = chart3,
            chart4 = chart4,
            chart5 = c(0.711, 0.166, 22.2),
        )
    }
}
