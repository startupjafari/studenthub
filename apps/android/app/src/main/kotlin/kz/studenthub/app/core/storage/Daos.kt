package kz.studenthub.app.core.storage

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface ChatDao {
    @Query("SELECT * FROM chat WHERE id = :id")
    suspend fun get(id: String): ChatEntity?

    @Query("SELECT * FROM chat WHERE id = :id")
    fun observe(id: String): Flow<ChatEntity?>

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertOrIgnore(chat: ChatEntity): Long

    @Update
    suspend fun update(chat: ChatEntity)

    /**
     * Вставить или обновить. Не `REPLACE`: тот удаляет строку и вставляет заново, а
     * удаление чата каскадом уносит его переписку и черновик.
     */
    @Transaction
    suspend fun upsert(chat: ChatEntity) {
        if (insertOrIgnore(chat) == -1L) update(chat)
    }

    @Query("DELETE FROM chat WHERE id = :id")
    suspend fun delete(id: String)

    @Query("SELECT id FROM chat")
    suspend fun ids(): List<String>

    /*
     * Строки списка. Порядок повторяет сервер и веб: закреплённые сверху по времени
     * закрепления, дальше по свежести. `pinnedAt IS NULL` первой ступенью — это и есть
     * «сначала закреплённые», без склейки на клиенте.
     */

    @Query("$ROWS WHERE c.archivedAt IS NULL AND c.requestIncoming = 0 $ORDER")
    fun observeAll(): Flow<List<ChatListRow>>

    @Query(
        "$ROWS WHERE c.archivedAt IS NULL AND c.requestIncoming = 0 " +
            "AND c.id IN (SELECT chatId FROM folderChat WHERE folderId = :folderId) $ORDER",
    )
    fun observeFolder(folderId: String): Flow<List<ChatListRow>>

    @Query("$ROWS WHERE c.requestIncoming = 1 $ORDER")
    fun observeRequests(): Flow<List<ChatListRow>>

    @Query("$ROWS WHERE c.archivedAt IS NOT NULL AND c.requestIncoming = 0 $ORDER")
    fun observeArchive(): Flow<List<ChatListRow>>

    @Query("SELECT COUNT(*) FROM chat WHERE requestIncoming = 1")
    fun observeRequestCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM chat WHERE archivedAt IS NOT NULL")
    fun observeArchivedCount(): Flow<Int>

    /** Бейдж на иконке: по своей базе, а не по счётчику из пуша — пуши теряются. */
    @Query("SELECT COALESCE(SUM(unreadCount), 0) FROM chat WHERE archivedAt IS NULL")
    suspend fun totalUnread(): Int

    @Query("SELECT COALESCE(SUM(unreadCount), 0) FROM chat WHERE archivedAt IS NULL")
    fun observeTotalUnread(): Flow<Int>

    @Query("SELECT * FROM chat ORDER BY updatedAt DESC LIMIT :limit")
    suspend fun recent(limit: Int): List<ChatEntity>

    private companion object {
        const val ROWS = """
            SELECT
                c.id, c.type, c.title, c.avatarUrl, c.unreadCount, c.muted,
                c.pinnedAt, c.archivedAt, c.requestIncoming, c.updatedAt,
                d.text AS draftText,
                m.content AS lastContent,
                m.senderId AS lastSenderId,
                m.createdAt AS lastCreatedAt,
                m.deletedAt AS lastDeletedAt,
                EXISTS (SELECT 1 FROM attachment a WHERE a.messageId = m.id) AS lastHasMedia
            FROM chat c
            LEFT JOIN draft d ON d.chatId = c.id
            LEFT JOIN message m ON m.id = c.lastMessageId
        """
        const val ORDER = "ORDER BY (c.pinnedAt IS NULL), c.pinnedAt DESC, c.updatedAt DESC"
    }
}

@Dao
interface MessageDao {
    @Query("SELECT * FROM message WHERE id = :id")
    suspend fun get(id: String): MessageEntity?

    @Query("SELECT * FROM message WHERE remoteId = :remoteId")
    suspend fun byRemoteId(remoteId: String): MessageEntity?

    @Insert
    suspend fun insert(message: MessageEntity)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertOrIgnore(message: MessageEntity): Long

    /** Вставить или обновить — без `REPLACE`, чтобы не терять вложения каскадом. */
    @Transaction
    suspend fun upsert(message: MessageEntity) {
        if (insertOrIgnore(message) == -1L) update(message)
    }

