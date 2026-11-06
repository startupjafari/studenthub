package kz.studenthub.app.core.chats

import kz.studenthub.app.core.storage.AppDatabase
import kz.studenthub.app.core.storage.DraftEntity
import java.time.Instant

/** Маршрут черновика: `PUT /chats/:id/draft`, пустой текст очищает. */
interface DraftSaving {
    suspend fun saveDraft(chatId: String, text: String)
}

/**
 * Черновики: местная копия первична, сервер — для других устройств человека.
 *
 * Очистка тоже черновик: пустая строка с `isSynced = false` живёт, пока сервер не
 * подтвердит её. Удали её сразу — и следующий ответ списка вернул бы серверный текст,
 * то есть отправленное сообщение воскресло бы черновиком.
 */
class DraftSync(private val db: AppDatabase, private val api: DraftSaving, private val now: () -> Instant = Instant::now) {
    /** Записать черновик у себя и донести до сервера. Не дошло — донесёт `flush`. */
    suspend fun save(chatId: String, text: String) {
        runCatching { db.drafts().upsert(DraftEntity(chatId, text, null, now(), isSynced = false)) }.onFailure { return }
        push(chatId, text)
    }

    /** Донести всё, что не дошло: после открытия чата и после входа. */
    suspend fun flush() {
        val pending = runCatching { db.drafts().unsynced() }.getOrElse { return }
        for (draft in pending) {
            if (!push(draft.chatId, draft.text)) return
        }
    }

    private suspend fun push(chatId: String, text: String): Boolean {
        try {
            api.saveDraft(chatId, text.take(MAX_LENGTH))
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            return false
        }
        // Пока шёл запрос, человек мог напечатать ещё: подтверждаем только то, что ушло.
        val current = db.drafts().get(chatId) ?: return true
        if (current.text != text) return true
        if (text.isEmpty()) db.drafts().delete(chatId) else db.drafts().upsert(current.copy(isSynced = true))
        return true
    }

    private companion object {
        /** Предел черновика на сервере (`SaveDraftSchema`). */
        const val MAX_LENGTH = 4000
    }
}
