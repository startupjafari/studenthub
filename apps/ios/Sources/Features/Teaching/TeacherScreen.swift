import SwiftUI

/// Инструменты преподавателя: обзор, журнал оценок, проверка работ, посещаемость, экзамены, материалы, правка расписания, свои публикации.
///
/// Маршрут — `AppRoute.teacher(_:)`. Перечень случаев — контракт с каталогами
/// других ролей: случаи можно добавлять, но не переименовывать и не удалять.
enum TeacherScreen: Hashable {
    case dashboard
    case gradebook
    case gradebookCourse(id: String)
    case reviews
    case assignmentSubmissions(assignmentID: String)
    case attendanceJournal
    case exams
    case exam(id: String)
    case materials
    case scheduleChanges
    case myPosts

    var title: String {
        switch self {
        case .dashboard: return String(localized: "teaching.screen.dashboard", defaultValue: "Обзор преподавателя")
        case .gradebook: return String(localized: "teaching.screen.gradebook", defaultValue: "Журнал оценок")
        case .gradebookCourse: return String(localized: "teaching.screen.gradebookCourse", defaultValue: "Журнал дисциплины")
        case .reviews: return String(localized: "teaching.screen.reviews", defaultValue: "Проверка работ")
        case .assignmentSubmissions: return String(localized: "teaching.screen.assignmentSubmissions", defaultValue: "Сданные работы")
        case .attendanceJournal: return String(localized: "teaching.screen.attendanceJournal", defaultValue: "Журнал посещаемости")
        case .exams: return String(localized: "teaching.screen.exams", defaultValue: "Экзамены")
        case .exam: return String(localized: "teaching.screen.exam", defaultValue: "Экзамен")
        case .materials: return String(localized: "teaching.screen.materials", defaultValue: "Материалы")
        case .scheduleChanges: return String(localized: "teaching.screen.scheduleChanges", defaultValue: "Изменения расписания")
        case .myPosts: return String(localized: "teaching.screen.myPosts", defaultValue: "Мои публикации")
        }
    }

    var symbol: String {
        switch self {
        case .dashboard: return "rectangle.3.group"
        case .gradebook: return "tablecells"
        case .gradebookCourse: return "tablecells"
        case .reviews: return "checkmark.seal"
        case .assignmentSubmissions: return "tray.full"
        case .attendanceJournal: return "checklist.checked"
        case .exams: return "rosette"
        case .exam: return "rosette"
        case .materials: return "folder"
        case .scheduleChanges: return "calendar.badge.exclamationmark"
        case .myPosts: return "newspaper"
        }
    }

    @MainActor @ViewBuilder
    var destination: some View {
        PendingScreen(title: title, symbol: symbol)
    }

    /// Пункты вкладки «Учёба» преподавателя.
    static var studyItems: [WorkspaceItem] {
        [
            WorkspaceItem(title: Self.dashboard.title, symbol: Self.dashboard.symbol, tint: TileTint.blue, route: .teacher(.dashboard)),
            WorkspaceItem(title: Self.gradebook.title, symbol: Self.gradebook.symbol, tint: TileTint.green, route: .teacher(.gradebook)),
            WorkspaceItem(title: Self.reviews.title, symbol: Self.reviews.symbol, tint: TileTint.orange, route: .teacher(.reviews)),
            WorkspaceItem(title: Self.attendanceJournal.title, symbol: Self.attendanceJournal.symbol, tint: TileTint.teal, route: .teacher(.attendanceJournal)),
            WorkspaceItem(title: Self.exams.title, symbol: Self.exams.symbol, tint: TileTint.purple, route: .teacher(.exams)),
            WorkspaceItem(title: Self.materials.title, symbol: Self.materials.symbol, tint: TileTint.indigo, route: .teacher(.materials)),
            WorkspaceItem(title: Self.scheduleChanges.title, symbol: Self.scheduleChanges.symbol, tint: TileTint.red, route: .teacher(.scheduleChanges)),
            WorkspaceItem(title: Self.myPosts.title, symbol: Self.myPosts.symbol, tint: TileTint.gray, route: .teacher(.myPosts)),
            WorkspaceItem(title: StudentScreen.calendar.title, symbol: StudentScreen.calendar.symbol, tint: TileTint.red, route: .student(.calendar)),
        ]
    }
}
