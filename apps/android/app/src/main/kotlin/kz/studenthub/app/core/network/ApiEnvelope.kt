package kz.studenthub.app.core.network

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import java.time.Instant

/**
 * Конверт ответа API (PROJECT.md §8.1, BACKEND_RULES §4).
 *
 * Интерцептор сервера заворачивает данные в `{ success, data, meta? }`. Разворачиваем
 * конверт здесь один раз, чтобы экраны работали с доменными типами.
 */
@Serializable
data class SuccessEnvelope<T>(val data: T, val meta: ApiMeta? = null)

/**
 * Служебные поля страницы. У курсорной пагинации истории чата две стороны:
 * `cursor`/`hasNext` — более старые записи, `prevCursor`/`hasPrev` — более новые.
 */
@Serializable
data class ApiMeta(
    val cursor: String? = null,
    val hasNext: Boolean? = null,
    val total: Int? = null,
    val prevCursor: String? = null,
    val hasPrev: Boolean? = null,
)

/** Страница списка: данные вместе с курсорами. */
data class Page<T>(val items: List<T>, val meta: ApiMeta?)

@Serializable
data class ErrorEnvelope(val error: Body, val statusCode: Int = 0) {
    @Serializable
    data class Body(val code: String, val message: String, val details: List<ApiErrorDetail>? = null)
}

/**
 * Разбор JSON для всего приложения.
 *
 * Лишние поля игнорируются: сервер добавляет их раньше, чем обновятся сборки.
 * `explicitNulls = false` — отсутствующее поле и `null` значат одно и то же.
 */
val AppJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
    encodeDefaults = true
}

/**
 * Даты из API. Сервер отдаёт `toISOString()` — ISO 8601 с долями секунды
 * (`2026-10-06T12:34:56.789Z`). `Instant.parse` читает и с ними, и без них.
 */
object InstantSerializer : KSerializer<Instant> {
    override val descriptor = PrimitiveSerialDescriptor("Instant", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): Instant = Instant.parse(decoder.decodeString())

    override fun serialize(encoder: Encoder, value: Instant) = encoder.encodeString(value.toString())
}
