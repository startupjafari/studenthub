package kz.studenthub.app.core.chats

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant

/**
 * Ссылки на вложения. Presigned-ссылка живёт минуты, поэтому кэшируем её по id файла и
 * обновляем, когда истекла. Ключ — именно id: по адресу кэш превратился бы в мусор
 * через четверть часа (решение плана «Кэш картинок»).
 */
class AttachmentUrls(private val fetch: suspend (String) -> ChatsApi.AttachmentLink) {
    private val lock = Mutex()
    private val cache = mutableMapOf<String, Pair<String, Instant>>()

    suspend fun url(fileId: String): String? {
        lock.withLock { cache[fileId] }?.let { (url, until) ->
            if (until.isAfter(Instant.now().plusSeconds(30))) return url
        }
        val answer = runCatching { fetch(fileId) }.getOrNull() ?: return null
        val until = answer.expiresAt ?: Instant.now().plusSeconds(600)
        lock.withLock { cache[fileId] = answer.url to until }
        return answer.url
    }

    /** Подписанные ссылки прошлой сессии — тоже доступ к её файлам: при выходе их забываем. */
    suspend fun clear() = lock.withLock { cache.clear() }
}
