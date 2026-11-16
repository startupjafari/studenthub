import CoreGraphics
import Foundation

// Карта кампуса для смотрящего (`apps/api/src/modules/campus`, формат —
// `packages/campus-core/src/format/schema.ts`). Только опубликованная версия:
// студенту сервер прячет служебные помещения и технические этажи сам.

struct CampusSummaryDTO: Decodable, Equatable, Identifiable {
    let id: String
    let name: String
    let description: String?
}

struct CampusPublishedDTO: Decodable, Equatable {
    struct Manifest: Decodable, Equatable {
        let buildings: [Building]
    }

    struct Building: Decodable, Equatable, Identifiable {
        let id: String
        let name: String
        let code: String?
        let floors: [Floor]
    }

    struct Floor: Decodable, Equatable, Identifiable {
        let id: String
        let level: Int
        let label: String?
        let kind: String?

        var title: String { label?.isEmpty == false ? label! : String(level) }
    }

    let campus: CampusSummaryDTO
    let manifest: Manifest
}

/// Найденное помещение (`GET /campus/search`, `/campus/rooms/:id/location`).
struct CampusSpaceHitDTO: Decodable, Equatable, Identifiable {
    struct Ref: Decodable, Equatable {
        let id: String
        let name: String?
        let code: String?
        let level: Int?
        let label: String?
    }

    struct Point: Decodable, Equatable {
        let x: Double
        let y: Double
    }

    let campusId: String
    let campusName: String?
    let spaceId: String
    let roomId: String?
    let number: String?
    let name: String?
    let kind: String?
    let building: Ref?
    let floor: Ref?
    let center: Point?

    var id: String { spaceId }

