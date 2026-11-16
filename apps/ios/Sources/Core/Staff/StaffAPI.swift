import Foundation

// Общие разделы сотрудников вуза: очередь заявок, каталог услуг, типы и шаблоны документов,
// журнал документов, библиотека глазами администратора, публикации, события, журналы охраны.
// Контракты — `apps/api/src/modules/{application-services,documents,document-templates,library,
// posts,events,security-journal}`, схемы тел — `packages/shared-schemas/src`.
//
// Поля, которых может не быть в ответе, — необязательные: экраны общие для нескольких ролей,
// и сервер отдаёт им разный объём.

// MARK: - Локализованные тройки

/// Сервер отдаёт названия тройками `…Ru/…Kk/…En`. Интерфейс приложения по-русски, но
/// пустое русское поле (старая услуга) не должно давать пустую строку.
enum StaffLocale {
    static func pick(_ ru: String?, _ kk: String?, _ en: String?) -> String {
        let code = Locale.current.language.languageCode?.identifier ?? "ru"
        let preferred: String?
        switch code {
        case "kk": preferred = kk
        case "en": preferred = en
        default: preferred = ru
        }
        for candidate in [preferred, ru, en, kk] {
            if let value = candidate?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty {
                return value
            }
        }
        return ""
    }

    /// Язык бланка справки и проверочного документа.
    static var code: String {
        let code = Locale.current.language.languageCode?.identifier ?? "ru"
        return ["ru", "kk", "en"].contains(code) ? code : "ru"
    }
}

/// Человек в узкой форме: id и ФИО.
struct StaffPersonRef: Decodable, Equatable, Hashable {
    let id: String?
    var firstName: String? = nil
    var lastName: String? = nil
    var name: String? = nil
    var avatarUrl: String? = nil
    var avatarThumbUrl: String? = nil

    var displayName: String {
        if let name, !name.isEmpty { return name }
        let joined = [lastName, firstName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
        return joined.isEmpty ? "—" : joined
    }
}

/// Ссылка на файл в хранилище: подписанная и короткоживущая.
struct StaffURLAnswer: Decodable {
    let url: URL
    var fileName: String? = nil
}

// MARK: - Заявки

struct StaffRequirementRef: Decodable, Equatable, Identifiable {
    let id: String
    var documentType: String? = nil
    var titleRu: String? = nil
    var titleKk: String? = nil
    var titleEn: String? = nil
    var required: Bool? = nil

    var title: String { StaffLocale.pick(titleRu, titleKk, titleEn) }
}

struct StaffFieldOption: Codable, Equatable, Hashable {
    var value: String
    var labelRu: String
    var labelKk: String
    var labelEn: String

    init(value: String, labelRu: String, labelKk: String, labelEn: String) {
        self.value = value
        self.labelRu = labelRu
        self.labelKk = labelKk
        self.labelEn = labelEn
    }

    /// У старых вариантов перевода могло не быть — подставляем значение, иначе форма
    /// услуги не пройдёт проверку при сохранении.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        value = try container.decode(String.self, forKey: .value)
        labelRu = (try? container.decodeIfPresent(String.self, forKey: .labelRu)) ?? value
        labelKk = (try? container.decodeIfPresent(String.self, forKey: .labelKk)) ?? value
        labelEn = (try? container.decodeIfPresent(String.self, forKey: .labelEn)) ?? value
    }

    var label: String { StaffLocale.pick(labelRu, labelKk, labelEn) }
}

/// Поле анкеты в карточке заявки — по нему ответы `formData` показываются с подписями.
struct StaffApplicationFormField: Decodable, Equatable, Identifiable {
    let id: String
    let code: String
    let type: String
    var labelRu: String? = nil
    var labelKk: String? = nil
    var labelEn: String? = nil
    var options: [StaffFieldOption]? = nil

    var label: String { StaffLocale.pick(labelRu, labelKk, labelEn) }
}

struct StaffApplicationServiceRef: Decodable, Equatable {
    let id: String
    var code: String? = nil
    var nameRu: String? = nil
    var nameKk: String? = nil
    var nameEn: String? = nil
    var slaHours: Int? = nil
    var deliveryModes: [String]? = nil
    var requirements: [StaffRequirementRef]? = nil
    var formFields: [StaffApplicationFormField]? = nil

    var name: String { StaffLocale.pick(nameRu, nameKk, nameEn) }
}

struct StaffApplicationStudent: Decodable, Equatable {
    let id: String
    var firstName: String? = nil
    var lastName: String? = nil
    var groupId: String? = nil

    var name: String { DisplayFormat.name(first: firstName, last: lastName) }
}

struct StaffApplicationEvent: Decodable, Equatable, Identifiable {
    let id: String
    let action: String
    var fromStatus: String? = nil
    var toStatus: String? = nil
    var comment: String? = nil
    var actorId: String? = nil
    let createdAt: Date
    var requirementId: String? = nil
}

struct StaffApplicationDocument: Decodable, Equatable, Identifiable {
    struct File: Decodable, Equatable, Identifiable {
        let id: String
        var mime: String? = nil
        var order: Int? = nil
    }

    struct Requirement: Decodable, Equatable {
        let id: String
        var titleRu: String? = nil
        var titleKk: String? = nil
        var titleEn: String? = nil
        var required: Bool? = nil

        var title: String { StaffLocale.pick(titleRu, titleKk, titleEn) }
    }

    let id: String
    let requirementId: String
    var documentId: String? = nil
    var source: String? = nil
    let status: String
    var reviewComment: String? = nil
    var snapshotTitle: String? = nil
    var requirement: Requirement? = nil
    var files: [File]? = nil
}

struct StaffApplicationResult: Decodable, Equatable, Identifiable {
    let id: String
    let type: String
    var documentId: String? = nil
    var documentNumber: String? = nil
    var note: String? = nil
    var createdAt: Date? = nil
    var revoked: Bool? = nil
}

