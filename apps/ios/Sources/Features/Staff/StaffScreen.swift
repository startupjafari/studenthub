import SwiftUI

/// Общие разделы сотрудников вуза: очередь заявок, каталог услуг, типы и шаблоны документов, журнал документов, библиотека (настройки, каталог, отчёты, журнал), публикации, события, журналы охраны.
///
/// Маршрут — `AppRoute.staff(_:)`. Перечень случаев — контракт с каталогами
/// других ролей: случаи можно добавлять, но не переименовывать и не удалять.
enum StaffScreen: Hashable {
    case applicationsQueue
    case application(id: String)
    case serviceCatalog
    case documentTypes
    case documentTemplates
    case documentTemplate(id: String)
    case documentJournal
    case librarySettings
    case libraryCatalog
    case libraryReports
    case libraryJournal
    case posts
    case events
    case event(id: String)
    case securityJournals

    var title: String {
        switch self {
        case .applicationsQueue: return String(localized: "staff.screen.applicationsQueue", defaultValue: "Заявки")
        case .application: return String(localized: "staff.screen.application", defaultValue: "Заявка")
        case .serviceCatalog: return String(localized: "staff.screen.serviceCatalog", defaultValue: "Каталог услуг")
        case .documentTypes: return String(localized: "staff.screen.documentTypes", defaultValue: "Типы документов")
        case .documentTemplates: return String(localized: "staff.screen.documentTemplates", defaultValue: "Шаблоны документов")
        case .documentTemplate: return String(localized: "staff.screen.documentTemplate", defaultValue: "Шаблон документа")
        case .documentJournal: return String(localized: "staff.screen.documentJournal", defaultValue: "Журнал документов")
        case .librarySettings: return String(localized: "staff.screen.librarySettings", defaultValue: "Настройки библиотеки")
        case .libraryCatalog: return String(localized: "staff.screen.libraryCatalog", defaultValue: "Каталог библиотеки")
        case .libraryReports: return String(localized: "staff.screen.libraryReports", defaultValue: "Отчёты библиотеки")
        case .libraryJournal: return String(localized: "staff.screen.libraryJournal", defaultValue: "Журнал библиотеки")
        case .posts: return String(localized: "staff.screen.posts", defaultValue: "Публикации")
        case .events: return String(localized: "staff.screen.events", defaultValue: "События")
        case .event: return String(localized: "staff.screen.event", defaultValue: "Событие")
        case .securityJournals: return String(localized: "staff.screen.securityJournals", defaultValue: "Журналы охраны")
        }
    }

    var symbol: String {
        switch self {
        case .applicationsQueue: return "tray.full"
        case .application: return "doc.text"
        case .serviceCatalog: return "square.grid.2x2"
        case .documentTypes: return "doc.on.doc"
        case .documentTemplates: return "doc.badge.gearshape"
        case .documentTemplate: return "doc.badge.gearshape"
        case .documentJournal: return "book.closed"
        case .librarySettings: return "gearshape"
        case .libraryCatalog: return "books.vertical"
        case .libraryReports: return "chart.bar"
        case .libraryJournal: return "list.bullet.rectangle"
        case .posts: return "newspaper"
        case .events: return "calendar.badge.clock"
        case .event: return "calendar.badge.clock"
        case .securityJournals: return "shield.lefthalf.filled"
        }
    }

    @MainActor @ViewBuilder
    var destination: some View {
        PendingScreen(title: title, symbol: symbol)
    }
}
