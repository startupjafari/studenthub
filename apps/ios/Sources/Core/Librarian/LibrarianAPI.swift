import Foundation

// Библиотека глазами библиотекаря (PROJECT.md §3.11, Фаза 20): выдача и приём, выдачи,
// брони, фонд и экземпляры, инвентаризация, отчёты, справки «задолженностей нет».
// Контракт — `packages/shared-schemas/src/library.ts` и контроллеры `apps/api/src/modules/
// library`. Студенческий клиент (`Core/Library/LibraryAPI.swift`) нарочно узкий; здесь —
// поля, которые нужны стойке. Значения перечислений — строки: незнакомое не роняет разбор.

// MARK: - Настройки и сводка

/// Включена ли библиотека вуза и правила выдачи.
struct LibrarianSettingsDTO: Decodable, Equatable {
    let enabled: Bool
    let defaultLoanDays: Int?
    let maxLoanDays: Int?
    let maxActiveLoans: Int?
    let maxRenewals: Int?
}

/// Сводка фонда и выдач (`GET /library/reports/summary`).
struct LibrarianSummaryDTO: Decodable, Equatable {
    struct Copies: Decodable, Equatable {
        let total: Int
        let available: Int
        let onLoan: Int
        let reserved: Int
        let lost: Int
        let writtenOff: Int
    }

    struct Loans: Decodable, Equatable {
        let open: Int
        let overdue: Int
        let issuedLast30: Int
        let returnedLast30: Int
        let withoutPhoneLast30: Int?
    }

    struct Readers: Decodable, Equatable {
        let withLoans: Int
        let debtors: Int
    }

    struct Reservations: Decodable, Equatable {
        let queued: Int
        let ready: Int
    }

    let books: Int
    let copies: Copies
    let loans: Loans
    let readers: Readers
    let reservations: Reservations
}

// MARK: - Фонд

struct LibrarianAvailabilityDTO: Decodable, Equatable {
    let total: Int
    let available: Int
    let onLoan: Int
    let reserved: Int
}

/// Книга в каталоге фонда.
struct LibrarianBookDTO: Decodable, Equatable, Identifiable {
    let id: String
    let title: String
    let authors: String
    let isbn: String?
    let publisher: String?
    let year: Int?
    let section: String?
    let description: String?
    let coverUrl: String?
    let archived: Bool?
    let availability: LibrarianAvailabilityDTO

    var isArchived: Bool { archived == true }
}

/// Экземпляр: инвентарный номер, код наклейки, кому выдан сейчас.
struct LibrarianCopyDTO: Decodable, Equatable, Identifiable {
    struct Loan: Decodable, Equatable {
        let id: String
        let readerName: String
        let readerGroup: String?
        let dueAt: Date
    }

    let id: String
    let inventoryNumber: String
    let code: String
    /// `AVAILABLE`, `RESERVED`, `ON_LOAN`, `LOST`, `WRITTEN_OFF`.
    let status: String
    /// `GOOD`, `WORN`, `DAMAGED`.
    let condition: String
    let note: String?
    let inventoriedAt: Date?
    let loan: Loan?
}

/// Книга с экземплярами — для тех, кто ведёт фонд.
struct LibrarianBookDetailDTO: Decodable, Equatable, Identifiable {
    let id: String
    let title: String
    let authors: String
    let isbn: String?
    let publisher: String?
    let year: Int?
    let section: String?
    let description: String?
    let coverUrl: String?
    let archived: Bool?
    let availability: LibrarianAvailabilityDTO
    let copies: [LibrarianCopyDTO]

    var isArchived: Bool { archived == true }
}

/// Наклейка экземпляра: что напечатать рядом с QR (`qr` — data:image/png).
struct LibrarianCopyLabelDTO: Decodable, Equatable, Identifiable {
    let copyId: String
    let inventoryNumber: String
    let code: String
    let title: String
    let authors: String
    let university: String
    let url: String
    let qr: String

    var id: String { copyId }
}

/// Экземпляр по коду с наклейки — для сканера библиотекаря.
struct LibrarianCopyByCodeDTO: Decodable, Equatable {
    let copy: LibrarianCopyDTO
    let book: LibrarianBookDTO
}

