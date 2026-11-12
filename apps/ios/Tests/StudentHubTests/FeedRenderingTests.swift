import UIKit
import XCTest

@testable import StudentHub

/// Итерация 4: цель декодирования под размер вида, даунсемплинг, кеш картинок в
/// памяти, кеш разбора текста, окно предзагрузки ленты.
final class ImageTargetTests: XCTestCase {
    /// Соседние размеры одной ячейки — одна цель: загрузка не перезапускается на
    /// каждый пиксель раскладки.
    func testViewTargetIsBucketed() {
        let a = ImageTarget.view(CGSize(width: 120, height: 80), scale: 3, mode: .fill)
        let b = ImageTarget.view(CGSize(width: 120.3, height: 80.2), scale: 3, mode: .fill)

        XCTAssertEqual(a, b)
        XCTAssertEqual(a?.width, 384)
        XCTAssertEqual(a?.height, 256)
        XCTAssertNil(ImageTarget.view(.zero, scale: 3, mode: .fill), "вид ещё не разложен")
    }

    /// `longSide` — прежний `maxPixelSize`: длинная сторона копии не больше заданной.
    func testLongSideMatchesMaxPixelSize() {
        let target = ImageTarget.longSide(156)

        XCTAssertEqual(target.longSide(sourceWidth: 1024, sourceHeight: 768), 156)
        XCTAssertEqual(target.longSide(sourceWidth: 768, sourceHeight: 1024), 156)
    }

    /// Заполнить широкую плитку высоким снимком — нужна копия по ширине, она длиннее
    /// плитки по высоте. Вписать — по высоте.
    func testFillAndFitPickDifferentSides() {
        let fill = ImageTarget(width: 1000, height: 500, mode: .fill)
        let fit = ImageTarget(width: 1000, height: 500, mode: .fit)

        XCTAssertEqual(fill.longSide(sourceWidth: 2000, sourceHeight: 4000), 2000)
        XCTAssertEqual(fit.longSide(sourceWidth: 2000, sourceHeight: 4000), 500)
    }

    func testNeverUpscalesPastOriginal() {
        let target = ImageTarget(width: 3000, height: 3000, mode: .fill)

        XCTAssertEqual(target.longSide(sourceWidth: 800, sourceHeight: 600), 800)
    }

    func testSatisfactionDependsOnMode() {
        let fill = ImageTarget(width: 600, height: 600, mode: .fill)
        let fit = ImageTarget(width: 600, height: 600, mode: .fit)

        XCTAssertFalse(fill.isSatisfied(byWidth: 600, height: 300), "заполнить — нужны обе стороны")
        XCTAssertTrue(fit.isSatisfied(byWidth: 600, height: 300), "вписать — хватает одной")
        XCTAssertTrue(fill.isSatisfied(byWidth: 560, height: 560), "запас 10 %")
    }
}

final class ImageDownsamplerTests: XCTestCase {
    func testDecodesCopySizedForTarget() throws {
        let data = try XCTUnwrap(Self.png(width: 1200, height: 800))

        let decoded = try XCTUnwrap(ImageDownsampler.decode(data, target: .longSide(300)))

        XCTAssertEqual(max(decoded.pixelWidth, decoded.pixelHeight), 300)
        XCTAssertFalse(decoded.isFullResolution)
    }

    func testWithoutTargetDecodesFullFrame() throws {
        let data = try XCTUnwrap(Self.png(width: 200, height: 100))

        let decoded = try XCTUnwrap(ImageDownsampler.decode(data, target: nil))

        XCTAssertEqual(decoded.pixelWidth, 200)
        XCTAssertEqual(decoded.pixelHeight, 100)
        XCTAssertTrue(decoded.isFullResolution)
    }

    func testGarbageIsNotAnImage() {
        XCTAssertNil(ImageDownsampler.decode(Data("не картинка".utf8), target: nil))
    }

    static func png(width: Int, height: Int) -> Data? {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format)
        return renderer.pngData { context in
            UIColor.systemTeal.setFill()
            context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        }
    }
}

final class ImageMemoryCacheTests: XCTestCase {
    /// На ключ — одна копия, самая крупная: мелкая не вытесняет крупную, крупная
    /// подходит мелкой цели, мелкая крупной — нет.
    func testKeepsLargestCopyAndChecksTarget() throws {
        let cache = ImageMemoryCache()
        let big = try XCTUnwrap(ImageDownsampler.decode(XCTUnwrap(ImageDownsamplerTests.png(width: 1000, height: 1000)), target: .longSide(600)))
        let small = try XCTUnwrap(ImageDownsampler.decode(XCTUnwrap(ImageDownsamplerTests.png(width: 1000, height: 1000)), target: .longSide(100)))

        cache.store(big, for: "k")
        cache.store(small, for: "k")

        XCTAssertNotNil(cache.image(for: "k", satisfying: .longSide(300)))
        XCTAssertNil(cache.image(for: "k", satisfying: .longSide(900)), "копии не хватает — догрузить")
        XCTAssertNil(cache.image(for: "k", satisfying: nil), "полного кадра нет")
        XCTAssertEqual(cache.image(for: "k")?.cgImage?.width, 600)
    }

