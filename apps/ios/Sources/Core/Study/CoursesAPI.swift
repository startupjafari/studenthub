import Foundation

/// Дисциплина группы в семестре (`GET /courses`). Студенту сервер отдаёт курсы его
/// группы, преподавателю с `mine=true` — его собственные.
struct CourseDTO: Decodable, Equatable, Identifiable {
    struct Subject: Decodable, Equatable {
        let id: String
        let name: String
        let code: String?
    }

    struct Group: Decodable, Equatable, Hashable {
        let id: String
        let name: String
    }

    struct Term: Decodable, Equatable {
        let id: String
        let name: String?
        let number: Int?
        let isActive: Bool?
    }

    let id: String
    let credits: Int?
    let subject: Subject
    let group: Group?
    let teacher: PersonRefDTO?
    let term: Term?
}

/// Участник группы (`GET /groups/:id/members`).
struct GroupMemberDTO: Decodable, Equatable, Identifiable {
    let id: String
    let firstName: String?
    let lastName: String?
    let role: String?
    let avatarUrl: String?

    var name: String {
        [lastName, firstName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
    }
}

protocol CoursesFetching: Sendable {
    func courses(mine: Bool) async throws -> [CourseDTO]
    func members(groupID: String) async throws -> [GroupMemberDTO]
}

struct CoursesAPI: CoursesFetching {
    private let client: APIClient

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    /// Одна страница в сотню: дисциплин у группы за все семестры меньше, а постраничная
    /// прокрутка короткого списка только мешала бы поиску.
    func courses(mine: Bool) async throws -> [CourseDTO] {
        var query = [URLQueryItem(name: "limit", value: "100")]
        if mine { query.append(URLQueryItem(name: "mine", value: "true")) }
        return try await client.page(.get("courses", query: query), of: CourseDTO.self).items
    }

    func members(groupID: String) async throws -> [GroupMemberDTO] {
        try await client.send(.get("groups/\(groupID)/members"), as: [GroupMemberDTO].self)
    }
}
