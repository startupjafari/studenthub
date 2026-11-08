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

    /// Уведомления о постах и подписках ведут в ленту и в чужой профиль.
    func testFeedAndProfileLinks() {
        XCTAssertEqual(link("https://studenthub.kz/feed"), .tab(.home))
        XCTAssertEqual(link("studenthub://profile/u-7"), .profile(id: "u-7"))
        XCTAssertEqual(link("https://studenthub.kz/profile"), .section(.profile))
    }

    /// Ролевой префикс веба на телефоне ничего не значит: вкладки у всех одни.
    func testRolePrefixIsIgnored() {
        XCTAssertEqual(link("https://studenthub.kz/teacher/schedule"), .tab(.schedule))
        XCTAssertEqual(link("https://studenthub.kz/teacher/chats"), .tab(.chats))
    }

    func testStarostaSectionsAreRecognised() {
        XCTAssertEqual(link("https://studenthub.kz/starosta/classmates"), .section(.classmates))
        // «Обращений группы» больше нет: заявки одногруппников старосте не видны.
        XCTAssertNil(link("https://studenthub.kz/starosta/group-requests"))
    }

    func testApplicationAndEventCards() {
        XCTAssertEqual(link("studenthub://applications?a=app-1"), .application(id: "app-1"))
        XCTAssertEqual(link("https://studenthub.kz/events/event-1"), .event(id: "event-1"))
        XCTAssertEqual(link("https://studenthub.kz/posts/post-1"), .post(id: "post-1"))
    }

    /// Библиотека читателя: каталог, книга, «Мои книги» (туда ведут её уведомления) и
    /// QR-наклейка экземпляра.
    func testLibraryLinks() {
        XCTAssertEqual(link("https://studenthub.kz/books"), .section(.library))
        XCTAssertEqual(link("https://studenthub.kz/books/book-1"), .book(id: "book-1"))
        XCTAssertEqual(link("studenthub://my-books"), .myBooks)
        XCTAssertEqual(link("https://studenthub.kz/c/AB12CD34"), .bookCopy(code: "AB12CD34"))
        // Фонд библиотекаря — не читательский раздел, его откроет браузер.
        XCTAssertNil(link("https://studenthub.kz/library/catalog/book-1"))
        XCTAssertNil(link("https://studenthub.kz/c"))
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

        XCTAssertEqual(router.selectedTab, .services)
        XCTAssertEqual(router.stack(for: .services), [.section(.applications), .application(id: "app-1")])
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

    /// Под книгой и «Моими книгами» остаётся каталог: «назад» из уведомления
    /// библиотеки ведёт в библиотеку.
    func testLibraryKeepsCatalogBeneath() {
        let router = AppRouter()

        XCTAssertTrue(router.open(.book(id: "book-1"), for: .student))
        XCTAssertEqual(router.selectedTab, .services)
        XCTAssertEqual(router.stack(for: .services), [.section(.library), .book(id: "book-1")])

        XCTAssertTrue(router.open(.myBooks, for: .starosta))
        XCTAssertEqual(router.stack(for: .services), [.section(.library), .myBooks])

        XCTAssertTrue(router.open(.bookCopy(code: "AB12CD34"), for: .student))
        XCTAssertEqual(router.stack(for: .services), [.section(.library), .bookCopy(code: "AB12CD34")])
    }

    /// Библиотека — для читателей: у преподавателя в приложении её нет.
    func testLibraryIsForReadersOnly() {
        let router = AppRouter()

        XCTAssertFalse(router.open(.myBooks, for: .teacher))
        XCTAssertFalse(router.open(.section(.library), for: .teacher))
        XCTAssertTrue(router.open(.section(.library), for: .student))
    }

    /// Ссылка в чужой раздел не должна открывать пустой экран: у студента нет
    /// раздела одногруппников.
    func testSectionForeignToTheRoleIsRefused() {
        let router = AppRouter()

        XCTAssertFalse(router.open(.section(.classmates), for: .student))
        XCTAssertTrue(router.open(.section(.classmates), for: .starosta))
    }

    /// Пуш на холодном старте ждёт роли: с неизвестной ролью библиотека отказала бы.
    func testPostponedLinkOpensOnceRoleIsKnown() {
        let router = AppRouter()

        router.postpone(.myBooks)
        XCTAssertTrue(router.stack(for: .services).isEmpty)

        router.openPending(for: .student)
        XCTAssertEqual(router.selectedTab, .services)
        XCTAssertEqual(router.stack(for: .services), [.section(.library), .myBooks])
    }

    /// Выход: следующий человек начинает с главной и не получает ни открытого чата
    /// прежнего, ни его отложенной ссылки.
    func testResetForgetsStacksAndPendingLink() {
        let router = AppRouter()
        router.open(.chat(id: "chat-1"), for: .student)
        router.postpone(.chat(id: "chat-2"))

        router.reset()
        router.openPending(for: .student)

        XCTAssertEqual(router.selectedTab, .home)
        XCTAssertTrue(router.stack(for: .chats).isEmpty)
    }
}