    @Update
    suspend fun update(message: MessageEntity)

    @Query("DELETE FROM message WHERE id = :id")
    suspend fun delete(id: String)

    /**
     * Лента чата. По времени, а не по номеру: номер есть только у подтверждённых, а
     * неотправленное стоит там, где человек его написал, — последним.
     */
    @Transaction
    @Query("SELECT * FROM message WHERE chatId = :chatId ORDER BY createdAt ASC, seq ASC")
    fun observeThread(chatId: String): Flow<List<MessageWithAttachments>>

    @Query("SELECT * FROM message WHERE chatId = :chatId ORDER BY createdAt ASC, seq ASC")
    suspend fun thread(chatId: String): List<MessageEntity>

    /** Очередь отправки — сообщения без серверного id, по времени написания. */
    @Query("SELECT * FROM message WHERE remoteId IS NULL ORDER BY createdAt ASC")
    suspend fun unsent(): List<MessageEntity>

    @Query("SELECT * FROM message WHERE remoteId IS NULL AND chatId = :chatId ORDER BY createdAt ASC")
    suspend fun unsent(chatId: String): List<MessageEntity>

    @Query("SELECT COUNT(*) FROM attachment WHERE messageId = :messageId")
    suspend fun attachmentCount(messageId: String): Int

    /** Сброс подтверждённой истории: ответ на `overflow`. Неотправленное остаётся. */
    @Query("DELETE FROM message WHERE chatId = :chatId AND sendState = 'SENT'")
    suspend fun clearSent(chatId: String)

    @Query("SELECT * FROM attachment WHERE messageId = :messageId")
    suspend fun attachments(messageId: String): List<AttachmentEntity>

    @Query("DELETE FROM attachment WHERE messageId = :messageId")
    suspend fun deleteAttachments(messageId: String)

    @Query("DELETE FROM attachment WHERE id = :id")
    suspend fun deleteAttachment(id: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAttachments(attachments: List<AttachmentEntity>)
}

@Dao
interface DraftDao {
    @Query("SELECT * FROM draft WHERE chatId = :chatId")
    suspend fun get(chatId: String): DraftEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(draft: DraftEntity)

    @Query("DELETE FROM draft WHERE chatId = :chatId")
    suspend fun delete(chatId: String)

    @Query("SELECT * FROM draft WHERE isSynced = 0")
    suspend fun unsynced(): List<DraftEntity>
}

@Dao
interface FolderDao {
    @Query("SELECT * FROM folder ORDER BY position")
    fun observe(): Flow<List<FolderEntity>>

    @Query("SELECT * FROM folder")
    suspend fun all(): List<FolderEntity>

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertOrIgnore(folder: FolderEntity): Long

    @Update
    suspend fun update(folder: FolderEntity)

    /** Без `REPLACE`: удаление папки каскадом стёрло бы её состав. */
    @Transaction
    suspend fun upsert(folder: FolderEntity) {
        if (insertOrIgnore(folder) == -1L) update(folder)
    }

    @Query("DELETE FROM folder WHERE id = :id")
    suspend fun delete(id: String)

    @Query("DELETE FROM folderChat WHERE folderId = :folderId")
    suspend fun clearMembers(folderId: String)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertMembers(members: List<FolderChatEntity>)
}

@Dao
interface ScheduleDao {
    @Query("DELETE FROM pair")
    suspend fun clearPairs()

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertPairs(pairs: List<PairEntity>)

    /** Пары одного дня в порядке занятий. */
    @Query("SELECT * FROM pair WHERE dayOfWeek = :dayOfWeek ORDER BY startTime")
    fun observeDay(dayOfWeek: Int): Flow<List<PairEntity>>

    @Query("SELECT * FROM pair WHERE id = :id")
    suspend fun pair(id: String): PairEntity?

    @Query("SELECT * FROM pair ORDER BY dayOfWeek, startTime")
    suspend fun allPairs(): List<PairEntity>

    @Query("DELETE FROM pairChange WHERE date < :before")
    suspend fun deleteChangesBefore(before: java.time.Instant)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertChanges(changes: List<PairChangeEntity>)

    @Query("SELECT * FROM pairChange WHERE date >= :from AND date < :to")
    fun observeChanges(from: java.time.Instant, to: java.time.Instant): Flow<List<PairChangeEntity>>
}

