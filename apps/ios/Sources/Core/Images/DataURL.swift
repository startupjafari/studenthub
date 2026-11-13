import Foundation

/// Картинка в `data:` URL (`data:image/png;base64,…`) — так сервер отдаёт QR (P2-4 аудита).
///
/// Разбор был скопирован в шесть экранов, и часть из них разбирала base64 прямо в `body`
/// на каждую перерисовку. Байты — здесь, без UIKit, чтобы проверять тестами;
/// картинка с кешем — `DataURLImage`.
enum DataURL {
    /// Байты base64 после первой запятой — так же, как разбирали все шесть копий.
    /// `nil` — запятой нет или base64 битый.
    static func data(from string: String?) -> Data? {
        guard let string, let comma = string.firstIndex(of: ",") else { return nil }
        return Data(base64Encoded: String(string[string.index(after: comma)...]))
    }
}
