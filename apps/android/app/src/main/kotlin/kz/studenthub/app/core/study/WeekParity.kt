package kz.studenthub.app.core.study

import java.time.LocalDate
import java.time.temporal.ChronoUnit
import kotlin.math.roundToLong

/**
 * Чётность учебной недели.
 *
 * Считается ровно так же, как в вебе (`apps/web/src/shared/lib/tz-date.ts`,
 * `isoWeekParity`) и в iOS — разойдись правило на неделю, и у человека в приложении и
 * в браузере окажутся разные пары.
 *
 * ВАЖНО. Формула веба не совпадает с ISO 8601: в ней опущена поправка на день недели
 * 4 января, и в годах, где 4 января не четверг, номер на единицу меньше стандартного —
 * в 2026-м расхождение сплошное. Воспроизведено намеренно. Чинить надо во всех трёх
 * местах разом и только после того, как вуз подтвердит, какие недели нечётные.
 */
enum class WeekParity(val raw: String) {
    ODD("ODD"),
    EVEN("EVEN"),
    ;

    /** Идёт ли пара на этой неделе. `BOTH` — каждую. */
    fun includes(weekType: String): Boolean = weekType == "BOTH" || weekType == raw

    fun toggled(): WeekParity = if (this == ODD) EVEN else ODD

    companion object {
        fun of(date: LocalDate): WeekParity = if (weekNumber(date) % 2 == 1L) ODD else EVEN

        /** Номер недели по формуле веба: местная дата, четверг той же недели, отсчёт от 4 января. */
        fun weekNumber(date: LocalDate): Long {
            val mondayBased = date.dayOfWeek.value - 1
            val thursday = date.minusDays(mondayBased.toLong()).plusDays(3)
            val firstThursday = LocalDate.of(thursday.year, 1, 4)
            val days = ChronoUnit.DAYS.between(firstThursday, thursday)
            // JS Math.round: половины округляет вверх; у (k − 3) / 7 их не бывает.
            return 1 + ((days - 3) / 7.0).roundToLong()
        }
    }
}
