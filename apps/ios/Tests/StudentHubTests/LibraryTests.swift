import XCTest

@testable import StudentHub

/// Контракт библиотеки (`packages/shared-schemas/src/library.ts`). Расхождение здесь на
/// экране выглядит как пустой каталог без ошибки.
final class LibraryContractTests: XCTestCase {
    /// Каталог — offset-пагинация: книги в `data`, общее число — в `meta.total`.
    func testCatalogPageCarriesTotal() throws {
        let json = Data(
            """
            {"success":true,"data":[{"id":"b-1","title":"Алгоритмы","authors":"Кормен",
            "isbn":"9785845916687","publisher":null,"year":2019,"section":"Информатика",
            "description":null,"coverUrl":null,"archived":false,
            "availability":{"total":5,"available":2,"onLoan":3,"reserved":0}}],
            "meta":{"total":41}}
            """.utf8
        )

        let envelope = try JSONCoding.decoder.decode(APISuccessEnvelope<[BookCardDTO]>.self, from: json)

        XCTAssertEqual(envelope.meta?.total, 41)
        XCTAssertEqual(envelope.data.first?.availability.available, 2)
        XCTAssertEqual(envelope.data.first?.byline, "Кормен · 2019")
    }

    /// Срок показываем по `dueDate` — дню по часам вуза, а не по моменту `dueAt`.
    func testLoanDecodesDueDateAndDispute() throws {
        let json = Data(
            """
            {"id":"l-1","status":"OPEN","issuedAt":"2026-10-01T09:15:00.123Z",
            "dueAt":"2026-10-15T18:59:59.999Z","dueDate":"2026-10-15","overdue":true,"renewals":0,
            "returnedAt":null,"cancelledAt":null,"cancelReason":null,
            "disputedAt":"2026-10-02T10:00:00.000Z",
            "book":{"id":"b-1","title":"Алгоритмы","authors":"Кормен","coverUrl":null},
            "copy":{"id":"c-1","inventoryNumber":"000123"},
            "reader":{"id":"u-1","name":"Аян Серик","group":"ИС-21","card":null},"issuedBy":"Библиотекарь"}
            """.utf8
        )

        let loan = try JSONCoding.decoder.decode(LoanDTO.self, from: json)

        XCTAssertEqual(loan.status, .open)
        XCTAssertEqual(loan.dueDate, "2026-10-15")
        XCTAssertTrue(loan.overdue)
        XCTAssertNotNil(loan.disputedAt)
        XCTAssertEqual(loan.copy.inventoryNumber, "000123")
    }

    func testReservationInQueueHasNoCopy() throws {
        let json = Data(
            """
            {"id":"r-1","status":"QUEUED","createdAt":"2026-10-01T09:15:00.000Z","readyAt":null,
            "holdUntil":null,"holdDate":null,"closedAt":null,"position":2,
            "book":{"id":"b-1","title":"Алгоритмы","authors":"","coverUrl":null},"copy":null,
            "reader":{"id":"u-1","name":"Аян Серик","group":null}}
            """.utf8
        )

        let reservation = try JSONCoding.decoder.decode(ReservationDTO.self, from: json)

        XCTAssertEqual(reservation.status, .queued)
        XCTAssertEqual(reservation.position, 2)
        XCTAssertNil(reservation.copy)
        XCTAssertNil(reservation.holdDate)
    }

