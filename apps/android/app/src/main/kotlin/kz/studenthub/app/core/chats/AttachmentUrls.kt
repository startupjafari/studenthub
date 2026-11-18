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
    private val cache = mutableMapOf<String, Pair<ChatsApi.AttachmentLink, Instant>>()

    suspend fun url(fileId: String): String? = link(fileId)?.url

    /** Ссылка целиком — с тем, каким файл стал на сервере (`mime`, `animation`). */
    suspend fun link(fileId: String): ChatsApi.AttachmentLink? {
        lock.withLock { cache[fileId] }?.let { (link, until) ->
            if (until.isAfter(Instant.now().plusSeconds(30))) return link
        }
        val answer = runCatching { fetch(fileId) }.getOrNull() ?: return null
        val until = answer.expiresAt ?: Instant.now().plusSeconds(600)
        lock.withLock { cache[fileId] = answer to until }
        return answer
    }

    /** Подписанные ссылки прошлой сессии — тоже доступ к её файлам: при выходе их забываем. */
    suspend fun clear() = lock.withLock { cache.clear() }
}
