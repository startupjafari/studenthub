import SwiftUI

// Библиотека глазами администратора вуза: выключатель модуля и правила выдачи
// (`LibrarySettingsView`), отчёты (`ReportsView`), журнал просмотров удостоверений
// (`IdAccessView`). Фонд и выдачи ведёт библиотекарь.

// MARK: - Настройки

struct StaffLibrarySettingsView: View {
    @State private var settings: StaffLibrarySettings?
    @State private var draft: StaffLibrarySettings?
    @State private var failure: String?
    @State private var formFailure: String?
    @State private var notice: String?
    @State private var isSaving = false
    @State private var confirmDisable = false

    private let api = StaffAPI()

    /// Правило, его пределы (`LIBRARY_LIMITS`) и подписи — как в вебе.
    private struct Rule {
        let path: WritableKeyPath<StaffLibrarySettings, Int>
        let field: String
        let range: ClosedRange<Int>
        let title: String
        let hint: String
    }

    private var rules: [Rule] {
        [
            Rule(path: \.defaultLoanDays, field: "defaultLoanDays", range: 1...365,
                 title: String(localized: "staff.lib.rule.defaultLoanDays", defaultValue: "Срок выдачи по умолчанию, дней"),
                 hint: String(localized: "staff.lib.ruleHint.defaultLoanDays", defaultValue: "Подставляется при выдаче, библиотекарь может изменить")),
            Rule(path: \.maxLoanDays, field: "maxLoanDays", range: 1...365,
                 title: String(localized: "staff.lib.rule.maxLoanDays", defaultValue: "Максимальный срок, дней"),
                 hint: String(localized: "staff.lib.ruleHint.maxLoanDays", defaultValue: "Например, учебник на семестр — 120")),
            Rule(path: \.maxActiveLoans, field: "maxActiveLoans", range: 1...50,
                 title: String(localized: "staff.lib.rule.maxActiveLoans", defaultValue: "Книг на руках одновременно"),
                 hint: String(localized: "staff.lib.ruleHint.maxActiveLoans", defaultValue: "Больше выдать нельзя, пока читатель не вернёт")),
            Rule(path: \.maxActiveReservations, field: "maxActiveReservations", range: 0...20,
                 title: String(localized: "staff.lib.rule.maxActiveReservations", defaultValue: "Активных броней у читателя"),
                 hint: String(localized: "staff.lib.ruleHint.maxActiveReservations", defaultValue: "0 — бронь выключена")),
            Rule(path: \.reservationHoldDays, field: "reservationHoldDays", range: 1...30,
                 title: String(localized: "staff.lib.rule.reservationHoldDays", defaultValue: "Сколько держится готовая бронь, дней"),
                 hint: String(localized: "staff.lib.ruleHint.reservationHoldDays", defaultValue: "Потом бронь переходит следующему в очереди")),
            Rule(path: \.maxRenewals, field: "maxRenewals", range: 0...10,
                 title: String(localized: "staff.lib.rule.maxRenewals", defaultValue: "Продлений одной выдачи"),
                 hint: String(localized: "staff.lib.ruleHint.maxRenewals", defaultValue: "Продлевает библиотекарь; 0 — без продлений")),
        ]
    }

