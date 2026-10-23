package kz.studenthub.app.features

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.test.runTest
import kz.studenthub.app.core.storage.PairChangeEntity
import kz.studenthub.app.core.storage.PairEntity
import kz.studenthub.app.core.study.AssignmentDto
import kz.studenthub.app.core.study.AttendanceEntry
import kz.studenthub.app.core.study.AttendanceSummaryDto
import kz.studenthub.app.core.study.CourseGradesDto
import kz.studenthub.app.core.study.MaterialDto
import kz.studenthub.app.core.study.PairDto
import kz.studenthub.app.core.study.RosterDto
import kz.studenthub.app.core.study.ScheduleChangeDto
import kz.studenthub.app.core.study.ScheduleDto
import kz.studenthub.app.core.study.ScheduleFetching
import kz.studenthub.app.core.study.ScheduleStore
import kz.studenthub.app.core.study.StudyFetching
import kz.studenthub.app.core.study.WeekParity
import kz.studenthub.app.features.study.AttendanceMarkingModel
import kz.studenthub.app.features.study.ScheduleModel
import kz.studenthub.app.features.study.SchedulePair
import kz.studenthub.app.features.study.SubmissionState
import kz.studenthub.app.support.testDatabase
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

class WeekParityTest {
    /**
     * Чётность обязана совпадать с вебом и iOS день в день. Значения — по ISO 8601, те же,
     * что в тесте веба (`tz-date.test.ts`).
     */
    @Test
    fun parityMatchesIsoWeek() {
        listOf(
            Triple(LocalDate.of(2026, 10, 23), WeekParity.ODD, 43L),
            Triple(LocalDate.of(2026, 10, 26), WeekParity.EVEN, 44L),
            Triple(LocalDate.of(2026, 1, 5), WeekParity.EVEN, 2L),
            Triple(LocalDate.of(2026, 1, 12), WeekParity.ODD, 3L),
            Triple(LocalDate.of(2026, 10, 7), WeekParity.ODD, 41L),
            Triple(LocalDate.of(2024, 1, 4), WeekParity.ODD, 1L),
            // Конец декабря — уже 1-я неделя следующего года, начало января — ещё 53-я.
            Triple(LocalDate.of(2025, 12, 29), WeekParity.ODD, 1L),
            Triple(LocalDate.of(2027, 1, 3), WeekParity.ODD, 53L),
        ).forEach { (date, parity, week) ->
            assertEquals("неделя для $date", week, WeekParity.weekNumber(date))
            assertEquals("чётность для $date", parity, WeekParity.of(date))
        }
    }

    @Test
    fun bothRunsEveryWeek() {
        assertTrue(WeekParity.ODD.includes("BOTH"))
        assertTrue(WeekParity.EVEN.includes("BOTH"))
        assertTrue(WeekParity.ODD.includes("ODD"))
        assertFalse(WeekParity.ODD.includes("EVEN"))
    }
}

class ScheduleTest {
    private val db = testDatabase()
    private val store = ScheduleStore(db)

    @After
    fun close() = db.close()

    private fun pair(id: String, day: Int = 2, start: String = "10:00", weekType: String = "BOTH") = PairDto(
        id = id, scheduleId = "s-1", groupId = "g-1", subject = "Алгоритмы $id", dayOfWeek = day, startTime = start,
        endTime = "11:30", weekType = weekType, teacher = PairDto.Person("t-1", "Руслан", "Ахметов"), room = PairDto.Room("r-1", "312"),
    )

    /** Расписание заменяется целиком: убранная пара обязана исчезнуть. */
    @Test
    fun scheduleIsReplacedWholesale() = runTest {
        store.save(ScheduleDto("Asia/Almaty", listOf(pair("p-1"), pair("p-2"))))
        store.save(ScheduleDto("Asia/Almaty", listOf(pair("p-2"))))
        assertEquals(listOf("p-2"), db.schedule().allPairs().map { it.id })
    }