/// Заявка: строка очереди и карточка. Поля карточки (`events`, `documents`, `results`)
/// у строки списка просто отсутствуют.
struct StaffApplication: Decodable, Equatable, Identifiable {
    let id: String
    var number: String? = nil
    let status: String
    var deliveryType: String? = nil
    var formData: [String: JSONValue]? = nil
    var studentId: String? = nil
    var facultyId: String? = nil
    var assignedToId: String? = nil
    var submittedAt: Date? = nil
    var dueAt: Date? = nil
    var readyAt: Date? = nil
    var issuedAt: Date? = nil
    var createdAt: Date? = nil
    var service: StaffApplicationServiceRef? = nil
    var student: StaffApplicationStudent? = nil
    var rejectionReason: String? = nil
    var pickupLocation: String? = nil
    var pickupInstructions: String? = nil
    var events: [StaffApplicationEvent]? = nil
    var documents: [StaffApplicationDocument]? = nil
    var results: [StaffApplicationResult]? = nil

    /// Срок уже не «горит», если заявка закрыта, лежит на выдаче или ждёт студента —
    /// как у фильтра «Просрочено» на сервере.
    var isOverdue: Bool {
        guard let dueAt, dueAt < Date() else { return false }
        return !StaffApplicationQuery.settled.contains(status)
    }

    var hasActiveResult: Bool { (results ?? []).contains { $0.revoked != true } }

    var isClosed: Bool { ["ISSUED", "DELIVERED", "REJECTED", "CANCELLED"].contains(status) }
}

struct StaffApplicationAssignee: Decodable, Equatable, Identifiable, Hashable {
    let id: String
    var firstName: String? = nil
    var lastName: String? = nil
    var role: String? = nil

    var name: String { DisplayFormat.name(first: firstName, last: lastName) }
}

/// Фильтр очереди: статус, «просрочено», услуга, поиск, сортировка.
struct StaffApplicationQuery: Equatable {
    /// Статусы, в которых срок уже не «горит».
    static let settled = ["ISSUED", "DELIVERED", "REJECTED", "CANCELLED", "READY", "READY_FOR_PICKUP", "NEEDS_CORRECTION"]

    var status: String?
    var overdue = false
    var serviceID: String?
    var search = ""
    var sortBy = "submittedAt"
    var ascending = false

    func items(_ request: PageRequest) -> [URLQueryItem] {
        var items = request.pageQuery
        if overdue {
            items.append(URLQueryItem(name: "overdue", value: "true"))
        } else if let status {
            items.append(URLQueryItem(name: "status", value: status))
        }
        if let serviceID { items.append(URLQueryItem(name: "serviceId", value: serviceID)) }
        let needle = search.trimmingCharacters(in: .whitespaces)
        if !needle.isEmpty { items.append(URLQueryItem(name: "search", value: String(needle.prefix(120)))) }
        items.append(URLQueryItem(name: "sortBy", value: sortBy))
        items.append(URLQueryItem(name: "sortOrder", value: ascending ? "asc" : "desc"))
        return items
    }
}

/// Результат заявки (`AddApplicationResultSchema`).
struct StaffResultInput: Encodable {
    var type: String
    var fileId: String?
    var documentType: String?
    var documentNumber: String?
    var note: String?
}

struct StaffCertificateAnswer: Decodable {
    let documentId: String?
    let verificationCode: String
}

struct StaffUploadedFile: Decodable {
    let id: String
}

/// Услуга из каталога студента: в очереди по ней фильтруют.
struct StaffCatalogCategory: Decodable, Identifiable {
    struct Service: Decodable, Identifiable, Hashable {
        let id: String
        var nameRu: String? = nil
        var nameKk: String? = nil
        var nameEn: String? = nil

        var name: String { StaffLocale.pick(nameRu, nameKk, nameEn) }
    }

    let id: String
    var nameRu: String? = nil
    var nameKk: String? = nil
    var nameEn: String? = nil
    var services: [Service] = []

    var name: String { StaffLocale.pick(nameRu, nameKk, nameEn) }
}

// MARK: - Каталог услуг

struct StaffManageCategory: Decodable, Equatable, Identifiable, Hashable {
    let id: String
    var code: String? = nil
    var nameRu: String? = nil
    var nameKk: String? = nil
    var nameEn: String? = nil

    var name: String { StaffLocale.pick(nameRu, nameKk, nameEn) }
}

struct StaffManagedServiceRow: Decodable, Equatable, Identifiable {
    let id: String
    let code: String
    var universityId: String? = nil
    var nameRu: String? = nil
    var nameKk: String? = nil
    var nameEn: String? = nil
    var slaHours: Int? = nil
    var deliveryModes: [String]? = nil
    var active: Bool = true
    var category: StaffManageCategory? = nil
    var isTemplate: Bool = false
    var customizedId: String? = nil
    var requirementsCount: Int? = nil
    var formFieldsCount: Int? = nil

    var name: String { StaffLocale.pick(nameRu, nameKk, nameEn) }
    /// Шаблон, который вуз уже настроил: студенты видят копию, а не его.
    var isReplaced: Bool { isTemplate && customizedId != nil }
}

struct StaffServiceRequirement: Codable, Equatable, Identifiable {
    var code: String
    var documentType: String?
    var titleRu: String
    var titleKk: String
    var titleEn: String
    var description: String?
    var required: Bool
    var allowStorage: Bool
    var allowUpload: Bool
    var maxFiles: Int

    var id: String { code }

    static func empty() -> StaffServiceRequirement {
        StaffServiceRequirement(
            code: StaffServiceRequirement.newCode("doc"), documentType: nil, titleRu: "", titleKk: "", titleEn: "",
            description: nil, required: true, allowStorage: true, allowUpload: true, maxFiles: 1
        )
    }

    /// Код строки — служебный ключ синхронизации: по нему сервер узнаёт строку при
    /// сохранении. Админу его видеть незачем, новые строки получают его сами.
    static func newCode(_ prefix: String) -> String {
        let stamp = String(Int(Date().timeIntervalSince1970 * 1000), radix: 36)
        let tail = String(UUID().uuidString.lowercased().filter(\.isLetter).prefix(4))
        return "\(prefix)-\(stamp)\(tail)"
    }
}

struct StaffServiceFormField: Codable, Equatable, Identifiable {
    var code: String
    var type: String
    var labelRu: String
    var labelKk: String
    var labelEn: String
    var placeholderRu: String?
    var placeholderKk: String?
    var placeholderEn: String?
    var required: Bool
    var options: [StaffFieldOption]?