    var title: String {
        [number, name].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

/// План этажа. Координаты — целые миллиметры в системе здания, коллекции — словари
/// по id, как в формате сервера.
struct FloorPlanDTO: Decodable, Equatable {
    struct Node: Decodable, Equatable {
        let x: Double
        let y: Double
    }

    struct Wall: Decodable, Equatable {
        let a: String
        let b: String
        let thicknessMm: Double
        /// `wall`, `glass`, `virtual` — виртуальная стена делит зону и не рисуется.
        let kind: String
    }

    struct Opening: Decodable, Equatable {
        let type: String
        let wallId: String?
        let offsetMm: Double
        let widthMm: Double
    }

    struct Space: Decodable, Equatable {
        let label: Node
        let edges: [String]
        let number: String?
        let name: String?
        let kind: String
        let capacity: Int?
        let roomId: String?

        var title: String {
            [number, name].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        }
    }

    struct Vertical: Decodable, Equatable {
        let type: String
        let outline: [[Double]]
        let stepFree: Bool
    }

    struct Label: Decodable, Equatable {
        let x: Double
        let y: Double
        let text: String
    }

    let nodes: [String: Node]
    let walls: [String: Wall]
    let openings: [String: Opening]
    let spaces: [String: Space]
    let verticals: [String: Vertical]
    let labels: [String: Label]
}

private struct FloorResponse: Decodable {
    let document: FloorPlanDTO
}

protocol CampusFetching: Sendable {
    func campuses() async throws -> [CampusSummaryDTO]
    func published(campusID: String) async throws -> CampusPublishedDTO
    func floor(campusID: String, floorID: String) async throws -> FloorPlanDTO
    func search(_ query: String, campusID: String?) async throws -> [CampusSpaceHitDTO]
    func location(roomID: String) async throws -> CampusSpaceHitDTO
}

struct CampusAPI: CampusFetching {
    private let client: APIClient

    init(client: APIClient = AppServices.api) {
        self.client = client
    }

    func campuses() async throws -> [CampusSummaryDTO] {
        try await client.send(.get("campus"), as: [CampusSummaryDTO].self)
    }

    func published(campusID: String) async throws -> CampusPublishedDTO {
        try await client.send(.get("campus/\(campusID)/published"), as: CampusPublishedDTO.self)
    }

    func floor(campusID: String, floorID: String) async throws -> FloorPlanDTO {
        try await client.send(.get("campus/\(campusID)/published/floors/\(floorID)"), as: FloorResponse.self).document
    }

    func search(_ query: String, campusID: String?) async throws -> [CampusSpaceHitDTO] {
        var items = [URLQueryItem(name: "q", value: String(query.prefix(100)))]
        if let campusID { items.append(URLQueryItem(name: "campusId", value: campusID)) }
        return try await client.send(.get("campus/search", query: items), as: [CampusSpaceHitDTO].self)
    }

    /// Аудитория из расписания на карте. `404` — помещения нет на карте, это не сбой.
    func location(roomID: String) async throws -> CampusSpaceHitDTO {
        try await client.send(.get("campus/rooms/\(roomID)/location"), as: CampusSpaceHitDTO.self)
    }
}

// MARK: - Геометрия

/// План, подготовленный к рисованию: отрезки стен с проёмами, контуры помещений,
/// границы. Считается один раз на этаж, а не на каждый кадр жеста.
struct FloorGeometry: Equatable {
    struct Segment: Equatable {
        let a: CGPoint
        let b: CGPoint
        let width: CGFloat
        let isGlass: Bool
    }

    struct Room: Equatable, Identifiable {
        let id: String
        let space: FloorPlanDTO.Space
        let outline: [CGPoint]
    }

    let segments: [Segment]
    let rooms: [Room]
    let verticals: [(type: String, outline: [CGPoint])]
    let labels: [FloorPlanDTO.Label]
    let bounds: CGRect

    static func == (lhs: FloorGeometry, rhs: FloorGeometry) -> Bool {
        lhs.segments == rhs.segments && lhs.rooms == rhs.rooms && lhs.bounds == rhs.bounds
    }

    init(_ plan: FloorPlanDTO) {
        func point(_ id: String) -> CGPoint? {
            plan.nodes[id].map { CGPoint(x: $0.x, y: $0.y) }
        }

        // Проёмы режут стену: дверь на плане — разрыв в линии, как на любом чертеже.
        var cuts: [String: [(Double, Double)]] = [:]
        for opening in plan.openings.values {
            guard let wall = opening.wallId else { continue }
            cuts[wall, default: []].append((opening.offsetMm, opening.offsetMm + opening.widthMm))
        }

        var segments: [Segment] = []
        for (id, wall) in plan.walls where wall.kind != "virtual" {
            guard let a = point(wall.a), let b = point(wall.b) else { continue }
            let length = hypot(b.x - a.x, b.y - a.y)
            guard length > 0 else { continue }
            var start = 0.0
            for (from, to) in (cuts[id] ?? []).sorted(by: { $0.0 < $1.0 }) {
                if from > start {
                    segments.append(Self.segment(a, b, length, start, min(from, length), wall))
                }
                start = max(start, to)
            }
            if start < length {
                segments.append(Self.segment(a, b, length, start, length, wall))
            }
        }
        self.segments = segments

        rooms = plan.spaces.map { id, space in
            Room(id: id, space: space, outline: Self.outline(space.edges, plan: plan))
        }
        verticals = plan.verticals.values.map { vertical in
            (vertical.type, vertical.outline.compactMap { $0.count == 2 ? CGPoint(x: $0[0], y: $0[1]) : nil })
        }
        labels = Array(plan.labels.values)

        let points = plan.nodes.values.map { CGPoint(x: $0.x, y: $0.y) }
        if let minX = points.map(\.x).min(), let maxX = points.map(\.x).max(),
            let minY = points.map(\.y).min(), let maxY = points.map(\.y).max() {
            bounds = CGRect(x: minX, y: minY, width: max(maxX - minX, 1), height: max(maxY - minY, 1))
        } else {
            bounds = CGRect(x: 0, y: 0, width: 1, height: 1)
        }
    }

    private static func segment(_ a: CGPoint, _ b: CGPoint, _ length: Double, _ from: Double, _ to: Double, _ wall: FloorPlanDTO.Wall) -> Segment {
        let dx = (b.x - a.x) / length
        let dy = (b.y - a.y) / length
        return Segment(
            a: CGPoint(x: a.x + dx * from, y: a.y + dy * from),
            b: CGPoint(x: a.x + dx * to, y: a.y + dy * to),
            width: wall.thicknessMm,
            isGlass: wall.kind == "glass"
        )
    }

    /// Контур помещения: стены из `edges`, сцепленные по общим узлам. Не сцепились
    /// (дыра в данных) — контура нет, и помещение подсвечивается только меткой.
    static func outline(_ edges: [String], plan: FloorPlanDTO) -> [CGPoint] {
        var pairs = edges.compactMap { id -> (String, String)? in
            plan.walls[id].map { ($0.a, $0.b) }
        }
        guard let first = pairs.first else { return [] }
        pairs.removeFirst()
        var chain = [first.0, first.1]
        while !pairs.isEmpty {
            guard let last = chain.last,
                let index = pairs.firstIndex(where: { $0.0 == last || $0.1 == last })
            else { return [] }
            let next = pairs.remove(at: index)
            chain.append(next.0 == last ? next.1 : next.0)
        }
        if chain.first == chain.last { chain.removeLast() }
        return chain.compactMap { id in plan.nodes[id].map { CGPoint(x: $0.x, y: $0.y) } }
    }
}
