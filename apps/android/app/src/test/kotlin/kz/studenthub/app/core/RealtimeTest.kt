package kz.studenthub.app.core

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kz.studenthub.app.core.chats.ChatStore
import kz.studenthub.app.core.chats.MessageStore
import kz.studenthub.app.core.realtime.RealtimeCoordinator
import kz.studenthub.app.core.realtime.RealtimeEvent
import kz.studenthub.app.core.realtime.RealtimeTransport
import kz.studenthub.app.core.session.AuthSession
import kz.studenthub.app.core.session.InMemorySecretStore
import kz.studenthub.app.core.session.SessionRefreshing
import kz.studenthub.app.core.session.SessionStore
import kz.studenthub.app.support.LONG_LIVED_TOKEN
import kz.studenthub.app.support.MemoryCookies
import kz.studenthub.app.support.T0
import kz.studenthub.app.support.chatDto
import kz.studenthub.app.support.messageDto
import kz.studenthub.app.support.testDatabase
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RealtimeCoordinatorTest {
    private val db = testDatabase()

    @After
    fun close() = db.close()

    private fun TestScope.coordinator(transport: FakeTransport = FakeTransport()): RealtimeCoordinator {
        val session = SessionStore(NoRefresh(), InMemorySecretStore(), MemoryCookies())
        session.adopt(AuthSession(LONG_LIVED_TOKEN))
        return RealtimeCoordinator(transport, session, db, backgroundScope)
    }

    /** Чужое сообщение в закрытом чате поднимает счётчик и двигает чат в списке. */
    @Test
    fun incomingMessageUpdatesChatAndCounter() = runTest {
        ChatStore(db).saveChats(listOf(chatDto("c1")))
        MessageStore(db).saveMessages(listOf(messageDto("m0", "c1", 3)), "c1")
        coordinator().handle(RealtimeEvent.MessageNew(messageDto("m1", "c1", 4, createdAt = T0.plusSeconds(60))))
        val chat = db.chats().get("c1")!!
        assertEquals(1, chat.unreadCount)
        assertEquals("m1", chat.lastMessageId)
        assertEquals(4, chat.lastSeq)
    }

    /** Сообщение через разрыв двигает превью, но не позицию догона: середину догонит `updates`. */
    @Test
    fun messageAcrossGapKeepsCatchUpPosition() = runTest {
        ChatStore(db).saveChats(listOf(chatDto("c1")))
        MessageStore(db).saveMessages(listOf(messageDto("m50", "c1", 50)), "c1")
        coordinator().handle(RealtimeEvent.MessageNew(messageDto("m70", "c1", 70, createdAt = T0.plusSeconds(60))))
        val chat = db.chats().get("c1")!!
        assertEquals("m70", chat.lastMessageId)
        assertEquals(50, chat.lastSeq)
    }

    /** Сообщение в чат, которого нет в базе, не роняет приём: у сообщения внешний ключ на чат. */
    @Test
    fun messageForUnknownChatIsSkipped() = runTest {
        coordinator().handle(RealtimeEvent.MessageNew(messageDto("m1", "ghost", 1)))
        assertNull(db.messages().get("m1"))
    }

    /** Открытый чат читают прямо сейчас — непрочитанным его сообщение не бывает. */
    @Test
    fun messageInOpenChatDoesNotRaiseCounter() = runTest {
        ChatStore(db).saveChats(listOf(chatDto("c1")))
        val realtime = coordinator()
        realtime.open("c1")
        realtime.handle(RealtimeEvent.MessageNew(messageDto("m1", "c1", 1)))
        assertEquals(0, db.chats().get("c1")!!.unreadCount)
    }

    @Test
    fun chatReadClearsCounter() = runTest {
        ChatStore(db).saveChats(listOf(chatDto("c1", unread = 3)))
        coordinator().handle(RealtimeEvent.ChatRead("c1", T0))
        assertEquals(0, db.chats().get("c1")!!.unreadCount)
    }

    @Test
    fun deletionIsSoft() = runTest {
        ChatStore(db).saveChats(listOf(chatDto("c1", last = messageDto("m1", "c1", 1))))
        coordinator().handle(RealtimeEvent.MessageDeleted("m1", "c1"))
        assertNotNull(db.messages().get("m1")?.deletedAt)
    }

    /** Переподключение — новая эпоха (открытый чат догоняет) и снова вход в комнату. */
    @Test
    fun reconnectBumpsEpochAndRejoinsRoom() = runTest {
        val transport = FakeTransport()
        val realtime = coordinator(transport)
        realtime.open("c1")
        realtime.handle(RealtimeEvent.Connected)
        assertEquals(1, realtime.connectionEpoch.value)
        assertEquals(listOf("c1", "c1"), transport.joined)
    }

    /** «Печатает…» держится в памяти и снимается явным «закончил» или через 4 секунды. */
    @Test
    fun actionAppearsClearsAndExpires() = runTest {
        val realtime = coordinator()
        realtime.handle(RealtimeEvent.Action("c1", "u2", "TYPING"))
        assertEquals("TYPING", realtime.actions.value["c1"]?.get("u2"))
        realtime.handle(RealtimeEvent.Action("c1", "u2", null))
        assertNull(realtime.actions.value["c1"])
        realtime.handle(RealtimeEvent.Action("c1", "u2", "RECORDING_VOICE"))
        advanceTimeBy(4_100)
        assertNull(realtime.actions.value["c1"])
    }

    /** `chat:updated` несёт только сменившееся поле — остальное в строке чата не трогаем. */
    @Test
    fun chatUpdatedPatchesTitleAndAvatar() = runTest {
        ChatStore(db).saveChats(listOf(chatDto("c1", title = "Было")))
        val realtime = coordinator()
        realtime.handle(RealtimeEvent.ChatUpdated("c1", title = "Стало"))
        assertEquals("Стало", db.chats().get("c1")!!.title)
        realtime.handle(RealtimeEvent.ChatUpdated("c1", avatarChanged = true, avatarUrl = "https://cdn/a.png"))
        assertEquals("https://cdn/a.png", db.chats().get("c1")!!.avatarUrl)
        assertEquals("Стало", db.chats().get("c1")!!.title)
    }

    /** `chat:activity` обновляет список; пачка сигналов — не пачка запросов. */
    @Test
    fun chatActivityRefreshesList() = runTest {
        var refreshes = 0
        val session = SessionStore(NoRefresh(), InMemorySecretStore(), MemoryCookies())
        val realtime = RealtimeCoordinator(FakeTransport(), session, db, backgroundScope, refreshChats = { refreshes++ })
        realtime.handle(RealtimeEvent.ChatActivity("c1"))
        advanceUntilIdle()
        assertEquals(1, refreshes)
    }

    @Test
    fun presenceIsTracked() = runTest {
        val realtime = coordinator()
        realtime.handle(RealtimeEvent.Presence("u2", true))
        assertTrue("u2" in realtime.online.value)
        realtime.handle(RealtimeEvent.Presence("u2", false))
        assertTrue(realtime.online.value.isEmpty())
    }

    private class NoRefresh : SessionRefreshing {
        override suspend fun refresh() = AuthSession(LONG_LIVED_TOKEN)

        override suspend fun endSession() {}
    }

    class FakeTransport : RealtimeTransport {
        override val events: SharedFlow<RealtimeEvent> = MutableSharedFlow()
        val joined = mutableListOf<String>()

        override fun connect(token: String) {}

        override fun disconnect() {}

        override fun refresh(token: String) {}

        override fun join(chatId: String) {
            joined += chatId
        }

        override fun leave(chatId: String) {}

        override fun markRead(chatId: String, messageId: String) {}

        override fun send(action: String?, chatId: String) {}
    }
}

