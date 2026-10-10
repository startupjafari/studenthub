import Foundation

/// Версия сборки в сравнимом виде.
///
/// Сравниваем числами, а не строками: при строковом сравнении «1.10.0» меньше
/// «1.9.0», и блокировка срабатывала бы ровно наоборот на десятом минорном релизе.
struct AppVersion: Comparable, Equatable {
    let major: Int
    let minor: Int
    let patch: Int

    /// Принимаем только полный `X.Y.Z` — тот же формат, что отдаёт сервер и что
    /// стоит в `MARKETING_VERSION`. Всё остальное — не версия, и догадываться о ней
    /// опаснее, чем признать разбор неудачным.
    init?(_ raw: String) {
        let parts = raw.split(separator: ".", omittingEmptySubsequences: false)
        guard
            parts.count == 3,
            let major = Int(parts[0]),
            let minor = Int(parts[1]),
            let patch = Int(parts[2]),
            major >= 0, minor >= 0, patch >= 0
        else { return nil }
        self.major = major
        self.minor = minor
        self.patch = patch
    }

    static func < (lhs: AppVersion, rhs: AppVersion) -> Bool {
        (lhs.major, lhs.minor, lhs.patch) < (rhs.major, rhs.minor, rhs.patch)
    }
}