    var id: String { code }

    static func empty() -> StaffServiceFormField {
        StaffServiceFormField(
            code: StaffServiceRequirement.newCode("field"), type: "TEXT", labelRu: "", labelKk: "", labelEn: "",
            placeholderRu: nil, placeholderKk: nil, placeholderEn: nil, required: false, options: nil
        )
    }

    var isChoice: Bool { type == "SELECT" || type == "RADIO" }
}

/// Услуга целиком — тело `POST/PUT application-services` (`UpsertApplicationServiceSchema`)
/// и одновременно черновик редактора.
struct StaffServiceDraft: Codable, Equatable {
    var categoryId: String
    var code: String
    var nameRu: String
    var nameKk: String
    var nameEn: String
    var descriptionRu: String?
    var descriptionKk: String?
    var descriptionEn: String?
    var instructionsRu: String?
    var instructionsKk: String?
    var instructionsEn: String?
    var slaHours: Int
    var deliveryModes: [String]
    var requiresPickup: Bool
    var facultyScoped: Bool
    var active: Bool
    var sortOrder: Int
    var requirements: [StaffServiceRequirement]
    var formFields: [StaffServiceFormField]

    static func empty() -> StaffServiceDraft {
        StaffServiceDraft(
            categoryId: "", code: "", nameRu: "", nameKk: "", nameEn: "",
            descriptionRu: nil, descriptionKk: nil, descriptionEn: nil,
            instructionsRu: nil, instructionsKk: nil, instructionsEn: nil,
            slaHours: 24, deliveryModes: ["ELECTRONIC"], requiresPickup: false, facultyScoped: true,
            active: true, sortOrder: 0, requirements: [], formFields: []
        )
    }
}

/// Услуга для редактора: черновик плюс признаки «шаблон» и «можно править».
struct StaffServiceDetail: Decodable, Equatable {
    let id: String
    var universityId: String?
    var isTemplate: Bool
    var editable: Bool
    var draft: StaffServiceDraft

    private enum Keys: String, CodingKey {
        case id, universityId, isTemplate, editable
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: Keys.self)
        id = try container.decode(String.self, forKey: .id)
        universityId = try container.decodeIfPresent(String.self, forKey: .universityId)
        isTemplate = (try container.decodeIfPresent(Bool.self, forKey: .isTemplate)) ?? false
        editable = (try container.decodeIfPresent(Bool.self, forKey: .editable)) ?? true
        draft = try StaffServiceDraft(from: decoder)
    }
}

// MARK: - Типы документов

struct StaffDocumentType: Decodable, Equatable, Identifiable {
    let typeId: String
    let category: String
    var fields: [String] = []
    var custom: Bool = false
    var enabled: Bool = true
    var retentionDays: Int? = nil
    var label: String? = nil

    var id: String { typeId }
    var title: String { custom ? (label ?? typeId) : StaffDocText.typeTitle(typeId) }
}

// MARK: - Шаблоны документов

struct StaffTemplateIssue: Decodable, Equatable, Hashable {
    let code: String
    var tag: String? = nil
    var part: String? = nil
}

struct StaffTemplateValidation: Decodable, Equatable {
    var valid: Bool = false
    var variables: [String] = []
    var errors: [StaffTemplateIssue] = []
    var warnings: [StaffTemplateIssue] = []
}

struct StaffTemplateVersion: Decodable, Equatable, Identifiable {
    let id: String
    let version: Int
    var fileName: String? = nil
    var size: Int? = nil
    var checksum: String? = nil
    var createdAt: Date? = nil
    var createdBy: StaffPersonRef? = nil
    var validation: StaffTemplateValidation = StaffTemplateValidation()
}

struct StaffTemplate: Decodable, Equatable, Identifiable {
    struct VersionRef: Decodable, Equatable {
        let id: String
        let version: Int
        var valid: Bool? = nil
    }

    let id: String
    let title: String
    let category: String
    var description: String? = nil
    var locale: String = "ru"
    let status: String
    var createdAt: Date? = nil
    var updatedAt: Date? = nil
    var publishedAt: Date? = nil
    var author: StaffPersonRef? = nil
    var variableCount: Int = 0
    var currentVersion: VersionRef? = nil
    var publishedVersion: VersionRef? = nil
    var hasUnpublishedChanges: Bool = false
    /// Только в карточке.
    var versions: [StaffTemplateVersion]? = nil
    var generationCount: Int? = nil
}

struct StaffTemplateInput: Encodable {
    var title: String
    var category: String
    var description: String?
    var locale: String
}

/// Файл, который сервер отдал телом ответа: DOCX документа студента или проверочный.
struct StaffDownloadedFile: Identifiable {
    let url: URL
    var id: URL { url }
}

// MARK: - Журнал документов

struct StaffDocJournalItem: Decodable, Equatable, Identifiable {
    struct Actor: Decodable, Equatable {
        let id: String
        var name: String? = nil
        var role: String? = nil
    }

    struct Owner: Decodable, Equatable {
        let id: String
        var name: String? = nil
    }

    struct Document: Decodable, Equatable {
        let id: String
        var category: String? = nil
        var type: String? = nil
        var deleted: Bool? = nil
    }

    struct Request: Decodable, Equatable {
        let id: String
        let title: String
    }

    let id: String
    let createdAt: Date
    let action: String
    let actor: Actor
    let owner: Owner
    let document: Document
    var via: String? = nil
    var granteeType: String? = nil
    var request: Request? = nil
}

// MARK: - Библиотека

struct StaffLibrarySettings: Decodable, Equatable {
    var enabled: Bool
    var defaultLoanDays: Int
    var maxLoanDays: Int
    var maxActiveLoans: Int
    var maxActiveReservations: Int
    var reservationHoldDays: Int
    var maxRenewals: Int
    var updatedAt: Date? = nil
}

struct StaffLibrarySummary: Decodable, Equatable {
    struct Copies: Decodable, Equatable {
        var total = 0, available = 0, onLoan = 0, reserved = 0, lost = 0, writtenOff = 0
    }

    struct Loans: Decodable, Equatable {
        var open = 0, overdue = 0, issuedLast30 = 0, returnedLast30 = 0
        var withoutPhoneLast30: Int? = nil
    }

