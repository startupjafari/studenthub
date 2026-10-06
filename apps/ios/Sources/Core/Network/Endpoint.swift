import Foundation

enum HTTPMethod: String {
    case get = "GET"
    case post = "POST"
    case patch = "PATCH"
    case put = "PUT"
    case delete = "DELETE"
}

/// Описание запроса к API. Путь задаётся без префикса `/api/v1` — он уже в адресе
/// из конфигурации сборки.
struct Endpoint {
    let method: HTTPMethod
    let path: String
    var query: [URLQueryItem] = []
    var body: Data?
    /// Нужен ли заголовок `Authorization`. Публичных маршрутов немного: вход,
    /// обновление сессии, регистрация по инвайту, здоровье.
    var requiresAuthorization = true
    /// Можно ли повторить запрос при обрыве связи или 5xx. Повторяем только чтение:
    /// повтор POST создаст вторую заявку или второе сообщение.
    var isIdempotent: Bool { method == .get }

    func url(relativeTo base: URL) -> URL? {
        guard
            var components = URLComponents(
                url: base.appendingPathComponent(path),
                resolvingAgainstBaseURL: false
            )
        else { return nil }
        if !query.isEmpty { components.queryItems = query }
        return components.url
    }

    static func get(_ path: String, query: [URLQueryItem] = []) -> Endpoint {
        Endpoint(method: .get, path: path, query: query)
    }

    static func post(_ path: String) -> Endpoint {
        Endpoint(method: .post, path: path)
    }

    static func post<Body: Encodable>(_ path: String, json: Body) throws -> Endpoint {
        Endpoint(method: .post, path: path, body: try JSONCoding.encoder.encode(json))
    }
}
