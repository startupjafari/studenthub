package kz.studenthub.app.core.ui

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource

/**
 * Текст для человека, который модель экрана отдаёт, не зная языка.
 *
 * Модели живут без `Context` — так они проверяются обычными unit-тестами. Серверное
 * сообщение уже на языке платформы и идёт как есть (`Raw`); свои строки — ключом
 * ресурса (`Res`), а перевод выбирается в момент показа.
 */
sealed interface UiText {
    data class Raw(val value: String) : UiText

    data class Res(@StringRes val id: Int, val args: List<Any> = emptyList()) : UiText

    @Composable
    fun resolve(): String = when (this) {
        is Raw -> value
        is Res -> stringResource(id, *args.toTypedArray())
    }

    fun resolve(context: android.content.Context): String = when (this) {
        is Raw -> value
        is Res -> context.getString(id, *args.toTypedArray())
    }
}
