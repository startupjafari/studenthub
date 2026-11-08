import Foundation

// Карьера: витрина вакансий и отклики студента, карьерный центр вуза, кабинет работодателя
// и его саморегистрация. Контракты — `apps/api/src/modules/career`, схемы тел —
// `packages/shared-schemas/src/career.ts`. Перечисления сервера держим строками: новое
// значение на сервере не должно ронять разбор, подпись для него экран покажет как есть.

// MARK: - Вакансии

struct CareerCompanyRef: Decodable, Equatable, Hashable {
    let id: String
    let name: String
    var slug: String? = nil
    var logoUrl: String? = nil
    /// Код КАТО — название берётся из справочника.
    var city: String? = nil
    var website: String? = nil
}

struct CareerMatch: Decodable, Equatable, Hashable {
    let score: Int
    var matchedSkills: [String]? = nil
    var missingSkills: [String]? = nil
}

struct CareerNamedRef: Decodable, Equatable, Hashable {
    let id: String
    let name: String
}

/// Решение одного вуза по вакансии компании.
struct CareerVacancyReview: Decodable, Equatable, Hashable {
    let status: String
    var reason: String? = nil
    let university: CareerNamedRef
}

/// Вакансия: витрина студента, вакансия компании и вложенная вакансия отклика — одна форма,
/// у вложенных приходит только часть полей.
struct CareerVacancy: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let title: String
    var description: String? = nil
    var employmentType: String? = nil
    var workFormat: String? = nil
    var experienceLevel: String? = nil
    /// Код КАТО.
    var city: String? = nil
    var salaryMin: Int? = nil
    var salaryMax: Int? = nil
    var salaryCurrency: String? = nil
    var skills: [String]? = nil
    var languages: [String]? = nil
    var deadline: Date? = nil
    var publishedAt: Date? = nil
    var company: CareerCompanyRef? = nil
    /// Совпадение с карьерным профилем; `nil` — профиль не заполнен.
    var match: CareerMatch? = nil
    // Поля вакансии компании.
    var status: String? = nil
    var views: Int? = nil
    var createdAt: Date? = nil
    var reviews: [CareerVacancyReview]? = nil
}

/// Строка очереди модерации вуза. `id` — решение вуза, а не вакансия.
struct CareerReviewRow: Decodable, Equatable, Identifiable {
    let id: String
    let status: String
    var reason: String? = nil
    let createdAt: Date
    var decidedAt: Date? = nil
    let vacancy: CareerVacancy
}

// MARK: - Отклики

struct CareerApplication: Decodable, Equatable, Identifiable {
    struct Student: Decodable, Equatable {
        let id: String
        let firstName: String
        let lastName: String
        var avatarThumbUrl: String? = nil
        var headline: String? = nil
        var specialty: String? = nil
        var course: Int? = nil
        var skills: [String]? = nil

        var name: String { DisplayFormat.name(first: firstName, last: lastName) }
    }

    let id: String
    let status: String
    /// Видит ли компания карьерный профиль: `EMPLOYERS`, `COMPANY` или `HIDDEN`.
    var profileAccess: String? = nil
    var coverLetter: String? = nil
    let createdAt: Date
    var updatedAt: Date? = nil
    let vacancy: CareerVacancy
    /// Есть только в воронке компании.
    var student: Student? = nil
}

struct CareerApplicationEvent: Decodable, Equatable, Identifiable {
    let id: String
    var fromStatus: String? = nil
    let toStatus: String
    var comment: String? = nil
    let createdAt: Date
}

// MARK: - Карьерный профиль

struct CareerProfile: Decodable, Equatable {
    struct Readiness: Decodable, Equatable {
        struct Part: Decodable, Equatable {
            let key: String
            let earned: Int
            let max: Int
        }

        let score: Int
        let parts: [Part]
    }

    struct Consent: Decodable, Equatable {
        let field: String
        var companyId: String? = nil
        var grantedAt: Date? = nil
    }

    struct Grant: Decodable, Equatable, Identifiable {
        let companyId: String
        let companyName: String
        var grantedAt: Date? = nil
        var id: String { companyId }
    }

    struct Inherited: Decodable, Equatable {
        var firstName: String? = nil
        var lastName: String? = nil
        var headline: String? = nil
        var city: String? = nil
        var specialty: String? = nil
        var course: Int? = nil
        var graduationYear: Int? = nil
        var skills: [String]? = nil
        var languages: [String]? = nil
        var universityName: String? = nil
        var portfolioCount: Int? = nil
    }

