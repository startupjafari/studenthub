package kz.studenthub.app.features

import kotlinx.coroutines.test.runTest
import kz.studenthub.app.R
import kz.studenthub.app.core.library.BookCardDto
import kz.studenthub.app.core.library.BookRefDto
import kz.studenthub.app.core.library.CopyRefDto
import kz.studenthub.app.core.library.LibraryClearanceDto
import kz.studenthub.app.core.library.LibraryApi
import kz.studenthub.app.core.library.LibraryFetching
import kz.studenthub.app.core.library.LibrarySettingsDto
import kz.studenthub.app.core.library.LoanDto
import kz.studenthub.app.core.library.ReservationDto
import kz.studenthub.app.core.network.ApiClient
import kz.studenthub.app.core.network.ApiError
import kz.studenthub.app.core.network.ApiErrorCode
import kz.studenthub.app.core.network.ApiErrorDetail
import kz.studenthub.app.core.network.ApiMeta
import kz.studenthub.app.core.network.Page
import kz.studenthub.app.core.ui.UiText
import kz.studenthub.app.features.library.BookAction
import kz.studenthub.app.features.library.BookModel
import kz.studenthub.app.features.library.BookRef
import kz.studenthub.app.features.library.CatalogModel
import kz.studenthub.app.features.library.ClearanceModel
import kz.studenthub.app.features.library.ClearanceSummary
import kz.studenthub.app.features.library.LibraryBadge
import kz.studenthub.app.features.library.LibraryErrors
import kz.studenthub.app.features.library.MyBooksModel
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDate

private fun book(id: String, total: Int = 2, available: Int = 1) =
    BookCardDto(id = id, title = "Книга $id", availability = BookCardDto.Availability(total = total, available = available))

private fun loan(id: String, bookId: String, status: String = "OPEN", overdue: Boolean = false) = LoanDto(
    id = id,
    status = status,
    issuedAt = Instant.EPOCH,
    dueDate = "2026-11-05",
    overdue = overdue,
    book = BookRefDto(bookId, "Книга $bookId"),
    copy = CopyRefDto("c-$id", "0001"),
)

private fun reservation(id: String, bookId: String, status: String = "QUEUED", position: Int? = 2) = ReservationDto(
    id = id,
    status = status,
    createdAt = Instant.EPOCH,
    position = position,
    book = BookRefDto(bookId, "Книга $bookId"),
)

private fun conflict(field: String) = ApiError.Server(ApiErrorCode.CONFLICT, "серверный текст", listOf(ApiErrorDetail(field, "x")), 409)

class LibraryRulesTest {
    /** Текст отказа выбирается по полю, серверное сообщение (оно для библиотекаря) не показываем. */
    @Test
    fun refusalTextFollowsField() {
        assertEquals(UiText.Res(R.string.books_errorOverdue), LibraryErrors.message(conflict("overdue")))
        assertEquals(UiText.Res(R.string.books_errorReservationLimit), LibraryErrors.message(conflict("reservationLimit")))
        assertEquals(UiText.Res(R.string.books_errorClosed), LibraryErrors.message(conflict("closed")))
        assertEquals(
            UiText.Res(R.string.books_errorNotFound),
            LibraryErrors.message(ApiError.Server(ApiErrorCode.NOT_FOUND, "нет", emptyList(), 404)),
        )
        // Незнакомое поле — как везде: текст по коду ответа, на языке приложения.
        assertEquals(UiText.Res(R.string.error_conflict), LibraryErrors.message(conflict("somethingNew")))
    }

    @Test
    fun moduleOffIsRecognised() {
        assertTrue(LibraryErrors.isModuleOff(conflict("module")))
        assertFalse(LibraryErrors.isModuleOff(conflict("overdue")))
        // То же поле с другим кодом — не выключенный модуль.
        assertFalse(LibraryErrors.isModuleOff(ApiError.Server(ApiErrorCode.FORBIDDEN, "", listOf(ApiErrorDetail("module", "")), 403)))
    }

