import SwiftUI

// Заявки на услуги вуза: список с фильтром, каталог, анкета, карточка заявки с
// документами по требованиям, результатами, выдачей и историей (`/applications/[id]`).

// MARK: - Список

struct CommunityApplicationsList: View {
    @State private var status: String?
    @State private var showsCatalog = false
    @State private var loader = PagedLoader<CommunityApplicationDTO>(limit: 30) { request in
        try await CommunityAPI().applications(page: request, status: nil)
    }

    private var realtime: RealtimeCoordinator { AppServices.realtime }

    private static let filters: [String] = ["DRAFT", "SUBMITTED", "IN_REVIEW", "NEEDS_CORRECTION", "READY_FOR_PICKUP", "ISSUED", "REJECTED"]

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: String(localized: "applications.empty", defaultValue: "Заявок пока нет"),
                symbol: "doc.badge.plus"
            )
        ) {
            FilterChipsRow(
                options: [(nil, String(localized: "community.applications.all", defaultValue: "Все"))]
                    + Self.filters.map { (Optional($0), ApplicationStatus.title($0)) },
                selection: $status
            )
        } row: { application in
            NavigationLink(value: AppRoute.application(id: application.id)) {
                CommunityApplicationRow(application: application)
            }
        }
        .floatingAction(String(localized: "applications.new", defaultValue: "Заказать услугу"), symbol: "plus") {
            showsCatalog = true
        }
        .navigationDestination(isPresented: $showsCatalog) {
            CommunityServiceCatalog()
        }
        .navigationTitle(Text(String(localized: "more.applications", defaultValue: "Заявки")))
        .onChange(of: status) { _, next in
            Task { await loader.replace { try await CommunityAPI().applications(page: $0, status: next) } }
        }
        .onChange(of: realtime.applicationStatus) {
            Task { await loader.reload() }
        }
    }
}

/// Строка заявки как строка чата: значок по статусу, услуга, дата справа, номер
/// ниже и плашка статуса.
struct CommunityApplicationRow: View {
    let application: CommunityApplicationDTO

    var body: some View {
        TelegramStyleRow(
            title: application.serviceName,
            subtitle: application.number.map { "№ \($0)" } ?? String(localized: "applications.draft", defaultValue: "Черновик"),
            meta: DisplayFormat.date(application.submittedAt ?? application.createdAt)
        ) {
            RowSymbol(symbol: CommunityApplicationText.symbol(application.status), tint: CommunityApplicationText.tint(application.status))
        } accessory: {
            StatusBadge(text: ApplicationStatus.title(application.status), tint: CommunityApplicationText.tint(application.status))
        }
    }
}

enum CommunityApplicationText {
    static func symbol(_ status: String) -> String {
        switch status {
        case "DRAFT": return "doc.badge.ellipsis"
        case "NEEDS_CORRECTION": return "exclamationmark.triangle.fill"
        case "REJECTED", "CANCELLED": return "xmark"
        case "READY", "READY_FOR_PICKUP": return "tray.full.fill"
        case "ISSUED", "DELIVERED": return "checkmark"
        default: return "doc.text.fill"
        }
    }

    static func tint(_ status: String) -> Color {
        switch status {
        case "NEEDS_CORRECTION", "REJECTED": return Palette.destructive
        case "READY", "READY_FOR_PICKUP", "ISSUED", "DELIVERED": return Palette.success
        case "DRAFT", "CANCELLED": return Palette.mutedForeground
        default: return Palette.primary
        }
    }

    static func delivery(_ raw: String) -> String {
        switch raw {
        case "ELECTRONIC": return String(localized: "community.applications.electronic", defaultValue: "Электронно")
        case "PAPER": return String(localized: "community.applications.paper", defaultValue: "На бумаге")
        case "BOTH": return String(localized: "community.applications.both", defaultValue: "Электронно и на бумаге")
        default: return raw
        }
    }