    let visibility: String
    let employmentStatus: String
    var desiredPositions: [String] = []
    var employmentTypes: [String] = []
    var workFormats: [String] = []
    var relocationReady: Bool = false
    var desiredSalaryMin: Int? = nil
    var desiredSalaryMax: Int? = nil
    var salaryCurrency: String? = nil
    var about: String? = nil
    let readiness: Readiness
    var consents: [Consent] = []
    var profileGrants: [Grant] = []
    let inherited: Inherited

    var isVisible: Bool { visibility == "EMPLOYERS" }
}

/// Карточка кандидата для работодателя. `nil` у чувствительных полей — «не открыто», а не «пусто».
struct CareerCandidateCard: Decodable, Equatable {
    struct PortfolioItem: Decodable, Equatable, Identifiable {
        let id: String
        var kind: String? = nil
        let title: String
        var organization: String? = nil
        var description: String? = nil
        var url: String? = nil
        var startDate: Date? = nil
        var endDate: Date? = nil
    }

    struct Certificate: Decodable, Equatable, Identifiable {
        let id: String
        let title: String
        var issuedBy: String? = nil
        var issuedAt: Date? = nil
    }

    let id: String
    let firstName: String
    let lastName: String
    var avatarUrl: String? = nil
    var headline: String? = nil
    var about: String? = nil
    var university: String? = nil
    var specialty: String? = nil
    var course: Int? = nil
    var graduationYear: Int? = nil
    var skills: [String]? = nil
    var languages: [String]? = nil
    var employmentStatus: String? = nil
    var desiredPositions: [String]? = nil
    var employmentTypes: [String]? = nil
    var workFormats: [String]? = nil
    var relocationReady: Bool? = nil
    var readinessScore: Int? = nil
    var portfolio: [PortfolioItem]? = nil
    var verifiedCertificates: [Certificate]? = nil
    var gpa: Double? = nil
    var phone: String? = nil
    var email: String? = nil

    var name: String { DisplayFormat.name(first: firstName, last: lastName) }
}

// MARK: - Резюме

struct CareerResumeSettings: Decodable, Equatable {
    let title: String
    let published: Bool
    var publicSlug: String? = nil
    let includeContacts: Bool
    var updatedAt: Date? = nil
}

struct CareerPublicResume: Decodable, Equatable {
    struct Item: Decodable, Equatable, Hashable {
        let title: String
        var organization: String? = nil
        var period: String? = nil
        var description: String? = nil
        var verified: Bool? = nil
    }

    let title: String
    var updatedAt: Date? = nil
    let fullName: String
    var headline: String? = nil
    var contacts: [String]? = nil
    var about: String? = nil
    var education: [String]? = nil
    var skills: [String]? = nil
    var languages: [String]? = nil
    var experience: [Item]? = nil
    var projects: [Item]? = nil
    var certificates: [Item]? = nil
}

// MARK: - Мероприятия

struct CareerEvent: Decodable, Equatable, Identifiable {
    struct Organizer: Decodable, Equatable {
        let id: String
        var firstName: String? = nil
        var lastName: String? = nil
    }

    let id: String
    var careerKind: String? = nil
    let title: String
    var description: String? = nil
    var location: String? = nil
    var isOnline: Bool? = nil
    let startsAt: Date
    var endsAt: Date? = nil
    var organizer: Organizer? = nil
    var registered: Bool? = nil
    var participantsCount: Int? = nil
}

// MARK: - Компании

/// Страница компании и своя компания работодателя (служебные поля — только у своей).
struct CareerCompany: Decodable, Equatable {
    let id: String
    let name: String
    var slug: String? = nil
    var description: String? = nil
    var website: String? = nil
    /// Код КАТО.
    var city: String? = nil
    var logoUrl: String? = nil
    var coverUrl: String? = nil
    var industry: String? = nil
    var size: String? = nil
    var foundedYear: Int? = nil
    var contactEmail: String? = nil
    var contactPhone: String? = nil
    var address: String? = nil
    var telegram: String? = nil
    var instagram: String? = nil
    var linkedin: String? = nil
    var createdAt: Date? = nil
    var isMember: Bool? = nil
    var status: String? = nil
    var blockedReason: String? = nil
    var memberRole: String? = nil

    var isOwner: Bool { memberRole == "OWNER" }
}

