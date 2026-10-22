import Foundation
import Observation

// MARK: - Наличие и действие с книгой

/// Наличие книги на полке — то, что читатель ищет глазами в каталоге.
enum ShelfState: Equatable {
    /// Есть свободные: «На полке 2 из 5».
    case available(Int, of: Int)
    /// Все экземпляры на руках или отложены.
    case allOut
    /// Экземпляров в обороте нет вовсе.
    case noCopies

    init(_ availability: BookAvailabilityDTO) {
        if availability.total == 0 {
            self = .noCopies
        } else if availability.available > 0 {
            self = .available(availability.available, of: availability.total)
        } else {
            self = .allOut
        }
    }
}

/// Что читатель может сделать с книгой прямо сейчас.
///
/// Правило то же, что в вебе: своя действующая бронь — только отменить, книга на руках —
/// ничего (второй раз её не забронировать), иначе — забронировать или встать в очередь.
enum BookAction: Equatable {
    case reserve
    case joinQueue
    case cancel(reservationID: String)
    case none
}

/// Книга глазами конкретного читателя: его бронь, его выдача и доступное действие.
struct ReaderBookState: Equatable {
    let reservation: ReservationDTO?
    let loan: LoanDTO?
    let action: BookAction

    init(book: BookCardDTO, reservations: [ReservationDTO], loans: [LoanDTO]) {
        let reservation = reservations.first { $0.book.id == book.id && $0.status.isActive }
        let loan = loans.first { $0.book.id == book.id && $0.status == .open }
        self.reservation = reservation
        self.loan = loan

        if let reservation {
            action = .cancel(reservationID: reservation.id)
        } else if loan != nil {
            action = .none
        } else {
            switch ShelfState(book.availability) {
            case .available: action = .reserve
            case .allOut: action = .joinQueue
            // Экземпляров нет — бронировать нечего, сервер ответит `noCopies`.
            case .noCopies: action = .none
            }
        }
    }

    /// Подсказка под кнопкой: что будет дальше.
    var hint: String? {
        if let reservation {
            return reservation.status == .ready
                ? String(
                    localized: "library.readyHint",
                    defaultValue: "Книга ждёт вас в библиотеке — возьмите цифровой студенческий."
                )
                : String(localized: "library.queuedHint", defaultValue: "Сообщим, когда подойдёт ваша очередь.")
        }
        if loan != nil {
            return String(localized: "library.onHandsHint", defaultValue: "Эта книга сейчас у вас.")
        }
        switch action {
        case .reserve:
            return String(
                localized: "library.reserveHint",
                defaultValue: "Книгу отложат на полку броней; заберите её с цифровым студенческим."
            )
        case .joinQueue:
            return String(
                localized: "library.queueHint",
                defaultValue: "Сейчас все экземпляры на руках. Встаньте в очередь — сообщим, когда книга вернётся."
            )
        case .cancel, .none:
            return nil
        }
    }
}

/// «Мои книги»: на руках, брони, история.
struct MyBooks: Equatable {
    let onHands: [LoanDTO]
    let history: [LoanDTO]
    let reservations: [ReservationDTO]

    init(loans: [LoanDTO], reservations: [ReservationDTO]) {
        onHands = loans.filter { $0.status == .open }
        history = loans.filter { $0.status != .open }
        // Готовые первыми — их надо забрать, очередь подождёт. Сервер уже так сортирует,
        // но порядок здесь — требование экрана, а не совпадение.
        let active = reservations.filter(\.status.isActive)
        self.reservations = active.filter { $0.status == .ready } + active.filter { $0.status == .queued }
    }

    /// Сколько книг просрочено: пока они не вернутся, новые выдачи и брони закрыты.
    var overdueCount: Int { onHands.filter(\.overdue).count }
}

// MARK: - Каталог

/// Каталог библиотеки: поиск, фильтры и подгрузка страниц.
@Observable
final class LibraryCatalogModel {
    var query = BookQuery()

    private(set) var books: [BookCardDTO] = []
    private(set) var total = 0
    private(set) var sections: [String] = []
    private(set) var isLoading = false
    private(set) var failure: String?
    /// Библиотеку вуза выключили (`409 module`): вместо каталога — объяснение.
    private(set) var isDisabled = false
    /// Для какого запроса загружена первая страница. Возврат с карточки книги не должен
    /// сбрасывать подгруженные страницы и прокрутку.
    private(set) var loadedQuery: BookQuery?

