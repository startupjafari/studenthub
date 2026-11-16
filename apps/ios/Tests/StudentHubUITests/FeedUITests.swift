import XCTest

/// Лента на mock API: посты, прокрутка, лист комментариев.
final class FeedUITests: MockUITestCase {
    private func post(_ id: String) -> XCUIElement {
        app.descendants(matching: .any)["feed.post.\(id)"].firstMatch
    }

    func testFeedLoadsPosts() throws {
        openTab("Лента")
        XCTAssertTrue(post("post-1").waitForExistence(timeout: timeout), "нет первого поста")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "встреча с выпускниками"))
            .firstMatch.exists, "текст первого поста не виден")
        // Истории над лентой.
        XCTAssertTrue(app.descendants(matching: .any)["stories.ring.u-2"].waitForExistence(timeout: timeout), "нет историй")
    }

    func testScrollReachesLaterPosts() throws {
        openTab("Лента")
        XCTAssertTrue(post("post-1").waitForExistence(timeout: timeout))
        let list = app.scrollViews["feed.list"].exists ? app.scrollViews["feed.list"] : app.scrollViews.firstMatch
        let last = post("post-8")
        for _ in 0..<8 where !(last.exists && last.isHittable) {
            list.swipeUp()
        }
        XCTAssertTrue(last.waitForExistence(timeout: timeout), "прокрутка не дошла до конца ленты")
        // Назад к началу — первый пост снова на экране.
        for _ in 0..<8 where !(post("post-1").exists && post("post-1").isHittable) {
            list.swipeDown()
        }
        XCTAssertTrue(waitForHittable(post("post-1")), "не вернулись к началу ленты")
    }

    func testCommentsSheetOpensAndCloses() throws {
        openTab("Лента")
        let card = post("post-1")
        XCTAssertTrue(card.waitForExistence(timeout: timeout))
        let comments = card.buttons["feed.post.comments"]
        XCTAssertTrue(comments.waitForExistence(timeout: timeout), "нет кнопки комментариев")
        comments.tap()

        let sheetTitle = app.navigationBars["Комментарии"]
        XCTAssertTrue(sheetTitle.waitForExistence(timeout: timeout), "лист комментариев не открылся")
        XCTAssertTrue(app.staticTexts["Отличная новость!"].waitForExistence(timeout: timeout), "комментарии не загрузились")

        // Закрыть жестом вниз — лист уходит, лента под ним цела.
        sheetTitle.swipeDown(velocity: .fast)
        if sheetTitle.exists { app.swipeDown(velocity: .fast) }
        XCTAssertTrue(waitForDisappearance(sheetTitle), "лист комментариев не закрылся")
        XCTAssertTrue(waitForHittable(comments), "лента не вернулась после листа")
    }

    func testStoryViewerOpensAndCloses() throws {
        openTab("Лента")
        let ring = app.descendants(matching: .any)["stories.ring.u-2"].firstMatch
        XCTAssertTrue(ring.waitForExistence(timeout: timeout))
        ring.tap()
        let viewer = app.descendants(matching: .any)["stories.viewer"].firstMatch
        XCTAssertTrue(viewer.waitForExistence(timeout: timeout), "просмотр историй не открылся")
        app.swipeDown(velocity: .fast)
        XCTAssertTrue(waitForDisappearance(viewer), "просмотр историй не закрылся свайпом вниз")
        XCTAssertTrue(waitForHittable(post("post-1")) || app.navigationBars["Лента"].exists, "лента не вернулась")
    }
}