/// Заявка компании в вуз: у работодателя в ней вуз, у вуза — компания.
struct CareerAccess: Decodable, Equatable, Identifiable {
    struct University: Decodable, Equatable {
        let id: String
        let name: String
        var shortName: String? = nil
        var city: String? = nil
    }

    let id: String
    let status: String
    var message: String? = nil
    var reason: String? = nil
    let requestedAt: Date
    var decidedAt: Date? = nil
    var expiresAt: Date? = nil
    var university: University? = nil
    var company: CareerCompany? = nil

    /// Допуск действует: одобрен и срок не вышел.
    var isActive: Bool {
        status == "APPROVED" && (expiresAt.map { $0 > Date() } ?? true)
    }
}

/// Вуз в справочнике «куда подать заявку» со статусом своей заявки.
struct CareerUniversityOption: Decodable, Equatable, Identifiable {
    struct Access: Decodable, Equatable {
        let status: String
        var expiresAt: Date? = nil
        var reason: String? = nil

        var isActive: Bool { status == "APPROVED" && (expiresAt.map { $0 > Date() } ?? true) }
    }

    let id: String
    let name: String
    var shortName: String? = nil
    var city: String? = nil
    var access: Access? = nil

    /// Подать заявку можно, если доступа нет, отказали, отозвали или срок истёк.
    var canRequest: Bool {
        guard let access else { return true }
        if access.status == "REQUESTED" { return false }
        if access.status == "APPROVED" { return !access.isActive }
        return true
    }
}

struct CareerTeam: Decodable, Equatable {
    struct Member: Decodable, Equatable, Identifiable {
        let userId: String
        let firstName: String
        let lastName: String
        let email: String
        let role: String
        var joinedAt: Date? = nil
        var isMe: Bool? = nil
        var id: String { userId }
        var name: String { DisplayFormat.name(first: firstName, last: lastName) }
    }

    struct Invite: Decodable, Equatable, Identifiable {
        let id: String
        let email: String
        let role: String
        let expiresAt: Date
        var createdAt: Date? = nil
        var expired: Bool? = nil
    }

    let members: [Member]
    let invites: [Invite]
}

struct CareerInvitePreview: Decodable, Equatable {
    let companyName: String
    let email: String
    let expiresAt: Date
}

/// Вуз для переключателя области данных платформенных ролей.
struct CareerUniversityRef: Decodable, Equatable, Identifiable, Hashable {
    let id: String
    let name: String
    var shortName: String? = nil
}

/// Населённый пункт справочника КАТО.
struct CareerKatoUnit: Decodable, Equatable, Identifiable, Hashable {
    let code: String
    let nameRu: String
    var regionNameRu: String? = nil
    var id: String { code }
}

// MARK: - Тела запросов

struct CareerSignupInput: Encodable {
    var email: String
    var password: String
    var firstName: String
    var lastName: String
    var companyName: String
    var website: String?
}

// MARK: - Клиент

struct CareerAPI {
    private let client: APIClient

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    /// Параметр вуза для платформенных ролей: у сотрудника вуза он в токене.
    private func scope(_ universityID: String?) -> [URLQueryItem] {
        guard let universityID, !universityID.isEmpty else { return [] }
        return [URLQueryItem(name: "universityId", value: universityID)]
    }

    private func query(_ request: PageRequest, _ params: [String: String?]) -> [URLQueryItem] {
        request.pageQuery + params.compactMap { key, value in
            guard let value, !value.isEmpty else { return nil }
            return URLQueryItem(name: key, value: value)
        }.sorted { $0.name < $1.name }
    }

    // MARK: Витрина

    func vacancies(_ request: PageRequest, params: [String: String?]) async throws -> Page<CareerVacancy> {
        try await client.page(.get("career/vacancies", query: query(request, params)), of: CareerVacancy.self)
    }

    func vacancy(id: String, universityID: String?) async throws -> CareerVacancy {
        try await client.send(.get("career/vacancies/\(id)", query: scope(universityID)), as: CareerVacancy.self)
    }

    // MARK: Отклики студента

    func myApplications(_ request: PageRequest, params: [String: String?] = [:]) async throws -> Page<CareerApplication> {
        try await client.page(.get("career/applications", query: query(request, params)), of: CareerApplication.self)
    }

