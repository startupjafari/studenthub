package kz.studenthub.app.support

import android.content.ContextWrapper
import androidx.room.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import kotlinx.coroutines.Dispatchers
import kz.studenthub.app.core.chats.ChatListItemDto
import kz.studenthub.app.core.chats.ChatMessageDto
import kz.studenthub.app.core.storage.AppDatabase
import java.time.Instant

/**
 * База в памяти на настоящем SQLite (встроенный драйвер) — запросы и ограничения
 * проверяются на JVM, без эмулятора. Контекст Room здесь не нужен: файла нет.
 */
fun testDatabase(): AppDatabase =
    Room.inMemoryDatabaseBuilder(ContextWrapper(null), AppDatabase::class.java)
        .setDriver(BundledSQLiteDriver())
        .setQueryCoroutineContext(Dispatchers.IO)
        .build()

val T0: Instant = Instant.parse("2026-10-06T10:00:00Z")

fun chatDto(
    id: String,
    updatedAt: Instant = T0,
    title: String = "Чат $id",
    type: String = "GROUP",
    unread: Int? = null,
    pinnedAt: Instant? = null,
    archived: Boolean? = null,
    requestIncoming: Boolean? = null,
    draft: String? = null,
    last: ChatMessageDto? = null,
) = ChatListItemDto(
    id = id,
    type = type,
    title = title,
    unreadCount = unread,
    pinnedAt = pinnedAt,
    archived = archived,
    requestIncoming = requestIncoming,
    draft = draft,
    lastMessage = last,
    updatedAt = updatedAt,
)

fun messageDto(
    id: String,
    chatId: String,
    seq: Int?,
    sender: String = "other",
    content: String = "текст $id",
    createdAt: Instant = T0,
    deletedAt: Instant? = null,
    media: List<kz.studenthub.app.core.chats.ChatAttachmentDto>? = null,
) = ChatMessageDto(id = id, chatId = chatId, seq = seq, senderId = sender, content = content, createdAt = createdAt, deletedAt = deletedAt, media = media)
