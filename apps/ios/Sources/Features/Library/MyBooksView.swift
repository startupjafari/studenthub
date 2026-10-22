import SwiftUI

/// «Мои книги»: что на руках и до какого срока, брони — готовые и в очереди, история.
///
/// Выдачу, записанную по ошибке, читатель отмечает «Это не я» — решает библиотекарь.
/// Уведомления библиотеки (`/my-books`) ведут сюда.
struct MyBooksView: View {
    @State private var model = MyBooksModel()
    @State private var confirmsDispute: LoanDTO?
    @State private var confirmsCancel: ReservationDTO?

    var body: some View {
        List {
            if model.isDisabled {
                LibraryDisabledView()
            } else {
                if let failure = model.failure {
                    FormAlert(message: failure)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }

                if let notice = model.notice {
                    LibraryNotice(message: notice)
                }

                if let books = model.books {
                    if books.overdueCount > 0 {
                        overdueBanner(books.overdueCount)
                    }
                    onHandsSection(books)
                    reservationsSection(books)
                    if !books.history.isEmpty {
                        historySection(books)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "library.tabMine", defaultValue: "Мои книги")))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.refresh() }
        .task { await model.refresh() }
        .confirmationDialog(
            String(localized: "library.disputeTitle", defaultValue: "Вы не брали эту книгу?"),
            isPresented: Binding(get: { confirmsDispute != nil }, set: { if !$0 { confirmsDispute = nil } }),
            titleVisibility: .visible,
            presenting: confirmsDispute
        ) { loan in
            Button(String(localized: "library.dispute", defaultValue: "Это не я")) {
                Task { await model.dispute(loan.id) }
            }
        } message: { loan in
            Text(LibraryText.fill(
                String(
                    localized: "library.disputeDesc",
                    defaultValue: "Библиотекарь получит отметку, что «{title}» записана на вас по ошибке, и разберётся."
                ),
                ["title": loan.book.title]
            ))
        }
        .confirmationDialog(
            String(localized: "library.cancelTitle", defaultValue: "Отменить бронь?"),
            isPresented: Binding(get: { confirmsCancel != nil }, set: { if !$0 { confirmsCancel = nil } }),
            titleVisibility: .visible,
            presenting: confirmsCancel
        ) { reservation in
            Button(String(localized: "library.cancel", defaultValue: "Отменить бронь"), role: .destructive) {
                Task { await model.cancel(reservationID: reservation.id) }
            }
        } message: { reservation in
            Text(LibraryText.fill(
                String(
                    localized: "library.cancelDesc",
                    defaultValue: "Бронь на «{title}» будет отменена, место в очереди не сохранится."
                ),
                ["title": reservation.book.title]
            ))
        }
    }

    // MARK: - Секции

    /// Просрочка закрывает новые выдачи и брони — об этом надо сказать до того, как
    /// человек пойдёт бронировать и получит отказ.
    private func overdueBanner(_ count: Int) -> some View {
        FormAlert(message: LibraryText.fill(
            String(
                localized: "library.overdueBanner",
                defaultValue: "Просроченных книг: {count}. Пока не вернёте, новые книги и брони закрыты."
            ),
            ["count": String(count)]
        ))
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
    }

    private func onHandsSection(_ books: MyBooks) -> some View {
        Section {
            ForEach(books.onHands) { loan in
                LoanRow(loan: loan, isWorking: model.working == loan.id) {
                    confirmsDispute = loan
                }
            }
            if books.onHands.isEmpty {
                Text(String(localized: "library.noLoans", defaultValue: "Книг на руках нет"))
                    .font(Typography.body)
                    .foregroundStyle(Palette.mutedForeground)
            }
        } header: {
            Text(String(localized: "library.onHands", defaultValue: "На руках"))
        } footer: {
            Text(String(
                localized: "library.onHandsSubtitle",
                defaultValue: "Верните до срока — иначе новые книги и брони будут закрыты"
            ))
        }
        .listRowBackground(Palette.card)
    }

