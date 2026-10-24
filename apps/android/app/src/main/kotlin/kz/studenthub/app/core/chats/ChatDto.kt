package kz.studenthub.app.core.chats

import kotlinx.serialization.Serializable
import kz.studenthub.app.core.network.InstantSerializer
import java.time.Instant

/*
 * Ответы API чатов (PROJECT.md §8.3). Только поля, которые приложение использует:
 * лишние обязательные поля превращают любое изменение на сервере в падение разбора.
 */

@Serializable
data class ChatListItemDto(
    val id: String,
    val type: String,
    val title: String? = null,
    val avatarUrl: String? = null,
    val description: String? = null,
    val subject: String? = null,
    val memberCount: Int? = null,
    val unreadCount: Int? = null,
    val muted: Boolean? = null,
    val mutedImportantOnly: Boolean? = null,
    val draft: String? = null,
    @Serializable(InstantSerializer::class) val pinnedAt: Instant? = null,
    val archived: Boolean? = null,
    @Serializable(InstantSerializer::class) val othersReadAt: Instant? = null,
    val requestIncoming: Boolean? = null,
    val requestOutgoing: Boolean? = null,
    val lastMessage: ChatMessageDto? = null,
    @Serializable(InstantSerializer::class) val updatedAt: Instant,
)

/**
 * Вложение. Вид (картинка, файл, голосовое) выводится при рендере из mime, имени и
 * флага `asDocument` — отдельного типа сообщения в модели нет (PROJECT.md §9.1a).
 */
@Serializable
data class ChatAttachmentDto(
    val id: String,
    val mime: String,
    val size: Long? = null,
    val name: String? = null,
    val spoiler: Boolean? = null,
    val asDocument: Boolean? = null,
    val width: Int? = null,
    val height: Int? = null,
)

@Serializable
data class ChatMessageDto(
    val id: String,
    val chatId: String,
    val seq: Int? = null,
    val senderId: String,
    val content: String = "",
    val replyToId: String? = null,
    val replyQuote: String? = null,
    val systemType: String? = null,
    @Serializable(InstantSerializer::class) val editedAt: Instant? = null,
    @Serializable(InstantSerializer::class) val deletedAt: Instant? = null,
    @Serializable(InstantSerializer::class) val pinnedAt: Instant? = null,
    @Serializable(InstantSerializer::class) val createdAt: Instant,
    val media: List<ChatAttachmentDto>? = null,
    /** Автор: в группах и официальных чатах его имя стоит над первым сообщением серии. */
    val sender: Sender? = null,
    /** Детали системного сообщения: текст строит клиент по `systemType` (§20). */
    val systemMeta: SystemMeta? = null,
) {
    @Serializable
    data class Sender(val id: String, val firstName: String? = null, val lastName: String? = null) {
        /** «Фамилия Имя» — так автора подписывает веб. */
        val name: String?
            get() = listOfNotNull(lastName, firstName).map(String::trim).filter(String::isNotEmpty).joinToString(" ").ifEmpty { null }
    }

    @Serializable
    data class SystemMeta(val targetName: String? = null, val title: String? = null)
}

@Serializable
data class ChatFolderDto(val id: String, val name: String, val position: Int, val chatIds: List<String> = emptyList())

/** Разница по чату с позиции клиента (PROJECT.md §9.2c). `overflow` — разрыв больше лимита. */
@Serializable
data class ChatUpdatesDto(
    val created: List<ChatMessageDto> = emptyList(),
    val mutated: List<ChatMessageDto> = emptyList(),
    val deletedIds: List<String> = emptyList(),
    val latestSeq: Int = 0,
    val overflow: Boolean = false,
)

/** Подпись на прямую загрузку (`POST /chats/:id/attachments/presign`). */
@Serializable
data class AttachmentUploadTicket(
    val key: String,
    val url: String,
    @Serializable(InstantSerializer::class) val expiresAt: Instant? = null,
)

/** Готовое к отправке вложение: уже лежит в хранилище под своим ключом. */
@Serializable
data class AttachmentUpload(val key: String, val name: String?)
