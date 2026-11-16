import XCTest

@testable import StudentHub

/// Сообщения валидации API (21.B2): сервер отдаёт ключ `validation.…`, текст — наш.
///
/// Источник ключей — реестр `VALIDATION_MESSAGE_KEYS` в `packages/shared-schemas`. Тест
/// читает его с диска, как `LocalizationTests` читает исходники: ключ, добавленный в
/// схему и забытый здесь, на экране выглядел бы сырым `validation.…`.
final class ValidationMessageTests: XCTestCase {
    func testEveryRegistryKeyHasText() throws {
        let keys = try registryKeys()
        XCTAssertFalse(keys.isEmpty)

        let missing = keys.filter { ValidationMessage.text(for: $0) == nil }
        XCTAssertTrue(missing.isEmpty, "нет перевода: \(missing.joined(separator: ", "))")
    }

    /// Три языка у каждой строки: ключ как раз и нужен, чтобы казахский и английский
    /// интерфейс не получали русский текст.
    func testEveryKeyIsTranslatedInCatalog() throws {
        let keys = try registryKeys()
        let catalog = try catalogStrings()

        let gaps = keys.flatMap { key in
            ["ru", "kk", "en"].compactMap { language -> String? in
                let localizations = (catalog[key] as? [String: Any])?["localizations"] as? [String: Any]
                let unit = (localizations?[language] as? [String: Any])?["stringUnit"] as? [String: Any]
                return (unit?["value"] as? String)?.isEmpty == false ? nil : "\(key) [\(language)]"
            }
        }
        XCTAssertTrue(gaps.isEmpty, "нет в каталоге: \(gaps.joined(separator: ", "))")
    }

    func testUnknownKeyAndPlainTextStayAsIs() {
        XCTAssertNil(ValidationMessage.text(for: "validation.fromTheFuture"))
        XCTAssertNil(ValidationMessage.text(for: "Неверный адрес"))

        let unknown = APIErrorDetail(field: "email", message: "validation.fromTheFuture")
        XCTAssertEqual(unknown.displayMessage, "validation.fromTheFuture")

        let known = APIErrorDetail(field: "password", message: "validation.password.tooShort")
        XCTAssertEqual(known.displayMessage, ValidationMessage.text(for: "validation.password.tooShort"))
    }

    // MARK: - Чтение с диска

    private var repositoryRoot: URL {
        URL(filePath: #filePath)
            .deletingLastPathComponent()  // StudentHubTests
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // apps/ios
            .deletingLastPathComponent()  // apps
            .deletingLastPathComponent()
    }

    private func registryKeys() throws -> [String] {
        let url = repositoryRoot.appending(path: "packages/shared-schemas/src/validation-messages.ts")
        let text = try String(contentsOf: url, encoding: .utf8)
        let pattern = try NSRegularExpression(pattern: #"^\s+'(validation\.[\w.]+)',$"#, options: .anchorsMatchLines)
        let range = NSRange(text.startIndex..., in: text)
        return pattern.matches(in: text, range: range).compactMap { match in
            Range(match.range(at: 1), in: text).map { String(text[$0]) }
        }
    }

    private func catalogStrings() throws -> [String: Any] {
        let url = repositoryRoot.appending(path: "apps/ios/Resources/Localizable.xcstrings")
        let parsed = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
        return (parsed?["strings"] as? [String: Any]) ?? [:]
    }
}
