import Foundation

// Контракты учёбы студента сверх «Учёбы» по умолчанию: экзамены, учебный план,
// календарь, «Мои задачи», отметка по QR, студенческий билет, файлы сдачи и материалов.
// Поля — только те, что показывает приложение; всё, чего может не быть, необязательно.

// MARK: - Экзамены

/// Экзамен (`GET /exams`). Студенту сервер добавляет `myResult` — его допуск и итог.
struct StudentExamDTO: Decodable, Equatable, Identifiable {
    struct Person: Decodable, Equatable {
        let id: String
        let firstName: String?
        let lastName: String?

        var name: String {
            [lastName, firstName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
        }
    }

    struct Course: Decodable, Equatable {
        struct Subject: Decodable, Equatable {
            let id: String?
            let name: String
        }

        let id: String
        let teacherId: String?
        let subject: Subject
    }

    struct Named: Decodable, Equatable {
        let id: String
        let name: String
    }

    struct Result: Decodable, Equatable {
        let id: String?
        let admitted: Bool?
        /// `SCHEDULED`, `PASSED`, `FAILED`, `ABSENT`, `RETAKE`.
        let status: String
        let score: Double?
        let attempt: Int?
        let note: String?
    }

    let id: String
    let date: Date
    let format: String?
    let maxScore: Int?
    let note: String?
    let course: Course
    let group: Named?
    let room: Named?
    let examiner: Person?
    let myResult: Result?
}

// MARK: - Дисциплины для плана

/// Дисциплина группы с датами семестра (`GET /courses`): по датам план отличает
/// прошедший семестр от будущего.
struct StudentCourseDTO: Decodable, Equatable, Identifiable {
    struct Term: Decodable, Equatable {
        let id: String
        let name: String?
        let number: Int?
        let isActive: Bool?
        /// ISO-строки: сравниваются как «ГГГГ-ММ-ДД» по первым десяти символам — как в вебе.
        let startsOn: String?
        let endsOn: String?
    }

    struct Subject: Decodable, Equatable {
        let id: String
        let name: String
        let code: String?
    }

    let id: String
    let credits: Int?
    let subject: Subject
    let term: Term?
}

// MARK: - Календарь

/// Расписание целиком (`GET /schedule`), страницами по `nextCursor`.
struct StudentScheduleDTO: Decodable, Equatable {
    let timezone: String?
    let pairs: [PairDTO]
    let nextCursor: String?
}

/// Разовое изменение со всеми полями, которые показывает веб: новая аудитория,
/// заменяющий преподаватель, исходная пара (нужна заменяющему — в его выборке её нет).
struct StudentScheduleChangeDTO: Decodable, Equatable, Identifiable {
    struct Room: Decodable, Equatable {
        let id: String
        let name: String
    }

    struct Person: Decodable, Equatable {
        let id: String?
        let firstName: String?
        let lastName: String?

        var name: String {
            [lastName, firstName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
        }
    }

    struct Pair: Decodable, Equatable {
        let groupId: String?
        let subject: String
        let dayOfWeek: Int?
        let startTime: String
        let endTime: String
        let weekType: String?
        let teacher: Person?
        let room: Room?
    }

    let id: String
    let pairId: String
    /// `MOVED`, `ROOM_CHANGED`, `CANCELLED`, `SUBSTITUTED`.
    let type: String
    /// Строка: дата изменения — день вуза, сравнивается по «ГГГГ-ММ-ДД».
    let date: String
    let newStartTime: String?
    let newEndTime: String?
    let note: String?
    let createdAt: String?
    let newRoom: Room?
    let newTeacher: Person?
    let pair: Pair?

    var day: String { String(date.prefix(10)) }
}

/// Событие в календаре и в «Моих задачах» (`GET /events`).
struct StudentEventDTO: Decodable, Equatable, Identifiable {
    let id: String
    let title: String
    let location: String?
    let isOnline: Bool?
    let startsAt: Date
    let endsAt: Date?
    let isRegistered: Bool?
}

/// Заявка в «Моих задачах» (`GET /applications`).
struct StudentApplicationDTO: Decodable, Equatable, Identifiable {
    struct Service: Decodable, Equatable {
        let nameRu: String?
        let nameKk: String?
        let nameEn: String?

