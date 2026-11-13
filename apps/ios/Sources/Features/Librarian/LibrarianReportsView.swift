import SwiftUI

/// Отчёты библиотеки (веб `/library/reports`): фонд и выдачи плитками, должники
/// (утерянные книги и самые давние просрочки), популярное за 30, 90 или 365 дней.
struct LibrarianReportsView: View {
    private struct Snapshot {
        let summary: LibrarianSummaryDTO
        let lost: [LibrarianLoanDTO]
        let overdue: [LibrarianLoanDTO]
    }

    @State private var token = 0
    @State private var days = 90
    /// Популярное — своё значение (`RemoteValue`): сбой не прячет сводку и должников.
    @State private var popularRemote = RemoteValue<[LibrarianPopularDTO]>()
    /// За какой период загружен `popular`: при смене периода старый топ не выдаём за новый.
    @State private var popularDays: Int?

    private let api = LibrarianAPI()
    private static let preview = 8

    private var popular: [LibrarianPopularDTO]? { popularRemote.value }
    private var popularFailure: String? { popularRemote.failure }

    var body: some View {
        RemoteContent(reloadToken: token, load: load) { snapshot in
            List {
                summarySection(snapshot.summary)

                Section {
                    let debtors = snapshot.lost + snapshot.overdue
                    if debtors.isEmpty {
                        Text(String(localized: "librarian.reports.noDebtors", defaultValue: "Долгов нет"))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    ForEach(debtors) { loan in
                        TelegramStyleRow(
                            title: loan.reader.name,
                            subtitle: [loan.reader.group, loan.book.title].compactMap { $0 }.joined(separator: "\n")
                        ) {
                            AvatarView(url: nil, name: loan.reader.name, size: 44)
                        } accessory: {
                            LibrarianLoanDueBadge(loan: loan)
                        }
                    }
                    NavigationLink(value: AppRoute.librarian(.loans)) {
                        Text(String(localized: "librarian.allLoans", defaultValue: "Все выдачи")).foregroundStyle(Palette.primary)
                    }
                } header: {
                    Text(String(localized: "librarian.reports.debtors", defaultValue: "Должники"))
                } footer: {
                    Text(String(localized: "librarian.reports.debtorsHint", defaultValue: "Утерянные книги и самые давние просрочки"))
                }

                Section {
                    Picker(String(localized: "librarian.reports.period", defaultValue: "Период"), selection: $days) {
                        ForEach([30, 90, 365], id: \.self) { value in
                            Text(String(localized: "librarian.reports.days", defaultValue: "\(String(value)) дн.")).tag(value)
                        }
                    }
                    .pickerStyle(.segmented)
                    if let popular {
                        if let popularFailure {
                            StaleDataBanner(message: popularFailure, isOffline: popularRemote.isOffline) { await loadPopular() }
                                .listRowBackground(Color.clear)
                                .listRowInsets(EdgeInsets())
                        }
                        if popular.isEmpty {
                            Text(String(localized: "librarian.reports.noPopular", defaultValue: "За этот период выдач не было"))
                                .font(Typography.meta)
                                .foregroundStyle(Palette.mutedForeground)
                        }
                        ForEach(Array(popular.enumerated()), id: \.element.id) { index, item in
                            NavigationLink(value: AppRoute.librarian(.book(id: item.book.id))) {
                                HStack(spacing: Spacing.lg) {
                                    Text(verbatim: "\(index + 1)")
                                        .font(Typography.meta.monospacedDigit())
                                        .foregroundStyle(Palette.mutedForeground)
                                        .frame(width: 22)
                                    BookCoverView(url: item.book.coverUrl, width: 30)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(item.book.title).font(Typography.cardTitle).lineLimit(2)
                                        if !item.book.authors.isEmpty {
                                            Text(item.book.authors).font(Typography.meta).foregroundStyle(Palette.mutedForeground).lineLimit(1)
                                        }
                                    }
                                    Spacer(minLength: Spacing.md)
                                    Text(String(localized: "librarian.reports.loansCount", defaultValue: "выдач: \(item.loans.formatted())"))
                                        .font(Typography.meta)
                                        .foregroundStyle(Palette.mutedForeground)
                                }
                            }
                        }
                    } else if let popularFailure {
                        DashboardFailurePlaceholder(message: popularFailure) { await loadPopular() }
                    } else {
                        ProgressView().frame(maxWidth: .infinity)
                    }
                } header: {
                    Text(String(localized: "librarian.reports.popular", defaultValue: "Популярное"))
                } footer: {
                    Text(String(localized: "librarian.reports.popularHint", defaultValue: "Сколько раз книгу выдавали"))
                }
            }
            .listStyle(.insetGrouped)
            .pullToRefresh {
                token += 1
                await loadPopular()
            }
        }
        .navigationTitle(Text(LibrarianScreen.reports.title))
        // Смена периода и возврат приложения из фона (`AppLifecycle`) — перечитать.
        .task(id: [days, AppLifecycle.shared.foregroundEpoch]) { await loadPopular() }
    }

