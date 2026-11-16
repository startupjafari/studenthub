import Foundation

/// Ссылка из письма, которая нужна до входа: новый пароль (`/reset-password?token=…`) и
/// регистрация по приглашению (`/register?token=…`).
///
/// Отдельно от `DeepLink`: те ссылки ведут внутрь приложения вошедшего человека и
/// разбираются с учётом роли, а эти — на экраны входа, где роли ещё нет. Формы те же,
/// что у `DeepLink`: своя схема (`studenthub://register?token=…`) и адрес веба — его
/// приложение получит, когда на домене появится apple-app-site-association, а пока его
/// вставляют вручную на экране «У меня есть приглашение».
enum AuthLink: Equatable, Hashable {
    case resetPassword(token: String)
    case register(token: String)

    init?(url: URL) {
        guard
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            let scheme = components.scheme?.lowercased()
        else { return nil }

        var segments: [String]
        switch scheme {
        case DeepLink.scheme:
            // В `studenthub://register?token=…` первый сегмент пути — это host.
            segments = [components.host ?? ""] + components.path.split(separator: "/").map(String.init)
        case "https", "http":
            segments = components.path.split(separator: "/").map(String.init)
        default:
            return nil
        }
        segments = segments.filter { !$0.isEmpty }

        guard
            segments.count == 1,
            let token = components.queryItems?.first(where: { $0.name == "token" })?.value?
                .trimmingCharacters(in: .whitespacesAndNewlines),
            Self.isWellFormed(token)
        else { return nil }

        switch segments[0] {
        case "reset-password": self = .resetPassword(token: token)
        case "register": self = .register(token: token)
        default: return nil
        }
    }

    /// Токены сервера — UUID приглашения и base64url сброса пароля. Остальное не
    /// пропускаем: токен приглашения встаёт в путь запроса (`invites/<токен>/preview`),
    /// и «../» из чужой ссылки увёл бы запрос на другой маршрут.
    static func isWellFormed(_ token: String) -> Bool {
        (1...200).contains(token.count) && token.unicodeScalars.allSatisfy { scalar in
            switch scalar {
            case "A"..."Z", "a"..."z", "0"..."9", "-", "_": return true
            default: return false
            }
        }
    }

    /// Вставленный текст: ссылка целиком или ссылка внутри сообщения («Вас пригласили:
    /// https://…»). Голый токен не принимаем — по нему не понять, приглашение это или
    /// сброс пароля.
    init?(pasted text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url = URL(string: trimmed), let link = AuthLink(url: url) {
            self = link
            return
        }
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else {
            return nil
        }
        let range = NSRange(trimmed.startIndex..., in: trimmed)
        for match in detector.matches(in: trimmed, range: range) {
            if let url = match.url, let link = AuthLink(url: url) {
                self = link
                return
            }
        }
        return nil
    }
}
