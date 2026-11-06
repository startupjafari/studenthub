package kz.studenthub.app.features

import kotlinx.coroutines.test.runTest
import kz.studenthub.app.core.feed.EventDto
import kz.studenthub.app.core.feed.FeedApi
import kz.studenthub.app.core.feed.FeedFetching
import kz.studenthub.app.core.feed.NotificationDto
import kz.studenthub.app.core.feed.NotificationSettingsDto
import kz.studenthub.app.core.feed.PostCommentDto
import kz.studenthub.app.core.feed.PostDto
import kz.studenthub.app.core.feed.UserProfileDto
import kz.studenthub.app.core.network.ApiClient
import kz.studenthub.app.core.network.ApiError
import kz.studenthub.app.core.network.AppJson
import kz.studenthub.app.core.network.Page
import kz.studenthub.app.features.feed.EventsModel
import kz.studenthub.app.features.feed.FeedModel
import kz.studenthub.app.features.feed.NotificationsModel
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.IOException
import java.time.Instant

private val T = Instant.parse("2026-10-06T10:00:00Z")

/** Ответы сервера в их настоящем виде (posts.service.ts, events.service.ts) — разбор не должен падать. */
class FeedContractTest {
    @Test
    fun postIsDecodedFromServerShape() {
        val post = AppJson.decodeFromString(
            PostDto.serializer(),
            """{"id":"p1","audience":"GROUP","title":null,"content":"Привет","createdAt":"2026-10-06T10:00:00.000Z",
               "author":{"id":"u1","firstName":"Айгерим","lastName":"Нурлан","role":"STUDENT","avatarUrl":null},
               "media":[{"id":"f1","mime":"image/jpeg"}],
               "reactions":[{"emoji":"👍","userId":"u2"},{"emoji":"👍","userId":"me"}],
               "_count":{"comments":4},"bookmarked":false,"views":10}""",
        )
        assertEquals(4, post.commentsCount)
        assertEquals("f1", post.media.single().id)
        assertEquals(2, post.reactions.size)
    }

    @Test
    fun eventCarriesRegistrationAndParticipants() {
        val event = AppJson.decodeFromString(
            EventDto.serializer(),
            """{"id":"e1","title":"День открытых дверей","startsAt":"2026-10-10T09:00:00.000Z","endsAt":null,
               "location":null,"isOnline":false,"isRegistered":true,"_count":{"participants":12}}""",
        )
        assertTrue(event.isRegistered == true)
        assertEquals(12, event.count?.participants)
    }

    /** Ссылка уведомления: `url`, если он есть, иначе собирается из идентификаторов. */
    @Test
    fun notificationLinkComesFromData() {
        fun link(data: String) = AppJson.decodeFromString(
            NotificationDto.serializer(),
            """{"id":"n","type":"CHAT","title":"t","body":"b","isRead":false,"createdAt":"2026-10-06T10:00:00Z","data":$data}""",
        ).link
        assertEquals("/chats?c=c1", link("""{"url":"/chats?c=c1"}"""))
        assertEquals("/chats?c=c2", link("""{"chatId":"c2"}"""))
        assertEquals("/applications/a1", link("""{"applicationId":"a1"}"""))
    }
}

/** Запросы — в том виде, который принимает сервер. */
class FeedRequestTest {
    private val server = MockWebServer().apply { start() }
    private val api = FeedApi(ApiClient(server.url("/api/v1/").toString(), OkHttpClient(), "android/1.0.0+1"))

    @After
    fun stop() = server.close()

    private fun respond(body: String) = server.enqueue(MockResponse.Builder().code(200).body(body).build())

    /** `mine=false` сервер читает как правду (`z.coerce.boolean`) — параметр не шлём вовсе. */
    @Test
    fun allEventsOmitMineParameter() = runTest {
        respond("""{"success":true,"data":[],"meta":{"total":0}}""")
        api.events(mine = false)
        val target = server.takeRequest().target
        assertFalse("ушёл mine: $target", target.contains("mine"))
    }

    /** Тело PATCH строгое: имена полей — как на сервере, лишних нет. */
    @Test
    fun settingsUseServerFieldNames() = runTest {
        respond("""{"success":true,"data":{"pushEnabled":true,"emailEnabled":true}}""")
        api.updateNotificationSettings(NotificationSettingsDto(pushEnabled = true))
        assertEquals("""{"pushEnabled":true}""", server.takeRequest().body?.utf8())
    }
}