    /// Новый статус на сервере появится раньше, чем все обновят приложение.
    func testUnknownStatusesDoNotBreakDecoding() throws {
        let json = Data(#"["SOMETHING_NEW"]"#.utf8)

        XCTAssertEqual(try JSONCoding.decoder.decode([LoanStatus].self, from: json), [.unknown])
        XCTAssertEqual(try JSONCoding.decoder.decode([ReservationStatus].self, from: json), [.unknown])
    }

    func testQueryCarriesOnlyWhatIsSet() {
        XCTAssertEqual(
            BookQuery().items(page: 1),
            [URLQueryItem(name: "page", value: "1"), URLQueryItem(name: "limit", value: "20")]
        )

        let query = BookQuery(text: "  кормен ", section: "Информатика", onlyAvailable: true)
        XCTAssertEqual(
            query.items(page: 3),
            [
                URLQueryItem(name: "page", value: "3"),
                URLQueryItem(name: "limit", value: "20"),
                URLQueryItem(name: "q", value: "кормен"),
                URLQueryItem(name: "section", value: "Информатика"),
                URLQueryItem(name: "available", value: "true"),
            ]
        )
        XCTAssertTrue(query.isFiltered)
        XCTAssertFalse(BookQuery(text: "   ").isFiltered)
    }
}

/// Отказы — по полю `details`, а не по серверному тексту: тот обращён к библиотекарю.
final class LibraryReaderErrorTests: XCTestCase {
    func testConflictFieldPicksReaderText() {
        XCTAssertEqual(
            LibraryReaderError.message(for: conflict("overdue")),
            "У вас просрочена книга — сначала верните её"
        )
        XCTAssertEqual(
            LibraryReaderError.message(for: conflict("alreadyReserved")),
            "Эта книга уже забронирована вами"
        )
    }

    func testModuleOffIsRecognised() {
        XCTAssertTrue(LibraryReaderError.isModuleOff(conflict("module")))
        XCTAssertFalse(LibraryReaderError.isModuleOff(conflict("overdue")))
        XCTAssertFalse(LibraryReaderError.isModuleOff(APIError.transport(URLError(.notConnectedToInternet))))
    }

    /// Незнакомое поле — серверное сообщение как есть: лучше точный текст, чем общий.
    func testUnknownFieldFallsBackToServerMessage() {
        XCTAssertEqual(LibraryReaderError.message(for: conflict("somethingNew")), "Серверный текст")
    }

    func testNotFoundMeansNoSuchBook() {
        let error = APIError.server(code: .notFound, message: "Not found", details: [], statusCode: 404)

        XCTAssertEqual(LibraryReaderError.message(for: error), "Книга не найдена")
    }

    private func conflict(_ field: String) -> APIError {
        .server(
            code: .conflict,
            message: "Серверный текст",
            details: [APIErrorDetail(field: field, message: "Серверный текст")],
            statusCode: 409
        )
    }
}

final class ReaderBookStateTests: XCTestCase {
    func testFreeCopyMeansReserve() {
        let state = ReaderBookState(book: book(available: 2, total: 3), reservations: [], loans: [])

        XCTAssertEqual(state.action, .reserve)
    }

    func testAllOnHandsMeansQueue() {
        let state = ReaderBookState(book: book(available: 0, total: 3), reservations: [], loans: [])

        XCTAssertEqual(state.action, .joinQueue)
    }

    /// Экземпляров в обороте нет — и бронировать нечего.
    func testNoCopiesMeansNoAction() {
        let state = ReaderBookState(book: book(available: 0, total: 0), reservations: [], loans: [])

        XCTAssertEqual(state.action, .none)
        XCTAssertNil(state.hint)
    }

    /// Своя действующая бронь — только отменить: второй раз то же самое не бронируем.
    func testOwnReservationMeansCancel() {
        let state = ReaderBookState(
            book: book(available: 2, total: 3),
            reservations: [reservation(id: "r-1", status: .ready)],
            loans: []
        )

        XCTAssertEqual(state.action, .cancel(reservationID: "r-1"))
        XCTAssertEqual(state.reservation?.id, "r-1")
    }

    /// Закрытая бронь — уже не своя: её не отменить, а книгу можно брать снова.
    func testClosedReservationIsIgnored() {
        let state = ReaderBookState(
            book: book(available: 1, total: 1),
            reservations: [reservation(id: "r-1", status: .expired)],
            loans: []
        )

        XCTAssertEqual(state.action, .reserve)
        XCTAssertNil(state.reservation)
    }

