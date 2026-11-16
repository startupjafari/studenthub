import Foundation

// Короткие конструкторы запросов для остальных глаголов. Экранов с правкой и удалением
// в приложении десятки, и без них каждый собирал бы `Endpoint(method:path:body:)` руками.

extension Endpoint {
    /// GET с параметрами из словаря: пустые и `nil` выпадают — сервер на `?search=`
    /// отвечает иначе, чем на отсутствие параметра. Порядок ключей — по алфавиту, чтобы
    /// одинаковые запросы давали одинаковый адрес.
    static func get(_ path: String, params: [String: String?]) -> Endpoint {
        let items = params
            .compactMap { key, value -> URLQueryItem? in
                guard let value, !value.isEmpty else { return nil }
                return URLQueryItem(name: key, value: value)
            }
            .sorted { $0.name < $1.name }
        return Endpoint(method: .get, path: path, query: items)
    }

    static func patch(_ path: String) -> Endpoint {
        Endpoint(method: .patch, path: path)
    }

    static func patch<Body: Encodable>(_ path: String, json: Body) throws -> Endpoint {
        Endpoint(method: .patch, path: path, body: try JSONCoding.encoder.encode(json))
    }

    static func put(_ path: String) -> Endpoint {
        Endpoint(method: .put, path: path)
    }

    static func put<Body: Encodable>(_ path: String, json: Body) throws -> Endpoint {
        Endpoint(method: .put, path: path, body: try JSONCoding.encoder.encode(json))
    }

    static func delete(_ path: String, query: [URLQueryItem] = []) -> Endpoint {
        Endpoint(method: .delete, path: path, query: query)
    }

    static func delete<Body: Encodable>(_ path: String, json: Body) throws -> Endpoint {
        Endpoint(method: .delete, path: path, body: try JSONCoding.encoder.encode(json))
    }
}

/// Тело запроса из словаря «как есть»: формы админки собирают поля динамически, и
/// заводить на каждую свою структуру — сотня одноразовых типов. `nil` уходит как
/// `null`: так сервер понимает «очистить поле».
struct JSONBody: Encodable {
    let fields: [String: JSONValue]

    init(_ fields: [String: JSONValue]) {
        self.fields = fields
    }

    func encode(to encoder: Encoder) throws {
        try JSONValue.object(fields).encode(to: encoder)
    }
}