    func testRemoveAllForgetsEverything() throws {
        let cache = ImageMemoryCache()
        let decoded = try XCTUnwrap(ImageDownsampler.decode(XCTUnwrap(ImageDownsamplerTests.png(width: 10, height: 10)), target: nil))
        cache.store(decoded, for: "k")

        cache.removeAll()

        XCTAssertNil(cache.image(for: "k"))
    }
}

final class RichTextCacheTests: XCTestCase {
    override func setUp() {
        super.setUp()
        RichText.clearCache()
    }

    /// Разбор заранее кладёт результат в кеш — ячейка получит готовое; тот же текст
    /// разбирается так же, как без кеша.
    func testPrepareFillsCache() {
        let text = "**жирный** и https://example.com и @aisulu_k"
        XCTAssertNil(RichText.cached(text))

        RichText.prepare([text])

        XCTAssertEqual(RichText.cached(text), RichText.attributed(text))
        XCTAssertNotNil(RichText.cached(text))
    }

    /// Правка сообщения меняет текст — и ключ: старый разбор не покажется.
    func testEditedTextIsParsedAgain() {
        let original = RichText.attributed("было")
        let edited = RichText.attributed("стало **жирно**")

        XCTAssertNotEqual(String(original.characters), String(edited.characters))
        XCTAssertEqual(String(edited.characters), "стало жирно")
    }

    func testClearCacheForgets() {
        _ = RichText.attributed("текст прежнего человека")

        RichText.clearCache()

        XCTAssertNil(RichText.cached("текст прежнего человека"))
    }

    /// Опасная схема не становится ссылкой и из кеша.
    func testUnsafeLinkStaysPlainAfterCaching() {
        let text = "[нажми](javascript:alert(1))"
        _ = RichText.attributed(text)

        let cached = RichText.attributed(text)

        XCTAssertTrue(cached.runs.allSatisfy { $0.link == nil })
    }
}

@MainActor
final class FeedPrefetcherTests: XCTestCase {
    func testWindowIsNextPostsAfterLastVisible() {
        let posts = (1...10).map { post("p-\($0)") }

        let window = FeedPrefetcher.window(visible: ["p-2", "p-3"], posts: posts, lookahead: 4)

        XCTAssertEqual(window.map(\.id), ["p-4", "p-5", "p-6", "p-7"])
        XCTAssertTrue(FeedPrefetcher.window(visible: [], posts: posts, lookahead: 4).isEmpty)
        XCTAssertTrue(FeedPrefetcher.window(visible: ["p-10"], posts: posts, lookahead: 4).isEmpty)
    }

    /// Предзагрузка кладёт картинку под тот же ключ, что спросит плитка ленты.
    func testImageRequestUsesTileCacheKey() throws {
        let media = PostDTO.Media(id: "m-1", url: "https://cdn/m-1.jpg", mime: "image/jpeg", width: 1200, height: 900)
        let post = post("p-1", media: [media])

        let request = try XCTUnwrap(FeedPrefetcher.imageRequest(for: post, width: 360, scale: 3))

        XCTAssertEqual(request.key, media.cacheKey(cardImagePoints))
        XCTAssertEqual(request.target.mode, .fill)
        XCTAssertEqual(request.target.width, 1088)
    }

    private func post(_ id: String, media: [PostDTO.Media]? = nil) -> PostDTO {
        PostDTO(id: id, content: "текст \(id)", createdAt: Date(), author: nil, media: media, reactionSummary: nil, counts: nil)
    }
}

@MainActor
final class CommentThreadsTests: XCTestCase {
    func testRepliesGroupedByRootInOrder() {
        let grouped = PostCommentsModel.groupReplies([
            comment("c-1", parent: nil),
            comment("c-2", parent: "c-1"),
            comment("c-3", parent: nil),
            comment("c-4", parent: "c-1"),
        ])

        XCTAssertEqual(grouped["c-1"]?.map(\.id), ["c-2", "c-4"])
        XCTAssertNil(grouped["c-3"])
    }

    private func comment(_ id: String, parent: String?) -> PostCommentDTO {
        PostCommentDTO(id: id, content: id, createdAt: Date(), author: nil, parentId: parent)
    }
}
