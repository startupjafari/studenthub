import Foundation

// Библиотека вуза глазами читателя — студента и старосты (PROJECT.md §3.11, Фаза 20).
// Источник контракта — `packages/shared-schemas/src/library.ts`. Поля — только те, что
// показывает приложение: лишнее обязательное поле превращает любое изменение на сервере
// в падение разбора у тех, кто не обновился.

// MARK: - Контракты

/// Настройки библиотеки вуза. Читателю из них нужно одно — включена ли она вообще:
/// выключенная библиотека не показывается в списке разделов.
struct LibrarySettingsDTO: Decodable, Equatable {
    let enabled: Bool
}

/// Сколько экземпляров книги в каком состоянии. Утерянные и списанные в `total` не входят.
struct BookAvailabilityDTO: Decodable, Equatable {
    let total: Int
    let available: Int
    let onLoan: Int
    let reserved: Int
}

/// Карточка книги в каталоге.
struct BookCardDTO: Decodable, Equatable, Identifiable {
    let id: String
    let title: String
    let authors: String
    let isbn: String?
    let publisher: String?
    let year: Int?
    let section: String?
    let description: String?
    let coverUrl: String?
    let availability: BookAvailabilityDTO

    /// «Авторы · год» — строка под названием. Пустые части выпадают, а не оставляют
    /// висящую точку.
    var byline: String {
        [authors.isEmpty ? nil : authors, year.map(String.init)]
            .compactMap { $0 }
            .joined(separator: " · ")
    }
}

/// Книга внутри выдачи и брони: снимок, а не ссылка на карточку.
struct LibraryBookRefDTO: Decodable, Equatable {
    let id: String
    let title: String
    let authors: String
    let coverUrl: String?
}

struct LibraryCopyRefDTO: Decodable, Equatable {
    let id: String
    let inventoryNumber: String
}

/// Экземпляр по коду с QR-наклейки. Читателю из ответа нужна только книга — к ней и ведём.
struct BookCopyByCodeDTO: Decodable, Equatable {
    let book: BookCardDTO
}

/// Статус выдачи. Незнакомое значение не роняет разбор: новый статус на сервере
/// появится раньше, чем все обновят приложение.
enum LoanStatus: String, Decodable, Equatable {
    case open = "OPEN"
    case returned = "RETURNED"
    case lost = "LOST"
    case cancelled = "CANCELLED"
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = LoanStatus(rawValue: raw) ?? .unknown
    }
}

/// Выдача книги читателю.
struct LoanDTO: Decodable, Equatable, Identifiable {
    let id: String
    let status: LoanStatus
    let issuedAt: Date
    /// Последний день срока «ГГГГ-ММ-ДД» по часам вуза — его и показываем, а не момент
    /// `dueAt`: в другом часовом поясе момент съехал бы на соседний день.
    let dueDate: String
    let overdue: Bool
    /// Читатель отметил выдачу «Это не я» — решает библиотекарь.
    let disputedAt: Date?
    let book: LibraryBookRefDTO
    let copy: LibraryCopyRefDTO
}

enum ReservationStatus: String, Decodable, Equatable {
    case queued = "QUEUED"
    case ready = "READY"
    case fulfilled = "FULFILLED"
    case cancelled = "CANCELLED"
    case expired = "EXPIRED"
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ReservationStatus(rawValue: raw) ?? .unknown
    }

    /// Бронь ещё действует: готова или ждёт в очереди.
    var isActive: Bool { self == .ready || self == .queued }
}

/// Бронь книги.
struct ReservationDTO: Decodable, Equatable, Identifiable {
    let id: String
    let status: ReservationStatus
    /// Последний день, до которого держится готовая бронь, «ГГГГ-ММ-ДД» по часам вуза.
    let holdDate: String?
    /// Место в очереди (1 — следующий) — только у брони в очереди.
    let position: Int?
    let book: LibraryBookRefDTO
    /// Отложенный экземпляр — у готовой брони.
    let copy: LibraryCopyRefDTO?
}

/// Поиск по каталогу. Пагинация серверная, по страницам: число страниц считается по
/// `meta.total`.
struct BookQuery: Equatable, Hashable {
    static let pageLimit = 20

    var text = ""
    var section: String?
    var onlyAvailable = false

    func items(page: Int, limit: Int = BookQuery.pageLimit) -> [URLQueryItem] {
        var items = [
            URLQueryItem(name: "page", value: String(page)),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            items.append(URLQueryItem(name: "q", value: String(trimmed.prefix(100))))
        }
        if let section, !section.isEmpty {
            items.append(URLQueryItem(name: "section", value: section))
        }
        if onlyAvailable {
            items.append(URLQueryItem(name: "available", value: "true"))
        }
        return items
    }

    /// Есть ли что-то кроме пустого запроса — от этого зависит текст пустого списка.
    var isFiltered: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || section != nil || onlyAvailable
    }
}

// MARK: - Клиент

protocol LibraryFetching: Sendable {
    func settings() async throws -> LibrarySettingsDTO
    func books(_ query: BookQuery, page: Int) async throws -> Page<BookCardDTO>
    func sections() async throws -> [String]
    func book(id: String) async throws -> BookCardDTO
    func copy(code: String) async throws -> BookCopyByCodeDTO
    func myLoans() async throws -> [LoanDTO]
    func dispute(loanID: String) async throws -> LoanDTO
    func reserve(bookID: String) async throws -> ReservationDTO
    func myReservations() async throws -> [ReservationDTO]
    func cancelReservation(id: String) async throws -> ReservationDTO
}

