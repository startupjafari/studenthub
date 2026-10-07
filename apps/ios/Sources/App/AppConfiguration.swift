import Foundation

/// Настройки сборки, пришедшие из `Config/*.xcconfig` через `Info.plist`.
enum AppConfiguration {
    /// Корень API, например `https://.../api/v1`.
    ///
    /// Отсутствие ключа валит приложение на старте намеренно: сборка без адреса
    /// API нерабочая целиком, и узнать об этом лучше на первом же запуске, чем по
    /// пустым экранам у человека.
    static let apiBaseURL: URL = {
        guard
            let raw = Bundle.main.object(forInfoDictionaryKey: "SHAPIBaseURL") as? String,
            let url = URL(string: raw)
        else {
            preconditionFailure("SHAPIBaseURL не задан — смотрите Config/Debug.xcconfig")
        }
        return url
    }()

    static let marketingVersion = string(for: "CFBundleShortVersionString") ?? "0.0.0"
    static let buildNumber = string(for: "CFBundleVersion") ?? "0"

    /// Значение заголовка `X-Client-Version`: по нему сервер отличает сборки в
    /// логах и решает, не пора ли просить человека обновиться (Задача Б3).
    static var clientVersion: String { "ios/\(marketingVersion)+\(buildNumber)" }

    /// Релизная сборка. По ней выбирается окружение трекера: смешивать отладку с
    /// продом в одной ленте issue — значит не читать её вовсе.
    static var isRelease: Bool {
        #if DEBUG
            return false
        #else
            return true
        #endif
    }

    private static func string(for key: String) -> String? {
        Bundle.main.object(forInfoDictionaryKey: key) as? String
    }
}
