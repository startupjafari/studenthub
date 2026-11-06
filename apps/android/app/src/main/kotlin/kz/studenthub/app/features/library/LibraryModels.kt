package kz.studenthub.app.features.library

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kz.studenthub.app.R
import kz.studenthub.app.core.library.BookCardDto
import kz.studenthub.app.core.library.LibraryClearanceDto
import kz.studenthub.app.core.library.LibraryFetching
import kz.studenthub.app.core.library.LoanDto
import kz.studenthub.app.core.library.ReservationDto
import kz.studenthub.app.core.network.ApiError
import kz.studenthub.app.core.network.ApiErrorCode
import kz.studenthub.app.core.network.displayMessage
import kz.studenthub.app.core.ui.UiText
import java.time.Instant
import java.time.LocalDate

/**
 * Отказы библиотеки глазами читателя. Сервер отвечает `409` с полем в `details[0].field`,
 * и текст выбирается по полю, а не берётся из ответа: серверный обращён к библиотекарю
 * («у читателя просрочка»), а здесь говорим с самим студентом — как веб (`reader-errors.ts`).
 */
object LibraryErrors {
    fun field(error: Throwable): String? =
        (error as? ApiError.Server)?.takeIf { it.code == ApiErrorCode.CONFLICT }?.details?.firstOrNull()?.field

    /** Вуз выключил библиотеку: вместо ошибки — отдельный экран. */
    fun isModuleOff(error: Throwable): Boolean = field(error) == "module"

    fun message(error: Throwable): UiText {
        val text = when (field(error)) {
            "status" -> R.string.books_errorStatus
            "overdue" -> R.string.books_errorOverdue
            "reservationLimit" -> R.string.books_errorReservationLimit
            "alreadyReserved" -> R.string.books_errorAlreadyReserved
            "alreadyBorrowed" -> R.string.books_errorAlreadyBorrowed
            "noCopies" -> R.string.books_errorNoCopies
            "closed" -> R.string.books_errorClosed
            "module" -> R.string.books_errorModule
            else -> if ((error as? ApiError)?.code == ApiErrorCode.NOT_FOUND) R.string.books_errorNotFound else null
        }
        return text?.let { UiText.Res(it) } ?: error.displayMessage()
    }
}

/** Ярлык рядом с книгой: текст и тон (цвет выбирает экран). */
data class LibraryBadge(val text: UiText, val tone: Tone) {
    enum class Tone { SUCCESS, INFO, WARNING, DESTRUCTIVE, NEUTRAL }

