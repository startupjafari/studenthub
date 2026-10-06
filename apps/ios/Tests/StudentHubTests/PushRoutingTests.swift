import XCTest

@testable import StudentHub

final class PushRoutingTests: XCTestCase {
    /// Сервер кладёт в пуш тот же адрес, что показывает вебу, — относительный путь.
    /// Разбор диплинков у приложения один, и второго под пуши заводить нельзя.
    func testRelativeUrlBecomesDeepLink() {
        let link = PushRouting.link(from: ["url": "/chats?c=chat-7"])

        XCTAssertEqual(link, .chat(id: "chat-7"))
    }

    func testAbsoluteUrlWorksToo() {
        let link = PushRouting.link(from: ["url": "https://studenthub.kz/applications?a=app-3"])

        XCTAssertEqual(link, .application(id: "app-3"))
    }

    /// Пуш без адреса просто открывает приложение: гадать, куда он вёл, нельзя.
    func testPushWithoutUrlLeadsNowhere() {
        XCTAssertNil(PushRouting.link(from: [:]))
        XCTAssertNil(PushRouting.link(from: ["url": ""]))
    }

    /// Тихий пуш — повод сходить за данными, а не показать плашку.
    func testSilentPushIsRecognised() {
        XCTAssertTrue(PushRouting.isSilent(["aps": ["content-available": 1]]))
        XCTAssertFalse(
            PushRouting.isSilent(["aps": ["alert": ["title": "Новое"], "content-available": 1]])
        )
        XCTAssertFalse(PushRouting.isSilent(["aps": ["alert": ["title": "Новое"]]]))
    }
}
