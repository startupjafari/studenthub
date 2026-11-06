package kz.studenthub.app.core.feed

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kz.studenthub.app.core.network.ApiClient
import kz.studenthub.app.core.network.Endpoint
import kz.studenthub.app.core.network.HttpMethod
import kz.studenthub.app.core.network.MultipartForm
import kz.studenthub.app.core.network.Page
import java.io.File
import java.net.URLEncoder

interface FeedFetching {
    suspend fun posts(cursor: String?): Page<PostDto>

    suspend fun postMediaUrl(postId: String, fileId: String): String

    suspend fun comments(postId: String): List<PostCommentDto>

    suspend fun comment(postId: String, text: String): PostCommentDto

    suspend fun react(postId: String, emoji: String, on: Boolean)

    suspend fun events(mine: Boolean): List<EventDto>

    suspend fun register(eventId: String, on: Boolean)

    suspend fun notifications(cursor: String?): Page<NotificationDto>

    suspend fun markRead(notificationId: String)

    suspend fun markAllRead()

    suspend fun notificationSettings(): NotificationSettingsDto

    suspend fun updateNotificationSettings(settings: NotificationSettingsDto): NotificationSettingsDto

    suspend fun me(): UserProfileDto

    suspend fun user(id: String): UserProfileDto

    suspend fun updateProfile(firstName: String, lastName: String, bio: String?): UserProfileDto

    suspend fun uploadAvatar(file: File, mime: String): UserProfileDto
}

class FeedApi(private val client: ApiClient) : FeedFetching {
    override suspend fun posts(cursor: String?): Page<PostDto> =
        client.page(Endpoint.get("posts", "limit" to "20", "cursor" to cursor), PostDto.serializer())

    override suspend fun postMediaUrl(postId: String, fileId: String): String =
        client.send(Endpoint.get("posts/$postId/media/$fileId/url"), Url.serializer()).url

    /** Комментарии — простым массивом, без страниц: сервер отдаёт до двухсот по порядку. */
    override suspend fun comments(postId: String): List<PostCommentDto> =
        client.send(Endpoint.get("posts/$postId/comments"), ListSerializer(PostCommentDto.serializer()))

    override suspend fun comment(postId: String, text: String): PostCommentDto =
        client.send(Endpoint.post("posts/$postId/comments", CommentBody.serializer(), CommentBody(text)), PostCommentDto.serializer())

    /** Реакция ставится и снимается разными маршрутами — так на сервере. Оба отвечают 204. */
    override suspend fun react(postId: String, emoji: String, on: Boolean) {
        if (on) {
            client.send(Endpoint.post("posts/$postId/reactions", ReactionBody.serializer(), ReactionBody(emoji)))
        } else {
            client.send(Endpoint.delete("posts/$postId/reactions/${URLEncoder.encode(emoji, "UTF-8").replace("+", "%20")}"))
        }
    }

    /**
     * События. Фильтр «мои» — параметр `mine`, и только когда он нужен: сервер читает
     * его через `z.coerce.boolean`, и строка `false` для него — правда.
     */
    override suspend fun events(mine: Boolean): List<EventDto> =
        client.page(Endpoint.get("events", "limit" to "50", "mine" to if (mine) "true" else null), EventDto.serializer()).items

    override suspend fun register(eventId: String, on: Boolean) {
        client.send(if (on) Endpoint.post("events/$eventId/register") else Endpoint.delete("events/$eventId/register"))
    }

    override suspend fun notifications(cursor: String?): Page<NotificationDto> =
        client.page(Endpoint.get("notifications", "limit" to "30", "cursor" to cursor), NotificationDto.serializer())

    override suspend fun markRead(notificationId: String) {
        client.send(Endpoint(HttpMethod.PATCH, "notifications/$notificationId/read"))
    }

    override suspend fun markAllRead() {
        client.send(Endpoint(HttpMethod.PATCH, "notifications/read-all"))
    }

    override suspend fun notificationSettings(): NotificationSettingsDto =
        client.send(Endpoint.get("notifications/settings"), NotificationSettingsDto.serializer())

    override suspend fun updateNotificationSettings(settings: NotificationSettingsDto): NotificationSettingsDto =
        client.send(Endpoint.patch("notifications/settings", NotificationSettingsDto.serializer(), settings), NotificationSettingsDto.serializer())

    override suspend fun me(): UserProfileDto = client.send(Endpoint.get("users/me"), UserProfileDto.serializer())

    override suspend fun user(id: String): UserProfileDto = client.send(Endpoint.get("users/$id"), UserProfileDto.serializer())

    override suspend fun updateProfile(firstName: String, lastName: String, bio: String?): UserProfileDto =
        client.send(Endpoint.patch("users/me", ProfileBody.serializer(), ProfileBody(firstName, lastName, bio)), UserProfileDto.serializer())

    /** Аватар — multipart: маршрут принимает файл. Ответ — профиль с новой ссылкой. */
    override suspend fun uploadAvatar(file: File, mime: String): UserProfileDto {
        val form = MultipartForm()
        form.append(file.readBytes(), "file", file.name, mime)
        return client.send(Endpoint.multipart("users/me/avatar", form), UserProfileDto.serializer())
    }

    @Serializable
    private data class Url(val url: String)

    @Serializable
    private data class CommentBody(val content: String)

    @Serializable
    private data class ReactionBody(val emoji: String)

    @Serializable
    private data class ProfileBody(val firstName: String, val lastName: String, val bio: String?)
}