    companion object {
        /**
         * Наличие. В списке «Все выданы» — предупреждение, на карточке книги — спокойное
         * «Все экземпляры на руках»: там рядом уже кнопка очереди.
         */
        fun availability(availability: BookCardDto.Availability, detailed: Boolean = false): LibraryBadge = when {
            availability.total == 0 -> LibraryBadge(UiText.Res(R.string.books_noCopies), Tone.NEUTRAL)
            availability.available > 0 -> LibraryBadge(
                UiText.Res(R.string.books_availableOf, listOf(availability.available, availability.total)),
                Tone.SUCCESS,
            )
            detailed -> LibraryBadge(UiText.Res(R.string.books_allTaken), Tone.NEUTRAL)
            else -> LibraryBadge(UiText.Res(R.string.books_allOut), Tone.WARNING)
        }

        /** Срок выдачи: «до 5 нояб.», просрочка — красным, закрытые — статусом. */
        fun loan(loan: LoanDto, formatDay: (LocalDate) -> String): LibraryBadge {
            val day = loan.dueDay?.let(formatDay) ?: loan.dueDate
            return when {
                loan.status == "RETURNED" -> LibraryBadge(UiText.Res(R.string.books_loanReturned), Tone.NEUTRAL)
                loan.status == "LOST" && loan.lostSettledAt != null ->
                    LibraryBadge(UiText.Res(R.string.books_loanLostSettled), Tone.NEUTRAL)
                loan.status == "LOST" -> LibraryBadge(UiText.Res(R.string.books_loanLost), Tone.DESTRUCTIVE)
                loan.status == "CANCELLED" -> LibraryBadge(UiText.Res(R.string.books_loanCancelled), Tone.NEUTRAL)
                loan.overdue -> LibraryBadge(UiText.Res(R.string.books_overdueSince, listOf(day)), Tone.DESTRUCTIVE)
                else -> LibraryBadge(UiText.Res(R.string.books_dueUntil, listOf(day)), Tone.INFO)
            }
        }

        /**
         * Долг в справке: книга на руках — срок, утерянная — «Утеряна — долг». В справку
         * сервер кладёт только долги, поэтому утерянная там — долг, даже если сервер ещё не
         * присылает `lostSettledAt`.
         */
        fun debt(debt: LoanDto, formatDay: (LocalDate) -> String): LibraryBadge =
            if (debt.status == "LOST") LibraryBadge(UiText.Res(R.string.books_loanLostDebt), Tone.DESTRUCTIVE) else loan(debt, formatDay)

        /** Бронь: готова до такого-то дня, место в очереди или чем закончилась. */
        fun reservation(reservation: ReservationDto, formatDay: (LocalDate) -> String): LibraryBadge = when (reservation.status) {
            "READY" -> reservation.holdDay?.let {
                LibraryBadge(UiText.Res(R.string.books_resReadyUntil, listOf(formatDay(it))), Tone.SUCCESS)
            } ?: LibraryBadge(UiText.Res(R.string.books_resReady), Tone.SUCCESS)
            "QUEUED" -> reservation.position?.let {
                LibraryBadge(UiText.Res(R.string.books_resQueuePosition, listOf(it)), Tone.INFO)
            } ?: LibraryBadge(UiText.Res(R.string.books_resQueued), Tone.INFO)
            "FULFILLED" -> LibraryBadge(UiText.Res(R.string.books_resFulfilled), Tone.NEUTRAL)
            "EXPIRED" -> LibraryBadge(UiText.Res(R.string.books_resExpired), Tone.NEUTRAL)
            else -> LibraryBadge(UiText.Res(R.string.books_resCancelled), Tone.NEUTRAL)
        }
    }
}

/**
 * Каталог: поиск, раздел, «есть на полке» и подгрузка страниц по прокрутке.
 *
 * Пагинация серверная, offset: страница за страницей, пока не набрали `meta.total`. Любая
 * смена фильтра начинает с первой страницы; ответ, пришедший к уже сменённому фильтру,
 * выбрасывается (`generation`), иначе медленная сеть показала бы книги по старому запросу.
 */
class CatalogModel(private val api: LibraryFetching, private val pageSize: Int = PAGE_SIZE) : ViewModel() {
    var query by mutableStateOf("")
        private set
    var section by mutableStateOf<String?>(null)
        private set
    var onlyAvailable by mutableStateOf(false)
        private set
    var sections by mutableStateOf<List<String>>(emptyList())
        private set
    var books by mutableStateOf<List<BookCardDto>>(emptyList())
        private set
    var total by mutableStateOf(0)
        private set
    var isLoading by mutableStateOf(false)
        private set
    var isLoadingMore by mutableStateOf(false)
        private set
    var failure by mutableStateOf<UiText?>(null)
        private set

    /** Библиотека вуза выключена (`409 module`) — экран показывает это вместо каталога. */
    var isDisabled by mutableStateOf(false)
        private set
    var loaded by mutableStateOf(false)
        private set

    private var page = 1
    private var generation = 0
    private var searchJob: Job? = null
    private var loadJob: Job? = null

    val hasMore: Boolean get() = books.size < total

    val isFiltered: Boolean get() = query.isNotBlank() || section != null || onlyAvailable

    /** Первый показ: разделы для фильтра и первая страница — разом. */
    suspend fun start() {
        coroutineScope {
            launch { loadSections() }
            reload()
        }
    }

