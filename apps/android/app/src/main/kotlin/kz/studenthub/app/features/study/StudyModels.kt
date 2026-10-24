package kz.studenthub.app.features.study

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.edit
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kz.studenthub.app.R
import kz.studenthub.app.core.network.displayMessage
import kz.studenthub.app.core.storage.AppDatabase
import kz.studenthub.app.core.storage.PairChangeEntity
import kz.studenthub.app.core.storage.PairEntity
import kz.studenthub.app.core.study.AssignmentDto
import kz.studenthub.app.core.study.AttendanceEntry
import kz.studenthub.app.core.study.RosterDto
import kz.studenthub.app.core.study.ScheduleFetching
import kz.studenthub.app.core.study.ScheduleStore
import kz.studenthub.app.core.study.StudyFetching
import kz.studenthub.app.core.study.WeekParity
import kz.studenthub.app.core.ui.UiText
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

/** Пара вместе с разовым изменением, если оно есть. */
data class SchedulePair(val pair: PairEntity, val change: PairChangeEntity?) {
    val id: String get() = pair.id
    val isCancelled: Boolean get() = change?.type == "CANCELLED"
    val startTime: String get() = change?.newStartTime ?: pair.startTime
    val endTime: String get() = change?.newEndTime ?: pair.endTime

    /** Чем пара отличается от обычной: перенос, замена, другая аудитория. */
    val changeNote: UiText?
        get() {
            val change = change ?: return null
            change.note?.takeIf { it.isNotEmpty() }?.let { return UiText.Raw(it) }
            return when (change.type) {
                "CANCELLED" -> UiText.Res(R.string.schedule_cancelled)
                "MOVED" -> UiText.Res(R.string.schedule_moved)
                "ROOM_CHANGED" -> UiText.Res(R.string.schedule_roomChanged)
                "SUBSTITUTED" -> UiText.Res(R.string.schedule_substituted)
                else -> null
            }
        }
}