/// Карточка книги: новые поля и правка. Пустое необязательное поле при правке очищается.
struct LibrarianBookForm: Equatable {
    var title = ""
    var authors = ""
    var isbn = ""
    var publisher = ""
    var year = ""
    var section = ""
    var description = ""
}

/// Строка проверки импорта фонда.
struct LibrarianImportRowDTO: Decodable, Equatable, Identifiable {
    let line: Int
    let title: String
    let authors: String
    let isbn: String?
    let publisher: String?
    let year: Int?
    let section: String?
    let inventoryNumbers: [String]
    let count: Int
    /// `READY`, `DUPLICATE`, `ERROR`.
    let status: String
    let error: String?

    var id: Int { line }
}

struct LibrarianImportPreviewDTO: Decodable, Equatable {
    struct Summary: Decodable, Equatable {
        let total: Int
        let ready: Int
        let duplicate: Int
        let error: Int
        let copies: Int
    }

    let rows: [LibrarianImportRowDTO]
    let summary: Summary
}

struct LibrarianImportResultDTO: Decodable, Equatable {
    let books: Int
    let matched: Int
    let copies: Int
    let skipped: Int
}

// MARK: - Читатели и выдачи

/// Читатель глазами библиотеки: узкая карточка, как у охраны.
struct LibrarianReaderDTO: Decodable, Equatable {
    let id: String
    let firstName: String
    let lastName: String
    let middleName: String?
    let avatarUrl: String?
    let group: String?
    let faculty: String?
    let studentCardNumber: String?
    let academicStatus: String?
    let course: Int?

    var fullName: String { DisplayFormat.name(first: firstName, last: lastName, middle: middleName) }
}

struct LibrarianEligibilityDTO: Decodable, Equatable {
    let canBorrow: Bool
    let activeLoans: Int
    let maxActiveLoans: Int
    let overdueLoans: Int
    let lostLoans: Int?
    /// `status`, `limit`, `overdue`, `lost`.
    let blockers: [String]
}

/// Выдача книги читателю.
struct LibrarianLoanDTO: Decodable, Equatable, Identifiable {
    struct Book: Decodable, Equatable {
        let id: String
        let title: String
        let authors: String
        let coverUrl: String?
    }

    struct Copy: Decodable, Equatable {
        let id: String
        let inventoryNumber: String
    }

    struct Reader: Decodable, Equatable {
        let id: String?
        let name: String
        let group: String?
        let card: String?
        /// `EXPELLED`, `GRADUATED`, `TRANSFERRED` — читатель ушёл из вуза.
        let leftStatus: String?
    }

    let id: String
    /// `OPEN`, `RETURNED`, `LOST`, `CANCELLED`.
    let status: String
    let issuedAt: Date
    let dueAt: Date
    /// Последний день срока «ГГГГ-ММ-ДД» по часам вуза — его и показываем.
    let dueDate: String
    let overdue: Bool
    let renewals: Int
    let returnedAt: Date?
    let cancelledAt: Date?
    let cancelReason: String?
    let disputedAt: Date?
    let lostSettledAt: Date?
    let withoutPhone: Bool?
    let book: Book
    let copy: Copy
    let reader: Reader
    let issuedBy: String?

    /// Утерянная книга без отметки «долг погашен» — долг читателя.
    var isLostDebt: Bool { status == "LOST" && lostSettledAt == nil }

    /// «Отменить возврат» — в течение суток после возврата; остальное проверит сервер.
    var canCancelReturn: Bool {
        guard status == "RETURNED", let returnedAt else { return false }
        return Date().timeIntervalSince(returnedAt) <= 24 * 3600
    }
}

/// Ответ сканера студенческого: читатель, может ли брать книги, его выдачи и пропуск.
struct LibrarianReaderSessionDTO: Decodable, Equatable {
    let reader: LibrarianReaderDTO
    let eligibility: LibrarianEligibilityDTO
    /// `qr` — скан студенческого, `card` — номер билета (читатель без телефона).
    let via: String?
    let ticket: String
    let ticketExpiresAt: Date
    let loans: [LibrarianLoanDTO]
    let defaultDueDate: String
    let maxDueDate: String
}

