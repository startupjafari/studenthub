import SwiftUI

// Типы документов (веб — `DocumentTypesAdminView`) и журнал документов вуза
// (`DocumentJournalView`). Оба — у администратора вуза.

// MARK: - Типы документов

/// Каталог гибридный: статические типы вуз включает и выключает и задаёт им срок
/// хранения, собственные — заводит и удаляет.
struct StaffDocumentTypesView: View {
    @State private var types: [StaffDocumentType]?
    @State private var failure: String?
    @State private var isOffline = false
    @State private var actionFailure: String?
    @State private var adding = false
    @State private var removing: StaffDocumentType?
    @State private var prompt: StaffTextPrompt?

    private let api = StaffAPI()

    var body: some View {
        List {
            Section {
            } footer: {
                Text(String(localized: "staff.dt.subtitle", defaultValue: "Какие документы есть у людей вашего вуза: включайте нужные, задавайте срок хранения, добавляйте свои."))
            }

            if let types {
                ForEach(grouped(types), id: \.0) { category, rows in
                    Section(StaffDocText.category(category)) {
                        ForEach(rows) { row in
                            typeRow(row)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .screenState(types?.isEmpty != false) {
            if types != nil {
                EmptyStateView(
                    title: String(localized: "staff.dt.empty", defaultValue: "Типов документов нет"),
                    symbol: "doc.text",
                    actionTitle: String(localized: "staff.dt.add", defaultValue: "Добавить свой тип")
                ) {
                    adding = true
                }
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .navigationTitle(Text(StaffScreen.documentTypes.title))
        .floatingAction(String(localized: "staff.dt.add", defaultValue: "Добавить свой тип")) {
            adding = true
        }
        .sheet(isPresented: $adding) {
            StaffNewDocumentTypeSheet { await load() }
        }
        .sheet(item: $prompt) { prompt in
            StaffTextPromptSheet(prompt: prompt) { await load() }
        }
        .confirmDestructive(
            $removing,
            title: { row in
                row.custom
                    ? String(localized: "staff.dt.delete.confirm", defaultValue: "Удалить тип «\(row.title)»?")
                    : String(localized: "staff.dt.reset.confirm", defaultValue: "Сбросить настройки типа «\(row.title)»?")
            },
            actionTitle: String(localized: "staff.dt.remove", defaultValue: "Подтвердить")
        ) { row in
            await remove(row)
        }
        .actionFailureAlert($actionFailure)
        .refreshable { await load() }
        .task { await load() }
    }

    private func typeRow(_ row: StaffDocumentType) -> some View {
        HStack(spacing: Spacing.lg) {
            IconTile(symbol: Self.symbol(row.category), tint: row.enabled ? Self.tint(row.category) : TileTint.gray)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: Spacing.sm) {
                    Text(row.title)
                        .font(Typography.body)
                        .foregroundStyle(row.enabled ? Palette.foreground : Palette.mutedForeground)
                    if row.custom {
                        StatusBadge(text: String(localized: "staff.dt.custom", defaultValue: "Свой"), tint: Palette.info)
                    }
                }
                Text(row.fields.isEmpty
                    ? String(localized: "staff.dt.noFields", defaultValue: "Без полей")
                    : row.fields.map(StaffDocText.field).joined(separator: ", "))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(2)
                Button {
                    editRetention(row)
                } label: {
                    Label(
                        row.retentionDays.map {
                            String(localized: "staff.dt.retention.value", defaultValue: "Хранение: \($0.formatted()) дн.")
                        } ?? String(localized: "staff.dt.retention.none", defaultValue: "Срок хранения не задан"),
                        systemImage: "clock.arrow.circlepath"
                    )
                    .font(Typography.meta.weight(.medium))
                }
                .buttonStyle(.borderless)
            }
            Spacer(minLength: Spacing.sm)
            Toggle(
                row.title,
                isOn: Binding(get: { row.enabled }, set: { on in Task { await update(row, enabled: on) } })
            )
            .labelsHidden()
        }
        .padding(.vertical, 2)
        .contextMenu {
            Button {
                editRetention(row)
            } label: {
                Label(String(localized: "staff.dt.retention", defaultValue: "Срок хранения, дней"), systemImage: "clock.arrow.circlepath")
            }
            Button(role: row.custom ? .destructive : nil) {
                removing = row
            } label: {
                if row.custom {
                    Label(String(localized: "staff.dt.delete", defaultValue: "Удалить"), systemImage: "trash")
                } else {
                    Label(String(localized: "staff.dt.reset", defaultValue: "Сбросить"), systemImage: "arrow.counterclockwise")
                }
            }
        }
        .swipeActions {
            Button(role: row.custom ? .destructive : nil) {
                removing = row
            } label: {
                if row.custom {
                    Label(String(localized: "staff.dt.delete", defaultValue: "Удалить"), systemImage: "trash")
                } else {
                    Label(String(localized: "staff.dt.reset", defaultValue: "Сбросить"), systemImage: "arrow.counterclockwise")
                }
            }
            .tint(row.custom ? Palette.destructive : Palette.warning)
        }
    }

    private static func symbol(_ category: String) -> String {
        switch category {
        case "PERSONAL": return "person.text.rectangle.fill"
        case "ACADEMIC": return "graduationcap.fill"
        case "CERTIFICATE": return "doc.text.fill"
        case "ISSUED_BY_UNIVERSITY": return "building.columns.fill"
        default: return "doc.fill"
        }
    }

    private static func tint(_ category: String) -> Color {
        switch category {
        case "PERSONAL": return TileTint.blue
        case "ACADEMIC": return TileTint.indigo
        case "CERTIFICATE": return TileTint.teal
        case "ISSUED_BY_UNIVERSITY": return TileTint.green
        default: return TileTint.gray
        }
    }

    /// Категории — в порядке справочника, внутри — по названию; неизвестная — в конец.
    private func grouped(_ types: [StaffDocumentType]) -> [(String, [StaffDocumentType])] {
        let order = StaffDocText.categories
        let keys = Set(types.map(\.category)).sorted { a, b in
            (order.firstIndex(of: a) ?? order.count) < (order.firstIndex(of: b) ?? order.count)
        }
        return keys.map { key in
            (key, types.filter { $0.category == key }.sorted { $0.title.localizedCompare($1.title) == .orderedAscending })
        }
    }

    private func editRetention(_ row: StaffDocumentType) {
        prompt = StaffTextPrompt(
            title: String(localized: "staff.dt.retention", defaultValue: "Срок хранения, дней"),
            message: String(localized: "staff.dt.retention.hint", defaultValue: "Пустое поле — срок не задан. До 36 500 дней."),
            placeholder: String(localized: "staff.dt.retention.placeholder", defaultValue: "Дней"),
            required: false,
            numeric: true,
            initial: row.retentionDays.map { String($0) } ?? ""
        ) { value in
            if value.isEmpty {
                try await api.updateDocumentType(row.typeId, clearRetention: true)
                return
            }
            guard let days = Int(value), (0...36_500).contains(days) else {
                throw StaffMessageError(message: String(localized: "staff.dt.retention.invalid", defaultValue: "Целое число дней от 0 до 36 500"))
            }
            try await api.updateDocumentType(row.typeId, retentionDays: days)
        }
    }

    @MainActor
    private func load() async {
        do {
            types = try await api.documentTypes()
            failure = nil
            isOffline = false
        } catch {
            if types == nil {
                failure = error.userMessage
                isOffline = error.isOffline
            } else {
                actionFailure = error.userMessage
            }
        }
    }

    @MainActor
    private func update(_ row: StaffDocumentType, enabled: Bool) async {
        do {
            try await api.updateDocumentType(row.typeId, enabled: enabled)
            await load()
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func remove(_ row: StaffDocumentType) async {
        do {
            try await api.deleteDocumentType(row.typeId)
            await load()
        } catch let error as APIError where error.code == .conflict {
            // Свой тип, которым уже пользуются, не удаляется — его выключают.
            actionFailure = String(localized: "staff.dt.inUse", defaultValue: "Этим типом уже пользуются — его можно только выключить")
        } catch {
            actionFailure = error.userMessage
        }
    }
}

private struct StaffNewDocumentTypeSheet: View {
    let created: () async -> Void

    @State private var code = ""
    @State private var label = ""
    @State private var category = "PERSONAL"
    @State private var fields: Set<String> = []
    @State private var retention = ""

    private let api = StaffAPI()

    var body: some View {
        FormSheet(
            title: String(localized: "staff.dt.new", defaultValue: "Свой тип документа"),
            canSave: isValid,
            save: {
                try await api.createDocumentType(
                    code: code.trimmingCharacters(in: .whitespaces).uppercased(),
                    category: category,
                    label: label.trimmingCharacters(in: .whitespaces),
                    fields: StaffDocText.fields.filter(fields.contains),
                    retentionDays: Int(retention)
                )
            },
            saved: created
        ) {
            Section {
                TextField(String(localized: "staff.dt.label", defaultValue: "Название"), text: $label)
                TextField("MY_DOCUMENT", text: $code)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
            } footer: {
                Text(String(localized: "staff.dt.code.hint", defaultValue: "Код — латинские заглавные буквы, цифры и «_», начинается с буквы."))
            }

            Section {
                Picker(String(localized: "staff.dt.category", defaultValue: "Категория"), selection: $category) {
                    ForEach(StaffDocText.categories, id: \.self) { Text(StaffDocText.category($0)).tag($0) }
                }
                TextField(String(localized: "staff.dt.retention", defaultValue: "Срок хранения, дней"), text: $retention)
                    .keyboardType(.numberPad)
            }

            Section {
                ForEach(StaffDocText.fields, id: \.self) { field in
                    Toggle(StaffDocText.field(field), isOn: Binding(
                        get: { fields.contains(field) },
                        set: { on in if on { fields.insert(field) } else { fields.remove(field) } }
                    ))
                }
            } header: {
                Text(String(localized: "staff.dt.fields", defaultValue: "Поля документа"))
            } footer: {
                Text(String(localized: "staff.dt.fields.hint", defaultValue: "Что человек заполняет при загрузке — не больше пяти."))
            }
        }
    }

    private var isValid: Bool {
        let upper = code.trimmingCharacters(in: .whitespaces).uppercased()
        let codeOK = upper.range(of: "^[A-Z][A-Z0-9_]{1,47}$", options: .regularExpression) != nil
        let labelOK = !label.trimmingCharacters(in: .whitespaces).isEmpty && label.count <= 120
        let retentionOK = retention.isEmpty || Int(retention).map { (0...36_500).contains($0) } == true
        return codeOK && labelOK && retentionOK
    }
}

// MARK: - Журнал документов

/// Кто, над чьим документом, что сделал, когда и через что. Документ — только тип и
/// категория: содержимого в ответе API нет (§15.2). Только чтение.
struct StaffDocumentJournalView: View {
    @State private var search = ""
    @State private var action: String?
    @State private var usePeriod = false
    @State private var from = Calendar.current.date(byAdding: .day, value: -30, to: Date()) ?? Date()
    @State private var to = Date()
    @State private var person: (id: String, name: String)?
    @State private var showsFilters = false
    @State private var loader: PagedLoader<StaffDocJournalItem>
    @State private var types: [String: StaffDocumentType] = [:]

    private let api = StaffAPI()

    init() {
        let api = StaffAPI()
        _loader = State(initialValue: PagedLoader(limit: 30) { request in
            try await api.documentJournal(search: "", action: nil, from: nil, to: nil, userID: nil, request)
        })
    }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: isFiltered
                    ? String(localized: "staff.dj.nothing", defaultValue: "Ничего не найдено")
                    : String(localized: "staff.dj.empty", defaultValue: "Записей пока нет"),
                symbol: "scroll",
                hint: isFiltered ? nil : String(
                    localized: "staff.dj.empty.hint",
                    defaultValue: "Каждое действие с документом — загрузка, просмотр по доступу, проверка по запросу — появляется здесь"
                ),
                actionTitle: isFiltered ? String(localized: "staff.dj.reset", defaultValue: "Сбросить фильтры") : nil,
                action: isFiltered ? { reset() } : nil
            ),
            header: {
                if let person {
                    Section {
                        HStack {
                            Label(String(localized: "staff.dj.person", defaultValue: "Человек: \(person.name)"), systemImage: "person")
                                .font(Typography.meta)
                            Spacer()
                            Button {
                                self.person = nil
                                apply()
                            } label: {
                                Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.mutedForeground)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(Text(String(localized: "staff.dj.person.clear", defaultValue: "Убрать фильтр по человеку")))
                        }
                    }
                }
            },
            row: { item in
                journalRow(item)
            }
        )
        .navigationTitle(Text(StaffScreen.documentJournal.title))
        .adminPinnedSearch($search, prompt: String(localized: "staff.dj.search", defaultValue: "ФИО сотрудника или владельца")) { _ in
            apply()
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showsFilters = true
                } label: {
                    Image(systemName: isFiltered ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                }
                .accessibilityLabel(Text(String(localized: "staff.dj.filters", defaultValue: "Фильтры")))
            }
        }
        .sheet(isPresented: $showsFilters) {
            filtersSheet
        }
        .task {
            if types.isEmpty {
                let list = (try? await api.effectiveDocumentTypes()) ?? []
                types = Dictionary(list.map { ($0.typeId, $0) }, uniquingKeysWith: { first, _ in first })
            }
        }
    }

    private var isFiltered: Bool {
        !search.trimmingCharacters(in: .whitespaces).isEmpty || action != nil || usePeriod || person != nil
    }

    private var filtersSheet: some View {
        NavigationStack {
            Form {
                Section {
                    Picker(String(localized: "staff.dj.action", defaultValue: "Действие"), selection: $action) {
                        Text(String(localized: "staff.dj.action.all", defaultValue: "Все действия")).tag(String?.none)
                        ForEach(StaffDocText.journalActions, id: \.self) { Text(StaffDocText.action($0)).tag(String?.some($0)) }
                    }
                }
                Section {
                    Toggle(String(localized: "staff.dj.period", defaultValue: "Период"), isOn: $usePeriod)
                    if usePeriod {
                        DatePicker(String(localized: "staff.dj.from", defaultValue: "С"), selection: $from, displayedComponents: .date)
                        DatePicker(String(localized: "staff.dj.to", defaultValue: "По"), selection: $to, in: from..., displayedComponents: .date)
                    }
                }
                if isFiltered {
                    Section {
                        Button(String(localized: "staff.dj.reset", defaultValue: "Сбросить фильтры"), role: .destructive) {
                            reset()
                            showsFilters = false
                        }
                    }
                }
            }
            .navigationTitle(Text(String(localized: "staff.dj.filters", defaultValue: "Фильтры")))
            .navigationBarTitleDisplayMode(.inline)
            .softTopEdge()
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "staff.dj.apply", defaultValue: "Готово")) {
                        apply()
                        showsFilters = false
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func journalRow(_ item: StaffDocJournalItem) -> some View {
        let actor = displayName(item.actor.name)
        let owner = displayName(item.owner.name)
        let actorLine = [actor, StaffRoleText.title(item.actor.role)].compactMap { $0 }.joined(separator: " · ")
        return TelegramStyleRow(
            title: StaffDocText.action(item.action),
            subtitle: "\(documentLine(item))\n\(actorLine) → \(owner)",
            meta: DisplayFormat.dateTime(item.createdAt)
        ) {
            RowSymbol(symbol: Self.actionSymbol(item.action), tint: Self.actionTint(item.action), size: 40)
        } accessory: {
            Text(viaLabel(item))
                .font(.caption)
                .foregroundStyle(Palette.mutedForeground)
                .lineLimit(1)
        }
        // Сузить журнал до человека — и как действующего, и как владельца.
        .contextMenu {
            Button {
                person = (item.actor.id, actor)
                apply()
            } label: {
                Label(String(localized: "staff.dj.filterActor", defaultValue: "Только \(actor)"), systemImage: "person.badge.key")
            }
            if item.owner.id != item.actor.id {
                Button {
                    person = (item.owner.id, owner)
                    apply()
                } label: {
                    Label(String(localized: "staff.dj.filterOwner", defaultValue: "Только \(owner)"), systemImage: "person")
                }
            }
            Button {
                AdminNav.push(.profile(id: item.owner.id))
            } label: {
                Label(String(localized: "staff.dj.ownerProfile", defaultValue: "Профиль владельца"), systemImage: "person.crop.circle")
            }
        }
        .swipeActions(edge: .leading) {
            Button {
                person = (item.actor.id, actor)
                apply()
            } label: {
                Label(String(localized: "staff.dj.filterShort", defaultValue: "Фильтр"), systemImage: "line.3.horizontal.decrease")
            }
            .tint(Palette.primary)
        }
    }

    private func displayName(_ name: String?) -> String {
        (name?.isEmpty == false ? name : nil) ?? String(localized: "staff.dj.unknownActor", defaultValue: "Неизвестный пользователь")
    }

    private static func actionSymbol(_ action: String) -> String {
        switch action {
        case "UPLOAD", "PAGE_ADD": return "arrow.up.doc.fill"
        case "VIEW": return "eye.fill"
        case "DOWNLOAD": return "arrow.down.doc.fill"
        case "EDIT", "REPLACE": return "pencil"
        case "GRANT": return "key.fill"
        case "REVOKE": return "key.slash"
        case "ACCEPT": return "checkmark"
        case "REJECT": return "xmark"
        case "ARCHIVE", "UNARCHIVE": return "archivebox.fill"
        case "DELETE", "PAGE_REMOVE": return "trash.fill"
        case "EXPIRING", "EXPIRE": return "clock.badge.exclamationmark.fill"
        default: return "doc.fill"
        }
    }

    private static func actionTint(_ action: String) -> Color {
        switch action {
        case "UPLOAD", "PAGE_ADD", "ACCEPT": return TileTint.green
        case "VIEW", "DOWNLOAD": return TileTint.blue
        case "EDIT", "REPLACE", "SUBMIT", "REVIEW": return TileTint.indigo
        case "GRANT", "REVOKE": return TileTint.purple
        case "REJECT", "DELETE", "PAGE_REMOVE", "EXPIRE": return TileTint.red
        case "EXPIRING": return TileTint.orange
        default: return TileTint.gray
        }
    }

    private func documentLine(_ item: StaffDocJournalItem) -> String {
        let type = item.document.type.map { types[$0]?.title ?? StaffDocText.typeTitle($0) } ?? "—"
        let category = item.document.category.map(StaffDocText.category) ?? ""
        if item.document.deleted == true {
            return "\(type) · " + String(localized: "staff.dj.deleted", defaultValue: "\(category) · удалён")
        }
        return [type, category].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private func viaLabel(_ item: StaffDocJournalItem) -> String {
        if item.via == "REQUEST" {
            if let request = item.request {
                return String(localized: "staff.dj.via.requestNamed", defaultValue: "Запрос «\(request.title)»")
            }
            return String(localized: "staff.dj.via.request", defaultValue: "Запрос университета")
        }
        switch item.granteeType {
        case "UNIVERSITY": return String(localized: "staff.dj.via.grantUniversity", defaultValue: "Доступ: университет")
        case "DEPARTMENT": return String(localized: "staff.dj.via.grantDepartment", defaultValue: "Доступ: деканат")
        case "USER": return String(localized: "staff.dj.via.grantUser", defaultValue: "Доступ: лично")
        default: break
        }
        switch item.via {
        case "OWNER": return String(localized: "staff.dj.via.owner", defaultValue: "Владелец")
        case "GRANT": return String(localized: "staff.dj.via.grant", defaultValue: "Доступ владельца")
        case "APPLICATION": return String(localized: "staff.dj.via.application", defaultValue: "Заявка")
        case "PLATFORM": return String(localized: "staff.dj.via.platform", defaultValue: "Спец-режим платформы")
        case "SYSTEM": return String(localized: "staff.dj.via.system", defaultValue: "Автоматически")
        case "STAFF": return String(localized: "staff.dj.via.staff", defaultValue: "Сотрудник вуза")
        default: return item.via ?? "—"
        }
    }

    private func reset() {
        search = ""
        action = nil
        usePeriod = false
        person = nil
        apply()
    }

    /// Период — локальные сутки: «по 20.10» значит включая весь день 20-го.
    private func apply() {
        let calendar = Calendar.current
        let needle = search
        let action = action
        let fromDate = usePeriod ? calendar.startOfDay(for: from) : nil
        let toDate = usePeriod
            ? calendar.date(byAdding: DateComponents(day: 1, second: -1), to: calendar.startOfDay(for: to))
            : nil
        let userID = person?.id
        Task {
            await loader.replace { request in
                try await api.documentJournal(search: needle, action: action, from: fromDate, to: toDate, userID: userID, request)
            }
        }
    }
}
