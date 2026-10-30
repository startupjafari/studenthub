package kz.studenthub.app.core

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kz.studenthub.app.core.network.ApiError
import kz.studenthub.app.core.network.ApiErrorCode
import kz.studenthub.app.core.session.AuthSession
import kz.studenthub.app.core.session.InMemorySecretStore
import kz.studenthub.app.core.session.SecretStore.SecretKey
import kz.studenthub.app.core.session.SessionRefreshing
import kz.studenthub.app.core.session.SessionStore
import kz.studenthub.app.support.LONG_LIVED_TOKEN
import kz.studenthub.app.support.MemoryCookies
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

class SessionStoreTest {
    /**
     * Главное требование плана: сколько бы экранов ни спросили токен разом, обновление
     * уходит одно. Второй refresh сервер считает повторным использованием и гасит сессию.
     */
    @Test
    fun concurrentCallersShareOneRefresh() = runTest {
        val auth = StubAuth()
        val store = store(auth)

        val results = (1..3).map { async { store.refreshedAccessToken() } }.awaitAll()

        assertEquals(3, results.count { it != null })
        assertEquals(1, auth.refreshCalls.get())
    }

    @Test
    fun validTokenIsReusedWithoutNetwork() = runTest {
        val auth = StubAuth()
        val store = store(auth)
        store.adopt(AuthSession(LONG_LIVED_TOKEN))

        assertEquals(LONG_LIVED_TOKEN, store.accessToken())
        assertEquals(0, auth.refreshCalls.get())
    }

    /** Без признака прошлого входа обновление не дёргаем: человек ещё не входил. */
    @Test
    fun coldStartWithoutSessionDoesNotRefresh() = runTest {
        val auth = StubAuth()
        assertNull(store(auth).accessToken())
        assertEquals(0, auth.refreshCalls.get())
    }

    /** Сессия мертва — следы стираем, иначе каждый запрос снова пойдёт обновляться. */
    @Test
    fun deadSessionIsForgotten() = runTest {
        val secrets = InMemorySecretStore()
        val cookies = MemoryCookies("rt-1")
        val auth = StubAuth(failure = ApiError.Server(ApiErrorCode.TOKEN_EXPIRED, "Сессия истекла", emptyList(), 401))
        val store = SessionStore(auth, secrets, cookies)
        store.adopt(AuthSession(LONG_LIVED_TOKEN))

        assertNull(store.refreshedAccessToken())
        assertFalse(store.hasStoredSession)
        assertNull(secrets.value(SecretKey.REFRESH_TOKEN))
        assertNull(cookies.value())
    }

    /**
     * Отказ в продлении (сессию отозвали) объявляется: оболочка уходит на вход с той же
     * уборкой, что при ручном выходе (§7.2). Без прошлой сессии объявлять нечего.
     */
    @Test
    fun revokedSessionIsAnnounced() = runTest {
        val auth = StubAuth(failure = ApiError.Server(ApiErrorCode.UNAUTHORIZED, "Сессия завершена", emptyList(), 401))
        val store = SessionStore(auth, InMemorySecretStore(), MemoryCookies("rt-1"))
        store.adopt(AuthSession(LONG_LIVED_TOKEN))
        var announced = 0
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { store.expired.collect { announced++ } }

        store.refreshedAccessToken()
        store.refreshedAccessToken()

        assertEquals(1, announced)
    }

    /** Нет сети — не повод выходить из аккаунта: сессия остаётся до следующей попытки. */
    @Test
    fun networkFailureKeepsSession() = runTest {
        val secrets = InMemorySecretStore()
        val auth = StubAuth(failure = ApiError.Transport(java.io.IOException("offline")))
        val store = SessionStore(auth, secrets, MemoryCookies("rt-1"))
        store.adopt(AuthSession(LONG_LIVED_TOKEN))

        assertNull(store.refreshedAccessToken())
        assertEquals("rt-1", secrets.value(SecretKey.REFRESH_TOKEN))
    }

    @Test
    fun signOutClearsEverything() = runTest {
        val secrets = InMemorySecretStore()
        val cookies = MemoryCookies("rt-1")
        val store = SessionStore(StubAuth(), secrets, cookies)
        store.adopt(AuthSession(LONG_LIVED_TOKEN))

        store.signOut()

        assertFalse(store.hasStoredSession)
        assertNull(secrets.value(SecretKey.SESSION_PRESENT))
        assertNull(cookies.value())
    }

    /** Cookie живёт в памяти процесса — её значение переносится в зашифрованное хранилище. */
    @Test
    fun adoptCopiesRefreshCookieIntoSecrets() {
        val secrets = InMemorySecretStore()
        SessionStore(StubAuth(), secrets, MemoryCookies("rt-42")).adopt(AuthSession(LONG_LIVED_TOKEN))
        assertEquals("rt-42", secrets.value(SecretKey.REFRESH_TOKEN))
    }

    /** Процесс перезапустился, cookie пропала: перед обновлением значение возвращается на место. */
    @Test
    fun emptyCookieJarIsRefilledFromSecrets() = runTest {
        val secrets = InMemorySecretStore().apply {
            set(SecretKey.REFRESH_TOKEN, "rt-7")
            set(SecretKey.SESSION_PRESENT, "1")
        }
        val cookies = MemoryCookies()
        SessionStore(StubAuth(), secrets, cookies).refreshedAccessToken()
        assertEquals("rt-7", cookies.value())
    }

    @Test
    fun nothingIsRestoredWithoutStoredToken() = runTest {
        val cookies = MemoryCookies()
        SessionStore(StubAuth(), InMemorySecretStore(), cookies).refreshedAccessToken()
        assertNull(cookies.value())
    }

    private fun store(auth: StubAuth) = SessionStore(auth, InMemorySecretStore(), MemoryCookies())

    private class StubAuth(private val failure: ApiError? = null) : SessionRefreshing {
        val refreshCalls = AtomicInteger()

        override suspend fun refresh(): AuthSession {
            refreshCalls.incrementAndGet()
            // Пауза, чтобы вызовы действительно наложились, а не выстроились в ряд.
            delay(20)
            failure?.let { throw it }
            return AuthSession(LONG_LIVED_TOKEN)
        }

        override suspend fun endSession() {}
    }
}
