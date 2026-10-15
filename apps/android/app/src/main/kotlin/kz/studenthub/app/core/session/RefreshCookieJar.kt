package kz.studenthub.app.core.session

import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl

/** Где лежит refresh-cookie прямо сейчас. Интерфейс — ради тестов `SessionStore`. */
interface RefreshCookieStore {
    /** Значение refresh-cookie, если оно сейчас есть у сетевого клиента. */
    fun value(): String?

    /** Вернуть значение в хранилище cookie — после того как оно опустело. */
    fun restore(value: String)

    fun clear()
}

/**
 * Cookie сетевого клиента: в памяти процесса.
 *
 * Сервер отдаёт refresh только в httpOnly-cookie (`BACKEND_RULES §18.6`). httpOnly
 * ограничивает JavaScript в браузере, а не владельца хранилища: OkHttp эту cookie
 * приложению показывает. Держим её в памяти, а надёжная копия живёт в зашифрованном
 * `SecretStore` — её переносит туда `SessionStore` после каждого входа и обновления,
 * и возвращает сюда перед обновлением после перезапуска процесса. Так же устроена
 * связка cookie-хранилища и связки ключей в iOS.
 */
class RefreshCookieJar(apiBaseUrl: String) : CookieJar, RefreshCookieStore {
    /** Cookie выставлена на auth-путь: по другому адресу её не отдать и не принять. */
    private val authUrl: HttpUrl = apiBaseUrl.trimEnd('/').plus("/auth").toHttpUrl()
    private val cookies = mutableListOf<Cookie>()

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        for (cookie in cookies) {
            this.cookies.removeAll { it.name == cookie.name && it.domain == cookie.domain && it.path == cookie.path }
            // Пустое значение и истёкший срок — это сервер стирает cookie на выходе.
            if (cookie.value.isNotEmpty() && cookie.expiresAt > System.currentTimeMillis()) this.cookies += cookie
        }
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val now = System.currentTimeMillis()
        cookies.removeAll { it.expiresAt <= now }
        return cookies.filter { it.matches(url) }
    }

    @Synchronized
    override fun value(): String? = cookies.firstOrNull { it.name == COOKIE_NAME && it.matches(authUrl) }?.value

    @Synchronized
    override fun restore(value: String) {
        val path = authUrl.encodedPath
        cookies.removeAll { it.name == COOKIE_NAME }
        cookies += Cookie.Builder()
            .name(COOKIE_NAME)
            .value(value)
            .hostOnlyDomain(authUrl.host)
            .path(path)
            .expiresAt(System.currentTimeMillis() + LIFETIME_MILLIS)
            .httpOnly()
            .apply { if (authUrl.isHttps) secure() }
            .build()
    }

    @Synchronized
    override fun clear() {
        cookies.removeAll { it.name == COOKIE_NAME }
    }

    companion object {
        /** Имя задано сервером (`apps/api/src/modules/auth/auth.constants.ts`). */
        const val COOKIE_NAME = "sh_refresh"

        /** Срок жизни refresh-токена на сервере — 30 дней; cookie не должна его пережить. */
        private const val LIFETIME_MILLIS = 30L * 24 * 60 * 60 * 1000
    }
}