class FeedModelTest {
    private fun post(reactions: List<PostDto.Reaction>) = PostDto("p1", content = "x", createdAt = T, reactions = reactions)

    /** Счётчики и «мои» считаются из списка «кто что поставил». */
    @Test
    fun countsAndMineComeFromReactionRows() {
        val model = FeedModel(StubFeed(), viewerId = "me")
        val post = post(listOf(PostDto.Reaction("👍", "u2"), PostDto.Reaction("👍", "me"), PostDto.Reaction("🔥", "u3")))
        assertEquals(2, model.count("👍", post))
        assertTrue(model.isMine("👍", post))
        assertFalse(model.isMine("🔥", post))
    }

    /** Реакция видна сразу; отказ сервера — откат, иначе человек уверен, что поставил её. */
    @Test
    fun reactionIsOptimisticAndRolledBackOnFailure() = runTest {
        val feed = StubFeed(failReact = true)
        val model = FeedModel(feed, viewerId = "me")
        val post = post(emptyList())
        model.toggleNow("❤️", post)
        assertFalse(model.isMine("❤️", post))
        assertEquals(0, model.count("❤️", post))
        assertTrue(model.failure != null)
    }

    @Test
    fun reactionSucceeds() = runTest {
        val model = FeedModel(StubFeed(), viewerId = "me")
        val post = post(emptyList())
        model.toggleNow("❤️", post)
        assertTrue(model.isMine("❤️", post))
        assertEquals(1, model.count("❤️", post))
    }

    /** Запись на событие оптимистична и откатывается при отказе. */
    @Test
    fun eventRegistrationRollsBack() = runTest {
        val model = EventsModel(StubFeed(failRegister = true))
        model.refresh()
        model.toggleNow("e1")
        assertFalse(model.isRegistered("e1"))
    }

    /** В PATCH уходит только изменённое; отказ — откат к прежним настройкам. */
    @Test
    fun settingsSendDiffAndRollBack() = runTest {
        val feed = StubFeed()
        val model = NotificationsModel(feed)
        val before = NotificationSettingsDto(pushEnabled = false, emailEnabled = true, messageEnabled = true)
        model.updateNow(before, before.copy(pushEnabled = true))
        assertEquals(NotificationSettingsDto(pushEnabled = true), feed.sentSettings)

        val failing = NotificationsModel(StubFeed(failSettings = true))
        failing.updateNow(before, before.copy(emailEnabled = false))
        assertEquals(before, failing.settings)
    }

    private class StubFeed(
        private val failReact: Boolean = false,
        private val failRegister: Boolean = false,
        private val failSettings: Boolean = false,
    ) : FeedFetching {
        var sentSettings: NotificationSettingsDto? = null
        private val offline get() = ApiError.Transport(IOException("offline"))

        override suspend fun posts(cursor: String?) = Page(emptyList<PostDto>(), null)
        override suspend fun postMediaUrl(postId: String, fileId: String) = "https://x"
        override suspend fun comments(postId: String) = emptyList<PostCommentDto>()
        override suspend fun comment(postId: String, text: String) = PostCommentDto("c", text, T)
        override suspend fun react(postId: String, emoji: String, on: Boolean) {
            if (failReact) throw offline
        }
        override suspend fun events(mine: Boolean) = listOf(EventDto("e1", "Событие", startsAt = T, isRegistered = false))
        override suspend fun register(eventId: String, on: Boolean) {
            if (failRegister) throw offline
        }
        override suspend fun notifications(cursor: String?) = Page(emptyList<NotificationDto>(), null)
        override suspend fun markRead(notificationId: String) {}
        override suspend fun markAllRead() {}
        override suspend fun notificationSettings() = NotificationSettingsDto()
        override suspend fun updateNotificationSettings(settings: NotificationSettingsDto): NotificationSettingsDto {
            if (failSettings) throw offline
            sentSettings = settings
            return settings
        }
        override suspend fun me() = UserProfileDto("me")
        override suspend fun user(id: String) = UserProfileDto(id)
        override suspend fun updateProfile(firstName: String, lastName: String, bio: String?) = UserProfileDto("me", firstName, lastName)
        override suspend fun uploadAvatar(file: File, mime: String) = UserProfileDto("me")
    }
}
