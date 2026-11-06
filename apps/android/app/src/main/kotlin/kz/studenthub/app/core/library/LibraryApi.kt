package kz.studenthub.app.core.library

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kz.studenthub.app.core.network.ApiClient
import kz.studenthub.app.core.network.Endpoint
import kz.studenthub.app.core.network.InstantSerializer
import kz.studenthub.app.core.network.Page
import java.time.Instant
import java.time.LocalDate

/*
 * Библиотека вуза глазами читателя — студента и старосты (PROJECT.md, «Библиотека (§3.11)»;
 * типы — `packages/shared-schemas/src/library.ts`), сверено 22.10.2026. Каталог, своя бронь
 * и «Мои книги»; выдачу и возврат делает библиотекарь в вебе.
 */

/** Настройки модуля. Читателю нужен только флаг: выключенной библиотеки в «Ещё» нет. */
@Serializable
data class LibrarySettingsDto(
    val enabled: Boolean = false,
    val defaultLoanDays: Int? = null,
    val maxLoanDays: Int? = null,
    val maxActiveLoans: Int? = null,
    val maxActiveReservations: Int? = null,
    val reservationHoldDays: Int? = null,
    val maxRenewals: Int? = null,
)

/** Книга каталога: читателю — без экземпляров, только сводка наличия. */
@Serializable
data class BookCardDto(
    val id: String,
    val title: String,
    val authors: String = "",
    val isbn: String? = null,
    val publisher: String? = null,
    val year: Int? = null,
    val section: String? = null,
    val description: String? = null,
    val coverUrl: String? = null,
    val archived: Boolean = false,
    val availability: Availability = Availability(),
) {
    /** Утерянные и списанные экземпляры в `total` не входят — это то, что вообще бывает на полке. */
    @Serializable
    data class Availability(val total: Int = 0, val available: Int = 0, val onLoan: Int = 0, val reserved: Int = 0)

    /** «Авторы · год» — вторая строка в списке, как в вебе. */
    val byline: String get() = listOfNotNull(authors.trim().ifEmpty { null }, year?.toString()).joinToString(" · ")
}

/** Книга внутри выдачи и брони: снимок, без наличия. */
@Serializable
data class BookRefDto(val id: String, val title: String, val authors: String = "", val coverUrl: String? = null)

@Serializable
data class CopyRefDto(val id: String, val inventoryNumber: String)

/** Выдача. Статусы — `OPEN`, `RETURNED`, `LOST`, `CANCELLED` (отменённые читателю не приходят). */
@Serializable
data class LoanDto(
    val id: String,
    val status: String,
    @Serializable(InstantSerializer::class) val issuedAt: Instant,
    @Serializable(InstantSerializer::class) val dueAt: Instant? = null,
    /**
     * Последний день срока «ГГГГ-ММ-ДД» по часам вуза. Показывается она, а не `dueAt`:
     * момент в часовом поясе телефона может съехать на соседний день.
     */
    val dueDate: String,
    val overdue: Boolean = false,
    val renewals: Int = 0,
    @Serializable(InstantSerializer::class) val returnedAt: Instant? = null,
    @Serializable(InstantSerializer::class) val cancelledAt: Instant? = null,
    val cancelReason: String? = null,
    /** Читатель отметил «Это не я» — решает библиотекарь. */
    @Serializable(InstantSerializer::class) val disputedAt: Instant? = null,
    val book: BookRefDto,
    val copy: CopyRefDto,
    val issuedBy: String? = null,
    /**
     * Когда погашен долг по утерянной книге (заменили или возместили). Сервер без учёта
     * утерянных долгов поля не присылает — тогда `null`, как у непогашенного.
     */
    @Serializable(InstantSerializer::class) val lostSettledAt: Instant? = null,
) {
    val isOpen: Boolean get() = status == "OPEN"

    /**
     * Утерянная книга без отметки «долг погашен» — долг читателя, как просрочка: закрывает
     * справку, выдачу и брони, пока библиотекарь не отметит погашение (PROJECT.md §3.11).
     */
    val isLostDebt: Boolean get() = status == "LOST" && lostSettledAt == null

    val dueDay: LocalDate? get() = runCatching { LocalDate.parse(dueDate) }.getOrNull()
}