/// Возврат принят: и — если на книгу была очередь — кому отложить экземпляр.
struct LibrarianReturnResultDTO: Decodable, Equatable, Identifiable {
    struct HeldFor: Decodable, Equatable {
        let name: String
        let group: String?
        let holdUntil: Date
    }

    let loan: LibrarianLoanDTO
    let heldFor: HeldFor?

    var id: String { loan.id }
}

/// Удостоверение читателя по открытой выдаче: просмотр пишется в журнал.
struct LibrarianReaderCardDTO: Decodable, Equatable {
    struct Loan: Decodable, Equatable {
        let id: String
        let bookTitle: String
        let inventoryNumber: String
        let issuedAt: Date
        let dueDate: String
    }

    let reader: LibrarianReaderDTO
    let loan: Loan
    let viewedAt: Date
}

// MARK: - Брони, справки, отчёты

struct LibrarianReservationDTO: Decodable, Equatable, Identifiable {
    struct Reader: Decodable, Equatable {
        let id: String
        let name: String
        let group: String?
    }

    let id: String
    /// `QUEUED`, `READY`, `FULFILLED`, `CANCELLED`, `EXPIRED`.
    let status: String
    let createdAt: Date
    let readyAt: Date?
    let holdUntil: Date?
    let holdDate: String?
    let closedAt: Date?
    let position: Int?
    let book: LibrarianLoanDTO.Book
    let copy: LibrarianLoanDTO.Copy?
    let reader: Reader

    var isActive: Bool { status == "READY" || status == "QUEUED" }
}

/// Справка «задолженностей нет» с кодом проверки.
struct LibrarianClearanceDTO: Decodable, Equatable, Identifiable {
    struct Reader: Decodable, Equatable {
        let id: String?
        let name: String?
    }

    let code: String
    let number: String?
    let issuedAt: Date
    let revokedAt: Date?
    let reader: Reader

    var id: String { code }
}

/// Проверка документа по коду из бланка (`GET /verify/:code`).
struct LibrarianDocumentCheckDTO: Decodable, Equatable {
    let code: String
    let kind: String?
    let number: String?
    let issuer: String?
    let subject: String?
    let issuedAt: Date?
    let revokedAt: Date?
    /// `VALID`, `REVOKED`.
    let status: String
}

struct LibrarianPopularDTO: Decodable, Equatable, Identifiable {
    let book: LibrarianLoanDTO.Book
    let loans: Int

    var id: String { book.id }
}

/// Скан при инвентаризации: экземпляр на месте.
struct LibrarianInventoryScanDTO: Decodable, Equatable, Identifiable {
    struct Copy: Decodable, Equatable {
        let id: String
        let inventoryNumber: String
        let status: String
    }

    struct Book: Decodable, Equatable {
        let id: String
        let title: String
        let authors: String
    }

    let copy: Copy
    let book: Book
    let alreadyChecked: Bool
    /// `onLoan`, `lost`, `writtenOff`.
    let warning: String?

    var id: String { copy.id }
}

struct LibrarianInventoryMissingDTO: Decodable, Equatable, Identifiable {
    let copyId: String
    let inventoryNumber: String
    let status: String
    let inventoriedAt: Date?
    let book: LibrarianInventoryScanDTO.Book

    var id: String { copyId }
}

/// Ход инвентаризации с даты: отмечено и что из «должно быть на полке» не нашли.
struct LibrarianInventoryReportDTO: Decodable, Equatable {
    let since: String
    let expected: Int
    let checked: Int
    let onLoan: Int
    let items: [LibrarianInventoryMissingDTO]
    let total: Int
    let page: Int
    let limit: Int
}

/// Экземпляр для выдачи, возврата, инвентаризации: код наклейки или инвентарный номер,
/// когда наклейка стёрлась. Не смешиваются: восьмизначный номер неотличим от кода.
enum LibrarianCopyRef: Equatable {
    case code(String)
    case inventory(String)

