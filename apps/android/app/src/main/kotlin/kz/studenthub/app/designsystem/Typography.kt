package kz.studenthub.app.designsystem

import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * Типографические роли (DESIGN_SYSTEM §3).
 *
 * Те же два отступления от веба, что в iOS, оба в пользу платформы: гарнитура —
 * системная (Roboto), а не Inter, и размеры в sp — они растут вместе с масштабом
 * шрифта в настройках, что требует приёмка. Правило «не больше трёх уровней на экран»
 * переносится без изменений: заголовок страницы, заголовок блока, текст.
 */
object AppType {
    /** Заголовок экрана. Веб: `text-lg font-bold`. */
    val pageTitle = TextStyle(fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.Bold)

    /** Заголовок секции и диалога. Веб: `text-base font-semibold`. */
    val sectionTitle = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold)

    /** Заголовок карточки. Веб: `text-base font-medium`. */
    val cardTitle = TextStyle(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium)

    /** Основной текст: тело карточек, строки списков, поля. Веб: `text-sm`. */
    val body = TextStyle(fontSize = 16.sp, lineHeight = 22.sp)

    /** Вторичный и мета-текст: даты, счётчики, подписи. Веб: `text-xs`. */
    val meta = TextStyle(fontSize = 13.sp, lineHeight = 18.sp)

    /** Крупное число в плитке. Веб: `text-2xl font-semibold`. */
    val metric = TextStyle(fontSize = 24.sp, lineHeight = 30.sp, fontWeight = FontWeight.SemiBold)

    /**
     * Моноширинные цифры для колонок и счётчиков: иначе числа «пляшут» при обновлении.
     * Одиночное крупное число — наоборот, пропорциональными.
     */
    fun tabular(style: TextStyle): TextStyle = style.copy(fontFeatureSettings = "tnum")
}
