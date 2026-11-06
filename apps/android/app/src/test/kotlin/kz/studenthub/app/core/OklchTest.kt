package kz.studenthub.app.core

import kz.studenthub.app.designsystem.Oklch
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Ожидаемые значения посчитаны по формулам OKLab Оттоссона и сверены с тем, что браузер
 * рисует по `globals.css`, — те же числа, что в тестах iOS. Тест ловит ровно то, ради
 * чего палитра хранится в oklch: расхождение приложения с вебом.
 */
class OklchTest {
    private val accuracy = 0.0005

    private fun assertRgb(expected: Triple<Double, Double, Double>, color: Oklch) {
        val (r, g, b) = color.rgb()
        assertEquals(expected.first, r, accuracy)
        assertEquals(expected.second, g, accuracy)
        assertEquals(expected.third, b, accuracy)
    }

    @Test
    fun whiteStaysWhite() = assertRgb(Triple(1.0, 1.0, 1.0), Oklch(1.0, 0.0, 0.0))

    /** `--foreground` светлой темы: серый без насыщенности, около #0A0A0A. */
    @Test
    fun achromaticForeground() = assertRgb(Triple(0.039388, 0.039388, 0.039388), Oklch(0.145, 0.0, 0.0))

    /** `--primary` светлой темы — образовательная синяя, #2563EB. */
    @Test
    fun primaryMatchesWeb() = assertRgb(Triple(0.145754, 0.388121, 0.920921), Oklch(0.546, 0.215, 262.9))

    /** `--success` выходит за охват sRGB: обрезка по краю, а не переворот цвета. */
    @Test
    fun outOfGamutIsClamped() = assertRgb(Triple(0.0, 0.491168, 0.335063), Oklch(0.522, 0.114, 162.5))
}
