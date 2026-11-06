package kz.studenthub.app.features.chats

import kz.studenthub.app.core.storage.AttachmentEntity
import kz.studenthub.app.core.storage.MessageEntity
import java.time.Duration
import java.time.LocalDate
import java.time.ZoneId

/**
 * Раскладка переписки на то, что рисует лента. Чистая функция без Compose и без базы:
 * группировка и разделители — самая частая причина «поехавшей» ленты, и проверять их
 * надо тестами, а не глазами.
 */
object MessageTimeline {
    /** Подряд идущие сообщения одного автора склеиваются, пока между ними не больше пяти минут. */
    val groupingWindow: Duration = Duration.ofMinutes(5)

    data class Item(
        val message: MessageEntity,
        val attachments: List<AttachmentEntity>,
        /** Первое в группе — у него имя автора. */
        val isFirstInGroup: Boolean,
        /** Последнее в группе — у него хвостик пузыря и время. */
        val isLastInGroup: Boolean,
        val isOwn: Boolean,
    ) {
        val id: String get() = message.id
    }

    data class Day(val date: LocalDate, val items: List<Item>)

    fun build(
        messages: List<MessageEntity>,
        attachments: Map<String, List<AttachmentEntity>> = emptyMap(),
        viewerId: String,
        zone: ZoneId = ZoneId.systemDefault(),
    ): List<Day> {
        val days = mutableListOf<Day>()
        var currentDay: LocalDate? = null
        var buffer = mutableListOf<Item>()

        fun flush() {
            val day = currentDay ?: return
            if (buffer.isNotEmpty()) days += Day(day, buffer)
            buffer = mutableListOf()
        }

        messages.forEachIndexed { index, message ->
            val day = message.createdAt.atZone(zone).toLocalDate()
            if (day != currentDay) {
                flush()
                currentDay = day
            }
            val previous = messages.getOrNull(index - 1)
            val next = messages.getOrNull(index + 1)
            buffer += Item(
                message = message,
                attachments = attachments[message.id].orEmpty(),
                isFirstInGroup = !continues(previous, message, zone),
                isLastInGroup = !continues(message, next, zone),
                isOwn = message.senderId == viewerId,
            )
        }
        flush()
        return days
    }

    /**
     * Первое непрочитанное — якорь, к которому лента прокручивается при открытии. Считаем
     * от хвоста по счётчику с сервера: он всегда про чужие сообщения.
     */
    fun firstUnreadId(messages: List<MessageEntity>, viewerId: String, unreadCount: Int): String? {
        if (unreadCount <= 0) return null
        val foreign = messages.filter { it.senderId != viewerId && it.deletedAt == null }
        if (foreign.isEmpty()) return null
        return foreign[maxOf(0, foreign.size - unreadCount)].id
    }

    private fun continues(previous: MessageEntity?, next: MessageEntity?, zone: ZoneId): Boolean {
        if (previous == null || next == null) return false
        if (previous.senderId != next.senderId) return false
        // Системные не группируются ни с чем: это не реплика человека.
        if (previous.systemType != null || next.systemType != null) return false
        if (previous.createdAt.atZone(zone).toLocalDate() != next.createdAt.atZone(zone).toLocalDate()) return false
        return Duration.between(previous.createdAt, next.createdAt) <= groupingWindow
    }
}