    func testBookOnHandsOffersNothing() {
        let state = ReaderBookState(
            book: book(available: 2, total: 3),
            reservations: [],
            loans: [loan(id: "l-1", status: .open)]
        )

        XCTAssertEqual(state.action, .none)
        XCTAssertEqual(state.loan?.id, "l-1")
        XCTAssertEqual(state.hint, "Эта книга сейчас у вас.")
    }

    func testShelfStates() {
        XCTAssertEqual(ShelfState(availability(available: 2, total: 5)), .available(2, of: 5))
        XCTAssertEqual(ShelfState(availability(available: 0, total: 5)), .allOut)
        XCTAssertEqual(ShelfState(availability(available: 0, total: 0)), .noCopies)
    }
}

final class MyBooksTests: XCTestCase {
    func testLoansSplitIntoHandsAndHistory() {
        let books = MyBooks(
            loans: [
                loan(id: "l-1", status: .open, overdue: true),
                loan(id: "l-2", status: .open),
                loan(id: "l-3", status: .returned),
                loan(id: "l-4", status: .lost),
            ],
            reservations: []
        )

        XCTAssertEqual(books.onHands.map(\.id), ["l-1", "l-2"])
        XCTAssertEqual(books.history.map(\.id), ["l-3", "l-4"])
        XCTAssertEqual(books.overdueCount, 1)
    }

    /// Готовые брони первыми — их надо забрать; закрытые в «Мои книги» не попадают.
    func testReadyReservationsComeFirst() {
        let books = MyBooks(
            loans: [],
            reservations: [
                reservation(id: "r-1", status: .queued),
                reservation(id: "r-2", status: .cancelled),
                reservation(id: "r-3", status: .ready),
            ]
        )

        XCTAssertEqual(books.reservations.map(\.id), ["r-3", "r-1"])
    }
}

final class LibraryFormattingTests: XCTestCase {
    /// День по часам вуза разбирается в полночь местного календаря — без сдвига на сутки.
    func testDayParsesAsCalendarDay() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Almaty") ?? .current

        let date = try XCTUnwrap(LibraryDay.date(from: "2026-11-05", calendar: calendar))

        XCTAssertEqual(calendar.dateComponents([.year, .month, .day], from: date).day, 5)
        XCTAssertNil(LibraryDay.date(from: "вчера"))
    }

    /// Шаблон с именованными местами: в казахском число стоит в другом порядке.
    func testTemplateFillsNamedPlaces() {
        XCTAssertEqual(
            LibraryText.fill("Сөреде {total} ішінен {available}", ["available": "2", "total": "5"]),
            "Сөреде 5 ішінен 2"
        )
    }
}

@MainActor
final class LibraryCatalogModelTests: XCTestCase {
    func testPagesAppendUntilTotal() async {
        let api = StubLibrary()
        api.pages = [
            1: Page(items: [card("b-1"), card("b-2")], meta: meta(total: 3)),
            2: Page(items: [card("b-3")], meta: meta(total: 3)),
        ]
        let model = LibraryCatalogModel(api: api)

        await model.refresh()
        XCTAssertTrue(model.hasMore)
        await model.loadMore()

        XCTAssertEqual(model.books.map(\.id), ["b-1", "b-2", "b-3"])
        XCTAssertFalse(model.hasMore)
    }

    /// Выключенная библиотека — объяснение, а не ошибка поверх пустого списка.
    func testModuleOffDisablesCatalog() async {
        let api = StubLibrary()
        api.booksError = APIError.server(
            code: .conflict,
            message: "Библиотека вуза выключена",
            details: [APIErrorDetail(field: "module", message: "Библиотека вуза выключена")],
            statusCode: 409
        )
        let model = LibraryCatalogModel(api: api)

        await model.refresh()

        XCTAssertTrue(model.isDisabled)
        XCTAssertNil(model.failure)
    }

    private func meta(total: Int) -> APIMeta {
        APIMeta(cursor: nil, hasNext: nil, total: total, prevCursor: nil, hasPrev: nil)
    }
}