    static func action(_ event: CommunityApplicationDTO.Event) -> String {
        if let to = event.toStatus { return ApplicationStatus.title(to) }
        switch event.action {
        case "CREATED": return String(localized: "community.applications.ev.created", defaultValue: "Черновик создан")
        case "FORM_UPDATED": return String(localized: "community.applications.ev.form", defaultValue: "Анкета изменена")
        case "ASSIGNED": return String(localized: "community.applications.ev.assigned", defaultValue: "Назначен исполнитель")
        case "DOCUMENT_ADDED": return String(localized: "community.applications.ev.docAdded", defaultValue: "Документ приложен")
        case "DOCUMENT_ACCEPTED": return String(localized: "community.applications.ev.docAccepted", defaultValue: "Документ принят")
        case "DOCUMENT_REJECTED": return String(localized: "community.applications.ev.docRejected", defaultValue: "Документ отклонён")
        case "RESULT_ADDED": return String(localized: "community.applications.ev.result", defaultValue: "Добавлен результат")
        case "RESULT_REVOKED": return String(localized: "community.applications.ev.resultRevoked", defaultValue: "Результат отозван")
        default: return ApplicationStatus.title(event.action)
        }
    }

    static func result(_ raw: String) -> String {
        switch raw {
        case "ELECTRONIC_DOCUMENT": return String(localized: "community.applications.res.electronic", defaultValue: "Электронный документ")
        case "PAPER_DOCUMENT": return String(localized: "community.applications.res.paper", defaultValue: "Бумажный документ")
        case "INFORMATION": return String(localized: "community.applications.res.info", defaultValue: "Ответ")
        default: return String(localized: "community.applications.res.other", defaultValue: "Результат")
        }
    }

    /// Ответ анкеты как текст: сервер хранит строки, числа и флажки.
    static func answer(_ value: JSONValue?, field: CommunityApplicationDTO.Service.Field?) -> String {
        guard let value, !value.isNull else { return "—" }
        if let bool = value.bool {
            return bool ? String(localized: "common.yes", defaultValue: "Да") : String(localized: "common.no", defaultValue: "Нет")
        }
        let raw = value.display
        if let field, let title = field.choices.first(where: { $0.value == raw })?.title { return title }
        if field?.type == "DATE", let date = value.date { return DisplayFormat.date(date) }
        return raw
    }
}

// MARK: - Каталог

struct CommunityServiceCatalog: View {
    @State private var search = ""

