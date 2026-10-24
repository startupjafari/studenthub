package kz.studenthub.app.core.study

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kz.studenthub.app.core.network.ApiClient
import kz.studenthub.app.core.network.Endpoint
import kz.studenthub.app.core.network.HttpMethod
import java.time.LocalDate

interface ScheduleFetching {
    suspend fun schedule(): ScheduleDto

    /** Изменения с дня `from` по день `to` включительно — календарные дни вуза. */
    suspend fun changes(from: LocalDate, to: LocalDate): List<ScheduleChangeDto>
}

interface StudyFetching {
    suspend fun grades(): List<CourseGradesDto>

    suspend fun attendance(): AttendanceSummaryDto

    suspend fun assignments(): List<AssignmentDto>

    suspend fun submit(assignmentId: String)

    suspend fun saveSubmissionDraft(assignmentId: String, text: String?, linkUrl: String?)

    suspend fun materials(): List<MaterialDto>

    suspend fun materialFileUrl(materialId: String, fileId: String): String

    suspend fun roster(pairId: String, date: LocalDate): RosterDto

    suspend fun mark(pairId: String, date: LocalDate, entries: List<AttendanceEntry>)
}

/**
 * Маршруты «Учёбы». Scope подставляет сервер по роли: студент видит свою группу,
 * преподаватель — свои пары, и просить об этом не нужно.
 */
class StudyApi(private val client: ApiClient) : ScheduleFetching, StudyFetching {
    override suspend fun schedule(): ScheduleDto = client.send(Endpoint.get("schedule"), ScheduleDto.serializer())

    /**
     * Период — датами `YYYY-MM-DD`, как требует `ScheduleChangeQuerySchema`. Метка времени
     * получала `422` на каждом обновлении, и разовые изменения на телефоне не
     * показывались вовсе (BUG-073).
     */
    override suspend fun changes(from: LocalDate, to: LocalDate): List<ScheduleChangeDto> =
        client.send(
            Endpoint.get("schedule/changes", "from" to from.toString(), "to" to to.toString()),
            ListSerializer(ScheduleChangeDto.serializer()),
        )

    override suspend fun grades(): List<CourseGradesDto> =
        client.send(Endpoint.get("gradebook/me"), ListSerializer(CourseGradesDto.serializer()))

    override suspend fun attendance(): AttendanceSummaryDto = client.send(Endpoint.get("attendance/me"), AttendanceSummaryDto.serializer())

    override suspend fun assignments(): List<AssignmentDto> =
        client.page(Endpoint.get("assignments", "limit" to "50"), AssignmentDto.serializer()).items

    override suspend fun submit(assignmentId: String) {
        client.send(Endpoint.post("assignments/$assignmentId/submit"))
    }

    override suspend fun saveSubmissionDraft(assignmentId: String, text: String?, linkUrl: String?) {
        client.send(Endpoint.json(HttpMethod.PUT, "assignments/$assignmentId/submission", DraftBody.serializer(), DraftBody(text, linkUrl)))
    }

    override suspend fun materials(): List<MaterialDto> =
        client.page(Endpoint.get("materials", "limit" to "50"), MaterialDto.serializer()).items

    override suspend fun materialFileUrl(materialId: String, fileId: String): String =
        client.send(Endpoint.get("materials/$materialId/files/$fileId/presigned"), FileUrl.serializer()).url

    override suspend fun roster(pairId: String, date: LocalDate): RosterDto =
        client.send(Endpoint.get("attendance/roster", "pairId" to pairId, "date" to date.toString()), RosterDto.serializer())

    /**
     * Дата занятия — «ГГГГ-ММ-ДД» в местном дне, а не в UTC: занятие в 9 утра в Алматы
     * не должно оказаться вчерашним.
     */
    override suspend fun mark(pairId: String, date: LocalDate, entries: List<AttendanceEntry>) {
        client.send(Endpoint.json(HttpMethod.PUT, "attendance", MarkBody.serializer(), MarkBody(pairId, date.toString(), entries)))
    }

    @Serializable
    private data class DraftBody(val text: String?, val linkUrl: String?)

    @Serializable
    private data class MarkBody(val pairId: String, val date: String, val entries: List<AttendanceEntry>)

    @Serializable
    private data class FileUrl(val url: String)
}