        /// Название на языке приложения; русское — запасное, как в вебе (`pickLocale`).
        var title: String {
            let code = Locale.current.language.languageCode?.identifier
            let localized = code == "kk" ? nameKk : (code == "en" ? nameEn : nameRu)
            return localized ?? nameRu ?? ""
        }
    }

    let id: String
    let number: String?
    let status: String
    let dueAt: Date?
    let issuedAt: Date?
    let service: Service?
}

// MARK: - Отметка по QR

/// Итог самоотметки (`POST /attendance/check-in`). `status` — отметка, которая теперь
/// стоит: самоотметка не перетирает отметку преподавателя.
struct StudentCheckInResultDTO: Decodable, Equatable {
    let status: String
    let subject: String?
    let date: String?
    let already: Bool?
}

// MARK: - Студенческий билет

/// Цифровой студенческий (`GET /student-id/me`): реквизиты, токен и QR на короткий срок.
struct StudentIDCardDTO: Decodable, Equatable {
    let id: String
    let firstName: String
    let lastName: String
    let middleName: String?
    let avatarUrl: String?
    let studentCardNumber: String?
    let academicStatus: String?
    let educationLevel: String?
    let studyForm: String?
    let specialty: String?
    let fundingType: String?
    let dormitory: String?
    let birthDate: String?
    let course: Int?
    let enrollmentYear: Int?
    let graduationYear: Int?
    let group: String?
    let faculty: String?
    let university: String?
    let universityShort: String?
    let token: String
    /// `data:image/png;base64,…` — запасной вариант, если адрес веба в сборке не задан.
    let qr: String?
    let expiresAt: Date
    let ttlSeconds: Int?

    var fullName: String {
        [lastName, firstName, middleName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
    }
}

// MARK: - Файлы

/// Файл, приложенный к работе.
struct StudentSubmissionFileDTO: Decodable, Equatable, Identifiable {
    let id: String
    let name: String?
    let mime: String?
    let size: Int?
    let createdAt: Date?
}

/// Ссылка на файл в хранилище — живёт минуты, поэтому берётся прямо перед открытием.
struct StudentFileLinkDTO: Decodable, Equatable {
    let url: URL
    let expiresAt: Date?
}

/// Подпись на прямую загрузку.
struct StudentUploadTicketDTO: Decodable, Equatable {
    let key: String
    let url: URL
}

/// Число материалов по дисциплине (`GET /materials/subjects`).
struct StudentMaterialSubjectDTO: Decodable, Equatable {
    let subject: String?
    let count: Int
}

// MARK: - Маршруты

struct StudentStudyAPI: Sendable {
    private let client: APIClient

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    // MARK: Учёба

    /// Экзамены по scope. Без периода сервер отдаёт ближайшие к сегодняшнему дню.
    func exams(from: Date? = nil, to: Date? = nil) async throws -> [StudentExamDTO] {
        try await client.send(
            .get("exams", params: [
                "from": from.map(JSONCoding.isoString),
                "to": to.map(JSONCoding.isoString),
            ]),
            as: [StudentExamDTO].self
        )
    }

    /// Дисциплины группы одной сотней, как в вебе (`fetchCourses`).
    func courses() async throws -> [StudentCourseDTO] {
        try await client.page(
            .get("courses", query: [URLQueryItem(name: "page", value: "1"), URLQueryItem(name: "limit", value: "100")]),
            of: StudentCourseDTO.self
        ).items
    }

    /// Свой профиль как есть: сводке нужны поля, которых нет в общей модели профиля
    /// (год поступления).
    func me() async throws -> JSONValue {
        try await client.send(.get("users/me"), as: JSONValue.self)
    }

    /// Задания одной страницей. Период — по сроку сдачи (`dueTo` не включается).
    func assignments(page: Int = 1, limit: Int = 100, dueFrom: Date? = nil, dueTo: Date? = nil) async throws -> Page<AssignmentDTO> {
        try await client.page(
            .get("assignments", params: [
                "page": String(page),
                "limit": String(limit),
                "dueFrom": dueFrom.map(JSONCoding.isoString),
                "dueTo": dueTo.map(JSONCoding.isoString),
            ]),
            of: AssignmentDTO.self
        )
    }

    // MARK: Календарь и задачи