    @Test
    fun availabilityBadge() {
        assertEquals(UiText.Res(R.string.books_noCopies), LibraryBadge.availability(BookCardDto.Availability()).text)
        val onShelf = LibraryBadge.availability(BookCardDto.Availability(total = 3, available = 2))
        assertEquals(UiText.Res(R.string.books_availableOf, listOf(2, 3)), onShelf.text)
        assertEquals(LibraryBadge.Tone.SUCCESS, onShelf.tone)
        assertEquals(UiText.Res(R.string.books_allOut), LibraryBadge.availability(BookCardDto.Availability(total = 3)).text)
        assertEquals(UiText.Res(R.string.books_allTaken), LibraryBadge.availability(BookCardDto.Availability(total = 3), detailed = true).text)
    }

    /** Срок — день `dueDate` по часам вуза, а не момент `dueAt` в поясе телефона. */
    @Test
    fun loanBadgeUsesDueDate() {
        val format = { day: LocalDate -> day.toString() }
        val due = LibraryBadge.loan(loan("l1", "b1"), format)
        assertEquals(UiText.Res(R.string.books_dueUntil, listOf("2026-11-05")), due.text)
        val overdue = LibraryBadge.loan(loan("l1", "b1", overdue = true), format)
        assertEquals(UiText.Res(R.string.books_overdueSince, listOf("2026-11-05")), overdue.text)
        assertEquals(LibraryBadge.Tone.DESTRUCTIVE, overdue.tone)
        assertEquals(UiText.Res(R.string.books_loanReturned), LibraryBadge.loan(loan("l1", "b1", status = "RETURNED"), format).text)
    }

    /** Утерянная: без погашения — «Утеряна», погашенная — спокойное «долг погашен». */
    @Test
    fun lostLoanBadgeFollowsSettlement() {
        val format = { day: LocalDate -> day.toString() }
        val lost = LibraryBadge.loan(loan("l1", "b1", status = "LOST"), format)
        assertEquals(UiText.Res(R.string.books_loanLost), lost.text)
        assertEquals(LibraryBadge.Tone.DESTRUCTIVE, lost.tone)
        val settled = LibraryBadge.loan(loan("l1", "b1", status = "LOST").copy(lostSettledAt = Instant.EPOCH), format)
        assertEquals(UiText.Res(R.string.books_loanLostSettled), settled.text)
        assertEquals(LibraryBadge.Tone.NEUTRAL, settled.tone)
    }

    /** В справке утерянная — долг, книга на руках — её срок. */
    @Test
    fun debtBadge() {
        val format = { day: LocalDate -> day.toString() }
        assertEquals(UiText.Res(R.string.books_loanLostDebt), LibraryBadge.debt(loan("l1", "b1", status = "LOST"), format).text)
        assertEquals(
            UiText.Res(R.string.books_overdueSince, listOf("2026-11-05")),
            LibraryBadge.debt(loan("l1", "b1", overdue = true), format).text,
        )
    }

    @Test
    fun reservationBadge() {
        val format = { day: LocalDate -> day.toString() }
        assertEquals(UiText.Res(R.string.books_resQueuePosition, listOf(2)), LibraryBadge.reservation(reservation("r1", "b1"), format).text)
        assertEquals(UiText.Res(R.string.books_resQueued), LibraryBadge.reservation(reservation("r1", "b1", position = null), format).text)
        val ready = reservation("r1", "b1", status = "READY", position = null).copy(holdDate = "2026-10-25")
        assertEquals(UiText.Res(R.string.books_resReadyUntil, listOf("2026-10-25")), LibraryBadge.reservation(ready, format).text)
        assertEquals(UiText.Res(R.string.books_resExpired), LibraryBadge.reservation(reservation("r1", "b1", status = "EXPIRED"), format).text)
    }
}

