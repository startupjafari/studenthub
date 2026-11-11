import SwiftUI

/// Библиотекарь: обзор, выдача и возврат, выдачи, брони, каталог, инвентаризация, отчёты, справки об отсутствии задолженности.
///
/// Маршрут — `AppRoute.librarian(_:)`. Перечень случаев — контракт с каталогами
/// других ролей: случаи можно добавлять, но не переименовывать и не удалять.
enum LibrarianScreen: Hashable {
    case home
    case issue
    case returnBooks
    case loans
    case reservations
    case catalog
    case book(id: String)
    case inventory
    case reports
    case clearances
    /// Экземпляр по коду с наклейки (веб `/c/<код>`).
    case copy(code: String)
    /// Общий сканер QR StudentHub (веб `/scan`).
    case scan

    var title: String {
        switch self {
        case .home: return String(localized: "librarian.screen.home", defaultValue: "Библиотека")
        case .issue: return String(localized: "librarian.screen.issue", defaultValue: "Выдача")
        case .returnBooks: return String(localized: "librarian.screen.returnBooks", defaultValue: "Возврат")
        case .loans: return String(localized: "librarian.screen.loans", defaultValue: "Выдачи")
        case .reservations: return String(localized: "librarian.screen.reservations", defaultValue: "Брони")
        case .catalog: return String(localized: "librarian.screen.catalog", defaultValue: "Каталог")
        case .book: return String(localized: "librarian.screen.book", defaultValue: "Книга")
        case .inventory: return String(localized: "librarian.screen.inventory", defaultValue: "Инвентаризация")
        case .reports: return String(localized: "librarian.screen.reports", defaultValue: "Отчёты")
        case .clearances: return String(localized: "librarian.screen.clearances", defaultValue: "Справки")
        case .copy: return String(localized: "librarian.screen.copy", defaultValue: "Экземпляр")
        case .scan: return String(localized: "librarian.screen.scan", defaultValue: "Сканер QR")
        }
    }

    var symbol: String {
        switch self {
        case .home: return "books.vertical"
        case .issue: return "arrow.up.doc"
        case .returnBooks: return "arrow.down.doc"
        case .loans: return "list.bullet.rectangle"
        case .reservations: return "bookmark"
        case .catalog: return "books.vertical"
        case .book: return "book"
        case .inventory: return "checklist"
        case .reports: return "chart.bar"
        case .clearances: return "checkmark.seal"
        case .copy: return "qrcode"
        case .scan: return "qrcode.viewfinder"
        }
    }

    @MainActor @ViewBuilder
    var destination: some View {
        switch self {
        case .home: LibrarianHomeView()
        case .issue: LibrarianIssueView()
        case .returnBooks: LibrarianReturnView()
        case .loans: LibrarianLoansView()
        case .reservations: LibrarianReservationsView()
        case .catalog: LibrarianCatalogView()
        case .book(let id): LibrarianBookView(bookID: id)
        case .inventory: LibrarianInventoryView()
        case .reports: LibrarianReportsView()
        case .clearances: LibrarianClearancesView()
        case .copy(let code): LibrarianCopyView(code: code)
        case .scan: LibrarianScanView()
        }
    }

    static var workspace: [WorkspaceGroup] {
        let desk: [LibrarianScreen] = [.issue, .returnBooks, .scan]
        let fund: [LibrarianScreen] = [.loans, .reservations, .catalog, .inventory, .reports, .clearances]
        return [
            WorkspaceGroup(
                title: String(localized: "librarian.group", defaultValue: "Библиотека"),
                items: desk.map { WorkspaceItem(title: $0.title, symbol: $0.symbol, tint: TileTint.yellow, route: .librarian($0)) }
            ),
            WorkspaceGroup(
                title: String(localized: "librarian.group.fund", defaultValue: "Фонд и учёт"),
                items: fund.map { WorkspaceItem(title: $0.title, symbol: $0.symbol, tint: TileTint.yellow, route: .librarian($0)) }
            ),
        ]
    }
}
