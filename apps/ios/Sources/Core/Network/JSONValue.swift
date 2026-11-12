import Foundation

/// Любое значение JSON.
///
/// Нужен там, где форма ответа широкая и меняется вместе с вебом: сводки дашбордов,
/// аналитика, журналы аудита с произвольными `meta`. Строгий тип на каждую такую
/// выдачу ломал бы экран от нового поля; здесь неизвестное просто не показывается.
enum JSONValue: Codable, Equatable, Hashable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value):
            // Целое уходит целым: `limit: 20.0` сервер с zod `int()` не примет.
            if value.rounded() == value, abs(value) < 1e15 {
                try container.encode(Int64(value))
            } else {
                try container.encode(value)
            }
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }

    // MARK: Доступ

    subscript(key: String) -> JSONValue? {
        if case .object(let object) = self { return object[key] }
        return nil
    }

    subscript(index: Int) -> JSONValue? {
        if case .array(let array) = self, array.indices.contains(index) { return array[index] }
        return nil
    }

    /// Путь через точки: `value["totals.students"]` читать неудобно, `value.at("totals", "students")` — да.
    func at(_ path: String...) -> JSONValue? {
        var current: JSONValue? = self
        for key in path { current = current?[key] }
        return current
    }

    var string: String? {
        switch self {
        case .string(let value): return value
        case .number(let value): return JSONValue.format(value)
        case .bool(let value): return value ? "true" : "false"
        default: return nil
        }
    }

    var double: Double? {
        switch self {
        case .number(let value): return value
        case .string(let value): return Double(value)
        default: return nil
        }
    }

    var int: Int? { double.map { Int($0) } }

    var bool: Bool? {
        if case .bool(let value) = self { return value }
        return nil
    }

    var array: [JSONValue]? {
        if case .array(let value) = self { return value }
        return nil
    }

    var object: [String: JSONValue]? {
        if case .object(let value) = self { return value }
        return nil
    }

    var isNull: Bool { self == .null }

    /// Дата из ISO-строки — тем же разбором, что у всего API.
    var date: Date? {
        guard let raw = string else { return nil }
        return JSONCoding.isoDate(raw)
    }

    /// Короткое человекочитаемое значение для строки «подпись — значение».
    var display: String {
        switch self {
        case .null: return "—"
        case .bool(let value):
            return value
                ? String(localized: "common.yes", defaultValue: "Да")
                : String(localized: "common.no", defaultValue: "Нет")
        case .number(let value): return JSONValue.format(value)
        case .string(let value):
            if let date { return date.formatted(date: .abbreviated, time: .shortened) }
            return value
        case .array(let value): return value.map(\.display).joined(separator: ", ")
        case .object(let value):
            return value.keys.sorted().map { "\($0): \(value[$0]?.display ?? "")" }.joined(separator: ", ")
        }
    }

    static func format(_ value: Double) -> String {
        if value.rounded() == value, abs(value) < 1e15 {
            return Int64(value).formatted()
        }
        return value.formatted(.number.precision(.fractionLength(0...2)))
    }
}

extension JSONValue: ExpressibleByStringLiteral, ExpressibleByIntegerLiteral, ExpressibleByBooleanLiteral,
    ExpressibleByFloatLiteral, ExpressibleByNilLiteral
{
    init(stringLiteral value: String) { self = .string(value) }
    init(integerLiteral value: Int) { self = .number(Double(value)) }
    init(booleanLiteral value: Bool) { self = .bool(value) }
    init(floatLiteral value: Double) { self = .number(value) }
    init(nilLiteral: ()) { self = .null }
}

extension JSONValue {
    /// Необязательная строка: пустая после обрезки — `null`.
    static func text(_ value: String?) -> JSONValue {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return .null
        }
        return .string(trimmed)
    }

    static func int(_ value: Int?) -> JSONValue {
        value.map { .number(Double($0)) } ?? .null
    }

    static func date(_ value: Date?) -> JSONValue {
        value.map { .string(JSONCoding.isoString($0)) } ?? .null
    }

    static func strings(_ values: [String]) -> JSONValue {
        .array(values.map(JSONValue.string))
    }
}
