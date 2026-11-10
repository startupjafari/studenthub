import SwiftUI

/// Брони (веб `/library/reservations`): полка броней — готовые, с экземпляром и сроком,
/// очередь, закрытые. Готовую бронь выдают через выдачу — по студенческому читателя;
/// бронь можно снять, если читатель передумал.
struct LibrarianReservationsView: View {
    @State private var loader: PagedLoader<LibrarianReservationDTO>
    @State private var filter: String? = "ready"
    @State private var search = ""
    @State private var cancelling: LibrarianReservationDTO?
    @State private var failure: String?
    @State private var notice: String?
    @State private var issuing = false
    @State private var openBookID: String?

    private static let api = LibrarianAPI()

    init() {
        _loader = State(initialValue: PagedLoader(limit: 30) { request in
            try await Self.api.reservations(request, filter: "ready")
        })
    }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: search.isEmpty
                    ? String(localized: "librarian.res.empty", defaultValue: "Броней нет")
                    : String(localized: "librarian.nothingFound", defaultValue: "Ничего не найдено"),
                symbol: "bookmark"
            ),
            header: {
                FilterChipsRow(
                    options: [
                        ("ready", String(localized: "librarian.res.filterReady", defaultValue: "Полка броней")),
                        ("queued", String(localized: "librarian.res.filterQueued", defaultValue: "Очередь")),
                        ("active", String(localized: "librarian.res.filterActive", defaultValue: "Действующие")),
                        ("closed", String(localized: "librarian.filter.closed", defaultValue: "Закрытые")),
                        ("all", String(localized: "librarian.filter.all", defaultValue: "Все")),
                    ],
                    selection: $filter
                )
            },
            row: { reservation in
                LibrarianReservationRow(reservation: reservation)
                    .swipeActions {
                        if reservation.isActive {
                            Button(role: .destructive) { cancelling = reservation } label: {
                                Label(String(localized: "librarian.res.cancel", defaultValue: "Снять бронь"), systemImage: "xmark")
                            }
                        }
                        if reservation.status == "READY" {
                            Button { issuing = true } label: {
                                Label(String(localized: "librarian.res.issue", defaultValue: "Выдать"), systemImage: "arrow.up.doc")
                            }
                            .tint(Palette.success)
                        }
                    }
                    .contextMenu {
                        if reservation.status == "READY" {
                            Button { issuing = true } label: {
                                Label(String(localized: "librarian.res.issue", defaultValue: "Выдать"), systemImage: "arrow.up.doc")
                            }
                        }
                        Button { openBookID = reservation.book.id } label: {
                            Label(String(localized: "librarian.openBook", defaultValue: "Открыть книгу"), systemImage: "book")
                        }
                        if reservation.isActive {
                            Button(role: .destructive) { cancelling = reservation } label: {
                                Label(String(localized: "librarian.res.cancel", defaultValue: "Снять бронь"), systemImage: "xmark")
                            }
                        }
                    }
            }
        )
        .navigationTitle(Text(LibrarianScreen.reservations.title))
        .debouncedSearch($search, prompt: String(localized: "librarian.res.search", defaultValue: "Книга, читатель, инв. номер")) { _ in
            await reload()
        }
        .confirmationDialog(
            String(localized: "librarian.res.cancelTitle", defaultValue: "Снять бронь?"),
            isPresented: Binding(get: { cancelling != nil }, set: { if !$0 { cancelling = nil } }),
            titleVisibility: .visible,
            presenting: cancelling
        ) { reservation in
            Button(String(localized: "librarian.res.cancel", defaultValue: "Снять бронь"), role: .destructive) {
                Task { await cancel(reservation) }
            }
        } message: { reservation in
            Text(String(
                localized: "librarian.res.cancelDesc",
                defaultValue: "Бронь «\(reservation.book.title)» читателя \(reservation.reader.name) будет отменена, экземпляр уйдёт следующему в очереди или на полку."
            ))
        }
        .alert(notice ?? "", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        }
        .actionFailureAlert($failure)
        .navigationDestination(isPresented: $issuing) { LibrarianIssueView() }
        .navigationDestination(item: $openBookID) { id in LibrarianBookView(bookID: id) }
        .onChange(of: filter) { _, _ in Task { await reload() } }
    }

    @MainActor
    private func reload() async {
        let filter = filter ?? "all"
        let query = String(search.trimmingCharacters(in: .whitespaces).prefix(100))
        await loader.replace { request in
            try await Self.api.reservations(request, filter: filter, query: query.isEmpty ? nil : query)
        }
    }

    @MainActor
    private func cancel(_ reservation: LibrarianReservationDTO) async {
        do {
            _ = try await Self.api.cancelReservation(id: reservation.id)
            notice = String(localized: "librarian.res.cancelledToast", defaultValue: "Бронь снята")
            await loader.reload()
        } catch {
            failure = LibrarianText.deskMessage(error)
        }
    }
}

/// Бронь — как строка чата: обложка, книга полужирным, день брони справа, ниже —
/// читатель и экземпляр, плашка — готова до / место в очереди.
private struct LibrarianReservationRow: View {
    let reservation: LibrarianReservationDTO

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.lg) {
            BookCoverView(url: reservation.book.coverUrl, width: 40)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                    Text(reservation.book.title)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Palette.foreground)
                        .lineLimit(2)
                    Spacer(minLength: Spacing.sm)
                    Text(LibrarianText.shortDay(reservation.createdAt))
                        .font(.subheadline)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(1)
                }
                Text([reservation.reader.name, reservation.reader.group].compactMap { $0 }.joined(separator: " · "))
                    .font(.subheadline)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(2)
                if let copy = reservation.copy {
                    Text(LibrarianText.inventoryShort(copy.inventoryNumber))
                        .font(.subheadline)
                        .foregroundStyle(Palette.mutedForeground)
                }
                LibrarianReservationBadge(reservation: reservation)
                    .padding(.top, 2)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}