    struct Readers: Decodable, Equatable {
        var withLoans = 0, debtors = 0
    }

    struct Reservations: Decodable, Equatable {
        var queued = 0, ready = 0
    }

    var books = 0
    var copies = Copies()
    var loans = Loans()
    var readers = Readers()
    var reservations = Reservations()
}

struct StaffBookRef: Decodable, Equatable, Hashable {
    let id: String
    let title: String
    var authors: String? = nil
    var coverUrl: String? = nil
}

struct StaffPopularBook: Decodable, Equatable, Identifiable {
    let book: StaffBookRef
    let loans: Int

    var id: String { book.id }
}

struct StaffLoan: Decodable, Equatable, Identifiable {
    struct Reader: Decodable, Equatable {
        var id: String? = nil
        let name: String
        var group: String? = nil
        var card: String? = nil
        var leftStatus: String? = nil
    }

    struct Copy: Decodable, Equatable {
        let id: String
        let inventoryNumber: String
    }

    let id: String
    let status: String
    let issuedAt: Date
    let dueAt: Date
    var dueDate: String? = nil
    var overdue: Bool = false
    var renewals: Int? = nil
    var returnedAt: Date? = nil
    var cancelledAt: Date? = nil
    var cancelReason: String? = nil
    var lostSettledAt: Date? = nil
    var withoutPhone: Bool? = nil
    let book: StaffBookRef
    let copy: Copy
    let reader: Reader
    var issuedBy: String? = nil
}

struct StaffIdAccessItem: Decodable, Equatable, Identifiable {
    let id: String
    let createdAt: Date
    let librarianName: String
    var readerId: String? = nil
    let readerName: String
    var loanId: String? = nil
    var bookTitle: String? = nil
    var ip: String? = nil
    var withoutPhone: Bool? = nil
}

struct StaffBookAvailability: Decodable, Equatable {
    var total = 0
    var available = 0
    var onLoan = 0
    var reserved = 0
}

struct StaffBookCopy: Decodable, Equatable, Identifiable {
    struct Loan: Decodable, Equatable {
        let id: String
        let readerName: String
        var readerGroup: String? = nil
        let dueAt: Date
    }

    let id: String
    let inventoryNumber: String
    let code: String
    let status: String
    let condition: String
    var note: String? = nil
    var inventoriedAt: Date? = nil
    var loan: Loan? = nil
}

struct StaffBook: Decodable, Equatable, Identifiable {
    let id: String
    let title: String
    var authors: String = ""
    var isbn: String? = nil
    var publisher: String? = nil
    var year: Int? = nil
    var section: String? = nil
    var description: String? = nil
    var coverUrl: String? = nil
    var archived: Bool = false
    var availability = StaffBookAvailability()
    /// Только в карточке фонда.
    var copies: [StaffBookCopy]? = nil
}

struct StaffCopyLabel: Decodable, Equatable, Identifiable {
    let copyId: String
    let inventoryNumber: String
    let code: String
    let title: String
    var authors: String? = nil
    var university: String? = nil
    var url: String? = nil
    /// PNG в data-URL.
    let qr: String

    var id: String { copyId }
}

struct StaffImportRow: Codable, Equatable, Identifiable {
    let line: Int
    let title: String
    var authors: String = ""
    var isbn: String? = nil
    var publisher: String? = nil
    var year: Int? = nil
    var section: String? = nil
    var inventoryNumbers: [String] = []
    var count: Int = 0
    var status: String? = nil
    var error: String? = nil

    var id: Int { line }
}

struct StaffImportPreview: Decodable, Equatable {
    struct Summary: Decodable, Equatable {
        var total = 0, ready = 0, duplicate = 0, error = 0, copies = 0
    }

    let rows: [StaffImportRow]
    let summary: Summary
}

struct StaffImportResult: Decodable, Equatable {
    var books = 0, matched = 0, copies = 0, skipped = 0
}

struct StaffBookInput: Encodable {
    var title: String
    var authors: String
    var isbn: String?
    var publisher: String?
    var year: Int?
    var section: String?
    var description: String?
}

// MARK: - Структура вуза для аудиторий

struct StaffFaculty: Decodable, Equatable, Identifiable, Hashable {
    let id: String
    let name: String
}

struct StaffGroup: Decodable, Equatable, Identifiable, Hashable {
    let id: String
    let name: String
    var facultyId: String? = nil
}

/// Человек из поиска: админский список или справочник людей.
struct StaffUserPick: Decodable, Equatable, Identifiable, Hashable {
    let id: String
    var firstName: String? = nil
    var lastName: String? = nil
    var role: String? = nil
    var email: String? = nil
    var avatarThumbUrl: String? = nil
    var groupName: String? = nil
    var facultyName: String? = nil

    var name: String { DisplayFormat.name(first: firstName, last: lastName) }
}

// MARK: - События

struct StaffEvent: Decodable, Equatable, Identifiable {
    struct Counts: Decodable, Equatable {
        var participants: Int = 0
    }

    let id: String
    var audience: String? = nil
    let title: String
    var description: String? = nil
    var location: String? = nil
    var isOnline: Bool = false
    var meetingProvider: String? = nil
    var careerKind: String? = nil
    let startsAt: Date
    var endsAt: Date? = nil
    var organizerId: String? = nil
    var organizer: StaffPersonRef? = nil
    var counts: Counts? = nil
    var isRegistered: Bool = false
    var canManage: Bool? = nil

    enum CodingKeys: String, CodingKey {
        case id, audience, title, description, location, isOnline, meetingProvider, careerKind
        case startsAt, endsAt, organizerId, organizer, isRegistered, canManage
        case counts = "_count"
    }

    var participants: Int { counts?.participants ?? 0 }

    /// Завершилось — по концу, а не по началу: без конца событие длится два часа, как
    /// считает сервер.
    var isPast: Bool {
        (endsAt ?? startsAt.addingTimeInterval(2 * 60 * 60)) < Date()
    }
}

struct StaffEventParticipant: Decodable, Equatable, Identifiable {
    struct User: Decodable, Equatable {
        var firstName: String? = nil
        var lastName: String? = nil
        var avatarThumbUrl: String? = nil
        var role: String? = nil
        var group: StaffNamed? = nil
        var faculty: StaffNamed? = nil
    }

