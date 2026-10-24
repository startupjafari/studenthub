package kz.studenthub.app.core.chats

import kz.studenthub.app.core.storage.transaction
import kz.studenthub.app.core.storage.AppDatabase
import kz.studenthub.app.core.storage.AttachmentEntity
import kz.studenthub.app.core.storage.ChatEntity
import kz.studenthub.app.core.storage.DraftEntity
import kz.studenthub.app.core.storage.FolderChatEntity
import kz.studenthub.app.core.storage.FolderEntity
import kz.studenthub.app.core.storage.MessageEntity
import kz.studenthub.app.core.storage.SendState
import java.time.Instant

/**
 * Запись ответов API в базу — единственное место, где сеть встречается с хранилищем.
 * Экран сюда не заглядывает: он читает базу и видит изменения сам.
 */
class ChatStore(private val db: AppDatabase, private val now: () -> Instant = Instant::now) {

    /**
     * Сохранить страницу списка. Страница не заменяет базу целиком: чаты приходят по
     * сто, и стереть всё ради первой страницы значит показать обрезанный список.
     */
    suspend fun saveChats(items: List<ChatListItemDto>) = db.transaction {
        items.forEach { upsert(it) }
    }

    /**
     * Папки, наоборот, заменяются целиком: их единицы, сервер отдаёт их разом, и
     * удалённая папка иначе осталась бы вкладкой навсегда.
     */
    suspend fun saveFolders(folders: List<ChatFolderDto>) = db.transaction {
        val dao = db.folders()
        val arrived = folders.map { it.id }.toSet()
        dao.all().filter { it.id !in arrived }.forEach { dao.delete(it.id) }
        for (folder in folders) {
            dao.upsert(FolderEntity(folder.id, folder.name, folder.position))
            dao.clearMembers(folder.id)
            dao.insertMembers(folder.chatIds.map { FolderChatEntity(folder.id, it) })
        }
    }

    /*
     * Переключатели списка пишутся сразу, не дожидаясь сервера: палец убрал — строка
     * уже уехала. Откат делает вызывающий.
     */

    suspend fun setPinned(pinned: Boolean, chatId: String) = update(chatId) { it.copy(pinnedAt = if (pinned) now() else null) }

    suspend fun setArchived(archived: Boolean, chatId: String) =
        update(chatId) { it.copy(archivedAt = if (archived) now() else null) }

    suspend fun setMuted(muted: Boolean, chatId: String) = update(chatId) { it.copy(muted = muted) }

    private suspend fun update(chatId: String, change: (ChatEntity) -> ChatEntity) {
        val chat = db.chats().get(chatId) ?: return
        db.chats().update(change(chat))
    }

    private suspend fun upsert(item: ChatListItemDto) {
        val known = db.chats().get(item.id)
        db.chats().upsert(
            ChatEntity(
                id = item.id,
                type = item.type,
                title = item.title,
                avatarUrl = item.avatarUrl,
                chatDescription = item.description,
                subject = item.subject,
                memberCount = item.memberCount ?: known?.memberCount ?: 0,
                unreadCount = item.unreadCount ?: 0,
                muted = item.muted ?: false,
                mutedImportantOnly = item.mutedImportantOnly ?: false,
                pinnedAt = item.pinnedAt,
                archivedAt = if (item.archived == true) known?.archivedAt ?: item.updatedAt else null,
                requestIncoming = item.requestIncoming ?: false,
                requestOutgoing = item.requestOutgoing ?: false,
                othersReadAt = item.othersReadAt,
                lastMessageId = item.lastMessage?.id ?: known?.lastMessageId,
                // Позиция догона — «всё до N у клиента есть» (§9.2c), и превью её не двигает:
                // список знает последнее сообщение, а не те, что между ним и прошлым визитом.
                // Подняв её до превью, догон запросил бы разницу с конца и пропустил середину.
                lastSeq = known?.lastSeq ?: 0,
                updatedAt = item.updatedAt,
            ),
        )
        // Превью пишем ПОСЛЕ чата: у сообщения внешний ключ на него.
        item.lastMessage?.let { MessageStore.upsert(db, it) }
        mirrorServerDraft(item.draft, item.id)
    }