@MainActor
final class MyBooksModelTests: XCTestCase {
    /// «Это не я» меняет только отметку у выдачи — список не перечитывается целиком.
    func testDisputeMarksLoan() async {
        let api = StubLibrary()
        api.loans = [loan(id: "l-1", status: .open)]
        api.disputed = loan(id: "l-1", status: .open, disputed: true)
        let model = MyBooksModel(api: api)
        await model.refresh()

        await model.dispute("l-1")

        XCTAssertNotNil(model.books?.onHands.first?.disputedAt)
        XCTAssertNil(model.failure)
    }

    func testCancelledReservationLeavesList() async {
        let api = StubLibrary()
        api.reservations = [reservation(id: "r-1", status: .queued)]
        let model = MyBooksModel(api: api)
        await model.refresh()

        await model.cancel(reservationID: "r-1")

        XCTAssertEqual(model.books?.reservations.count, 0)
        XCTAssertEqual(api.cancelled, ["r-1"])
    }
}

/// Справка `GET /library/me/clearance`: разбор терпит новые и пропавшие поля, а утерянная
/// книга без погашения (ветка lost-debt на сервере) — долг, как книга на руках.
final class LibraryClearanceContractTests: XCTestCase {
    func testClearClearanceDecodes() throws {
        let json = Data(
            """
            {"success":true,"data":{"clear":true,"checkedAt":"2026-10-23T09:15:00.123Z",
            "reader":{"name":"Серик Аян Нурланович","group":"ИС-21","faculty":"Информационные технологии",
            "studentCardNumber":"123456"},"university":"КазНУ","loans":[],"somethingNew":{"a":1}}}
            """.utf8
        )

        let clearance = try JSONCoding.decoder.decode(APISuccessEnvelope<LibraryClearanceDTO>.self, from: json).data

        XCTAssertTrue(clearance.clear)
        XCTAssertNotNil(clearance.checkedAt)
        XCTAssertEqual(clearance.reader.name, "Серик Аян Нурланович")
        XCTAssertEqual(clearance.reader.group, "ИС-21")
        XCTAssertEqual(clearance.university, "КазНУ")
        XCTAssertTrue(clearance.loans.isEmpty)
    }

    /// Долги: книга на руках (сервер develop) и утерянная без погашения (`lostSettledAt: null`).
    func testDebtsDecodeWithAndWithoutLostField() throws {
        let json = Data(
            """
            {"clear":false,"checkedAt":"2026-10-23T09:15:00.000Z",
            "reader":{"name":"Серик Аян","group":null,"faculty":null,"studentCardNumber":null},
            "university":"КазНУ","loans":[
            {"id":"l-1","status":"OPEN","issuedAt":"2026-10-01T09:15:00.000Z","dueDate":"2026-10-15",
            "overdue":true,"disputedAt":null,"book":{"id":"b-1","title":"Алгоритмы","authors":"Кормен","coverUrl":null},
            "copy":{"id":"c-1","inventoryNumber":"000123"}},
            {"id":"l-2","status":"LOST","issuedAt":"2026-09-01T09:15:00.000Z","dueDate":"2026-09-15",
            "overdue":false,"disputedAt":null,"lostSettledAt":null,
            "book":{"id":"b-2","title":"Матанализ","authors":"","coverUrl":null},
            "copy":{"id":"c-2","inventoryNumber":"000456"}}]}
            """.utf8
        )

        let clearance = try JSONCoding.decoder.decode(LibraryClearanceDTO.self, from: json)

        XCTAssertFalse(clearance.clear)
        XCTAssertNil(clearance.reader.group)
        XCTAssertEqual(clearance.loans.map(\.status), [.open, .lost])
        XCTAssertNil(clearance.loans[0].lostSettledAt)
        XCTAssertFalse(clearance.loans[0].isLostDebt)
        XCTAssertTrue(clearance.loans[1].isLostDebt)
    }