    let userId: String
    var createdAt: Date? = nil
    let user: User

    var id: String { userId }
}

struct StaffNamed: Decodable, Equatable {
    let name: String
}

struct StaffEventMeeting: Decodable, Equatable {
    let provider: String
    let url: String
    var passcode: String? = nil
    var joinable: Bool = false
    var joinableFrom: Date? = nil
}

struct StaffEventComment: Decodable, Equatable, Identifiable {
    struct Reply: Decodable, Equatable {
        let id: String
        var author: StaffPersonRef? = nil
        var content: String? = nil
        var deleted: Bool? = nil
    }

    struct Media: Decodable, Equatable, Identifiable {
        let id: String
        var mime: String? = nil
        var name: String? = nil
        var size: Int? = nil
    }

    struct Reaction: Decodable, Equatable {
        let emoji: String
        let userId: String
    }

    let id: String
    var content: String = ""
    let createdAt: Date
    let author: StaffPersonRef
    var media: [Media]? = nil
    var reactions: [Reaction]? = nil
    var replyTo: Reply? = nil
    var canDelete: Bool? = nil
}

// MARK: - Журналы охраны

struct StaffSecuritySummary: Decodable, Equatable {
    struct Passes: Decodable, Equatable {
        var total = 0, allowed = 0, denied = 0
    }

    struct Visitors: Decodable, Equatable {
        var today = 0, inside = 0
    }

    var date: String? = nil
    var passes = Passes()
    var visitors = Visitors()
}

struct StaffPass: Decodable, Equatable, Identifiable {
    struct Student: Decodable, Equatable {
        var id: String? = nil
        let name: String
        var group: String? = nil
    }

    let id: String
    let createdAt: Date
    let allowed: Bool
    var denyReason: String? = nil
    var student: Student? = nil
    var guardName: String? = nil
}

struct StaffVisitor: Decodable, Equatable, Identifiable {
    let id: String
    let fullName: String
    let purpose: String
    var documentType: String? = nil
    var documentLast4: String? = nil
    var phone: String? = nil
    let enteredAt: Date
    var exitedAt: Date? = nil
    var createdByName: String? = nil
}

// MARK: - API

struct StaffAPI {
    private let client: APIClient

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    // MARK: Заявки

    func applications(_ query: StaffApplicationQuery, _ request: PageRequest) async throws -> Page<StaffApplication> {
        try await client.page(.get("applications", query: query.items(request)), of: StaffApplication.self)
    }

    func application(id: String) async throws -> StaffApplication {
        try await client.send(.get("applications/\(id)"), as: StaffApplication.self)
    }

    func catalogCategories() async throws -> [StaffCatalogCategory] {
        try await client.send(.get("application-categories"), as: [StaffCatalogCategory].self)
    }

    func take(_ id: String) async throws {
        try await client.send(.post("applications/\(id)/take"))
    }

    func startPreparation(_ id: String) async throws {
        try await client.send(.post("applications/\(id)/start-preparation"))
    }

    func requestCorrection(_ id: String, comment: String) async throws {
        try await client.send(try .post("applications/\(id)/request-correction", json: ["comment": comment]))
    }

    func reject(_ id: String, reason: String) async throws {
        try await client.send(try .post("applications/\(id)/reject", json: ["reason": reason]))
    }

    func markReady(_ id: String, pickupLocation: String?) async throws {
        var body: [String: String] = [:]
        if let pickupLocation, !pickupLocation.isEmpty { body["pickupLocation"] = pickupLocation }
        try await client.send(try .post("applications/\(id)/mark-ready", json: body))
    }

    func issue(_ id: String, pickupCode: String) async throws {
        try await client.send(try .post("applications/\(id)/issue", json: ["pickupCode": pickupCode]))
    }

    func deliver(_ id: String) async throws {
        try await client.send(.post("applications/\(id)/deliver"))
    }

    func acceptDocument(_ id: String, docID: String) async throws {
        try await client.send(.post("applications/\(id)/documents/\(docID)/accept"))
    }

    func requestReplacement(_ id: String, docID: String, comment: String) async throws {
        try await client.send(
            try .post("applications/\(id)/documents/\(docID)/request-replacement", json: ["comment": comment])
        )
    }

    func documentURL(_ id: String, docID: String, fileID: String?) async throws -> URL {
        var query: [URLQueryItem] = []
        if let fileID { query.append(URLQueryItem(name: "fileId", value: fileID)) }
        return try await client.send(
            .get("applications/\(id)/documents/\(docID)/url", query: query), as: StaffURLAnswer.self
        ).url
    }

    func resultURL(_ id: String, resultID: String) async throws -> URL {
        try await client.send(
            .get("applications/\(id)/results/\(resultID)/url", query: [URLQueryItem(name: "download", value: "1")]),
            as: StaffURLAnswer.self
        ).url
    }

    func assignees(_ id: String) async throws -> [StaffApplicationAssignee] {
        try await client.send(.get("applications/\(id)/assignees"), as: [StaffApplicationAssignee].self)
    }

    func assign(_ id: String, userID: String) async throws {
        try await client.send(try .post("applications/\(id)/assign", json: ["userId": userID]))
    }

    func addResult(_ id: String, _ input: StaffResultInput) async throws {
        try await client.send(try .post("applications/\(id)/results", json: input))
    }

    /// Справку об обучении собирает сервер: бланк, документ студенту, запись результата.
    func issueCertificate(_ id: String) async throws -> StaffCertificateAnswer {
        let endpoint = Endpoint(
            method: .post,
            path: "applications/\(id)/results/certificate",
            query: [URLQueryItem(name: "locale", value: StaffLocale.code)]
        )
        return try await client.send(endpoint, as: StaffCertificateAnswer.self)
    }

    func revokeCertificate(_ id: String, reason: String?) async throws {
        var body: [String: String] = [:]
        if let reason, !reason.isEmpty { body["reason"] = reason }
        try await client.send(try .post("applications/\(id)/results/certificate/revoke", json: body))
    }

    /// Файл результата — тем же маршрутом, что документы кабинета: сервер заведёт документ
    /// на имя студента по `fileId`.
    func uploadDocumentFile(_ data: Data, name: String, mime: String) async throws -> StaffUploadedFile {
        var form = MultipartForm()
        form.append(data, name: "file", filename: name, mime: mime)
        return try await client.send(.multipart("documents/upload", form: form), as: StaffUploadedFile.self)
    }