    var body: some View {
        RemoteContent {
            try await CommunityAPI().serviceCategories()
        } content: { categories in
            let needle = search.trimmingCharacters(in: .whitespaces).lowercased()
            let visible = categories.map { category in
                (category, category.services.filter { needle.isEmpty || $0.name.lowercased().contains(needle) })
            }.filter { !$0.1.isEmpty }
            List {
                ForEach(visible, id: \.0.id) { category, services in
                    Section {
                        ForEach(services) { service in
                            NavigationLink(value: AppRoute.service(id: service.id)) {
                                TelegramStyleRow(
                                    title: service.name,
                                    subtitle: service.details,
                                    meta: service.slaHours.flatMap { $0 > 0 ? CommunityApplicationText.days($0) : nil }
                                ) {
                                    IconTile(symbol: "doc.text.fill", tint: TileTint.blue, size: 36)
                                }
                            }
                        }
                    } header: {
                        Text(category.name)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .screenState(visible.isEmpty) {
                EmptyStateView(
                    title: needle.isEmpty
                        ? String(localized: "applications.noServices", defaultValue: "Вуз пока не завёл услуги")
                        : String(localized: "community.applications.noServiceFound", defaultValue: "Такой услуги нет"),
                    symbol: "square.grid.2x2"
                )
            }
        }
        .background(Palette.background)
        .searchable(
            text: $search,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: Text(String(localized: "community.applications.searchService", defaultValue: "Найти услугу"))
        )
        .navigationTitle(Text(String(localized: "applications.catalog", defaultValue: "Каталог услуг")))
        .navigationBarTitleDisplayMode(.inline)
    }
}

extension CommunityApplicationText {
    static func days(_ hours: Int) -> String {
        let days = max(1, Int((Double(hours) / 24).rounded(.up)))
        return String(localized: "community.applications.days", defaultValue: "\(days.formatted()) дн.")
    }
}

// MARK: - Анкета

/// Ответы анкеты: значения JSON по коду поля.
struct CommunityAnswersForm: View {
    let fields: [CommunityApplicationDTO.Service.Field]
    @Binding var values: [String: JSONValue]

    var body: some View {
        ForEach(fields.filter { $0.active != false }) { field in
            CommunityFieldEditor(field: field, value: Binding(
                get: { values[field.code] ?? .null },
                set: { values[field.code] = $0 }
            ))
        }
    }

    static func isComplete(_ fields: [CommunityApplicationDTO.Service.Field], _ values: [String: JSONValue]) -> Bool {
        fields.filter { $0.required == true && $0.active != false }.allSatisfy { field in
            guard let value = values[field.code], !value.isNull else { return false }
            if field.type == "CHECKBOX" { return value.bool == true }
            return !value.display.trimmingCharacters(in: .whitespaces).isEmpty
        }
    }
}

private struct CommunityFieldEditor: View {
    let field: CommunityApplicationDTO.Service.Field
    @Binding var value: JSONValue

    private var label: String { field.required == true ? "\(field.label) *" : field.label }
    private var text: Binding<String> {
        Binding(get: { value.isNull ? "" : value.display }, set: { value = $0.isEmpty ? .null : .string($0) })
    }

    var body: some View {
        switch field.type {
        case "SELECT", "RADIO":
            Picker(selection: text) {
                Text(verbatim: "—").tag("")
                ForEach(field.choices, id: \.value) { choice in Text(choice.title).tag(choice.value) }
            } label: {
                Text(label)
            }
        case "BOOLEAN", "CHECKBOX":
            Toggle(label, isOn: Binding(get: { value.bool ?? false }, set: { value = .bool($0) }))
        case "DATE":
            DatePicker(
                selection: Binding(
                    get: { value.date ?? Date() },
                    set: { value = .string(JSONCoding.isoString($0)) }
                ),
                displayedComponents: .date
            ) {
                Text(label)
            }
        case "NUMBER":
            HStack {
                Text(label)
                Spacer()
                TextField(text: Binding(
                    get: { value.isNull ? "" : value.display },
                    set: { value = Double($0.replacingOccurrences(of: ",", with: ".")).map(JSONValue.number) ?? ($0.isEmpty ? .null : .string($0)) }
                )) { Text(verbatim: "0") }
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
            }
        case "TEXTAREA":
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(label).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                TextField(text: text, axis: .vertical) { Text(verbatim: field.label) }
                    .lineLimit(3...8)
            }
        default:
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(label).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                TextField(text: text) { Text(verbatim: field.label) }
            }
        }
    }
}

/// Новая заявка: описание услуги, анкета, способ получения. Черновик заводится при
/// первом сохранении, а не при открытии экрана, — иначе каждый просмотр оставлял бы
/// пустой черновик.
struct CommunityApplicationForm: View {
    let serviceID: String

    @State private var service: CommunityApplicationDTO.Service?
    @State private var values: [String: JSONValue] = [:]
    @State private var delivery = ""
    /// Ошибка сохранения — над формой; ошибка загрузки услуги — на месте формы, с повтором.
    @State private var failure: String?
    @State private var loadFailure: String?
    @State private var isOffline = false
    @State private var isSaving = false
    @State private var created: String?

    private let api = CommunityAPI()