class BookModelTest {
    /** Свободный экземпляр — бронь, все на руках — очередь, экземпляров нет — кнопка не нажимается. */
    @Test
    fun actionFollowsAvailability() = runTest {
        assertEquals(BookAction.Reserve(queue = false, enabled = true), loaded(book("b1", total = 2, available = 1)).action)
        assertEquals(BookAction.Reserve(queue = true, enabled = true), loaded(book("b1", total = 2, available = 0)).action)
        assertEquals(BookAction.Reserve(queue = true, enabled = false), loaded(book("b1", total = 0, available = 0)).action)
    }

    /** Своя бронь — отмена вместо второй брони; книга на руках — действий нет. */
    @Test
    fun ownReservationOrLoanChangesAction() = runTest {
        val reserved = loaded(book("b1"), reservations = listOf(reservation("r1", "b1"), reservation("r0", "b2")))
        assertEquals(BookAction.Cancel("r1"), reserved.action)
        assertEquals(R.string.books_queuedHint, reserved.hint)
        // Закрытая бронь не в счёт.
        val closed = loaded(book("b1"), reservations = listOf(reservation("r1", "b1", status = "CANCELLED")))
        assertTrue(closed.action is BookAction.Reserve)
        val onHands = loaded(book("b1"), loans = listOf(loan("l1", "b1")))
        assertEquals(BookAction.None, onHands.action)
        assertEquals(R.string.books_onHandsHint, onHands.hint)
    }

    /** Наклейка разбирается в книгу по коду, дальше экран живёт с её id. */
    @Test
    fun copyCodeOpensItsBook() = runTest {
        val api = StubLibrary(books = listOf(book("b7")))
        val model = BookModel(BookRef.CopyCode("K7Q2"), api)
        model.load()
        assertEquals("b7", model.book?.id)
        model.load()
        assertEquals(listOf("code:K7Q2", "book:b7"), api.calls.filter { it.startsWith("code") || it.startsWith("book") })
    }

    @Test
    fun reserveAddsOwnReservationAndTellsResult() = runTest {
        val api = StubLibrary(books = listOf(book("b1")))
        val model = BookModel(BookRef.Id("b1"), api)
        model.load()
        model.reserve()
        assertEquals(BookAction.Cancel("new"), model.action)
        assertEquals(UiText.Res(R.string.books_reservedReady), model.notice)
    }

    @Test
    fun refusalBecomesNotice() = runTest {
        val api = StubLibrary(books = listOf(book("b1")), reserveError = conflict("overdue"))
        val model = BookModel(BookRef.Id("b1"), api)
        model.load()
        model.reserve()
        assertEquals(UiText.Res(R.string.books_errorOverdue), model.notice)
    }

    @Test
    fun disabledModuleIsAState() = runTest {
        val model = BookModel(BookRef.Id("b1"), StubLibrary(failure = conflict("module")))
        model.load()
        assertTrue(model.isDisabled)
        assertNull(model.failure)
    }

    private suspend fun loaded(
        book: BookCardDto,
        reservations: List<ReservationDto> = emptyList(),
        loans: List<LoanDto> = emptyList(),
    ): BookModel {
        val model = BookModel(BookRef.Id(book.id), StubLibrary(books = listOf(book), reservations = reservations, loans = loans))
        model.load()
        return model
    }
}

class CatalogModelTest {
    /** Страницы догружаются, пока не набран `meta.total`; дальше не просим. */
    @Test
    fun pagesAppendUntilTotal() = runTest {
        val api = StubLibrary(books = (1..5).map { book("b$it") })
        val model = CatalogModel(api, pageSize = 2)
        model.reload()
        assertEquals(listOf("b1", "b2"), model.books.map { it.id })
        assertTrue(model.hasMore)
        model.loadNextPage()
        model.loadNextPage()
        assertEquals(5, model.books.size)
        assertFalse(model.hasMore)
        model.loadNextPage()
        assertEquals(3, api.calls.count { it.startsWith("books") })
    }

    @Test
    fun disabledLibraryHidesCatalog() = runTest {
        val model = CatalogModel(StubLibrary(failure = conflict("module")))
        model.reload()
        assertTrue(model.isDisabled)
        assertNull(model.failure)
    }