    /// Свой отклик на вакансию, если он есть.
    func myApplication(vacancyID: String) async throws -> CareerApplication? {
        try await myApplications(PageRequest(cursor: nil, page: 1, limit: 1), params: ["vacancyId": vacancyID]).items.first
    }

    func apply(vacancyID: String, coverLetter: String?, shareProfile: Bool) async throws {
        var fields: [String: JSONValue] = ["vacancyId": .string(vacancyID)]
        if let coverLetter, !coverLetter.isEmpty { fields["coverLetter"] = .string(coverLetter) }
        if shareProfile { fields["shareProfile"] = true }
        try await client.send(.post("career/applications", json: JSONBody(fields)))
    }

    func withdraw(applicationID: String) async throws {
        try await client.send(.post("career/applications/\(applicationID)/withdraw"))
    }

    func history(applicationID: String) async throws -> [CareerApplicationEvent] {
        try await client.send(.get("career/applications/\(applicationID)/history"), as: [CareerApplicationEvent].self)
    }

    // MARK: Карьерный профиль

    func profile() async throws -> CareerProfile {
        try await client.send(.get("career/profile"), as: CareerProfile.self)
    }

    @discardableResult
    func updateProfile(_ fields: [String: JSONValue]) async throws -> CareerProfile {
        try await client.send(.patch("career/profile", json: JSONBody(fields)), as: CareerProfile.self)
    }

    @discardableResult
    func setConsent(field: String, granted: Bool) async throws -> CareerProfile {
        try await client.send(
            .post("career/profile/consents", json: JSONBody(["field": .string(field), "granted": .bool(granted)])),
            as: CareerProfile.self
        )
    }

    func share(companyID: String) async throws {
        try await client.send(.put("career/profile/grants/\(companyID)"))
    }

    func unshare(companyID: String) async throws {
        try await client.send(.delete("career/profile/grants/\(companyID)"))
    }

    func candidate(studentID: String) async throws -> CareerCandidateCard {
        try await client.send(.get("career/profile/candidates/\(studentID)"), as: CareerCandidateCard.self)
    }

    // MARK: Резюме

    func resume() async throws -> CareerResumeSettings {
        try await client.send(.get("career/resume"), as: CareerResumeSettings.self)
    }

    @discardableResult
    func updateResume(_ fields: [String: JSONValue]) async throws -> CareerResumeSettings {
        try await client.send(.patch("career/resume", json: JSONBody(fields)), as: CareerResumeSettings.self)
    }

    /// PDF резюме. Подписи разделов задаёт клиент — язык интерфейса знает он.
    func resumePDF(labels: [String: String]) async throws -> Data {
        let items = labels.map { URLQueryItem(name: $0.key, value: $0.value) }.sorted { $0.name < $1.name }
        return try await client.data(.get("career/resume/pdf", query: items + [URLQueryItem(name: "locale", value: "ru")]))
    }

    func publicResume(slug: String) async throws -> CareerPublicResume {
        var endpoint = Endpoint.get("career/resume/public/\(slug)")
        endpoint.requiresAuthorization = false
        return try await client.send(endpoint, as: CareerPublicResume.self)
    }

    // MARK: Мероприятия

    func events(_ request: PageRequest, params: [String: String?]) async throws -> Page<CareerEvent> {
        try await client.page(.get("career/events", query: query(request, params)), of: CareerEvent.self)
    }

    /// Карьерное мероприятие — обычное событие вуза с типом `careerKind`.
    func createEvent(_ fields: [String: JSONValue]) async throws {
        try await client.send(.post("events", json: JSONBody(fields)))
    }

    // MARK: Карьерный центр вуза

    func universityAccess(_ request: PageRequest, params: [String: String?]) async throws -> Page<CareerAccess> {
        try await client.page(.get("career/university/companies", query: query(request, params)), of: CareerAccess.self)
    }

    func decideAccess(id: String, status: String, reason: String?, expiresAt: Date?, universityID: String?) async throws {
        var fields: [String: JSONValue] = ["status": .string(status)]
        if let reason, !reason.isEmpty { fields["reason"] = .string(reason) }
        if let expiresAt { fields["expiresAt"] = .string(JSONCoding.isoString(expiresAt)) }
        if let universityID { fields["universityId"] = .string(universityID) }
        try await client.send(.patch("career/university/companies/\(id)", json: JSONBody(fields)))
    }

