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

    /// Видимый текст ссылки сам похож на адрес, а ведёт она на другой хост:
    /// `[studenthub.kz](https://evil.org)`. Такую открываем только после подтверждения
    /// с настоящим адресом, даже если хост уже одобряли (`docs/IOS_RULES.md` 10.3.6).
    /// Не-http(s) схемы сюда не попадают: их и так всегда подтверждают.
    static func isConcealed(text: String, url: URL) -> Bool {
        let scheme = url.scheme?.lowercased()
        guard scheme == "http" || scheme == "https" else { return false }
        let shown = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !shown.isEmpty, !shown.contains(where: \.isWhitespace) else { return false }
        let candidate = shown.contains("://") ? shown : "https://" + shown
        guard let shownURL = URL(string: candidate), let shownHost = displayHost(shownURL),
              looksLikeDomain(shownHost)
        else { return false }
        return withoutWWW(shownHost) != displayHost(url).map(withoutWWW)
    }

    /// Хост из букв и цифр с точкой и буквенной зоной: «studenthub.kz», но не «1.5»,
    /// не «т.е.» и не одно слово.
    private static func looksLikeDomain(_ host: String) -> Bool {
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        guard labels.count >= 2, labels.allSatisfy({ !$0.isEmpty }), let zone = labels.last else { return false }
        return zone.count >= 2 && zone.allSatisfy(\.isLetter)
    }

    private static func withoutWWW(_ host: String) -> String {
        host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    /// Та же схема, хост и порт, что у `base`.
    static func isSameOrigin(_ url: URL, as base: URL) -> Bool {
        url.scheme?.lowercased() == base.scheme?.lowercased()
            && url.host()?.lowercased() == base.host()?.lowercased()
            && url.port == base.port
    }
}

/// Ссылки текста, у которых видимый текст выдаёт себя за другой адрес. `OpenURLAction`
/// получает только URL, поэтому разбор текста (`RichText`) отмечает их здесь, а
/// открыватель сверяется. Разбор идёт и фоном — отсюда замок. Растёт только на такие
/// ссылки (их единицы); чистится вместе с кешем разобранных текстов при выходе.
enum ConcealedLinks {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var marked: Set<String> = []

    static func mark(_ url: URL) {
        _ = lock.withLock { marked.insert(url.absoluteString) }
    }

    static func contains(_ url: URL) -> Bool {
        lock.withLock { marked.contains(url.absoluteString) }
    }

    static func clear() {
        lock.withLock { marked.removeAll() }
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

    /// Схемы, которые зовут только наши же кнопки («Позвонить», «Открыть настройки»,
    /// App Store): разбор текста `RichText` их из содержимого снимает, а звонок система
    /// и так подтверждает сама. Второй вопрос поверх системного был бы лишним.
    private static let systemSchemes: Set<String> = ["tel", "app-settings", "itms-apps"]

    /// `OpenURLAction` для `.environment(\.openURL, …)` в корне приложения и в ячейках
    /// ленты чата: markdown-ссылки текста, SwiftUI `Link` и `openURL` экранов уходят
    /// сюда, а не в систему.
    static var action: OpenURLAction {
        OpenURLAction { url in
            if let scheme = url.scheme?.lowercased(), systemSchemes.contains(scheme) {
                return .systemAction
            }
            open(url)
            return .handled
        }
    }

    /// - Parameter confirmed: человек уже выбрал этот адрес в нашем окне, где адрес был
    ///   виден целиком (меню контакта «Позвонить +7…», «Написать на …»): второй раз
    ///   не спрашиваем. Опасные схемы и тогда не открываем.
    static func open(_ url: URL, confirmed: Bool = false) {
        // Текст ссылки выдаёт себя за другой адрес — спрашиваем всегда, даже про наш
        // веб и уже одобренный хост: человек шёл не туда, куда ведёт ссылка.
        let concealed = !confirmed && ConcealedLinks.contains(url)
        switch ExternalLink(url) {
        case .ourWeb:
            if concealed {
                confirm(title: confirmTitle, message: confirmMessage(url)) { openOurWeb(url) }
            } else {
                openOurWeb(url)
            }
        case .web(let host):
            // Адрес с логином спрашиваем всякий раз: согласие на хост не про него.
            let remember = !ExternalLink.hasUserInfo(url)
            if confirmed || (remember && !concealed && approvedHosts.contains(host)) {
                presentSafari(url)
                return
            }
            confirm(title: confirmTitle, message: confirmMessage(url)) {
                if remember { approvedHosts.insert(host) }
                presentSafari(url)
            }
        case .otherScheme:
            if confirmed {
                UIApplication.shared.open(url)
                return
            }
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

    private static var confirmTitle: String {
        String(localized: "links.confirm.title", defaultValue: "Открыть ссылку?")
    }

    /// Хост из самого URL (без логина) и полный адрес — ни подпись превью, ни текст
    /// ссылки сюда не попадают.
    private static func confirmMessage(_ url: URL) -> String {
        let host = ExternalLink.displayHost(url) ?? ""
        return host.isEmpty ? url.absoluteString : "\(host)\n\n\(url.absoluteString)"
    }

    private static func openOurWeb(_ url: URL) {
        let router = AppServices.router
        if router.open(url, for: router.currentRole) { return }
        // Наш веб, но раздела нет в приложении — та же страница во встроенном Safari.
        if isWeb(url) { presentSafari(url) }
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
        present(safari, over: presenter)
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
        present(alert, over: presenter)
    }

    /// Открыватель зовут и из кнопок системных окон («Скопировать и открыть», меню
    /// контакта), пока те ещё закрываются. Показ поверх уходящего окна UIKit молча
    /// отбрасывает — и «одно подтверждение» зависло бы навсегда. Ждём конца ухода.
    private static func present(_ controller: UIViewController, over presenter: UIViewController) {
        if let leaving = presenter.presentedViewController, let coordinator = leaving.transitionCoordinator {
            coordinator.animate(alongsideTransition: nil) { _ in
                presenter.present(controller, animated: true)
            }
        } else {
            presenter.present(controller, animated: true)
        }
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