    var body: some View {
        Form {
            if let failure {
                FormAlert(message: failure)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }
            if let service {
                HeroHeader(
                    visual: .symbol("doc.text.fill", tint: TileTint.blue),
                    title: service.name,
                    subtitle: service.slaHours.flatMap { hours in
                        hours > 0 ? String(localized: "community.applications.sla", defaultValue: "Срок: \(CommunityApplicationText.days(hours))") : nil
                    }
                )
                if let details = service.details, !details.isEmpty {
                    Section {
                        Text(details)
                            .font(Typography.body)
                            .foregroundStyle(Palette.foreground)
                            .fixedSize(horizontal: false, vertical: true)
                    } header: {
                        Text(String(localized: "community.applications.aboutService", defaultValue: "Об услуге"))
                    }
                }

                if let fields = service.formFields, !fields.isEmpty {
                    Section {
                        CommunityAnswersForm(fields: fields, values: $values)
                    } header: {
                        Text(String(localized: "community.applications.form", defaultValue: "Анкета"))
                    }
                }

                if let modes = service.deliveryModes, modes.count > 1 {
                    Section {
                        Picker(String(localized: "community.applications.delivery", defaultValue: "Как получить"), selection: $delivery) {
                            ForEach(modes + ["BOTH"], id: \.self) { Text(CommunityApplicationText.delivery($0)).tag($0) }
                        }
                    }
                }

                if let requirements = service.requirements, !requirements.isEmpty {
                    Section {
                        ForEach(requirements) { requirement in
                            Label(requirement.required == true ? "\(requirement.title) *" : requirement.title, systemImage: "doc")
                        }
                    } header: {
                        Text(String(localized: "community.applications.requirements", defaultValue: "Понадобятся документы"))
                    } footer: {
                        Text(String(localized: "community.applications.requirements.hint", defaultValue: "Документы прикладываются на следующем шаге из раздела «Документы»."))
                    }
                }

                Section {
                    Button {
                        Task { await save() }
                    } label: {
                        HStack {
                            Text(hasRequirements(service)
                                ? String(localized: "community.applications.next", defaultValue: "Сохранить и приложить документы")
                                : String(localized: "applications.submit", defaultValue: "Подать заявку"))
                            if isSaving { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(isSaving || !CommunityAnswersForm.isComplete(service.formFields ?? [], values))
                } footer: {
                    if !CommunityAnswersForm.isComplete(service.formFields ?? [], values) {
                        Text(String(localized: "applications.fillRequired", defaultValue: "Заполните обязательные поля"))
                    }
                }
            }
        }
        .screenState(service == nil) {
            if let loadFailure {
                ErrorStateView(message: loadFailure, isOffline: isOffline) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "applications.new", defaultValue: "Заказать услугу")))
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $created) { id in
            CommunityApplicationDetail(applicationID: id)
        }
        .task { await load() }
    }

    private func hasRequirements(_ service: CommunityApplicationDTO.Service) -> Bool {
        !(service.requirements ?? []).isEmpty
    }

    @MainActor
    private func load() async {
        guard service == nil else { return }
        do {
            let loaded = try await api.service(id: serviceID)
            service = loaded
            delivery = loaded.deliveryModes?.first ?? ""
            loadFailure = nil
        } catch is CancellationError {
            return
        } catch {
            loadFailure = error.userMessage
            isOffline = error.isOffline
        }
    }

    @MainActor
    private func save() async {
        guard let service else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            let draft = try await api.createApplication(serviceID: serviceID)
            try await api.updateApplication(id: draft.id, formData: values, deliveryType: delivery.isEmpty ? nil : delivery)
            if !hasRequirements(service) {
                try await api.submitApplication(id: draft.id)
            }
            failure = nil
            created = draft.id
        } catch {
            failure = error.userMessage
        }
    }
}

// MARK: - Карточка

struct CommunityApplicationDetail: View {
    let applicationID: String

    @State private var application: CommunityApplicationDTO?
    @State private var failure: String?
    @State private var isOffline = false
    /// `nil` — свои документы ещё не пришли или не загрузились (`documentsFailure`).
    @State private var documents: [CommunityDocumentDTO]?
    @State private var documentsFailure: String?
    @State private var documentsOffline = false
    @State private var choosing: CommunityApplicationDTO.Service.Requirement?
    @State private var uploadType: String?
    @State private var uploading = false
    @State private var editingAnswers = false
    @State private var cancelling = false
    @State private var cancelReason = ""
    @State private var isBusy = false
    @State private var actionFailure: String?
    @State private var opener = RemoteFileOpener()
    @State private var detaching: CommunityApplicationDTO.Service.Requirement?

    private let api = CommunityAPI()
    private var realtime: RealtimeCoordinator { AppServices.realtime }