class RealtimeEventTest {
    @Test
    fun messageNewIsParsed() {
        val event = RealtimeEvent.parse(
            "message:new",
            """{"message":{"id":"m1","chatId":"c1","seq":3,"senderId":"u","content":"hi","createdAt":"2026-10-06T10:00:00.000Z"}}""",
        )
        assertEquals("m1", (event as RealtimeEvent.MessageNew).message.id)
    }

    @Test
    fun actionWithNullMeansStopped() {
        val event = RealtimeEvent.parse("chat:action", """{"chatId":"c1","userId":"u2","action":null}""")
        assertEquals(RealtimeEvent.Action("c1", "u2", null), event)
    }

    /** Из конверта `event` разбираем только известные типы. */
    @Test
    fun envelopeCarriesApplicationStatusOnly() {
        assertEquals(
            RealtimeEvent.ApplicationStatusChanged("a1", "APPROVED"),
            RealtimeEvent.parse("event", """{"type":"application.status.changed","entityId":"a1","data":{"status":"APPROVED"}}"""),
        )
        assertNull(RealtimeEvent.parse("event", """{"type":"post.created","entityId":"p1","data":{}}"""))
    }

    @Test
    fun chatUpdatedCarriesOnlyChangedField() {
        assertEquals(RealtimeEvent.ChatUpdated("c1", title = "Группа"), RealtimeEvent.parse("chat:updated", """{"chatId":"c1","title":"Группа"}"""))
        assertEquals(
            RealtimeEvent.ChatUpdated("c1", avatarChanged = true, avatarUrl = null),
            RealtimeEvent.parse("chat:updated", """{"chatId":"c1","avatarUrl":null}"""),
        )
        assertEquals(RealtimeEvent.ChatActivity("c1"), RealtimeEvent.parse("chat:activity", """{"chatId":"c1"}"""))
    }

    @Test
    fun garbageIsIgnored() {
        assertNull(RealtimeEvent.parse("message:new", "не json"))
        assertNull(RealtimeEvent.parse("chat:read", """{"chatId":"c1"}"""))
    }
}
