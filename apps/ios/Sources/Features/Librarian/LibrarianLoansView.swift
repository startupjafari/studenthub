import SwiftUI

/// Выдачи вуза (веб `/library/loans`): на руках, просроченные, утерянные, закрытые, все;
/// поиск, «только без скана». Действия над выдачей — в меню строки и свайпом.
struct LibrarianLoansView: View {
    @State private var loader: PagedLoader<LibrarianLoanDTO>
    @State private var filter: String? = "open"
    @State private var search = ""
    @State private var noPhoneOnly = false
    @State private var action: LibrarianLoanAction?

    private static let api = LibrarianAPI()

    init() {
        _loader = State(initialValue: PagedLoader(limit: 30) { request in
            try await Self.api.loans(request, filter: "open")
        })
    }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: search.isEmpty
                    ? String(localized: "librarian.loans.empty", defaultValue: "Выдач нет")
                    : String(localized: "librarian.nothingFound", defaultValue: "Ничего не найдено"),
                symbol: "list.bullet.rectangle"
            ),
            header: {
                FilterChipsRow(
                    options: [
                        ("open", String(localized: "librarian.filter.open", defaultValue: "На руках")),
                        ("overdue", String(localized: "librarian.filter.overdue", defaultValue: "Просрочены")),
                        ("lost", String(localized: "librarian.filter.lost", defaultValue: "Утерянные")),
                        ("closed", String(localized: "librarian.filter.closed", defaultValue: "Закрытые")),
                        ("all", String(localized: "librarian.filter.all", defaultValue: "Все")),
                    ],
                    selection: $filter
                )
            },
            row: { loan in
                LibrarianLoanRow(loan: loan)
                    .contextMenu { LibrarianLoanMenu(loan: loan, action: $action) }
                    .swipeActions(edge: .trailing) { LibrarianLoanMenu(loan: loan, action: $action, compact: true) }
            }
        )
        .navigationTitle(Text(LibrarianScreen.loans.title))
        .debouncedSearch($search, prompt: String(localized: "librarian.loans.search", defaultValue: "Читатель, книга, инв. номер")) { _ in
            await reload()
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Toggle(isOn: $noPhoneOnly) {
                        Label(String(localized: "librarian.filter.noPhone", defaultValue: "Только без скана"), systemImage: "iphone.slash")
                    }
                } label: {
                    Image(systemName: noPhoneOnly ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                }
                .accessibilityLabel(Text(String(localized: "librarian.filter.more", defaultValue: "Фильтры")))
            }
        }
        .librarianLoanActions($action) { _ in await loader.reload() }
        .onChange(of: filter) { _, _ in Task { await reload() } }
        .onChange(of: noPhoneOnly) { _, _ in Task { await reload() } }
    }

    @MainActor
    private func reload() async {
        let filter = filter ?? "all"
        let query = String(search.trimmingCharacters(in: .whitespaces).prefix(100))
        let noPhone = noPhoneOnly
        await loader.replace { request in
            try await Self.api.loans(request, filter: filter, query: query.isEmpty ? nil : query, withoutPhone: noPhone)
        }
    }
}

// MARK: - Действия над выдачей

/// Что сделать с выдачей: удостоверение, приём, продление, утеря, отмена, долг, откат возврата.
enum LibrarianLoanAction: Identifiable, Equatable {
    case readerCard(LibrarianLoanDTO)
    case accept(LibrarianLoanDTO)
    case renew(LibrarianLoanDTO)
    case markLost(LibrarianLoanDTO)
    case cancel(LibrarianLoanDTO)
    case settle(LibrarianLoanDTO)
    case cancelReturn(LibrarianLoanDTO)

    var loan: LibrarianLoanDTO {
        switch self {
        case .readerCard(let loan), .accept(let loan), .renew(let loan), .markLost(let loan),
             .cancel(let loan), .settle(let loan), .cancelReturn(let loan):
            return loan
        }
    }

    var id: String {
        switch self {
        case .readerCard: return "card-\(loan.id)"
        case .accept: return "accept-\(loan.id)"
        case .renew: return "renew-\(loan.id)"
        case .markLost: return "lost-\(loan.id)"
        case .cancel: return "cancel-\(loan.id)"
        case .settle: return "settle-\(loan.id)"
        case .cancelReturn: return "undo-\(loan.id)"
        }
    }
}

/// Пункты меню выдачи — что доступно, решает её состояние: открытая, утерянная с долгом,
/// недавно возвращённая.
struct LibrarianLoanMenu: View {
    let loan: LibrarianLoanDTO
    @Binding var action: LibrarianLoanAction?
    var compact = false