    var fields: [String: JSONValue] {
        switch self {
        case .code(let code): return ["copyCode": .string(code)]
        case .inventory(let number): return ["inventoryNumber": .string(number.trimmingCharacters(in: .whitespaces))]
        }
    }
}

// MARK: - Клиент

struct LibrarianAPI {
    private let client: APIClient

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    private static func encode(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? value
    }

    // MARK: Настройки и отчёты

    func settings() async throws -> LibrarianSettingsDTO {
        try await client.send(.get("library/settings"), as: LibrarianSettingsDTO.self)
    }

    func summary() async throws -> LibrarianSummaryDTO {
        try await client.send(.get("library/reports/summary"), as: LibrarianSummaryDTO.self)
    }

    func popular(days: Int) async throws -> [LibrarianPopularDTO] {
        try await client.send(
            .get("library/reports/popular", query: [URLQueryItem(name: "days", value: String(days))]),
            as: [LibrarianPopularDTO].self
        )
    }

    // MARK: Фонд

    func books(_ request: PageRequest, query: String?, section: String?, available: Bool, archived: Bool, sort: String?, order: String?) async throws -> Page<LibrarianBookDTO> {
        try await client.page(
            .get("library/books", params: [
                "page": String(request.page),
                "limit": String(min(request.limit, 100)),
                "q": query,
                "section": section,
                "available": available ? "true" : nil,
                "archived": archived ? "true" : nil,
                "sort": sort,
                "order": order,
            ]),
            of: LibrarianBookDTO.self
        )
    }

    func sections() async throws -> [String] {
        try await client.send(.get("library/books/sections"), as: [String].self)
    }

    func book(id: String) async throws -> LibrarianBookDetailDTO {
        try await client.send(.get("library/books/\(id)"), as: LibrarianBookDetailDTO.self)
    }

    func createBook(_ form: LibrarianBookForm) async throws -> LibrarianBookDTO {
        var fields: [String: JSONValue] = [
            "title": .string(form.title.trimmingCharacters(in: .whitespacesAndNewlines)),
            "authors": .string(form.authors.trimmingCharacters(in: .whitespacesAndNewlines)),
        ]
        // Создание: пустые необязательные поля не отправляются — схема их не ждёт.
        for (key, value) in [("isbn", form.isbn), ("publisher", form.publisher), ("section", form.section), ("description", form.description)] {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { fields[key] = .string(trimmed) }
        }
        if let year = Int(form.year.trimmingCharacters(in: .whitespaces)) { fields["year"] = .number(Double(year)) }
        return try await client.send(.post("library/books", json: JSONBody(fields)), as: LibrarianBookDTO.self)
    }

    func updateBook(id: String, form: LibrarianBookForm) async throws -> LibrarianBookDTO {
        let year = Int(form.year.trimmingCharacters(in: .whitespaces))
        let fields: [String: JSONValue] = [
            "title": .string(form.title.trimmingCharacters(in: .whitespacesAndNewlines)),
            "authors": .string(form.authors.trimmingCharacters(in: .whitespacesAndNewlines)),
            "isbn": .text(form.isbn),
            "publisher": .text(form.publisher),
            "year": .int(year),
            "section": .text(form.section),
            "description": .text(form.description),
        ]
        return try await client.send(.patch("library/books/\(id)", json: JSONBody(fields)), as: LibrarianBookDTO.self)
    }

    func setArchived(bookID: String, archived: Bool) async throws -> LibrarianBookDTO {
        try await client.send(
            .patch("library/books/\(bookID)", json: JSONBody(["archived": .bool(archived)])),
            as: LibrarianBookDTO.self
        )
    }

    func uploadCover(bookID: String, data: Data, mime: String, filename: String) async throws -> LibrarianBookDTO {
        var form = MultipartForm()
        form.append(data, name: "file", filename: filename, mime: mime)
        return try await client.send(.multipart("library/books/\(bookID)/cover", form: form), as: LibrarianBookDTO.self)
    }

