package kz.studenthub.app.core.network

import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Кто выдаёт токен запросу и что делать, когда сервер его не принял.
 *
 * Интерфейс нужен, чтобы сетевой слой не знал про хранение сессии, а сессия — про
 * формирование запросов: иначе они ссылаются друг на друга, и ни один не тестируется
 * в одиночку.
 */
interface AuthorizationProvider {
    /** Действующий токен или `null`, если пользователь не вошёл. */
    suspend fun accessToken(): String?

    /** Сервер ответил 401. Вернуть новый токен, если сессию удалось продлить. */
    suspend fun refreshedAccessToken(): String?
}

/**
 * Единственная дверь в API.
 *
 * Сюда стянуты решения, которые иначе расползаются по экранам: конверт ответа, коды
 * ошибок, заголовки, повторы и ровно один повтор после обновления токена — то же, что
 * `APIClient` в iOS.
 */
class ApiClient(
    private val baseUrl: HttpUrl,
    private val http: OkHttpClient,
    private val clientVersion: String,
    private val authorization: AuthorizationProvider? = null,
    private val maxRetries: Int = 2,
    /** Выдержка перед повтором — подменяется в тестах, чтобы не ждать секунды. */
    private val backoff: suspend (attempt: Int) -> Unit = { attempt -> delay(500L shl (attempt - 1)) },
) {
    constructor(
        baseUrl: String,
        http: OkHttpClient,
        clientVersion: String,
        authorization: AuthorizationProvider? = null,
    ) : this(baseUrl.toHttpUrl(), http, clientVersion, authorization)

    /** Клиент того же сервера с другим провайдером авторизации (или вовсе без него). */
    fun withAuthorization(provider: AuthorizationProvider?): ApiClient =
        ApiClient(baseUrl, http, clientVersion, provider, maxRetries, backoff)

    /** Запрос с телом ответа. */
    suspend fun <T> send(endpoint: Endpoint, serializer: KSerializer<T>): T {
        val body = perform(endpoint)
        return decode(SuccessEnvelope.serializer(serializer), body).data
    }

    /** Запрос со страницей списка: данные и курсоры приходят рядом, в одном конверте. */
    suspend fun <T> page(endpoint: Endpoint, itemSerializer: KSerializer<T>): Page<T> {
        val body = perform(endpoint)
        val envelope = decode(SuccessEnvelope.serializer(ListSerializer(itemSerializer)), body)
        return Page(envelope.data, envelope.meta)
    }

    /** Запрос без тела ответа (204 и операции, у которых ответ не нужен). */
    suspend fun send(endpoint: Endpoint) {
        perform(endpoint)
    }

    // --- внутреннее ---

    private fun <T> decode(strategy: DeserializationStrategy<T>, body: String): T =
        try {
            AppJson.decodeFromString(strategy, body)
        } catch (error: Exception) {
            throw ApiError.Decoding(error, 200)
        }

    private suspend fun perform(endpoint: Endpoint): String {
        val token = if (endpoint.requiresAuthorization) authorization?.accessToken() else null
        return try {
            attempt(endpoint, token)
        } catch (error: ApiError) {
            // Ровно одна попытка продлить сессию. Второй 401 после свежего токена означает,
            // что дело не в сроке жизни, и повторять бесполезно.
            val expired = error.code?.meansSessionExpired == true
            if (!endpoint.requiresAuthorization || !expired) throw error
            val refreshed = authorization?.refreshedAccessToken() ?: throw error
            attempt(endpoint, refreshed)
        }
    }

    private suspend fun attempt(endpoint: Endpoint, token: String?): String {
        var lastTransportError: IOException? = null
        for (retry in 0..maxRetries) {
            // Выдержка с ростом: 0.5 с, затем 1 с. Без неё повтор приходит в тот же обрыв.
            if (retry > 0) backoff(retry)
            val response = try {
                http.newCall(request(endpoint, token)).await()
            } catch (error: IOException) {
                if (!endpoint.isIdempotent || retry == maxRetries) throw ApiError.Transport(error)
                lastTransportError = error
                continue
            }
            response.use {
                val text = it.body.string()
                if (it.isSuccessful) return text
                val failure = serverError(text, it.code)
                // 5xx и 429 — состояние сервера, а не запроса: их стоит повторить,
                // если запрос идемпотентный.
                val worthRetrying = it.code >= 500 || it.code == 429
                if (worthRetrying && endpoint.isIdempotent && retry < maxRetries) return@use
                throw failure
            }
        }
        throw ApiError.Transport(lastTransportError ?: IOException("нет ответа"))
    }

    private fun request(endpoint: Endpoint, token: String?): Request {
        val url = baseUrl.newBuilder().apply {
            endpoint.path.trim('/').split('/').forEach { addPathSegment(it) }
            endpoint.query.forEach { (name, value) -> addQueryParameter(name, value) }
        }.build()

        val body = endpoint.body?.toRequestBody(endpoint.contentType.toMediaType())
            ?: if (endpoint.method == HttpMethod.GET || endpoint.method == HttpMethod.DELETE) null
            else ByteArray(0).toRequestBody(null)

        return Request.Builder()
            .url(url)
            .method(endpoint.method.name, body)
            .header("Accept", "application/json")
            // По нему сервер отличает сборки в логах и решает, не пора ли просить
            // человека обновиться (Задача АБ2).
            .header("X-Client-Version", clientVersion)
            .apply { if (token != null) header("Authorization", "Bearer $token") }
            .build()
    }

    /**
     * Разбор тела ошибки. Сервер ответил не по контракту (упал прокси, отдал HTML) — код
     * выводим из статуса: экран всё равно должен что-то показать.
     */
    private fun serverError(text: String, statusCode: Int): ApiError {
        val envelope = runCatching { AppJson.decodeFromString(ErrorEnvelope.serializer(), text) }.getOrNull()
            ?: return ApiError.Malformed(statusCode)
        return ApiError.Server(
            code = ApiErrorCode(envelope.error.code),
            serverMessage = envelope.error.message,
            details = envelope.error.details.orEmpty(),
            statusCode = statusCode,
        )
    }
}

/**
 * Асинхронный вызов OkHttp как приостановка; отмена корутины отменяет и запрос. Ответ,
 * пришедший уже после отмены, никто не прочтёт — его закрываем, иначе соединение
 * остаётся занятым и пул OkHttp течёт.
 */
suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onResponse(call: Call, response: Response) =
            continuation.resume(response) { _, unread, _ -> unread.close() }

        override fun onFailure(call: Call, e: IOException) {
            if (!continuation.isCancelled) continuation.resumeWithException(e)
        }
    })
}
