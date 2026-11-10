import SwiftUI

// Каталог услуг вуза (веб — `ServiceCatalogView`): у админа вуза — свои услуги и шаблоны
// платформы, которые можно «настроить» (вуз получает копию), у админа платформы — сами
// шаблоны. Редактор — три раздела (основное, документы, поля анкеты) и переключатель языка.

/// Язык тройки полей `…Ru/…Kk/…En`.
enum StaffLang: String, CaseIterable, Identifiable {
    case ru = "RU", kk = "KK", en = "EN"

    var id: String { rawValue }
}

// MARK: - Список

struct StaffServiceCatalogView: View {
    @Environment(\.viewerRole) private var role
    @State private var search = ""
    @State private var loader: PagedLoader<StaffManagedServiceRow>
    @State private var editing: StaffServiceEditing?
    @State private var actionFailure: String?
    @State private var customizing: String?

    private let api = StaffAPI()

    init() {
        let api = StaffAPI()
        _loader = State(initialValue: PagedLoader(limit: 20) { request in
            try await api.managedServices(search: "", request)
        })
    }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: String(localized: "staff.svc.empty", defaultValue: "Услуг пока нет"),
                symbol: "square.grid.2x2",
                hint: String(localized: "staff.svc.empty.hint", defaultValue: "Добавьте первую услугу — студенты увидят её в каталоге заявок"),
                actionTitle: String(localized: "staff.svc.add", defaultValue: "Добавить услугу"),
                action: { editing = .new }
            ),
            header: {
                Section {
                } footer: {
                    Text(isUniAdmin
                        ? String(localized: "staff.svc.subtitle.university", defaultValue: "Услуги вашего вуза и шаблоны платформы. Шаблон можно настроить под себя — студенты увидят вашу копию.")
                        : String(localized: "staff.svc.subtitle.platform", defaultValue: "Шаблоны услуг для всех вузов платформы."))
                }
            },
            row: { row in
                Button {
                    open(row)
                } label: {
                    StaffServiceRowView(row: row, isUniAdmin: isUniAdmin)
                }
                .buttonStyle(.plain)
                .swipeActions(edge: .leading) {
                    if isUniAdmin, row.isTemplate, !row.isReplaced {
                        Button {
                            Task { await customize(row.id) }
                        } label: {
                            Label(String(localized: "staff.svc.customize", defaultValue: "Настроить"), systemImage: "slider.horizontal.3")
                        }
                        .tint(Palette.primary)
                    }
                }
                .contextMenu {
                    if isUniAdmin, row.isTemplate, !row.isReplaced {
                        Button {
                            Task { await customize(row.id) }
                        } label: {
                            Label(String(localized: "staff.svc.customize", defaultValue: "Настроить"), systemImage: "slider.horizontal.3")
                        }
                    }
                }
            }
        )
        .navigationTitle(Text(StaffScreen.serviceCatalog.title))
        .debouncedSearch($search, prompt: String(localized: "staff.svc.search", defaultValue: "Название или код")) { value in
            await loader.replace { request in try await api.managedServices(search: value, request) }
        }
        .floatingAction(String(localized: "staff.svc.add", defaultValue: "Добавить услугу")) {
            editing = .new
        }
        .sheet(item: $editing) { editing in
            StaffServiceEditorSheet(editing: editing, isUniAdmin: isUniAdmin) {
                await loader.reload()
            } openCopy: { id in
                self.editing = .existing(id)
            }
        }
        .overlay {
            if customizing != nil {
                ProgressView()
                    .padding(Spacing.xl)
                    .glassSurface(interactive: false, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
            }
        }
        .actionFailureAlert($actionFailure)
    }

    private var isUniAdmin: Bool { role == .universityAdmin }

    private func open(_ row: StaffManagedServiceRow) {
        // Шаблон, уже настроенный вузом, открывается своей копией: правят её.
        if isUniAdmin, row.isReplaced, let copy = row.customizedId {
            editing = .existing(copy)
        } else {
            editing = .existing(row.id)
        }
    }

    @MainActor
    private func customize(_ id: String) async {
        customizing = id
        defer { customizing = nil }
        do {
            let copy = try await api.customizeService(id: id)
            await loader.reload()
            editing = .existing(copy)
        } catch {
            actionFailure = error.userMessage
        }
    }
}