    func reviewQueue(_ request: PageRequest, params: [String: String?]) async throws -> Page<CareerReviewRow> {
        try await client.page(.get("career/university/vacancies", query: query(request, params)), of: CareerReviewRow.self)
    }

    func decideVacancy(reviewID: String, approve: Bool, reason: String?, universityID: String?) async throws {
        var fields: [String: JSONValue] = ["status": .string(approve ? "APPROVED" : "REJECTED")]
        if let reason, !reason.isEmpty { fields["reason"] = .string(reason) }
        if let universityID { fields["universityId"] = .string(universityID) }
        try await client.send(.patch("career/university/vacancies/\(reviewID)", json: JSONBody(fields)))
    }

    func universityAnalytics(universityID: String?) async throws -> JSONValue {
        try await client.send(.get("career/analytics/university", query: scope(universityID)), as: JSONValue.self)
    }

    func report(period: String, universityID: String?) async throws -> JSONValue {
        try await client.send(
            .get("career/analytics/university/report", query: [URLQueryItem(name: "period", value: period)] + scope(universityID)),
            as: JSONValue.self
        )
    }

    func exportReport(period: String, format: String, universityID: String?) async throws -> Data {
        try await client.data(.get(
            "career/analytics/university/report/export",
            query: [
                URLQueryItem(name: "period", value: period),
                URLQueryItem(name: "format", value: format),
                URLQueryItem(name: "locale", value: "ru"),
            ] + scope(universityID)
        ))
    }

    func universities(search: String) async throws -> [CareerUniversityRef] {
        try await client.page(
            .get("universities", params: ["limit": "50", "page": "1", "search": search.isEmpty ? nil : search]),
            of: CareerUniversityRef.self
        ).items
    }

    func company(id: String) async throws -> CareerCompany {
        try await client.send(.get("career/companies/\(id)"), as: CareerCompany.self)
    }

    /// Публикации страницы компании.
    func companyPosts(companyID: String) async throws -> [PostDTO] {
        try await client.page(
            .get("posts", params: ["companyId": companyID, "limit": "20", "reactions": "summary"]),
            of: PostDTO.self
        ).items
    }

    // MARK: Работодатель

    func myCompany() async throws -> CareerCompany {
        try await client.send(.get("career/companies/me"), as: CareerCompany.self)
    }

    @discardableResult
    func updateMyCompany(_ fields: [String: JSONValue]) async throws -> CareerCompany {
        try await client.send(.patch("career/companies/me", json: JSONBody(fields)), as: CareerCompany.self)
    }

    /// Логотип или обложка (`logo` / `cover`).
    func uploadCompanyImage(kind: String, data: Data) async throws {
        var form = MultipartForm()
        form.append(data, name: "file", filename: "\(kind).jpg", mime: "image/jpeg")
        try await client.send(.multipart("career/companies/me/\(kind)", form: form))
    }

    func removeCompanyImage(kind: String) async throws {
        try await client.send(.delete("career/companies/me/\(kind)"))
    }

    func myAccess() async throws -> [CareerAccess] {
        try await client.send(.get("career/companies/me/access"), as: [CareerAccess].self)
    }

    func universityOptions(_ request: PageRequest, params: [String: String?]) async throws -> Page<CareerUniversityOption> {
        try await client.page(
            .get("career/companies/me/universities", query: query(request, params)),
            of: CareerUniversityOption.self
        )
    }

    func requestAccess(universityID: String, message: String?) async throws {
        var fields: [String: JSONValue] = ["universityId": .string(universityID)]
        if let message, !message.isEmpty { fields["message"] = .string(message) }
        try await client.send(.post("career/companies/me/access", json: JSONBody(fields)))
    }

    func companyAnalytics() async throws -> JSONValue {
        try await client.send(.get("career/analytics/company"), as: JSONValue.self)
    }

    func myVacancies(_ request: PageRequest) async throws -> Page<CareerVacancy> {
        try await client.page(.get("career/employer/vacancies", query: request.pageQuery), of: CareerVacancy.self)
    }

    /// Отдельной карточки у вакансии компании нет — ищем её в своём списке.
    func myVacancy(id: String) async throws -> CareerVacancy {
        var page = 1
        while page <= 20 {
            let result = try await myVacancies(PageRequest(cursor: nil, page: page, limit: 100))
            if let found = result.items.first(where: { $0.id == id }) { return found }
            let total = result.meta?.total ?? 0
            if result.items.count < 100 || page * 100 >= total { break }
            page += 1
        }
        throw APIError.server(
            code: .notFound,
            message: String(localized: "career.vacancy.notFound", defaultValue: "Вакансия не найдена"),
            details: [],
            statusCode: 404
        )
    }

