import XCTest

@testable import StudentHub

/// Разбор ссылок из чужого содержимого: человеку показывается настоящий хост, а «наш»
/// адрес нельзя подделать логином в URL (`docs/IOS_RULES.md` 10.3.4, 10.3.5).
final class ExternalLinkTests: XCTestCase {
    private func link(_ string: String, base: URL? = URL(string: "https://app.studenthub.kz")) -> ExternalLink {
        ExternalLink(URL(string: string)!, ourWeb: base)
    }

    func testHostComesFromURLNotFromLogin() {
        let url = URL(string: "https://app.studenthub.kz@evil.org/login")!
        XCTAssertEqual(ExternalLink.displayHost(url), "evil.org")
        XCTAssertTrue(ExternalLink.hasUserInfo(url))
        XCTAssertEqual(link("https://app.studenthub.kz@evil.org/login"), .web(host: "evil.org"))
    }

    /// `∕` (U+2215) похож на слэш: всё до `@` — логин, ведёт ссылка на evil.org.
    func testSlashLookalikeInAuthorityIsLogin() {
        let url = URL(string: "https://telegram.org%E2%88%95test%E2%88%95@evil.org")!
        XCTAssertEqual(ExternalLink.displayHost(url), "evil.org")
        XCTAssertTrue(ExternalLink.hasUserInfo(url))
    }

    func testHostIsLowercased() {
        XCTAssertEqual(ExternalLink.displayHost(URL(string: "HTTPS://Example.COM/Path")!), "example.com")
    }

    /// Логин с паролем на нашем же хосте — всё равно не «наш»: спрашиваем.
    func testOurHostWithLoginIsNotOurs() {
        XCTAssertEqual(link("https://user:pass@app.studenthub.kz/chats"), .web(host: "app.studenthub.kz"))
    }

    func testOurWebAndOwnSchemeStayInApp() {
        XCTAssertEqual(link("https://app.studenthub.kz/chats?c=1"), .ourWeb)
        XCTAssertEqual(link("studenthub://chats?c=1"), .ourWeb)
    }

    func testOtherOriginIsExternal() {
        XCTAssertEqual(link("https://example.com/a"), .web(host: "example.com"))
        XCTAssertEqual(link("http://app.studenthub.kz/chats"), .web(host: "app.studenthub.kz"))
        XCTAssertEqual(link("https://app.studenthub.kz:8443/chats"), .web(host: "app.studenthub.kz"))
        XCTAssertEqual(link("https://app.studenthub.kz.evil.org/"), .web(host: "app.studenthub.kz.evil.org"))
    }

    /// Адрес веба не задан в сборке — «нашего» http(s) нет, каждый спрашиваем.
    func testWithoutWebBaseNothingIsOurs() {
        XCTAssertEqual(link("https://app.studenthub.kz/chats", base: nil), .web(host: "app.studenthub.kz"))
    }

    func testNonWebSchemes() {
        XCTAssertEqual(link("mailto:dean@university.kz"), .otherScheme)
        XCTAssertEqual(link("tel:+77001234567"), .otherScheme)
        XCTAssertEqual(link("javascript:alert(1)"), .refused)
        XCTAssertEqual(link("file:///etc/passwd"), .refused)
    }

    // MARK: - Текст ссылки против адреса (10.3.6)

    private func concealed(_ text: String, _ url: String) -> Bool {
        ExternalLink.isConcealed(text: text, url: URL(string: url)!)
    }

    func testDomainLikeTextPointingElsewhereIsConcealed() {
        XCTAssertTrue(concealed("studenthub.kz", "https://evil.org/login"))
        XCTAssertTrue(concealed("https://studenthub.kz/chats", "https://evil.org"))
        XCTAssertTrue(concealed("kaspi.kz", "https://kaspi.kz.evil.org"))
    }

    func testMatchingHostIsNotConcealed() {
        XCTAssertFalse(concealed("studenthub.kz", "https://studenthub.kz/feed"))
        XCTAssertFalse(concealed("www.studenthub.kz", "https://studenthub.kz"))
        XCTAssertFalse(concealed("StudentHub.KZ", "https://studenthub.kz"))
    }

    /// Обычный текст ссылки — не адрес: «подробнее», «1.5», «т.е.» не спрашиваем.
    func testPlainTextIsNotConcealed() {
        XCTAssertFalse(concealed("подробнее", "https://evil.org"))
        XCTAssertFalse(concealed("версия 1.5", "https://evil.org"))
        XCTAssertFalse(concealed("1.5", "https://evil.org"))
        XCTAssertFalse(concealed("т.е.", "https://evil.org"))
    }

    /// Иные схемы открыватель и так всегда подтверждает.
    func testNonWebSchemeIsNotConcealed() {
        XCTAssertFalse(concealed("studenthub.kz", "mailto:someone@evil.org"))
    }

    /// Разбор текста ленты отмечает подменную ссылку для открывателя.
    func testRichTextMarksConcealedLink() {
        let url = URL(string: "https://evil.example/concealed-\(UUID().uuidString)")!
        _ = RichText.attributed("Наш сайт: [studenthub.kz](\(url.absoluteString))")
        XCTAssertTrue(ConcealedLinks.contains(url))
    }
}
