import UIKit
import XCTest

@testable import StudentHub

/// Медиа по правилам 8.4.4 и 8.5.1: окно прогрева плиток листа вложений и картинка
/// плитки как первый кадр просмотра.
final class MediaPickerRulesTests: XCTestCase {
    func testWarmWindowSurroundsVisibleTilesWithinBounds() {
        XCTAssertEqual(PhotoThumbnails.window(visible: [], count: 50, behind: 6, ahead: 12), 0..<0)
        XCTAssertEqual(PhotoThumbnails.window(visible: [3], count: 0, behind: 6, ahead: 12), 0..<0)
        XCTAssertEqual(PhotoThumbnails.window(visible: [0, 1, 2, 3, 4, 5], count: 300, behind: 6, ahead: 12), 0..<18)
        XCTAssertEqual(PhotoThumbnails.window(visible: [30, 32, 31], count: 300, behind: 6, ahead: 12), 24..<45)
        XCTAssertEqual(PhotoThumbnails.window(visible: [295, 299], count: 300, behind: 6, ahead: 12), 289..<300)
    }

    /// Видимые индексы старого списка за его новой границей — пустое окно, а не падение.
    func testWarmWindowIgnoresIndicesBeyondShrunkList() {
        let window = PhotoThumbnails.window(visible: [40], count: 10, behind: 6, ahead: 12)
        XCTAssertTrue(window.isEmpty)
        XCTAssertLessThanOrEqual(window.upperBound, 10)
    }

    func testViewerFindsTileImageByFileID() {
        let cache = ImageMemoryCache()
        let image = UIGraphicsImageRenderer(size: CGSize(width: 4, height: 4)).image { _ in }
        cache.store(image, for: "att:file-1:280")

        XCTAssertNil(cache.tileImage(forFile: "file-1"))
        cache.noteTile("att:file-1:280", forFile: "file-1")
        XCTAssertNotNil(cache.tileImage(forFile: "file-1"))

        cache.removeAll()
        cache.store(image, for: "att:file-1:280")
        XCTAssertNil(cache.tileImage(forFile: "file-1"), "после выхода из аккаунта связь плитки с файлом забыта")
    }
}