/** Бронь. Статусы — `QUEUED`, `READY`, `FULFILLED`, `CANCELLED`, `EXPIRED`. */
@Serializable
data class ReservationDto(
    val id: String,
    val status: String,
    @Serializable(InstantSerializer::class) val createdAt: Instant,
    @Serializable(InstantSerializer::class) val readyAt: Instant? = null,
    @Serializable(InstantSerializer::class) val holdUntil: Instant? = null,
    /** Последний день готовой брони «ГГГГ-ММ-ДД» по часам вуза. */
    val holdDate: String? = null,
    @Serializable(InstantSerializer::class) val closedAt: Instant? = null,
    /** Место в очереди (1 — следующий) — только у брони в очереди. */
    val position: Int? = null,
    val book: BookRefDto,
    /** Отложенный экземпляр — у готовой брони. */
    val copy: CopyRefDto? = null,
) {
    /** Действующая: ждёт на полке или стоит в очереди. Отменить можно только её. */
    val isActive: Boolean get() = status == "READY" || status == "QUEUED"

    val holdDay: LocalDate? get() = holdDate?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
}

/**
 * Справка «задолженностей в библиотеке нет» на момент запроса (`GET /library/me/clearance`).
 * Все поля со значениями по умолчанию: справку открывают в очереди в деканат, и пропавшее
 * поле не должно превращать её в ошибку разбора. `clear` без значения — «есть долги»:
 * неподтверждённую справку не показываем.
 */
@Serializable
data class LibraryClearanceDto(
    val clear: Boolean = false,
    @Serializable(InstantSerializer::class) val checkedAt: Instant? = null,
    val reader: Reader = Reader(),
    val university: String = "",
    /** Долги: книги на руках и утерянные без погашения. */
    val loans: List<LoanDto> = emptyList(),
) {
    @Serializable
    data class Reader(
        val name: String = "",
        val group: String? = null,
        val faculty: String? = null,
        val studentCardNumber: String? = null,
    )
}

/** Наклейка экземпляра: читателю приходят экземпляр без выдачи и книга — нужна только книга. */
@Serializable
data class CopyByCodeDto(val book: BookCardDto)

interface LibraryFetching {
    suspend fun settings(): LibrarySettingsDto

    suspend fun books(page: Int, limit: Int, query: String?, section: String?, onlyAvailable: Boolean): Page<BookCardDto>

    suspend fun sections(): List<String>

    suspend fun book(id: String): BookCardDto

    suspend fun bookByCopyCode(code: String): BookCardDto

    suspend fun myLoans(): List<LoanDto>

    suspend fun dispute(loanId: String): LoanDto

    suspend fun reserve(bookId: String): ReservationDto

    suspend fun myReservations(): List<ReservationDto>

    suspend fun cancelReservation(id: String): ReservationDto

    suspend fun clearance(): LibraryClearanceDto
}

class LibraryApi(private val client: ApiClient) : LibraryFetching {
    override suspend fun settings(): LibrarySettingsDto = client.send(Endpoint.get("library/settings"), LibrarySettingsDto.serializer())

    /**
     * Каталог — offset-пагинация, общее число строк в `meta.total`. Фильтры уходят, только
     * когда заданы: `available=false` сервер понял бы так же, но лишний параметр — лишний
     * повод разойтись со схемой.
     */
    override suspend fun books(page: Int, limit: Int, query: String?, section: String?, onlyAvailable: Boolean): Page<BookCardDto> =
        client.page(
            Endpoint.get(
                "library/books",
                "page" to page.toString(),
                "limit" to limit.toString(),
                "q" to query?.takeIf { it.isNotBlank() },
                "section" to section,
                "available" to if (onlyAvailable) "true" else null,
            ),
            BookCardDto.serializer(),
        )

    override suspend fun sections(): List<String> = client.send(Endpoint.get("library/books/sections"), ListSerializer(String.serializer()))

    override suspend fun book(id: String): BookCardDto = client.send(Endpoint.get("library/books/$id"), BookCardDto.serializer())

    override suspend fun bookByCopyCode(code: String): BookCardDto =
        client.send(Endpoint.get("library/copies/by-code/$code"), CopyByCodeDto.serializer()).book

    override suspend fun myLoans(): List<LoanDto> = client.send(Endpoint.get("library/me/loans"), ListSerializer(LoanDto.serializer()))

    override suspend fun dispute(loanId: String): LoanDto = client.send(Endpoint.post("library/loans/$loanId/dispute"), LoanDto.serializer())

    override suspend fun reserve(bookId: String): ReservationDto =
        client.send(Endpoint.post("library/books/$bookId/reservations"), ReservationDto.serializer())

    override suspend fun myReservations(): List<ReservationDto> =
        client.send(Endpoint.get("library/me/reservations"), ListSerializer(ReservationDto.serializer()))

    override suspend fun cancelReservation(id: String): ReservationDto =
        client.send(Endpoint.post("library/me/reservations/$id/cancel"), ReservationDto.serializer())

    /** Справка отвечает и при выключенной библиотеке: книги могли остаться на руках. */
    override suspend fun clearance(): LibraryClearanceDto =
        client.send(Endpoint.get("library/me/clearance"), LibraryClearanceDto.serializer())
}