enum StaffServiceEditing: Identifiable, Hashable {
    case new
    case existing(String)

    var id: String {
        switch self {
        case .new: return "new"
        case .existing(let id): return id
        }
    }
}

private struct StaffServiceRowView: View {
    let row: StaffManagedServiceRow
    let isUniAdmin: Bool

    var body: some View {
        TelegramStyleRow(
            title: row.name.isEmpty ? row.code : row.name,
            subtitle: subtitle,
            meta: row.slaHours.map { String(localized: "staff.svc.slaValue", defaultValue: "\($0.formatted()) ч") }
        ) {
            RowSymbol(
                symbol: isUniAdmin && row.isTemplate ? "doc.on.doc.fill" : "square.grid.2x2.fill",
                tint: !row.active || row.isReplaced ? TileTint.gray : (isUniAdmin && row.isTemplate ? TileTint.teal : TileTint.blue)
            )
        } accessory: {
            status
        }
        .opacity(!row.active || row.isReplaced ? 0.6 : 1)
        .contentShape(Rectangle())
    }

    private var subtitle: String {
        let head = [
            isUniAdmin && row.isTemplate ? String(localized: "staff.svc.template", defaultValue: "Шаблон") : nil,
            row.code,
            row.category?.name,
        ].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        let counts = String(
            localized: "staff.svc.content",
            defaultValue: "Документов: \((row.requirementsCount ?? 0).formatted()) · полей: \((row.formFieldsCount ?? 0).formatted())"
        )
        return [head, counts].joined(separator: "\n")
    }

    @ViewBuilder
    private var status: some View {
        if row.isReplaced {
            StatusBadge(text: String(localized: "staff.svc.replaced", defaultValue: "Заменён копией"), tint: Palette.mutedForeground)
        } else if !row.active {
            StatusBadge(text: String(localized: "staff.svc.inactive", defaultValue: "Выключена"), tint: Palette.mutedForeground)
        }
    }
}

// MARK: - Редактор

private enum StaffServiceSection: String, CaseIterable, Identifiable {
    case main, documents, fields

    var id: String { rawValue }

    var title: String {
        switch self {
        case .main: return String(localized: "staff.svc.section.main", defaultValue: "Основное")
        case .documents: return String(localized: "staff.svc.section.documents", defaultValue: "Документы")
        case .fields: return String(localized: "staff.svc.section.fields", defaultValue: "Анкета")
        }
    }
}

private struct StaffServiceEditorSheet: View {
    let editing: StaffServiceEditing
    let isUniAdmin: Bool
    let saved: () async -> Void
    let openCopy: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var draft = StaffServiceDraft.empty()
    @State private var detail: StaffServiceDetail?
    @State private var loaded = false
    @State private var loadFailure: String?
    @State private var isOffline = false
    @State private var failure: String?
    @State private var isSaving = false
    @State private var section: StaffServiceSection = .main
    @State private var lang: StaffLang = .ru
    @State private var categories: [StaffManageCategory] = []
    @State private var documentTypes: [StaffDocumentType] = []

    private let api = StaffAPI()

