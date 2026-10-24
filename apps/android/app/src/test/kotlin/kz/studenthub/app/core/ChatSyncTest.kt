package kz.studenthub.app.core

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.test.runTest
import kz.studenthub.app.core.chats.AttachmentSending
import kz.studenthub.app.core.chats.AttachmentUpload
import kz.studenthub.app.core.chats.AttachmentUploadTicket
import kz.studenthub.app.core.chats.AttachmentUploader
import kz.studenthub.app.core.chats.ChatAttachmentDto
import kz.studenthub.app.core.chats.ChatFolderDto
import kz.studenthub.app.core.chats.ChatListItemDto
import kz.studenthub.app.core.chats.ChatMessageDto
import kz.studenthub.app.core.chats.ChatMessageSending
import kz.studenthub.app.core.chats.ChatStore
import kz.studenthub.app.core.chats.ChatUpdatesDto
import kz.studenthub.app.core.chats.DraftSaving
import kz.studenthub.app.core.chats.DraftSync
import kz.studenthub.app.core.chats.MessageOutbox
import kz.studenthub.app.core.chats.MessageStore
import kz.studenthub.app.core.chats.OutgoingAttachment
import kz.studenthub.app.core.network.ApiError
import kz.studenthub.app.core.network.ApiErrorCode
import kz.studenthub.app.core.network.AppJson
import kz.studenthub.app.core.storage.AttachmentEntity
import kz.studenthub.app.core.storage.DraftEntity
import kz.studenthub.app.core.storage.SendState
import kz.studenthub.app.support.T0
import kz.studenthub.app.support.chatDto
import kz.studenthub.app.support.messageDto
import kz.studenthub.app.support.testDatabase
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.IOException

class ChatSyncTest {
    private val db = testDatabase()
    private val store = ChatStore(db)

    @After
    fun close() = db.close()

    /** Ответ сервера шире, чем нужно списку: новое поле на бэкенде не должно ронять экран. */
    @Test
    fun extraFieldsDoNotBreakDecoding() {
        val item = AppJson.decodeFromString(
            ChatListItemDto.serializer(),
            """{"id":"c1","type":"GROUP","updatedAt":"2026-10-06T10:00:00.000Z","brandNewField":{"x":1}}""",
        )
        assertEquals("c1", item.id)
    }

    @Test
    fun pageIsStoredWithItsPreviewMessage() = runTest {
        store.saveChats(listOf(chatDto("c1", last = messageDto("m1", "c1", 5))))
        assertEquals("m1", db.chats().get("c1")?.lastMessageId)
        assertNotNull(db.messages().get("m1"))
    }

    /**
     * Превью не двигает позицию догона (§9.2c): локально M1–M50, список принёс M70 —
     * догон обязан запросить разницу с 50, а не с 70, иначе M51–M69 пропадут.
     */
    @Test
    fun previewDoesNotMoveCatchUpPosition() = runTest {
        store.saveChats(listOf(chatDto("c1")))
        MessageStore(db).saveMessages(listOf(messageDto("m50", "c1", 50)), "c1")
        store.saveChats(listOf(chatDto("c1", last = messageDto("m70", "c1", 70))))
        assertEquals(50, db.chats().get("c1")?.lastSeq)
        assertEquals("m70", db.chats().get("c1")?.lastMessageId)
    }

    /** Местный неотправленный черновик всегда свежее серверного. */
    @Test
    fun unsyncedLocalDraftSurvivesServerAnswer() = runTest {
        store.saveChats(listOf(chatDto("c1")))
        db.drafts().upsert(DraftEntity("c1", "печатаю", null, T0, isSynced = false))
        store.saveChats(listOf(chatDto("c1", draft = "старый с сервера")))
        assertEquals("печатаю", db.drafts().get("c1")?.text)
    }

    /**
     * Отправленный текст не воскресает черновиком: очистка живёт у себя, пока сервер её не
     * подтвердит, и ответ списка со старым серверным черновиком её не перебивает.
     */
    @Test
    fun clearedDraftSurvivesUntilServerConfirms() = runTest {
        store.saveChats(listOf(chatDto("c1")))
        var online = false
        val sent = mutableListOf<String>()
        val drafts = DraftSync(
            db,
            object : DraftSaving {
                override suspend fun saveDraft(chatId: String, text: String) {
                    if (!online) throw ApiError.Transport(IOException("offline"))
                    sent += text
                }
            },
        )
        drafts.save("c1", "")
        store.saveChats(listOf(chatDto("c1", draft = "уже отправленный текст")))
        assertEquals("", db.drafts().get("c1")?.text)
        online = true
        drafts.flush()
        assertEquals(listOf(""), sent)
        assertNull(db.drafts().get("c1"))
    }

