import XCTest

/// Кнопки панели вкладок iOS 26 — общие для UI-сценариев и замеров производительности.
///
/// Панель Liquid Glass во время анимации выбора отдаёт в дерево доступности по два
/// элемента с одной подписью: кнопку и её копию под «линзой». Копия живёт доли секунды.
/// Элемент, взятый по индексу (`element(boundBy: 1)`), её не переживает: копия ушла —
/// элемент указывает в пустоту, и `waitForExistence` ждёт его до таймаута («нет вкладки
/// «Чаты»» при кнопке на экране). Поэтому сначала ждём, пока копия уйдёт, и отдаём
/// `firstMatch` — он разрешается заново при каждом обращении.
enum TabBarButtons {
    static func button(_ title: String, in app: XCUIApplication) -> XCUIElement {
        let matches = app.tabBars.buttons.matching(NSPredicate(format: "label == %@", title))
        guard matches.count > 1 else { return matches.firstMatch }

        let single = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in matches.count <= 1 }, object: nil)
        if XCTWaiter().wait(for: [single], timeout: 3) == .completed {
            return matches.firstMatch
        }
        // Копия не уходит — `firstMatch` может оказаться ею. Берём нажимаемую.
        for index in 0..<matches.count where matches.element(boundBy: index).isHittable {
            return matches.element(boundBy: index)
        }
        return matches.firstMatch
    }
}
