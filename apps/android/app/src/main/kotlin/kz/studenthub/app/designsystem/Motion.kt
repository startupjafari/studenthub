package kz.studenthub.app.designsystem

import android.provider.Settings
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import kotlin.math.PI

/**
 * Движение (DESIGN_SYSTEM §7).
 *
 * Длительности — только для декоративного движения. У всего, что человек тянет
 * пальцем, длительности нет — есть пружина: она хранит позицию и скорость, и смена
 * цели на лету не даёт разрыва.
 *
 * Пружины заданы так же, как в вебе (`shared/lib/spring.ts`) и iOS: затухание и время
 * отклика. Compose просит жёсткость — она выводится из отклика: k = (2π / response)².
 */
object Motion {
    object Duration {
        /** Отклик на действие: нажатие, смена цвета. */
        const val FEEDBACK = 150

        /** Появление парящего слоя: меню, поповер, лист. */
        const val LAYER = 200

        /** Смена поверхности: переход панели, раскрытие блока. */
        const val SURFACE = 300

        /** Оживление данных: рост полосы, счёт числа, вход плиток. */
        const val DATA = 500
    }

    private fun stiffness(response: Double): Float = ((2 * PI / response) * (2 * PI / response)).toFloat()

    /** Без перелёта: перемещение, возврат, всё спокойное. Веб: `damping: 1, response: 0.4`. */
    fun <T> calm(): FiniteAnimationSpec<T> = spring(dampingRatio = 1f, stiffness = stiffness(0.4))

    /** Лёгкий перелёт: шторка, строка списка. Веб: `damping: 0.8, response: 0.3`. */
    fun <T> lively(): FiniteAnimationSpec<T> = spring(dampingRatio = 0.8f, stiffness = stiffness(0.3))

    /** «Убрать анимацию» в настройках — сразу конечное состояние, без броска и перелёта. */
    fun <T> respecting(spec: FiniteAnimationSpec<T>, reduceMotion: Boolean): FiniteAnimationSpec<T> =
        if (reduceMotion) snap() else spec

    /** Смена экрана целиком — спокойный наплыв; при «Убрать анимацию» — сразу. */
    fun crossfade(reduceMotion: Boolean): ContentTransform =
        fadeIn(respecting(calm(), reduceMotion)) togetherWith fadeOut(respecting(calm(), reduceMotion))
}

/**
 * Включено ли «Убрать анимацию» (масштаб длительности анимаций = 0) — аналог
 * «уменьшения движения» в iOS. Читается при входе на экран: менять этот переключатель
 * посреди экрана никто не станет.
 */
@Composable
fun rememberReduceMotion(): Boolean {
    val resolver = LocalContext.current.contentResolver
    return remember(resolver) {
        Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }
}
