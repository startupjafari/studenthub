import SafariServices
import SwiftUI
import UIKit

/// Куда ведёт ссылка из чужого содержимого (сообщение, превью, материалы чата) и что
/// показать человеку перед переходом. Чистый разбор без UIKit — его проверяют тесты.
///
/// Доверять можно только самому URL: подпись превью (`og:site_name`) и текст ссылки
/// пишет чужой человек или сайт, и назваться они могут кем угодно.
enum ExternalLink: Equatable {
    /// Наш веб или собственная схема `studenthub://` — разбираем внутри приложения.
    case ourWeb
    /// Чужой http(s): встроенный Safari, но только после подтверждения с хостом.
    case web(host: String)
    /// Иная схема (`mailto:`, `tel:`, чужие приложения): уводит из приложения — только
    /// после подтверждения с полным адресом.
    case otherScheme
    /// Схема, которую из содержимого не открываем вовсе: исполняет код или читает файлы.
    case refused

    private static let refusedSchemes: Set<String> = ["javascript", "vbscript", "file", "data", "blob", "about"]

    init(_ url: URL, ourWeb base: URL? = AppConfiguration.webBaseURL) {
        guard let scheme = url.scheme?.lowercased() else {
            self = .refused
            return
        }
        if scheme == DeepLink.scheme {
            self = .ourWeb
            return
        }
        guard scheme == "http" || scheme == "https" else {
            self = Self.refusedSchemes.contains(scheme) ? .refused : .otherScheme
            return
        }
        guard let host = Self.displayHost(url) else {
            self = .refused
            return
        }
        // Логин в адресе (`https://studenthub.kz@evil.org`) — приём, чтобы человек
        // принял начало адреса за сайт: такой адрес не «наш», даже если хост совпал.
        if let base, !Self.hasUserInfo(url), Self.isSameOrigin(url, as: base) {
            self = .ourWeb
        } else {
            self = .web(host: host)
        }
    }

    /// Хост, который видит человек: из самого URL, без `user:password@`, в нижнем
    /// регистре. `nil` — адрес без хоста.
    static func displayHost(_ url: URL) -> String? {
        guard let host = url.host(), !host.isEmpty else { return nil }
        return host.lowercased()
    }

    /// В адресе есть логин или пароль — часть до `@`, которую легко принять за сайт.
    static func hasUserInfo(_ url: URL) -> Bool {
        url.user() != nil || url.password() != nil
    }

    /// Та же схема, хост и порт, что у `base`.
    static func isSameOrigin(_ url: URL, as base: URL) -> Bool {
        url.scheme?.lowercased() == base.scheme?.lowercased()
            && url.host()?.lowercased() == base.host()?.lowercased()
            && url.port == base.port
    }
}

/// Единая точка, через которую уходит каждая ссылка из чужого содержимого: наш веб —
/// внутри приложения, чужой http(s) — во встроенном Safari после подтверждения, прочие
/// схемы — только после подтверждения с полным адресом. Проверка в одном месте: новый
/// путь открытия ссылок, минующий её, — дыра (`docs/IOS_RULES.md` 10.3.4).
@MainActor
enum ExternalLinkOpener {
    /// Подтверждение висит одно: второе касание, пока окно открыто, не громоздит окна.
    private static var isConfirming = false
    /// Хосты, на которые человек уже согласился в этом запуске, — второй раз не
    /// спрашиваем. Только в памяти: новый запуск — новое согласие.
    private static var approvedHosts: Set<String> = []

    /// `OpenURLAction` для `.environment(\.openURL, …)`: markdown-ссылки текста и
    /// SwiftUI `Link` внутри уходят сюда, а не в систему.
    static var action: OpenURLAction {
        OpenURLAction { url in
            open(url)
            return .handled
        }
    }

    static func open(_ url: URL) {
        switch ExternalLink(url) {
        case .ourWeb:
            let router = AppServices.router
            if router.open(url, for: router.currentRole) { return }
            // Наш веб, но раздела нет в приложении — та же страница во встроенном Safari.
            if isWeb(url) { presentSafari(url) }
        case .web(let host):
            // Адрес с логином спрашиваем всякий раз: согласие на хост не про него.
            let remember = !ExternalLink.hasUserInfo(url)
            if remember, approvedHosts.contains(host) {
                presentSafari(url)
                return
            }
            confirm(
                title: String(localized: "links.confirm.title", defaultValue: "Открыть ссылку?"),
                message: "\(host)\n\n\(url.absoluteString)"
            ) {
                if remember { approvedHosts.insert(host) }
                presentSafari(url)
            }
        case .otherScheme:
            confirm(
                title: String(localized: "links.confirm.otherApp", defaultValue: "Открыть в другом приложении?"),
                message: url.absoluteString
            ) {
                UIApplication.shared.open(url)
            }
        case .refused:
            break
        }
    }

    private static func isWeb(_ url: URL) -> Bool {
        let scheme = url.scheme?.lowercased()
        return scheme == "http" || scheme == "https"
    }

    /// Встроенный Safari поверх приложения, как в Telegram: «Готово» возвращает туда,
    /// где человек был. Показывается самым верхним контроллером окна — так он встаёт
    /// поверх и листа, и стека.
    private static func presentSafari(_ url: URL) {
        guard let presenter = topController() else {
            UIApplication.shared.open(url)
            return
        }
        let safari = SFSafariViewController(url: url)
        safari.preferredControlTintColor = UIColor(Palette.primary)
        safari.dismissButtonStyle = .close
        presenter.present(safari, animated: true)
    }

    /// Алерт UIKit, а не SwiftUI: открыватель зовут и из ячеек ленты на
    /// `UIHostingConfiguration`, где у SwiftUI нет общего места для состояния окна.
    /// Показать некому — не открываем: молча уйти по ссылке хуже, чем не уйти.
    private static func confirm(title: String, message: String, onOpen: @escaping @MainActor () -> Void) {
        guard !isConfirming, let presenter = topController() else { return }
        isConfirming = true
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(
            UIAlertAction(title: String(localized: "common.cancel", defaultValue: "Отмена"), style: .cancel) { _ in
                isConfirming = false
            }
        )
        alert.addAction(
            UIAlertAction(title: String(localized: "links.confirm.open", defaultValue: "Открыть"), style: .default) { _ in
                isConfirming = false
                onOpen()
            }
        )
        presenter.present(alert, animated: true)
    }

    private static func topController() -> UIViewController? {
        let window = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)
        var top = window?.rootViewController
        while let presented = top?.presentedViewController, !presented.isBeingDismissed {
            top = presented
        }
        return top
    }
}