    @Test
    fun draftIsSentToServerAndMarkedSynced() = runTest {
        store.saveChats(listOf(chatDto("c1")))
        val sent = mutableListOf<Pair<String, String>>()
        val api = object : DraftSaving {
            override suspend fun saveDraft(chatId: String, text: String) {
                sent += chatId to text
            }
        }
        DraftSync(db, api).save("c1", "печатаю")
        assertEquals(listOf("c1" to "печатаю"), sent)
        assertTrue(db.drafts().get("c1")!!.isSynced)
    }

    @Test
    fun serverDraftIsMirroredWhenNoLocalOne() = runTest {
        store.saveChats(listOf(chatDto("c1", draft = "с другого устройства")))
        assertEquals("с другого устройства", db.drafts().get("c1")?.text)
    }

    /** Папки заменяются целиком: удалённая иначе осталась бы вкладкой навсегда. */
    @Test
    fun foldersAreReplacedWholesale() = runTest {
        store.saveFolders(listOf(ChatFolderDto("f1", "Раз", 0), ChatFolderDto("f2", "Два", 1)))
        store.saveFolders(listOf(ChatFolderDto("f2", "Два", 0)))
        assertEquals(listOf("f2"), db.folders().all().map { it.id })
    }

    /**
     * Чат, которого сервер больше не отдаёт (человека убрали из группы), уходит из базы
     * вместе с перепиской и черновиком: база повторяет доступ на сервере (§11.3).
     */
    @Test
    fun chatsGoneFromServerAreForgotten() = runTest {
        store.saveChats(listOf(chatDto("c1"), chatDto("c2", draft = "черновик")))
        MessageStore(db).saveMessages(listOf(messageDto("m1", "c2", 1)), "c2")
        store.retainChats(setOf("c1"))
        assertNotNull(db.chats().get("c1"))
        assertNull(db.chats().get("c2"))
        assertNull(db.messages().get("m1"))
        assertNull(db.drafts().get("c2"))
    }

    /** Обновление строки чата не стирает его переписку: каскад не должен срабатывать. */
    @Test
    fun resavingChatKeepsItsMessages() = runTest {
        store.saveChats(listOf(chatDto("c1")))
        MessageStore(db).saveMessages(listOf(messageDto("m1", "c1", 1)), "c1")
        store.saveChats(listOf(chatDto("c1", title = "Новое название")))
        assertEquals(1, db.messages().thread("c1").size)
    }
}

class MessageSyncTest {
    private val db = testDatabase()
    private val chats = ChatStore(db)
    private val store = MessageStore(db)

    @After
    fun close() = db.close()

    @Test
    fun historyPageIsStoredAndLastSeqLifted() = runTest {
        chats.saveChats(listOf(chatDto("c1")))
        store.saveMessages(listOf(messageDto("m1", "c1", 1), messageDto("m2", "c1", 2)), "c1")
        assertEquals(2, db.messages().thread("c1").size)
        assertEquals(2, store.lastSeq("c1"))
    }

    /** Автор и детали системного события ложатся в строку: лента подписывает и строит текст сама. */
    @Test
    fun senderAndSystemDetailsAreStored() = runTest {
        chats.saveChats(listOf(chatDto("c1")))
        val system = ChatMessageDto(
            id = "m1",
            chatId = "c1",
            seq = 1,
            senderId = "u1",
            content = "",
            systemType = "member_added",
            createdAt = T0,
            sender = ChatMessageDto.Sender("u1", firstName = "Айдана", lastName = "Сейткали"),
            systemMeta = ChatMessageDto.SystemMeta(targetName = "Нуртаев Ерлан"),
        )
        store.saveMessages(listOf(system), "c1")
        val row = db.messages().get("m1")!!
        assertEquals("Сейткали Айдана", row.senderName)
        assertEquals("Нуртаев Ерлан", row.systemTarget)
    }

    /** Удаление ставит метку, а не стирает строку: соседи в ленте не прыгают. */
    @Test
    fun updatesMarkDeletionInsteadOfErasing() = runTest {
        chats.saveChats(listOf(chatDto("c1")))
        store.saveMessages(listOf(messageDto("m1", "c1", 1)), "c1")
        store.apply(ChatUpdatesDto(deletedIds = listOf("m1"), latestSeq = 1), "c1")
        assertNotNull(db.messages().get("m1")?.deletedAt)
    }

    /** Правка известного сообщения меняет текст, а не создаёт второе. */
    @Test
    fun mutationUpdatesExistingRow() = runTest {
        chats.saveChats(listOf(chatDto("c1")))
        store.saveMessages(listOf(messageDto("m1", "c1", 1, content = "было")), "c1")
        store.apply(ChatUpdatesDto(mutated = listOf(messageDto("m1", "c1", 1, content = "стало")), latestSeq = 1), "c1")
        assertEquals(listOf("стало"), db.messages().thread("c1").map { it.content })
    }