    var body: some View {
        if loan.status == "OPEN" {
            if compact {
                Button { action = .accept(loan) } label: {
                    Label(String(localized: "librarian.acceptReturn", defaultValue: "Принять книгу"), systemImage: "arrow.down.doc")
                }
                .tint(Palette.success)
                Button { action = .renew(loan) } label: {
                    Label(String(localized: "librarian.renew", defaultValue: "Продлить"), systemImage: "calendar.badge.plus")
                }
                .tint(Palette.info)
            } else {
                Button { action = .readerCard(loan) } label: {
                    Label(String(localized: "librarian.readerCard", defaultValue: "Удостоверение читателя"), systemImage: "person.text.rectangle")
                }
                Button { action = .accept(loan) } label: {
                    Label(String(localized: "librarian.acceptReturn", defaultValue: "Принять книгу"), systemImage: "arrow.down.doc")
                }
                Button { action = .renew(loan) } label: {
                    Label(String(localized: "librarian.renew", defaultValue: "Продлить"), systemImage: "calendar.badge.plus")
                }
                Divider()
                Button(role: .destructive) { action = .markLost(loan) } label: {
                    Label(String(localized: "librarian.markLost", defaultValue: "Книга утеряна"), systemImage: "questionmark.folder")
                }
                Button(role: .destructive) { action = .cancel(loan) } label: {
                    Label(String(localized: "librarian.cancelLoan", defaultValue: "Отменить выдачу"), systemImage: "xmark.circle")
                }
            }
        } else if loan.isLostDebt {
            Button { action = .settle(loan) } label: {
                Label(String(localized: "librarian.settleLost", defaultValue: "Долг погашен"), systemImage: "checkmark.circle")
            }
            .tint(Palette.success)
        } else if loan.canCancelReturn {
            Button { action = .cancelReturn(loan) } label: {
                Label(String(localized: "librarian.cancelReturn", defaultValue: "Отменить возврат"), systemImage: "arrow.uturn.backward")
            }
            .tint(Palette.warning)
        }
    }
}

extension View {
    /// Листы, подтверждения и запросы причины для действий над выдачей. `done` — после
    /// успешного действия (перечитать список).
    func librarianLoanActions(_ action: Binding<LibrarianLoanAction?>, done: @escaping (LibrarianLoanAction) async -> Void) -> some View {
        modifier(LibrarianLoanActionsModifier(action: action, done: done))
    }
}

private struct LibrarianLoanActionsModifier: ViewModifier {
    @Binding var action: LibrarianLoanAction?
    let done: (LibrarianLoanAction) async -> Void

    @State private var reason = ""
    @State private var failure: String?
    @State private var notice: String?

    private let api = LibrarianAPI()

