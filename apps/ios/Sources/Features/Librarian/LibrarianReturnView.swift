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
    /// Просрочки (`RemoteValue`): сохранённые встают сразу, сеть обновляет фоном.
    @State private var overdueRemote = RemoteValue<[LibrarianLoanDTO]>()
    @State private var action: LibrarianLoanAction?

    private let api = LibrarianAPI()

    private var overdue: [LibrarianLoanDTO]? { overdueRemote.value }
    /// Список просрочек не загрузился — не «просрочек нет»: иначе сбой выглядел бы хорошей новостью.
    private var overdueFailure: String? { overdueRemote.failure }

    var body: some View {
        List {
            // Итог последнего приёма — первым и крупно: главное после приёма — не поставить
            // на полку книгу, которую ждёт бронь.
            if let failure {
                Section {
                    LibrarianOutcomeView(
                        kind: .failure,
                        title: String(localized: "librarian.return.notAccepted", defaultValue: "Не принято"),
                        detail: failure
                    )
                }
            } else if let latest = returned.first {
                Section {
                    if let held = latest.heldFor {
                        LibrarianOutcomeView(
                            kind: .warning,
                            title: String(localized: "librarian.return.toHoldShelfTitle", defaultValue: "На полку броней"),
                            detail: String(
                                localized: "librarian.return.holdForTitle",
                                defaultValue: "Отложите «\(latest.loan.book.title)» на полку броней"
                            ) + "\n" + String(
                                localized: "librarian.return.holdFor",
                                defaultValue: "\(held.name) (\(held.group.orDash)) — бронь держится до \(LibrarianText.shortDay(held.holdUntil))"
                            ),
                            symbol: "bookmark.fill"
                        )
                    } else {
                        LibrarianOutcomeView(
                            kind: .success,
                            title: String(localized: "librarian.return.acceptedTitle", defaultValue: "Принято — на полку"),
                            detail: wasOverdue(latest)
                                ? "«\(latest.loan.book.title)» · " + String(localized: "librarian.return.wasOverdue", defaultValue: "с просрочкой")
                                : "«\(latest.loan.book.title)»",
                            symbol: "books.vertical.fill"
                        )
                    }
                }
            }

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
                        if isSaving {
                            ProgressView()
                        } else {
                            Label(String(localized: "librarian.acceptReturn", defaultValue: "Принять книгу"), systemImage: "arrow.down.doc.fill")
                                .font(.body.weight(.semibold))
                        }
                        Spacer()
                    }
                }
                .disabled(copy == nil || isSaving)
            } header: {
                Text(String(localized: "librarian.return.book", defaultValue: "Принять книгу"))
            } footer: {
                Text(String(localized: "librarian.return.hint", defaultValue: "Отсканируйте наклейку на книге или введите инвентарный номер"))
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
                            if wasOverdue(result) {
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

            Section {
                if let overdueFailure, overdue != nil {
                    StaleDataBanner(message: overdueFailure, isOffline: overdueRemote.isOffline) { await loadOverdue() }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                if let overdue {
                    if overdue.isEmpty {
                        Text(String(localized: "librarian.noOverdue", defaultValue: "Просрочек нет"))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    ForEach(overdue) { loan in
                        TelegramStyleRow(
                            title: loan.book.title,
                            subtitle: [loan.reader.name, loan.reader.group].compactMap { $0 }.joined(separator: " · ")
                        ) {
                            BookCoverView(url: loan.book.coverUrl, width: 36)
                        } accessory: {
                            LibrarianLoanDueBadge(loan: loan)
                        }
                    }
                } else if let overdueFailure {
                    DashboardFailurePlaceholder(message: overdueFailure) { await loadOverdue() }
                } else {
                    ProgressView().frame(maxWidth: .infinity)
                }
            } header: {
                Text(String(localized: "librarian.overdueTitle", defaultValue: "Просрочено"))
            } footer: {
                Text(String(localized: "librarian.return.overdueHint", defaultValue: "Кого ждут с книгами в первую очередь"))
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(LibrarianScreen.returnBooks.title))
        .librarianLoanActions($action) { performed in
            if case .cancelReturn(let loan) = performed {
                returned.removeAll { $0.loan.id == loan.id }
            }
            await loadOverdue()
        }
        .pullToRefresh { await loadOverdue() }
        // Показ и возврат приложения из фона — сохранённое на месте, сеть обновляет фоном.
        .task(id: AppLifecycle.shared.foregroundEpoch) { await loadOverdue() }
        .sensoryFeedback(trigger: returned.count) { _, _ in
            returned.first?.heldFor == nil ? .success : .warning
        }
    }

    private func wasOverdue(_ result: LibrarianReturnResultDTO) -> Bool {
        if let returnedAt = result.loan.returnedAt { return returnedAt > result.loan.dueAt }
        return false
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

    /// Прошлый список при сбое не стирается: он лучше пустоты, а полоса скажет, что он
    /// несвежий.
    private func loadOverdue() async {
        await overdueRemote.load {
            try await api.loans(PageRequest(cursor: nil, page: 1, limit: 6), filter: "overdue").items
        }
    }
}