    // MARK: Каталог услуг

    func manageCategories() async throws -> [StaffManageCategory] {
        try await client.send(.get("application-categories/manage"), as: [StaffManageCategory].self)
    }

    func managedServices(search: String, _ request: PageRequest) async throws -> Page<StaffManagedServiceRow> {
        var query = request.pageQuery
        let needle = search.trimmingCharacters(in: .whitespaces)
        if !needle.isEmpty { query.append(URLQueryItem(name: "search", value: needle)) }
        return try await client.page(.get("application-services/manage", query: query), of: StaffManagedServiceRow.self)
    }

    func managedService(id: String) async throws -> StaffServiceDetail {
        try await client.send(.get("application-services/manage/\(id)"), as: StaffServiceDetail.self)
    }

    func createService(_ draft: StaffServiceDraft) async throws {
        try await client.send(try .post("application-services", json: draft))
    }

    func updateService(id: String, _ draft: StaffServiceDraft) async throws {
        try await client.send(try .put("application-services/\(id)", json: draft))
    }

    struct CreatedID: Decodable {
        let id: String
    }

    func customizeService(id: String) async throws -> String {
        try await client.send(.post("application-services/\(id)/customize"), as: CreatedID.self).id
    }

    // MARK: Типы документов

    func documentTypes() async throws -> [StaffDocumentType] {
        try await client.send(.get("document-types"), as: [StaffDocumentType].self)
    }

    func effectiveDocumentTypes() async throws -> [StaffDocumentType] {
        try await client.send(.get("document-types/effective"), as: [StaffDocumentType].self)
    }

    /// `retentionDays: nil` с флагом `clearRetention` уходит как `null` — снять срок.
    func updateDocumentType(_ typeID: String, enabled: Bool? = nil, retentionDays: Int? = nil, clearRetention: Bool = false) async throws {
        var fields: [String: JSONValue] = [:]
        if let enabled { fields["enabled"] = .bool(enabled) }
        if clearRetention {
            fields["retentionDays"] = .null
        } else if let retentionDays {
            fields["retentionDays"] = .int(retentionDays)
        }
        try await client.send(try .patch("document-types/\(typeID)", json: JSONBody(fields)))
    }

    func createDocumentType(code: String, category: String, label: String, fields: [String], retentionDays: Int?) async throws {
        var body: [String: JSONValue] = [
            "code": .string(code),
            "category": .string(category),
            "label": .string(label),
        ]
        if !fields.isEmpty { body["fields"] = .strings(fields) }
        if let retentionDays { body["retentionDays"] = .int(retentionDays) }
        try await client.send(try .post("document-types", json: JSONBody(body)))
    }

    func deleteDocumentType(_ typeID: String) async throws {
        try await client.send(.delete("document-types/\(typeID)"))
    }

    // MARK: Шаблоны документов

    func templates(search: String, status: String?, category: String?, _ request: PageRequest) async throws -> Page<StaffTemplate> {
        var query = request.pageQuery
        let needle = search.trimmingCharacters(in: .whitespaces)
        if !needle.isEmpty { query.append(URLQueryItem(name: "search", value: String(needle.prefix(100)))) }
        if let status { query.append(URLQueryItem(name: "status", value: status)) }
        if let category { query.append(URLQueryItem(name: "category", value: category)) }
        return try await client.page(.get("document-templates", query: query), of: StaffTemplate.self)
    }

    func template(id: String) async throws -> StaffTemplate {
        try await client.send(.get("document-templates/\(id)"), as: StaffTemplate.self)
    }

    func createTemplate(_ input: StaffTemplateInput) async throws -> StaffTemplate {
        try await client.send(try .post("document-templates", json: input), as: StaffTemplate.self)
    }

    func updateTemplate(id: String, title: String, category: String, description: String?, locale: String) async throws {
        let body = JSONBody([
            "title": .string(title),
            "category": .string(category),
            "description": .text(description),
            "locale": .string(locale),
        ])
        try await client.send(try .patch("document-templates/\(id)", json: body))
    }

    struct RemoveAnswer: Decodable {
        let archived: Bool
    }

    func deleteTemplate(id: String) async throws -> Bool {
        try await client.send(.delete("document-templates/\(id)"), as: RemoveAnswer.self).archived
    }

    func uploadTemplateVersion(id: String, data: Data, name: String) async throws {
        var form = MultipartForm()
        form.append(data, name: "file", filename: name, mime: StaffAPI.docxMime)
        try await client.send(.multipart("document-templates/\(id)/versions", form: form))
    }

    func templateSource(id: String, versionID: String) async throws -> StaffURLAnswer {
        try await client.send(.get("document-templates/\(id)/versions/\(versionID)/source"), as: StaffURLAnswer.self)
    }

    func publishTemplate(id: String) async throws {
        try await client.send(.post("document-templates/\(id)/publish"))
    }

    func unpublishTemplate(id: String) async throws {
        try await client.send(.post("document-templates/\(id)/unpublish"))
    }

    /// Проверочный документ на демо-данных — DOCX телом ответа.
    func testTemplate(id: String, versionID: String?) async throws -> Data {
        var query: [URLQueryItem] = []
        if let versionID { query.append(URLQueryItem(name: "versionId", value: versionID)) }
        return try await client.data(Endpoint(method: .post, path: "document-templates/\(id)/test", query: query))
    }

    /// Документ для студента — DOCX телом ответа; данные сервер берёт из профиля.
    func generateTemplate(id: String, studentID: String) async throws -> Data {
        try await client.data(try .post("document-templates/\(id)/generate", json: ["studentId": studentID]))
    }

    static let docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

    // MARK: Журнал документов

