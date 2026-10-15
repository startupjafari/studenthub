package kz.studenthub.app.core.study

import kz.studenthub.app.core.storage.AppDatabase
import kz.studenthub.app.core.storage.PairChangeEntity
import kz.studenthub.app.core.storage.PairEntity
import kz.studenthub.app.core.storage.transaction
import java.time.Instant

/** Расписание в локальной базе. */
class ScheduleStore(private val db: AppDatabase) {
    /**
     * Сохранить расписание целиком. Замена полная, а не слияние: пара, которую убрали,
     * обязана исчезнуть и здесь — иначе человек придёт на отменённое занятие.
     */
    suspend fun save(schedule: ScheduleDto) = db.transaction {
        val dao = db.schedule()
        dao.clearPairs()
        dao.insertPairs(
            schedule.pairs.map {
                PairEntity(
                    id = it.id,
                    subject = it.subject,
                    dayOfWeek = it.dayOfWeek,
                    startTime = it.startTime,
                    endTime = it.endTime,
                    weekType = it.weekType,
                    teacherName = name(it.teacher),
                    roomName = it.room?.name,
                    groupId = it.groupId,
                )
            },
        )
    }

    /** Изменения за период. Старые чистим: перенос недельной давности показывать незачем. */
    suspend fun saveChanges(changes: List<ScheduleChangeDto>, from: Instant) = db.transaction {
        val dao = db.schedule()
        dao.deleteChangesBefore(from)
        dao.insertChanges(changes.map { PairChangeEntity(it.id, it.pairId, it.type, it.date, it.newStartTime, it.newEndTime, it.note) })
    }

    private fun name(person: PairDto.Person?): String? =
        person?.let { listOfNotNull(it.lastName, it.firstName).filter(String::isNotEmpty).joinToString(" ").ifEmpty { null } }
}