    func body(content: Content) -> some View {
        content
            .sheet(item: sheetBinding) { action in
                switch action {
                case .readerCard(let loan):
                    LibrarianReaderCardSheet(loanID: loan.id)
                case .accept(let loan):
                    LibrarianAcceptSheet(loan: loan) { message in
                        notice = message
                        await done(action)
                    }
                case .renew(let loan):
                    LibrarianRenewSheet(loan: loan) {
                        notice = String(localized: "librarian.renewedToast", defaultValue: "Выдача продлена")
                        await done(action)
                    }
                default:
                    EmptyView()
                }
            }
            .confirmationDialog(
                confirmTitle,
                isPresented: Binding(get: { confirmAction != nil }, set: { if !$0, confirmAction != nil { action = nil } }),
                titleVisibility: .visible,
                presenting: confirmAction
            ) { pending in
                switch pending {
                case .markLost(let loan):
                    Button(String(localized: "librarian.markLost", defaultValue: "Книга утеряна"), role: .destructive) {
                        Task { await run { _ = try await api.markLost(loanID: loan.id) } success: {
                            String(localized: "librarian.lostToast", defaultValue: "Отмечено: книга утеряна")
                        } }
                    }
                case .settle(let loan):
                    Button(String(localized: "librarian.settleLost", defaultValue: "Долг погашен")) {
                        Task { await run { _ = try await api.settleLost(loanID: loan.id) } success: {
                            String(localized: "librarian.settledToast", defaultValue: "Долг погашен")
                        } }
                    }
                default:
                    EmptyView()
                }
            } message: { pending in
                switch pending {
                case .markLost(let loan):
                    Text(String(
                        localized: "librarian.lostDesc",
                        defaultValue: "«\(loan.book.title)» у читателя \(loan.reader.name) будет отмечена утерянной, экземпляр выйдет из оборота. Долг останется за читателем, пока книгу не заменят или не возместят."
                    ))
                case .settle(let loan):
                    Text(String(
                        localized: "librarian.settleDesc",
                        defaultValue: "Читатель \(loan.reader.name) заменил «\(loan.book.title)» или возместил её стоимость. Справка, выдача и брони снова откроются для него."
                    ))
                default:
                    EmptyView()
                }
            }
            .alert(promptTitle, isPresented: Binding(get: { promptAction != nil }, set: { if !$0, promptAction != nil { action = nil } })) {
                TextField(promptPlaceholder, text: $reason)
                Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) { reason = "" }
                Button(promptButton, role: .destructive) {
                    let text = reason.trimmingCharacters(in: .whitespacesAndNewlines)
                    reason = ""
                    guard let pending = promptAction else { return }
                    Task { await submitPrompt(pending, reason: text) }
                }
            } message: {
                Text(String(localized: "librarian.reasonHint", defaultValue: "Причина — от 3 до 300 символов, она попадёт в журнал"))
            }
            .alert(
                notice ?? "",
                isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })
            ) {
                Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
            }
            .actionFailureAlert($failure)
    }

    // MARK: Развилка по виду действия

    private var sheetBinding: Binding<LibrarianLoanAction?> {
        Binding(
            get: {
                switch action {
                case .readerCard?, .accept?, .renew?: return action
                default: return nil
                }
            },
            set: { if $0 == nil { action = nil } }
        )
    }

    private var confirmAction: LibrarianLoanAction? {
        switch action {
        case .markLost?, .settle?: return action
        default: return nil
        }
    }

    private var promptAction: LibrarianLoanAction? {
        switch action {
        case .cancel?, .cancelReturn?: return action
        default: return nil
        }
    }

    private var confirmTitle: String {
        switch confirmAction {
        case .settle?: return String(localized: "librarian.settleTitle", defaultValue: "Долг погашен?")
        default: return String(localized: "librarian.lostTitle", defaultValue: "Книга утеряна?")
        }
    }

    private var promptTitle: String {
        switch promptAction {
        case .cancelReturn(let loan)?:
            return String(
                localized: "librarian.cancelReturnTitle",
                defaultValue: "Отменить возврат «\(loan.book.title)»? Книга снова будет числиться за \(loan.reader.name) с прежним сроком"
            )
        default:
            return String(localized: "librarian.cancelTitle", defaultValue: "Отменить ошибочную выдачу?")
        }
    }

    private var promptPlaceholder: String {
        switch promptAction {
        case .cancelReturn?: return String(localized: "librarian.cancelReturnReason", defaultValue: "Причина: например, приняли не ту книгу")
        default: return String(localized: "librarian.cancelReason", defaultValue: "Причина: например, выдали не тому читателю")
        }
    }

    private var promptButton: String {
        switch promptAction {
        case .cancelReturn?: return String(localized: "librarian.cancelReturn", defaultValue: "Отменить возврат")
        default: return String(localized: "librarian.cancelLoan", defaultValue: "Отменить выдачу")
        }
    }

    @MainActor
    private func submitPrompt(_ pending: LibrarianLoanAction, reason: String) async {
        guard reason.count >= 3 else {
            failure = String(localized: "librarian.reasonTooShort", defaultValue: "Укажите причину — от 3 до 300 символов")
            action = nil
            return
        }
        let text = String(reason.prefix(300))
        switch pending {
        case .cancel(let loan):
            await run { _ = try await api.cancelLoan(loanID: loan.id, reason: text) } success: {
                String(localized: "librarian.cancelledToast", defaultValue: "Выдача отменена")
            }
        case .cancelReturn(let loan):
            await run { _ = try await api.cancelReturn(loanID: loan.id, reason: text) } success: {
                String(localized: "librarian.returnCancelledToast", defaultValue: "Возврат отменён — книга снова за \(loan.reader.name)")
            }
        default:
            break
        }
    }

    @MainActor
    private func run(_ operation: () async throws -> Void, success: () -> String) async {
        let performed = action
        action = nil
        do {
            try await operation()
            notice = success()
            if let performed { await done(performed) }
        } catch {
            failure = LibrarianText.deskMessage(error)
        }
    }
}

/// Приём книги из списка выдач: состояние книги — и выдача закрыта.
private struct LibrarianAcceptSheet: View {
    let loan: LibrarianLoanDTO
    let accepted: (String) async -> Void

    @State private var condition = "GOOD"
    private let api = LibrarianAPI()

