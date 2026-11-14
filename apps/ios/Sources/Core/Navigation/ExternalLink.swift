import Foundation

/// Куда ведёт ссылка из чужого содержимого (сообщение, превью, материалы чата) и что
/// показать человеку перед переходом. Чистый разбор без UIKit — его проверяют тесты;
/// показ подтверждения и Safari — `ExternalLinkOpener` в `App/ExternalLinkOpener.swift`
/// (ядро без UI-фреймворков, `docs/IOS_RULES.md` 9.1.3).
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