    private func summarySection(_ s: LibrarianSummaryDTO) -> some View {
        Section {
            StatGrid {
                StatTile(
                    title: String(localized: "librarian.reports.books", defaultValue: "Книг в каталоге"),
                    value: s.books.formatted(),
                    symbol: "books.vertical",
                    caption: String(localized: "librarian.reports.copies", defaultValue: "экземпляров в обороте: \(s.copies.total.formatted())")
                )
                StatTile(
                    title: String(localized: "librarian.metric.onLoan", defaultValue: "На руках"),
                    value: s.loans.open.formatted(),
                    symbol: "list.bullet.rectangle",
                    caption: String(localized: "librarian.metric.onShelf", defaultValue: "\(s.copies.available.formatted()) на полке")
                )
                StatTile(
                    title: String(localized: "librarian.metric.overdue", defaultValue: "Просрочено"),
                    value: s.loans.overdue.formatted(),
                    symbol: "exclamationmark.circle",
                    tint: Palette.destructive,
                    caption: String(localized: "librarian.metric.debtors", defaultValue: "должников: \(s.readers.debtors.formatted())")
                )
                StatTile(
                    title: String(localized: "librarian.reports.reservations", defaultValue: "Брони"),
                    value: (s.reservations.ready + s.reservations.queued).formatted(),
                    symbol: "bookmark",
                    tint: Palette.success,
                    caption: String(
                        localized: "librarian.reports.reservationsHint",
                        defaultValue: "готовых \(s.reservations.ready.formatted()), в очереди \(s.reservations.queued.formatted())"
                    )
                )
                StatTile(
                    title: String(localized: "librarian.metric.issued30", defaultValue: "Выдано за 30 дней"),
                    value: s.loans.issuedLast30.formatted(),
                    symbol: "arrow.up.doc",
                    caption: String(localized: "librarian.metric.returned30", defaultValue: "возвращено \(s.loans.returnedLast30.formatted())")
                )
                StatTile(
                    title: String(localized: "librarian.reports.readers", defaultValue: "Читателей с книгами"),
                    value: s.readers.withLoans.formatted(),
                    symbol: "person.2",
                    caption: String(localized: "librarian.reports.readersHint", defaultValue: "сейчас на руках хотя бы одна книга")
                )
                StatTile(
                    title: String(localized: "librarian.reports.withdrawn", defaultValue: "Выбыло из оборота"),
                    value: (s.copies.lost + s.copies.writtenOff).formatted(),
                    symbol: "archivebox",
                    tint: Palette.mutedForeground,
                    caption: String(
                        localized: "librarian.reports.withdrawnHint",
                        defaultValue: "утеряно \(s.copies.lost.formatted()), списано \(s.copies.writtenOff.formatted())"
                    )
                )
                if let noPhone = s.loans.withoutPhoneLast30 {
                    StatTile(
                        title: String(localized: "librarian.reports.withoutPhone", defaultValue: "Без скана за 30 дней"),
                        value: noPhone.formatted(),
                        symbol: "iphone.slash",
                        tint: Palette.warning,
                        caption: String(localized: "librarian.reports.withoutPhoneHint", defaultValue: "по номеру билета, с отметкой")
                    )
                }
            }
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets())
    }

    private func load() async throws -> Snapshot {
        async let summary = api.summary()
        async let lost = api.loans(PageRequest(cursor: nil, page: 1, limit: Self.preview), filter: "lost")
        async let overdue = api.loans(PageRequest(cursor: nil, page: 1, limit: Self.preview), filter: "overdue")
        return try await Snapshot(summary: summary, lost: lost.items, overdue: overdue.items)
    }

    private func loadPopular() async {
        let days = self.days
        // Новый период — пока ответа нет, крутилка, а не топ прошлого периода.
        if popularDays != days {
            popularRemote.reset()
            popularDays = days
        }
        await popularRemote.load { try await api.popular(days: days) }
    }
}
