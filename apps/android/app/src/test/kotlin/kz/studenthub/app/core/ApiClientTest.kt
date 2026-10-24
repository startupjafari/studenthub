package kz.studenthub.app.core

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.Serializable
import kz.studenthub.app.BuildConfig
import kz.studenthub.app.core.chats.ChatsApi
import kz.studenthub.app.core.network.ApiClient
import kz.studenthub.app.core.network.ApiError
import kz.studenthub.app.core.network.ApiErrorCode
import kz.studenthub.app.core.network.AppJson
import kz.studenthub.app.core.network.AuthorizationProvider
import kz.studenthub.app.core.network.Endpoint
import kz.studenthub.app.core.network.ErrorEnvelope
import kz.studenthub.app.core.network.InstantSerializer
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.time.Instant

/**
 * Конверт ответа — публичный контракт API (PROJECT.md §8.1). Расхождение здесь выглядит
 * на экране как пустой список без ошибки, поэтому клиент проверяется на настоящем
 * HTTP-сервере в памяти, а не на моках.
 */
class ApiClientTest {
    private lateinit var server: MockWebServer

    @Before
    fun start() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun stop() = server.close()

    private fun client(auth: AuthorizationProvider? = null) = ApiClient(
        baseUrl = server.url("/api/v1/").toString(),
        http = OkHttpClient(),
        clientVersion = "android/1.0.0+1",
        authorization = auth,
    )

    private fun respond(code: Int, body: String) =
        server.enqueue(MockResponse.Builder().code(code).body(body).build())

    @Serializable
    private data class Item(val id: String)

    @Test
    fun successEnvelopeUnwrapsDataAndMeta() = runTest {
        respond(200, """{"success":true,"data":[{"id":"a"},{"id":"b"}],"meta":{"cursor":"c-2","hasNext":true}}""")
        val page = client().page(Endpoint.get("chats"), Item.serializer())
        assertEquals(listOf("a", "b"), page.items.map { it.id })
        assertEquals("c-2", page.meta?.cursor)
        assertEquals(true, page.meta?.hasNext)
        assertNull(page.meta?.total)
    }

    /** По заголовку сервер отличает сборки и решает, не пора ли обновиться. */
    @Test
    fun everyRequestCarriesClientVersionAndPath() = runTest {
        respond(200, """{"success":true,"data":{"id":"x"}}""")
        client().send(Endpoint.get("chats/c-1", "limit" to "50"), Item.serializer())
        val request = server.takeRequest()
        assertEquals("android/1.0.0+1", request.headers["X-Client-Version"])
        assertEquals("/api/v1/chats/c-1?limit=50", request.target)
    }

    @Test
    fun errorEnvelopeCarriesCodeAndDetails() = runTest {
        respond(
            422,
            """{"success":false,"error":{"code":"VALIDATION_ERROR","message":"Ошибка валидации",
            "details":[{"field":"email","message":"Неверный адрес"}]},"statusCode":422}""",
        )
        try {
            client().send(Endpoint.post("auth/login").publicRoute())
            fail("ошибка сервера должна дойти до вызывающего")
        } catch (error: ApiError.Server) {
            assertEquals(ApiErrorCode.VALIDATION_ERROR, error.code)
            assertEquals(422, error.statusCode)
            assertEquals("email", error.details.first().field)
        }
    }

    /** Новый код появится на сервере раньше, чем все обновят приложение. */
    @Test
    fun unknownCodeFallsBackInsteadOfFailing() {
        val envelope = AppJson.decodeFromString(
            ErrorEnvelope.serializer(),
            """{"error":{"code":"SOMETHING_NEW","message":"Новое"},"statusCode":400}""",
        )
        assertEquals("SOMETHING_NEW", ApiErrorCode(envelope.error.code).raw)
    }

