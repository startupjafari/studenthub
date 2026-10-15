package kz.studenthub.app.core.storage

import androidx.room.ColumnInfo
import androidx.room.Embedded
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import androidx.room.Relation
import java.time.Instant

/*
 * Строки локальной базы. Поля повторяют ответ API (`GET /chats`,
 * `GET /chats/:id/messages`), а не придумывают свою модель: экран читает базу, сеть
 * пишет в базу, и чем меньше между ними преобразований, тем меньше мест, где они
 * разойдутся. Схема та же, что у GRDB в iOS (`Core/Storage/Records.swift`).
 */

/** Чат в списке. */
@Entity(tableName = "chat", indices = [Index("updatedAt")])
data class ChatEntity(
    @PrimaryKey val id: String,
    /** Строкой, а не `ChatKind`: в базе может лежать тип, которого в сборке ещё нет. */
    val type: String,
    val title: String?,
    val avatarUrl: String?,
    val chatDescription: String?,
    val subject: String?,
    val memberCount: Int = 0,
    val unreadCount: Int = 0,
    val muted: Boolean = false,
    val mutedImportantOnly: Boolean = false,
    val pinnedAt: Instant? = null,
    val archivedAt: Instant? = null,
    /** Запрос на переписку (§50): решение за мной либо я жду ответа. */
    val requestIncoming: Boolean = false,
    val requestOutgoing: Boolean = false,
    /** До какого времени собеседники прочитали переписку. */
    val othersReadAt: Instant? = null,
    /**
     * Превью списка. Без внешнего ключа намеренно: превью приходит со списком, а
     * сообщение попадает в базу, только когда человек откроет чат.
     */
    val lastMessageId: String? = null,
    /** Номер последнего известного сообщения — с него идёт догон (PROJECT.md §9.2c). */
    val lastSeq: Int = 0,
    /** Порядок списка задаёт сервер — по нему же приходят страницы. */
    val updatedAt: Instant,
) {
    val kind: ChatKind get() = ChatKind.from(type)
}

/**
 * Состояние отправки. Сообщение живёт в базе с момента нажатия «отправить» — иначе
 * лента ждала бы сеть, а в этом вся задумка.
 */
enum class SendState { SENT, PENDING, FAILED }

@Entity(
    tableName = "message",
    foreignKeys = [ForeignKey(entity = ChatEntity::class, parentColumns = ["id"], childColumns = ["chatId"], onDelete = ForeignKey.CASCADE)],
    indices = [
        Index("remoteId", unique = true),
        Index("chatId", "createdAt"),
        Index("chatId", "seq"),
        Index("sendState"),
    ],
)
data class MessageEntity(
    /**
     * Ключ строки: серверный id у пришедших сообщений, локальный UUID у своих, пока
     * сервер не ответил. Ключ не переписываем — дешевле проставить `remoteId`.
     */
    @PrimaryKey val id: String,
    /** Серверный id. `null`, пока сообщение не подтверждено. */
    val remoteId: String?,
    val chatId: String,
    /** Номер в чате. `null` у неотправленного: нумерацию выдаёт только сервер. */
    val seq: Int?,
    val senderId: String,
    val content: String,
    val replyToId: String? = null,
    val replyQuote: String? = null,
    /** Системное сообщение («N вошёл в группу») — у него нет автора-человека. */
    val systemType: String? = null,
    val editedAt: Instant? = null,
    /** Мягкое удаление, как на сервере: строка остаётся, текст в ленте заменяется. */
    val deletedAt: Instant? = null,
    val pinnedAt: Instant? = null,
    val createdAt: Instant,
    val sendState: SendState = SendState.SENT,
)

/**
 * Черновик. Местная копия первична: человек печатает и переключает чаты быстрее, чем
 * уходит запрос. `isSynced` — донесли ли его до сервера.
 */
@Entity(
    tableName = "draft",
    foreignKeys = [ForeignKey(entity = ChatEntity::class, parentColumns = ["id"], childColumns = ["chatId"], onDelete = ForeignKey.CASCADE)],
)
data class DraftEntity(
    @PrimaryKey val chatId: String,
    val text: String,
    val replyToId: String?,
    val updatedAt: Instant,
    val isSynced: Boolean,
)

/** Папка чатов: вкладка над списком. */
@Entity(tableName = "folder")
data class FolderEntity(@PrimaryKey val id: String, val name: String, val position: Int)

