import SwiftUI

/// Книга глазами читателя: описание, наличие и бронь.
///
/// Своя бронь или книга на руках видны здесь же — второй раз забронировать то, что
/// уже ждёт на полке, не предлагаем. Подача — как карточка профиля: обложка по центру,
/// название, плашки и главное действие под ними; сведения — сгруппированными строками,
/// отмена брони — красной секцией внизу.
struct LibraryBookView: View {
    let bookID: String

    @State private var model: LibraryBookModel?
    @State private var confirmsCancel: String?

    var body: some View {
        List {
            if let unavailable = model?.unavailable {
                EmptyStateView(title: unavailable, symbol: "book.closed")
                    .listRowBackground(Color.clear)
            }

            // Отказ действия (бронь, отмена) или неудачное обновление над уже открытой
            // книгой — плашкой; без книги сбой занимает экран ниже, с повтором.
            if let failure = model?.failure, model?.book != nil {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            if let notice = model?.notice {
                LibraryNotice(message: notice)
            }

            if let model, let book = model.book, let state = model.state {
                Section {
                    BookHero(book: book, state: state) {
                        primaryAction(state.action, model: model)
                    }
                }

                let bookFacts = facts(of: book)
                if !bookFacts.isEmpty {
                    Section {
                        ForEach(bookFacts, id: \.label) { fact in
                            DetailRow(title: fact.label, value: fact.value, symbol: fact.symbol)
                        }
                    } header: {
                        Text(String(localized: "library.aboutBook", defaultValue: "О книге"))
                    }
                }

                if let description = book.description, !description.isEmpty {
                    Section {
                        Text(description)
                            .font(Typography.body)
                            .foregroundStyle(Palette.foreground)
                            .textSelection(.enabled)
                    } header: {
                        Text(String(localized: "library.fieldDescription", defaultValue: "Описание"))
                    }
                }

                if case .cancel(let reservationID) = state.action {
                    Section {
                        Button(role: .destructive) {
                            confirmsCancel = reservationID
                        } label: {
                            HStack {
                                Label(String(localized: "library.cancel", defaultValue: "Отменить бронь"), systemImage: "xmark.circle")
                                Spacer()
                                if model.isWorking { ProgressView() }
                            }
                        }
                        .foregroundStyle(Palette.destructive)
                        .disabled(model.isWorking)
                    }
                }
            } else if let model, model.unavailable == nil, let failure = model.failure, !model.isLoading {
                ErrorStateView(message: failure, isOffline: model.isOffline) { await model.load() }
                    .listRowBackground(Color.clear)
            } else if model?.unavailable == nil {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .navigationTitle(Text(String(localized: "library.book", defaultValue: "Книга")))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model?.load() }
        .task {
            if model == nil { model = LibraryBookModel(bookID: bookID) }
            await model?.load()
        }
        .alert(
            String(localized: "library.cancelTitle", defaultValue: "Отменить бронь?"),
            isPresented: Binding(get: { confirmsCancel != nil }, set: { if !$0 { confirmsCancel = nil } }),
            presenting: confirmsCancel
        ) { reservationID in
            Button(String(localized: "library.cancel", defaultValue: "Отменить бронь"), role: .destructive) {
                Task { await model?.cancel(reservationID: reservationID) }
            }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
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

    /// Главное действие в шапке: забронировать или встать в очередь. Отмена брони —
    /// не здесь, а красной секцией внизу: опасное не ставим рядом с главным.
    @ViewBuilder
    private func primaryAction(_ action: BookAction, model: LibraryBookModel) -> some View {
        switch action {
        case .reserve, .joinQueue:
            Button {
                Task { await model.reserve() }
            } label: {
                HStack(spacing: Spacing.sm) {
                    if model.isWorking {
                        ProgressView()
                    } else {
                        Image(systemName: action == .reserve ? "bookmark.fill" : "person.3.sequence.fill")
                    }
                    Text(action == .reserve
                        ? String(localized: "library.reserve", defaultValue: "Забронировать")
                        : String(localized: "library.joinQueue", defaultValue: "Встать в очередь"))
                }
                .font(.body.weight(.semibold))
                .frame(maxWidth: 280)
            }
            .glassProminentButton()
            .controlSize(.large)
            .disabled(model.isWorking)
        case .cancel, .none:
            EmptyView()
        }
    }

    private struct Fact {
        let label: String
        let value: String
        let symbol: String
    }

    private func facts(of book: BookCardDTO) -> [Fact] {
        [
            book.authors.isEmpty ? nil : Fact(
                label: String(localized: "library.fieldAuthors", defaultValue: "Авторы"),
                value: book.authors,
                symbol: "person"
            ),
            book.publisher.map {
                Fact(label: String(localized: "library.fieldPublisher", defaultValue: "Издательство"), value: $0, symbol: "building.2")
            },
            book.year.map {
                Fact(label: String(localized: "library.fieldYear", defaultValue: "Год издания"), value: String($0), symbol: "calendar")
            },
            book.section.map { Fact(label: String(localized: "library.section", defaultValue: "Раздел"), value: $0, symbol: "folder") },
            book.isbn.map { Fact(label: String(localized: "library.isbn", defaultValue: "ISBN"), value: $0, symbol: "barcode") },
        ]
        .compactMap { $0 }
    }
}

/// Шапка книги: крупная обложка по центру, название, авторы, плашки наличия и своей
/// брони/выдачи, главное действие и подсказка, что будет дальше.
private struct BookHero<Action: View>: View {
    let book: BookCardDTO
    let state: ReaderBookState
    @ViewBuilder var action: () -> Action

    @ScaledMetric(relativeTo: .largeTitle) private var coverWidth: CGFloat = 112

    var body: some View {
        VStack(spacing: Spacing.sm) {
            BookCoverView(url: book.coverUrl, width: min(coverWidth, 160))
                .padding(.bottom, Spacing.xs)
            Text(book.title)
                .font(.title2.weight(.semibold))
                .foregroundStyle(Palette.foreground)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if !book.byline.isEmpty {
                Text(book.byline)
                    .font(.subheadline)
                    .foregroundStyle(Palette.mutedForeground)
                    .multilineTextAlignment(.center)
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Spacing.sm) { badges }
                VStack(spacing: Spacing.xs) { badges }
            }
            .padding(.top, Spacing.xs)
            action()
                .padding(.top, Spacing.md)
            if let hint = state.hint {
                Text(hint)
                    .font(.footnote)
                    .foregroundStyle(Palette.mutedForeground)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, Spacing.xl)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.sm)
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: Spacing.sm, leading: 0, bottom: Spacing.sm, trailing: 0))
    }

    @ViewBuilder
    private var badges: some View {
        ShelfBadge(availability: book.availability, inCard: true)
        if let loan = state.loan {
            LoanDueBadge(loan: loan)
        }
        if let reservation = state.reservation {
            ReservationBadge(reservation: reservation)
        }
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
            } else if let model, let failure = model.failure, !model.isNotFound {
                // Сеть или сервер подвели — наклейка тут ни при чём: предлагаем повторить.
                ErrorStateView(message: failure, isOffline: model.isOffline) { await model.resolve() }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Palette.background)
                    .navigationTitle(Text(String(localized: "library.book", defaultValue: "Книга")))
                    .navigationBarTitleDisplayMode(.inline)
            } else if let failure = model?.failure {
                EmptyStateView(
                    title: String(localized: "library.copyNotFoundTitle", defaultValue: "Наклейка не найдена"),
                    symbol: "qrcode",
                    hint: failure
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Palette.background)
                .navigationTitle(Text(String(localized: "library.book", defaultValue: "Книга")))
                .navigationBarTitleDisplayMode(.inline)
            } else {
                LoadingStateView(title: String(localized: "library.openingBook", defaultValue: "Открываем книгу…"))
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
