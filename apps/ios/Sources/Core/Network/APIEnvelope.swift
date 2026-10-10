import Foundation

/// Конверт ответа API (PROJECT.md §8.1, BACKEND_RULES §4).
///
/// Контроллеры возвращают чистые данные, а глобальный интерцептор заворачивает их в
/// `{ success, data, meta? }`. Разворачиваем конверт здесь один раз, чтобы экраны
/// работали с доменными типами и не знали про `success`.
struct APISuccessEnvelope<T: Decodable>: Decodable {
    let data: T
    let meta: APIMeta?
}

/// Служебные поля страницы. У курсорной пагинации истории чата две стороны:
/// `cursor`/`hasNext` — более старые записи, `prevCursor`/`hasPrev` — более новые.
struct APIMeta: Decodable, Equatable {
    let cursor: String?
    let hasNext: Bool?
    let total: Int?
    let prevCursor: String?
    let hasPrev: Bool?
}

/// Страница списка: данные вместе с курсорами.
struct Page<Item: Decodable>: Decodable {
    let items: [Item]
    let meta: APIMeta?
}

struct APIErrorEnvelope: Decodable {
    struct Body: Decodable {
        let code: String
        let message: String
        let details: [APIErrorDetail]?
    }

    let error: Body
    let statusCode: Int
}

struct APIErrorDetail: Decodable, Equatable {
    let field: String
    let message: String
}