    private let api: LibraryFetching
    private var page = 1
    /// Номер загрузки: ответ на устаревший запрос (человек успел дописать поиск)
    /// отбрасываем, иначе список мигнёт чужими результатами.
    private var generation = 0

    init(api: LibraryFetching = LibraryAPI()) {
        self.api = api
    }

    var hasMore: Bool { books.count < total }

    /// Первая страница по текущему запросу.
    @MainActor
    func refresh() async {
        generation += 1
        let current = generation
        let query = self.query
        isLoading = true
        defer { if current == generation { isLoading = false } }

        if sections.isEmpty {
            // Разделы — подсказка для фильтра, а не содержимое экрана: без них каталог
            // всё равно работает.
            sections = (try? await api.sections()) ?? []
        }

        do {
            let result = try await api.books(query, page: 1)
            guard current == generation else { return }
            books = result.items
            total = result.meta?.total ?? result.items.count
            page = 1
            loadedQuery = query
            isDisabled = false
            failure = nil
        } catch {
            // Отменённый запрос — это человек дописал поиск, а не отказ сети.
            guard current == generation, !Task.isCancelled else { return }
            if LibraryReaderError.isModuleOff(error) {
                isDisabled = true
                books = []
                total = 0
                failure = nil
            } else {
                failure = LibraryReaderError.message(for: error)
            }
        }
    }

    /// Следующая страница — когда человек докрутил до конца списка.
    @MainActor
    func loadMore() async {
        guard hasMore, !isLoading, let loadedQuery else { return }
        let current = generation
        isLoading = true
        defer { if current == generation { isLoading = false } }
        do {
            let result = try await api.books(loadedQuery, page: page + 1)
            guard current == generation else { return }
            // Между страницами каталог мог сдвинуться: дубли по id отбрасываем.
            let known = Set(books.map(\.id))
            books += result.items.filter { !known.contains($0.id) }
            total = result.meta?.total ?? total
            page += 1
            // Пустая страница при `hasMore` значит, что книги убрали из каталога, пока
            // человек листал: дальше листать нечего.
            if result.items.isEmpty { total = books.count }
        } catch {
            // Молча: хвост списка не доехал — это не повод рисовать ошибку поверх того,
            // что человек уже читает. Докрутит ещё раз — попробуем снова.
        }
    }
}

// MARK: - Книга

/// Карточка книги с бронью.
@Observable
final class LibraryBookModel {
    private(set) var book: BookCardDTO?
    private(set) var reservations: [ReservationDTO] = []
    private(set) var loans: [LoanDTO] = []
    private(set) var isLoading = false
    private(set) var isWorking = false
    private(set) var failure: String?
    private(set) var notice: String?
    /// Книгу не открыть: нет такой, архивная или библиотеку выключили.
    private(set) var unavailable: String?

    private let api: LibraryFetching
    private let bookID: String

    init(bookID: String, api: LibraryFetching = LibraryAPI()) {
        self.bookID = bookID
        self.api = api
    }

    var state: ReaderBookState? {
        book.map { ReaderBookState(book: $0, reservations: reservations, loans: loans) }
    }

    @MainActor
    func load() async {
        isLoading = true
        defer { isLoading = false }
        // Дочерние задачи получают копии, а не `self`: модель живёт на главном потоке.
        let api = self.api
        let bookID = self.bookID
        do {
            async let book = api.book(id: bookID)
            async let reservations = api.myReservations()
            async let loans = api.myLoans()
            self.book = try await book
            // Свои брони и выдачи — уточнение к карточке. Не доехали — кнопка всё равно
            // работает, а отказ сервера (`alreadyReserved`) объяснит остальное.
            self.reservations = (try? await reservations) ?? self.reservations
            self.loans = (try? await loans) ?? self.loans
            unavailable = nil
            failure = nil
        } catch {
            if self.book == nil, LibraryReaderError.isModuleOff(error) || (error as? APIError)?.code == .notFound {
                unavailable = LibraryReaderError.message(for: error)
            } else {
                failure = LibraryReaderError.message(for: error)
            }
        }
    }

