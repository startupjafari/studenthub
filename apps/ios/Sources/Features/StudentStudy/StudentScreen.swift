import SwiftUI

/// Экраны учёбы студента и старосты, которых нет в «Учёбе» по умолчанию: обзор успеваемости, календарь, «мои задачи», экзамены, учебный план, отметка по QR, студенческий билет.
///
/// Маршрут — `AppRoute.student(_:)`. Перечень случаев — контракт с каталогами
/// других ролей: случаи можно добавлять, но не переименовывать и не удалять.
enum StudentScreen: Hashable {
    case academic
    case calendar
    case tasks
    case exams
    case studyPlan
    case checkin
    case studentID

    var title: String {
        switch self {
        case .academic: return String(localized: "student.screen.academic", defaultValue: "Успеваемость")
        case .calendar: return String(localized: "student.screen.calendar", defaultValue: "Календарь")
        case .tasks: return String(localized: "student.screen.tasks", defaultValue: "Мои задачи")
        case .exams: return String(localized: "student.screen.exams", defaultValue: "Экзамены")
        case .studyPlan: return String(localized: "student.screen.studyPlan", defaultValue: "Учебный план")
        case .checkin: return String(localized: "student.screen.checkin", defaultValue: "Отметка по QR")
        case .studentID: return String(localized: "student.screen.studentID", defaultValue: "Студенческий билет")
        }
    }

    var symbol: String {
        switch self {
        case .academic: return "chart.bar.doc.horizontal"
        case .calendar: return "calendar"
        case .tasks: return "checklist"
        case .exams: return "rosette"
        case .studyPlan: return "list.bullet.rectangle"
        case .checkin: return "qrcode.viewfinder"
        case .studentID: return "person.text.rectangle"
        }
    }

    @MainActor @ViewBuilder
    var destination: some View {
        PendingScreen(title: title, symbol: symbol)
    }

    /// Пункты вкладки «Учёба».
    static func studyItems(for role: Role) -> [WorkspaceItem] {
        [
            WorkspaceItem(title: Self.academic.title, symbol: Self.academic.symbol, tint: TileTint.green, route: .student(.academic)),
            WorkspaceItem(title: Self.calendar.title, symbol: Self.calendar.symbol, tint: TileTint.red, route: .student(.calendar)),
            WorkspaceItem(title: Self.tasks.title, symbol: Self.tasks.symbol, tint: TileTint.orange, route: .student(.tasks)),
            WorkspaceItem(title: Self.exams.title, symbol: Self.exams.symbol, tint: TileTint.purple, route: .student(.exams)),
            WorkspaceItem(title: Self.studyPlan.title, symbol: Self.studyPlan.symbol, tint: TileTint.indigo, route: .student(.studyPlan)),
        ]
    }

    /// Пункты вкладки «Сервисы».
    static func serviceItems(for role: Role) -> [WorkspaceItem] {
        [
            WorkspaceItem(title: Self.studentID.title, symbol: Self.studentID.symbol, tint: TileTint.blue, route: .student(.studentID)),
            WorkspaceItem(title: Self.checkin.title, symbol: Self.checkin.symbol, tint: TileTint.green, route: .student(.checkin)),
        ]
    }
}