    /** Набор в поиске: запрос уходит после паузы, а не на каждую букву. */
    fun type(text: String) {
        query = text
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(DEBOUNCE_MS)
            reload()
        }
    }

    fun pickSection(value: String?) {
        if (value == section) return
        section = value
        reloadNow()
    }

    fun toggleAvailable() {
        onlyAvailable = !onlyAvailable
        reloadNow()
    }

    fun reloadNow() {
        searchJob?.cancel()
        loadJob?.cancel()
        loadJob = viewModelScope.launch { reload() }
    }

    suspend fun reload() {
        val current = ++generation
        isLoading = true
        try {
            val first = api.books(1, pageSize, query.trim().take(MAX_QUERY).ifEmpty { null }, section, onlyAvailable)
            if (current != generation) return
            books = first.items
            total = first.meta?.total ?: first.items.size
            page = 1
            failure = null
            isDisabled = false
            loaded = true
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            if (current != generation) return
            if (LibraryErrors.isModuleOff(error)) isDisabled = true else failure = LibraryErrors.message(error)
        } finally {
            if (current == generation) isLoading = false
        }
    }

    /** Хвост списка показался на экране. */
    fun loadMore() {
        if (!hasMore || isLoading || isLoadingMore) return
        viewModelScope.launch { loadNextPage() }
    }

    /** Следующая страница. Неудача молча: это не повод рисовать ошибку поверх прочитанного. */
    suspend fun loadNextPage() {
        if (!hasMore || isLoading || isLoadingMore) return
        val current = generation
        isLoadingMore = true
        try {
            val next = api.books(page + 1, pageSize, query.trim().take(MAX_QUERY).ifEmpty { null }, section, onlyAvailable)
            if (current != generation) return
            page += 1
            val known = books.mapTo(HashSet()) { it.id }
            books = books + next.items.filter { it.id !in known }
            // Пустая страница при «есть ещё» — каталог сжался, пока листали: дальше не просим.
            total = if (next.items.isEmpty()) books.size else next.meta?.total ?: total
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
        } finally {
            isLoadingMore = false
        }
    }

    private suspend fun loadSections() {
        try {
            sections = api.sections()
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            // Без разделов фильтр просто пуст — каталог работает и так.
        }
    }

    companion object {
        const val PAGE_SIZE = 20
        const val DEBOUNCE_MS = 300L

        /** Схема запроса режет `q` на сотне символов — длиннее сервер отклонит. */
        private const val MAX_QUERY = 100
    }
}

/** Какую книгу открыть: по id из каталога или по коду с QR-наклейки экземпляра. */
sealed interface BookRef {
    data class Id(val id: String) : BookRef

    data class CopyCode(val code: String) : BookRef
}

/** Что можно сделать с книгой прямо сейчас. */
sealed interface BookAction {
    /** Есть свободный экземпляр — бронь сразу готова. `queue` — все на руках, встать в очередь. */
    data class Reserve(val queue: Boolean, val enabled: Boolean) : BookAction

    data class Cancel(val reservationId: String) : BookAction

    /** Книга уже на руках: второй раз брать нечего. */
    data object None : BookAction
}

/**
 * Книга глазами студента: описание, наличие и бронь. Своя бронь и книга на руках видны
 * здесь же — второй раз забронировать то, что уже ждёт, не предлагаем.
 */
class BookModel(private val ref: BookRef, private val api: LibraryFetching) : ViewModel() {
    var book by mutableStateOf<BookCardDto?>(null)
        private set
    var reservations by mutableStateOf<List<ReservationDto>>(emptyList())
        private set
    var loans by mutableStateOf<List<LoanDto>>(emptyList())
        private set
    var isLoading by mutableStateOf(false)
        private set
    var isWorking by mutableStateOf(false)
        private set
    var failure by mutableStateOf<UiText?>(null)
        private set
    var isDisabled by mutableStateOf(false)
        private set

    /** Итог действия для короткого сообщения внизу; экран гасит его, когда показал. */
    var notice by mutableStateOf<UiText?>(null)
        private set

