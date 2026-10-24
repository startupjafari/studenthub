package kz.studenthub.app.core.session

import kz.studenthub.app.core.network.ApiError
import kz.studenthub.app.core.network.AuthorizationProvider
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kz.studenthub.app.core.session.SecretStore.SecretKey

/**
 * Сессия пользователя: кто вошёл и каким токеном подписываются запросы.
 *
 * Главное требование плана: обновление токена одно в полёте. Холодный старт поднимает
 * несколько экранов разом, и без этого они пошлют три параллельных `refresh`; сервер
 * считает повторное использование refresh-токена кражей и гасит сессию целиком.
 * Поэтому все, кто пришёл за обновлением, ждут один и тот же `Deferred`.
 */
class SessionStore(
    private val auth: SessionRefreshing,
    private val secrets: SecretStore,
    private val cookies: RefreshCookieStore,
) : AuthorizationProvider {
    private val lock = Mutex()

    @Volatile
    private var token: AccessToken? = null
    private var inFlightRefresh: CompletableDeferred<AccessToken?>? = null

    /** Был ли вход на этом устройстве: по нему холодный старт решает, пробовать ли продлить сессию. */
    val hasStoredSession: Boolean get() = secrets.value(SecretKey.SESSION_PRESENT) != null

    /** Разобранный токен — для тех, кому нужна роль и scope, а не строка. */
    val currentToken: AccessToken? get() = token

    private val _expired = MutableSharedFlow<Unit>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    /**
     * Сервер отказал в продлении: сессию отозвали (выход на другом устройстве, смена
     * пароля, блокировка) или она истекла. Хранилище уже пусто — интерфейсу пора на
     * экран входа с той же уборкой, что при ручном выходе (§7.2).
     */
    val expired: SharedFlow<Unit> = _expired

    /** Холодный старт: поднять сессию и вернуть разобранный токен. `null` — показывать вход. */
    suspend fun restoredToken(): AccessToken? {
        accessToken()
        return token
    }

    override suspend fun accessToken(): String? {
        token?.takeIf { it.isUsable() }?.let { return it.raw }
        if (token == null && !hasStoredSession) return null
        return refreshedAccessToken()
    }

    override suspend fun refreshedAccessToken(): String? {
        var owner = false
        val pending = lock.withLock {
            inFlightRefresh ?: CompletableDeferred<AccessToken?>().also {
                inFlightRefresh = it
                owner = true
            }
        }
        if (owner) {
            // Ждущие не должны зависнуть, чем бы ни кончилось обновление — даже отменой.
            try {
                pending.complete(performRefresh())
            } catch (error: Throwable) {
                pending.complete(null)
                throw error
            } finally {
                withContext(NonCancellable) { lock.withLock { inFlightRefresh = null } }
            }
        }
        return pending.await()?.raw
    }

    /**
     * Принять сессию, выданную входом или обновлением. Сервер только что положил свежую
     * refresh-cookie — переносим её в зашифрованное хранилище, пока она на месте.
     */
    fun adopt(session: AuthSession): AccessToken? {
        val parsed = AccessToken.parse(session.accessToken) ?: return null
        token = parsed
        cookies.value()?.let { secrets.set(SecretKey.REFRESH_TOKEN, it) }
        secrets.set(SecretKey.SESSION_PRESENT, "1")
        return parsed
    }

    /**
     * Выход. Сначала гасим сессию на сервере, затем чистим своё — после очистки
     * отправить запрос уже нечем, и сессия осталась бы живой.
     */
    suspend fun signOut() {
        restoreRefreshCookieIfNeeded()
        runCatching { auth.endSession() }
        forgetSession()
    }

    private suspend fun performRefresh(): AccessToken? {
        restoreRefreshCookieIfNeeded()
        return try {
            adopt(auth.refresh())
        } catch (error: ApiError) {
            // Сессия невосстановима — забываем её, иначе каждый следующий запрос будет
            // заново ломиться в обновление. Нет сети — не повод выходить из аккаунта.
            if (error.code?.meansSessionExpired == true) {
                val hadSession = token != null || hasStoredSession
                forgetSession()
                if (hadSession) _expired.tryEmit(Unit)
            }
            null
        }
    }

    /**
     * Cookie в памяти пропала вместе с процессом, а в хранилище токен есть — возвращаем
     * его на место. Без этого каждый перезапуск выглядел бы как выход из аккаунта.
     */
    private fun restoreRefreshCookieIfNeeded() {
        if (cookies.value() != null) return
        secrets.value(SecretKey.REFRESH_TOKEN)?.let(cookies::restore)
    }

    private fun forgetSession() {
        token = null
        cookies.clear()
        secrets.remove(SecretKey.REFRESH_TOKEN)
        secrets.remove(SecretKey.SESSION_PRESENT)
    }
}
