package kz.studenthub.app.features.chats

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * Время в строке списка: сегодня — часы и минуты, на этой неделе — день, дальше — дата.
 * Как в вебе и в iOS: длинная дата в строке не читается.
 */
object ChatMoment {
    fun short(moment: Instant, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault(), locale: Locale = Locale.getDefault()): String {
        val date = moment.atZone(zone)
        val today = now.atZone(zone).toLocalDate()
        return when {
            date.toLocalDate() == today -> date.format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale))
            date.toLocalDate().isAfter(today.minusDays(7)) -> date.format(DateTimeFormatter.ofPattern("EEE", locale))
            else -> date.format(DateTimeFormatter.ofPattern("d MMM", locale))
        }
    }

    /** Время сообщения в пузыре. */
    fun time(moment: Instant, zone: ZoneId = ZoneId.systemDefault(), locale: Locale = Locale.getDefault()): String =
        moment.atZone(zone).format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale))

    /** Подпись разделителя дня: «Сегодня», «Вчера», иначе число и месяц. */
    fun day(day: LocalDate, today: LocalDate, locale: Locale = Locale.getDefault()): DayLabel = when (day) {
        today -> DayLabel.Today
        today.minusDays(1) -> DayLabel.Yesterday
        else -> DayLabel.Date(day.format(DateTimeFormatter.ofPattern("d MMMM", locale)))
    }

    sealed interface DayLabel {
        data object Today : DayLabel

        data object Yesterday : DayLabel

        data class Date(val text: String) : DayLabel
    }
}