    @Test
    fun onlyAuthFailuresTriggerRefresh() {
        assertTrue(ApiErrorCode.UNAUTHORIZED.meansSessionExpired)
        assertTrue(ApiErrorCode.TOKEN_EXPIRED.meansSessionExpired)
        // Прав нет — повтор с новым токеном ничего не изменит.
        assertFalse(ApiErrorCode.FORBIDDEN.meansSessionExpired)
        assertFalse(ApiErrorCode.WRONG_SCOPE.meansSessionExpired)
    }

    /** Ровно одна попытка продлить сессию; запрос повторяется со свежим токеном. */
    @Test
    fun expiredTokenIsRefreshedOnceAndRequestRetried() = runTest {
        respond(401, """{"error":{"code":"TOKEN_EXPIRED","message":"Истёк"},"statusCode":401}""")
        respond(200, """{"success":true,"data":{"id":"ok"}}""")
        val auth = CountingAuth()
        val item = client(auth).send(Endpoint.get("me"), Item.serializer())

        assertEquals("ok", item.id)
        assertEquals(1, auth.refreshes)
        assertEquals("Bearer old", server.takeRequest().headers["Authorization"])
        assertEquals("Bearer fresh", server.takeRequest().headers["Authorization"])
    }

    /** Нет прав — не повод обновлять сессию. */
    @Test
    fun forbiddenDoesNotRefresh() = runTest {
        respond(403, """{"error":{"code":"FORBIDDEN","message":"Нет доступа"},"statusCode":403}""")
        val auth = CountingAuth()
        runCatching { client(auth).send(Endpoint.get("me"), Item.serializer()) }
        assertEquals(0, auth.refreshes)
    }

    /** Ответ не по контракту (упал прокси, отдал HTML) не выдаётся за успех. */
    @Test
    fun htmlErrorBecomesMalformed() = runTest {
        respond(502, "<html>Bad gateway</html>")
        respond(502, "<html>Bad gateway</html>")
        respond(502, "<html>Bad gateway</html>")
        try {
            client().send(Endpoint.get("me"), Item.serializer())
            fail()
        } catch (error: ApiError.Malformed) {
            assertEquals(502, error.statusCode)
        }
    }

    /** POST не повторяется: повтор создал бы второе сообщение или вторую заявку. */
    @Test
    fun postIsNeverRetried() = runTest {
        respond(503, """{"error":{"code":"INTERNAL_ERROR","message":"x"},"statusCode":503}""")
        runCatching { client().send(Endpoint.post("chats/c/messages")) }
        assertEquals(1, server.requestCount)
    }

    /** «Без звука» — POST с телом: сервер разбирает его схемой, и пустой запрос — это 422. */
    @Test
    fun muteSendsJsonObject() = runTest {
        respond(201, """{"success":true,"data":null}""")
        ChatsApi(client(), OkHttpClient()).setMuted(true, "c-1")
        val request = server.takeRequest()
        assertEquals("/api/v1/chats/c-1/mute", request.target)
        assertEquals("{}", request.body?.utf8())
    }

    @Test
    fun baseUrlOfBuildPointsToVersionedApi() {
        assertTrue(BuildConfig.API_BASE_URL.endsWith("/api/v1"))
    }

    /** Сервер отдаёт `toISOString()` — с долями секунды и без них. */
    @Test
    fun datesWithAndWithoutFractions() {
        @Serializable
        data class Moment(@Serializable(InstantSerializer::class) val at: Instant)
        assertEquals(
            Instant.ofEpochMilli(1791290096789),
            AppJson.decodeFromString(Moment.serializer(), """{"at":"2026-10-06T12:34:56.789Z"}""").at,
        )
        assertEquals(
            Instant.ofEpochSecond(1791290096),
            AppJson.decodeFromString(Moment.serializer(), """{"at":"2026-10-06T12:34:56Z"}""").at,
        )
    }

    private class CountingAuth : AuthorizationProvider {
        var refreshes = 0

        override suspend fun accessToken() = "old"

        override suspend fun refreshedAccessToken(): String {
            refreshes++
            return "fresh"
        }
    }
}
