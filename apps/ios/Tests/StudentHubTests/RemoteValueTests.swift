import XCTest

@testable import StudentHub

/// Одно значение экрана по сети (P1-8 аудита): общая политика вместо `@State` и
/// `do/catch` в каждом экране.
@MainActor
final class RemoteValueTests: XCTestCase {
    private struct Boom: Error {}

    /// Обновление не удалось — показанное остаётся, ошибка рядом; следующий успех её снимает.
    func testFailureKeepsShownValue() async {
        let remote = RemoteValue<Int>(caching: false)

        await remote.load { 1 }
        XCTAssertEqual(remote.value, 1)
        XCTAssertNil(remote.failure)
        XCTAssertTrue(remote.checkedCache)

        await remote.load { throw Boom() }
        XCTAssertEqual(remote.value, 1)
        XCTAssertNotNil(remote.failure)

        await remote.load { 2 }
        XCTAssertEqual(remote.value, 2)
        XCTAssertNil(remote.failure)
    }

    /// Первая загрузка не удалась — значения нет, есть ошибка на весь экран.
    func testFirstFailureLeavesNoValue() async {
        let remote = RemoteValue<Int>(caching: false)
        await remote.load { throw Boom() }
        XCTAssertNil(remote.value)
        XCTAssertNotNil(remote.failure)
    }

    /// Медленная загрузка, которую обогнала новая (жест обновления поверх первой), не
    /// перетирает свежее значение.
    func testOlderLoadDoesNotOverwriteNewer() async {
        let remote = RemoteValue<Int>(caching: false)
        let (gate, open) = AsyncStream<Void>.makeStream()

        async let slow: Void = remote.load {
            for await _ in gate { break }
            return 1
        }
        await Task.yield()
        await remote.load { 2 }
        open.yield()
        open.finish()
        await slow

        XCTAssertEqual(remote.value, 2)
    }

    /// Отменённая загрузка ничего не пишет: загрузка, гасящая ошибки частей, вернула бы
    /// пустые блоки вместо отмены.
    func testCancelledLoadDoesNotWrite() async {
        let remote = RemoteValue<Int>(caching: false)
        await remote.load { 1 }

        let task = Task { @MainActor in
            await remote.load {
                withUnsafeCurrentTask { $0?.cancel() }
                return 0
            }
        }
        await task.value

        XCTAssertEqual(remote.value, 1)
        XCTAssertNil(remote.failure)
    }
}