    /** Разрыв больше лимита: подтверждённое сбрасываем, своё неотправленное остаётся. */
    @Test
    fun clearHistoryKeepsPendingMessages() = runTest {
        chats.saveChats(listOf(chatDto("c1")))
        store.saveMessages(listOf(messageDto("m1", "c1", 1)), "c1")
        MessageOutbox(db, FailingSender()).send("моё", "c1", "me", null)
        store.clearHistory("c1")
        assertEquals(listOf("моё"), db.messages().thread("c1").map { it.content })
        assertEquals(0, store.lastSeq("c1"))
    }

    /** Сообщение видно мгновенно, подтверждение лишь меняет состояние строки. */
    @Test
    fun sentMessageAppearsImmediatelyAndGetsConfirmed() = runTest {
        chats.saveChats(listOf(chatDto("c1")))
        val sender = RecordingSender()
        assertTrue(MessageOutbox(db, sender).send("привет", "c1", "me", null))
        val row = db.messages().thread("c1").single()
        assertEquals(SendState.SENT, row.sendState)
        assertEquals("srv-1", row.remoteId)
        assertEquals(7, row.seq)
    }

    /** Сеть отказала — текст остаётся в ленте и в очереди: уйдёт сам, когда появится связь. */
    @Test
    fun failedSendStaysInTheThread() = runTest {
        chats.saveChats(listOf(chatDto("c1")))
        var stuck = 0
        assertFalse(MessageOutbox(db, FailingSender(), onStuck = { stuck++ }).send("привет", "c1", "me", null))
        assertEquals(SendState.PENDING, db.messages().thread("c1").single().sendState)
        assertEquals(1, stuck)
    }

    /**
     * Отказ сервера по одному сообщению очередь не держит: оно помечается неотправленным
     * (повторит человек), остальные уходят, и фоновая работа не повторяется вечно.
     */
    @Test
    fun rejectedMessageDoesNotBlockQueue() = runTest {
        chats.saveChats(listOf(chatDto("c1")))
        var clock = T0
        val offline = MessageOutbox(db, FailingSender(), now = { clock.also { clock = clock.plusSeconds(1) } })
        offline.send("запретное", "c1", "me", null)
        offline.send("обычное", "c1", "me", null)
        val sent = mutableListOf<String>()
        val picky = object : ChatMessageSending {
            override suspend fun send(text: String, chatId: String, replyToId: String?): ChatMessageDto {
                if (text == "запретное") throw ApiError.Server(ApiErrorCode.FORBIDDEN, "нет", emptyList(), 403)
                sent += text
                return messageDto("srv-$text", chatId, 9, sender = "me", content = text)
            }
        }
        assertTrue(MessageOutbox(db, picky).flush())
        assertEquals(listOf("обычное"), sent)
        assertEquals(SendState.FAILED, db.messages().thread("c1").first { it.content == "запретное" }.sendState)
        // Отвергнутое само не повторяется: его повторяет человек.
        assertTrue(MessageOutbox(db, picky).flush())
        assertEquals(listOf("обычное"), sent)
    }

    /** Две досылки разом (открытие чата и фоновая работа) не отправляют одно сообщение дважды. */
    @Test
    fun concurrentFlushSendsOnce() = runTest {
        chats.saveChats(listOf(chatDto("c1")))
        MessageOutbox(db, FailingSender()).send("одно", "c1", "me", null)
        val sent = mutableListOf<String>()
        val slow = object : ChatMessageSending {
            override suspend fun send(text: String, chatId: String, replyToId: String?): ChatMessageDto {
                sent += text
                kotlinx.coroutines.delay(50)
                return messageDto("srv-1", chatId, 1, sender = "me", content = text)
            }
        }
        val outbox = MessageOutbox(db, slow)
        listOf(async { outbox.flush() }, async { outbox.flush("c1") }).awaitAll()
        assertEquals(listOf("одно"), sent)
    }

    /** Очередь — сами сообщения в базе: переживает перезапуск, досылается по порядку. */
    @Test
    fun flushResendsStuckMessagesInOrder() = runTest {
        chats.saveChats(listOf(chatDto("c1")))
        var clock = T0
        val outbox = MessageOutbox(db, FailingSender(), now = { clock.also { clock = clock.plusSeconds(1) } })
        outbox.send("первое", "c1", "me", null)
        outbox.send("второе", "c1", "me", null)
        val sender = RecordingSender()
        assertTrue(MessageOutbox(db, sender).flush())
        assertEquals(listOf("первое", "второе"), sender.sent)
    }

