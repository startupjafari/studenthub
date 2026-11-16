import Foundation

/// Политика пароля платформы — та же, что `PasswordSchema` в `packages/shared-schemas`:
/// не короче 8 символов, буква, цифра, спецсимвол и не длиннее 72 байт UTF-8.
///
/// Буква — латиница или кириллица `А–я`, ровно как в регулярке схемы: «ә» и «ё» сервер
/// буквой не считает, а спецсимволом — да. Проверка до запроса нужна, чтобы человек не
/// ждал ответа сервера ради «нужна цифра»; окончательно решает сервер.
enum PasswordPolicy {
    /// bcrypt учитывает только первые 72 байта и молча отбрасывает остальное.
    static let maxBytes = 72

    /// Первое нарушение политики или `nil`, если пароль подходит. Тексты — те же, что
    /// у ошибок валидации сервера (`validation.password.*`).
    static func problem(_ password: String) -> String? {
        if password.count < 8 {
            return text("validation.password.tooShort")
        }
        if !password.unicodeScalars.contains(where: isLetter) {
            return text("validation.password.letterRequired")
        }
        if !password.unicodeScalars.contains(where: isDigit) {
            return text("validation.password.digitRequired")
        }
        if !password.unicodeScalars.contains(where: { !isLetter($0) && !isDigit($0) }) {
            return text("validation.password.specialRequired")
        }
        if password.utf8.count > maxBytes {
            return text("validation.password.tooLong")
        }
        return nil
    }

    /// Надёжность по критериям политики, 0…4 — как полоска на форме регистрации веба.
    static func score(_ password: String) -> Int {
        var score = 0
        if password.count >= 8 { score += 1 }
        if password.unicodeScalars.contains(where: isLetter) { score += 1 }
        if password.unicodeScalars.contains(where: isDigit) { score += 1 }
        if password.unicodeScalars.contains(where: { !isLetter($0) && !isDigit($0) }) { score += 1 }
        return score
    }

    private static func isLetter(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x41...0x5A, 0x61...0x7A, 0x410...0x44F: return true
        default: return false
        }
    }

    private static func isDigit(_ scalar: Unicode.Scalar) -> Bool {
        (0x30...0x39).contains(scalar.value)
    }

    private static func text(_ key: String) -> String {
        ValidationMessage.text(for: key) ?? key
    }
}
