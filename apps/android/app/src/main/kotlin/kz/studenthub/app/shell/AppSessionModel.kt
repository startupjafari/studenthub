package kz.studenthub.app.shell

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kz.studenthub.app.core.session.AccessToken
import kz.studenthub.app.core.session.AuthSession
import kz.studenthub.app.core.session.SessionStore

/**
 * Состояние сессии для интерфейса: вошёл ли человек и с какой ролью.
 *
 * `Restoring` — не косметика. Без третьего состояния холодный старт на долю секунды
 * показывает экран входа уже вошедшему человеку: признак сессии лежит в хранилище, а
 * токен приходит из сети.
 */
class AppSessionModel(
    private val store: SessionStore,
    /** Что сделать перед выходом: порвать сокет, отвязать устройство от пушей. */
    private val beforeSignOut: suspend () -> Unit = {},
    private val afterSignOut: () -> Unit = {},
) {
    constructor(services: AppServices) : this(
        store = services.session,
        beforeSignOut = { services.beforeSignOut() },
        afterSignOut = { services.router.reset() },
    )

    sealed interface State {
        data object Restoring : State

        data object SignedOut : State

        data class SignedIn(val token: AccessToken) : State
    }

    var state: State by mutableStateOf(State.Restoring)
        private set

    val token: AccessToken? get() = (state as? State.SignedIn)?.token

    suspend fun restore() {
        state = store.restoredToken()?.let(State::SignedIn) ?: State.SignedOut
    }

    /** Принять выданную сессию. `false` — токен не разобрался, доверять такой сессии нельзя. */
    fun adopt(session: AuthSession): Boolean {
        val token = store.adopt(session) ?: return false
        state = State.SignedIn(token)
        return true
    }

    suspend fun signOut() {
        beforeSignOut()
        store.signOut()
        afterSignOut()
        state = State.SignedOut
    }
}