final class MoreSectionTests: XCTestCase {
    func testStudentSeesCommonSectionsAndDeanery() {
        XCTAssertEqual(MoreSection.sections(for: .student), MoreSection.common + [.deanery])
    }

    /// Запись в деканат сервер принимает только от студента и старосты.
    func testTeacherHasNoDeanery() {
        XCTAssertFalse(MoreSection.sections(for: .teacher).contains(.deanery))
    }

    func testStarostaAndTeacherAddTheirOwn() {
        XCTAssertTrue(MoreSection.sections(for: .starosta).contains(.classmates))
        XCTAssertTrue(MoreSection.sections(for: .teacher).contains(.subjects))
        XCTAssertFalse(MoreSection.sections(for: .teacher).contains(.classmates))
    }

    /// Библиотека — модуль вуза: в списке роли её нет, пункт появляется, когда вуз её
    /// включил.
    func testLibraryIsAModuleOfReaders() {
        XCTAssertEqual(MoreSection.modules(for: .student), [.library])
        XCTAssertEqual(MoreSection.modules(for: .starosta), [.library])
        XCTAssertTrue(MoreSection.modules(for: .teacher).isEmpty)
        XCTAssertFalse(MoreSection.sections(for: .student).contains(.library))
    }

    /// Сотрудникам доступны общие разделы аккаунта, но не учебные: у декана нет
    /// своей записи в деканат и одногруппников.
    func testStaffGetAccountSectionsOnly() {
        let dean = MoreSection.sections(for: .dean)
        XCTAssertTrue(dean.contains(.settings))
        XCTAssertTrue(dean.contains(.documents))
        XCTAssertFalse(dean.contains(.deanery))
        XCTAssertFalse(dean.contains(.classmates))
    }

    /// Роли с запретом по умолчанию не получают документов и событий — только аккаунт
    /// (и карту у охраны), как `RESTRICTED_ROLE_PATHS` в вебе.
    func testRestrictedRolesGetOnlyTheirOwn() {
        XCTAssertFalse(MoreSection.sections(for: .librarian).contains(.documents))
        XCTAssertTrue(MoreSection.sections(for: .securityGuard).contains(.campusMap))
        XCTAssertTrue(MoreSection.sections(for: .unknown).isEmpty)
    }
}

final class RoleTabsTests: XCTestCase {
    /// Учебные роли живут в прежних пяти вкладках.
    func testAcademicRolesKeepFiveTabs() {
        for role in [Role.student, .starosta, .teacher] {
            XCTAssertEqual(AppTab.tabs(for: role), [.home, .schedule, .chats, .study, .services])
        }
    }

    /// У остальных первая вкладка — «Обзор», как стартовая страница роли в вебе.
    func testOtherRolesStartWithDashboard() {
        for role in Role.allCases where !role.isAcademic && role != .unknown {
            XCTAssertEqual(AppTab.tabs(for: role).first, .dashboard, "\(role)")
            XCTAssertTrue(AppTab.tabs(for: role).contains(.workspace), "\(role)")
        }
    }

    /// Без чатов — только охрана и библиотека (`hasChats` в вебе).
    func testRestrictedRolesHaveNoChatsOrFeed() {
        for role in [Role.securityGuard, .librarian] {
            XCTAssertFalse(AppTab.tabs(for: role).contains(.chats))
            XCTAssertFalse(AppTab.tabs(for: role).contains(.home))
        }
        XCTAssertTrue(AppTab.tabs(for: .dean).contains(.chats))
    }

    /// Ссылка на вкладку, которой у роли нет, открывается в ближайшей, что есть.
    func testMissingTabResolvesToExistingOne() {
        XCTAssertEqual(AppTab.resolve(.home, for: .platformAdmin), .dashboard)
        XCTAssertEqual(AppTab.resolve(.services, for: .librarian), .workspace)
        XCTAssertEqual(AppTab.resolve(.chats, for: .student), .chats)
    }

    /// Пост из пуша у администратора платформы открывается не в ленте, которой у него нет.
    func testPostOpensInExistingTabForPlatformAdmin() {
        let router = AppRouter()
        router.adopt(role: .platformAdmin)

        XCTAssertTrue(router.open(.post(id: "p-1"), for: .platformAdmin))
        XCTAssertTrue(AppTab.tabs(for: .platformAdmin).contains(router.selectedTab))
        XCTAssertEqual(router.stack(for: router.selectedTab), [.post(id: "p-1")])
    }

    /// Каталог «Разделов» не пуст ни у одной роли без учебной оболочки.
    @MainActor
    func testEveryWorkspaceRoleHasSections() {
        for role in Role.allCases where AppTab.tabs(for: role).contains(.workspace) {
            XCTAssertFalse(Workspace.groups(for: role).flatMap(\.items).isEmpty, "\(role)")
        }
    }

    func testEveryKnownRoleIsSupported() {
        for role in Role.allCases {
            XCTAssertEqual(role.isSupportedOnPhone, role != .unknown)
        }
    }
}