    var body: some View {
        Group {
            if let application {
                content(application)
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .background(Palette.background)
        .navigationTitle(Text(String(localized: "shell.application", defaultValue: "Заявка")))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .onChange(of: realtime.applicationStatus) {
            Task { await load() }
        }
        .remoteFilePreview(opener)
        .sheet(item: $choosing) { requirement in
            CommunityDocumentChooser(
                title: requirement.title,
                documents: documents?.filter { document in
                    (requirement.documentType == nil || document.type == requirement.documentType) && (document.fileCount ?? document.files?.count ?? 0) > 0
                },
                failure: documentsFailure,
                isOffline: documentsOffline,
                retry: { await loadDocuments() },
                onUpload: {
                    uploadType = requirement.documentType
                    uploading = true
                }
            ) { document in
                Task { await run { try await api.attachDocument(applicationID: applicationID, requirementID: requirement.id, documentID: document.id) } }
            }
        }
        .sheet(isPresented: $uploading, onDismiss: { Task { await load() } }) {
            CommunityDocumentUploadView(presetType: uploadType) { _ in }
        }
        .sheet(isPresented: $editingAnswers) {
            if let application {
                CommunityAnswersSheet(application: application) { await load() }
            }
        }
        .reasonPrompt(
            $cancelling,
            title: String(localized: "community.applications.cancel.title", defaultValue: "Отменить заявку?"),
            message: String(localized: "community.applications.cancel.message", defaultValue: "Причину увидит сотрудник. Её можно не указывать."),
            actionTitle: String(localized: "community.applications.cancel", defaultValue: "Отменить заявку"),
            text: $cancelReason
        ) {
            let reason = cancelReason.trimmingCharacters(in: .whitespacesAndNewlines)
            await run { try await api.cancelApplication(id: applicationID, reason: reason.isEmpty ? nil : reason) }
        }
        .confirmDestructive(
            $detaching,
            title: { String(localized: "community.applications.detach.title", defaultValue: "Убрать документ «\($0.title)» из заявки?") },
            actionTitle: String(localized: "community.requests.detach", defaultValue: "Отвязать")
        ) { requirement in
            await run { try await api.detachDocument(applicationID: applicationID, requirementID: requirement.id) }
        }
        .actionFailureAlert($actionFailure)
    }

    private var editable: Bool {
        guard let status = application?.status else { return false }
        return status == "DRAFT" || status == "NEEDS_CORRECTION"
    }

    private func content(_ application: CommunityApplicationDTO) -> some View {
        List {
            HeroHeader(
                visual: .symbol(CommunityApplicationText.symbol(application.status), tint: CommunityApplicationText.tint(application.status)),
                title: application.serviceName,
                subtitle: application.number.map { "№ \($0)" } ?? String(localized: "applications.draft", defaultValue: "Черновик"),
                actions: heroActions(application)
            ) {
                StatusBadge(text: ApplicationStatus.title(application.status), tint: CommunityApplicationText.tint(application.status))
            }

            Section {
                if let delivery = application.deliveryType {
                    DetailRow(title: String(localized: "community.applications.delivery", defaultValue: "Как получить"), value: CommunityApplicationText.delivery(delivery))
                }
                if let submitted = application.submittedAt {
                    DetailRow(title: String(localized: "community.applications.submittedAt", defaultValue: "Подана"), value: DisplayFormat.dateTime(submitted))
                }
                if let due = application.dueAt, ApplicationStatus.isOpen(application.status) {
                    DetailRow(title: String(localized: "community.applications.dueAt", defaultValue: "Ожидаемая готовность"), value: DisplayFormat.date(due))
                }
                if let reason = application.rejectionReason, !reason.isEmpty {
                    DetailRow(title: String(localized: "community.documents.rejection", defaultValue: "Причина отказа"), value: reason)
                }
            }

            if application.status == "NEEDS_CORRECTION" {
                Section {
                    Label(
                        String(localized: "community.applications.correction", defaultValue: "Сотрудник вернул заявку на исправление: проверьте анкету и документы, затем подайте снова."),
                        systemImage: "exclamationmark.triangle"
                    )
                    .font(Typography.body)
                    .foregroundStyle(Palette.warning)
                }
            }

            answers(application)
            requirements(application)
            results(application)
            pickup(application)
            timeline(application)
            actions(application)
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .refreshable { await load() }
    }

    @ViewBuilder
    private func answers(_ application: CommunityApplicationDTO) -> some View {
        let fields = application.service?.formFields ?? []
        let data = application.formData?.object ?? [:]
        if !fields.isEmpty || !data.isEmpty {
            Section {
                if fields.isEmpty {
                    ForEach(data.keys.sorted(), id: \.self) { key in
                        DetailRow(title: key, value: CommunityApplicationText.answer(data[key], field: nil))
                    }
                } else {
                    ForEach(fields) { field in
                        DetailRow(title: field.label, value: CommunityApplicationText.answer(data[field.code], field: field))
                    }
                }
            } header: {
                Text(String(localized: "community.applications.form", defaultValue: "Анкета"))
            }
        }
    }

    @ViewBuilder
    private func requirements(_ application: CommunityApplicationDTO) -> some View {
        let requirements = application.service?.requirements ?? []
        if !requirements.isEmpty {
            Section {
                ForEach(requirements) { requirement in
                    let attached = application.documents?.first { $0.requirementId == requirement.id }
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(requirement.required == true ? "\(requirement.title) *" : requirement.title)
                                .font(Typography.body)
                            Spacer(minLength: Spacing.md)
                            if let attached, let status = CommunityText.documentStatus(attached.status) {
                                StatusBadge(text: status.text, tint: status.tint)
                            }
                        }
                        if let attached {
                            Button {
                                Task {
                                    await opener.open(name: "\(attached.snapshotTitle ?? requirement.title).pdf") {
                                        try await api.applicationDocumentURL(applicationID: applicationID, rowID: attached.id, fileID: attached.files?.first?.id)
                                    }
                                }
                            } label: {
                                Label(attached.snapshotTitle ?? String(localized: "community.applications.attached", defaultValue: "Документ приложен"), systemImage: "doc.text")
                                    .font(Typography.meta)
                            }
                            .buttonStyle(.borderless)
                            if let comment = attached.reviewComment, !comment.isEmpty {
                                Text(comment).font(Typography.meta).foregroundStyle(Palette.destructive)
                            }
                        }
                        if editable {
                            HStack(spacing: Spacing.md) {
                                Button(attached == nil
                                    ? String(localized: "community.requests.attach", defaultValue: "Выбрать документ")
                                    : String(localized: "community.requests.replace", defaultValue: "Заменить")) {
                                    choosing = requirement
                                }
                                if attached != nil {
                                    Button(String(localized: "community.requests.detach", defaultValue: "Отвязать"), role: .destructive) {
                                        detaching = requirement
                                    }
                                }
                            }
                            .buttonStyle(.borderless)
                            .font(Typography.meta.weight(.medium))
                        }
                    }
                    .padding(.vertical, Spacing.xs)
                }
            } header: {
                Text(String(localized: "community.applications.documents", defaultValue: "Документы"))
            }
        }
    }

    @ViewBuilder
    private func results(_ application: CommunityApplicationDTO) -> some View {
        if let results = application.results, !results.isEmpty {
            Section {
                ForEach(results) { result in
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        HStack {
                            Text(CommunityApplicationText.result(result.type)).font(Typography.body)
                            if result.revoked == true {
                                StatusBadge(text: String(localized: "community.applications.revoked", defaultValue: "Отозван"), tint: Palette.destructive)
                            }
                        }
                        if let number = result.documentNumber { Text(verbatim: "№ \(number)").font(Typography.meta) }
                        if let note = result.note, !note.isEmpty {
                            Text(note).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                        }
                        if result.revoked != true, result.documentId != nil || result.type == "ELECTRONIC_DOCUMENT" {
                            Button {
                                Task {
                                    await opener.open(name: "\(application.serviceName).pdf") {
                                        try await api.applicationResultURL(applicationID: applicationID, resultID: result.id)
                                    }
                                }
                            } label: {
                                Label(String(localized: "community.applications.download", defaultValue: "Скачать"), systemImage: "arrow.down.circle")
                            }
                            .buttonStyle(.borderless)
                        }
                    }
                    .padding(.vertical, Spacing.xs)
                }
            } header: {
                Text(String(localized: "community.applications.results", defaultValue: "Результат"))
            }
        }
    }