/**
 * Расписание на экране. Читает базу, как и чаты: расписание смотрят в коридоре и в
 * метро, где связи нет, и экран со спиннером в этот момент бесполезен.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ScheduleModel(
    private val db: AppDatabase,
    private val api: ScheduleFetching,
    private val prefs: android.content.SharedPreferences?,
    private val clock: Clock = Clock.systemDefaultZone(),
    private val store: ScheduleStore = ScheduleStore(db),
) : ViewModel() {
    private val zone: ZoneId get() = clock.zone
    private val today: LocalDate get() = LocalDate.now(clock)

    /** День недели, выбранный человеком (1 — понедельник). */
    private val _day = MutableStateFlow(today.dayOfWeek.value)
    val day: StateFlow<Int> = _day

    private val _parity = MutableStateFlow(WeekParity.of(today))
    val parity: StateFlow<WeekParity> = _parity

    /** Пары выбранного дня с учётом чётности и разовых изменений. */
    val pairs: StateFlow<List<SchedulePair>?> = _day.flatMapLatest { day ->
        val date = dateOf(day)
        val from = date.atStartOfDay(zone).toInstant()
        val to = date.plusDays(1).atStartOfDay(zone).toInstant()
        combine(db.schedule().observeDay(day), db.schedule().observeChanges(from, to), _parity) { pairs, changes, parity ->
            val byPair = changes.associateBy { it.pairId }
            pairs.filter { parity.includes(it.weekType) }
                .map { SchedulePair(it, byPair[it.id]) }
                .sortedBy { it.startTime }
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    var isRefreshing by mutableStateOf(false)
        private set
    var failure by mutableStateOf<UiText?>(null)
        private set

    /** Когда последний раз удалось обновиться: «расписание от вторника» честнее молчания. */
    var syncedAt by mutableStateOf(prefs?.getLong(SYNCED_KEY, 0L)?.takeIf { it > 0 }?.let(Instant::ofEpochMilli))
        private set

    fun select(day: Int) {
        _day.value = day
    }

    /** Чётность вручную: «следующую неделю» смотрят чаще, чем кажется. */
    fun toggleParity() {
        _parity.value = _parity.value.toggled()
    }

    fun refreshNow() {
        viewModelScope.launch { refresh() }
    }

    suspend fun refresh() {
        if (isRefreshing) return
        isRefreshing = true
        try {
            store.save(api.schedule())
            val from = today.atStartOfDay(zone).toInstant()
            val to = today.plusDays(14).atStartOfDay(zone).toInstant()
            store.saveChanges(api.changes(from, to), from)
            val now = clock.instant()
            syncedAt = now
            prefs?.edit { putLong(SYNCED_KEY, now.toEpochMilli()) }
            failure = null
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            // Сеть недоступна — экран остаётся рабочим: он читает базу.
            failure = error.displayMessage()
        } finally {
            isRefreshing = false
        }
    }

    /** Дата выбранного дня внутри текущей недели — по ней ищутся разовые изменения. */
    private fun dateOf(day: Int): LocalDate = today.plusDays((day - today.dayOfWeek.value).toLong())

    companion object {
        private const val SYNCED_KEY = "schedule.synced-at"

        fun prefs(context: Context) = context.getSharedPreferences("schedule", Context.MODE_PRIVATE)
    }
}

/**
 * Общий скелет экранов «Учёбы»: сходить в сеть, показать данные, показать отказ. Один
 * тип вместо четырёх почти одинаковых — меньше мест, где загрузка обработана по-разному.
 */
class SectionModel<T>(private val load: suspend () -> T) : ViewModel() {
    var value by mutableStateOf<T?>(null)
        private set
    var isLoading by mutableStateOf(false)
        private set
    var failure by mutableStateOf<UiText?>(null)
        private set

    fun refreshNow() {
        viewModelScope.launch { refresh() }
    }

    suspend fun refresh() {
        if (isLoading) return
        isLoading = true
        try {
            value = load()
            failure = null
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            // Данные с прошлого раза не стираем: вчерашние оценки с пометкой об ошибке
            // лучше пустого экрана.
            failure = error.displayMessage()
        } finally {
            isLoading = false
        }
    }
}

/**
 * Отметка посещаемости преподавателем. Здесь человек меняет данные, и у экрана есть
 * несохранённое состояние, которое нельзя потерять при обновлении.
 */
class AttendanceMarkingModel(
    private val pairId: String,
    private val api: StudyFetching,
    private val date: LocalDate = LocalDate.now(),
) : ViewModel() {
    var students by mutableStateOf<List<RosterDto.Student>>(emptyList())
        private set
    val statuses = mutableStateMapOf<String, String>()
    var isLoading by mutableStateOf(false)
        private set
    var isSaving by mutableStateOf(false)
        private set
    var failure by mutableStateOf<UiText?>(null)
        private set
    var saved by mutableStateOf(false)
        private set

    suspend fun load() {
        isLoading = true
        try {
            val roster = api.roster(pairId, date)
            students = roster.students
            // Уже проставленные отметки подставляем: чаще правят одну-две, чем всю группу.
            statuses.clear()
            roster.students.forEach { student -> student.status?.let { statuses[student.id] = it } }
            failure = null
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            failure = error.displayMessage()
        } finally {
            isLoading = false
        }
    }

    fun set(status: String, studentId: String) {
        statuses[studentId] = status
        saved = false
    }

    /** Самый частый случай — пришли все, кроме двоих: сначала всех, потом исключения. */
    fun markAllPresent() {
        students.forEach { statuses[it.id] = "PRESENT" }
        saved = false
    }

    fun saveNow() {
        viewModelScope.launch { save() }
    }

    suspend fun save() {
        if (isSaving || statuses.isEmpty()) return
        isSaving = true
        try {
            api.mark(pairId, date, statuses.map { (id, status) -> AttendanceEntry(id, status) })
            saved = true
            failure = null
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            failure = error.displayMessage()
        } finally {
            isSaving = false
        }
    }
}

/** Состояние сдачи работы — то, что видит студент на карточке задания. */
sealed interface SubmissionState {
    data object NotSubmitted : SubmissionState

    data object Submitted : SubmissionState

    data class Graded(val score: Int, val max: Int?) : SubmissionState

    data object Returned : SubmissionState

    val title: UiText
        get() = when (this) {
            NotSubmitted -> UiText.Res(R.string.study_notSubmitted)
            Submitted -> UiText.Res(R.string.study_submitted)
            is Graded -> UiText.Res(R.string.study_graded, listOf(score.toString(), max?.let { " / $it" }.orEmpty()))
            Returned -> UiText.Res(R.string.study_returned)
        }

    companion object {
        fun of(assignment: AssignmentDto): SubmissionState {
            val submission = assignment.mySubmission ?: return NotSubmitted
            val score = submission.score
            if (score != null && submission.status == "GRADED") return Graded(score, assignment.maxScore)
            return when (submission.status) {
                "RETURNED" -> Returned
                "SUBMITTED" -> Submitted
                else -> NotSubmitted
            }
        }
    }
}

/** Как показать точку журнала: балл бывает дробным, тип — кодом из `GRADE_COLUMN_KINDS`. */
object GradeFormat {
    /** «8,5 / 10» или «8,5», если у точки нет максимума. Дробь не обрезаем: 8,5 — не 8. */
    fun score(score: Double, max: Int?, locale: Locale): String {
        val shown = DecimalFormat("0.##", DecimalFormatSymbols.getInstance(locale)).format(score)
        return if (max == null) shown else "$shown / $max"
    }

    /** Название типа точки — как в вебе (`Gradebook.kind_*`). Незнакомый тип — без подписи. */
    fun kindTitle(kind: String): Int? = when (kind) {
        "LAB" -> R.string.study_kindLab
        "CONTROL" -> R.string.study_kindControl
        "EXAM" -> R.string.study_kindExam
        "OTHER" -> R.string.study_kindOther
        else -> null
    }
}

/** Сдача работы: сначала черновик, потом отправка — на сервере это два шага. */
class SubmissionModel(private val assignmentId: String, private val api: StudyFetching) : ViewModel() {
    var text by mutableStateOf("")
    var link by mutableStateOf("")
    var isSending by mutableStateOf(false)
        private set
    var failure by mutableStateOf<UiText?>(null)
        private set
    private var prefilled = false

    /** Поля — из уже сохранённой сдачи, один раз: набранное не затирается обновлением. */
    fun prefill(assignment: AssignmentDto) {
        if (prefilled) return
        prefilled = true
        text = assignment.mySubmission?.text.orEmpty()
        link = assignment.mySubmission?.linkUrl.orEmpty()
    }

    suspend fun submit(): Boolean {
        if (isSending) return false
        isSending = true
        return try {
            api.saveSubmissionDraft(assignmentId, text.ifEmpty { null }, link.ifEmpty { null })
            api.submit(assignmentId)
            failure = null
            true
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            failure = error.displayMessage()
            false
        } finally {
            isSending = false
        }
    }
}
