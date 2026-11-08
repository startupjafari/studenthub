import SwiftUI

/// Приём книг (веб `/library/return`): скан наклейки или инвентарный номер, состояние
/// книги — и выдача закрыта. Если книгу ждёт очередь броней, экран крупно говорит, на чьё
/// имя её отложить. Ошибочно принятую книгу здесь же можно вернуть за читателем.
struct LibrarianReturnView: View {
    @State private var copy: LibrarianCopyRef?
    @State private var condition = "GOOD"
    @State private var failure: String?
    @State private var isSaving = false
    @State private var returned: [LibrarianReturnResultDTO] = []
    @State private var overdue: [LibrarianLoanDTO]?
    @State private var action: LibrarianLoanAction?

    private let api = LibrarianAPI()

    var body: some View {
        List {
            Section {
                LibrarianCopyField(value: $copy)
                Picker(String(localized: "librarian.condition", defaultValue: "Состояние"), selection: $condition) {
                    ForEach(LibrarianText.conditions, id: \.self) { Text(LibrarianText.condition($0)).tag($0) }
                }
                Button {
                    Task { await accept() }
                } label: {
                    HStack {
                        Spacer()
                        if isSaving { ProgressView() } else { Text(String(localized: "librarian.acceptReturn", defaultValue: "Принять книгу")).bold() }
                        Spacer()
                    }
                }
                .disabled(copy == nil || isSaving)
            } header: {
                Text(String(localized: "librarian.return.book", defaultValue: "Принять книгу"))
            } footer: {
                if let failure {
                    Text(failure).foregroundStyle(Palette.destructive)
                } else {
                    Text(String(localized: "librarian.return.hint", defaultValue: "Отсканируйте наклейку на книге или введите инвентарный номер"))
                }
            }
            .listRowBackground(Palette.card)

            if let latest = returned.first, let held = latest.heldFor {
                // Главное после приёма — не поставить книгу на полку, если её ждёт бронь.
                Section {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Label(
                            String(localized: "librarian.return.holdForTitle", defaultValue: "Отложите «\(latest.loan.book.title)» на полку броней"),
                            systemImage: "bookmark.fill"
                        )
                        .font(Typography.cardTitle)
                        Text(String(
                            localized: "librarian.return.holdFor",
                            defaultValue: "\(held.name) (\(held.group.orDash)) — бронь держится до \(LibrarianText.shortDay(held.holdUntil))"
                        ))
                        .font(Typography.meta)
                    }
                    .foregroundStyle(Palette.warning)
                }
                .listRowBackground(Palette.warning.opacity(0.12))
            }

            Section {
                if returned.isEmpty {
                    Text(String(localized: "librarian.return.empty", defaultValue: "Принятые за этот сеанс книги появятся здесь"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
                ForEach(returned) { result in
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        LibrarianLoanRow(loan: result.loan)
                        HStack(spacing: Spacing.xs) {
                            if let returnedAt = result.loan.returnedAt, returnedAt > result.loan.dueAt {
                                LibrarianBadge(text: String(localized: "librarian.return.wasOverdue", defaultValue: "с просрочкой"), tint: Palette.destructive)
                            }
                            LibrarianBadge(
                                text: result.heldFor == nil
                                    ? String(localized: "librarian.return.toShelf", defaultValue: "на полку")
                                    : String(localized: "librarian.return.toHoldShelf", defaultValue: "на полку броней"),
                                tint: result.heldFor == nil ? Palette.success : Palette.warning
                            )
                        }
                    }
                    .swipeActions {
                        // Отложенную под бронь книгу откатить нельзя — сервер ответит 409.
                        if result.heldFor == nil {
                            Button { action = .cancelReturn(result.loan) } label: {
                                Label(String(localized: "librarian.cancelReturn", defaultValue: "Отменить возврат"), systemImage: "arrow.uturn.backward")
                            }
                            .tint(Palette.warning)
                        }
                    }
                    .contextMenu {
                        if result.heldFor == nil {
                            Button { action = .cancelReturn(result.loan) } label: {
                                Label(String(localized: "librarian.cancelReturn", defaultValue: "Отменить возврат"), systemImage: "arrow.uturn.backward")
                            }
                        }
                    }
                }
            } header: {
                Text(String(localized: "librarian.return.returnedNow", defaultValue: "Принято сейчас"))
            } footer: {
                if !returned.isEmpty {
                    Text(String(localized: "librarian.return.returnedNowHint", defaultValue: "Читателям пришли уведомления"))
                }
            }
            .listRowBackground(Palette.card)

            Section {
                if let overdue {
                    if overdue.isEmpty {
                        Text(String(localized: "librarian.noOverdue", defaultValue: "Просрочек нет"))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    ForEach(overdue) { loan in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(loan.book.title).font(Typography.cardTitle).lineLimit(2)
                                Text([loan.reader.name, loan.reader.group].compactMap { $0 }.joined(separator: " · "))
                                    .font(Typography.meta)
                                    .foregroundStyle(Palette.mutedForeground)
                            }
                            Spacer(minLength: Spacing.md)
                            LibrarianLoanDueBadge(loan: loan)
                        }
                    }
                } else {
                    ProgressView().frame(maxWidth: .infinity)
                }
            } header: {
                Text(String(localized: "librarian.overdueTitle", defaultValue: "Просрочено"))
            } footer: {
                Text(String(localized: "librarian.return.overdueHint", defaultValue: "Кого ждут с книгами в первую очередь"))
            }
            .listRowBackground(Palette.card)
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(LibrarianScreen.returnBooks.title))
        .librarianLoanActions($action) { performed in
            if case .cancelReturn(let loan) = performed {
                returned.removeAll { $0.loan.id == loan.id }
            }
            await loadOverdue()
        }
        .refreshable { await loadOverdue() }
        .task { await loadOverdue() }
    }

    @MainActor
    private func accept() async {
        guard let copy else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            let result = try await api.returnCopy(copy, condition: condition)
            returned.insert(result, at: 0)
            self.copy = nil
            condition = "GOOD"
            failure = nil
            await loadOverdue()
        } catch {
            failure = LibrarianText.deskMessage(error)
        }
    }

    @MainActor
    private func loadOverdue() async {
        overdue = (try? await api.loans(PageRequest(cursor: nil, page: 1, limit: 6), filter: "overdue").items) ?? overdue ?? []
    }
}
