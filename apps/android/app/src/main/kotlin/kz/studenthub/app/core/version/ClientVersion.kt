package kz.studenthub.app.core.version

import android.content.Context
import androidx.core.content.edit
import kz.studenthub.app.core.network.ApiClient
import kz.studenthub.app.core.network.AppJson
import kz.studenthub.app.core.network.Endpoint
import kotlinx.serialization.Serializable

/**
 * Версия сборки в сравнимом виде. Сравниваем числами, а не строками: при строковом
 * сравнении «1.10.0» меньше «1.9.0», и блокировка сработала бы наоборот.
 */
data class AppVersion(val major: Int, val minor: Int, val patch: Int) : Comparable<AppVersion> {
    override fun compareTo(other: AppVersion): Int =
        compareValuesBy(this, other, AppVersion::major, AppVersion::minor, AppVersion::patch)

    companion object {
        /** Только полный `X.Y.Z` — тот же формат, что отдаёт сервер. Догадываться опаснее. */
        fun parse(raw: String): AppVersion? {
            val parts = raw.split('.')
            if (parts.size != 3) return null
            val numbers = parts.map { it.toIntOrNull()?.takeIf { n -> n >= 0 } ?: return null }
            return AppVersion(numbers[0], numbers[1], numbers[2])
        }
    }
}

/** Ответ `GET /client-version` (PROJECT.md §8.3). */
@Serializable
data class ClientVersionInfo(
    val platform: String,
    val minimumVersion: String,
    /** Адрес в Google Play. Не задан — кнопки «Обновить» не будет. */
    val storeUrl: String? = null,
)

interface ClientVersionChecking {
    suspend fun supportedVersion(): ClientVersionInfo
}

/**
 * Маршрут публичный: спросить про обновление нужно раньше входа — человек со старой
 * сборкой иначе упёрся бы в неработающую форму.
 */
class ClientVersionApi(private val client: ApiClient) : ClientVersionChecking {
    override suspend fun supportedVersion(): ClientVersionInfo =
        client.send(
            Endpoint.get("client-version", "platform" to "android").publicRoute(),
            ClientVersionInfo.serializer(),
        )
}

/**
 * Последний ответ сервера. Нужен для запуска без сети: решение «сборка больше не
 * поддерживается» не должно пропадать, стоит выйти из зоны приёма.
 */
interface ClientVersionCache {
    fun load(): ClientVersionInfo?

    fun save(info: ClientVersionInfo)
}

/** Обычные настройки, а не шифрованные: это не секрет, а публичный ответ сервера. */
class PrefsClientVersionCache(context: Context) : ClientVersionCache {
    private val prefs = context.getSharedPreferences("client-version", Context.MODE_PRIVATE)

    override fun load(): ClientVersionInfo? = prefs.getString(KEY, null)?.let {
        runCatching { AppJson.decodeFromString(ClientVersionInfo.serializer(), it) }.getOrNull()
    }

    override fun save(info: ClientVersionInfo) {
        prefs.edit { putString(KEY, AppJson.encodeToString(ClientVersionInfo.serializer(), info)) }
    }

    private companion object {
        const val KEY = "last-answer"
    }
}