    /** Имя преподавателя склеивается один раз при записи. */
    @Test
    fun teacherNameIsStoredReady() = runTest {
        store.save(ScheduleDto(null, listOf(pair("p-1"))))
        assertEquals("Ахметов Руслан", db.schedule().allPairs().single().teacherName)
    }

    /** Старые изменения чистятся: перенос недельной давности никому не нужен. */
    @Test
    fun oldChangesAreDropped() = runTest {
        val now = Instant.parse("2026-10-06T00:00:00Z")
        val old = now.minusSeconds(10 * 86_400)
        store.saveChanges(listOf(ScheduleChangeDto("c-old", "p-1", "CANCELLED", old)), old)
        store.saveChanges(listOf(ScheduleChangeDto("c-new", "p-1", "CANCELLED", now)), now)
        val changes = db.schedule().observeChanges(old.minusSeconds(1), now.plusSeconds(1)).first()
        assertEquals(listOf("c-new"), changes.map { it.id })
    }

    /** Перенос показывает новое время: иначе человек приходит к прежнему началу. */
    @Test
    fun movedPairShowsNewTime() {
        val item = SchedulePair(
            PairEntity("p-1", "Алгоритмы", 2, "10:00", "11:30", "BOTH", null, null, null),
            PairChangeEntity("c-1", "p-1", "MOVED", Instant.now(), "14:00", "15:30", null),
        )
        assertEquals("14:00", item.startTime)
        assertEquals("15:30", item.endTime)
        assertFalse(item.isCancelled)
    }

    /**
     * Экран расписания: пары дня с учётом чётности, отменённая — с пометкой. Работает
     * без сети: всё из базы.
     */
    @Test
    fun modelShowsPairsOfDayForCurrentParity() = runTest {
        // Вторник 6 октября 2026 — по формуле веба 40-я неделя, чётная.
        val zone = ZoneId.of("Asia/Almaty")
        val clock = Clock.fixed(Instant.parse("2026-10-06T04:00:00Z"), zone)
        store.save(
            ScheduleDto(
                null,
                listOf(
                    pair("both", start = "09:00"),
                    pair("odd", start = "10:00", weekType = "ODD"),
                    pair("even", start = "11:00", weekType = "EVEN"),
                    pair("monday", day = 1),
                ),
            ),
        )
        val dayStart = LocalDate.of(2026, 10, 6).atStartOfDay(zone).toInstant()
        store.saveChanges(listOf(ScheduleChangeDto("c-1", "even", "CANCELLED", dayStart.plusSeconds(3_600))), dayStart)

        val model = ScheduleModel(db, NoNetworkSchedule(), prefs = null, clock = clock)
        val visible = model.pairs.filterNotNull().first { it.isNotEmpty() }
        assertEquals(listOf("both", "even"), visible.map { it.id })
        assertTrue(visible.last().isCancelled)

        model.toggleParity()
        assertEquals(listOf("both", "odd"), model.pairs.filterNotNull().first { list -> list.any { it.id == "odd" } }.map { it.id })
    }

    /** Нет сети — экран остаётся рабочим, ошибка показывается строкой. */
    @Test
    fun offlineRefreshKeepsStoredSchedule() = runTest {
        store.save(ScheduleDto(null, listOf(pair("p-1"))))
        val model = ScheduleModel(db, NoNetworkSchedule(), prefs = null)
        model.refresh()
        assertEquals(1, db.schedule().allPairs().size)
        assertTrue(model.failure != null)
    }

    private class NoNetworkSchedule : ScheduleFetching {
        override suspend fun schedule(): ScheduleDto = throw kz.studenthub.app.core.network.ApiError.Transport(java.io.IOException("offline"))

        override suspend fun changes(from: Instant, to: Instant): List<ScheduleChangeDto> = emptyList()
    }
}

class StudySectionTest {
    private fun column(id: String, max: Int, score: Double?) = CourseGradesDto.Column(id, "КР $id", "TEST", max, score)

