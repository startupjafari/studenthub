import XCTest

@testable import StudentHub

/// Сверка строк (задача 5.1 плана).
///
/// Тест читает исходники и каталог строк с диска — это не изящно, но единственный
/// способ поймать настоящую ошибку: строку добавили в код и забыли в каталоге.
/// На собранном бандле её уже не видно, потому что значение по умолчанию живёт
/// прямо в вызове и подменяет собой отсутствующий перевод.
final class LocalizationTests: XCTestCase {
    private typealias Catalog = [String: [String: [String: [String: String]]]]

    func testEveryKeyFromCodeIsInTheCatalog() throws {
        let (keysInCode, catalog) = try load()

        let missing = keysInCode.keys.filter { catalog[$0] == nil }.sorted()
        XCTAssertTrue(missing.isEmpty, "нет в каталоге: \(missing.joined(separator: ", "))")
    }

    /// Русский — исходный язык: он обязан быть у каждой строки, иначе каталог
    /// рассыпается на половине экранов.
    func testEveryKeyHasRussian() throws {
        let (_, catalog) = try load()

        let withoutRussian = catalog.filter { $0.value["ru"]?["stringUnit"]?["value"] == nil }.keys.sorted()
        XCTAssertTrue(withoutRussian.isEmpty, "нет русского: \(withoutRussian.joined(separator: ", "))")
    }

    /// Русский в каталоге должен совпадать со значением по умолчанию в коде:
    /// разойдясь, они дают разный текст на одном и том же экране в зависимости от
    /// того, собрался каталог или нет.
    func testRussianMatchesDefaultsInCode() throws {
        let (keysInCode, catalog) = try load()

        let diverged = keysInCode.filter { key, value in
            guard let inCatalog = catalog[key]?["ru"]?["stringUnit"]?["value"] else { return false }
            return inCatalog != value
        }.keys.sorted()

        XCTAssertTrue(diverged.isEmpty, "каталог разошёлся с кодом: \(diverged.joined(separator: ", "))")
    }

    /// Каталог не должен копить мусор: ключ, которого в коде нет, никто не увидит,
    /// но переводчик потратит на него время.
    func testCatalogHasNoOrphanKeys() throws {
        let (keysInCode, catalog) = try load()

        let orphans = catalog.keys.filter { keysInCode[$0] == nil }.sorted()
        XCTAssertTrue(orphans.isEmpty, "лишние в каталоге: \(orphans.joined(separator: ", "))")
    }

    // MARK: - Чтение исходников

    private func load() throws -> ([String: String], Catalog) {
        let root = URL(filePath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let catalogURL = root.appending(path: "Resources/Localizable.xcstrings")
        let data = try Data(contentsOf: catalogURL)
        let parsed = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let strings = (parsed?["strings"] as? [String: Any]) ?? [:]

        var catalog: Catalog = [:]
        for (key, value) in strings {
            guard
                let entry = value as? [String: Any],
                let localizations = entry["localizations"] as? [String: [String: [String: String]]]
            else { continue }
            catalog[key] = localizations
        }

        return (try keysFromSources(root: root.appending(path: "Sources")), catalog)
    }

    /// Разбор вызовов `String(localized:defaultValue:)` из исходников.
    private func keysFromSources(root: URL) throws -> [String: String] {
        var found: [String: String] = [:]
        let pattern = try NSRegularExpression(
            pattern: #"String\(\s*localized:\s*"([^"]+)",\s*defaultValue:\s*("""[\s\S]*?"""|"(?:[^"\\]|\\.)*")"#
        )
        guard let files = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil) else {
            return found
        }

        for case let file as URL in files where file.pathExtension == "swift" {
            let text = try String(contentsOf: file, encoding: .utf8)
            let range = NSRange(text.startIndex..., in: text)
            for match in pattern.matches(in: text, range: range) {
                guard
                    let keyRange = Range(match.range(at: 1), in: text),
                    let valueRange = Range(match.range(at: 2), in: text)
                else { continue }
                found[String(text[keyRange])] = Self.unquote(String(text[valueRange]))
            }
        }
        return found
    }

    /// Многострочный литерал склеивается так же, как его показывает система:
    /// переносы внутри кода — это форматирование, а не часть текста.
    private static func unquote(_ raw: String) -> String {
        if raw.hasPrefix("\"\"\"") {
            let body = raw.dropFirst(3).dropLast(3)
            return body
                .split(separator: "\n")
                .map { $0.replacingOccurrences(of: "\\", with: "").trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
                .joined(separator: " ")
        }
        return String(raw.dropFirst().dropLast())
    }
}