    var body: some View {
        FormSheet(
            title: String(localized: "librarian.acceptReturn", defaultValue: "Принять книгу"),
            saveTitle: String(localized: "librarian.acceptReturn", defaultValue: "Принять книгу"),
            save: save
        ) {
            Section {
                Text(String(localized: "librarian.returnOf", defaultValue: "«\(loan.book.title)», инв. \(loan.copy.inventoryNumber)"))
                Picker(String(localized: "librarian.condition", defaultValue: "Состояние"), selection: $condition) {
                    ForEach(LibrarianText.conditions, id: \.self) { Text(LibrarianText.condition($0)).tag($0) }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    @MainActor
    private func save() async throws {
        do {
            let result = try await api.returnCopy(.inventory(loan.copy.inventoryNumber), condition: condition)
            if let held = result.heldFor {
                await accepted(String(localized: "librarian.returnedHeldToast", defaultValue: "Принята. Отложите книгу для \(held.name)"))
            } else {
                await accepted(String(localized: "librarian.returnedToast", defaultValue: "Принята: «\(loan.book.title)»"))
            }
        } catch {
            throw LibrarianText.deskError(error)
        }
    }
}

/// Продление: новая дата или, без неё, срок по умолчанию от текущего срока.
private struct LibrarianRenewSheet: View {
    let loan: LibrarianLoanDTO
    let renewed: () async -> Void

    @State private var pickDate = false
    @State private var date = Calendar.current.date(byAdding: .day, value: 14, to: Date()) ?? Date()
    private let api = LibrarianAPI()

    var body: some View {
        FormSheet(
            title: String(localized: "librarian.renew", defaultValue: "Продлить"),
            saveTitle: String(localized: "librarian.renew", defaultValue: "Продлить"),
            save: save
        ) {
            Section {
                Text(loan.book.title).font(Typography.cardTitle)
                Text(String(localized: "librarian.dueUntil", defaultValue: "до \(LibrarianText.shortDay(loan.dueDate))"))
                    .foregroundStyle(Palette.mutedForeground)
                Toggle(String(localized: "librarian.renew.pickDate", defaultValue: "Выбрать новый срок"), isOn: $pickDate)
                if pickDate {
                    DatePicker(
                        String(localized: "librarian.newDueDate", defaultValue: "Новый срок"),
                        selection: $date,
                        in: Calendar.current.startOfDay(for: Date())...,
                        displayedComponents: .date
                    )
                }
            } footer: {
                Text(String(localized: "librarian.renewHint", defaultValue: "Без даты — срок по умолчанию от текущего срока."))
            }
        }
        .presentationDetents([.medium, .large])
    }

    @MainActor
    private func save() async throws {
        do {
            _ = try await api.renew(loanID: loan.id, dueDate: pickDate ? LibrarianText.dayString(date) : nil)
            await renewed()
        } catch {
            throw LibrarianText.deskError(error)
        }
    }
}


/// Удостоверение читателя на время выдачи: библиотекарь сверяет, у кого книга. Просмотр
/// записывается в журнал; после возврата карточка закрыта.
struct LibrarianReaderCardSheet: View {
    let loanID: String

    @Environment(\.dismiss) private var dismiss
    private let api = LibrarianAPI()

    var body: some View {
        NavigationStack {
            RemoteContent(load: {
                do {
                    return try await api.readerCard(loanID: loanID)
                } catch let error as APIError where error.code == .forbidden {
                    throw LibrarianText.messageError(String(
                        localized: "librarian.readerCardClosed",
                        defaultValue: "Книга уже возвращена — удостоверение больше не доступно"
                    ))
                }
            }) { card in
                List {
                    Section {
                        HeroHeader(
                            visual: .avatar(url: card.reader.avatarUrl, name: card.reader.fullName),
                            title: card.reader.fullName,
                            subtitle: card.reader.group
                        )
                    }
                    Section {
                        if let faculty = card.reader.faculty {
                            DetailRow(title: String(localized: "librarian.reader.faculty", defaultValue: "Факультет"), value: faculty, symbol: "building.columns")
                        }
                        if let course = card.reader.course {
                            DetailRow(title: String(localized: "librarian.reader.course", defaultValue: "Курс"), value: String(course), symbol: "graduationcap")
                        }
                        if let number = card.reader.studentCardNumber {
                            DetailRow(title: String(localized: "librarian.reader.card", defaultValue: "№ билета"), value: number, symbol: "person.text.rectangle")
                        }
                    }
                    Section {
                        Text(String(
                            localized: "librarian.readerCardLoan",
                            defaultValue: "На руках «\(card.loan.bookTitle)», инв. \(card.loan.inventoryNumber), до \(LibrarianText.shortDay(card.loan.dueDate))"
                        ))
                    } footer: {
                        Text(String(localized: "librarian.readerCardLogged", defaultValue: "Просмотр записан в журнал: кто и когда открывал карточку"))
                    }
                }
                .listStyle(.insetGrouped)
            }
            .navigationTitle(Text(String(localized: "librarian.readerCard", defaultValue: "Удостоверение читателя")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