    func addCopies(bookID: String, count: Int?, inventoryNumbers: [String]?, condition: String) async throws -> [LibrarianCopyDTO] {
        var fields: [String: JSONValue] = ["condition": .string(condition)]
        if let inventoryNumbers { fields["inventoryNumbers"] = .strings(inventoryNumbers) }
        if let count { fields["count"] = .number(Double(count)) }
        return try await client.send(.post("library/books/\(bookID)/copies", json: JSONBody(fields)), as: [LibrarianCopyDTO].self)
    }

    func updateCopy(id: String, fields: [String: JSONValue]) async throws -> LibrarianCopyDTO {
        try await client.send(.patch("library/copies/\(id)", json: JSONBody(fields)), as: LibrarianCopyDTO.self)
    }

    func rotateCode(copyID: String) async throws -> LibrarianCopyLabelDTO {
        try await client.send(.post("library/copies/\(copyID)/code/rotate"), as: LibrarianCopyLabelDTO.self)
    }

    func labels(copyIDs: [String]) async throws -> [LibrarianCopyLabelDTO] {
        try await client.send(
            .post("library/copies/labels", json: JSONBody(["copyIds": .strings(copyIDs)])),
            as: [LibrarianCopyLabelDTO].self
        )
    }

    func copy(code: String) async throws -> LibrarianCopyByCodeDTO {
        try await client.send(.get("library/copies/by-code/\(Self.encode(code))"), as: LibrarianCopyByCodeDTO.self)
    }

    func importPreview(data: Data, filename: String) async throws -> LibrarianImportPreviewDTO {
        var form = MultipartForm()
        let mime = filename.lowercased().hasSuffix(".csv")
            ? "text/csv"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        form.append(data, name: "file", filename: filename, mime: mime)
        return try await client.send(.multipart("library/import/preview", form: form), as: LibrarianImportPreviewDTO.self)
    }

    func importCommit(rows: [LibrarianImportRowDTO]) async throws -> LibrarianImportResultDTO {
        let body: [JSONValue] = rows.map { row in
            .object([
                "line": .number(Double(row.line)),
                "title": .string(row.title),
                "authors": .string(row.authors),
                "isbn": row.isbn.map(JSONValue.string) ?? .null,
                "publisher": row.publisher.map(JSONValue.string) ?? .null,
                "year": .int(row.year),
                "section": row.section.map(JSONValue.string) ?? .null,
                "inventoryNumbers": .strings(row.inventoryNumbers),
                "count": .number(Double(row.count)),
            ])
        }
        return try await client.send(.post("library/import", json: JSONBody(["rows": .array(body)])), as: LibrarianImportResultDTO.self)
    }

    // MARK: Читатели и выдачи

    func resolveReader(token: String) async throws -> LibrarianReaderSessionDTO {
        try await client.send(.post("library/readers/resolve", json: JSONBody(["token": .string(token)])), as: LibrarianReaderSessionDTO.self)
    }

    func lookupReader(card: String) async throws -> LibrarianReaderSessionDTO {
        try await client.send(
            .post("library/readers/lookup", json: JSONBody(["studentCardNumber": .string(card)])),
            as: LibrarianReaderSessionDTO.self
        )
    }

    func issue(ticket: String, copy: LibrarianCopyRef, dueDate: String?, withoutPhone: Bool) async throws -> LibrarianLoanDTO {
        var fields = copy.fields
        fields["ticket"] = .string(ticket)
        if let dueDate { fields["dueDate"] = .string(dueDate) }
        if withoutPhone { fields["withoutPhone"] = .bool(true) }
        return try await client.send(.post("library/loans", json: JSONBody(fields)), as: LibrarianLoanDTO.self)
    }

    func returnCopy(_ copy: LibrarianCopyRef, condition: String) async throws -> LibrarianReturnResultDTO {
        var fields = copy.fields
        fields["condition"] = .string(condition)
        return try await client.send(.post("library/returns", json: JSONBody(fields)), as: LibrarianReturnResultDTO.self)
    }

