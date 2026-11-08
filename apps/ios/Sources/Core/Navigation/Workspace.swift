import SwiftUI

/// Пункт каталога разделов: подпись, иконка, куда ведёт.
struct WorkspaceItem: Identifiable {
    let title: String
    let symbol: String
    var tint: Color = TileTint.blue
    var hint: String?
    let route: AppRoute

    var id: String { "\(route)" }
}

/// Группа каталога — как группа бокового меню веба (`group` в `nav.ts`).
struct WorkspaceGroup: Identifiable {
    let title: String
    let items: [WorkspaceItem]

    var id: String { title }
}

/// Состав разделов по ролям. Каждая область описывает свой каталог сама (`DeanScreen.workspace`
/// и т. п.), здесь — только развилка по роли: так меню роли правится в одном файле её
/// области, а оболочка о нём не знает.
enum Workspace {
    /// Вкладка «Разделы» ролей без учебной оболочки.
    @MainActor
    static func groups(for role: Role) -> [WorkspaceGroup] {
        switch role {
        case .dean:
            return DeanScreen.workspace
        case .universityAdmin:
            return UniAdminScreen.workspace
        case .universityModerator, .platformAdmin, .platformModerator:
            return AdminScreen.workspace(for: role)
        case .employer:
            return CareerScreen.employerWorkspace
        case .securityGuard:
            return SecurityScreen.workspace
        case .librarian:
            return LibrarianScreen.workspace
        case .student, .starosta, .teacher, .unknown:
            return []
        }
    }

    /// Дополнительные группы вкладки «Сервисы» учебных ролей: староста, карьера, учёба
    /// студента вне «Учёбы» (студенческий билет, отметка по QR), сообщество.
    @MainActor
    static func serviceExtras(for role: Role) -> [WorkspaceGroup] {
        var groups: [WorkspaceGroup] = []
        if role == .starosta {
            groups.append(WorkspaceGroup(
                title: String(localized: "services.group.starosta", defaultValue: "Староста"),
                items: StarostaScreen.serviceItems
            ))
        }
        let student = StudentScreen.serviceItems(for: role) + CommunityScreen.serviceItems(for: role)
        if !student.isEmpty {
            groups.append(WorkspaceGroup(
                title: String(localized: "services.group.more", defaultValue: "Ещё"),
                items: student
            ))
        }
        let career = CareerScreen.items(for: role)
        if !career.isEmpty {
            groups.append(WorkspaceGroup(
                title: String(localized: "services.group.career", defaultValue: "Карьера"),
                items: career
            ))
        }
        return groups
    }

    /// Дополнительные пункты вкладки «Учёба»: у студента — календарь, задачи, экзамены,
    /// учебный план; у преподавателя — журнал, проверка работ, экзамены, материалы.
    @MainActor
    static func studyExtras(for role: Role) -> [WorkspaceItem] {
        switch role {
        case .teacher:
            return TeacherScreen.studyItems
        case .student, .starosta:
            return StudentScreen.studyItems(for: role)
        default:
            return []
        }
    }

    /// Общая для всех ролей группа «Аккаунт» в конце «Разделов».
    static func accountGroup(for role: Role) -> WorkspaceGroup {
        var items: [WorkspaceItem] = [
            WorkspaceItem(
                title: MoreSection.profile.title, symbol: MoreSection.profile.symbol, tint: TileTint.blue,
                route: .section(.profile)
            ),
            WorkspaceItem(
                title: MoreSection.notifications.title, symbol: MoreSection.notifications.symbol, tint: TileTint.red,
                route: .section(.notifications)
            ),
        ]
        if !role.isRestricted {
            items.append(WorkspaceItem(
                title: MoreSection.documents.title, symbol: MoreSection.documents.symbol, tint: TileTint.orange,
                route: .section(.documents)
            ))
        }
        items.append(WorkspaceItem(
            title: MoreSection.settings.title, symbol: MoreSection.settings.symbol, tint: TileTint.gray,
            route: .section(.settings)
        ))
        return WorkspaceGroup(
            title: String(localized: "services.group.account", defaultValue: "Аккаунт"),
            items: items
        )
    }
}
