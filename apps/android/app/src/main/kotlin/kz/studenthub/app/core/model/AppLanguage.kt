package kz.studenthub.app.core.model

import java.util.Locale

/**
 * Язык приложения и API — `ru`, `kz`, `en` (`SUPPORTED_LOCALES` в `packages/shared-config`).
 *
 * Платформа знает казахский только по коду ISO 639-1 `kk`: `java.util.Locale`,
 * `LocaleListCompat`, ресурсы `values-kk`, `locales_config.xml`, форматтеры дат и чисел.
 * Переход через эту границу — только здесь, как в вебе (`toPlatformLanguage` /
 * `fromPlatformLanguage`). Так же читаются старые значения `kk`, сохранённые до перехода на `kz`.
 */
object AppLanguage {
    const val RU = "ru"
    const val KZ = "kz"
    const val EN = "en"

    /** Языки, которые понимает сервер. */
    val supported = listOf(RU, KZ, EN)

    /** Код приложения → языковой тег платформы: `kz` → `kk`. */
    fun toPlatform(code: String): String = if (code == KZ) "kk" else code

    /**
     * Языковой тег платформы или старое значение → код приложения: `kk`, `kk-KZ`, `kz` → `kz`;
     * `ru_RU` → `ru`. Неподдерживаемое и пустое → `null`.
     */
    fun fromPlatform(tag: String?): String? {
        val base = tag?.trim()?.lowercase(Locale.ROOT)?.split('-', '_')?.firstOrNull().orEmpty()
        if (base == "kk" || base == KZ) return KZ
        return base.takeIf { it in supported }
    }

    /** Язык `locale` как код приложения; язык, которого сервер не знает, — `null`. */
    fun of(locale: Locale): String? = fromPlatform(locale.language)
}