    val mine: ReservationDto? get() = book?.let { b -> reservations.firstOrNull { it.book.id == b.id && it.isActive } }

    val onHands: LoanDto? get() = book?.let { b -> loans.firstOrNull { it.book.id == b.id && it.isOpen } }

    val action: BookAction
        get() {
            val b = book ?: return BookAction.None
            mine?.let { return BookAction.Cancel(it.id) }
            if (onHands != null) return BookAction.None
            return BookAction.Reserve(queue = b.availability.available == 0, enabled = b.availability.total > 0)
        }

    /** Подсказка под кнопкой — та же лестница, что в вебе. */
    val hint: Int?
        get() {
            val b = book ?: return null
            return when {
                mine?.status == "READY" -> R.string.books_readyHint
                mine?.status == "QUEUED" -> R.string.books_queuedHint
                onHands != null -> R.string.books_onHandsHint
                b.availability.total == 0 -> null
                b.availability.available > 0 -> R.string.books_reserveHint
                else -> R.string.books_queueHint
            }
        }

    fun refreshNow() {
        viewModelScope.launch { load() }
    }

    suspend fun load() {
        if (isLoading) return
        isLoading = true
        try {
            coroutineScope {
                // Наклейку разбираем один раз: дальше книга уже известна по id.
                val card = async {
                    val known = book?.id
                    when {
                        known != null -> api.book(known)
                        ref is BookRef.Id -> api.book(ref.id)
                        ref is BookRef.CopyCode -> api.bookByCopyCode(ref.code)
                        else -> error("неизвестная ссылка на книгу")
                    }
                }
                val mineAsync = async { api.myReservations() }
                val loansAsync = async { api.myLoans() }
                book = card.await()
                reservations = mineAsync.await()
                loans = loansAsync.await()
            }
            failure = null
            isDisabled = false
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            if (LibraryErrors.isModuleOff(error)) isDisabled = true else failure = LibraryErrors.message(error)
        } finally {
            isLoading = false
        }
    }

    fun reserveNow() {
        viewModelScope.launch { reserve() }
    }

    suspend fun reserve() {
        val b = book ?: return
        if (isWorking) return
        isWorking = true
        try {
            val created = api.reserve(b.id)
            reservations = listOf(created) + reservations.filter { it.id != created.id }
            notice = UiText.Res(if (created.status == "READY") R.string.books_reservedReady else R.string.books_reservedQueued)
            failure = null
            refreshAvailability(b.id)
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            notice = LibraryErrors.message(error)
        } finally {
            isWorking = false
        }
    }

    fun cancelNow(reservationId: String) {
        viewModelScope.launch { cancel(reservationId) }
    }

    suspend fun cancel(reservationId: String) {
        val b = book ?: return
        if (isWorking) return
        isWorking = true
        try {
            val closed = api.cancelReservation(reservationId)
            reservations = reservations.map { if (it.id == closed.id) closed else it }
            notice = UiText.Res(R.string.books_cancelled)
            refreshAvailability(b.id)
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            notice = LibraryErrors.message(error)
        } finally {
            isWorking = false
        }
    }

    fun noticeShown() {
        notice = null
    }

    /** Наличие после брони или отмены поменялось — перечитываем карточку, молча при отказе. */
    private suspend fun refreshAvailability(id: String) {
        try {
            book = api.book(id)
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
        }
    }
}

/**
 * «Мои книги»: что на руках и до какого срока, брони — готовые и в очереди, история.
 * Выдачу, записанную по ошибке, читатель отмечает «Это не я» — решает библиотекарь.
 */
class MyBooksModel(private val api: LibraryFetching) : ViewModel() {
    var loans by mutableStateOf<List<LoanDto>>(emptyList())
        private set
    var reservations by mutableStateOf<List<ReservationDto>>(emptyList())
        private set
    var isLoading by mutableStateOf(false)
        private set
    var loaded by mutableStateOf(false)
        private set
    var failure by mutableStateOf<UiText?>(null)
        private set
    var isDisabled by mutableStateOf(false)
        private set
    var notice by mutableStateOf<UiText?>(null)
        private set

