import Foundation

/// Код подтверждения перед отправкой (IOS_RULES 7.2.12).
///
/// Казахская, арабская или китайская раскладка и полноширинный ввод дают цифры не ASCII:
/// «١٢٣٤٥٦» или «１２３４５６» сервер отклонил бы как неверный код. Как в Telegram, цифра
/// любой письменности с однозначным значением приводится к ASCII, буквенный резервный код —
/// к канонической композиции (NFC), пробелы по краям обрезаются. Новых ограничений на ввод
/// нет: остальное уходит как есть, разбирает сервер.
enum OneTimeCode {
    static func normalized(_ raw: String) -> String {
        var result = ""
        for character in raw.trimmingCharacters(in: .whitespacesAndNewlines) {
            if !character.isASCII, let digit = character.wholeNumberValue, (0...9).contains(digit) {
                result.append(String(digit))
            } else {
                result.append(character)
            }
        }
        return result.precomposedStringWithCanonicalMapping
    }
}