    /** Сокет принёс своё же сообщение раньше HTTP-ответа: дубля в ленте нет. */
    @Test
    fun socketEchoBeforeConfirmationLeavesOneRow() = runTest {
        chats.saveChats(listOf(chatDto("c1")))
        val sender = object : ChatMessageSending {
            override suspend fun send(text: String, chatId: String, replyToId: String?): ChatMessageDto {
                MessageStore.upsert(db, messageDto("srv-1", chatId, 7, sender = "me", content = text))
                return messageDto("srv-1", chatId, 7, sender = "me", content = text)
            }
        }
        MessageOutbox(db, sender).send("привет", "c1", "me", null)
        val rows = db.messages().thread("c1")
        assertEquals(1, rows.size)
        assertEquals("srv-1", rows.single().remoteId)
    }

    private class FailingSender : ChatMessageSending {
        override suspend fun send(text: String, chatId: String, replyToId: String?): ChatMessageDto =
            throw ApiError.Transport(IOException("offline"))
    }

    private class RecordingSender : ChatMessageSending {
        val sent = mutableListOf<String>()

        override suspend fun send(text: String, chatId: String, replyToId: String?): ChatMessageDto {
            sent += text
            return messageDto("srv-${sent.size}", chatId, 6 + sent.size, sender = "me", content = text)
        }
    }
}

class AttachmentTest {
    private val db = testDatabase()

    @After
    fun close() = db.close()

    private fun file() = File.createTempFile("photo", ".jpg").apply { writeBytes(ByteArray(10)) }

    /** Вложение видно сразу; подтверждение меняет только идентификаторы, файл остаётся на диске. */
    @Test
    fun uploadedAttachmentIsVisibleImmediately() = runTest {
        ChatStore(db).saveChats(listOf(chatDto("c1")))
        val photo = file()
        assertTrue(AttachmentUploader(db, StubStorage()).send(OutgoingAttachment(photo, "image/jpeg", "photo.jpg"), "c1", "me", null, null))
        val message = db.messages().thread("c1").single()
        assertEquals(SendState.SENT, message.sendState)
        val attachment = db.messages().attachments(message.id).single()
        assertEquals("file-1", attachment.id)
        assertEquals(photo.absolutePath, attachment.localPath)
    }

    /** Загрузка сорвалась без сети — сообщение в очереди, файл на месте: уйдёт, когда появится связь. */
    @Test
    fun failedUploadKeepsMessageAndFile() = runTest {
        ChatStore(db).saveChats(listOf(chatDto("c1")))
        val photo = file()
        assertFalse(AttachmentUploader(db, StubStorage(fail = true)).send(OutgoingAttachment(photo, "image/jpeg", "photo.jpg"), "c1", "me", null, null))
        val message = db.messages().thread("c1").single()
        assertEquals(SendState.PENDING, message.sendState)
        assertTrue(File(db.messages().attachments(message.id).single().localPath!!).exists())
    }

    /** Повторная синхронизация не теряет уже скачанный файл. */
    @Test
    fun incomingAttachmentsKeepLocalCopy() = runTest {
        ChatStore(db).saveChats(listOf(chatDto("c1")))
        val media = listOf(ChatAttachmentDto("f1", "image/png", 10, "a.png"))
        MessageStore(db).saveMessages(listOf(messageDto("m1", "c1", 1, media = media)), "c1")
        val stored = db.messages().attachments("m1").single()
        db.messages().insertAttachments(listOf(stored.copy(localPath = "/cache/f1")))
        MessageStore(db).saveMessages(listOf(messageDto("m1", "c1", 1, media = media)), "c1")
        assertEquals("/cache/f1", db.messages().attachments("m1").single().localPath)
    }

    /** Голосовое узнаётся по имени, как на сервере; mime по содержимому бывает и `video/*`. */
    @Test
    fun voiceIsRecognisedByName() {
        assertTrue(AttachmentEntity("1", "m", "audio/m4a", "voice-1.m4a", null, null, null, null).isVoice)
        assertTrue(AttachmentEntity("3", "m", "video/webm", "voice-2.webm", null, null, null, null).isVoice)
        assertTrue(AttachmentEntity("4", "m", "video/mp4", "voice-3.m4a", null, null, null, null).isVoice)
        assertFalse(AttachmentEntity("2", "m", "audio/mpeg", "song.mp3", null, null, null, null).isVoice)
    }

    private class StubStorage(private val fail: Boolean = false) : AttachmentSending {
        override suspend fun presign(chatId: String, mime: String) = AttachmentUploadTicket("key-1", "https://s3/put", null)

        override suspend fun upload(file: File, url: String, mime: String) {
            if (fail) throw ApiError.Transport(IOException("offline"))
        }

        override suspend fun sendUploaded(chatId: String, content: String?, replyToId: String?, attachments: List<AttachmentUpload>) =
            messageDto("srv-1", chatId, 3, sender = "me", media = listOf(ChatAttachmentDto("file-1", "image/jpeg", 10, "photo.jpg")))
    }
}