    var body: some View {
        Group {
            if let settings, let draft {
                form(settings, draft: draft)
            } else if let failure {
                ErrorStateView(message: failure) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .navigationTitle(Text(StaffScreen.librarySettings.title))
        .confirmationDialog(
            String(localized: "staff.lib.disable.title", defaultValue: "Выключить библиотеку?"),
            isPresented: $confirmDisable,
            titleVisibility: .visible
        ) {
            Button(String(localized: "staff.lib.disable", defaultValue: "Выключить библиотеку"), role: .destructive) {
                Task { await toggle(false) }
            }
        } message: {
            Text(String(
                localized: "staff.lib.disable.message",
                defaultValue: "Выдача, возврат и брони остановятся. Каталог, выданные книги и история останутся — включите обратно, и всё будет на месте."
            ))
        }
        .alert(
            String(localized: "staff.lib.done", defaultValue: "Готово"),
            isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })
        ) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        } message: {
            Text(notice ?? "")
        }
        .task { await load() }
    }

    private func form(_ settings: StaffLibrarySettings, draft: StaffLibrarySettings) -> some View {
        Form {
            if let formFailure {
                FormAlert(message: formFailure)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }
            Section {
                Toggle(isOn: Binding(
                    get: { settings.enabled },
                    set: { on in
                        if on {
                            Task { await toggle(true) }
                        } else {
                            confirmDisable = true
                        }
                    }
                )) {
                    HStack(spacing: Spacing.lg) {
                        IconTile(symbol: "books.vertical.fill", tint: settings.enabled ? TileTint.orange : TileTint.gray)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(String(localized: "staff.lib.module", defaultValue: "Библиотека включена"))
                            Text(String(localized: "staff.lib.subtitle", defaultValue: "Фонд и выдачи ведёт библиотекарь."))
                                .font(Typography.meta)
                                .foregroundStyle(Palette.mutedForeground)
                        }
                    }
                }
                .disabled(isSaving)
            }

            Section {
                ForEach(rules, id: \.field) { rule in
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Stepper(value: binding(rule.path), in: rule.range) {
                            StaffValueRow(title: rule.title, value: draft[keyPath: rule.path].formatted(), tint: Palette.foreground)
                        }
                        Text(rule.hint)
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    .padding(.vertical, 2)
                }
            } header: {
                Text(String(localized: "staff.lib.rules", defaultValue: "Правила выдачи"))
            } footer: {
                Text(String(localized: "staff.lib.rules.hint", defaultValue: "Действуют для всех читателей вуза — студентов и старост."))
            }

            Section {
                Button {
                    Task { await saveRules() }
                } label: {
                    if isSaving {
                        ProgressView().frame(maxWidth: .infinity)
                    } else {
                        Text(String(localized: "common.save", defaultValue: "Сохранить"))
                            .fontWeight(.semibold)
                            .frame(maxWidth: .infinity)
                    }
                }
                .disabled(isSaving || !isDirty)
            }
        }
        .refreshable { await load() }
    }

    private var isDirty: Bool {
        guard let settings, let draft else { return false }
        return rules.contains { settings[keyPath: $0.path] != draft[keyPath: $0.path] }
    }

    private func binding(_ path: WritableKeyPath<StaffLibrarySettings, Int>) -> Binding<Int> {
        Binding(
            get: { draft?[keyPath: path] ?? 0 },
            set: { value in draft?[keyPath: path] = value }
        )
    }

    @MainActor
    private func load() async {
        do {
            let loaded = try await api.librarySettings()
            settings = loaded
            draft = loaded
            failure = nil
        } catch {
            failure = error.userMessage
        }
    }

    @MainActor
    private func toggle(_ on: Bool) async {
        isSaving = true
        defer { isSaving = false }
        do {
            let saved = try await api.updateLibrarySettings(["enabled": .bool(on)])
            settings = saved
            notice = saved.enabled
                ? String(localized: "staff.lib.enabled", defaultValue: "Библиотека включена")
                : String(localized: "staff.lib.disabled", defaultValue: "Библиотека выключена")
            formFailure = nil
        } catch {
            formFailure = error.userMessage
        }
    }

    @MainActor
    private func saveRules() async {
        guard let draft else { return }
        if draft.defaultLoanDays > draft.maxLoanDays {
            formFailure = String(localized: "staff.lib.defaultOverMax", defaultValue: "Срок по умолчанию не может быть больше максимального")
            return
        }
        isSaving = true
        defer { isSaving = false }
        var fields: [String: JSONValue] = [:]
        for rule in rules { fields[rule.field] = .int(draft[keyPath: rule.path]) }
        do {
            let saved = try await api.updateLibrarySettings(fields)
            settings = saved
            self.draft = saved
            formFailure = nil
            notice = String(localized: "staff.lib.saved", defaultValue: "Правила сохранены")
        } catch {
            formFailure = error.userMessage
        }
    }
}

// MARK: - Отчёты

struct StaffLibraryReportsView: View {
    @State private var summary: StaffLibrarySummary?
    @State private var failure: String?
    @State private var debts: [StaffLoan]?
    @State private var popular: [StaffPopularBook]?
    @State private var days = 90

    private let api = StaffAPI()
    private static let periods = [30, 90, 365]