    var body: some View {
        NavigationStack {
            Group {
                if loaded {
                    form
                } else if let loadFailure {
                    ErrorStateView(message: loadFailure, isOffline: isOffline) { await load() }
                } else {
                    LoadingStateView()
                }
            }
            .navigationTitle(Text(title))
            .navigationBarTitleDisplayMode(.inline)
            .softTopEdge()
            .interactiveDismissDisabled(isSaving)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else if readOnly {
                        if detail?.isTemplate == true, isUniAdmin {
                            Button(String(localized: "staff.svc.customize", defaultValue: "Настроить")) {
                                Task { await customize() }
                            }
                        }
                    } else {
                        Button(String(localized: "common.save", defaultValue: "Сохранить")) {
                            Task { await save() }
                        }
                        .disabled(!loaded)
                    }
                }
            }
            .task { await load() }
        }
    }

    private var title: String {
        if case .new = editing { return String(localized: "staff.svc.new", defaultValue: "Новая услуга") }
        let name = StaffLocale.pick(draft.nameRu, draft.nameKk, draft.nameEn)
        return name.isEmpty ? draft.code : name
    }

    /// Шаблон платформы у админа вуза — только для просмотра.
    private var readOnly: Bool { detail.map { !$0.editable } ?? false }

    private var form: some View {
        Form {
            if let failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }
            if readOnly {
                Section {
                    Label(
                        String(localized: "staff.svc.readOnly", defaultValue: "Это шаблон платформы — его правит только платформа. Нажмите «Настроить», чтобы получить свою копию."),
                        systemImage: "info.circle"
                    )
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                }
            }
            Section {
                Picker(String(localized: "staff.svc.sections", defaultValue: "Раздел"), selection: $section) {
                    ForEach(StaffServiceSection.allCases) { item in
                        Text(sectionTitle(item)).tag(item)
                    }
                }
                .pickerStyle(.segmented)
                Picker(String(localized: "staff.svc.language", defaultValue: "Язык"), selection: $lang) {
                    ForEach(StaffLang.allCases) { Text(verbatim: $0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())

            Group {
                switch section {
                case .main: mainSection
                case .documents: documentsSection
                case .fields: fieldsSection
                }
            }
            .disabled(readOnly)
        }
    }

    private func sectionTitle(_ item: StaffServiceSection) -> String {
        switch item {
        case .main: return item.title
        case .documents: return "\(item.title) (\(draft.requirements.count.formatted()))"
        case .fields: return "\(item.title) (\(draft.formFields.count.formatted()))"
        }
    }

    // MARK: Основное

    @ViewBuilder
    private var mainSection: some View {
        Section {
            TextField(String(localized: "staff.svc.name", defaultValue: "Название"), text: localized(\.nameRu, \.nameKk, \.nameEn))
            Picker(String(localized: "staff.svc.category", defaultValue: "Категория"), selection: $draft.categoryId) {
                Text(String(localized: "staff.svc.category.pick", defaultValue: "Выберите")).tag("")
                ForEach(categories) { Text($0.name).tag($0.id) }
            }
        }

        Section {
            TextField("dorm-certificate", text: $draft.code)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .disabled(isExisting)
        } header: {
            Text(String(localized: "staff.svc.code", defaultValue: "Код"))
        } footer: {
            Text(String(localized: "staff.svc.code.hint", defaultValue: "Латиница, цифры и дефис. После создания не меняется."))
        }

        Section {
            Stepper(value: $draft.slaHours, in: 1...(24 * 90)) {
                StaffValueRow(
                    title: String(localized: "staff.svc.sla", defaultValue: "Срок обработки"),
                    value: String(localized: "staff.svc.slaValue", defaultValue: "\(draft.slaHours.formatted()) ч")
                )
            }
            TextField(
                String(localized: "staff.svc.sla", defaultValue: "Срок обработки"),
                value: $draft.slaHours,
                format: .number
            )
            .keyboardType(.numberPad)
        } footer: {
            Text(String(localized: "staff.svc.sla.hint", defaultValue: "В часах, до 90 дней. По нему считается срок заявки."))
        }

        Section(String(localized: "staff.svc.description", defaultValue: "Описание")) {
            TextField(
                String(localized: "staff.svc.description", defaultValue: "Описание"),
                text: optionalLocalized(\.descriptionRu, \.descriptionKk, \.descriptionEn),
                axis: .vertical
            )
            .lineLimit(3...8)
        }

        Section(String(localized: "staff.svc.instructions", defaultValue: "Инструкция для студента")) {
            TextField(
                String(localized: "staff.svc.instructions.placeholder", defaultValue: "Что приготовить, куда прийти за оригиналом"),
                text: optionalLocalized(\.instructionsRu, \.instructionsKk, \.instructionsEn),
                axis: .vertical
            )
            .lineLimit(3...8)
        }

        Section {
            Toggle(String(localized: "staff.svc.delivery.electronic", defaultValue: "Электронная версия"), isOn: deliveryBinding("ELECTRONIC"))
            Toggle(String(localized: "staff.svc.delivery.paper", defaultValue: "Бумажный оригинал"), isOn: deliveryBinding("PAPER"))
            Toggle(String(localized: "staff.svc.requiresPickup", defaultValue: "Нужна явка за оригиналом"), isOn: $draft.requiresPickup)
        } header: {
            Text(String(localized: "staff.svc.delivery", defaultValue: "Выдача результата"))
        } footer: {
            Text(String(localized: "staff.svc.delivery.hint", defaultValue: "Хотя бы один способ: из них студент выбирает при подаче."))
        }

        Section {
            Toggle(isOn: $draft.facultyScoped) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(String(localized: "staff.svc.facultyScoped", defaultValue: "Ведёт деканат факультета"))
                    Text(String(localized: "staff.svc.facultyScoped.hint", defaultValue: "Выключено — заявки идут на уровень вуза"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
            }
            Toggle(isOn: $draft.active) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(String(localized: "staff.svc.activeToggle", defaultValue: "Услуга доступна студентам"))
                    Text(String(localized: "staff.svc.activeToggle.hint", defaultValue: "Выключенная пропадает из каталога, поданные заявки остаются"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
            }
        } header: {
            Text(String(localized: "staff.svc.processing", defaultValue: "Обработка"))
        }
    }

    // MARK: Документы

    @ViewBuilder
    private var documentsSection: some View {
        Section {
            if draft.requirements.isEmpty {
                Text(String(localized: "staff.svc.requirements.empty", defaultValue: "Документы не нужны — студент подаёт заявку без вложений"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            }
            ForEach($draft.requirements) { $requirement in
                NavigationLink {
                    StaffRequirementEditor(requirement: $requirement, lang: lang, types: documentTypes, readOnly: readOnly)
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(langValue(requirement.titleRu, requirement.titleKk, requirement.titleEn).ifEmpty(String(localized: "staff.svc.untitled", defaultValue: "Без названия")))
                            .foregroundStyle(Palette.foreground)
                        Text([
                            requirement.required
                                ? String(localized: "staff.svc.required", defaultValue: "Обязательный")
                                : String(localized: "staff.svc.optional", defaultValue: "Необязательный"),
                            requirement.documentType.map(StaffDocText.typeTitle),
                        ].compactMap { $0 }.joined(separator: " · "))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                }
            }
            .onDelete { draft.requirements.remove(atOffsets: $0) }
            .onMove { draft.requirements.move(fromOffsets: $0, toOffset: $1) }
            Button {
                draft.requirements.append(.empty())
            } label: {
                Label(String(localized: "staff.svc.addRequirement", defaultValue: "Добавить документ"), systemImage: "plus")
            }
        } footer: {
            Text(String(localized: "staff.svc.requirements.hint", defaultValue: "Смахните строку влево, чтобы убрать документ. Убранный выключается, а не удаляется: к нему могут быть привязаны поданные заявки."))
        }
    }

    // MARK: Поля анкеты

    @ViewBuilder
    private var fieldsSection: some View {
        Section {
            if draft.formFields.isEmpty {
                Text(String(localized: "staff.svc.fields.empty", defaultValue: "Анкеты нет — студенту нечего заполнять"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            }
            ForEach($draft.formFields) { $field in
                NavigationLink {
                    StaffFormFieldEditor(field: $field, lang: lang, readOnly: readOnly)
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(langValue(field.labelRu, field.labelKk, field.labelEn).ifEmpty(String(localized: "staff.svc.untitled", defaultValue: "Без названия")))
                            .foregroundStyle(Palette.foreground)
                        Text([
                            StaffFieldTypeText.title(field.type),
                            field.required ? String(localized: "staff.svc.required", defaultValue: "Обязательный") : nil,
                        ].compactMap { $0 }.joined(separator: " · "))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                }
            }
            .onDelete { draft.formFields.remove(atOffsets: $0) }
            .onMove { draft.formFields.move(fromOffsets: $0, toOffset: $1) }
            Button {
                draft.formFields.append(.empty())
            } label: {
                Label(String(localized: "staff.svc.addField", defaultValue: "Добавить вопрос"), systemImage: "plus")
            }
        }
    }

    // MARK: Привязки

    private var isExisting: Bool {
        if case .existing = editing { return true }
        return false
    }

    private func langValue(_ ru: String, _ kk: String, _ en: String) -> String {
        switch lang {
        case .ru: return ru
        case .kk: return kk
        case .en: return en
        }
    }

    private func localized(
        _ ru: WritableKeyPath<StaffServiceDraft, String>,
        _ kk: WritableKeyPath<StaffServiceDraft, String>,
        _ en: WritableKeyPath<StaffServiceDraft, String>
    ) -> Binding<String> {
        let path: WritableKeyPath<StaffServiceDraft, String>
        switch lang {
        case .ru: path = ru
        case .kk: path = kk
        case .en: path = en
        }
        return $draft[dynamicMember: path]
    }

    private func optionalLocalized(
        _ ru: WritableKeyPath<StaffServiceDraft, String?>,
        _ kk: WritableKeyPath<StaffServiceDraft, String?>,
        _ en: WritableKeyPath<StaffServiceDraft, String?>
    ) -> Binding<String> {
        let path: WritableKeyPath<StaffServiceDraft, String?>
        switch lang {
        case .ru: path = ru
        case .kk: path = kk
        case .en: path = en
        }
        return Binding(
            get: { draft[keyPath: path] ?? "" },
            set: { draft[keyPath: path] = $0.isEmpty ? nil : $0 }
        )
    }

    private func deliveryBinding(_ mode: String) -> Binding<Bool> {
        Binding(
            get: { draft.deliveryModes.contains(mode) },
            set: { on in
                if on, !draft.deliveryModes.contains(mode) {
                    draft.deliveryModes.append(mode)
                } else if !on {
                    draft.deliveryModes.removeAll { $0 == mode }
                }
            }
        )
    }

    // MARK: Проверка

    /// Что не так в форме — до запроса. Поля трёх языков показываются по одному, поэтому
    /// ошибка в скрытом языке названа явно: иначе «Сохранить» выглядит сломанной.
    private func problem() -> String? {
        let missingName = [draft.nameRu, draft.nameKk, draft.nameEn].contains { $0.trimmingCharacters(in: .whitespaces).isEmpty }
        if missingName {
            return String(localized: "staff.svc.problem.name", defaultValue: "Заполните название на всех трёх языках (RU, KK, EN)")
        }
        if draft.categoryId.isEmpty {
            return String(localized: "staff.svc.problem.category", defaultValue: "Выберите категорию")
        }
        let code = draft.code.trimmingCharacters(in: .whitespaces).lowercased()
        if code.range(of: "^[a-z0-9][a-z0-9-]{1,59}$", options: .regularExpression) == nil {
            return String(localized: "staff.svc.problem.code", defaultValue: "Код: латиница, цифры и дефис, от 2 до 60 символов")
        }
        if !(1...(24 * 90)).contains(draft.slaHours) {
            return String(localized: "staff.svc.problem.sla", defaultValue: "Срок обработки — от 1 часа до 90 дней")
        }
        if draft.deliveryModes.isEmpty {
            return String(localized: "staff.svc.problem.delivery", defaultValue: "Выберите хотя бы один способ выдачи")
        }
        if draft.requirements.contains(where: { [$0.titleRu, $0.titleKk, $0.titleEn].contains { $0.trimmingCharacters(in: .whitespaces).isEmpty } }) {
            return String(localized: "staff.svc.problem.requirement", defaultValue: "У каждого документа нужно название на всех трёх языках")
        }
        if draft.formFields.contains(where: { [$0.labelRu, $0.labelKk, $0.labelEn].contains { $0.trimmingCharacters(in: .whitespaces).isEmpty } }) {
            return String(localized: "staff.svc.problem.field", defaultValue: "У каждого вопроса нужна подпись на всех трёх языках")
        }
        if draft.formFields.contains(where: { $0.isChoice && ($0.options ?? []).isEmpty }) {
            return String(localized: "staff.svc.problem.options", defaultValue: "У вопроса с выбором должен быть хотя бы один вариант ответа")
        }
        return nil
    }

    // MARK: Загрузка и сохранение

    @MainActor
    private func load() async {
        do {
            async let categoryList = api.manageCategories()
            async let typeList = api.effectiveDocumentTypes()
            if case .existing(let id) = editing {
                let loadedDetail = try await api.managedService(id: id)
                detail = loadedDetail
                draft = loadedDetail.draft
            }
            categories = try await categoryList
            documentTypes = ((try? await typeList) ?? []).filter(\.enabled)
            loaded = true
            loadFailure = nil
            isOffline = false
        } catch {
            loadFailure = error.userMessage
            isOffline = error.isOffline
        }
    }

    @MainActor
    private func save() async {
        if let problem = problem() {
            failure = problem
            return
        }
        isSaving = true
        defer { isSaving = false }
        var body = draft
        body.code = draft.code.trimmingCharacters(in: .whitespaces).lowercased()
        // Варианты ответа нужны только полям выбора: тип поменяли — старые не храним.
        body.formFields = draft.formFields.map { field in
            var copy = field
            if !field.isChoice { copy.options = nil }
            return copy
        }
        do {
            if case .existing(let id) = editing {
                try await api.updateService(id: id, body)
            } else {
                try await api.createService(body)
            }
            await saved()
            dismiss()
        } catch {
            failure = error.userMessage
        }
    }

    @MainActor
    private func customize() async {
        guard let detail else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            let copy = try await api.customizeService(id: detail.id)
            await saved()
            dismiss()
            openCopy(copy)
        } catch {
            failure = error.userMessage
        }
    }
}

// MARK: - Документ услуги

private struct StaffRequirementEditor: View {
    @Binding var requirement: StaffServiceRequirement
    let lang: StaffLang
    let types: [StaffDocumentType]
    let readOnly: Bool

    var body: some View {
        Form {
            Section {
                TextField(String(localized: "staff.svc.requirement.title", defaultValue: "Название документа"), text: title)
                Toggle(String(localized: "staff.svc.required", defaultValue: "Обязательный"), isOn: $requirement.required)
            } header: {
                Text(verbatim: lang.rawValue)
            }

            Section {
                Picker(String(localized: "staff.svc.requirement.type", defaultValue: "Тип из «Документов»"), selection: documentType) {
                    Text(String(localized: "staff.svc.requirement.anyType", defaultValue: "Любой")).tag("")
                    ForEach(types) { Text($0.title).tag($0.typeId) }
                }
                Stepper(value: $requirement.maxFiles, in: 1...10) {
                    StaffValueRow(
                        title: String(localized: "staff.svc.requirement.maxFiles", defaultValue: "Файлов не больше"),
                        value: requirement.maxFiles.formatted()
                    )
                }
                Toggle(String(localized: "staff.svc.requirement.allowStorage", defaultValue: "Можно выбрать из своих документов"), isOn: $requirement.allowStorage)
                Toggle(String(localized: "staff.svc.requirement.allowUpload", defaultValue: "Можно загрузить файл"), isOn: $requirement.allowUpload)
            } footer: {
                Text(String(localized: "staff.svc.requirement.type.hint", defaultValue: "По типу студент выбирает документ из своего хранилища"))
            }

            Section(String(localized: "staff.svc.requirement.description", defaultValue: "Пояснение")) {
                TextField(
                    String(localized: "staff.svc.requirement.description", defaultValue: "Пояснение"),
                    text: Binding(get: { requirement.description ?? "" }, set: { requirement.description = $0.isEmpty ? nil : $0 }),
                    axis: .vertical
                )
                .lineLimit(2...6)
            }
        }
        .disabled(readOnly)
        .navigationTitle(Text(String(localized: "staff.svc.requirement", defaultValue: "Документ")))
        .navigationBarTitleDisplayMode(.inline)
    }

    private var title: Binding<String> {
        switch lang {
        case .ru: return $requirement.titleRu
        case .kk: return $requirement.titleKk
        case .en: return $requirement.titleEn
        }
    }

    private var documentType: Binding<String> {
        Binding(get: { requirement.documentType ?? "" }, set: { requirement.documentType = $0.isEmpty ? nil : $0 })
    }
}

// MARK: - Вопрос анкеты

enum StaffFieldTypeText {
    static let all = ["TEXT", "TEXTAREA", "NUMBER", "DATE", "SELECT", "RADIO", "CHECKBOX", "BOOLEAN"]

    static func title(_ raw: String) -> String {
        switch raw {
        case "TEXT": return String(localized: "staff.fieldType.text", defaultValue: "Строка")
        case "TEXTAREA": return String(localized: "staff.fieldType.textarea", defaultValue: "Абзац текста")
        case "NUMBER": return String(localized: "staff.fieldType.number", defaultValue: "Число")
        case "DATE": return String(localized: "staff.fieldType.date", defaultValue: "Дата")
        case "SELECT": return String(localized: "staff.fieldType.select", defaultValue: "Список")
        case "RADIO": return String(localized: "staff.fieldType.radio", defaultValue: "Один из вариантов")
        case "CHECKBOX": return String(localized: "staff.fieldType.checkbox", defaultValue: "Флажок")
        case "BOOLEAN": return String(localized: "staff.fieldType.boolean", defaultValue: "Да или нет")
        default: return raw
        }
    }
}

private struct StaffFormFieldEditor: View {
    @Binding var field: StaffServiceFormField
    let lang: StaffLang
    let readOnly: Bool

    var body: some View {
        Form {
            Section {
                TextField(String(localized: "staff.svc.field.label", defaultValue: "Вопрос"), text: label)
                TextField(String(localized: "staff.svc.field.placeholder", defaultValue: "Подсказка в поле"), text: placeholder)
            } header: {
                Text(verbatim: lang.rawValue)
            }

            Section {
                Picker(String(localized: "staff.svc.field.type", defaultValue: "Тип ответа"), selection: $field.type) {
                    ForEach(StaffFieldTypeText.all, id: \.self) { Text(StaffFieldTypeText.title($0)).tag($0) }
                }
                Toggle(String(localized: "staff.svc.field.required", defaultValue: "Обязательный ответ"), isOn: $field.required)
            }

            if field.isChoice {
                Section {
                    ForEach(Array((field.options ?? []).enumerated()), id: \.offset) { index, _ in
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            TextField(String(localized: "staff.svc.option.label", defaultValue: "Вариант"), text: optionLabel(index))
                            TextField(String(localized: "staff.svc.option.value", defaultValue: "Значение (латиницей)"), text: optionValue(index))
                                .font(Typography.meta.monospaced())
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                        }
                    }
                    .onDelete { offsets in
                        var options = field.options ?? []
                        options.remove(atOffsets: offsets)
                        field.options = options
                    }
                    Button {
                        var options = field.options ?? []
                        let value = "option-\((options.count + 1).formatted())"
                        options.append(StaffFieldOption(value: value, labelRu: "", labelKk: "", labelEn: ""))
                        field.options = options
                    } label: {
                        Label(String(localized: "staff.svc.option.add", defaultValue: "Добавить вариант"), systemImage: "plus")
                    }
                    .disabled((field.options ?? []).count >= 30)
                } header: {
                    Text(String(localized: "staff.svc.options", defaultValue: "Варианты ответа"))
                } footer: {
                    Text(String(localized: "staff.svc.options.hint", defaultValue: "Подписи — на всех трёх языках: переключите язык в редакторе услуги."))
                }
            }
        }
        .disabled(readOnly)
        .navigationTitle(Text(String(localized: "staff.svc.field", defaultValue: "Вопрос анкеты")))
        .navigationBarTitleDisplayMode(.inline)
    }

    private var label: Binding<String> {
        switch lang {
        case .ru: return $field.labelRu
        case .kk: return $field.labelKk
        case .en: return $field.labelEn
        }
    }

    private var placeholder: Binding<String> {
        let path: WritableKeyPath<StaffServiceFormField, String?>
        switch lang {
        case .ru: path = \.placeholderRu
        case .kk: path = \.placeholderKk
        case .en: path = \.placeholderEn
        }
        return Binding(get: { field[keyPath: path] ?? "" }, set: { field[keyPath: path] = $0.isEmpty ? nil : $0 })
    }

    private func optionLabel(_ index: Int) -> Binding<String> {
        let path: WritableKeyPath<StaffFieldOption, String>
        switch lang {
        case .ru: path = \.labelRu
        case .kk: path = \.labelKk
        case .en: path = \.labelEn
        }
        return Binding(
            get: { (field.options ?? []).indices.contains(index) ? field.options![index][keyPath: path] : "" },
            set: { value in
                guard var options = field.options, options.indices.contains(index) else { return }
                options[index][keyPath: path] = value
                field.options = options
            }
        )
    }

    private func optionValue(_ index: Int) -> Binding<String> {
        Binding(
            get: { (field.options ?? []).indices.contains(index) ? field.options![index].value : "" },
            set: { value in
                guard var options = field.options, options.indices.contains(index) else { return }
                options[index].value = value
                field.options = options
            }
        )
    }
}

extension String {
    /// Запасная подпись для пустой строки.
    fileprivate func ifEmpty(_ fallback: String) -> String {
        trimmingCharacters(in: .whitespaces).isEmpty ? fallback : self
    }
}
