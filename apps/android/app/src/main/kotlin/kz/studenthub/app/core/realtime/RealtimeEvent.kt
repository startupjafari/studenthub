package kz.studenthub.app.core.realtime

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kz.studenthub.app.core.chats.ChatListItemDto
import kz.studenthub.app.core.chats.ChatMessageDto
import kz.studenthub.app.core.network.AppJson
import java.time.Instant

/**
 * Событие реального времени (PROJECT.md §9.2) в том виде, в каком его понимает
 * приложение. Разбор сырых данных — здесь, а не в транспорте: остальной код работает
 * с этим типом, и подменить транспорт дублёром в тестах ничего не стоит.
 */
sealed interface RealtimeEvent {
    data object Connected : RealtimeEvent

    data object Disconnected : RealtimeEvent

    /** Сервер не пустил: чаще всего протух токен рукопожатия. */
    data object ConnectFailed : RealtimeEvent

    data class MessageNew(val message: ChatMessageDto) : RealtimeEvent

    data class MessageUpdated(val message: ChatMessageDto) : RealtimeEvent

    data class MessageDeleted(val messageId: String, val chatId: String) : RealtimeEvent

    /** Кто-то прочитал переписку до указанного момента. */
    data class MessageRead(val chatId: String, val userId: String, val readAt: Instant) : RealtimeEvent

    /** Моя собственная отметка — гасит счётчик на всех моих устройствах. */
    data class ChatRead(val chatId: String, val readAt: Instant) : RealtimeEvent

    /** Что человек делает в чате (`TYPING`, `RECORDING_VOICE`, …); `null` — закончил. */
    data class Action(val chatId: String, val userId: String, val action: String?) : RealtimeEvent

    data class Presence(val userId: String, val online: Boolean) : RealtimeEvent

    data class ChatUpdated(val chat: ChatListItemDto) : RealtimeEvent

    /** Из единого конверта `event` приложению пока нужна смена статуса заявки. */
    data class ApplicationStatusChanged(val applicationId: String, val status: String) : RealtimeEvent

    /** Имена событий сервера: опечатка ловится в одном месте, а не по тишине в интерфейсе. */
    object Names {
        const val MESSAGE_NEW = "message:new"
        const val MESSAGE_UPDATED = "message:updated"
        const val MESSAGE_DELETED = "message:deleted"
        const val MESSAGE_READ = "message:read"
        const val CHAT_READ = "chat:read"
        const val CHAT_ACTION = "chat:action"
        const val PRESENCE = "presence:changed"
        const val CHAT_UPDATED = "chat:updated"
        const val ENVELOPE = "event"
        const val APPLICATION_STATUS = "application.status.changed"

        const val JOIN = "chat:join"
        const val LEAVE = "chat:leave"
        const val READ = "message:read"
        const val ACTION = "chat:action"
        const val AUTH_REFRESH = "auth:refresh"

        val incoming = listOf(MESSAGE_NEW, MESSAGE_UPDATED, MESSAGE_DELETED, MESSAGE_READ, CHAT_READ, CHAT_ACTION, PRESENCE, CHAT_UPDATED, ENVELOPE)
    }

    companion object {
        /** Разобрать событие сервера. `null` — чужое или нечитаемое: приложению оно ничего не говорит. */
        fun parse(name: String, json: String): RealtimeEvent? {
            val payload = runCatching { AppJson.parseToJsonElement(json).jsonObject }.getOrNull() ?: return null
            fun text(key: String) = (payload[key] as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull
            fun instant(key: String) = text(key)?.let { runCatching { Instant.parse(it) }.getOrNull() }
            fun message() = payload["message"]?.let {
                runCatching { AppJson.decodeFromJsonElement(ChatMessageDto.serializer(), it) }.getOrNull()
            }

            return when (name) {
                Names.MESSAGE_NEW -> message()?.let(::MessageNew)
                Names.MESSAGE_UPDATED -> message()?.let(::MessageUpdated)
                Names.MESSAGE_DELETED -> {
                    val id = text("messageId") ?: return null
                    MessageDeleted(id, text("chatId") ?: return null)
                }
                Names.MESSAGE_READ -> MessageRead(text("chatId") ?: return null, text("userId") ?: return null, instant("readAt") ?: return null)
                Names.CHAT_READ -> ChatRead(text("chatId") ?: return null, instant("readAt") ?: return null)
                Names.CHAT_ACTION -> Action(text("chatId") ?: return null, text("userId") ?: return null, text("action"))
                Names.PRESENCE -> {
                    val online = (payload["online"] as? kotlinx.serialization.json.JsonPrimitive)?.booleanOrNull ?: return null
                    Presence(text("userId") ?: return null, online)
                }
                Names.CHAT_UPDATED -> payload["chat"]?.let {
                    runCatching { AppJson.decodeFromJsonElement(ChatListItemDto.serializer(), it) }.getOrNull()
                }?.let(::ChatUpdated)
                // Конверт: `{ type, entityId, version, ts, data }`. Только известные типы.
                Names.ENVELOPE -> {
                    if (text("type") != Names.APPLICATION_STATUS) return null
                    val data = payload["data"] as? JsonObject ?: return null
                    val status = data["status"]?.jsonPrimitive?.contentOrNull ?: return null
                    ApplicationStatusChanged(text("entityId") ?: return null, status)
                }
                else -> null
            }
        }
    }
}
