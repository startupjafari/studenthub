package kz.studenthub.app.core.feed

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kz.studenthub.app.core.network.InstantSerializer
import java.time.Instant

/*
 * Контракты ленты, событий, уведомлений и профиля — по сервису, а не по догадке
 * (posts.service.ts, events.service.ts, notifications.service.ts, users.service.ts).
 * Сверено 15.10.2026: у медиа поста нет `url` (ссылка запрашивается отдельно), реакции
 * приходят списком «кто что поставил», счётчик комментариев — в `_count`.
 */

@Serializable
data class PersonDto(
    val id: String,
    val firstName: String? = null,
    val lastName: String? = null,
    val avatarUrl: String? = null,
    val role: String? = null,
) {
    val name: String get() = listOfNotNull(lastName, firstName).filter { it.isNotEmpty() }.joinToString(" ")
}

@Serializable
data class PostDto(
    val id: String,
    val title: String? = null,
    val content: String? = null,
    @Serializable(InstantSerializer::class) val createdAt: Instant,
    @Serializable(InstantSerializer::class) val pinnedAt: Instant? = null,
    val author: PersonDto? = null,
    /** Файлы поста: только id и тип; ссылку выдаёт `GET /posts/:id/media/:fileId/url`. */
    val media: List<Media> = emptyList(),
    /** Одна строка на поставленную реакцию: эмодзи и кто её поставил. */
    val reactions: List<Reaction> = emptyList(),
    @SerialName("_count") val count: Count? = null,
    val bookmarked: Boolean? = null,
) {
    @Serializable
    data class Media(val id: String, val mime: String? = null)

    @Serializable
    data class Reaction(val emoji: String, val userId: String)

    @Serializable
    data class Count(val comments: Int = 0)

    val commentsCount: Int get() = count?.comments ?: 0
}

@Serializable
data class PostCommentDto(
    val id: String,
    val content: String,
    @Serializable(InstantSerializer::class) val createdAt: Instant,
    val author: PersonDto? = null,
    val parentId: String? = null,
)

@Serializable
data class EventDto(
    val id: String,
    val title: String,
    val description: String? = null,
    @Serializable(InstantSerializer::class) val startsAt: Instant,
    @Serializable(InstantSerializer::class) val endsAt: Instant? = null,
    val location: String? = null,
    val isOnline: Boolean? = null,
    val isRegistered: Boolean? = null,
    val organizer: PersonDto? = null,
    @SerialName("_count") val count: Count? = null,
) {
    @Serializable
    data class Count(val participants: Int = 0)
}

@Serializable
data class NotificationDto(
    val id: String,
    val type: String,
    val title: String,
    val body: String,
    val isRead: Boolean,
    @Serializable(InstantSerializer::class) val createdAt: Instant,
    /** Куда ведёт уведомление: url, chatId, postId, applicationId — что положил сервер. */
    val data: JsonObject? = null,
) {
    /** Ссылка перехода: `url`, если он есть, иначе собирается из идентификаторов. */
    val link: String?
        get() {
            fun field(name: String) = (data?.get(name) as? JsonPrimitive)?.contentOrNull
            return field("url")
                ?: field("chatId")?.let { "/chats?c=$it" }
                ?: field("postId")?.let { "/posts/$it" }
                ?: field("applicationId")?.let { "/applications/$it" }
                ?: field("eventId")?.let { "/events/$it" }
        }
}

/**
 * Каналы и типы уведомлений. Имена — как на сервере (`notifications.service.ts`); тело
 * PATCH строгое, и чужое имя поля сервер отвергает целиком.
 */
@Serializable
data class NotificationSettingsDto(
    val pushEnabled: Boolean? = null,
    val emailEnabled: Boolean? = null,
    val messageEnabled: Boolean? = null,
    val scheduleChangeEnabled: Boolean? = null,
    val postEnabled: Boolean? = null,
    val eventEnabled: Boolean? = null,
    val appUpdateEnabled: Boolean? = null,
    val systemEnabled: Boolean? = null,
)

/** Профиль. Названия группы и факультета сервер не отдаёт — только их id. */
@Serializable
data class UserProfileDto(
    val id: String,
    val firstName: String? = null,
    val lastName: String? = null,
    val middleName: String? = null,
    val email: String? = null,
    val username: String? = null,
    val avatarUrl: String? = null,
    val avatarThumbUrl: String? = null,
    val bio: String? = null,
    val headline: String? = null,
    val role: String? = null,
    val course: Int? = null,
    val position: String? = null,
    val department: String? = null,
    /** `full` или `limited`: у ограниченного профиля большинство полей пустые. */
    val access: String? = null,
) {
    val name: String get() = listOfNotNull(lastName, firstName, middleName).filter { it.isNotEmpty() }.joinToString(" ")
}
