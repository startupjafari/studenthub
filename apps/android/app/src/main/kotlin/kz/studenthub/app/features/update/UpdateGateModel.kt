package kz.studenthub.app.features.update

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kz.studenthub.app.core.version.AppVersion
import kz.studenthub.app.core.version.ClientVersionCache
import kz.studenthub.app.core.version.ClientVersionChecking
import kz.studenthub.app.core.version.ClientVersionInfo

/**
 * Решение «пускать ли эту сборку».
 *
 * Нативное приложение обновляет не сервер, а человек, и часть людей не обновляет его
 * никогда. Сборка старше контракта API ведёт себя хуже, чем отсутствие приложения.
 */
class UpdateGateModel(
    private val api: ClientVersionChecking,
    private val cache: ClientVersionCache,
    currentVersion: String,
) {
    sealed interface State {
        /** Ещё не знаем — и не мешаем: пустой экран на старте хуже старой сборки. */
        data object Checking : State

        data object Allowed : State

        data class Blocked(val storeUrl: String?) : State
    }

    var state: State by mutableStateOf(State.Checking)
        private set

    private val current = AppVersion.parse(currentVersion)

    suspend fun check() {
        // Сначала — по последнему известному ответу: запуск без сети не должен отменять
        // уже принятое решение, иначе выключенный Wi-Fi обходит блокировку.
        cache.load()?.let(::apply)
        try {
            val info = api.supportedVersion()
            cache.save(info)
            apply(info)
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            // Сервер недоступен — никого не запираем сверх того, что уже решено по кэшу:
            // иначе авария на бэкенде закрывает приложение всем сразу.
            if (state == State.Checking) state = State.Allowed
        }
    }

    private fun apply(info: ClientVersionInfo) {
        val minimum = AppVersion.parse(info.minimumVersion)
        // Не разобрали свою или серверную версию — пропускаем: блокировать по
        // неразобранной строке значит ломать приложение опечаткой в env.
        state = if (current == null || minimum == null || current >= minimum) {
            State.Allowed
        } else {
            State.Blocked(info.storeUrl)
        }
    }
}