    @MainActor
    func reserve() async {
        guard !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            let reservation = try await api.reserve(bookID: bookID)
            notice = reservation.status == .ready
                ? String(
                    localized: "library.reservedReady",
                    defaultValue: "Книга отложена — заберите её в библиотеке"
                )
                : String(
                    localized: "library.reservedQueued",
                    defaultValue: "Вы в очереди — сообщим, когда книга освободится"
                )
            failure = nil
            await load()
        } catch {
            notice = nil
            failure = LibraryReaderError.message(for: error)
        }
    }

    @MainActor
    func cancel(reservationID: String) async {
        guard !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            _ = try await api.cancelReservation(id: reservationID)
            notice = String(localized: "library.cancelled", defaultValue: "Бронь отменена")
            failure = nil
            await load()
        } catch {
            notice = nil
            failure = LibraryReaderError.message(for: error)
        }
    }
}

/// Экземпляр по коду с QR-наклейки: найти книгу, чтобы открыть её карточку.
@Observable
final class LibraryCopyModel {
    private(set) var bookID: String?
    private(set) var failure: String?

    private let api: LibraryFetching
    private let code: String

    init(code: String, api: LibraryFetching = LibraryAPI()) {
        self.code = code
        self.api = api
    }

    @MainActor
    func resolve() async {
        do {
            bookID = try await api.copy(code: code).book.id
            failure = nil
        } catch {
            if LibraryReaderError.isModuleOff(error) {
                failure = LibraryReaderError.message(for: error)
            } else if (error as? APIError)?.code == .notFound {
                // Чужой вуз и неизвестный код сервер не различает — и мы не различаем.
                failure = String(
                    localized: "library.copyNotFound",
                    defaultValue: "Код неизвестен или наклейку перевыпустили. Найдите книгу в каталоге."
                )
            } else {
                failure = LibraryReaderError.message(for: error)
            }
        }
    }
}

// MARK: - Мои книги

@Observable
final class MyBooksModel {
    private(set) var books: MyBooks?
    private(set) var isLoading = false
    private(set) var failure: String?
    private(set) var notice: String?
    private(set) var isDisabled = false
    /// Над какой выдачей или бронью сейчас идёт запрос — её кнопка показывает загрузку.
    private(set) var working: String?

    private let api: LibraryFetching
    private var loans: [LoanDTO] = []
    private var reservations: [ReservationDTO] = []

    init(api: LibraryFetching = LibraryAPI()) {
        self.api = api
    }

    @MainActor
    func refresh() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        let api = self.api
        do {
            async let loans = api.myLoans()
            async let reservations = api.myReservations()
            self.loans = try await loans
            self.reservations = try await reservations
            books = MyBooks(loans: self.loans, reservations: self.reservations)
            isDisabled = false
            failure = nil
        } catch {
            // Данные с прошлого раза не стираем: вчерашний список с пометкой об ошибке
            // лучше пустого экрана.
            if LibraryReaderError.isModuleOff(error) {
                isDisabled = true
            } else {
                failure = LibraryReaderError.message(for: error)
            }
        }
    }

    /// «Это не я»: выдача записана на читателя по ошибке. Решает библиотекарь, а здесь
    /// выдача только получает отметку.
    @MainActor
    func dispute(_ loanID: String) async {
        guard working == nil else { return }
        working = loanID
        defer { working = nil }
        do {
            let updated = try await api.dispute(loanID: loanID)
            loans = loans.map { $0.id == updated.id ? updated : $0 }
            books = MyBooks(loans: loans, reservations: reservations)
            notice = String(localized: "library.disputedToast", defaultValue: "Библиотекарь получил отметку")
            failure = nil
        } catch {
            notice = nil
            failure = LibraryReaderError.message(for: error)
        }
    }

    @MainActor
    func cancel(reservationID: String) async {
        guard working == nil else { return }
        working = reservationID
        defer { working = nil }
        do {
            _ = try await api.cancelReservation(id: reservationID)
            reservations.removeAll { $0.id == reservationID }
            books = MyBooks(loans: loans, reservations: reservations)
            notice = String(localized: "library.cancelled", defaultValue: "Бронь отменена")
            failure = nil
        } catch {
            notice = nil
            failure = LibraryReaderError.message(for: error)
        }
    }
}
