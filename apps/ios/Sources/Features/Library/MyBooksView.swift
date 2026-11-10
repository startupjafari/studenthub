import SwiftUI

/// «Мои книги»: что на руках и до какого срока, брони — готовые и в очереди, история.
///
/// Выдачу, записанную по ошибке, читатель отмечает «Это не я» — решает библиотекарь.
/// Отсюда же — справка «задолженностей нет» (`LibraryClearanceView`).
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
                    if model.books == nil {
                        ErrorStateView(message: failure, isOffline: model.isOffline) { await model.refresh() }
                            .listRowBackground(Color.clear)
                    } else {
                        // Список с прошлого раза остаётся, сверху — что он несвежий и повтор.
                        StaleDataBanner(message: failure, isOffline: model.isOffline) { await model.refresh() }
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets())
                    }
                }

                if let actionFailure = model.actionFailure {
                    FormAlert(message: actionFailure)
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
                    clearanceLink
                } else if model.failure == nil {
                    LoadingStateView().listRowBackground(Color.clear)
                }
            }
        }
        .listStyle(.insetGrouped)
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

    /// Справка для обходного листа — там же, где в вебе: в «Моих книгах».
    private var clearanceLink: some View {
        Section {
            NavigationLink(value: AppRoute.libraryClearance) {
                IconRow(
                    title: String(localized: "library.clearance", defaultValue: "Справка из библиотеки"),
                    symbol: "checkmark.seal.fill",
                    tint: TileTint.green
                )
            }
        } footer: {
            Text(String(
                localized: "library.clearanceSubtitle",
                defaultValue: "Для обходного листа при выпуске или переводе"
            ))
        }
    }

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
                LoanRow(loan: loan, isWorking: model.working == loan.id)
                    .swipeActions {
                        if loan.disputedAt == nil {
                            Button {
                                confirmsDispute = loan
                            } label: {
                                Label(String(localized: "library.dispute", defaultValue: "Это не я"), systemImage: "person.fill.questionmark")
                            }
                            .tint(Palette.warning)
                        }
                    }
                    .contextMenu {
                        if loan.disputedAt == nil {
                            Button {
                                confirmsDispute = loan
                            } label: {
                                Label(String(localized: "library.dispute", defaultValue: "Это не я"), systemImage: "person.fill.questionmark")
                            }
                        }
                    }
            }
            if books.onHands.isEmpty {
                LibraryEmptyRow(
                    text: String(localized: "library.noLoans", defaultValue: "Книг на руках нет"),
                    symbol: "book.closed"
                )
            }
        } header: {
            Text(String(localized: "library.onHands", defaultValue: "На руках"))
        } footer: {
            Text(String(
                localized: "library.onHandsSubtitle",
                defaultValue: "Верните до срока — иначе новые книги и брони будут закрыты"
            ))
        }
    }

    private func reservationsSection(_ books: MyBooks) -> some View {
        Section {
            ForEach(books.reservations) { reservation in
                ReservationRow(reservation: reservation, isWorking: model.working == reservation.id)
                    .swipeActions {
                        Button(role: .destructive) {
                            confirmsCancel = reservation
                        } label: {
                            Label(String(localized: "library.cancel", defaultValue: "Отменить бронь"), systemImage: "xmark")
                        }
                    }
                    .contextMenu {
                        Button(role: .destructive) {
                            confirmsCancel = reservation
                        } label: {
                            Label(String(localized: "library.cancel", defaultValue: "Отменить бронь"), systemImage: "xmark")
                        }
                    }
            }
            if books.reservations.isEmpty {
                LibraryEmptyRow(
                    text: String(localized: "library.noReservations", defaultValue: "Броней нет"),
                    symbol: "bookmark"
                )
            }
        } header: {
            Text(String(localized: "library.reservations", defaultValue: "Брони"))
        } footer: {
            Text(String(
                localized: "library.reservationsSubtitle",
                defaultValue: "Готовые ждут на полке броней, остальные — в очереди"
            ))
        }
    }

    private func historySection(_ books: MyBooks) -> some View {
        Section {
            ForEach(books.history) { loan in
                LoanRow(loan: loan, isWorking: false)
            }
        } header: {
            Text(String(localized: "library.history", defaultValue: "История"))
        }
    }
}

/// Пустая секция: приглушённая строка со значком — не «сырой» текст и не большая
/// заглушка посреди списка, где рядом есть другие секции.
private struct LibraryEmptyRow: View {
    let text: String
    let symbol: String

    var body: some View {
        Label(text, systemImage: symbol)
            .font(Typography.body)
            .foregroundStyle(Palette.mutedForeground)
    }
}

/// Строка книги как строка чата: обложка, название, мета справа, подробности ниже и
/// плашки статуса. Вся строка ведёт на карточку книги; действия — смахиванием.
private struct LibraryBookLine<Badges: View>: View {
    let book: LibraryBookRefDTO
    let detail: String
    var isWorking = false
    @ViewBuilder var badges: () -> Badges

    var body: some View {
        NavigationLink(value: AppRoute.book(id: book.id)) {
            HStack(alignment: .center, spacing: Spacing.lg) {
                BookCoverView(url: book.coverUrl, width: 44)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                        Text(book.title)
                            .font(.body.weight(.semibold))
                            .foregroundStyle(Palette.foreground)
                            .lineLimit(2)
                        Spacer(minLength: 0)
                        if isWorking { ProgressView() }
                    }
                    Text(detail)
                        .font(.subheadline)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(2)
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: Spacing.sm) { badges() }
                        VStack(alignment: .leading, spacing: Spacing.xs) { badges() }
                    }
                    .padding(.top, 2)
                }
            }
            .padding(.vertical, 2)
            .accessibilityElement(children: .combine)
        }
    }
}

/// Выдача: книга, когда взята, срок; «Это не я» — смахиванием у открытой.
private struct LoanRow: View {
    let loan: LoanDTO
    let isWorking: Bool

    var body: some View {
        LibraryBookLine(
            book: loan.book,
            detail: LibraryText.fill(
                String(localized: "library.issuedOn", defaultValue: "Взята {date} · инв. {number}"),
                [
                    "date": loan.issuedAt.formatted(.dateTime.day().month(.abbreviated)),
                    "number": loan.copy.inventoryNumber,
                ]
            ),
            isWorking: isWorking
        ) {
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

/// Бронь: где книга (на полке броней или в очереди); отмена — смахиванием.
private struct ReservationRow: View {
    let reservation: ReservationDTO
    let isWorking: Bool

    var body: some View {
        LibraryBookLine(book: reservation.book, detail: note, isWorking: isWorking) {
            ReservationBadge(reservation: reservation)
        }
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
