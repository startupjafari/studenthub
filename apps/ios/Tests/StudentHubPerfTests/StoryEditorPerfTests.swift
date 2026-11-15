import XCTest

/// Замеры редактора историй на mock API (имитация камеры, синтетическая галерея):
/// открытие камеры, появление галереи, рисование, перетаскивание, обработка, память
/// при многократном открытии и возврат из фона.
///
/// Числа с симулятора — сравнительные (`scripts/perf_check.py`, `Tests/perf-baseline.json`):
/// ловят регрессию между коммитами, но не говорят, сколько кадров будет на iPhone.
/// Подвисания под пальцем на 120 Гц и настоящая камера — Instruments на устройстве.
///
/// Без `SH_PERF=1` набор пропускается.
final class StoryEditorPerfTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        guard ProcessInfo.processInfo.environment["SH_PERF"] == "1" else {
            throw XCTSkip("Замеры — только в scripts/test.sh perf (SH_PERF=1)")
        }
        app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(ru)", "-AppleLocale", "ru_RU"]
        app.launchEnvironment["SH_UITEST_MOCK"] = "1"
        app.launchEnvironment["SH_UITEST_SCENARIO"] = "student"
        app.launch()
    }

    override func tearDownWithError() throws {
        app?.terminate()
    }

    private var options: XCTMeasureOptions {
        let options = XCTMeasureOptions()
        options.iterationCount = 5
        options.invocationOptions = [.manuallyStop]
        return options
    }

    private func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    private func openFeed() {
        let feed = TabBarButtons.button("Лента", in: app)
        XCTAssertTrue(feed.waitForExistence(timeout: 20))
        feed.tap()
        XCTAssertTrue(element("stories.add").waitForExistence(timeout: 15))
    }

    private func openStudio() {
        element("stories.add").tap()
        XCTAssertTrue(element("story.camera.shutter").waitForExistence(timeout: 15))
    }

    private func closeStudio() {
        let close = app.buttons["story.camera.close"].firstMatch
        XCTAssertTrue(close.waitForExistence(timeout: 10))
        close.tap()
        XCTAssertTrue(element("stories.add").waitForExistence(timeout: 15))
    }

    private func openEditor() {
        openStudio()
        element("story.camera.shutter").tap()
        XCTAssertTrue(app.buttons["story.editor.next"].waitForExistence(timeout: 15))
    }

    /// Время от «Добавить» до готовой камеры.
    func testCameraOpenTime() {
        openFeed()
        measure(metrics: [XCTClockMetric(), XCTMemoryMetric(application: app)], options: options) {
            openStudio()
            stopMeasuring()
            closeStudio()
        }
    }

    /// Время появления галереи поверх камеры.
    func testGalleryAppearTime() {
        openFeed()
        openStudio()
        measure(metrics: [XCTClockMetric(), XCTCPUMetric(application: app)], options: options) {
            app.buttons["story.camera.gallery"].firstMatch.tap()
            XCTAssertTrue(element("story.gallery.item.synthetic-1").waitForExistence(timeout: 10))
            stopMeasuring()
            app.buttons["story.gallery.close"].firstMatch.tap()
            XCTAssertTrue(element("story.camera.shutter").waitForExistence(timeout: 10))
        }
    }

    /// Рисование: длинные штрихи подряд — CPU и память на кадр жеста.
    func testDrawingStrokes() {
        openFeed()
        openEditor()
        app.buttons["story.editor.draw"].firstMatch.tap()
        let canvas = element("story.drawing.canvas")
        XCTAssertTrue(canvas.waitForExistence(timeout: 10))
        measure(metrics: [XCTClockMetric(), XCTCPUMetric(application: app), XCTMemoryMetric(application: app)], options: options) {
            for row in 0..<4 {
                let y = 0.2 + Double(row) * 0.15
                canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: y))
                    .press(forDuration: 0.02, thenDragTo: canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: y + 0.05)),
                           withVelocity: .default, thenHoldForDuration: 0)
            }
            stopMeasuring()
            app.buttons["story.drawing.clear"].firstMatch.tap()
        }
    }

    /// Перетаскивание надписи по холсту.
    func testEntityDragging() {
        openFeed()
        openEditor()
        app.buttons["story.editor.text"].firstMatch.tap()
        let input = app.textViews["story.text.input"]
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        input.typeText("Перетаскивание")
        app.buttons["story.tool.done"].firstMatch.tap()
        let entity = element("story.entity.text")
        XCTAssertTrue(entity.waitForExistence(timeout: 10))
        let window = app.windows.firstMatch
        measure(metrics: [XCTClockMetric(), XCTCPUMetric(application: app)], options: options) {
            entity.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 0.02, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)))
            element("story.entity.text").coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 0.02, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.55)))
            stopMeasuring()
        }
    }

    /// Ползунок обработки: пересчёт фильтров под пальцем.
    func testFilterSliderApplication() {
        openFeed()
        openEditor()
        app.buttons["story.editor.adjust"].firstMatch.tap()
        let slider = element("story.adjust.contrast")
        XCTAssertTrue(slider.waitForExistence(timeout: 10))
        measure(metrics: [XCTClockMetric(), XCTCPUMetric(application: app)], options: options) {
            slider.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
                .press(forDuration: 0.02, thenDragTo: slider.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)))
            slider.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5))
                .press(forDuration: 0.02, thenDragTo: slider.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.5)))
            stopMeasuring()
        }
    }

    /// Утечки: десять открытий и закрытий редактора — память после не растёт без конца.
    func testRepeatedOpenCloseMemory() {
        openFeed()
        measure(metrics: [XCTMemoryMetric(application: app)], options: options) {
            for _ in 0..<5 {
                openEditor()
                app.buttons["story.editor.close"].firstMatch.tap()
                XCTAssertTrue(element("story.camera.shutter").waitForExistence(timeout: 10))
                closeStudio()
            }
            stopMeasuring()
        }
    }

    /// Фон и возврат: камера снова отвечает, редактор жив.
    func testBackgroundAndForeground() {
        openFeed()
        openStudio()
        measure(metrics: [XCTClockMetric()], options: options) {
            XCUIDevice.shared.press(.home)
            app.activate()
            XCTAssertTrue(element("story.camera.shutter").waitForExistence(timeout: 10))
            stopMeasuring()
        }
    }
}
