package kz.studenthub.app.core.chats

import kz.studenthub.app.core.storage.transaction
import kz.studenthub.app.core.storage.AppDatabase
import kz.studenthub.app.core.storage.AttachmentEntity
import kz.studenthub.app.core.storage.MessageEntity
import kz.studenthub.app.core.storage.SendState
import java.io.File
import java.time.Instant
import java.util.UUID

/**
 * Очередь отправки поверх базы.
 *
 * Отдельной таблицы у очереди нет: очередь — это сообщения без серверного id. Так она
 * переживает перезапуск, и сверять два хранилища не нужно. Сообщение попадает в базу
 * до запроса: человек видит текст мгновенно, а судьба отправки — состояние строки.
 */
class MessageOutbox(
    private val db: AppDatabase,
    private val api: ChatMessageSending,
    private val uploader: AttachmentUploader? = null,
    /** Не ушло — досылку берёт на себя фоновая работа, когда появится сеть. */
    private val onStuck: () -> Unit = {},
    private val now: () -> Instant = Instant::now,
) {
    /** Положить сообщение в ленту и попытаться отправить. */
    suspend fun send(text: String, chatId: String, senderId: String, replyToId: String?): Boolean {
        val local = MessageEntity(
            id = UUID.randomUUID().toString(),
            remoteId = null,
            chatId = chatId,
            seq = null,
            senderId = senderId,
            content = text,
            replyToId = replyToId,
            createdAt = now(),
            sendState = SendState.PENDING,
        )
        runCatching { db.messages().insert(local) }.onFailure { return false }
        return deliver(local)
    }

    /** Повторить неудачу — по кнопке у сообщения. */
    suspend fun retry(message: MessageEntity): Boolean {
        if (message.remoteId != null) return true
        mark(message.id, SendState.PENDING)
        return deliver(message.copy(sendState = SendState.PENDING))
    }

    /**
     * Дослать всё, что висит: после перезапуска, возвращения связи, открытия чата.
     * Порядок — по времени написания; на первой неудаче останавливаемся: дальше почти
     * наверняка та же сеть, а порядок важнее попытки протолкнуть следующее.
     */
    suspend fun flush(chatId: String? = null): Boolean {
        val stuck = runCatching { if (chatId == null) db.messages().unsent() else db.messages().unsent(chatId) }
            .getOrElse { return false }
        for (message in stuck) {
            if (!deliver(message)) return false
        }
        return true
    }

    private suspend fun deliver(message: MessageEntity): Boolean {
        // Вложение отправляет своя дорога: подпись, загрузка в хранилище, сообщение.
        if (db.messages().attachmentCount(message.id) > 0) {
            return (uploader?.resend(message) ?: false).also { if (!it) onStuck() }
        }
        return try {
            val sent = api.send(message.content, message.chatId, message.replyToId)
            confirm(db, message.id, sent)
            true
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            mark(message.id, SendState.FAILED)
            onStuck()
            false
        }
    }

    private suspend fun mark(id: String, state: SendState) {
        val message = db.messages().get(id) ?: return
        db.messages().update(message.copy(sendState = state))
    }

    companion object {
        /**
         * Подтвердить отправку. Ключ строки не меняем: на него ссылается лента. Серверный
         * id кладём рядом — по нему сообщение узнаётся, когда придёт из сокета.
         */
        suspend fun confirm(db: AppDatabase, localId: String, sent: ChatMessageDto): String? {
            // Сокет мог донести своё же сообщение раньше HTTP-ответа — тогда строка с
            // серверным id уже есть, и локальную копию надо убрать, а не дублировать:
            // второй `remoteId` упёрся бы в уникальный индекс.
            val echoed = db.messages().byRemoteId(sent.id)
            if (echoed != null && echoed.id != localId) {
                db.messages().delete(localId)
                return echoed.id
            }
            val local = db.messages().get(localId) ?: return null
            db.messages().update(local.copy(remoteId = sent.id, seq = sent.seq, createdAt = sent.createdAt, sendState = SendState.SENT))
            return localId
        }
    }
}

/** Файл, который человек собрался отправить: уже скопирован в кэш приложения. */
data class OutgoingAttachment(
    val file: File,
    val mime: String,
    val name: String?,
    val width: Int? = null,
    val height: Int? = null,
)

/**
 * Отправка вложения. Три шага сервера (подпись → загрузка в хранилище → сообщение по
 * ключам) видны здесь как один вызов. Сообщение появляется в ленте сразу: файл лежит на
 * устройстве и показывается до того, как уедет.
 */
class AttachmentUploader(
    private val db: AppDatabase,
    private val api: AttachmentSending,
    private val now: () -> Instant = Instant::now,
) {
    suspend fun send(attachment: OutgoingAttachment, chatId: String, senderId: String, caption: String?, replyToId: String?): Boolean {
        val message = MessageEntity(
            id = UUID.randomUUID().toString(),
            remoteId = null,
            chatId = chatId,
            seq = null,
            senderId = senderId,
            content = caption.orEmpty(),
            replyToId = replyToId,
            createdAt = now(),
            sendState = SendState.PENDING,
        )
        val local = AttachmentEntity(
            id = UUID.randomUUID().toString(),
            messageId = message.id,
            mime = attachment.mime,
            name = attachment.name,
            size = attachment.file.length(),
            width = attachment.width,
            height = attachment.height,
            localPath = attachment.file.absolutePath,
        )
        runCatching {
            db.transaction {
                db.messages().insert(message)
                db.messages().insertAttachments(listOf(local))
            }
        }.onFailure { return false }
        return upload(message, local)
    }

    /** Повтор после неудачи: файл ещё лежит в кэше, запись вложения — в базе. */
    suspend fun resend(message: MessageEntity): Boolean {
        val local = db.messages().attachments(message.id).firstOrNull() ?: return false
        db.messages().update(message.copy(sendState = SendState.PENDING))
        return upload(message, local)
    }

    private suspend fun upload(message: MessageEntity, local: AttachmentEntity): Boolean {
        val file = local.localPath?.let(::File)
        return try {
            if (file == null || !file.exists()) throw IllegalStateException("файл вложения пропал")
            val ticket = api.presign(message.chatId, local.mime)
            api.upload(file, ticket.url, local.mime)
            val sent = api.sendUploaded(
                message.chatId,
                message.content.ifEmpty { null },
                message.replyToId,
                listOf(AttachmentUpload(ticket.key, local.name)),
            )
            db.transaction {
                val kept = MessageOutbox.confirm(db, message.id, sent) ?: return@transaction
                // Серверная запись заменяет локальную, но файл на диске остаётся:
                // показывать его из кэша быстрее, чем качать своё же.
                sent.media?.firstOrNull()?.let { server ->
                    db.messages().deleteAttachment(local.id)
                    db.messages().insertAttachments(listOf(local.copy(id = server.id, messageId = kept)))
                }
            }
            true
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            db.messages().get(message.id)?.let { db.messages().update(it.copy(sendState = SendState.FAILED)) }
            false
        }
    }
}