    @Test
    fun otherFailureIsShown() = runTest {
        val model = CatalogModel(StubLibrary(failure = ApiError.Server(ApiErrorCode.INTERNAL_ERROR, "сбой", emptyList(), 500)))
        model.reload()
        assertFalse(model.isDisabled)
        assertNotNull(model.failure)
    }
}

class MyBooksModelTest {
    @Test
    fun splitsLoansAndCountsOverdue() = runTest {
        val api = StubLibrary(
            loans = listOf(loan("l1", "b1", overdue = true), loan("l2", "b2"), loan("l3", "b3", status = "RETURNED")),
            reservations = listOf(reservation("r1", "b4", status = "READY"), reservation("r2", "b5", status = "EXPIRED")),
        )
        val model = MyBooksModel(api)
        model.refresh()
        assertEquals(listOf("l1", "l2"), model.onHands.map { it.id })
        assertEquals(listOf("l3"), model.history.map { it.id })
        assertEquals(listOf("r1"), model.activeReservations.map { it.id })
        assertEquals(1, model.overdueCount)
    }

    /** «Это не я» помечает выдачу сразу, без перезагрузки списка. */
    @Test
    fun disputeMarksLoan() = runTest {
        val model = MyBooksModel(StubLibrary(loans = listOf(loan("l1", "b1"))))
        model.refresh()
        model.dispute("l1")
        assertNotNull(model.onHands.single().disputedAt)
        assertEquals(UiText.Res(R.string.books_disputedToast), model.notice)
    }

    @Test
    fun cancelledReservationLeavesActiveList() = runTest {
        val model = MyBooksModel(StubLibrary(reservations = listOf(reservation("r1", "b1"))))
        model.refresh()
        model.cancel("r1")
        assertTrue(model.activeReservations.isEmpty())
    }
}

private fun clearance(clear: Boolean, loans: List<LoanDto> = emptyList(), checkedAt: Instant? = Instant.EPOCH) =
    LibraryClearanceDto(
        clear = clear,
        checkedAt = checkedAt,
        reader = LibraryClearanceDto.Reader(name = "Иванов Иван", group = "ИС-21"),
        university = "КазНУ",
        loans = loans,
    )

class ClearanceSummaryTest {
    @Test
    fun clearWithoutDebts() {
        val summary = ClearanceSummary.of(clearance(clear = true))
        assertTrue(summary.isClear)
        assertEquals(0, summary.lostDebts)
        assertEquals(Instant.EPOCH, summary.checkedAt)
    }

    /** Долги в ответе — справки нет, даже если `clear` пришёл `true`. */
    @Test
    fun debtsOverrideClearFlag() {
        val summary = ClearanceSummary.of(clearance(clear = true, loans = listOf(loan("l1", "b1"))))
        assertFalse(summary.isClear)
        assertEquals(listOf("l1"), summary.debts.map { it.id })
    }

    /** Утерянная в справке — долг, даже если сервер ещё не присылает `lostSettledAt`. */
    @Test
    fun lostDebtsAreCounted() {
        val summary = ClearanceSummary.of(clearance(clear = false, loans = listOf(loan("l1", "b1"), loan("l2", "b2", status = "LOST"))))
        assertFalse(summary.isClear)
        assertEquals(1, summary.lostDebts)
    }

    /** Нет момента проверки — берём момент ответа. */
    @Test
    fun missingCheckedAtUsesReceivedAt() {
        val received = Instant.parse("2026-10-23T09:00:00Z")
        assertEquals(received, ClearanceSummary.of(clearance(clear = true, checkedAt = null), receivedAt = received).checkedAt)
    }
}

class ClearanceModelTest {
    @Test
    fun refreshLoadsSummary() = runTest {
        val model = ClearanceModel(StubLibrary(clearance = clearance(clear = true)))
        model.refresh()
        assertEquals(true, model.summary?.isClear)
        assertNull(model.failure)
        assertFalse(model.isLoading)
    }