    func documentJournal(
        search: String, action: String?, from: Date?, to: Date?, userID: String?, _ request: PageRequest
    ) async throws -> Page<StaffDocJournalItem> {
        var query = request.pageQuery
        let needle = search.trimmingCharacters(in: .whitespaces)
        if !needle.isEmpty { query.append(URLQueryItem(name: "q", value: String(needle.prefix(100)))) }
        if let action { query.append(URLQueryItem(name: "action", value: action)) }
        if let from { query.append(URLQueryItem(name: "from", value: JSONCoding.isoString(from))) }
        if let to { query.append(URLQueryItem(name: "to", value: JSONCoding.isoString(to))) }
        if let userID { query.append(URLQueryItem(name: "userId", value: userID)) }
        return try await client.page(.get("document-journal", query: query), of: StaffDocJournalItem.self)
    }

    // MARK: Библиотека

    func librarySettings() async throws -> StaffLibrarySettings {
        try await client.send(.get("library/settings"), as: StaffLibrarySettings.self)
    }

    func updateLibrarySettings(_ fields: [String: JSONValue]) async throws -> StaffLibrarySettings {
        try await client.send(try .patch("library/settings", json: JSONBody(fields)), as: StaffLibrarySettings.self)
    }

    func librarySummary() async throws -> StaffLibrarySummary {
        try await client.send(.get("library/reports/summary"), as: StaffLibrarySummary.self)
    }

    func popularBooks(days: Int) async throws -> [StaffPopularBook] {
        try await client.send(
            .get("library/reports/popular", query: [URLQueryItem(name: "days", value: String(days))]),
            as: [StaffPopularBook].self
        )
    }