    private fun course(columns: List<CourseGradesDto.Column>) = CourseGradesDto("c", CourseGradesDto.Subject("s", "Алгоритмы"), null, columns)

    /** Доля — только по выставленным оценкам: первая контрольная не выглядит провалом. */
    @Test
    fun ratioIgnoresUngradedColumns() {
        val ratio = course(listOf(column("1", 10, 8.0), column("2", 90, null))).ratio!!
        assertEquals(0.8, ratio, 0.001)
    }

    @Test
    fun ratioIsNilWithoutAnyGrade() = assertNull(course(listOf(column("1", 10, null))).ratio)

    @Test
    fun ratioIsNilWhenMaximumIsZero() = assertNull(course(listOf(column("1", 0, 0.0))).ratio)

    private fun assignment(status: String?, score: Int? = null) =
        AssignmentDto("a", "Задание", maxScore = 100, mySubmission = status?.let { AssignmentDto.Submission("s", it, score) })

    @Test
    fun statesFollowServerStatus() {
        assertEquals(SubmissionState.NotSubmitted, SubmissionState.of(assignment(null)))
        assertEquals(SubmissionState.Submitted, SubmissionState.of(assignment("SUBMITTED")))
        assertEquals(SubmissionState.Graded(90, 100), SubmissionState.of(assignment("GRADED", 90)))
        assertEquals(SubmissionState.Returned, SubmissionState.of(assignment("RETURNED")))
    }

    /** Балл без статуса «проверено» — ещё не оценка. */
    @Test
    fun scoreWithoutGradedStatusIsNotAGrade() = assertEquals(SubmissionState.Returned, SubmissionState.of(assignment("RETURNED", 40)))

    /** Уже проставленные отметки подставляются: чаще правят одну-две, чем всю группу. */
    @Test
    fun existingMarksArePrefilled() = runTest {
        val model = AttendanceMarkingModel("p-1", StubStudy())
        model.load()
        assertEquals("ABSENT", model.statuses["u-1"])
        assertNull(model.statuses["u-2"])
    }

    @Test
    fun markAllPresentFillsEveryone() = runTest {
        val model = AttendanceMarkingModel("p-1", StubStudy())
        model.load()
        model.markAllPresent()
        assertEquals(mapOf("u-1" to "PRESENT", "u-2" to "PRESENT"), model.statuses.toMap())
    }

    @Test
    fun saveSendsEveryMark() = runTest {
        val api = StubStudy()
        val model = AttendanceMarkingModel("p-1", api, date = LocalDate.of(2026, 10, 6))
        model.load()
        model.set("LATE", "u-1")
        model.save()
        assertEquals(listOf(AttendanceEntry("u-1", "LATE")), api.marked)
        assertEquals(LocalDate.of(2026, 10, 6), api.markedOn)
        assertTrue(model.saved)
    }

    private class StubStudy : StudyFetching {
        var marked: List<AttendanceEntry> = emptyList()
        var markedOn: LocalDate? = null

        override suspend fun grades() = emptyList<CourseGradesDto>()

        override suspend fun attendance() = AttendanceSummaryDto()

        override suspend fun assignments() = emptyList<AssignmentDto>()

        override suspend fun submit(assignmentId: String) {}

        override suspend fun saveSubmissionDraft(assignmentId: String, text: String?, linkUrl: String?) {}

        override suspend fun materials() = emptyList<MaterialDto>()

        override suspend fun materialFileUrl(materialId: String, fileId: String) = "https://files/x"

        override suspend fun roster(pairId: String, date: LocalDate) = RosterDto(
            listOf(RosterDto.Student("u-1", "Айгерим", "Нурлан", status = "ABSENT"), RosterDto.Student("u-2", "Данияр", "Ким")),
        )

        override suspend fun mark(pairId: String, date: LocalDate, entries: List<AttendanceEntry>) {
            marked = entries
            markedOn = date
        }
    }
}