    @Test
    fun debtsAreListed() = runTest {
        val model = ClearanceModel(StubLibrary(clearance = clearance(clear = false, loans = listOf(loan("l1", "b1", overdue = true)))))
        model.refresh()
        assertEquals(false, model.summary?.isClear)
        assertEquals(listOf("l1"), model.summary?.debts?.map { it.id })
    }

    /** Отказ — ошибка вместо справки: прошлое «задолженностей нет» не выдаём за свежее. */
    @Test
    fun failureDropsStaleSummary() = runTest {
        val api = StubLibrary(clearance = clearance(clear = true))
        val model = ClearanceModel(api)
        model.refresh()
        assertNotNull(model.summary)
        api.clearanceFailure = ApiError.Server(ApiErrorCode.INTERNAL_ERROR, "сбой", emptyList(), 500)
        model.refresh()
        assertNull(model.summary)
        assertEquals(UiText.Res(R.string.error_internal), model.failure)
    }
}

/** Библиотека в памяти: каталог постранично, свои выдачи и брони. */
private class StubLibrary(
    private val books: List<BookCardDto> = emptyList(),
    private val loans: List<LoanDto> = emptyList(),
    private val reservations: List<ReservationDto> = emptyList(),
    private val failure: Exception? = null,
    private val reserveError: Exception? = null,
    private val clearance: LibraryClearanceDto = LibraryClearanceDto(clear = true),
) : LibraryFetching {
    val calls = mutableListOf<String>()
    var clearanceFailure: Exception? = null

    override suspend fun settings() = LibrarySettingsDto(enabled = true)

    override suspend fun books(page: Int, limit: Int, query: String?, section: String?, onlyAvailable: Boolean): Page<BookCardDto> {
        calls += "books:$page"
        failure?.let { throw it }
        val slice = books.drop((page - 1) * limit).take(limit)
        return Page(slice, ApiMeta(total = books.size))
    }

    override suspend fun sections() = listOf("Математика")

    override suspend fun book(id: String): BookCardDto {
        calls += "book:$id"
        failure?.let { throw it }
        return books.first { it.id == id }
    }

    override suspend fun bookByCopyCode(code: String): BookCardDto {
        calls += "code:$code"
        return books.first()
    }

    override suspend fun myLoans(): List<LoanDto> {
        failure?.let { throw it }
        return loans
    }

    override suspend fun dispute(loanId: String) = loans.first { it.id == loanId }.copy(disputedAt = Instant.EPOCH)

    override suspend fun reserve(bookId: String): ReservationDto {
        reserveError?.let { throw it }
        return reservation("new", bookId, status = "READY", position = null)
    }

    override suspend fun myReservations(): List<ReservationDto> {
        failure?.let { throw it }
        return reservations
    }

    override suspend fun cancelReservation(id: String) = reservations.first { it.id == id }.copy(status = "CANCELLED")

    override suspend fun clearance(): LibraryClearanceDto {
        clearanceFailure?.let { throw it }
        return clearance
    }
}

class LibraryRequestTest {
    private val server = MockWebServer().apply { start() }
    private val api = LibraryApi(ApiClient(server.url("/api/v1/").toString(), OkHttpClient(), "android/1.0.0+1"))

    @After
    fun stop() = server.close()

    /** Фильтры уходят, только когда заданы; общее число строк — в `meta.total`. */
    @Test
    fun catalogPageIsRequestedAndDecoded() = runTest {
        server.enqueue(
            MockResponse.Builder().code(200).body(
                """{"success":true,"data":[{"id":"b1","title":"Алгебра","authors":"Кострикин","isbn":"9785000000000","publisher":null,
                "year":2004,"section":"Математика","description":null,"coverUrl":null,"archived":false,
                "availability":{"total":3,"available":1,"onLoan":1,"reserved":1}}],"meta":{"total":41}}""",
            ).build(),
        )
        val page = api.books(2, 20, "алгебра", null, onlyAvailable = true)
        val target = server.takeRequest().target
        assertTrue(target, target.startsWith("/api/v1/library/books?"))
        assertTrue(target, "page=2" in target && "limit=20" in target && "available=true" in target)
        assertFalse(target, "section=" in target)
        assertEquals(41, page.meta?.total)
        assertEquals("Кострикин · 2004", page.items.single().byline)
        assertEquals(1, page.items.single().availability.available)
    }