    func createVacancy(_ fields: [String: JSONValue]) async throws {
        try await client.send(.post("career/employer/vacancies", json: JSONBody(fields)))
    }

    func updateVacancy(id: String, _ fields: [String: JSONValue]) async throws {
        try await client.send(.patch("career/employer/vacancies/\(id)", json: JSONBody(fields)))
    }

    /// `publish`, `pause` или `close`.
    func vacancyAction(id: String, action: String) async throws {
        try await client.send(.post("career/employer/vacancies/\(id)/\(action)"))
    }

    func deleteVacancy(id: String) async throws {
        try await client.send(.delete("career/employer/vacancies/\(id)"))
    }

    func pipeline(_ request: PageRequest, params: [String: String?]) async throws -> Page<CareerApplication> {
        try await client.page(.get("career/employer/applications", query: query(request, params)), of: CareerApplication.self)
    }

    func changeStatus(applicationID: String, status: String, comment: String?) async throws {
        var fields: [String: JSONValue] = ["status": .string(status)]
        if let comment, !comment.isEmpty { fields["comment"] = .string(comment) }
        try await client.send(.patch("career/employer/applications/\(applicationID)", json: JSONBody(fields)))
    }

    func team() async throws -> CareerTeam {
        try await client.send(.get("career/companies/me/members"), as: CareerTeam.self)
    }

    func invite(email: String) async throws {
        try await client.send(.post("career/companies/me/invites", json: JSONBody(["email": .string(email)])))
    }

    func revokeInvite(id: String) async throws {
        try await client.send(.delete("career/companies/me/invites/\(id)"))
    }

    func removeMember(userID: String) async throws {
        try await client.send(.delete("career/companies/me/members/\(userID)"))
    }

    /// Почта вошедшего — для повторного письма подтверждения.
    func myEmail() async throws -> String? {
        struct Me: Decodable { let email: String? }
        return try await client.send(.get("users/me"), as: Me.self).email
    }

    // MARK: Справочники

    func katoSearch(_ text: String) async throws -> [CareerKatoUnit] {
        try await client.send(
            .get("kato", params: ["scope": "places", "limit": "20", "search": text.isEmpty ? nil : text]),
            as: [CareerKatoUnit].self
        )
    }

    func katoResolve(_ codes: [String]) async throws -> [CareerKatoUnit] {
        try await client.send(.get("kato/resolve", params: ["codes": codes.joined(separator: ",")]), as: [CareerKatoUnit].self)
    }

    // MARK: Публичное: саморегистрация работодателя

    private func publicPost(_ path: String, _ fields: [String: JSONValue]) throws -> Endpoint {
        var endpoint = try Endpoint.post(path, json: JSONBody(fields))
        endpoint.requiresAuthorization = false
        return endpoint
    }

    func signup(_ input: CareerSignupInput) async throws {
        var fields: [String: JSONValue] = [
            "email": .string(input.email),
            "password": .string(input.password),
            "firstName": .string(input.firstName),
            "lastName": .string(input.lastName),
            "companyName": .string(input.companyName),
        ]
        if let website = input.website, !website.isEmpty { fields["website"] = .string(website) }
        try await client.send(publicPost("career/companies/signup", fields))
    }

    func verifyEmail(token: String) async throws {
        try await client.send(publicPost("career/companies/verify-email", ["token": .string(token)]))
    }

    func resendVerification(email: String) async throws {
        try await client.send(publicPost("career/companies/resend-verification", ["email": .string(email)]))
    }

    func invitePreview(token: String) async throws -> CareerInvitePreview {
        var endpoint = Endpoint.get("career/companies/invites/\(token)/preview")
        endpoint.requiresAuthorization = false
        return try await client.send(endpoint, as: CareerInvitePreview.self)
    }

    /// Регистрация по приглашению в команду: сервер выдаёт сессию сразу.
    func acceptInvite(token: String, password: String, firstName: String, lastName: String) async throws -> AuthSession {
        try await client.send(
            publicPost("auth/register-by-company-invite", [
                "token": .string(token),
                "password": .string(password),
                "firstName": .string(firstName),
                "lastName": .string(lastName),
            ]),
            as: AuthSession.self
        )
    }
}
