package kz.studenthub.app.core.study

import java.time.LocalDate
import java.time.temporal.IsoFields

/**
 * Чётность учебной недели.
 *
 * Считается ровно так же, как в вебе (`apps/web/src/shared/lib/tz-date.ts`,
 * `isoWeekParity`) и в iOS — разойдись правило на неделю, и у человека в приложении и
 * в браузере окажутся разные пары.
 *
 * Номер недели — по ISO 8601. Раньше все клиенты повторяли формулу веба без поправки на
 * день недели 4 января и в таких годах (весь 2026-й) отставали на неделю; исправлено во
 * всех трёх местах разом.
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

        /** Номер ISO-недели местной даты. */
        fun weekNumber(date: LocalDate): Long = date.get(IsoFields.WEEK_OF_WEEK_BASED_YEAR).toLong()
    }
}