    /// Расписание всех страниц: у декана пар факультета больше одной страницы.
    func schedule() async throws -> (timezone: String?, pairs: [PairDTO]) {
        var pairs: [PairDTO] = []
        var timezone: String?
        var cursor: String?
        for _ in 0..<20 {
            let page = try await client.send(
                .get("schedule", params: ["cursor": cursor]),
                as: StudentScheduleDTO.self
            )
            timezone = page.timezone ?? timezone
            pairs += page.pairs
            guard let next = page.nextCursor, !next.isEmpty else { break }
            cursor = next
        }
        return (timezone, pairs)
    }

    /// Разовые изменения за дни `from`…`to` включительно («ГГГГ-ММ-ДД»), все страницы.
    func scheduleChanges(from: String, to: String) async throws -> [StudentScheduleChangeDTO] {
        var out: [StudentScheduleChangeDTO] = []
        var cursor: String?
        for _ in 0..<20 {
            let page = try await client.page(
                .get("schedule/changes", params: ["from": from, "to": to, "limit": "500", "cursor": cursor]),
                of: StudentScheduleChangeDTO.self
            )
            out += page.items
            guard page.meta?.hasNext == true, let next = page.meta?.cursor else { break }
            cursor = next
        }
        return out
    }

    func upcomingEvents(limit: Int) async throws -> [StudentEventDTO] {
        try await client.send(
            .get("events", params: ["page": "1", "limit": String(limit), "filter": "upcoming"]),
            as: [StudentEventDTO].self
        )
    }

    func applications(limit: Int = 50) async throws -> [StudentApplicationDTO] {
        try await client.page(
            .get("applications", params: ["page": "1", "limit": String(limit)]),
            of: StudentApplicationDTO.self
        ).items
    }

    // MARK: Отметка и билет

    func checkIn(token: String) async throws -> StudentCheckInResultDTO {
        try await client.send(try .post("attendance/check-in", json: ["token": token]), as: StudentCheckInResultDTO.self)
    }

    func studentID() async throws -> StudentIDCardDTO {
        try await client.send(.get("student-id/me"), as: StudentIDCardDTO.self)
    }

    // MARK: Файлы сдачи

    /// Файл к работе: подпись → загрузка в хранилище → подтверждение. Прямая загрузка
    /// не упирается в порог буферной (тело не идёт через сервер API).
    func attachSubmissionFile(assignmentID: String, data: Data, name: String, mime: String) async throws -> StudentSubmissionFileDTO {
        let ticket = try await client.send(
            try .post("assignments/\(assignmentID)/submission/files/presign", json: ["mime": mime]),
            as: StudentUploadTicketDTO.self
        )
        var request = URLRequest(url: ticket.url)
        request.httpMethod = HTTPMethod.put.rawValue
        request.setValue(mime, forHTTPHeaderField: "Content-Type")
        let (_, response) = try await URLSession.shared.upload(for: request, from: data)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.malformedResponse(statusCode: (response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        return try await client.send(
            try .post("assignments/\(assignmentID)/submission/files/confirm", json: ["key": ticket.key, "name": name]),
            as: StudentSubmissionFileDTO.self
        )
    }

    func removeSubmissionFile(assignmentID: String, fileID: String) async throws {
        try await client.send(.delete("assignments/\(assignmentID)/submission/files/\(fileID)"))
    }

    func submissionFileURL(submissionID: String, fileID: String) async throws -> URL {
        try await client.send(.get("submissions/\(submissionID)/files/\(fileID)/presigned"), as: StudentFileLinkDTO.self).url
    }

    // MARK: Материалы

    /// Страницами с номером: так сервер отдаёт `total`, и подгрузка знает, где конец.
    func materials(subject: String?, request: PageRequest) async throws -> Page<MaterialDTO> {
        var query = request.pageQuery
        if let subject { query.append(URLQueryItem(name: "subject", value: subject)) }
        return try await client.page(.get("materials", query: query), of: MaterialDTO.self)
    }

    func materialSubjects() async throws -> [StudentMaterialSubjectDTO] {
        try await client.send(.get("materials/subjects"), as: [StudentMaterialSubjectDTO].self)
    }

    func materialFileURL(materialID: String, fileID: String) async throws -> URL {
        try await client.send(.get("materials/\(materialID)/files/\(fileID)/presigned"), as: StudentFileLinkDTO.self).url
    }
}
