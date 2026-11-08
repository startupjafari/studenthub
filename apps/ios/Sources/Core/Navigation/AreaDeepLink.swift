import Foundation

/// Ссылки веба на разделы областей: `/dean/applications`, `/university-admin/invites`,
/// `/library/loans`, `/checkin?t=…`, `/r/resume/<slug>` и т. д.
///
/// В отличие от `DeepLink`, разбор зависит от роли: `/dean/*` открывается только у
/// декана, `/library/*` — только у библиотекаря. Чужой раздел не угадываем — ссылку
/// откроет браузер, где сервер сам решит, пускать ли.
struct AreaDeepLink: Equatable {
    let tab: AppTab
    let routes: [AppRoute]

    init(tab: AppTab, routes: [AppRoute]) {
        self.tab = tab
        self.routes = routes
    }

    init?(url: URL, role: Role) {
        guard
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            let scheme = components.scheme?.lowercased()
        else { return nil }
        var segments: [String]
        switch scheme {
        case DeepLink.scheme:
            segments = (components.host.map { [$0] } ?? []) + components.path.split(separator: "/").map(String.init)
        case "https", "http":
            segments = components.path.split(separator: "/").map(String.init)
        default:
            return nil
        }
        segments = segments.filter { !$0.isEmpty }
        let query = components.queryItems ?? []
        func value(_ name: String) -> String? {
            query.first { $0.name == name }?.value.flatMap { $0.isEmpty ? nil : $0 }
        }
        guard let resolved = Self.resolve(segments, value: value, role: role) else { return nil }
        self = resolved
    }

    // MARK: - Разбор

    private static func resolve(_ path: [String], value: (String) -> String?, role: Role) -> AreaDeepLink? {
        guard let head = path.first else { return nil }
        let rest = Array(path.dropFirst())

        // Общие для нескольких ролей.
        switch (head, rest.first, rest.count) {
        case ("checkin", nil, 0) where role == .student || role == .starosta:
            let screen: StudentScreen = value("t").map { .checkinToken($0) } ?? .checkin
            return AreaDeepLink(tab: .services, routes: [.student(screen)])
        case ("r", "resume", 2):
            return AreaDeepLink(tab: .home, routes: [.career(.publicResume(slug: rest[1]))])
        case ("r", .some(let code), 1) where role == .securityGuard:
            return AreaDeepLink(tab: .workspace, routes: [.security(.roomStatus(code: code))])
        case ("c", .some(let code), 1) where role == .librarian:
            return AreaDeepLink(tab: .workspace, routes: [.librarian(.copy(code: code))])
        case ("verify-id", _, _) where role == .securityGuard:
            return AreaDeepLink(tab: .workspace, routes: [.security(.verifyID)])
        case ("companies", .some(let id), 1) where !CareerScreen.items(for: role).isEmpty || role == .employer:
            return AreaDeepLink(tab: .home, routes: [.career(.company(id: id))])
        case ("calendar", nil, 0) where role.isAcademic || role == .dean:
            return AreaDeepLink(tab: role == .dean ? .workspace : .study, routes: [.student(.calendar)])
        case ("tasks", nil, 0) where role == .student || role == .starosta:
            return AreaDeepLink(tab: .study, routes: [.student(.tasks)])
        case ("exams", nil, 0) where role == .student || role == .starosta:
            return AreaDeepLink(tab: .study, routes: [.student(.exams)])
        case ("study-plan", nil, 0) where role == .student || role == .starosta:
            return AreaDeepLink(tab: .study, routes: [.student(.studyPlan)])
        case ("student-id", nil, 0) where role == .student || role == .starosta:
            return AreaDeepLink(tab: .services, routes: [.student(.studentID)])
        case ("career", _, _):
            return career(rest, role: role)
        default:
            break
        }

        switch (head, role) {
        case ("dean", .dean):
            return section(rest, tab: .workspace, table: deanTable)
        case ("university-admin", .universityAdmin):
            return section(rest, tab: .workspace, table: universityAdminTable)
        case ("platform-admin", .platformAdmin):
            return section(rest, tab: .workspace, table: platformAdminTable)
        case ("moderator", .platformModerator) where rest.first == "platform":
            return section(Array(rest.dropFirst()), tab: .workspace, table: moderatorTable)
        case ("moderator", .universityModerator) where rest.first == "university":
            return section(Array(rest.dropFirst()), tab: .workspace, table: moderatorTable)
        case ("library", .librarian):
            if rest.first == "catalog", rest.count == 2 {
                return AreaDeepLink(tab: .workspace, routes: [.librarian(.catalog), .librarian(.book(id: rest[1]))])
            }
            return section(rest, tab: .workspace, table: librarianTable)
        case ("security", .securityGuard):
            return section(rest, tab: .workspace, table: securityTable)
        case ("employer", .employer):
            return section(rest, tab: .workspace, table: employerTable)
        case ("teacher", .teacher):
            return section(rest, tab: .study, table: teacherTable)
        case ("starosta", .starosta):
            return section(rest, tab: .services, table: starostaTable)
        default:
            return nil
        }
    }

