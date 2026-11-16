import SwiftUI

/// Главная библиотекаря (веб `/library`): сводка, быстрые действия стойки, просрочки и
/// полка броней. Выключенная библиотека — пояснение вместо экрана стойки.
struct LibrarianHomeView: View {
    private struct Snapshot {
        let enabled: Bool
        let summary: LibrarianSummaryDTO?
        let overdue: [LibrarianLoanDTO]
        let ready: [LibrarianReservationDTO]
    }

    @State private var token = 0
    private let api = LibrarianAPI()
    private static let panelLimit = 6

    var body: some View {
        RemoteContent(reloadToken: token, load: load) { snapshot in
            List {
                if snapshot.enabled {
                    if let s = snapshot.summary {
                        DashboardMetricsSection(metrics: [
                            DashboardMetric(
                                title: String(localized: "librarian.metric.onLoan", defaultValue: "На руках"),
                                value: s.loans.open.formatted(),
                                symbol: "list.bullet.rectangle",
                                tint: TileTint.blue,
                                caption: String(localized: "librarian.metric.onShelf", defaultValue: "\(s.copies.available.formatted()) на полке"),
                                route: .librarian(.loans)
                            ),
                            DashboardMetric(
                                title: String(localized: "librarian.metric.overdue", defaultValue: "Просрочено"),
                                value: s.loans.overdue.formatted(),
                                symbol: "exclamationmark.circle",
                                tint: Palette.destructive,
                                caption: String(localized: "librarian.metric.debtors", defaultValue: "должников: \(s.readers.debtors.formatted())"),
                                route: .librarian(.loans)
                            ),
                            DashboardMetric(
                                title: String(localized: "librarian.metric.ready", defaultValue: "Ждут на полке броней"),
                                value: s.reservations.ready.formatted(),
                                symbol: "bookmark",
                                tint: Palette.success,
                                caption: String(localized: "librarian.metric.queued", defaultValue: "\(s.reservations.queued.formatted()) в очереди"),
                                route: .librarian(.reservations)
                            ),
                            DashboardMetric(
                                title: String(localized: "librarian.metric.issued30", defaultValue: "Выдано за 30 дней"),
                                value: s.loans.issuedLast30.formatted(),
                                symbol: "arrow.up.doc",
                                tint: TileTint.indigo,
                                caption: String(localized: "librarian.metric.returned30", defaultValue: "возвращено \(s.loans.returnedLast30.formatted())"),
                                route: .librarian(.reports)
                            ),
                        ])
                    }

                    Section {
                        action(.issue, String(localized: "librarian.home.issue", defaultValue: "Выдать книгу"), String(localized: "librarian.home.issueHint", defaultValue: "Студенческий читателя и наклейка книги"), TileTint.blue)
                        action(.returnBooks, String(localized: "librarian.home.return", defaultValue: "Принять книгу"), String(localized: "librarian.home.returnHint", defaultValue: "Скан наклейки и состояние книги"), TileTint.green)
                        action(.inventory, String(localized: "librarian.home.inventory", defaultValue: "Инвентаризация"), String(localized: "librarian.home.inventoryHint", defaultValue: "Скан наклеек вдоль полок"), TileTint.orange)
                        action(.scan, String(localized: "librarian.home.scan", defaultValue: "Сканер QR"), String(localized: "librarian.home.scanHint", defaultValue: "Подтвердить вход на компьютере, открыть наклейку"), TileTint.purple)
                    }

                    Section {
                        if snapshot.overdue.isEmpty {
                            DashboardEmptyRow(text: String(localized: "librarian.noOverdue", defaultValue: "Просрочек нет"), tint: Palette.success)
                        }
                        ForEach(snapshot.overdue) { loan in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(loan.reader.name).font(Typography.body).lineLimit(2)
                                    Text([loan.reader.group, loan.book.title].compactMap { $0 }.joined(separator: " · "))
                                        .font(.footnote)
                                        .foregroundStyle(Palette.mutedForeground)
                                        .lineLimit(2)
                                }
                                Spacer(minLength: Spacing.md)
                                LibrarianLoanDueBadge(loan: loan)
                            }
                        }
                        NavigationLink(value: AppRoute.librarian(.loans)) {
                            DashboardMoreLabel(title: String(localized: "librarian.allLoans", defaultValue: "Все выдачи"))
                        }
                    } header: {
                        DashboardSectionHeader(
                            title: String(localized: "librarian.overdueTitle", defaultValue: "Просрочено"),
                            subtitle: String(localized: "librarian.overdueHint", defaultValue: "Самые давние — сверху")
                        )
                    }

                    Section {
                        if snapshot.ready.isEmpty {
                            DashboardEmptyRow(text: String(localized: "librarian.noHolds", defaultValue: "На полке броней пусто"), symbol: "bookmark")
                        }
                        ForEach(snapshot.ready) { reservation in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(reservation.book.title).font(Typography.body).lineLimit(2)
                                    Text([reservation.reader.name, reservation.copy.map { LibrarianText.inventoryShort($0.inventoryNumber) }]
                                        .compactMap { $0 }
                                        .joined(separator: " · "))
                                        .font(.footnote)
                                        .foregroundStyle(Palette.mutedForeground)
                                }
                                Spacer(minLength: Spacing.md)
                                LibrarianReservationBadge(reservation: reservation)
                            }
                        }
                        NavigationLink(value: AppRoute.librarian(.reservations)) {
                            DashboardMoreLabel(title: String(localized: "librarian.allReservations", defaultValue: "Все брони"))
                        }
                    } header: {
                        DashboardSectionHeader(
                            title: String(localized: "librarian.holdShelfTitle", defaultValue: "Полка броней"),
                            subtitle: String(localized: "librarian.holdShelfHint", defaultValue: "Отложенные книги и до какого дня держатся")
                        )
                    }
                }
            }
            .dashboardListStyle()
            .screenState(!snapshot.enabled) {
                EmptyStateView(
                    title: String(localized: "librarian.disabledTitle", defaultValue: "Библиотека выключена"),
                    symbol: "books.vertical",
                    hint: String(localized: "librarian.disabledHint", defaultValue: "Её включает администратор вуза в разделе «Библиотека». Пока модуль выключен, выдача и брони недоступны.")
                )
            }
            .pullToRefresh { token += 1 }
        }
        .background(Palette.background)
        .navigationTitle(Text(LibrarianScreen.home.title))
    }

    private func action(_ screen: LibrarianScreen, _ title: String, _ hint: String, _ tint: Color) -> some View {
        NavigationLink(value: AppRoute.librarian(screen)) {
            DashboardRow(title: title, subtitle: hint, symbol: screen.symbol, tint: tint)
        }
    }

    private func load() async throws -> Snapshot {
        let settings = try await api.settings()
        guard settings.enabled else { return Snapshot(enabled: false, summary: nil, overdue: [], ready: []) }
        async let summary = api.summary()
        async let overdue = api.loans(PageRequest(cursor: nil, page: 1, limit: Self.panelLimit), filter: "overdue")
        async let ready = api.reservations(PageRequest(cursor: nil, page: 1, limit: Self.panelLimit), filter: "ready")
        return try await Snapshot(enabled: true, summary: summary, overdue: overdue.items, ready: ready.items)
    }
}