    @ViewBuilder
    private func pickup(_ application: CommunityApplicationDTO) -> some View {
        if application.pickupLocation != nil || application.pickupCode != nil {
            Section {
                if let location = application.pickupLocation {
                    DetailRow(title: String(localized: "community.applications.pickupWhere", defaultValue: "Где забрать"), value: location, symbol: "mappin")
                }
                if let instructions = application.pickupInstructions, !instructions.isEmpty {
                    DetailRow(title: String(localized: "community.applications.pickupHow", defaultValue: "Как забрать"), value: instructions, symbol: "info.circle")
                }
                if let code = application.pickupCode, application.status == "READY_FOR_PICKUP" {
                    DetailRow(title: String(localized: "community.applications.pickupCode", defaultValue: "Код выдачи"), value: code, symbol: "number")
                }
            } header: {
                Text(String(localized: "community.applications.pickup", defaultValue: "Выдача"))
            }
        }
    }

    @ViewBuilder
    private func timeline(_ application: CommunityApplicationDTO) -> some View {
        if let events = application.events, !events.isEmpty {
            Section {
                ForEach(events.reversed()) { event in
                    HStack(alignment: .top, spacing: Spacing.lg) {
                        Circle()
                            .fill(event.toStatus.map(CommunityApplicationText.tint) ?? Palette.mutedForeground)
                            .frame(width: 8, height: 8)
                            .padding(.top, 7)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(CommunityApplicationText.action(event)).font(Typography.body)
                            if let comment = event.comment, !comment.isEmpty {
                                Text(comment).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                            }
                            Text(DisplayFormat.dateTime(event.createdAt)).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
            } header: {
                Text(String(localized: "applications.history", defaultValue: "История"))
            }
        }
    }

    /// Главное действие заявки — кругом под шапкой: подать, подать снова, поправить анкету.
    private func heroActions(_ application: CommunityApplicationDTO) -> [HeroAction] {
        var actions: [HeroAction] = []
        if application.status == "DRAFT" {
            actions.append(HeroAction(
                title: String(localized: "applications.submit", defaultValue: "Подать заявку"),
                symbol: "paperplane.fill"
            ) { Task { await run { try await api.submitApplication(id: applicationID) } } })
        }
        if application.status == "NEEDS_CORRECTION" {
            actions.append(HeroAction(
                title: String(localized: "community.applications.resubmit", defaultValue: "Подать повторно"),
                symbol: "arrow.clockwise"
            ) { Task { await run { try await api.resubmitApplication(id: applicationID) } } })
        }
        if editable, !(application.service?.formFields ?? []).isEmpty {
            actions.append(HeroAction(
                title: String(localized: "community.applications.editAnswers", defaultValue: "Изменить ответы"),
                symbol: "pencil"
            ) { editingAnswers = true })
        }
        return actions
    }

    /// Отмена — отдельной красной секцией внизу, подальше от «Подать».
    @ViewBuilder
    private func actions(_ application: CommunityApplicationDTO) -> some View {
        if ApplicationStatus.isOpen(application.status), !["READY", "READY_FOR_PICKUP"].contains(application.status) {
            Section {
                Button(role: .destructive) {
                    cancelReason = ""
                    cancelling = true
                } label: {
                    Text(String(localized: "community.applications.cancel", defaultValue: "Отменить заявку"))
                        .foregroundStyle(Palette.destructive)
                }
                .disabled(isBusy)
            }
        }
    }

    @MainActor
    private func load() async {
        do {
            application = try await api.application(id: applicationID)
            failure = nil
            if editable { await loadDocuments() }
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    /// Свои документы для выбора. Сбой не стирает прежний список и не выдаёт себя
    /// за «Подходящих документов нет»: в выборе — ошибка с повтором.
    @MainActor
    private func loadDocuments() async {
        do {
            documents = try await api.allDocuments()
            documentsFailure = nil
        } catch is CancellationError {
            return
        } catch {
            documentsFailure = error.userMessage
            documentsOffline = error.isOffline
        }
    }

    @MainActor
    private func run(_ action: () async throws -> Void) async {
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            try await action()
            await load()
        } catch {
            actionFailure = error.userMessage
        }
    }
}

/// Правка ответов анкеты черновика или заявки на исправлении.
private struct CommunityAnswersSheet: View {
    let application: CommunityApplicationDTO
    let saved: () async -> Void

    @State private var values: [String: JSONValue] = [:]
    @State private var didFill = false

    var body: some View {
        FormSheet(
            title: String(localized: "community.applications.editAnswers", defaultValue: "Изменить ответы"),
            canSave: CommunityAnswersForm.isComplete(application.service?.formFields ?? [], values),
            save: { try await CommunityAPI().updateApplication(id: application.id, formData: values, deliveryType: nil) },
            saved: saved
        ) {
            Section {
                CommunityAnswersForm(fields: application.service?.formFields ?? [], values: $values)
            }
        }
        .onAppear {
            guard !didFill else { return }
            didFill = true
            values = application.formData?.object ?? [:]
        }
    }
}