struct LibraryAPI: LibraryFetching {
    private let client: APIClient

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    func settings() async throws -> LibrarySettingsDTO {
        try await client.send(.get("library/settings"), as: LibrarySettingsDTO.self)
    }

    func books(_ query: BookQuery, page: Int) async throws -> Page<BookCardDTO> {
        try await client.page(.get("library/books", query: query.items(page: page)), of: BookCardDTO.self)
    }

    func sections() async throws -> [String] {
        try await client.send(.get("library/books/sections"), as: [String].self)
    }

    func book(id: String) async throws -> BookCardDTO {
        try await client.send(.get("library/books/\(id)"), as: BookCardDTO.self)
    }

    func copy(code: String) async throws -> BookCopyByCodeDTO {
        try await client.send(.get("library/copies/by-code/\(code)"), as: BookCopyByCodeDTO.self)
    }

    func myLoans() async throws -> [LoanDTO] {
        try await client.send(.get("library/me/loans"), as: [LoanDTO].self)
    }

    func dispute(loanID: String) async throws -> LoanDTO {
        try await client.send(.post("library/loans/\(loanID)/dispute"), as: LoanDTO.self)
    }

    /// Свободный экземпляр есть — бронь сразу готова, нет — человек встаёт в очередь.
    /// Решает сервер, поэтому запрос один и тот же.
    func reserve(bookID: String) async throws -> ReservationDTO {
        try await client.send(.post("library/books/\(bookID)/reservations"), as: ReservationDTO.self)
    }

    func myReservations() async throws -> [ReservationDTO] {
        try await client.send(.get("library/me/reservations"), as: [ReservationDTO].self)
    }

    func cancelReservation(id: String) async throws -> ReservationDTO {
        try await client.send(.post("library/me/reservations/\(id)/cancel"), as: ReservationDTO.self)
    }
}

// MARK: - Отказы

/// Отказы библиотеки на языке читателя.
///
/// Сервер отвечает `409` с полем в `details`, и текст выбираем по полю, а не берём
/// серверный: тот обращён к библиотекарю («читатель отчислен»), а здесь говорим с самим
/// студентом («книги не выдаются: вы отчислены»). Формулировки — из веба
/// (`LibraryReader.error.*`).
enum LibraryReaderError {
    /// Поле отказа, если это наш `409`.
    static func field(of error: Error) -> String? {
        guard case .server(.conflict, _, let details, _)? = error as? APIError else { return nil }
        return details.first?.field
    }

    /// Библиотеку вуза выключили — экран не ошибку показывает, а «Библиотека выключена».
    static func isModuleOff(_ error: Error) -> Bool {
        field(of: error) == "module"
    }

    static func message(for error: Error) -> String {
        if let field = field(of: error), let text = byField(field) {
            return text
        }
        if (error as? APIError)?.code == .notFound {
            return String(localized: "library.error.notFound", defaultValue: "Книга не найдена")
        }
        return (error as? APIError)?.displayMessage
            ?? String(localized: "error.unexpected", defaultValue: "Неожиданный ответ сервера")
    }

    private static func byField(_ field: String) -> String? {
        switch field {
        case "status":
            return String(
                localized: "library.error.status",
                defaultValue: "Книги не выдаются: вы отчислены, выпущены или переведены"
            )
        case "overdue":
            return String(
                localized: "library.error.overdue",
                defaultValue: "У вас просрочена книга — сначала верните её"
            )
        case "reservationLimit":
            return String(
                localized: "library.error.reservationLimit",
                defaultValue: "Достигнут предел броней — отмените одну из действующих"
            )
        case "alreadyReserved":
            return String(
                localized: "library.error.alreadyReserved",
                defaultValue: "Эта книга уже забронирована вами"
            )
        case "alreadyBorrowed":
            return String(localized: "library.error.alreadyBorrowed", defaultValue: "Эта книга уже у вас на руках")
        case "noCopies":
            return String(
                localized: "library.error.noCopies",
                defaultValue: "Экземпляров этой книги в библиотеке нет"
            )
        case "closed":
            return String(localized: "library.error.closed", defaultValue: "Бронь уже закрыта")
        case "module":
            return String(localized: "library.disabledTitle", defaultValue: "Библиотека выключена")
        default:
            return nil
        }
    }
}

// MARK: - Даты и тексты

/// Дата «ГГГГ-ММ-ДД» по часам вуза.
///
/// Это календарный день, а не момент: разбираем его в полночь по местному календарю,
/// чтобы при форматировании не уехать на соседний день.
enum LibraryDay {
    static func date(from raw: String, calendar: Calendar = .current) -> Date? {
        let parts = raw.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    /// «5 нояб.» — так срок показывает и веб. Неразобранную строку отдаём как есть:
    /// лучше «2026-11-05», чем пустое место там, где человек ищет срок.
    static func short(_ raw: String) -> String {
        guard let date = date(from: raw) else { return raw }
        return date.formatted(.dateTime.day().month(.abbreviated))
    }
}

/// Подстановка в шаблон строки: `{title}` → значение.
///
/// Шаблон с именованными местами, а не с `%@`: переводчик видит, что куда встаёт, и
/// может переставить места (в казахском число стоит в другом порядке), а каталог
/// строк хранит текст ровно таким, как он написан в коде.
enum LibraryText {
    static func fill(_ template: String, _ values: [String: String]) -> String {
        values.reduce(template) { text, pair in
            text.replacingOccurrences(of: "{\(pair.key)}", with: pair.value)
        }
    }
}