    /**
     * Черновик с сервера принимаем, только если своего неотправленного нет: местный
     * текст всегда свежее, и затирать его ответом списка — ровно та потеря, из-за
     * которой черновики и заводят.
     */
    private suspend fun mirrorServerDraft(text: String?, chatId: String) {
        val drafts = db.drafts()
        val local = drafts.get(chatId)
        if (local != null && !local.isSynced) return
        if (text.isNullOrEmpty()) {
            drafts.delete(chatId)
            return
        }
        drafts.upsert(DraftEntity(chatId, text, local?.replyToId, local?.updatedAt ?: now(), isSynced = true))
    }
}

/** Запись переписки: страницы истории и догон. */
class MessageStore(private val db: AppDatabase, private val now: () -> Instant = Instant::now) {

    /** Страница истории. Порядок безразличен: лента сортирует сама. */
    suspend fun saveMessages(messages: List<ChatMessageDto>, chatId: String) {
        if (messages.isEmpty()) return
        db.transaction {
            messages.forEach { upsert(db, it) }
            liftLastSeq(chatId, messages.mapNotNull { it.seq }.maxOrNull())
        }
    }

    /**
     * Применить догон. Сначала правки и новые, потом удаления — иначе только что
     * удалённое вернулось бы из `created`.
     */
    suspend fun apply(updates: ChatUpdatesDto, chatId: String) = db.transaction {
        (updates.created + updates.mutated).forEach { upsert(db, it) }
        for (id in updates.deletedIds) {
            // Удаление мягкое: в ленте на месте строки — «сообщение удалено», соседи не прыгают.
            val message = db.messages().byRemoteId(id) ?: db.messages().get(id) ?: continue
            if (message.deletedAt == null) db.messages().update(message.copy(deletedAt = now()))
        }
        liftLastSeq(chatId, updates.latestSeq)
    }

    /** Позиция догона: с неё запрашивается разница после обрыва. */
    suspend fun lastSeq(chatId: String): Int = db.chats().get(chatId)?.lastSeq ?: 0

    /** Сбросить переписку: честный ответ на `overflow` — склеивать там нечего. */
    suspend fun clearHistory(chatId: String) = db.transaction {
        db.messages().clearSent(chatId)
        db.chats().get(chatId)?.let { db.chats().update(it.copy(lastSeq = 0)) }
    }

    private suspend fun liftLastSeq(chatId: String, seq: Int?) {
        val chat = db.chats().get(chatId) ?: return
        if (seq != null && seq > chat.lastSeq) db.chats().update(chat.copy(lastSeq = seq))
    }

    companion object {
        /**
         * Своё отправленное сообщение уже лежит под локальным ключом — подтверждение
         * находим по `remoteId`, иначе в ленте появился бы дубль.
         */
        suspend fun upsert(db: AppDatabase, message: ChatMessageDto) {
            val dao = db.messages()
            val local = dao.byRemoteId(message.id)
            if (local != null) {
                dao.update(
                    local.copy(
                        seq = message.seq ?: local.seq,
                        content = message.content,
                        editedAt = message.editedAt,
                        deletedAt = message.deletedAt,
                        pinnedAt = message.pinnedAt,
                        sendState = SendState.SENT,
                    ),
                )
                saveAttachments(db, message, local.id)
                return
            }
            dao.upsert(
                MessageEntity(
                    id = message.id,
                    remoteId = message.id,
                    chatId = message.chatId,
                    seq = message.seq,
                    senderId = message.senderId,
                    content = message.content,
                    replyToId = message.replyToId,
                    replyQuote = message.replyQuote,
                    systemType = message.systemType,
                    editedAt = message.editedAt,
                    deletedAt = message.deletedAt,
                    pinnedAt = message.pinnedAt,
                    createdAt = message.createdAt,
                    sendState = SendState.SENT,
                ),
            )
            saveAttachments(db, message, message.id)
        }

        /**
         * Вложения переписываются целиком: сервер присылает полный список. Уже
         * скачанный файл не теряем — ключ кэша id, и путь на диск переживает обновление.
         */
        private suspend fun saveAttachments(db: AppDatabase, message: ChatMessageDto, messageId: String) {
            val media = message.media ?: return
            val dao = db.messages()
            val paths = dao.attachments(messageId).associate { it.id to it.localPath }
            dao.deleteAttachments(messageId)
            dao.insertAttachments(
                media.map {
                    AttachmentEntity(it.id, messageId, it.mime, it.name, it.size, it.width, it.height, paths[it.id])
                },
            )
        }
    }
}