/**
 * Состав папки. Без внешнего ключа на чат: папка приходит целиком, а чаты страницами,
 * и состав может ссылаться на чат, который в базу ещё не доехал.
 */
@Entity(
    tableName = "folderChat",
    primaryKeys = ["folderId", "chatId"],
    foreignKeys = [ForeignKey(entity = FolderEntity::class, parentColumns = ["id"], childColumns = ["folderId"], onDelete = ForeignKey.CASCADE)],
    indices = [Index("chatId")],
)
data class FolderChatEntity(val folderId: String, val chatId: String)

/**
 * Вложение сообщения. Отдельной таблицей, а не JSON-полем: по вложениям идут выборки,
 * а разбирать JSON в каждой строке — это перебор всей переписки.
 */
@Entity(
    tableName = "attachment",
    foreignKeys = [ForeignKey(entity = MessageEntity::class, parentColumns = ["id"], childColumns = ["messageId"], onDelete = ForeignKey.CASCADE)],
    indices = [Index("messageId")],
)
data class AttachmentEntity(
    /** Серверный id файла либо локальный, пока вложение не ушло. */
    @PrimaryKey val id: String,
    val messageId: String,
    val mime: String,
    val name: String?,
    val size: Long?,
    val width: Int?,
    val height: Int?,
    /** Файл на устройстве: у своих до отправки и у скачанных. Ключ кэша — id, не ссылка. */
    val localPath: String?,
) {
    val isImage: Boolean get() = mime.startsWith("image/")

    /** Голосовое узнаётся по имени, как и в вебе: отдельного признака в модели нет. */
    val isVoice: Boolean get() = mime.startsWith("audio/") && name?.startsWith("voice-") == true
}

/** Сообщение вместе с вложениями — одним чтением, без кадра «картинка без сообщения». */
data class MessageWithAttachments(
    @Embedded val message: MessageEntity,
    @Relation(parentColumn = "id", entityColumn = "messageId") val attachments: List<AttachmentEntity>,
)

/** Строка списка чатов — ровно то, что рисует экран. */
data class ChatListRow(
    val id: String,
    val type: String,
    val title: String?,
    val avatarUrl: String?,
    val unreadCount: Int,
    val muted: Boolean,
    val pinnedAt: Instant?,
    val archivedAt: Instant?,
    val requestIncoming: Boolean,
    val updatedAt: Instant,
    /** Черновик показывается вместо превью: он важнее чужого последнего сообщения. */
    val draftText: String?,
    val lastContent: String?,
    val lastSenderId: String?,
    val lastCreatedAt: Instant?,
    val lastDeletedAt: Instant?,
    @ColumnInfo(name = "lastHasMedia") val lastHasMedia: Boolean = false,
) {
    val kind: ChatKind get() = ChatKind.from(type)
    val isPinned: Boolean get() = pinnedAt != null

    /** Что показать второй строкой. */
    val preview: String?
        get() = when {
            !draftText.isNullOrEmpty() -> draftText
            lastDeletedAt != null -> null
            else -> lastContent
        }
}

/**
 * Пара расписания. Расписание обязано работать в самолёте и в подвале: его смотрят чаще
 * всего и ровно там, где связи нет. Поэтому оно лежит в базе целиком.
 */
@Entity(tableName = "pair", indices = [Index("dayOfWeek", "startTime")])
data class PairEntity(
    @PrimaryKey val id: String,
    val subject: String,
    /** 1 — понедельник, 7 — воскресенье. */
    val dayOfWeek: Int,
    /** «HH:mm»: сравнимо строкой и не зависит от часового пояса телефона. */
    val startTime: String,
    val endTime: String,
    val weekType: String,
    val teacherName: String?,
    val roomName: String?,
    val groupId: String?,
)

/**
 * Разовое изменение пары. Без внешнего ключа на пару: изменение может прийти раньше
 * самой пары, а потерять его из-за порядка загрузки нельзя.
 */
@Entity(tableName = "pairChange", indices = [Index("date"), Index("pairId")])
data class PairChangeEntity(
    @PrimaryKey val id: String,
    val pairId: String,
    val type: String,
    /** День, на который изменение действует. */
    val date: Instant,
    val newStartTime: String?,
    val newEndTime: String?,
    val note: String?,
)