    /// Раздел роли по первому сегменту после префикса. Пустой путь — корень роли:
    /// открываем вкладку «Обзор» без экранов поверх.
    private static func section(_ rest: [String], tab: AppTab, table: [String: AppRoute]) -> AreaDeepLink? {
        guard let name = rest.first else {
            // У учебных ролей корень раздела — их главная, её разбирает `DeepLink`.
            return tab == .workspace ? AreaDeepLink(tab: .dashboard, routes: []) : nil
        }
        guard rest.count == 1, let route = table[name] else { return nil }
        return AreaDeepLink(tab: tab, routes: [route])
    }

    private static func career(_ rest: [String], role: Role) -> AreaDeepLink? {
        let allowed = CareerScreen.items(for: role).map(\.route)
        let tab: AppTab = role.isAcademic ? .services : .workspace
        guard let name = rest.first else {
            return allowed.contains(.career(.home)) ? AreaDeepLink(tab: tab, routes: [.career(.home)]) : nil
        }
        if name == "vacancies", rest.count == 2 {
            return allowed.contains(.career(.vacancies))
                ? AreaDeepLink(tab: tab, routes: [.career(.vacancies), .career(.vacancy(id: rest[1]))])
                : nil
        }
        let table: [String: CareerScreen] = [
            "vacancies": .vacancies, "applications": .applications, "profile": .profile, "resume": .resume,
            "events": .events, "companies": .companies, "vacancy-review": .vacancyReview, "analytics": .analytics,
        ]
        guard rest.count == 1, let screen = table[name], allowed.contains(.career(screen)) else { return nil }
        return AreaDeepLink(tab: tab, routes: [.career(screen)])
    }

    // MARK: - Таблицы разделов по меню веба (`nav.ts`)

    private static let deanTable: [String: AppRoute] = [
        "groups": .dean(.groups), "students": .dean(.students), "teachers": .dean(.teachers),
        "starostas": .dean(.starostas), "courses": .dean(.courses), "exams": .dean(.exams),
        "analytics": .dean(.analytics), "appointments": .dean(.appointments), "schedule": .dean(.schedule),
        "applications": .staff(.applicationsQueue), "posts": .staff(.posts), "events": .staff(.events),
        "invites": .admin(.invites),
    ]

    private static let universityAdminTable: [String: AppRoute] = [
        "analytics": .uniAdmin(.analytics), "setup": .uniAdmin(.setup), "faculties": .uniAdmin(.faculties),
        "specialties": .uniAdmin(.specialties), "groups": .uniAdmin(.groups), "rooms": .uniAdmin(.rooms),
        "campus": .uniAdmin(.campuses), "cameras": .uniAdmin(.cameras), "schedule": .uniAdmin(.schedule),
        "courses": .uniAdmin(.courses), "invites": .admin(.invites), "users": .admin(.users(role: nil)),
        "students": .admin(.users(role: "STUDENT")), "teachers": .admin(.users(role: "TEACHER")),
        "deans": .admin(.users(role: "DEAN")), "applications": .staff(.applicationsQueue),
        "services": .staff(.serviceCatalog), "document-types": .staff(.documentTypes),
        "document-templates": .staff(.documentTemplates), "document-journal": .staff(.documentJournal),
        "library": .staff(.librarySettings), "posts": .staff(.posts), "events": .staff(.events),
        "complaints": .admin(.complaints), "audit": .admin(.audit), "security": .staff(.securityJournals),
    ]

    private static let platformAdminTable: [String: AppRoute] = [
        "universities": .admin(.universities), "demo-requests": .admin(.demoRequests),
        "users": .admin(.users(role: nil)), "invites": .admin(.invites), "events": .admin(.platformEvents),
        "complaints": .admin(.complaints), "support": .admin(.support), "stats": .admin(.stats),
        "audit": .admin(.audit), "document-access": .admin(.documentAccess), "services": .admin(.platformServices),
    ]

    private static let moderatorTable: [String: AppRoute] = [
        "complaints": .admin(.complaints), "support": .admin(.support), "posts": .admin(.postsModeration),
        "users": .admin(.users(role: nil)), "stats": .admin(.stats), "audit": .admin(.audit),
        "applications": .staff(.applicationsQueue), "campus": .admin(.campusModeration),
    ]

    private static let librarianTable: [String: AppRoute] = [
        "issue": .librarian(.issue), "return": .librarian(.returnBooks), "loans": .librarian(.loans),
        "reservations": .librarian(.reservations), "catalog": .librarian(.catalog),
        "inventory": .librarian(.inventory), "reports": .librarian(.reports), "clearances": .librarian(.clearances),
    ]

    private static let securityTable: [String: AppRoute] = [
        "cameras": .security(.cameras), "rooms": .security(.rooms),
    ]

    private static let employerTable: [String: AppRoute] = [
        "vacancies": .career(.employerVacancies), "candidates": .career(.candidates),
        "access": .career(.access), "team": .career(.team), "company": .career(.companyProfile),
    ]

    private static let teacherTable: [String: AppRoute] = [
        "gradebook": .teacher(.gradebook), "assignments": .teacher(.reviews),
        "attendance": .teacher(.attendanceJournal), "exams": .teacher(.exams), "materials": .teacher(.materials),
        "posts": .teacher(.myPosts), "events": .staff(.events),
    ]

    private static let starostaTable: [String: AppRoute] = [
        "group-documents": .starosta(.groupDocuments), "invites": .starosta(.invites),
    ]
}
