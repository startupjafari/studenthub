package kz.studenthub.app.core.model

import java.util.Locale

/**
 * Язык, на котором приложение реально говорит. Строки есть только на русском и казахском,
 * и на любом другом языке системы ресурсы откатываются к русским. Даты и дни недели
 * обязаны идти за строками, иначе на английском телефоне выходит «Mon» и «11:27 AM»
 * посреди русского экрана.
 */
fun appLocale(system: Locale = Locale.getDefault()): Locale =
    if (system.language == KAZAKH.language) KAZAKH else RUSSIAN

private val RUSSIAN: Locale = Locale.forLanguageTag("ru")
private val KAZAKH: Locale = Locale.forLanguageTag("kk")
