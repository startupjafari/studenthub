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
        }
    }

    @MainActor @ViewBuilder
    var destination: some View {
        PendingScreen(title: title, symbol: symbol)
    }

    static var workspace: [WorkspaceGroup] {
        let cases: [LibrarianScreen] = [.issue, .returnBooks, .loans, .reservations, .catalog, .inventory, .reports, .clearances]
        return [
            WorkspaceGroup(
                title: String(localized: "librarian.group", defaultValue: "Библиотека"),
                items: cases.map { WorkspaceItem(title: $0.title, symbol: $0.symbol, tint: TileTint.yellow, route: .librarian($0)) }
            ),
        ]
    }
}