    @Test
    fun onlyAvailableOffIsNotSent() = runTest {
        server.enqueue(MockResponse.Builder().code(200).body("""{"success":true,"data":[],"meta":{"total":0}}""").build())
        api.books(1, 20, " ", null, onlyAvailable = false)
        val target = server.takeRequest().target
        assertFalse(target, "available" in target)
        assertFalse(target, "q=" in target)
    }

    /** Выдача в настоящем виде — с читателем и выдавшим, которые экрану не нужны. */
    @Test
    fun loanIsDecoded() = runTest {
        server.enqueue(
            MockResponse.Builder().code(200).body(
                """{"success":true,"data":[{"id":"l1","status":"OPEN","issuedAt":"2026-10-01T09:00:00.000Z",
                "dueAt":"2026-10-15T18:59:59.999Z","dueDate":"2026-10-15","overdue":true,"renewals":0,"returnedAt":null,
                "cancelledAt":null,"cancelReason":null,"disputedAt":null,
                "book":{"id":"b1","title":"Алгебра","authors":"Кострикин","coverUrl":null},
                "copy":{"id":"c1","inventoryNumber":"000123"},
                "reader":{"id":"u1","name":"Иванов Иван","group":"ИС-21","card":"123"},"issuedBy":"Петрова"}]}""",
            ).build(),
        )
        val loan = api.myLoans().single()
        assertEquals(LocalDate.of(2026, 10, 15), loan.dueDay)
        assertTrue(loan.isOpen && loan.overdue)
        assertEquals("000123", loan.copy.inventoryNumber)
        assertEquals("/api/v1/library/me/loans", server.takeRequest().target)
    }

    @Test
    fun reservationIsDecoded() = runTest {
        server.enqueue(
            MockResponse.Builder().code(201).body(
                """{"success":true,"data":{"id":"r1","status":"READY","createdAt":"2026-10-20T10:00:00.000Z",
                "readyAt":"2026-10-20T10:00:00.000Z","holdUntil":"2026-10-23T18:59:59.999Z","holdDate":"2026-10-23",
                "closedAt":null,"position":null,"book":{"id":"b1","title":"Алгебра","authors":"","coverUrl":null},
                "copy":{"id":"c1","inventoryNumber":"000123"},"reader":{"id":"u1","name":"Иванов Иван","group":null}}}""",
            ).build(),
        )
        val reservation = api.reserve("b1")
        assertEquals("/api/v1/library/books/b1/reservations", server.takeRequest().target)
        assertEquals(LocalDate.of(2026, 10, 23), reservation.holdDay)
        assertTrue(reservation.isActive)
        assertNull(reservation.position)
    }

    /** Наклейка: читателю приходят экземпляр и книга — берём книгу. */
    @Test
    fun copyCodeResolvesBook() = runTest {
        server.enqueue(
            MockResponse.Builder().code(200).body(
                """{"success":true,"data":{"copy":{"id":"c1","inventoryNumber":"000123","code":"K7Q2","status":"AVAILABLE",
                "condition":"GOOD","note":null,"inventoriedAt":null,"loan":null},
                "book":{"id":"b1","title":"Алгебра","authors":"","isbn":null,"publisher":null,"year":null,"section":null,
                "description":null,"coverUrl":null,"archived":false,"availability":{"total":1,"available":1,"onLoan":0,"reserved":0}}}}""",
            ).build(),
        )
        assertEquals("b1", api.bookByCopyCode("K7Q2").id)
        assertEquals("/api/v1/library/copies/by-code/K7Q2", server.takeRequest().target)
    }

