import Foundation

/// Язык приложения и API — `ru`, `kz`, `en` (`SUPPORTED_LOCALES` в `packages/shared-config`).
///
/// Система знает казахский только по коду ISO 639-1 `kk`: `Locale`, каталог строк
/// (`kk.lproj`), `AppleLanguages`, форматтеры дат и чисел. Переход через эту границу —
/// только здесь, как в вебе (`toPlatformLanguage` / `fromPlatformLanguage`). Так же
/// читаются старые значения `kk`, сохранённые до перехода на `kz`.
enum AppLanguage {
    /// Языки, которые понимает сервер.
    static let supported = ["ru", "kz", "en"]
    static let fallback = "ru"

    /// Код приложения → языковой код системы: `kz` → `kk`.
    static func toPlatform(_ code: String) -> String {
        code == "kz" ? "kk" : code
    }

    /// Языковой тег системы или старое значение → код приложения: `kk`, `kk-KZ`, `kz` → `kz`;
    /// `ru_RU` → `ru`. Неподдерживаемое и пустое → `nil`.
    static func fromPlatform(_ tag: String?) -> String? {
        guard
            let base = tag?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                .split(whereSeparator: { $0 == "-" || $0 == "_" }).first.map(String.init)
        else { return nil }
        if base == "kk" || base == "kz" { return "kz" }
        return supported.contains(base) ? base : nil
    }

    /// Язык интерфейса как код приложения; язык, которого сервер не знает, — русский.
    static var current: String {
        fromPlatform(Locale.current.language.languageCode?.identifier) ?? fallback
    }
}