    private func reservationsSection(_ books: MyBooks) -> some View {
        Section {
            ForEach(books.reservations) { reservation in
                ReservationRow(reservation: reservation, isWorking: model.working == reservation.id) {
                    confirmsCancel = reservation
                }
            }
            if books.reservations.isEmpty {
                Text(String(localized: "library.noReservations", defaultValue: "Броней нет"))
                    .font(Typography.body)
                    .foregroundStyle(Palette.mutedForeground)
            }
        } header: {
            Text(String(localized: "library.reservations", defaultValue: "Брони"))
        } footer: {
            Text(String(
                localized: "library.reservationsSubtitle",
                defaultValue: "Готовые ждут на полке броней, остальные — в очереди"
            ))
        }
        .listRowBackground(Palette.card)
    }

    private func historySection(_ books: MyBooks) -> some View {
        Section {
            ForEach(books.history) { loan in
                LoanRow(loan: loan, isWorking: false, onDispute: nil)
            }
        } header: {
            Text(String(localized: "library.history", defaultValue: "История"))
        }
        .listRowBackground(Palette.card)
    }
}

/// Выдача: книга, когда взята, срок и «Это не я» у открытой.
private struct LoanRow: View {
    let loan: LoanDTO
    let isWorking: Bool
    let onDispute: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.lg) {
            NavigationLink(value: AppRoute.book(id: loan.book.id)) {
                HStack(alignment: .top, spacing: Spacing.lg) {
                    BookCoverView(url: loan.book.coverUrl)
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(loan.book.title)
                            .font(Typography.cardTitle)
                            .foregroundStyle(Palette.foreground)
                            .lineLimit(2)
                        Text(LibraryText.fill(
                            String(localized: "library.issuedOn", defaultValue: "Взята {date} · инв. {number}"),
                            [
                                "date": loan.issuedAt.formatted(.dateTime.day().month(.abbreviated)),
                                "number": loan.copy.inventoryNumber,
                            ]
                        ))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(1)
                        HStack(spacing: Spacing.sm) {
                            LoanDueBadge(loan: loan)
                            if loan.status == .open, loan.disputedAt != nil {
                                LibraryBadge(
                                    text: String(localized: "library.disputed", defaultValue: "Отмечено: не я"),
                                    tone: .warning
                                )
                            }
                        }
                    }
                }
            }
            // Ссылка — только на книгу; кнопка рядом не должна открывать карточку.
            .buttonStyle(.plain)

            Spacer(minLength: 0)

            if loan.status == .open, loan.disputedAt == nil, let onDispute {
                Button(action: onDispute) {
                    if isWorking {
                        ProgressView()
                    } else {
                        Text(String(localized: "library.dispute", defaultValue: "Это не я"))
                            .font(Typography.meta)
                    }
                }
                .buttonStyle(.borderless)
                .disabled(isWorking)
            }
        }
        .padding(.vertical, Spacing.xs)
    }
}

/// Бронь: где книга (на полке броней или в очереди) и отмена.
private struct ReservationRow: View {
    let reservation: ReservationDTO
    let isWorking: Bool
    let onCancel: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.lg) {
            NavigationLink(value: AppRoute.book(id: reservation.book.id)) {
                HStack(alignment: .top, spacing: Spacing.lg) {
                    BookCoverView(url: reservation.book.coverUrl)
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text(reservation.book.title)
                            .font(Typography.cardTitle)
                            .foregroundStyle(Palette.foreground)
                            .lineLimit(2)
                        Text(note)
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                            .lineLimit(2)
                        ReservationBadge(reservation: reservation)
                    }
                }
            }
            .buttonStyle(.plain)

            Spacer(minLength: 0)

            Button(role: .destructive, action: onCancel) {
                if isWorking {
                    ProgressView()
                } else {
                    Text(String(localized: "library.cancel", defaultValue: "Отменить бронь"))
                        .font(Typography.meta)
                }
            }
            .buttonStyle(.borderless)
            .disabled(isWorking)
        }
        .padding(.vertical, Spacing.xs)
    }

    private var note: String {
        if reservation.status == .ready, let copy = reservation.copy {
            return LibraryText.fill(
                String(localized: "library.readyAt", defaultValue: "Ждёт вас на полке броней · инв. {number}"),
                ["number": copy.inventoryNumber]
            )
        }
        return String(localized: "library.queuedNote", defaultValue: "В очереди на книгу")
    }
}
