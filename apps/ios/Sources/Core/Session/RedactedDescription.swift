import Foundation

/// Тип, несущий секрет (токен, refresh-cookie, challenge входа), печатается без него
/// (правило 10.2.6).
///
/// Синтезированное описание обходит любое редактирование логгера: `"\(state)"`,
/// `print`, `dump`, отладчик и хлебная крошка Sentry выдали бы JWT или refresh-токен
/// целиком. Здесь все три пути — `description`, `debugDescription` и `Mirror` для
/// `dump` — сводятся к одной строке, в которой только то, что можно показывать: роль,
/// `sub`, срок.
protocol RedactedDescription: CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    var redactedDescription: String { get }
}

extension RedactedDescription {
    var description: String { redactedDescription }
    var debugDescription: String { redactedDescription }
    var customMirror: Mirror { Mirror(self, children: ["redacted": redactedDescription]) }
}

/// Маска секрета в описании: видно, есть ли значение, но не само значение.
enum SecretMask {
    static let hidden = "<redacted>"

    static func optional(_ value: String?) -> String {
        value == nil ? "nil" : hidden
    }
}
