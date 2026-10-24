package kz.studenthub.app.core

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kz.studenthub.app.core.chats.ChatStore
import kz.studenthub.app.core.storage.ChatEntity
import kz.studenthub.app.core.storage.ChatKind
import kz.studenthub.app.core.storage.DraftEntity
import kz.studenthub.app.core.storage.MessageEntity
import kz.studenthub.app.core.storage.SendState
import kz.studenthub.app.support.T0
import kz.studenthub.app.support.chatDto
import kz.studenthub.app.support.messageDto
import kz.studenthub.app.support.testDatabase
import kz.studenthub.app.features.chats.ChatListModel
import kz.studenthub.app.features.chats.ChatListTab
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StorageTest {
    private val db = testDatabase()

    @After
    fun close() = db.close()

    private fun chat(id: String) = ChatEntity(id = id, type = "GROUP", title = id, avatarUrl = null, chatDescription = null, subject = null, updatedAt = T0)

    private fun message(id: String, chatId: String, seq: Int?, state: SendState = SendState.SENT) =
        MessageEntity(id = id, remoteId = if (state == SendState.SENT) id else null, chatId = chatId, seq = seq, senderId = "u", content = id, createdAt = T0, sendState = state)

    @Test
    fun chatAndMessageRoundTrip() = runTest {
        db.chats().upsert(chat("c1"))
        db.messages().insert(message("m1", "c1", 1))
        assertEquals("m1", db.messages().thread("c1").single().id)
    }

    /** Удаление чата уносит переписку и черновик: сироты однажды показались бы на экране. */
    @Test
    fun deletingChatRemovesItsMessagesAndDraft() = runTest {
        db.chats().upsert(chat("c1"))
        db.messages().insert(message("m1", "c1", 1))
        db.drafts().upsert(DraftEntity("c1", "черновик", null, T0, false))
        db.chats().delete("c1")
        assertTrue(db.messages().thread("c1").isEmpty())
        assertNull(db.drafts().get("c1"))
    }

    /** Неотправленных без номера в чате может быть сколько угодно: номер выдаёт сервер. */
    @Test
    fun severalPendingMessagesWithoutSeqCoexist() = runTest {
        db.chats().upsert(chat("c1"))
        db.messages().insert(message("p1", "c1", null, SendState.PENDING))
        db.messages().insert(message("p2", "c1", null, SendState.PENDING))
        assertEquals(2, db.messages().unsent("c1").size)
    }

    /** Черновик ровно один на чат: повторное сохранение переписывает текст. */
    @Test
    fun draftIsOnePerChat() = runTest {
        db.chats().upsert(chat("c1"))
        db.drafts().upsert(DraftEntity("c1", "раз", null, T0, false))
        db.drafts().upsert(DraftEntity("c1", "два", null, T0, false))
        assertEquals("два", db.drafts().get("c1")?.text)
    }

    /** Тип чата, которого в сборке ещё нет, не роняет разбор. */
    @Test
    fun unknownChatTypeIsTolerated() = runTest {
        ChatStore(db).saveChats(listOf(chatDto("c1", type = "CHANCELLOR_CHANNEL")))
        assertEquals(ChatKind.UNKNOWN, db.chats().get("c1")?.kind)
    }
}

class ChatListQueryTest {
    private val db = testDatabase()
    private val store = ChatStore(db)

    @After
    fun close() = db.close()

    /** Закреплённые сверху, остальные по свежести — как в вебе. */
    @Test
    fun pinnedChatsComeFirst() = runTest {
        store.saveChats(
            listOf(
                chatDto("old", updatedAt = T0),
                chatDto("new", updatedAt = T0.plusSeconds(60)),
                chatDto("pinned", updatedAt = T0.minusSeconds(600), pinnedAt = T0),
            ),
        )
        assertEquals(listOf("pinned", "new", "old"), db.chats().observeAll().first().map { it.id })
    }

    /** Архив и непринятые запросы — отдельные вкладки: иначе человек отвечает незнакомцу. */
    @Test
    fun archiveAndRequestsAreOutOfTheMainList() = runTest {
        store.saveChats(listOf(chatDto("main"), chatDto("arch", archived = true), chatDto("req", requestIncoming = true)))
        assertEquals(listOf("main"), db.chats().observeAll().first().map { it.id })
        assertEquals(listOf("arch"), db.chats().observeArchive().first().map { it.id })
        assertEquals(listOf("req"), db.chats().observeRequests().first().map { it.id })
    }

    @Test
    fun folderShowsOnlyItsChats() = runTest {
        store.saveChats(listOf(chatDto("a"), chatDto("b")))
        store.saveFolders(listOf(kz.studenthub.app.core.chats.ChatFolderDto("f1", "Учёба", 0, listOf("b"))))
        assertEquals(listOf("b"), db.chats().observeFolder("f1").first().map { it.id })
    }

    /** Черновик вместо превью: он важнее чужого последнего сообщения. */
    @Test
    fun draftWinsOverLastMessage() = runTest {
        store.saveChats(listOf(chatDto("c1", draft = "мой черновик", last = messageDto("m1", "c1", 1, content = "чужое"))))
        assertEquals("мой черновик", db.chats().observeAll().first().single().preview)
    }

    /** Удалённое сообщение в превью не показывается: строка не противоречит чату. */
    @Test
    fun deletedMessageIsNotPreviewed() = runTest {
        store.saveChats(listOf(chatDto("c1", last = messageDto("m1", "c1", 1, deletedAt = T0))))
        assertNull(db.chats().observeAll().first().single().preview)
    }

    /** Пустые вкладки не показываем: «Архив» без архива ничего не сообщает. */
    @Test
    fun tabsAppearOnlyWhenTheyHaveContent() = runTest {
        val api = object : kz.studenthub.app.core.chats.ChatsFetching {
            override suspend fun chats(cursor: String?, limit: Int) = kz.studenthub.app.core.network.Page(emptyList<kz.studenthub.app.core.chats.ChatListItemDto>(), null)
            override suspend fun folders() = emptyList<kz.studenthub.app.core.chats.ChatFolderDto>()
            override suspend fun setPinned(pinned: Boolean, chatId: String) {}
            override suspend fun setArchived(archived: Boolean, chatId: String) {}
            override suspend fun setMuted(muted: Boolean, chatId: String) {}
        }
        store.saveChats(listOf(chatDto("c1")))
        val model = ChatListModel(db, api)
        val tabs = kotlinx.coroutines.flow.combine(
            db.folders().observe(),
            db.chats().observeRequestCount(),
            db.chats().observeArchivedCount(),
        ) { f, r, a -> Triple(f.size, r, a) }.first()
        assertEquals(Triple(0, 0, 0), tabs)
        store.saveChats(listOf(chatDto("c2", archived = true)))
        assertEquals(1, db.chats().observeArchivedCount().first())
        assertEquals(ChatListTab.All, model.tab.value)
    }
}