    /** Запись, по которой идёт запрос: её кнопка показывает загрузку, остальные — нет. */
    var busyId by mutableStateOf<String?>(null)
        private set

    val onHands: List<LoanDto> get() = loans.filter { it.isOpen }

    val history: List<LoanDto> get() = loans.filterNot { it.isOpen }

    /** Действующие брони; порядок сервера — готовые первыми. */
    val activeReservations: List<ReservationDto> get() = reservations.filter { it.isActive }

    /** Просрочка закрывает новые книги и брони — об этом баннер наверху. */
    val overdueCount: Int get() = onHands.count { it.overdue }

    fun refreshNow() {
        viewModelScope.launch { refresh() }
    }

    suspend fun refresh() {
        if (isLoading) return
        isLoading = true
        try {
            coroutineScope {
                val loansAsync = async { api.myLoans() }
                val mineAsync = async { api.myReservations() }
                loans = loansAsync.await()
                reservations = mineAsync.await()
            }
            loaded = true
            failure = null
            isDisabled = false
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            if (LibraryErrors.isModuleOff(error)) isDisabled = true else failure = LibraryErrors.message(error)
        } finally {
            isLoading = false
        }
    }

    fun disputeNow(loanId: String) {
        viewModelScope.launch { dispute(loanId) }
    }

    suspend fun dispute(loanId: String) {
        if (busyId != null) return
        busyId = loanId
        try {
            val updated = api.dispute(loanId)
            loans = loans.map { if (it.id == updated.id) updated else it }
            notice = UiText.Res(R.string.books_disputedToast)
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            notice = LibraryErrors.message(error)
        } finally {
            busyId = null
        }
    }

    fun cancelNow(reservationId: String) {
        viewModelScope.launch { cancel(reservationId) }
    }

    suspend fun cancel(reservationId: String) {
        if (busyId != null) return
        busyId = reservationId
        try {
            val closed = api.cancelReservation(reservationId)
            reservations = reservations.map { if (it.id == closed.id) closed else it }
            notice = UiText.Res(R.string.books_cancelled)
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            notice = LibraryErrors.message(error)
        } finally {
            busyId = null
        }
    }

    fun noticeShown() {
        notice = null
    }
}

/**
 * Справка «задолженностей нет» глазами экрана. Решение «чисто» принимает сервер, но экран
 * перестраховывается: пришли долги — справки нет, даже если `clear` почему-то `true`.
 */
data class ClearanceSummary(
    val isClear: Boolean,
    val debts: List<LoanDto>,
    /** Утерянные без погашения: их не вернуть — только заменить или возместить. */
    val lostDebts: Int,
    val reader: LibraryClearanceDto.Reader,
    val university: String,
    val checkedAt: Instant,
) {
    companion object {
        fun of(clearance: LibraryClearanceDto, receivedAt: Instant = Instant.now()) = ClearanceSummary(
            isClear = clearance.clear && clearance.loans.isEmpty(),
            debts = clearance.loans,
            // В справке только долги: утерянная здесь — долг и без `lostSettledAt` от сервера.
            lostDebts = clearance.loans.count { it.status == "LOST" && it.lostSettledAt == null },
            reader = clearance.reader,
            university = clearance.university,
            checkedAt = clearance.checkedAt ?: receivedAt,
        )
    }
}

/**
 * Справка для обходного листа: на момент запроса, поэтому перечитывается при каждом
 * открытии экрана и по жесту обновления.
 */
class ClearanceModel(private val api: LibraryFetching) : ViewModel() {
    var summary by mutableStateOf<ClearanceSummary?>(null)
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
            summary = ClearanceSummary.of(api.clearance())
            failure = null
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            // Прошлую справку как свежую не показываем: дата на ней — момент проверки, и
            // человек унёс бы в деканат устаревшее «задолженностей нет».
            summary = null
            failure = LibraryErrors.message(error)
        } finally {
            isLoading = false
        }
    }
}
