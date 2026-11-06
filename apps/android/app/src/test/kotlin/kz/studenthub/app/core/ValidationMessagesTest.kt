package kz.studenthub.app.core

import java.io.File
import kz.studenthub.app.R
import kz.studenthub.app.core.network.ApiError
import kz.studenthub.app.core.network.ApiErrorCode
import kz.studenthub.app.core.network.ApiErrorDetail
import kz.studenthub.app.core.network.ValidationMessages
import kz.studenthub.app.core.network.validationText
import kz.studenthub.app.core.ui.UiText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Сообщения валидации API (21.B2): сервер отдаёт ключ `validation.…`, текст — наш.
 *
 * Ключи сверяются с реестром `VALIDATION_MESSAGE_KEYS` в `packages/shared-schemas`, а
 * переводы — с ресурсами: ключ, добавленный в схему и забытый здесь, на экране выглядел бы
 * общей строкой вместо конкретной причины.
 */
class ValidationMessagesTest {
    private val repo: File = generateSequence(File("").absoluteFile) { it.parentFile }
        .first { File(it, "packages/shared-schemas").isDirectory }

    private fun registryKeys(): Set<String> {
        val source = File(repo, "packages/shared-schemas/src/validation-messages.ts").readText()
        return Regex("""^\s+'(validation\.[\w.]+)',$""", RegexOption.MULTILINE)
            .findAll(source).map { it.groupValues[1] }.toSet()
    }

    private fun resourceNames(dir: String): Set<String> {
        val xml = File(repo, "apps/android/app/src/main/res/$dir/strings_ios.xml").readText()
        return Regex("""<string name="(validation_[\w]+)">""").findAll(xml).map { it.groupValues[1] }.toSet()
    }

    @Test
    fun everyRegistryKeyIsKnown() {
        val registry = registryKeys()
        assertTrue(registry.isNotEmpty())
        assertEquals(registry, ValidationMessages.keys)
    }

    @Test
    fun everyKeyIsTranslated() {
        val expected = registryKeys().map { it.replace('.', '_') }.toSet()
        for (dir in listOf("values", "values-kk", "values-en")) {
            assertEquals("строки валидации в $dir", expected, resourceNames(dir))
        }
    }

    @Test
    fun knownKeyBecomesResource() {
        val detail = ApiErrorDetail("password", "validation.password.tooShort")
        assertEquals(UiText.Res(R.string.validation_password_tooShort), detail.validationText)
    }

    @Test
    fun unknownKeyAndPlainTextAreNotTranslated() {
        assertNull(ApiErrorDetail("email", "validation.fromTheFuture").validationText)
        assertNull(ApiErrorDetail("email", "Неверный адрес").validationText)
    }

    /** Ошибка поля конкретнее общего «проверьте поля» — она и показывается. */
    @Test
    fun serverErrorPrefersFieldMessage() {
        val withKey = ApiError.Server(
            ApiErrorCode.VALIDATION_ERROR,
            "Ошибка валидации",
            listOf(ApiErrorDetail("birthDate", "validation.birthDate.implausible")),
            422,
        )
        assertEquals(UiText.Res(R.string.validation_birthDate_implausible), withKey.displayMessage)

        val plain = ApiError.Server(
            ApiErrorCode.VALIDATION_ERROR,
            "Ошибка валидации",
            listOf(ApiErrorDetail("email", "Неверный адрес")),
            422,
        )
        assertEquals(UiText.Res(R.string.error_validation), plain.displayMessage)
    }
}
