import SwiftUI

/// Книга глазами читателя: описание, наличие и бронь.
///
/// Своя бронь или книга на руках видны здесь же — второй раз забронировать то, что
/// уже ждёт на полке, не предлагаем.
struct LibraryBookView: View {
    let bookID: String

    @State private var model: LibraryBookModel?
    @State private var confirmsCancel: String?

    var body: some View {
        List {
            if let unavailable = model?.unavailable {
                EmptyRow(text: unavailable)
            }

            if let failure = model?.failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            if let notice = model?.notice {
                LibraryNotice(message: notice)
            }

            if let model, let book = model.book, let state = model.state {
                Section {
                    HStack(alignment: .top, spacing: Spacing.xl) {
                        BookCoverView(url: book.coverUrl, width: 96)
                        VStack(alignment: .leading, spacing: Spacing.sm) {
                            Text(book.title)
                                .font(Typography.sectionTitle)
                                .foregroundStyle(Palette.foreground)
                            if !book.authors.isEmpty {
                                Text(book.authors)
                                    .font(Typography.meta)
                                    .foregroundStyle(Palette.mutedForeground)
                            }
                            ShelfBadge(availability: book.availability, inCard: true)
                            if let loan = state.loan {
                                LoanDueBadge(loan: loan)
                            }
                            if let reservation = state.reservation {
                                ReservationBadge(reservation: reservation)
                            }
                        }
                    }
                    .padding(.vertical, Spacing.xs)

                    ForEach(facts(of: book), id: \.label) { fact in
                        LabeledContent(fact.label) {
                            Text(fact.value)
                                .foregroundStyle(Palette.foreground)
                        }
                        .font(Typography.body)
                    }
                }
                .listRowBackground(Palette.card)

                Section {
                    actionButton(state.action, model: model)
                } footer: {
                    if let hint = state.hint {
                        Text(hint)
                    }
                }
                .listRowBackground(Palette.card)

                if let description = book.description, !description.isEmpty {
                    Section {
                        Text(description)
                            .font(Typography.body)
                            .foregroundStyle(Palette.foreground)
                    } header: {
                        Text(String(localized: "library.fieldDescription", defaultValue: "Описание"))
                    }
                    .listRowBackground(Palette.card)
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "library.book", defaultValue: "Книга")))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model?.load() }
        .task {
            if model == nil { model = LibraryBookModel(bookID: bookID) }
            await model?.load()
        }
        .confirmationDialog(
            String(localized: "library.cancelTitle", defaultValue: "Отменить бронь?"),
            isPresented: Binding(get: { confirmsCancel != nil }, set: { if !$0 { confirmsCancel = nil } }),
            titleVisibility: .visible,
            presenting: confirmsCancel
        ) { reservationID in
            Button(String(localized: "library.cancel", defaultValue: "Отменить бронь"), role: .destructive) {
                Task { await model?.cancel(reservationID: reservationID) }
            }
        } message: { _ in
            Text(LibraryText.fill(
                String(
                    localized: "library.cancelDesc",
                    defaultValue: "Бронь на «{title}» будет отменена, место в очереди не сохранится."
                ),
                ["title": model?.book?.title ?? ""]
            ))
        }
    }

    @ViewBuilder
    private func actionButton(_ action: BookAction, model: LibraryBookModel) -> some View {
        switch action {
        case .reserve, .joinQueue:
            Button {
                Task { await model.reserve() }
            } label: {
                Text(action == .reserve
                    ? String(localized: "library.reserve", defaultValue: "Забронировать")
                    : String(localized: "library.joinQueue", defaultValue: "Встать в очередь"))
            }
            .buttonStyle(PrimaryButtonStyle(isLoading: model.isWorking))
            .disabled(model.isWorking)
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
        case .cancel(let reservationID):
            Button(role: .destructive) {
                confirmsCancel = reservationID
            } label: {
                HStack {
                    Text(String(localized: "library.cancel", defaultValue: "Отменить бронь"))
                    Spacer()
                    if model.isWorking { ProgressView() }
                }
            }
            .disabled(model.isWorking)
        case .none:
            // На руках или экземпляров нет — действия нет, объяснение в подписи.
            EmptyView()
        }
    }

    private struct Fact {
        let label: String
        let value: String
    }

    private func facts(of book: BookCardDTO) -> [Fact] {
        [
            book.isbn.map { Fact(label: String(localized: "library.isbn", defaultValue: "ISBN"), value: $0) },
            book.publisher.map {
                Fact(label: String(localized: "library.fieldPublisher", defaultValue: "Издательство"), value: $0)
            },
            book.year.map {
                Fact(label: String(localized: "library.fieldYear", defaultValue: "Год издания"), value: String($0))
            },
            book.section.map { Fact(label: String(localized: "library.section", defaultValue: "Раздел"), value: $0) },
        ]
        .compactMap { $0 }
    }
}

/// QR-наклейка экземпляра (`/c/<код>`): найти книгу и показать её карточку.
///
/// QR ведёт на адрес, а не содержит данные: какая это книга, знает только сервер.
struct LibraryCopyView: View {
    let code: String

    @State private var model: LibraryCopyModel?

    var body: some View {
        Group {
            if let bookID = model?.bookID {
                LibraryBookView(bookID: bookID)
            } else if let failure = model?.failure {
                VStack(spacing: Spacing.md) {
                    Image(systemName: "book.closed")
                        .font(.system(size: 40))
                        .foregroundStyle(Palette.mutedForeground)
                        .accessibilityHidden(true)
                    Text(String(localized: "library.copyNotFoundTitle", defaultValue: "Наклейка не найдена"))
                        .font(Typography.sectionTitle)
                        .foregroundStyle(Palette.foreground)
                    Text(failure)
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                        .multilineTextAlignment(.center)
                }
                .padding(Spacing.xl)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Palette.background)
                .navigationTitle(Text(String(localized: "library.book", defaultValue: "Книга")))
                .navigationBarTitleDisplayMode(.inline)
            } else {
                ProgressView(String(localized: "library.openingBook", defaultValue: "Открываем книгу…"))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Palette.background)
            }
        }
        .task {
            if model == nil { model = LibraryCopyModel(code: code) }
            if model?.bookID == nil { await model?.resolve() }
        }
    }
}
