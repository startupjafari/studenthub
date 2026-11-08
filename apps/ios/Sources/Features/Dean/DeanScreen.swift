import SwiftUI

/// Деканат: обзор факультета, группы, студенты, преподаватели, старосты, дисциплины, экзамены, аналитика, запись на приём, расписание факультета.
///
/// Маршрут — `AppRoute.dean(_:)`. Перечень случаев — контракт с каталогами
/// других ролей: случаи можно добавлять, но не переименовывать и не удалять.
enum DeanScreen: Hashable {
    case dashboard
    case groups
    case group(id: String)
    case students
    case student(id: String)
    case teachers
    case starostas
    case courses
    case exams
    case analytics
    case appointments
    case schedule
    /// Редактор расписания с уже выбранной группой — из карточки группы.
    case groupSchedule(id: String)
    /// Ведомость экзамена: допуск, статус, балл.
    case examRoster(id: String)

    var title: String {
        switch self {
        case .dashboard: return String(localized: "dean.screen.dashboard", defaultValue: "Обзор деканата")
        case .groups: return String(localized: "dean.screen.groups", defaultValue: "Группы")
        case .group: return String(localized: "dean.screen.group", defaultValue: "Группа")
        case .students: return String(localized: "dean.screen.students", defaultValue: "Студенты")
        case .student: return String(localized: "dean.screen.student", defaultValue: "Студент")
        case .teachers: return String(localized: "dean.screen.teachers", defaultValue: "Преподаватели")
        case .starostas: return String(localized: "dean.screen.starostas", defaultValue: "Старосты")
        case .courses: return String(localized: "dean.screen.courses", defaultValue: "Дисциплины")
        case .exams: return String(localized: "dean.screen.exams", defaultValue: "Экзамены")
        case .analytics: return String(localized: "dean.screen.analytics", defaultValue: "Аналитика")
        case .appointments: return String(localized: "dean.screen.appointments", defaultValue: "Запись на приём")
        case .schedule: return String(localized: "dean.screen.schedule", defaultValue: "Расписание факультета")
        case .groupSchedule: return String(localized: "dean.screen.groupSchedule", defaultValue: "Расписание группы")
        case .examRoster: return String(localized: "dean.screen.examRoster", defaultValue: "Ведомость")
        }
    }

    var symbol: String {
        switch self {
        case .dashboard: return "rectangle.3.group"
        case .groups: return "person.3"
        case .group: return "person.3"
        case .students: return "graduationcap"
        case .student: return "person"
        case .teachers: return "person.crop.rectangle.stack"
        case .starostas: return "star"
        case .courses: return "book"
        case .exams: return "rosette"
        case .analytics: return "chart.bar"
        case .appointments: return "calendar.badge.clock"
        case .schedule: return "calendar"
        case .groupSchedule: return "calendar"
        case .examRoster: return "list.clipboard"
        }
    }

    @MainActor @ViewBuilder
    var destination: some View {
        switch self {
        case .dashboard: DeanDashboardView()
        case .groups: DeanGroupsView()
        case .group(let id): DeanGroupView(groupID: id)
        case .students: DeanPeopleView(role: .student)
        case .student(let id): DeanStudentView(userID: id)
        case .teachers: DeanPeopleView(role: .teacher)
        case .starostas: DeanPeopleView(role: .starosta)
        case .courses: DeanCoursesView()
        case .exams: DeanExamsView()
        case .examRoster(let id): DeanExamRosterView(examID: id)
        case .analytics: DeanAnalyticsView()
        case .appointments: DeanAppointmentsView()
        case .schedule: DeanScheduleManageView()
        case .groupSchedule(let id): DeanScheduleManageView(initialGroupID: id)
        }
    }

    /// «Разделы» деканата — по группам меню веба (`DEAN_NAV`).
    static var workspace: [WorkspaceGroup] {
        func item(_ screen: DeanScreen, _ tint: Color) -> WorkspaceItem {
            WorkspaceItem(title: screen.title, symbol: screen.symbol, tint: tint, route: .dean(screen))
        }
        return [
            WorkspaceGroup(
                title: String(localized: "workspace.group.people", defaultValue: "Люди"),
                items: [
                    item(.groups, TileTint.teal), item(.students, TileTint.blue), item(.teachers, TileTint.indigo),
                    item(.starostas, TileTint.yellow),
                    WorkspaceItem(title: AdminScreen.invites.title, symbol: AdminScreen.invites.symbol, tint: TileTint.green, route: .admin(.invites)),
                ]
            ),
            WorkspaceGroup(
                title: String(localized: "workspace.group.study", defaultValue: "Учёба"),
                items: [
                    item(.schedule, TileTint.red), item(.courses, TileTint.indigo), item(.exams, TileTint.purple),
                    item(.analytics, TileTint.green),
                    WorkspaceItem(title: StudentScreen.calendar.title, symbol: StudentScreen.calendar.symbol, tint: TileTint.red, route: .student(.calendar)),
                ]
            ),
            WorkspaceGroup(
                title: String(localized: "workspace.group.services", defaultValue: "Сервисы"),
                items: [
                    item(.appointments, TileTint.indigo),
                    WorkspaceItem(title: StaffScreen.applicationsQueue.title, symbol: StaffScreen.applicationsQueue.symbol, tint: TileTint.blue, route: .staff(.applicationsQueue)),
                    WorkspaceItem(title: MoreSection.campusMap.title, symbol: MoreSection.campusMap.symbol, tint: TileTint.green, route: .section(.campusMap)),
                ]
            ),
            WorkspaceGroup(
                title: String(localized: "workspace.group.communication", defaultValue: "Коммуникации"),
                items: [
                    WorkspaceItem(title: StaffScreen.posts.title, symbol: StaffScreen.posts.symbol, tint: TileTint.gray, route: .staff(.posts)),
                    WorkspaceItem(title: StaffScreen.events.title, symbol: StaffScreen.events.symbol, tint: TileTint.red, route: .staff(.events)),
                ]
            ),
            WorkspaceGroup(
                title: String(localized: "services.group.career", defaultValue: "Карьера"),
                items: CareerScreen.items(for: .dean)
            ),
        ]
    }
}
