import SafariServices
import SwiftUI
import UIKit

/// Единая точка, через которую уходит каждая ссылка из чужого содержимого: наш веб —
/// внутри приложения, чужой http(s) — во встроенном Safari после подтверждения, прочие
/// схемы — только после подтверждения с полным адресом. Проверка в одном месте: новый
/// путь открытия ссылок, минующий её, — дыра (`docs/IOS_RULES.md` 10.3.4). Разбор адреса —
/// `ExternalLink` в ядре; здесь — показ: алерт, Safari, переход роутера.
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
