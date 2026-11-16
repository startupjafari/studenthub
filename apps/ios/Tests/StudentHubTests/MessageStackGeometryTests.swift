import XCTest

@testable import StudentHub

/// Своя раскладка ленты: кеш высот, оценка и позиции строк (шаг 2.5 плана аудита).
final class MessageStackGeometryTests: XCTestCase {
    private func geometry() -> MessageStackGeometry {
        MessageStackGeometry(sections: [
            .init(headerHeight: 30, itemHeights: [40, 60]),
            .init(headerHeight: 30, itemHeights: [50, 50, 50]),
        ])
    }

    func testFramesStackTopToBottom() {
        let stack = geometry()

        XCTAssertEqual(stack.headerFrames.map(\.minY), [0, 130])
        XCTAssertEqual(stack.itemFrames[0].map(\.minY), [30, 70])
        XCTAssertEqual(stack.itemFrames[1].map(\.minY), [160, 210, 260])
        XCTAssertEqual(stack.contentHeight, 310)
    }

    /// Строка выросла — всё ниже сдвинулось на разницу, выше — на месте.
    func testHeightChangeShiftsOnlyBelow() {
        var stack = geometry()

        let delta = stack.setHeight(100, section: 0, item: 1)

        XCTAssertEqual(delta, 40)
        XCTAssertEqual(stack.itemFrames[0][0].minY, 30)
        XCTAssertEqual(stack.headerFrames[1].minY, 170)
        XCTAssertEqual(stack.itemFrames[1].map(\.minY), [200, 250, 300])
        XCTAssertEqual(stack.contentHeight, 350)
    }

    func testSameHeightIsNoChange() {
        var stack = geometry()
        XCTAssertEqual(stack.setHeight(60, section: 0, item: 1), 0)
        XCTAssertEqual(stack.setHeight(10, section: 5, item: 0), 0)
    }

    /// Видимая полоса: только пересекающие её заголовки и строки.
    func testElementsInBand() {
        let stack = geometry()

        let band = stack.elements(from: 75, to: 175)

        XCTAssertEqual(band.headers, [1])
        XCTAssertEqual(band.items.map { "\($0.section).\($0.item)" }, ["0.1", "1.0"])
    }

    func testEmptyBandAndWholeRange() {
        let stack = geometry()
        XCTAssertTrue(stack.elements(from: 400, to: 500).items.isEmpty)
        XCTAssertEqual(stack.elements(from: 0, to: 1000).items.count, 5)
    }

    /// Сдвиг прокрутки — только за строку целиком выше видимого верха.
    func testOffsetAdjustmentOnlyAboveVisibleTop() {
        XCTAssertEqual(MessageStackGeometry.offsetAdjustment(itemMinY: 100, delta: 20, visibleTop: 300), 20)
        XCTAssertEqual(MessageStackGeometry.offsetAdjustment(itemMinY: 300, delta: 20, visibleTop: 300), 0)
        XCTAssertEqual(MessageStackGeometry.offsetAdjustment(itemMinY: 400, delta: 20, visibleTop: 300), 0)
    }

    /// Кеш: ключ несёт содержимое и ширину; переполнение сбрасывает всё.
    func testHeightCacheKeysAndLimit() {
        let cache = MessageHeightCache(limit: 2)
        let a = MessageHeightKey(id: "a", revision: 1, width: 390, category: "L")
        let a2 = MessageHeightKey(id: "a", revision: 2, width: 390, category: "L")
        let b = MessageHeightKey(id: "b", revision: 1, width: 390, category: "L")
        let c = MessageHeightKey(id: "c", revision: 1, width: 390, category: "L")

        cache.store(40, for: a)
        XCTAssertEqual(cache.height(for: a), 40)
        XCTAssertNil(cache.height(for: a2))

        cache.store(50, for: b)
        cache.store(60, for: c)
        XCTAssertEqual(cache.count, 1)
        XCTAssertEqual(cache.height(for: c), 60)
    }

    /// Оценка растёт с длиной текста, медиа и реакциями.
    func testEstimateGrowsWithContent() {
        let metrics = MessageHeightEstimate.Metrics(textWidth: 250, lineHeight: 22, charWidth: 8, captionLineHeight: 20)
        let short = MessageHeightEstimate.estimate(.init(textLength: 10), metrics: metrics)
        let long = MessageHeightEstimate.estimate(.init(textLength: 300), metrics: metrics)
        var photo = MessageHeightEstimate.Input()
        photo.media = (240, 180)
        var reacted = MessageHeightEstimate.Input(textLength: 10)
        reacted.hasReactions = true

        // Поля пузыря 6 + 6, строка внутри группы 1 + 1, реакции 20 + 3 + 3 + зазор 4.
        XCTAssertEqual(short, 12 + 22 + 2)
        XCTAssertGreaterThan(long, short + 22 * 8)
        XCTAssertEqual(MessageHeightEstimate.estimate(photo, metrics: metrics), 12 + 180 + 2)
        XCTAssertEqual(MessageHeightEstimate.estimate(reacted, metrics: metrics), short + 30)
    }

    /// Оценка берёт отступы из тех же констант, что и вид, а не свои числа.
    func testEstimateUsesBubbleMetrics() {
        let metrics = MessageHeightEstimate.Metrics(textWidth: 250, lineHeight: 22, charWidth: 8, captionLineHeight: 20)
        XCTAssertEqual(metrics.bubblePadding, Double(ChatBubbleMetrics.verticalPadding * 2))
        XCTAssertEqual(metrics.groupGap, Double(ChatBubbleMetrics.rowMargin(isLastInGroup: false) * 2))
        XCTAssertEqual(metrics.lastGap, Double(ChatBubbleMetrics.rowMargin(isLastInGroup: true) * 2))
        XCTAssertEqual(metrics.fileRowHeight, Double(ChatBubbleMetrics.fileRowHeight + ChatBubbleMetrics.partSpacing))
    }
}
