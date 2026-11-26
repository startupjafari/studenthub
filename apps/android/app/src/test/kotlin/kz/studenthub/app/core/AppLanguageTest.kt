package kz.studenthub.app.core

import kz.studenthub.app.core.model.AppLanguage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Locale

/** Казахский: `kz` в API и данных, `kk` у платформы — граница только в [AppLanguage]. */
class AppLanguageTest {
    @Test
    fun platformTagsBecomeAppCodes() {
        assertEquals("kz", AppLanguage.fromPlatform("kk"))
        assertEquals("kz", AppLanguage.fromPlatform("kk-KZ"))
        assertEquals("kz", AppLanguage.fromPlatform("kz"))
        assertEquals("ru", AppLanguage.fromPlatform("ru_RU"))
        assertEquals("en", AppLanguage.fromPlatform(" EN-us "))
    }

    @Test
    fun unsupportedAndEmptyAreNull() {
        assertNull(AppLanguage.fromPlatform("de"))
        assertNull(AppLanguage.fromPlatform(""))
        assertNull(AppLanguage.fromPlatform(null))
    }

    @Test
    fun appCodesBecomePlatformTags() {
        assertEquals("kk", AppLanguage.toPlatform("kz"))
        assertEquals("ru", AppLanguage.toPlatform("ru"))
        assertEquals("en", AppLanguage.toPlatform("en"))
    }

    /** `java.util.Locale` казахского — `kk`; приложение видит его как `kz`. */
    @Test
    fun javaLocaleIsMapped() {
        assertEquals("kz", AppLanguage.of(Locale.forLanguageTag("kk-KZ")))
        assertNull(AppLanguage.of(Locale.GERMAN))
    }
}