    /**
     * Справка: долг на руках (без `lostSettledAt`, как на сервере до учёта утерянных) и
     * утерянный с `lostSettledAt: null`; лишние поля разбор не роняют.
     */
    @Test
    fun clearanceIsDecoded() = runTest {
        server.enqueue(
            MockResponse.Builder().code(200).body(
                """{"success":true,"data":{"clear":false,"checkedAt":"2026-10-23T09:15:00.123Z",
                "reader":{"name":"Иванов Иван Петрович","group":"ИС-21","faculty":"ИТ","studentCardNumber":"123456"},
                "university":"КазНУ","somethingNew":{"a":1},"loans":[
                {"id":"l1","status":"OPEN","issuedAt":"2026-10-01T09:00:00.000Z","dueAt":"2026-10-15T18:59:59.999Z",
                "dueDate":"2026-10-15","overdue":true,"renewals":0,"returnedAt":null,"cancelledAt":null,"cancelReason":null,
                "disputedAt":null,"book":{"id":"b1","title":"Алгебра","authors":"Кострикин","coverUrl":null},
                "copy":{"id":"c1","inventoryNumber":"000123"},"reader":{"id":"u1","name":"Иванов Иван","group":"ИС-21","card":null},
                "issuedBy":"Петрова"},
                {"id":"l2","status":"LOST","issuedAt":"2026-09-01T09:00:00.000Z","dueDate":"2026-09-15","overdue":false,
                "lostSettledAt":null,"book":{"id":"b2","title":"Геометрия","authors":"","coverUrl":null},
                "copy":{"id":"c2","inventoryNumber":"000456"}}]}}""",
            ).build(),
        )
        val clearance = api.clearance()
        assertEquals("/api/v1/library/me/clearance", server.takeRequest().target)
        assertFalse(clearance.clear)
        assertEquals(Instant.parse("2026-10-23T09:15:00.123Z"), clearance.checkedAt)
        assertEquals("Иванов Иван Петрович", clearance.reader.name)
        assertEquals("ИС-21", clearance.reader.group)
        assertEquals("КазНУ", clearance.university)
        assertEquals(listOf("OPEN", "LOST"), clearance.loans.map { it.status })
        assertFalse(clearance.loans[0].isLostDebt)
        assertTrue(clearance.loans[1].isLostDebt)
        assertNull(clearance.loans[1].lostSettledAt)
    }

    /** Пропавшие поля — значения по умолчанию; `clear` без значения — «не подтверждено». */
    @Test
    fun clearanceToleratesMissingFields() = runTest {
        server.enqueue(MockResponse.Builder().code(200).body("""{"success":true,"data":{}}""").build())
        val clearance = api.clearance()
        assertFalse(clearance.clear)
        assertNull(clearance.checkedAt)
        assertEquals("", clearance.reader.name)
        assertTrue(clearance.loans.isEmpty())
    }

    /** Погашенный долг по утерянной книге — уже не долг. */
    @Test
    fun settledLostLoanIsNotDebt() = runTest {
        server.enqueue(
            MockResponse.Builder().code(200).body(
                """{"success":true,"data":[{"id":"l1","status":"LOST","issuedAt":"2026-10-01T09:00:00.000Z",
                "dueDate":"2026-10-15","lostSettledAt":"2026-10-20T10:00:00.000Z",
                "book":{"id":"b1","title":"Алгебра","authors":"","coverUrl":null},"copy":{"id":"c1","inventoryNumber":"000123"}}]}""",
            ).build(),
        )
        val loan = api.myLoans().single()
        assertNotNull(loan.lostSettledAt)
        assertFalse(loan.isLostDebt)
    }

    @Test
    fun refusalKeepsField() = runTest {
        server.enqueue(
            MockResponse.Builder().code(409).body(
                """{"success":false,"statusCode":409,"error":{"code":"CONFLICT","message":"У читателя просрочка",
                "details":[{"field":"overdue","message":"У читателя просрочка"}]}}""",
            ).build(),
        )
        val error = runCatching { api.reserve("b1") }.exceptionOrNull()
        assertEquals("overdue", LibraryErrors.field(error!!))
    }
}
