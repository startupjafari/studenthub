package kz.studenthub.app.core.network

import kotlinx.serialization.SerializationStrategy
import java.util.UUID

enum class HttpMethod { GET, POST, PATCH, PUT, DELETE }

/**
 * Описание запроса к API. Путь задаётся без префикса `/api/v1` — он уже в адресе из
 * конфигурации сборки.
 */
data class Endpoint(
    val method: HttpMethod,
    val path: String,
    val query: List<Pair<String, String>> = emptyList(),
    val body: ByteArray? = null,
    /** Нужен ли `Authorization`. Публичных маршрутов немного: вход, обновление сессии, версия. */
    val requiresAuthorization: Boolean = true,
    /** Тип тела. По умолчанию JSON; multipart подставляет свой вместе с границей. */
    val contentType: String = "application/json",
) {
    /**
     * Можно ли повторить запрос при обрыве или 5xx. Повторяем только чтение: повтор POST
     * создаст вторую заявку или второе сообщение.
     */
    val isIdempotent: Boolean get() = method == HttpMethod.GET

    fun publicRoute(): Endpoint = copy(requiresAuthorization = false)

    companion object {
        fun get(path: String, vararg query: Pair<String, String?>): Endpoint =
            Endpoint(HttpMethod.GET, path, query.mapNotNull { (k, v) -> v?.let { k to it } })

        fun post(path: String): Endpoint = Endpoint(HttpMethod.POST, path)

        fun delete(path: String): Endpoint = Endpoint(HttpMethod.DELETE, path)

        fun <B> json(method: HttpMethod, path: String, serializer: SerializationStrategy<B>, body: B): Endpoint =
            Endpoint(method, path, body = AppJson.encodeToString(serializer, body).toByteArray())

        fun <B> post(path: String, serializer: SerializationStrategy<B>, body: B): Endpoint =
            json(HttpMethod.POST, path, serializer, body)

        fun <B> patch(path: String, serializer: SerializationStrategy<B>, body: B): Endpoint =
            json(HttpMethod.PATCH, path, serializer, body)

        fun multipart(path: String, form: MultipartForm): Endpoint =
            Endpoint(HttpMethod.POST, path, body = form.encoded(), contentType = form.contentType)
    }

    override fun equals(other: Any?): Boolean =
        other is Endpoint && method == other.method && path == other.path && query == other.query &&
            requiresAuthorization == other.requiresAuthorization && contentType == other.contentType &&
            (body?.contentEquals(other.body) ?: (other.body == null))

    override fun hashCode(): Int = listOf(method, path, query, requiresAuthorization, contentType).hashCode()
}

/**
 * Сборка `multipart/form-data`. Своя, а не из OkHttp: тело нужно байтами заранее —
 * его повторяют при обновлении токена, а одноразовый `RequestBody` второй раз не прочесть.
 */
class MultipartForm(val boundary: String = "studenthub.${UUID.randomUUID()}") {
    private val body = java.io.ByteArrayOutputStream()

    val contentType: String get() = "multipart/form-data; boundary=$boundary"

    fun append(value: String, name: String) {
        write("--$boundary\r\n")
        write("Content-Disposition: form-data; name=\"$name\"\r\n\r\n")
        write(value)
        write("\r\n")
    }

    fun append(data: ByteArray, name: String, filename: String, mime: String) {
        write("--$boundary\r\n")
        write("Content-Disposition: form-data; name=\"$name\"; filename=\"${filename.replace("\"", "")}\"\r\n")
        write("Content-Type: $mime\r\n\r\n")
        body.write(data)
        write("\r\n")
    }

    /** Закрывающая граница обязательна: без неё сервер ждёт продолжения тела. */
    fun encoded(): ByteArray = body.toByteArray() + "--$boundary--\r\n".toByteArray()

    private fun write(text: String) = body.write(text.toByteArray())
}
