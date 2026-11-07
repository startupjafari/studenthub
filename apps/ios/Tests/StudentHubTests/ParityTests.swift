import XCTest

@testable import StudentHub

/// Средний результат обязан совпадать с вебом (`academic-view.tsx`): среднее долей по
/// точкам дисциплины, затем взвешенное кредитами.
final class AcademicSummaryTests: XCTestCase {
    func testCoursePercentAveragesColumnShares() {
        // 8/10 и 45/90: среднее долей — 65 %, а не сумма 53/100.
        let percent = AcademicSummary.coursePercent(course(credits: 5, [(10, 8), (90, 45)]))
        XCTAssertEqual(percent, 65)
    }

    func testAverageIsWeightedByCredits() {
        let strong = course(id: "a", credits: 3, [(10, 10)])
        let weak = course(id: "b", credits: 1, [(10, 6)])
        // (100·3 + 60·1) / 4 = 90.
        XCTAssertEqual(AcademicSummary.averagePercent([strong, weak]), 90)
    }

    func testCourseWithoutCreditsWeighsOne() {
        let a = course(id: "a", credits: nil, [(10, 10)])
        let b = course(id: "b", credits: nil, [(10, 5)])
        XCTAssertEqual(AcademicSummary.averagePercent([a, b]), 75)
    }

    func testNoGradesMeansNoAverage() {
        XCTAssertNil(AcademicSummary.averagePercent([course(credits: 5, [])]))
    }

    func testUpcomingSkipsSubmittedAndSortsByDue() {
        let later = assignment("later", due: Date(timeIntervalSinceNow: 7200))
        let sooner = assignment("sooner", due: Date(timeIntervalSinceNow: 3600))
        let noDue = assignment("none", due: nil)
        let done = assignment("done", due: Date(timeIntervalSinceNow: 60), submitted: true)
        XCTAssertEqual(AcademicSummary.upcoming([later, noDue, done, sooner]).map(\.id), ["sooner", "later"])
    }

    private func course(id: String = "c", credits: Int?, _ columns: [(Int, Double)]) -> CourseGradesDTO {
        CourseGradesDTO(
            courseId: id,
            subject: CourseGradesDTO.Subject(id: "s-\(id)", name: "Предмет"),
            credits: credits,
            columns: columns.enumerated().map { index, pair in
                CourseGradesDTO.Column(id: "\(index)", title: "Точка", kind: "TASK", maxScore: pair.0, score: pair.1)
            }
        )
    }

    private func assignment(_ id: String, due: Date?, submitted: Bool = false) -> AssignmentDTO {
        AssignmentDTO(
            id: id, title: id, description: nil, dueAt: due, maxScore: 10, subject: "Предмет",
            mySubmission: submitted
                ? AssignmentDTO.Submission(id: "s", status: "SUBMITTED", score: nil, feedback: nil, text: nil, linkUrl: nil, submittedAt: Date())
                : nil
        )
    }
}

/// План этажа: проёмы режут стены, контур помещения собирается из его стен.
final class FloorGeometryTests: XCTestCase {
    private let square = """
    {
      "nodes": {"a": {"x": 0, "y": 0}, "b": {"x": 4000, "y": 0}, "c": {"x": 4000, "y": 3000}, "d": {"x": 0, "y": 3000}},
      "walls": {
        "w1": {"a": "a", "b": "b", "thicknessMm": 200, "kind": "wall"},
        "w2": {"a": "c", "b": "b", "thicknessMm": 200, "kind": "wall"},
        "w3": {"a": "c", "b": "d", "thicknessMm": 200, "kind": "glass"},
        "w4": {"a": "d", "b": "a", "thicknessMm": 200, "kind": "virtual"}
      },
      "openings": {"o1": {"type": "door", "wallId": "w1", "offsetMm": 1000, "widthMm": 900, "heightMm": 2100, "swing": "left_in", "access": "public"}},
      "spaces": {"s1": {"label": {"x": 2000, "y": 1500}, "edges": ["w1", "w2", "w3", "w4"], "number": "101", "kind": "auditorium", "visibility": "public"}},
      "verticals": {},
      "labels": {}
    }
    """

    func testDoorSplitsWallAndVirtualWallIsSkipped() throws {
        let geometry = FloorGeometry(try plan())
        // w1 — два куска вокруг двери, w2 и стеклянная w3 — по одному, виртуальной нет.
        XCTAssertEqual(geometry.segments.count, 4)
        let pieces = geometry.segments.filter { $0.a.y == 0 && $0.b.y == 0 }.map { ($0.a.x, $0.b.x) }.sorted { $0.0 < $1.0 }
        XCTAssertEqual(pieces.map(\.0), [0, 1900])
        XCTAssertEqual(pieces.map(\.1), [1000, 4000])
        XCTAssertEqual(geometry.segments.filter(\.isGlass).count, 1)
    }