    /// `filter`: `open`, `overdue`, `lost`, `closed`, `all`.
    func loans(_ request: PageRequest, filter: String, query: String? = nil, copyID: String? = nil, withoutPhone: Bool = false) async throws -> Page<LibrarianLoanDTO> {
        try await client.page(
            .get("library/loans", params: [
                "page": String(request.page),
                "limit": String(min(request.limit, 100)),
                "filter": filter,
                "q": query,
                "copyId": copyID,
                "withoutPhone": withoutPhone ? "true" : nil,
            ]),
            of: LibrarianLoanDTO.self
        )
    }

    func renew(loanID: String, dueDate: String?) async throws -> LibrarianLoanDTO {
        var fields: [String: JSONValue] = [:]
        if let dueDate { fields["dueDate"] = .string(dueDate) }
        return try await client.send(.post("library/loans/\(loanID)/renew", json: JSONBody(fields)), as: LibrarianLoanDTO.self)
    }

    func markLost(loanID: String) async throws -> LibrarianLoanDTO {
        try await client.send(.post("library/loans/\(loanID)/lost"), as: LibrarianLoanDTO.self)
    }

    func settleLost(loanID: String) async throws -> LibrarianLoanDTO {
        try await client.send(.post("library/loans/\(loanID)/lost/settle"), as: LibrarianLoanDTO.self)
    }

    func cancelLoan(loanID: String, reason: String) async throws -> LibrarianLoanDTO {
        try await client.send(.post("library/loans/\(loanID)/cancel", json: JSONBody(["reason": .string(reason)])), as: LibrarianLoanDTO.self)
    }

    func cancelReturn(loanID: String, reason: String) async throws -> LibrarianLoanDTO {
        try await client.send(.post("library/loans/\(loanID)/return/cancel", json: JSONBody(["reason": .string(reason)])), as: LibrarianLoanDTO.self)
    }

    func readerCard(loanID: String) async throws -> LibrarianReaderCardDTO {
        try await client.send(.get("library/loans/\(loanID)/reader"), as: LibrarianReaderCardDTO.self)
    }

    // MARK: Брони

    /// `filter`: `active`, `ready`, `queued`, `closed`, `all`.
    func reservations(_ request: PageRequest, filter: String, query: String? = nil) async throws -> Page<LibrarianReservationDTO> {
        try await client.page(
            .get("library/reservations", params: [
                "page": String(request.page),
                "limit": String(min(request.limit, 100)),
                "filter": filter,
                "q": query,
            ]),
            of: LibrarianReservationDTO.self
        )
    }

    func cancelReservation(id: String) async throws -> LibrarianReservationDTO {
        try await client.send(.post("library/reservations/\(id)/cancel"), as: LibrarianReservationDTO.self)
    }

    // MARK: Справки

    /// `status`: `active`, `revoked`, `all`.
    func clearances(_ request: PageRequest, status: String) async throws -> Page<LibrarianClearanceDTO> {
        try await client.page(
            .get("library/clearances", params: [
                "page": String(request.page),
                "limit": String(min(request.limit, 100)),
                "status": status,
            ]),
            of: LibrarianClearanceDTO.self
        )
    }

    func revokeClearance(code: String, reason: String) async throws -> LibrarianClearanceDTO {
        try await client.send(
            .post("library/clearances/\(Self.encode(code))/revoke", json: JSONBody(["reason": .string(reason)])),
            as: LibrarianClearanceDTO.self
        )
    }

    func checkDocument(code: String) async throws -> LibrarianDocumentCheckDTO {
        try await client.send(.get("verify/\(Self.encode(code))"), as: LibrarianDocumentCheckDTO.self)
    }

    // MARK: Инвентаризация

    func inventoryScan(_ copy: LibrarianCopyRef, since: String) async throws -> LibrarianInventoryScanDTO {
        var fields = copy.fields
        fields["since"] = .string(since)
        return try await client.send(.post("library/inventory/scan", json: JSONBody(fields)), as: LibrarianInventoryScanDTO.self)
    }

    func inventory(since: String, page: Int, limit: Int) async throws -> LibrarianInventoryReportDTO {
        try await client.send(
            .get("library/inventory", params: ["since": since, "page": String(page), "limit": String(limit)]),
            as: LibrarianInventoryReportDTO.self
        )
    }
}
