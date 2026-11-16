import XCTest

@testable import StudentHub

/// Чтение выбранного файла (P2-4 аудита): вне главного потока и синхронно — одно и то же.
final class PickedFileTests: XCTestCase {
    func testAsyncAndSyncReadSameBytes() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("picked-\(UUID().uuidString).csv")
        let bytes = Data("ФИО;Почта\nИванов;i@example.com\n".utf8)
        try bytes.write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }

        let async = try await PickedFile.read(url)
        let now = try PickedFile.readNow(url)

        XCTAssertEqual(async, bytes)
        XCTAssertEqual(now, bytes)
    }

    func testMissingFileThrows() async {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("missing-\(UUID().uuidString)")
        do {
            _ = try await PickedFile.read(url)
            XCTFail("ожидалась ошибка")
        } catch {}
    }
}