    /// Стены идут в разном направлении (`w2` от c к b) — сцепка всё равно замыкается.
    func testOutlineChainsWallsRegardlessOfDirection() throws {
        let geometry = FloorGeometry(try plan())
        let outline = try XCTUnwrap(geometry.rooms.first?.outline)
        XCTAssertEqual(outline.count, 4)
        XCTAssertEqual(Set(outline.map { "\(Int($0.x)),\(Int($0.y))" }), ["0,0", "4000,0", "4000,3000", "0,3000"])
        XCTAssertEqual(geometry.bounds, CGRect(x: 0, y: 0, width: 4000, height: 3000))
    }

    func testBrokenOutlineIsEmptyInsteadOfWrong() throws {
        let doc = try plan()
        XCTAssertTrue(FloorGeometry.outline(["w1", "w3"], plan: doc).isEmpty)
    }

    private func plan() throws -> FloorPlanDTO {
        try JSONCoding.decoder.decode(FloorPlanDTO.self, from: Data(square.utf8))
    }
}

/// Тело PATCH профиля: поля чужой роли не уходят — схема строгая и ответила бы `400`.
final class ProfileFormTests: XCTestCase {
    func testStudentSendsSkillsButNotTeacherFields() {
        var form = ProfileForm()
        form.firstName = " Аян "
        form.lastName = "Серик"
        form.telegram = "@ayan"
        form.skills = ["Swift"]
        form.officeRoom = "305"
        let update = form.update(role: .student)
        XCTAssertEqual(update.firstName, "Аян")
        XCTAssertEqual(update.telegram, "ayan")
        XCTAssertEqual(update.skills, ["Swift"])
        XCTAssertNil(update.officeRoom)
    }

    func testTeacherSendsOfficeButNotStudentFields() {
        var form = ProfileForm()
        form.officeRoom = "305"
        form.instagram = "teacher"
        form.skills = ["Swift"]
        let update = form.update(role: .teacher)
        XCTAssertEqual(update.officeRoom, "305")
        XCTAssertNil(update.instagram)
        XCTAssertNil(update.skills)
    }

    /// Пустая строка очищает поле на сервере — её отправляем, а не выкидываем.
    func testEmptyFieldIsSentToClear() {
        XCTAssertEqual(ProfileForm().update(role: .student).headline, "")
    }

    func testWebsiteNeedsScheme() {
        var form = ProfileForm()
        form.website = "example.kz"
        XCTAssertFalse(form.websiteIsValid)
        form.website = "https://example.kz"
        XCTAssertTrue(form.websiteIsValid)
    }
}

final class ServicesCatalogTests: XCTestCase {
    /// Раздел роли, не попавший ни в одну группу каталога, просто исчез бы из
    /// «Сервисов» — и до него нельзя было бы дойти иначе как по ссылке.
    func testEveryRoleSectionHasAGroup() {
        let grouped = Set(ServiceGroup.allCases.flatMap(\.order))
        for role in [Role.student, .starosta, .teacher] {
            for section in MoreSection.sections(for: role) + MoreSection.modules(for: role) {
                XCTAssertTrue(grouped.contains(section), "\(section) у \(role) вне групп")
            }
        }
    }

    func testFeedScopeQuery() {
        XCTAssertEqual(FeedScope.author(id: "u-1").query, [URLQueryItem(name: "authorId", value: "u-1")])
        XCTAssertEqual(FeedScope.saved.query, [URLQueryItem(name: "filter", value: "SAVED")])
        XCTAssertTrue(FeedScope.all.query.isEmpty)
    }
}

final class ServiceDeepLinkTests: XCTestCase {
    @MainActor
    func testWebPathsOpenServiceSections() {
        XCTAssertEqual(DeepLink(url: URL(string: "https://studenthub.kz/appointments")!), .section(.deanery))
        XCTAssertEqual(DeepLink(url: URL(string: "https://studenthub.kz/campus")!), .section(.campusMap))

        let router = AppRouter()
        XCTAssertTrue(router.open(URL(string: "studenthub://portfolio")!, for: .student))
        XCTAssertEqual(router.selectedTab, .services)
        XCTAssertEqual(router.stack(for: .services), [.section(.portfolio)])
    }

    /// Деканат — только студенту и старосте: преподавателю ссылку откроет браузер.
    @MainActor
    func testTeacherCannotOpenDeanery() {
        XCTAssertFalse(AppRouter().open(URL(string: "https://studenthub.kz/appointments")!, for: .teacher))
    }
}