    var body: some View {
        List {
            Section {
                if let summary {
                    StatGrid { tiles(summary) }
                } else if let failure {
                    ErrorStateView(message: failure) { await load() }
                } else {
                    LoadingStateView()
                }
            } footer: {
                Text(String(localized: "staff.lib.reports.subtitle", defaultValue: "Фонд, выдачи, должники и популярное"))
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())

            Section {
                if let debts {
                    if debts.isEmpty {
                        Label(String(localized: "staff.lib.noDebtors", defaultValue: "Долгов нет"), systemImage: "checkmark.circle")
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    ForEach(debts) { loan in
                        StaffLoanRow(loan: loan)
                    }
                } else {
                    ProgressView().frame(maxWidth: .infinity)
                }
            } header: {
                Text(String(localized: "staff.lib.debtors", defaultValue: "Должники"))
            } footer: {
                Text(String(localized: "staff.lib.debtors.hint", defaultValue: "Утерянные книги и самые давние просрочки"))
            }

            Section {
                Picker(String(localized: "staff.lib.period", defaultValue: "Период"), selection: $days) {
                    ForEach(Self.periods, id: \.self) { value in
                        Text(String(localized: "staff.lib.days", defaultValue: "\(value.formatted()) дн.")).tag(value)
                    }
                }
                .pickerStyle(.segmented)
                if let popular {
                    if popular.isEmpty {
                        Text(String(localized: "staff.lib.noPopular", defaultValue: "За этот период выдач не было"))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    ForEach(Array(popular.enumerated()), id: \.element.id) { index, row in
                        NavigationLink(value: AppRoute.staff(.libraryBook(id: row.book.id))) {
                            HStack(spacing: Spacing.md) {
                                Text(verbatim: (index + 1).formatted())
                                    .font(Typography.meta.monospacedDigit())
                                    .foregroundStyle(Palette.mutedForeground)
                                    .frame(width: 24, alignment: .trailing)
                                BookCoverView(url: row.book.coverUrl, width: 32)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(row.book.title).font(Typography.body).foregroundStyle(Palette.foreground).lineLimit(2)
                                    if let authors = row.book.authors, !authors.isEmpty {
                                        Text(authors).font(Typography.meta).foregroundStyle(Palette.mutedForeground).lineLimit(1)
                                    }
                                }
                                Spacer(minLength: Spacing.md)
                                Text(String(localized: "staff.lib.loansCount", defaultValue: "Выдач: \(row.loans.formatted())"))
                                    .font(Typography.meta)
                                    .foregroundStyle(Palette.mutedForeground)
                            }
                        }
                    }
                } else {
                    ProgressView().frame(maxWidth: .infinity)
                }
            } header: {
                Text(String(localized: "staff.lib.popular", defaultValue: "Популярное"))
            } footer: {
                Text(String(localized: "staff.lib.popular.hint", defaultValue: "Сколько раз книгу выдавали"))
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .navigationTitle(Text(StaffScreen.libraryReports.title))
        .refreshable { await load() }
        .task { await load() }
        .onChange(of: days) { Task { await loadPopular() } }
    }

    @ViewBuilder
    private func tiles(_ s: StaffLibrarySummary) -> some View {
        StatTile(
            title: String(localized: "staff.lib.books", defaultValue: "Книг в каталоге"),
            value: s.books.formatted(), symbol: "books.vertical",
            caption: String(localized: "staff.lib.copiesHint", defaultValue: "Экземпляров в обороте: \(s.copies.total.formatted())")
        )
        StatTile(
            title: String(localized: "staff.lib.onLoan", defaultValue: "На руках"),
            value: s.loans.open.formatted(), symbol: "book",
            caption: String(localized: "staff.lib.onShelfHint", defaultValue: "\(s.copies.available.formatted()) на полке")
        )
        StatTile(
            title: String(localized: "staff.lib.overdue", defaultValue: "Просрочено"),
            value: s.loans.overdue.formatted(), symbol: "exclamationmark.circle",
            tint: Palette.destructive,
            caption: String(localized: "staff.lib.debtorsHint", defaultValue: "Должников: \(s.readers.debtors.formatted())")
        )
        StatTile(
            title: String(localized: "staff.lib.reservations", defaultValue: "Брони"),
            value: (s.reservations.ready + s.reservations.queued).formatted(), symbol: "bookmark",
            caption: String(
                localized: "staff.lib.reservationsHint",
                defaultValue: "готовых \(s.reservations.ready.formatted()), в очереди \(s.reservations.queued.formatted())"
            )
        )
        StatTile(
            title: String(localized: "staff.lib.issued30", defaultValue: "Выдано за 30 дней"),
            value: s.loans.issuedLast30.formatted(), symbol: "checklist",
            caption: String(localized: "staff.lib.returned30", defaultValue: "возвращено \(s.loans.returnedLast30.formatted())")
        )
        StatTile(
            title: String(localized: "staff.lib.readers", defaultValue: "Читателей с книгами"),
            value: s.readers.withLoans.formatted(), symbol: "person.2",
            caption: String(localized: "staff.lib.readersHint", defaultValue: "сейчас на руках хотя бы одна книга")
        )
        StatTile(
            title: String(localized: "staff.lib.withoutPhone", defaultValue: "Без скана за 30 дней"),
            value: (s.loans.withoutPhoneLast30 ?? 0).formatted(), symbol: "iphone.slash",
            tint: Palette.mutedForeground,
            caption: String(localized: "staff.lib.withoutPhone.hint", defaultValue: "по номеру билета, с отметкой")
        )
        StatTile(
            title: String(localized: "staff.lib.withdrawn", defaultValue: "Выбыло из оборота"),
            value: (s.copies.lost + s.copies.writtenOff).formatted(), symbol: "minus.circle",
            tint: Palette.mutedForeground,
            caption: String(
                localized: "staff.lib.withdrawnHint",
                defaultValue: "утеряно \(s.copies.lost.formatted()), списано \(s.copies.writtenOff.formatted())"
            )
        )
    }

    @MainActor
    private func load() async {
        async let summaryTask = api.librarySummary()
        // Утерянная книга с непогашенным долгом — такой же долг, как просрочка.
        async let lostTask = api.loans(filter: "lost", limit: 10)
        async let overdueTask = api.loans(filter: "overdue", limit: 10)
        do {
            summary = try await summaryTask
            failure = nil
        } catch {
            failure = error.userMessage
        }
        let lost = (try? await lostTask) ?? []
        let overdue = (try? await overdueTask) ?? []
        debts = lost + overdue
        await loadPopular()
    }

    @MainActor
    private func loadPopular() async {
        popular = nil
        popular = (try? await api.popularBooks(days: days)) ?? []
    }
}

/// Выдача: читатель, книга, срок. Просрочку видно цветом.
struct StaffLoanRow: View {
    let loan: StaffLoan

    var body: some View {
        TelegramStyleRow(
            title: loan.reader.name,
            subtitle: [loan.reader.group, loan.book.title].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: "\n")
        ) {
            AvatarView(url: nil, name: loan.reader.name, size: 40)
        } accessory: {
            StatusBadge(text: badge.0, tint: badge.1)
        }
    }

    private var badge: (String, Color) {
        switch loan.status {
        case "LOST":
            return loan.lostSettledAt == nil
                ? (String(localized: "staff.lib.loan.lost", defaultValue: "Утеряна"), Palette.destructive)
                : (String(localized: "staff.lib.loan.lostSettled", defaultValue: "Утеряна, возмещено"), Palette.mutedForeground)
        case "RETURNED":
            return (String(localized: "staff.lib.loan.returned", defaultValue: "Возвращена"), Palette.success)
        case "CANCELLED":
            return (String(localized: "staff.lib.loan.cancelled", defaultValue: "Отменена"), Palette.mutedForeground)
        default:
            let date = DisplayFormat.date(loan.dueAt)
            return loan.overdue
                ? (String(localized: "staff.lib.loan.overdue", defaultValue: "Просрочена с \(date)"), Palette.destructive)
                : (String(localized: "staff.lib.loan.due", defaultValue: "До \(date)"), Palette.info)
        }
    }
}

// MARK: - Журнал просмотров удостоверений

/// Кто из библиотекарей, чью карточку, по какой выдаче, когда и с какого адреса открывал.
/// Для разбора жалоб, а не для слежки: только чтение.
struct StaffIdAccessView: View {
    @State private var search = ""
    @State private var loader: PagedLoader<StaffIdAccessItem>

    private let api = StaffAPI()

    init() {
        let api = StaffAPI()
        _loader = State(initialValue: PagedLoader(limit: 30) { request in
            try await api.idAccess(search: "", request)
        })
    }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: search.isEmpty
                    ? String(localized: "staff.lib.journal.empty", defaultValue: "Просмотров пока нет")
                    : String(localized: "staff.lib.journal.nothing", defaultValue: "Ничего не найдено"),
                symbol: "person.text.rectangle",
                hint: search.isEmpty ? String(
                    localized: "staff.lib.journal.empty.hint",
                    defaultValue: "Каждый раз, когда библиотекарь открывает удостоверение читателя, здесь появляется запись"
                ) : nil
            ),
            header: {
                Section {
                } footer: {
                    Text(String(localized: "staff.lib.journal.subtitle", defaultValue: "Кто из библиотекарей открывал карточки читателей по выдачам"))
                }
            },
            row: { item in
                let ip: String? = item.ip.map { "IP " + $0 }
                let lines: [String?] = [item.bookTitle, ip]
                TelegramStyleRow(
                    title: String(localized: "staff.lib.journal.row", defaultValue: "\(item.librarianName) → \(item.readerName)"),
                    subtitle: lines.compactMap { $0 }.joined(separator: "\n"),
                    meta: DisplayFormat.dateTime(item.createdAt)
                ) {
                    RowSymbol(symbol: "person.text.rectangle.fill", tint: item.withoutPhone == true ? TileTint.orange : TileTint.purple, size: 40)
                } accessory: {
                    if item.withoutPhone == true {
                        StatusBadge(text: String(localized: "staff.lib.withoutPhoneBadge", defaultValue: "Без скана"), tint: Palette.warning)
                    }
                }
            }
        )
        .navigationTitle(Text(StaffScreen.libraryJournal.title))
        .adminPinnedSearch($search, prompt: String(localized: "staff.lib.journal.search", defaultValue: "Читатель или библиотекарь")) { value in
            await loader.replace { request in try await api.idAccess(search: value, request) }
        }
    }
}