    /// Пропавшие поля не роняют разбор; `clear` без значения — «не подтверждено».
    func testMissingFieldsFallBack() throws {
        let clearance = try JSONCoding.decoder.decode(LibraryClearanceDTO.self, from: Data("{}".utf8))

        XCTAssertFalse(clearance.clear)
        XCTAssertNil(clearance.checkedAt)
        XCTAssertEqual(clearance.reader.name, "")
        XCTAssertEqual(clearance.university, "")
        XCTAssertTrue(clearance.loans.isEmpty)
    }

    /// Погашенный долг по утерянной книге — уже не долг.
    func testSettledLostLoanIsNotDebt() throws {
        let json = Data(
            """
            {"id":"l-1","status":"LOST","issuedAt":"2026-10-01T09:15:00.000Z","dueDate":"2026-10-15",
            "overdue":false,"disputedAt":null,"lostSettledAt":"2026-10-20T10:00:00.000Z",
            "book":{"id":"b-1","title":"Алгоритмы","authors":"Кормен","coverUrl":null},
            "copy":{"id":"c-1","inventoryNumber":"000123"}}
            """.utf8
        )

        let loan = try JSONCoding.decoder.decode(LoanDTO.self, from: json)

        XCTAssertNotNil(loan.lostSettledAt)
        XCTAssertFalse(loan.isLostDebt)
    }
}

final class ClearanceSummaryTests: XCTestCase {
    func testClearWithoutDebts() {
        let checked = Date(timeIntervalSince1970: 1_792_000_000)
        let summary = ClearanceSummary(clearance(clear: true, loans: [], checkedAt: checked))

        XCTAssertTrue(summary.isClear)
        XCTAssertEqual(summary.lostDebts, 0)
        XCTAssertEqual(summary.checkedAt, checked)
    }

    /// Долги в ответе — справки нет, даже если `clear` пришёл `true`.
    func testDebtsOverrideClearFlag() {
        let summary = ClearanceSummary(clearance(clear: true, loans: [loan(id: "l-1", status: .open)]))

        XCTAssertFalse(summary.isClear)
        XCTAssertEqual(summary.debts.map(\.id), ["l-1"])
    }

    /// Утерянная в справке — долг, даже если старый сервер не прислал `lostSettledAt`.
    func testLostDebtsAreCounted() {
        let summary = ClearanceSummary(clearance(
            clear: false,
            loans: [loan(id: "l-1", status: .open), loan(id: "l-2", status: .lost)]
        ))

        XCTAssertFalse(summary.isClear)
        XCTAssertEqual(summary.lostDebts, 1)
    }

    /// Нет момента проверки — берём момент ответа, а не пустую строку в сведениях.
    func testMissingCheckedAtUsesReceivedAt() {
        let received = Date(timeIntervalSince1970: 1_792_000_000)

        let summary = ClearanceSummary(clearance(clear: true, loans: [], checkedAt: nil), receivedAt: received)

        XCTAssertEqual(summary.checkedAt, received)
    }
}

@MainActor
final class LibraryClearanceModelTests: XCTestCase {
    func testRefreshLoadsSummary() async {
        let api = StubLibrary()
        api.clearanceResult = clearance(clear: true, loans: [])
        let model = LibraryClearanceModel(api: api)

        await model.refresh()

        XCTAssertEqual(model.summary?.isClear, true)
        XCTAssertNil(model.failure)
    }

    /// Отказ — ошибка вместо справки: прошлое «задолженностей нет» не выдаём за свежее.
    func testFailureDropsStaleSummary() async {
        let api = StubLibrary()
        api.clearanceResult = clearance(clear: true, loans: [])
        let model = LibraryClearanceModel(api: api)
        await model.refresh()

        api.clearanceResult = nil
        await model.refresh()

        XCTAssertNil(model.summary)
        XCTAssertNotNil(model.failure)
    }
}

// MARK: - Заготовки

