package kz.studenthub.app.core.study

import kotlinx.serialization.Serializable
import kz.studenthub.app.core.network.InstantSerializer
import java.time.Instant

/*
 * Контракты раздела «Учёба» (PROJECT.md §8.3). Поля — только те, что показывает
 * приложение: лишнее обязательное поле превращает любое изменение на сервере в падение
 * разбора у тех, кто не обновился.
 */

/** Пара расписания (`GET /schedule`). */
@Serializable
data class PairDto(
    val id: String,
    val scheduleId: String? = null,
    val groupId: String? = null,
    val subject: String,
    /** 1 — понедельник, 7 — воскресенье. */
    val dayOfWeek: Int,
    /** «HH:mm»: сравнима строкой и не зависит от часового пояса телефона. */
    val startTime: String,
    val endTime: String,
    /** `ODD`, `EVEN` или `BOTH`. */
    val weekType: String,
    val teacher: Person? = null,
    val room: Room? = null,
) {
    @Serializable
    data class Person(val id: String, val firstName: String? = null, val lastName: String? = null)

    @Serializable
    data class Room(val id: String, val name: String)
}

@Serializable
data class ScheduleDto(val timezone: String? = null, val pairs: List<PairDto> = emptyList())

/** Разовое изменение: перенос, смена аудитории, отмена, замена. */
@Serializable
data class ScheduleChangeDto(
    val id: String,
    val pairId: String,
    val type: String,
    @Serializable(InstantSerializer::class) val date: Instant,
    val newStartTime: String? = null,
    val newEndTime: String? = null,
    val note: String? = null,
)

@Serializable
data class CourseGradesDto(
    val courseId: String,
    val subject: Subject,
    val credits: Int? = null,
    val columns: List<Column> = emptyList(),
) {
    @Serializable
    data class Subject(val id: String, val name: String)

    @Serializable
    data class Column(val id: String, val title: String, val kind: String, val maxScore: Int, val score: Double? = null)

    /**
     * Доля набранного от максимума по опубликованным точкам. Только там, где оценка
     * стоит: иначе первая контрольная показывала бы «5 из 100» и выглядела провалом.
     */
    val ratio: Double?
        get() {
            val graded = columns.filter { it.score != null }
            if (graded.isEmpty()) return null
            val max = graded.sumOf { it.maxScore.toDouble() }
            if (max <= 0) return null
            return graded.sumOf { it.score ?: 0.0 } / max
        }
}

@Serializable
data class AttendanceSummaryDto(
    val total: Int = 0,
    val present: Int = 0,
    val late: Int = 0,
    val absent: Int = 0,
    val excused: Int = 0,
    /** Доля не-пропусков в целых процентах (0…100): присутствовал, опоздал, уважительная. */
    val rate: Int = 0,
    val records: List<Record> = emptyList(),
) {
    /** Счётчик по статусу: API отдаёт их отдельными полями, а не словарём. */
    fun count(status: String): Int = when (status) {
        "PRESENT" -> present
        "LATE" -> late
        "ABSENT" -> absent
        "EXCUSED" -> excused
        else -> 0
    }

    @Serializable
    data class Record(
        val id: String,
        @Serializable(InstantSerializer::class) val date: Instant,
        val status: String,
        val note: String? = null,
        val pair: Pair? = null,
    )

    @Serializable
    data class Pair(val subject: String? = null, val startTime: String? = null)
}

@Serializable
data class RosterDto(val students: List<Student> = emptyList()) {
    @Serializable
    data class Student(
        val id: String,
        val firstName: String? = null,
        val lastName: String? = null,
        val status: String? = null,
        val note: String? = null,
    ) {
        val name: String get() = listOfNotNull(lastName, firstName).filter { it.isNotEmpty() }.joinToString(" ")
    }
}

@Serializable
data class AssignmentDto(
    val id: String,
    val title: String,
    val description: String? = null,
    @Serializable(InstantSerializer::class) val dueAt: Instant? = null,
    val maxScore: Int? = null,
    val subject: String? = null,
    val mySubmission: Submission? = null,
) {
    @Serializable
    data class Submission(
        val id: String,
        val status: String,
        val score: Int? = null,
        val feedback: String? = null,
        val text: String? = null,
        val linkUrl: String? = null,
        @Serializable(InstantSerializer::class) val submittedAt: Instant? = null,
    )
}

@Serializable
data class MaterialDto(
    val id: String,
    val title: String,
    val description: String? = null,
    val subject: String? = null,
    @Serializable(InstantSerializer::class) val createdAt: Instant? = null,
    val files: List<File>? = null,
) {
    @Serializable
    data class File(val id: String, val name: String? = null, val size: Long? = null, val mime: String? = null)
}

/** Отметка одного студента на занятии. */
@Serializable
data class AttendanceEntry(val studentId: String, val status: String, val note: String? = null)
