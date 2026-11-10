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
    /// Группы вкладки «Разделы». `modules` — включённые вузом модули: пункт выключенного
    /// не показываем вовсе. Группа «Аккаунт» — отдельно (`accountGroup`), она общая.
    @MainActor
    static func groups(for role: Role, modules: Set<MoreSection> = []) -> [WorkspaceGroup] {
        switch role {
        case .student, .starosta, .teacher:
            return academicGroups(for: role, modules: modules)
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
        case .unknown:
            return []
        }
    }

    // MARK: Учебные роли

    /// Каталог студента, старосты и преподавателя: сверху учёба — за ней сюда заходят чаще
    /// всего, — дальше сервисы вуза, сообщество, карьера. Порядок внутри группы задан
    /// здесь, а не ролью: одинаковые разделы у разных ролей стоят на одних местах.
    @MainActor
    private static func academicGroups(for role: Role, modules: Set<MoreSection>) -> [WorkspaceGroup] {
        // Состав — из одного места с разбором диплинков (`MoreSection.sections(for:)`):
        // иначе ссылка открывала бы раздел, которого в списке нет, и наоборот.
        let available = Set(MoreSection.sections(for: role) + MoreSection.modules(for: role).filter(modules.contains))
        func items(_ sections: [MoreSection]) -> [WorkspaceItem] {
            sections.filter(available.contains).map(item)
        }

        var groups: [WorkspaceGroup] = [
            WorkspaceGroup(title: String(localized: "workspace.group.study", defaultValue: "Учёба"), items: studyItems(for: role)),
        ]
        if role == .teacher {
            groups.append(WorkspaceGroup(
                title: String(localized: "study.teacherTools", defaultValue: "Преподавателю"),
                // Обзор преподавателя — его «Главная»: второй вход в каталоге не нужен.
                items: TeacherScreen.studyItems.filter { $0.route != .teacher(.dashboard) }
            ))
        }
        groups += [
            WorkspaceGroup(
                title: String(localized: "services.group.university", defaultValue: "Университет"),
                items: items([.deanery, .consultations, .campusMap])
            ),
            WorkspaceGroup(
                title: String(localized: "services.group.documents", defaultValue: "Документы и заявки"),
                items: items([.applications, .serviceCatalog, .documents, .library])
            ),
            WorkspaceGroup(
                title: String(localized: "services.group.growth", defaultValue: "Личное развитие"),
                items: items([.portfolio])
            ),
            WorkspaceGroup(
                title: String(localized: "services.group.community", defaultValue: "Сообщество"),
                items: items([.events, .classmates])
            ),
        ]
        if role == .starosta {
            groups.append(WorkspaceGroup(
                title: String(localized: "services.group.starosta", defaultValue: "Староста"),
                items: StarostaScreen.serviceItems
            ))
        }
        let more = StudentScreen.serviceItems(for: role) + CommunityScreen.serviceItems(for: role)
        if !more.isEmpty {
            groups.append(WorkspaceGroup(title: String(localized: "services.group.more", defaultValue: "Ещё"), items: more))
        }
        let career = CareerScreen.items(for: role)
        if !career.isEmpty {
            groups.append(WorkspaceGroup(title: String(localized: "services.group.career", defaultValue: "Карьера"), items: career))
        }
        return groups.filter { !$0.items.isEmpty }
    }

    /// Учёба: расписание первым, дальше дисциплины и всё, что к ним относится. Оценки и
    /// посещаемость — свои, студенческие (`/gradebook/me`, `/attendance/me`):
    /// преподавателю они отвечают 403, его журнал — в группе «Преподавателю».
    @MainActor
    private static func studyItems(for role: Role) -> [WorkspaceItem] {
        var result = [
            item(.schedule),
            WorkspaceItem(title: MoreSection.subjects.title, symbol: "book.fill", tint: TileTint.indigo, route: .section(.subjects)),
        ]
        if role == .teacher {
            result.append(item(.groups))
        }
        result += [
            WorkspaceItem(title: MoreSection.assignments.title, symbol: "list.clipboard.fill", tint: TileTint.orange, route: .section(.assignments)),
            WorkspaceItem(title: MoreSection.materials.title, symbol: "folder.fill", tint: TileTint.blue, route: .section(.materials)),
        ]
        if role != .teacher {
            result += [
                WorkspaceItem(title: MoreSection.grades.title, symbol: "graduationcap.fill", tint: TileTint.green, route: .section(.grades)),
                WorkspaceItem(title: MoreSection.attendance.title, symbol: "checkmark.circle.fill", tint: TileTint.teal, route: .section(.attendance)),
            ]
            result += StudentScreen.studyItems(for: role)
        }
        return result
    }

    private static func item(_ section: MoreSection) -> WorkspaceItem {
        WorkspaceItem(title: section.title, symbol: section.symbol, tint: tint(for: section), hint: hint(for: section), route: .section(section))
    }

    private static func tint(for section: MoreSection) -> Color {
        switch section {
        case .schedule: return TileTint.red
        case .deanery: return TileTint.indigo
        case .consultations: return TileTint.teal
        case .campusMap: return TileTint.green
        case .applications, .serviceCatalog: return TileTint.blue
        case .documents: return TileTint.orange
        case .library: return TileTint.yellow
        case .portfolio: return TileTint.purple
        case .events: return TileTint.red
        case .classmates, .groups, .subjects: return TileTint.teal
        case .profile: return TileTint.blue
        default: return TileTint.gray
        }
    }

    /// Подсказка под названием: по ней же ищет поиск — «справка» находит заявки.
    private static func hint(for section: MoreSection) -> String? {
        switch section {
        case .schedule:
            return String(localized: "workspace.schedule.hint", defaultValue: "Пары на день и неделю")
        case .deanery:
            return String(localized: "services.deanery.hint", defaultValue: "Запись на приём")
        case .consultations:
            return String(localized: "services.consultations.hint", defaultValue: "Запись к преподавателю")
        case .campusMap:
            return String(localized: "services.campusMap.hint", defaultValue: "Корпуса, этажи, аудитории")
        case .applications:
            return String(localized: "services.applications.hint", defaultValue: "Справки и обращения")
        case .serviceCatalog:
            return String(localized: "services.catalog.hint", defaultValue: "Все услуги вуза")
        case .documents:
            return String(localized: "services.documents.hint", defaultValue: "Ваши файлы и запросы")
        case .library:
            return String(localized: "services.library.hint", defaultValue: "Каталог и мои книги")
        case .portfolio:
            return String(localized: "services.portfolio.hint", defaultValue: "Опыт, проекты, сертификаты")
        case .events:
            return String(localized: "services.events.hint", defaultValue: "Мероприятия и запись")
        default:
            return nil
        }
    }

    // MARK: Аккаунт

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
        // У учебных ролей документы — в группе «Документы и заявки».
        if !role.isRestricted, !role.isAcademic {
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
