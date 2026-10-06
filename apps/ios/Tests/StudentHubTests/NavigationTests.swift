import XCTest

@testable import StudentHub

final class DeepLinkTests: XCTestCase {
    /// Форма из пуша: своя схема, идентификатор в запросе.
    func testAppSchemeOpensChat() {
        XCTAssertEqual(link("studenthub://chats?c=chat-42"), .chat(id: "chat-42"))
    }

    /// Форма из переписки: человек получил адрес веба и нажал на него на телефоне.
    func testWebLinkOpensSameChat() {
        XCTAssertEqual(link("https://studenthub.kz/chats?c=chat-42"), .chat(id: "chat-42"))
    }

    func testBareSectionsOpenTabs() {
        XCTAssertEqual(link("studenthub://"), .tab(.home))
        XCTAssertEqual(link("https://studenthub.kz/"), .tab(.home))
        XCTAssertEqual(link("https://studenthub.kz/chats"), .tab(.chats))
        XCTAssertEqual(link("https://studenthub.kz/schedule"), .tab(.schedule))
    }

    /// Учёба в вебе — несколько разделов, на телефоне — одна вкладка.
    func testStudyRoutesCollapseIntoOneTab() {
        for path in ["grades", "assignments", "attendance", "courses", "academic"] {
            XCTAssertEqual(link("https://studenthub.kz/\(path)"), .tab(.study), "не сошлось на /\(path)")
        }
    }

    /// Ролевой префикс веба на телефоне ничего не значит: вкладки у всех одни.
    func testRolePrefixIsIgnored() {
        XCTAssertEqual(link("https://studenthub.kz/teacher/schedule"), .tab(.schedule))
        XCTAssertEqual(link("https://studenthub.kz/teacher/chats"), .tab(.chats))
    }

    func testStarostaSectionsAreRecognised() {
        XCTAssertEqual(link("https://studenthub.kz/starosta/classmates"), .section(.classmates))
        XCTAssertEqual(link("https://studenthub.kz/starosta/group-requests"), .section(.groupRequests))
    }

    func testApplicationAndEventCards() {
        XCTAssertEqual(link("studenthub://applications?a=app-1"), .application(id: "app-1"))
        XCTAssertEqual(link("https://studenthub.kz/events/event-1"), .event(id: "event-1"))
        XCTAssertEqual(link("https://studenthub.kz/posts/post-1"), .post(id: "post-1"))
    }

    /// Незнакомый адрес не угадываем: его откроет браузер, где работает полная
    /// версия. Иначе старая сборка «съедала» бы ссылки на разделы, которых не знает.
    func testUnknownRoutesAreNotOurs() {
        let foreign = [
            "https://studenthub.kz/platform-admin/users",
            "https://studenthub.kz/career/vacancies",
            "https://studenthub.kz/qr?t=3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90",
            "mailto:support@studenthub.kz",
        ]
        for raw in foreign {
            XCTAssertNil(link(raw), "перехвачен чужой адрес: \(raw)")
        }
    }

    private func link(_ raw: String) -> DeepLink? {
        guard let url = URL(string: raw) else {
            XCTFail("не разобрался адрес: \(raw)")
            return nil
        }
        return DeepLink(url: url)
    }
}

@MainActor
final class AppRouterTests: XCTestCase {
    /// Под карточкой заявки остаётся список: «назад» из пуша должно вести к
    /// заявкам, а не выбрасывать на главную.
    func testApplicationKeepsListBeneathIt() {
        let router = AppRouter()

        XCTAssertTrue(router.open(.application(id: "app-1"), for: .student))

        XCTAssertEqual(router.selectedTab, .more)
        XCTAssertEqual(router.stack(for: .more), [.section(.applications), .application(id: "app-1")])
    }

    /// У каждой вкладки свой стек: уход в расписание и возврат оставляют открытый
    /// чат на месте.
    func testTabsKeepTheirOwnStacks() {
        let router = AppRouter()
        router.open(.chat(id: "chat-1"), for: .student)

        router.select(.schedule)

        XCTAssertEqual(router.selectedTab, .schedule)
        XCTAssertEqual(router.stack(for: .chats), [.chat(id: "chat-1")])
    }

    func testSelectingTabReturnsItToRoot() {
        let router = AppRouter()
        router.open(.chat(id: "chat-1"), for: .student)

        router.select(.chats)

        XCTAssertEqual(router.stack(for: .chats), [])
    }

    /// Ссылка в чужой раздел не должна открывать пустой экран: у студента нет
    /// обращений группы.
    func testSectionForeignToTheRoleIsRefused() {
        let router = AppRouter()

        XCTAssertFalse(router.open(.section(.groupRequests), for: .student))
        XCTAssertTrue(router.open(.section(.groupRequests), for: .starosta))
    }
}

final class MoreSectionTests: XCTestCase {
    func testStudentSeesCommonSectionsOnly() {
        XCTAssertEqual(MoreSection.sections(for: .student), MoreSection.common)
    }

    func testStarostaAndTeacherAddTheirOwn() {
        XCTAssertTrue(MoreSection.sections(for: .starosta).contains(.classmates))
        XCTAssertTrue(MoreSection.sections(for: .teacher).contains(.subjects))
        XCTAssertFalse(MoreSection.sections(for: .teacher).contains(.classmates))
    }

    /// Роли вне MVP приложение не ведёт — и список для них пуст, а не «как у всех».
    func testRolesOutsideMVPGetNothing() {
        XCTAssertTrue(MoreSection.sections(for: .dean).isEmpty)
        XCTAssertTrue(MoreSection.sections(for: .platformAdmin).isEmpty)
    }
}
