package kz.studenthub.app.features

import kz.studenthub.app.core.storage.MessageEntity
import kz.studenthub.app.features.chats.MessageTimeline
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset

class TimelineTest {
    private val zone: ZoneId = ZoneOffset.UTC
    private val t = Instant.parse("2026-10-06T10:00:00Z")

    private fun message(id: String, sender: String, at: Instant, system: String? = null) =
        MessageEntity(id = id, remoteId = id, chatId = "c", seq = null, senderId = sender, content = id, systemType = system, createdAt = at)

    private fun build(vararg messages: MessageEntity) = MessageTimeline.build(messages.toList(), viewerId = "me", zone = zone)

    /** Разные дни — разные секции: иначе переписка выглядит одним бесконечным днём. */
    @Test
    fun messagesSplitByDay() {
        val days = build(message("a", "u", t), message("b", "u", t.plusSeconds(86_400)))
        assertEquals(2, days.size)
    }

    /** Подряд идущие одного автора — одна группа: имя и хвостик по краям. */
    @Test
    fun consecutiveMessagesFormOneGroup() {
        val items = build(message("a", "u", t), message("b", "u", t.plusSeconds(60)), message("c", "u", t.plusSeconds(120))).single().items
        assertEquals(listOf(true, false, false), items.map { it.isFirstInGroup })
        assertEquals(listOf(false, false, true), items.map { it.isLastInGroup })
    }

    /** Пауза рвёт группу: через час это уже другой разговор. */
    @Test
    fun longPauseBreaksGroup() {
        val items = build(message("a", "u", t), message("b", "u", t.plusSeconds(3_600))).single().items
        assertTrue(items[1].isFirstInGroup)
    }

    @Test
    fun systemMessageStandsAlone() {
        val items = build(message("a", "u", t), message("s", "u", t.plusSeconds(10), system = "MEMBER_JOINED")).single().items
        assertTrue(items[1].isFirstInGroup && items[1].isLastInGroup)
    }

    @Test
    fun ownMessagesAreMarked() {
        val items = build(message("a", "me", t), message("b", "u", t.plusSeconds(10))).single().items
        assertTrue(items[0].isOwn)
        assertFalse(items[1].isOwn)
    }

    /** Якорь — первое чужое из последних `unreadCount`. */
    @Test
    fun unreadAnchorPointsAtFirstUnreadForeignMessage() {
        val list = listOf(message("a", "u", t), message("b", "u", t), message("mine", "me", t), message("c", "u", t))
        assertEquals("b", MessageTimeline.firstUnreadId(list, "me", unreadCount = 2))
    }

    @Test
    fun noAnchorWithoutUnread() = assertNull(MessageTimeline.firstUnreadId(listOf(message("a", "u", t)), "me", 0))
}
