import XCTest

@testable import StudentHub

/// Казахский: `kz` в API и данных, `kk` у системы — граница только в `AppLanguage`.
final class AppLanguageTests: XCTestCase {
    func testPlatformTagsBecomeAppCodes() {
        XCTAssertEqual(AppLanguage.fromPlatform("kk"), "kz")
        XCTAssertEqual(AppLanguage.fromPlatform("kk-KZ"), "kz")
        XCTAssertEqual(AppLanguage.fromPlatform("kz"), "kz")
        XCTAssertEqual(AppLanguage.fromPlatform("ru_RU"), "ru")
        XCTAssertEqual(AppLanguage.fromPlatform(" EN-us "), "en")
    }

    func testUnsupportedAndEmptyAreNil() {
        XCTAssertNil(AppLanguage.fromPlatform("de"))
        XCTAssertNil(AppLanguage.fromPlatform(""))
        XCTAssertNil(AppLanguage.fromPlatform(nil))
    }

    func testAppCodesBecomePlatformCodes() {
        XCTAssertEqual(AppLanguage.toPlatform("kz"), "kk")
        XCTAssertEqual(AppLanguage.toPlatform("ru"), "ru")
        XCTAssertEqual(AppLanguage.toPlatform("en"), "en")
    }

    func testCurrentIsAlwaysSupported() {
        XCTAssertTrue(AppLanguage.supported.contains(AppLanguage.current))
    }

    /// Варианты выбора — JSON сервера: сохранённые до перехода на `kz` держат казахский
    /// под `labelKk`, и при пересохранении услуги перевод не должен пропасть.
    func testFieldOptionReadsLegacyKazakhLabel() throws {
        let legacy = try JSONDecoder().decode(
            StaffFieldOption.self,
            from: Data(#"{"value":"ru","labelRu":"Русский","labelKk":"Орыс","labelEn":"Russian"}"#.utf8)
        )
        XCTAssertEqual(legacy.labelKz, "Орыс")

        let current = try JSONDecoder().decode(
            StaffFieldOption.self,
            from: Data(#"{"value":"ru","labelRu":"Русский","labelKz":"Орыс тілі","labelKk":"Орыс"}"#.utf8)
        )
        XCTAssertEqual(current.labelKz, "Орыс тілі")

        let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(legacy)) as? [String: String]
        XCTAssertEqual(encoded?["labelKz"], "Орыс")
        XCTAssertNil(encoded?["labelKk"])
    }
}