private func clearance(
    clear: Bool,
    loans: [LoanDTO],
    checkedAt: Date? = Date(timeIntervalSince1970: 1_792_000_000)
) -> LibraryClearanceDTO {
    LibraryClearanceDTO(
        clear: clear,
        checkedAt: checkedAt,
        reader: LibraryClearanceDTO.Reader(name: "Серик Аян", group: "ИС-21"),
        university: "КазНУ",
        loans: loans
    )
}

private func availability(available: Int, total: Int) -> BookAvailabilityDTO {
    BookAvailabilityDTO(total: total, available: available, onLoan: total - available, reserved: 0)
}

private func book(available: Int, total: Int) -> BookCardDTO {
    BookCardDTO(
        id: "b-1", title: "Алгоритмы", authors: "Кормен", isbn: nil, publisher: nil, year: nil,
        section: nil, description: nil, coverUrl: nil,
        availability: availability(available: available, total: total)
    )
}

private func card(_ id: String) -> BookCardDTO {
    BookCardDTO(
        id: id, title: "Книга \(id)", authors: "", isbn: nil, publisher: nil, year: nil,
        section: nil, description: nil, coverUrl: nil,
        availability: availability(available: 1, total: 1)
    )
}

private let bookRef = LibraryBookRefDTO(id: "b-1", title: "Алгоритмы", authors: "Кормен", coverUrl: nil)

private func loan(id: String, status: LoanStatus, overdue: Bool = false, disputed: Bool = false) -> LoanDTO {
    LoanDTO(
        id: id, status: status, issuedAt: Date(timeIntervalSince1970: 1_790_000_000),
        dueDate: "2026-10-15", overdue: overdue, disputedAt: disputed ? Date() : nil,
        book: bookRef, copy: LibraryCopyRefDTO(id: "c-\(id)", inventoryNumber: "000123")
    )
}

private func reservation(id: String, status: ReservationStatus) -> ReservationDTO {
    ReservationDTO(
        id: id, status: status, holdDate: status == .ready ? "2026-10-20" : nil,
        position: status == .queued ? 1 : nil, book: bookRef,
        copy: status == .ready ? LibraryCopyRefDTO(id: "c-1", inventoryNumber: "000123") : nil
    )
}

private final class StubLibrary: LibraryFetching, @unchecked Sendable {
    private let lock = NSLock()
    var pages: [Int: Page<BookCardDTO>] = [:]
    var booksError: Error?
    var loans: [LoanDTO] = []
    var reservations: [ReservationDTO] = []
    var disputed: LoanDTO?
    /// Ответ справки; `nil` — сервер отказал.
    var clearanceResult: LibraryClearanceDTO?
    private(set) var cancelled: [String] = []

    func settings() async throws -> LibrarySettingsDTO { LibrarySettingsDTO(enabled: true) }

    func books(_ query: BookQuery, page: Int) async throws -> Page<BookCardDTO> {
        try lock.withLock {
            if let booksError { throw booksError }
            return pages[page] ?? Page(items: [], meta: nil)
        }
    }

    func sections() async throws -> [String] { ["Информатика"] }

    func book(id: String) async throws -> BookCardDTO { card(id) }

    func copy(code: String) async throws -> BookCopyByCodeDTO { BookCopyByCodeDTO(book: card("b-1")) }

    func myLoans() async throws -> [LoanDTO] { lock.withLock { loans } }

    func dispute(loanID: String) async throws -> LoanDTO {
        try lock.withLock {
            guard let disputed else { throw APIError.malformedResponse(statusCode: 500) }
            return disputed
        }
    }

    func reserve(bookID: String) async throws -> ReservationDTO { reservation(id: "r-new", status: .queued) }

    func myReservations() async throws -> [ReservationDTO] { lock.withLock { reservations } }

    func cancelReservation(id: String) async throws -> ReservationDTO {
        lock.withLock { cancelled.append(id) }
        return reservation(id: id, status: .cancelled)
    }

    func clearance() async throws -> LibraryClearanceDTO {
        try lock.withLock {
            guard let clearanceResult else { throw APIError.malformedResponse(statusCode: 500) }
            return clearanceResult
        }
    }
}
