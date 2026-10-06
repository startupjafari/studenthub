import Foundation

/// Разбор дат из API.
///
/// Сервер отдаёт `new Date().toISOString()` — это ISO 8601 с долями секунды
/// (`2026-10-06T12:34:56.789Z`). Встроенная стратегия `.iso8601` на долях секунды
/// падает, поэтому форматтеров два: сначала с ними, потом без. Промах здесь выглядит
/// как «сломался весь экран», хотя разошёлся один символ.
enum JSONCoding {
    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let raw = try container.decode(String.self)
            if let date = fractional.date(from: raw) ?? plain.date(from: raw) {
                return date
            }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Не ISO 8601: \(raw)"
            )
        }
        return decoder
    }()

    static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(fractional.string(from: date))
        }
        return encoder
    }()

    private static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let plain: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
}