    func loans(filter: String, copyID: String? = nil, limit: Int) async throws -> [StaffLoan] {
        var query = [
            URLQueryItem(name: "filter", value: filter),
            URLQueryItem(name: "page", value: "1"),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        if let copyID { query.append(URLQueryItem(name: "copyId", value: copyID)) }
        return try await client.page(.get("library/loans", query: query), of: StaffLoan.self).items
    }

    func idAccess(search: String, _ request: PageRequest) async throws -> Page<StaffIdAccessItem> {
        var query = request.pageQuery
        let needle = search.trimmingCharacters(in: .whitespaces)
        if !needle.isEmpty { query.append(URLQueryItem(name: "q", value: String(needle.prefix(100)))) }
        return try await client.page(.get("library/id-access", query: query), of: StaffIdAccessItem.self)
    }

    func books(search: String, section: String?, available: Bool, archived: Bool, _ request: PageRequest) async throws -> Page<StaffBook> {
        var query = request.pageQuery
        let needle = search.trimmingCharacters(in: .whitespaces)
        if !needle.isEmpty { query.append(URLQueryItem(name: "q", value: String(needle.prefix(100)))) }
        if let section { query.append(URLQueryItem(name: "section", value: section)) }
        if available { query.append(URLQueryItem(name: "available", value: "true")) }
        if archived { query.append(URLQueryItem(name: "archived", value: "true")) }
        return try await client.page(.get("library/books", query: query), of: StaffBook.self)
    }

    func bookSections() async throws -> [String] {
        try await client.send(.get("library/books/sections"), as: [String].self)
    }

    func book(id: String) async throws -> StaffBook {
        try await client.send(.get("library/books/\(id)"), as: StaffBook.self)
    }

    func createBook(_ input: StaffBookInput) async throws -> StaffBook {
        try await client.send(try .post("library/books", json: input), as: StaffBook.self)
    }

    /// Правка карточки: пустое необязательное поле уходит `null` — так сервер его очищает.
    func updateBook(id: String, _ input: StaffBookInput) async throws {
        let body = JSONBody([
            "title": .string(input.title),
            "authors": .string(input.authors),
            "isbn": .text(input.isbn),
            "publisher": .text(input.publisher),
            "year": .int(input.year),
            "section": .text(input.section),
            "description": .text(input.description),
        ])
        try await client.send(try .patch("library/books/\(id)", json: body))
    }

    func setBookArchived(id: String, archived: Bool) async throws {
        try await client.send(try .patch("library/books/\(id)", json: JSONBody(["archived": .bool(archived)])))
    }

    func uploadBookCover(id: String, data: Data) async throws {
        var form = MultipartForm()
        form.append(data, name: "file", filename: "cover.jpg", mime: "image/jpeg")
        try await client.send(.multipart("library/books/\(id)/cover", form: form))
    }

    func addCopies(bookID: String, count: Int?, inventoryNumbers: [String]?, condition: String) async throws {
        var body: [String: JSONValue] = ["condition": .string(condition)]
        if let inventoryNumbers, !inventoryNumbers.isEmpty {
            body["inventoryNumbers"] = .strings(inventoryNumbers)
        } else {
            body["count"] = .int(count ?? 1)
        }
        try await client.send(try .post("library/books/\(bookID)/copies", json: JSONBody(body)))
    }

    func updateCopy(id: String, inventoryNumber: String?, condition: String?, note: String?, status: String?) async throws {
        var body: [String: JSONValue] = ["note": .text(note)]
        if let inventoryNumber { body["inventoryNumber"] = .string(inventoryNumber) }
        if let condition { body["condition"] = .string(condition) }
        if let status { body["status"] = .string(status) }
        try await client.send(try .patch("library/copies/\(id)", json: JSONBody(body)))
    }

    func rotateCopyCode(id: String) async throws -> StaffCopyLabel {
        try await client.send(.post("library/copies/\(id)/code/rotate"), as: StaffCopyLabel.self)
    }

    func copyLabels(_ ids: [String]) async throws -> [StaffCopyLabel] {
        try await client.send(try .post("library/copies/labels", json: ["copyIds": ids]), as: [StaffCopyLabel].self)
    }

    func importPreview(data: Data, name: String, mime: String) async throws -> StaffImportPreview {
        var form = MultipartForm()
        form.append(data, name: "file", filename: name, mime: mime)
        return try await client.send(.multipart("library/import/preview", form: form), as: StaffImportPreview.self)
    }

    func importCommit(_ rows: [StaffImportRow]) async throws -> StaffImportResult {
        struct Row: Encodable {
            let line: Int
            let title: String
            let authors: String
            let isbn: String?
            let publisher: String?
            let year: Int?
            let section: String?
            let inventoryNumbers: [String]
            let count: Int
        }
        struct Body: Encodable {
            let rows: [Row]
        }
        let body = Body(rows: rows.map {
            Row(
                line: $0.line, title: $0.title, authors: $0.authors, isbn: $0.isbn, publisher: $0.publisher,
                year: $0.year, section: $0.section, inventoryNumbers: $0.inventoryNumbers, count: $0.count
            )
        })
        return try await client.send(try .post("library/import", json: body), as: StaffImportResult.self)
    }

    // MARK: Структура вуза и люди

    func faculties() async throws -> [StaffFaculty] {
        try await client.send(
            .get("faculties", query: [URLQueryItem(name: "page", value: "1"), URLQueryItem(name: "limit", value: "100")]),
            as: [StaffFaculty].self
        )
    }

    func groups(search: String, facultyID: String?) async throws -> [StaffGroup] {
        var query = [URLQueryItem(name: "page", value: "1"), URLQueryItem(name: "limit", value: "50")]
        let needle = search.trimmingCharacters(in: .whitespaces)
        if !needle.isEmpty { query.append(URLQueryItem(name: "search", value: needle)) }
        if let facultyID { query.append(URLQueryItem(name: "facultyId", value: facultyID)) }
        return try await client.page(.get("groups", query: query), of: StaffGroup.self).items
    }

    /// Админский поиск пользователей с фильтром по роли.
    func users(search: String, role: String?) async throws -> [StaffUserPick] {
        var query = [URLQueryItem(name: "page", value: "1"), URLQueryItem(name: "limit", value: "20")]
        let needle = search.trimmingCharacters(in: .whitespaces)
        if !needle.isEmpty { query.append(URLQueryItem(name: "search", value: needle)) }
        if let role { query.append(URLQueryItem(name: "role", value: role)) }
        return try await client.page(.get("users", query: query), of: StaffUserPick.self).items
    }

    /// Справочник людей вокруг — для ролей без админского поиска (декан).
    func directory(search: String) async throws -> [StaffUserPick] {
        struct Answer: Decodable {
            let items: [StaffUserPick]
        }
        var query = [URLQueryItem(name: "limit", value: "30")]
        let needle = search.trimmingCharacters(in: .whitespaces)
        if !needle.isEmpty { query.append(URLQueryItem(name: "q", value: needle)) }
        return try await client.send(.get("users/directory", query: query), as: Answer.self).items
    }

    // MARK: Публикации

    struct PostInput: Encodable {
        var audience: String
        var title: String?
        var content: String
        var facultyId: String?
        var groupId: String?
        var targetUserId: String?
        var subject: String?
        var mediaIds: [String]?
        var status: String?
        var scheduledAt: Date?
        var asUniversity: Bool?
    }

    func createPost(_ input: PostInput) async throws -> PostDTO {
        try await client.send(try .post("posts", json: input), as: PostDTO.self)
    }

    func pinPost(id: String, pinned: Bool) async throws {
        try await client.send(try .patch("posts/\(id)/pin", json: ["pinned": pinned]))
    }

    // MARK: События

    func events(filter: String, _ request: PageRequest) async throws -> Page<StaffEvent> {
        var query = request.pageQuery
        query.append(URLQueryItem(name: "filter", value: filter))
        return try await client.page(.get("events", query: query), of: StaffEvent.self)
    }

    func event(id: String) async throws -> StaffEvent {
        try await client.send(.get("events/\(id)"), as: StaffEvent.self)
    }

    func createEvent(_ fields: [String: JSONValue]) async throws {
        try await client.send(try .post("events", json: JSONBody(fields)))
    }

    func updateEvent(id: String, _ fields: [String: JSONValue]) async throws {
        try await client.send(try .patch("events/\(id)", json: JSONBody(fields)))
    }

    func deleteEvent(id: String) async throws {
        try await client.send(.delete("events/\(id)"))
    }

    func registerEvent(id: String, on: Bool) async throws {
        if on {
            try await client.send(.post("events/\(id)/register"))
        } else {
            try await client.send(.delete("events/\(id)/register"))
        }
    }

    func eventMeeting(id: String) async throws -> StaffEventMeeting {
        try await client.send(.get("events/\(id)/meeting"), as: StaffEventMeeting.self)
    }

    func eventParticipants(id: String, _ request: PageRequest) async throws -> Page<StaffEventParticipant> {
        try await client.page(.get("events/\(id)/participants", query: request.cursorQuery), of: StaffEventParticipant.self)
    }

    func eventComments(id: String, _ request: PageRequest) async throws -> Page<StaffEventComment> {
        try await client.page(.get("events/\(id)/comments", query: request.cursorQuery), of: StaffEventComment.self)
    }

    func addEventComment(id: String, content: String, replyTo: String?) async throws {
        var body: [String: JSONValue] = ["content": .string(content)]
        if let replyTo { body["replyToId"] = .string(replyTo) }
        try await client.send(try .post("events/\(id)/comments", json: JSONBody(body)))
    }

    func deleteEventComment(id: String, commentID: String) async throws {
        try await client.send(.delete("events/\(id)/comments/\(commentID)"))
    }

    // MARK: Журналы охраны

    func securitySummary() async throws -> StaffSecuritySummary {
        try await client.send(.get("security/summary"), as: StaffSecuritySummary.self)
    }

    func passes(allowed: Bool?, search: String, date: String?, _ request: PageRequest) async throws -> Page<StaffPass> {
        var query = request.pageQuery
        if let allowed { query.append(URLQueryItem(name: "allowed", value: allowed ? "true" : "false")) }
        let needle = search.trimmingCharacters(in: .whitespaces)
        if !needle.isEmpty { query.append(URLQueryItem(name: "q", value: String(needle.prefix(100)))) }
        if let date { query.append(URLQueryItem(name: "date", value: date)) }
        return try await client.page(.get("security/passes", query: query), of: StaffPass.self)
    }

    func visitors(insideOnly: Bool, search: String, date: String?, _ request: PageRequest) async throws -> Page<StaffVisitor> {
        var query = request.pageQuery
        query.append(URLQueryItem(name: "status", value: insideOnly ? "inside" : "all"))
        let needle = search.trimmingCharacters(in: .whitespaces)
        if !needle.isEmpty { query.append(URLQueryItem(name: "q", value: String(needle.prefix(100)))) }
        if let date { query.append(URLQueryItem(name: "date", value: date)) }
        return try await client.page(.get("security/visitors", query: query), of: StaffVisitor.self)
    }
}
