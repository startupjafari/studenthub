import SwiftUI
import UniformTypeIdentifiers

// Очередь заявок деканата, администратора и модератора вуза (веб — `DeanApplicationsView`)
// и рабочее место по одной заявке (`StaffWorkspaceModal`): проверка документов, решения по
// state-machine, ответственный, результат, история.

// MARK: - Подписи

enum StaffApplicationText {
    /// Вкладки очереди — по статусам открытой заявки, в порядке её пути.
    static let filters: [String] = [
        "SUBMITTED", "RESUBMITTED", "IN_REVIEW", "NEEDS_CORRECTION", "IN_PREPARATION", "READY", "READY_FOR_PICKUP",
    ]

    static func status(_ raw: String) -> String {
        switch raw {
        case "DRAFT": return String(localized: "staff.app.status.draft", defaultValue: "Черновик")
        case "SUBMITTED": return String(localized: "staff.app.status.submitted", defaultValue: "Отправлена")
        case "IN_REVIEW": return String(localized: "staff.app.status.inReview", defaultValue: "На проверке")
        case "NEEDS_CORRECTION": return String(localized: "staff.app.status.needsCorrection", defaultValue: "Требует исправления")
        case "RESUBMITTED": return String(localized: "staff.app.status.resubmitted", defaultValue: "Повторно отправлена")
        case "IN_PREPARATION": return String(localized: "staff.app.status.inPreparation", defaultValue: "Готовится")
        case "READY": return String(localized: "staff.app.status.ready", defaultValue: "Готова")
        case "READY_FOR_PICKUP": return String(localized: "staff.app.status.readyForPickup", defaultValue: "Готова к выдаче")
        case "ISSUED": return String(localized: "staff.app.status.issued", defaultValue: "Выдана")
        case "DELIVERED": return String(localized: "staff.app.status.delivered", defaultValue: "Предоставлена")
        case "REJECTED": return String(localized: "staff.app.status.rejected", defaultValue: "Отклонена")
        case "CANCELLED": return String(localized: "staff.app.status.cancelled", defaultValue: "Отозвана")
        default: return raw
        }
    }

    static func tint(_ raw: String) -> Color {
        switch raw {
        case "SUBMITTED", "RESUBMITTED": return Palette.info
        case "IN_REVIEW", "IN_PREPARATION": return Palette.primary
        case "NEEDS_CORRECTION": return Palette.warning
        case "READY", "READY_FOR_PICKUP", "ISSUED", "DELIVERED": return Palette.success
        case "REJECTED": return Palette.destructive
        default: return Palette.mutedForeground
        }
    }

    static func delivery(_ raw: String) -> String {
        switch raw {
        case "ELECTRONIC": return String(localized: "staff.app.delivery.electronic", defaultValue: "Электронная версия")
        case "PAPER": return String(localized: "staff.app.delivery.paper", defaultValue: "Бумажный оригинал")
        case "BOTH": return String(localized: "staff.app.delivery.both", defaultValue: "Электронная версия + оригинал")
        default: return raw
        }
    }

    static func documentStatus(_ raw: String) -> (String, Color) {
        switch raw {
        case "PENDING": return (String(localized: "staff.app.doc.pending", defaultValue: "На проверке"), Palette.info)
        case "ACCEPTED": return (String(localized: "staff.app.doc.accepted", defaultValue: "Принят"), Palette.success)
        case "REJECTED": return (String(localized: "staff.app.doc.rejected", defaultValue: "Отклонён"), Palette.destructive)
        case "REPLACEMENT_REQUIRED": return (String(localized: "staff.app.doc.replacement", defaultValue: "Требует замены"), Palette.warning)
        default: return (raw, Palette.mutedForeground)
        }
    }

    /// Событие истории: у известных действий — своя подпись, иначе — целевой статус.
    static func event(_ event: StaffApplicationEvent) -> String {
        switch event.action {
        case "CREATED": return String(localized: "staff.app.event.created", defaultValue: "Черновик создан")
        case "SUBMITTED": return String(localized: "staff.app.event.submitted", defaultValue: "Заявка отправлена")
        case "IN_REVIEW": return String(localized: "staff.app.event.inReview", defaultValue: "Заявка принята на проверку")
        case "NEEDS_CORRECTION": return String(localized: "staff.app.event.needsCorrection", defaultValue: "Требуется исправление документов")
        case "RESUBMITTED": return String(localized: "staff.app.event.resubmitted", defaultValue: "Документы отправлены повторно")
        case "IN_PREPARATION": return String(localized: "staff.app.event.inPreparation", defaultValue: "Началась подготовка")
        case "READY": return String(localized: "staff.app.event.ready", defaultValue: "Документ готов")
        case "READY_FOR_PICKUP": return String(localized: "staff.app.event.readyForPickup", defaultValue: "Оригинал готов к выдаче")
        case "ISSUED": return String(localized: "staff.app.event.issued", defaultValue: "Оригинал выдан")
        case "DELIVERED": return String(localized: "staff.app.event.delivered", defaultValue: "Электронный документ предоставлен")
        case "REJECTED": return String(localized: "staff.app.event.rejected", defaultValue: "Заявка отклонена")
        case "CANCELLED": return String(localized: "staff.app.event.cancelled", defaultValue: "Заявка отозвана")
        case "FORM_UPDATED": return String(localized: "staff.app.event.formUpdated", defaultValue: "Ответы анкеты исправлены")
        case "DOCUMENT_ADDED": return String(localized: "staff.app.event.documentAdded", defaultValue: "Документ приложен")
        case "DOCUMENT_ACCEPTED": return String(localized: "staff.app.event.documentAccepted", defaultValue: "Документ принят")
        case "DOCUMENT_REJECTED": return String(localized: "staff.app.event.documentRejected", defaultValue: "Запрошена замена документа")
        case "ASSIGNED": return String(localized: "staff.app.event.assigned", defaultValue: "Назначен ответственный")
        case "RESULT_ADDED": return String(localized: "staff.app.event.resultAdded", defaultValue: "Добавлен результат")
        case "RESULT_REVOKED": return String(localized: "staff.app.event.resultRevoked", defaultValue: "Справка отозвана")
        default:
            if let to = event.toStatus { return status(to) }
            return event.action
        }
    }

    static func resultType(_ raw: String) -> String {
        switch raw {
        case "ELECTRONIC_DOCUMENT": return String(localized: "staff.app.resultType.electronic", defaultValue: "Электронный документ")
        case "PAPER_DOCUMENT": return String(localized: "staff.app.resultType.paper", defaultValue: "Бумажный документ")
        case "INFORMATION": return String(localized: "staff.app.resultType.information", defaultValue: "Информация")
        case "OTHER": return String(localized: "staff.app.resultType.other", defaultValue: "Другое")
        default: return raw
        }
    }

    static let sorts: [(key: String, title: String)] = [
        ("submittedAt", String(localized: "staff.app.sort.submitted", defaultValue: "По дате подачи")),
        ("dueAt", String(localized: "staff.app.sort.due", defaultValue: "По сроку")),
        ("status", String(localized: "staff.app.sort.status", defaultValue: "По статусу")),
        ("createdAt", String(localized: "staff.app.sort.created", defaultValue: "По дате создания")),
    ]
}

// MARK: - Очередь

struct StaffApplicationsQueueView: View {
    @State private var query = StaffApplicationQuery()
    @State private var filter: String?
    @State private var search = ""
    @State private var categories: [StaffCatalogCategory] = []
    @State private var loader: PagedLoader<StaffApplication>
    @State private var appeared = false
    @State private var actionFailure: String?

    private let api = StaffAPI()

    init() {
        let api = StaffAPI()
        let initial = StaffApplicationQuery()
        _loader = State(initialValue: PagedLoader(limit: 20) { request in
            try await api.applications(initial, request)
        })
    }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: String(localized: "staff.app.empty", defaultValue: "Заявок нет"),
                symbol: "tray",
                hint: isFiltered ? nil : String(localized: "staff.app.empty.hint", defaultValue: "В очереди пока пусто")
            ),
            header: {
                FilterChipsRow(options: filterOptions, selection: $filter)
                if let service = selectedServiceName {
                    Section {
                        HStack {
                            Label(service, systemImage: "square.grid.2x2")
                                .font(Typography.meta)
                                .foregroundStyle(Palette.foreground)
                            Spacer()
                            Button {
                                query.serviceID = nil
                            } label: {
                                Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.mutedForeground)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(Text(String(localized: "staff.app.serviceClear", defaultValue: "Все услуги")))
                        }
                    }
                }
            },
            row: { item in
                NavigationLink(value: AppRoute.staff(.application(id: item.id))) {
                    StaffApplicationRow(item: item)
                }
                .swipeActions(edge: .leading) {
                    if item.status == "SUBMITTED" || item.status == "RESUBMITTED" {
                        Button {
                            Task { await take(item) }
                        } label: {
                            Label(String(localized: "staff.app.takeShort", defaultValue: "Взять"), systemImage: "hand.raised.fill")
                        }
                        .tint(Palette.primary)
                    }
                }
                .contextMenu {
                    if item.status == "SUBMITTED" || item.status == "RESUBMITTED" {
                        Button {
                            Task { await take(item) }
                        } label: {
                            Label(String(localized: "staff.app.take", defaultValue: "Взять в работу"), systemImage: "hand.raised")
                        }
                    }
                    if let student = item.student {
                        Button {
                            AdminNav.push(.profile(id: student.id))
                        } label: {
                            Label(String(localized: "staff.app.studentProfile", defaultValue: "Профиль студента"), systemImage: "person.crop.circle")
                        }
                    }
                }
            }
        )
        .navigationTitle(Text(StaffScreen.applicationsQueue.title))
        .actionFailureAlert($actionFailure)
        .adminPinnedSearch($search, prompt: String(localized: "staff.app.search", defaultValue: "Номер или ФИО студента")) { value in
            query.search = value
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker(String(localized: "staff.app.sort", defaultValue: "Сортировка"), selection: $query.sortBy) {
                        ForEach(StaffApplicationText.sorts, id: \.key) { Text($0.title).tag($0.key) }
                    }
                    Toggle(String(localized: "staff.app.sort.ascending", defaultValue: "Сначала старые"), isOn: $query.ascending)
                    if !categories.isEmpty {
                        Menu(String(localized: "staff.app.service", defaultValue: "Услуга")) {
                            Button(String(localized: "staff.app.serviceClear", defaultValue: "Все услуги")) { query.serviceID = nil }
                            ForEach(categories) { category in
                                Section(category.name) {
                                    ForEach(category.services) { service in
                                        Button {
                                            query.serviceID = service.id
                                        } label: {
                                            if query.serviceID == service.id {
                                                Label(service.name, systemImage: "checkmark")
                                            } else {
                                                Text(service.name)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                } label: {
                    Image(systemName: query.serviceID == nil && query.sortBy == StaffApplicationQuery().sortBy && !query.ascending
                        ? "line.3.horizontal.decrease.circle"
                        : "line.3.horizontal.decrease.circle.fill")
                }
                .accessibilityLabel(Text(String(localized: "staff.app.filters", defaultValue: "Фильтры")))
            }
        }
        .onChange(of: filter) { _, value in
            query.overdue = value == "overdue"
            query.status = value == "overdue" ? nil : value
        }
        .onChange(of: query) { _, value in
            Task { await loader.replace { request in try await api.applications(value, request) } }
        }
        .task {
            if categories.isEmpty { categories = (try? await api.catalogCategories()) ?? [] }
        }
        .onAppear {
            // Возврат из карточки: заявку могли взять, отклонить, выдать — очередь перечитываем.
            if appeared { Task { await loader.reload() } }
            appeared = true
        }
    }

    @MainActor
    private func take(_ item: StaffApplication) async {
        do {
            try await api.take(item.id)
        } catch {
            actionFailure = StaffErrorText.message(error)
        }
        await loader.reload()
    }

    private var isFiltered: Bool {
        filter != nil || query.serviceID != nil || !query.search.isEmpty
    }

    private var filterOptions: [(value: String?, title: String)] {
        var options: [(value: String?, title: String)] = [(nil, String(localized: "staff.app.all", defaultValue: "Все"))]
        options += StaffApplicationText.filters.map { (Optional($0), StaffApplicationText.status($0)) }
        options.append(("overdue", String(localized: "staff.app.overdue", defaultValue: "Просрочено")))
        return options
    }

    private var selectedServiceName: String? {
        guard let id = query.serviceID else { return nil }
        return categories.flatMap(\.services).first { $0.id == id }?.name
    }
}

private struct StaffApplicationRow: View {
    let item: StaffApplication

    var body: some View {
        TelegramStyleRow(
            title: item.service?.name ?? "—",
            subtitle: subtitle,
            meta: item.submittedAt.map(DisplayFormat.relative)
        ) {
            RowSymbol(symbol: StaffApplicationVisual.symbol(item.status), tint: StaffApplicationText.tint(item.status))
        } accessory: {
            HStack(spacing: Spacing.xs) {
                if item.isOverdue {
                    Image(systemName: "clock.badge.exclamationmark.fill")
                        .foregroundStyle(Palette.destructive)
                        .accessibilityLabel(Text(String(localized: "staff.app.overdue", defaultValue: "Просрочено")))
                }
                StatusBadge(text: StaffApplicationText.status(item.status), tint: StaffApplicationText.tint(item.status))
            }
        }
    }

    private var subtitle: String {
        let who = [item.number, item.student?.name].compactMap { $0 }.joined(separator: " · ")
        // Срок — второй строкой: по нему разбирают очередь.
        let due = item.dueAt.map { String(localized: "staff.app.dueLine", defaultValue: "Срок: \(DisplayFormat.date($0))") } ?? ""
        return [who, due].filter { !$0.isEmpty }.joined(separator: "\n")
    }
}

/// Значок заявки по этапу: новая, на проверке, готовится, готова, закрыта.
enum StaffApplicationVisual {
    static func symbol(_ status: String) -> String {
        switch status {
        case "SUBMITTED", "RESUBMITTED": return "tray.and.arrow.down.fill"
        case "IN_REVIEW": return "doc.text.magnifyingglass"
        case "NEEDS_CORRECTION": return "arrow.uturn.left"
        case "IN_PREPARATION": return "hammer.fill"
        case "READY", "READY_FOR_PICKUP": return "checkmark.seal.fill"
        case "ISSUED", "DELIVERED": return "checkmark"
        case "REJECTED": return "xmark"
        default: return "doc.text.fill"
        }
    }
}

// MARK: - Карточка заявки

struct StaffApplicationDetailView: View {
    let applicationID: String

    @Environment(\.viewerRole) private var viewerRole
    @State private var app: StaffApplication?
    @State private var failure: String?
    @State private var actionFailure: String?
    @State private var notice: String?
    @State private var prompt: StaffTextPrompt?
    @State private var addingResult = false
    @State private var isWorking = false
    @State private var assignees: [StaffApplicationAssignee]?
    /// Список сотрудников не загрузился: без него ответственного не сменить, и строка
    /// говорит об этом прямо, с повтором, а не молча перестаёт быть меню.
    @State private var assigneesFailure: String?
    @State private var isOffline = false
    @State private var opener = RemoteFileOpener()

    private let api = StaffAPI()

    var body: some View {
        Group {
            if let app {
                content(app)
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .navigationTitle(Text(StaffScreen.application(id: applicationID).title))
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $prompt) { prompt in
            StaffTextPromptSheet(prompt: prompt) { await load() }
        }
        .sheet(isPresented: $addingResult) {
            StaffResultSheet(applicationID: applicationID) { message in
                notice = message
                await load()
            }
        }
        .actionFailureAlert($actionFailure)
        .alert(
            String(localized: "staff.app.done", defaultValue: "Готово"),
            isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })
        ) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        } message: {
            Text(notice ?? "")
        }
        .remoteFilePreview(opener)
        .task { await load() }
    }

    @ViewBuilder
    private func content(_ app: StaffApplication) -> some View {
        List {
            Section {
                HeroHeader(
                    visual: .symbol(StaffApplicationVisual.symbol(app.status), tint: StaffApplicationText.tint(app.status)),
                    title: app.service?.name ?? "—",
                    subtitle: [app.number, app.student?.name].compactMap { $0 }.joined(separator: " · "),
                    actions: heroActions(app)
                ) {
                    HStack(spacing: Spacing.sm) {
                        StatusBadge(text: StaffApplicationText.status(app.status), tint: StaffApplicationText.tint(app.status))
                        if app.isOverdue {
                            StatusBadge(text: String(localized: "staff.app.overdue", defaultValue: "Просрочено"), tint: Palette.destructive)
                        }
                    }
                }
            }

            Section {
                StaffApplicationStepper(status: app.status)
                    .padding(.vertical, Spacing.xs)
                if let waiting = waitingText(app) {
                    Label(waiting, systemImage: "hourglass")
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
            }

            Section(String(localized: "staff.app.info", defaultValue: "Информация")) {
                if let student = app.student {
                    NavigationLink(value: AppRoute.profile(id: student.id)) {
                        PersonRow(name: student.name, subtitle: String(localized: "staff.app.student", defaultValue: "Студент"), size: 36)
                    }
                }
                if let number = app.number {
                    DetailRow(title: String(localized: "staff.app.number", defaultValue: "Номер"), value: number, symbol: "number")
                }
                if let submitted = app.submittedAt {
                    DetailRow(title: String(localized: "staff.app.submitted", defaultValue: "Подано"), value: DisplayFormat.dateTime(submitted), symbol: "paperplane")
                }
                if let delivery = app.deliveryType {
                    DetailRow(title: String(localized: "staff.app.delivery", defaultValue: "Способ получения"), value: StaffApplicationText.delivery(delivery), symbol: "shippingbox")
                }
                if let due = app.dueAt {
                    DetailRow(title: String(localized: "staff.app.expected", defaultValue: "Ожидаемая готовность"), value: DisplayFormat.dateTime(due), symbol: "clock")
                }
                assigneeRow(app)
                if let reason = app.rejectionReason, !reason.isEmpty {
                    DetailRow(title: String(localized: "staff.app.rejectionReason", defaultValue: "Причина отказа"), value: reason, symbol: "xmark.octagon")
                }
                if let location = app.pickupLocation, !location.isEmpty {
                    DetailRow(title: String(localized: "staff.app.pickupLocation", defaultValue: "Где получить"), value: location, symbol: "mappin.and.ellipse")
                }
            }

            let answers = formAnswers(app)
            if !answers.isEmpty {
                Section(String(localized: "staff.app.form", defaultValue: "Данные заявки")) {
                    ForEach(answers, id: \.0) { answer in
                        DetailRow(title: answer.0, value: answer.1)
                    }
                }
            }

            if let documents = app.documents, !documents.isEmpty {
                Section(String(localized: "staff.app.documents", defaultValue: "Документы")) {
                    ForEach(documents) { document in
                        documentRow(document, app: app)
                    }
                }
            }

            if let results = app.results, !results.isEmpty {
                Section(String(localized: "staff.app.result", defaultValue: "Результат")) {
                    ForEach(results) { result in
                        resultRow(result, app: app)
                    }
                    // Отозвать можно только справку, сформированную платформой: у
                    // загруженного файла кода проверки нет.
                    if results.contains(where: { $0.type == "DOCUMENT" && $0.revoked != true }) {
                        Button(role: .destructive) {
                            prompt = StaffTextPrompt(
                                title: String(localized: "staff.app.revoke.title", defaultValue: "Отозвать выданную справку?"),
                                message: String(
                                    localized: "staff.app.revoke.message",
                                    defaultValue: "Причина — необязательно. Файл у студента останется, но проверка по коду покажет «отозван»."
                                ),
                                placeholder: String(localized: "common.reason", defaultValue: "Причина"),
                                multiline: true,
                                required: false,
                                actionTitle: String(localized: "staff.app.revoke", defaultValue: "Отозвать справку")
                            ) { reason in
                                do {
                                    try await api.revokeCertificate(applicationID, reason: reason)
                                } catch let error as APIError where error.code == .notFound {
                                    throw StaffMessageError(
                                        message: String(localized: "staff.app.revoke.nothing", defaultValue: "Действующей справки по этой заявке нет")
                                    )
                                }
                            }
                        } label: {
                            Label(String(localized: "staff.app.revoke", defaultValue: "Отозвать справку"), systemImage: "xmark.seal")
                        }
                    }
                }
            }

            let events = (app.events ?? []).sorted { $0.createdAt < $1.createdAt }
            if !events.isEmpty {
                Section(String(localized: "staff.app.timeline", defaultValue: "История")) {
                    ForEach(events) { event in
                        HStack(alignment: .firstTextBaseline, spacing: Spacing.lg) {
                        Circle()
                            .fill(event.id == events.last?.id ? Palette.primary : Palette.mutedForeground.opacity(0.5))
                            .frame(width: 8, height: 8)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(StaffApplicationText.event(event))
                                .font(Typography.body)
                                .foregroundStyle(Palette.foreground)
                            Text(DisplayFormat.dateTime(event.createdAt))
                                .font(Typography.meta)
                                .foregroundStyle(Palette.mutedForeground)
                            if let comment = eventComment(event, app: app) {
                                Text(comment)
                                    .font(Typography.meta)
                                    .foregroundStyle(Palette.mutedForeground)
                            }
                        }
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .refreshable { await load() }
        .safeAreaInset(edge: .bottom) {
            actionBar(app)
        }
    }

    /// Круглые кнопки шапки: студент, написать ему и открыть первый документ.
    private func heroActions(_ app: StaffApplication) -> [HeroAction] {
        var actions: [HeroAction] = []
        if let student = app.student {
            actions.append(HeroAction(title: String(localized: "staff.app.studentShort", defaultValue: "Студент"), symbol: "person.crop.circle") {
                AdminNav.push(.profile(id: student.id))
            })
            if AdminNav.canChat(viewerRole) {
                actions.append(HeroAction(title: String(localized: "staff.app.write", defaultValue: "Написать"), symbol: "bubble.left.fill") {
                    Task {
                        do { try await AdminNav.openChat(with: student.id) } catch { actionFailure = error.userMessage }
                    }
                })
            }
        }
        if let result = (app.results ?? []).first(where: { $0.documentId != nil && $0.revoked != true }) {
            actions.append(HeroAction(title: String(localized: "staff.app.download", defaultValue: "Скачать"), symbol: "arrow.down.doc") {
                Task {
                    await opener.open(name: result.documentNumber ?? StaffApplicationText.resultType(result.type)) {
                        try await api.resultURL(applicationID, resultID: result.id)
                    }
                }
            })
        }
        return actions
    }

    // MARK: Ответственный

    @ViewBuilder
    private func assigneeRow(_ app: StaffApplication) -> some View {
        let title = String(localized: "staff.app.assignee", defaultValue: "Ответственный")
        let current = assignees?.first { $0.id == app.assignedToId }
        let currentName = current?.name
            ?? (app.assignedToId == nil
                ? String(localized: "staff.app.unassigned", defaultValue: "Не назначен")
                : String(localized: "staff.app.assignedSomeone", defaultValue: "Назначен сотрудник"))
        if !app.isClosed, assignees == nil, let assigneesFailure {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                DetailRow(title: title, value: currentName, symbol: "person.badge.clock")
                HStack(spacing: Spacing.md) {
                    Text(assigneesFailure)
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                    Spacer(minLength: 0)
                    Button(String(localized: "common.retry", defaultValue: "Повторить")) {
                        Task { await loadAssignees() }
                    }
                    .font(Typography.meta.weight(.semibold))
                    .buttonStyle(.borderless)
                }
            }
        } else if app.isClosed || assignees == nil || assignees?.isEmpty == true {
            DetailRow(title: title, value: currentName, symbol: "person.badge.clock")
        } else {
            Menu {
                ForEach(assignees ?? []) { person in
                    Button {
                        Task { await assign(person) }
                    } label: {
                        if person.id == app.assignedToId {
                            Label(person.name, systemImage: "checkmark")
                        } else {
                            Text(person.name)
                        }
                    }
                }
            } label: {
                HStack {
                    DetailRow(title: title, value: currentName, symbol: "person.badge.clock")
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.footnote)
                        .foregroundStyle(Palette.mutedForeground)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(isWorking)
        }
    }

    // MARK: Документы

    @ViewBuilder
    private func documentRow(_ document: StaffApplicationDocument, app: StaffApplication) -> some View {
        let status = StaffApplicationText.documentStatus(document.status)
        // В исправлении проверка продолжается: можно пометить к замене ещё документ.
        let canReview = (app.status == "IN_REVIEW" || app.status == "NEEDS_CORRECTION") && document.status == "PENDING"
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(alignment: .firstTextBaseline) {
                Text(requirementTitle(document, app: app))
                    .font(Typography.body.weight(.medium))
                    .foregroundStyle(Palette.foreground)
                Spacer(minLength: Spacing.md)
                StatusBadge(text: status.0, tint: status.1)
            }
            if let snapshot = document.snapshotTitle, !snapshot.isEmpty {
                Text(snapshot).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
            }
            if let comment = document.reviewComment, !comment.isEmpty {
                Label(comment, systemImage: "text.bubble")
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.sm) {
                    if document.documentId != nil {
                        let files = document.files ?? []
                        // Каждая страница открывается своей ссылкой: оборот паспорта и
                        // приложение к диплому тоже нужно видеть перед решением.
                        if files.count > 1 {
                            ForEach(Array(files.enumerated()), id: \.element.id) { index, file in
                                StaffInlineButton(
                                    title: String(localized: "staff.app.page", defaultValue: "Стр. \((index + 1).formatted())"),
                                    symbol: "eye"
                                ) {
                                    open(document, fileID: file.id)
                                }
                            }
                        } else {
                            StaffInlineButton(title: String(localized: "staff.app.view", defaultValue: "Просмотреть"), symbol: "eye") {
                                open(document, fileID: files.first?.id)
                            }
                        }
                    }
                    if canReview {
                        StaffInlineButton(title: String(localized: "staff.app.accept", defaultValue: "Принять"), symbol: "checkmark") {
                            Task { await run { try await api.acceptDocument(applicationID, docID: document.id) } }
                        }
                        StaffInlineButton(
                            title: String(localized: "staff.app.replace", defaultValue: "Запросить замену"),
                            symbol: "arrow.triangle.2.circlepath"
                        ) {
                            prompt = StaffTextPrompt(
                                title: String(localized: "staff.app.replace", defaultValue: "Запросить замену"),
                                placeholder: String(localized: "staff.app.comment", defaultValue: "Комментарий"),
                                multiline: true
                            ) { comment in
                                try await api.requestReplacement(applicationID, docID: document.id, comment: comment)
                            }
                        }
                    }
                }
            }
        }
        .padding(.vertical, Spacing.xs)
    }

    private func requirementTitle(_ document: StaffApplicationDocument, app: StaffApplication) -> String {
        if let title = document.requirement?.title, !title.isEmpty { return title }
        return app.service?.requirements?.first { $0.id == document.requirementId }?.title ?? "—"
    }

    private func open(_ document: StaffApplicationDocument, fileID: String?) {
        let name = document.snapshotTitle ?? requirementTitleFallback
        Task {
            await opener.open(name: name) {
                try await api.documentURL(applicationID, docID: document.id, fileID: fileID)
            }
        }
    }

    private var requirementTitleFallback: String {
        String(localized: "staff.app.documentFile", defaultValue: "Документ")
    }

    // MARK: Результат

    @ViewBuilder
    private func resultRow(_ result: StaffApplicationResult, app: StaffApplication) -> some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(StaffApplicationText.resultType(result.type))
                    .font(Typography.body.weight(.medium))
                    .foregroundStyle(Palette.foreground)
                if let number = result.documentNumber, !number.isEmpty {
                    Text(String(localized: "staff.app.resultNumber", defaultValue: "Номер документа: \(number)"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
                if let note = result.note, !note.isEmpty {
                    Text(note).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                }
                if result.revoked == true {
                    Text(String(localized: "staff.app.resultRevoked", defaultValue: "Отозвана университетом — не действует"))
                        .font(Typography.meta.weight(.medium))
                        .foregroundStyle(Palette.destructive)
                }
            }
            Spacer(minLength: Spacing.md)
            if result.documentId != nil {
                StaffInlineButton(title: String(localized: "staff.app.download", defaultValue: "Скачать"), symbol: "arrow.down.circle") {
                    Task {
                        await opener.open(name: result.documentNumber ?? StaffApplicationText.resultType(result.type)) {
                            try await api.resultURL(applicationID, resultID: result.id)
                        }
                    }
                }
            }
        }
        .padding(.vertical, Spacing.xs)
    }

    // MARK: Действия

    /// Решения по state-machine: кнопки только для переходов, допустимых из статуса.
    @ViewBuilder
    private func actionBar(_ app: StaffApplication) -> some View {
        let actions = availableActions(app)
        if !actions.isEmpty {
            HStack(spacing: Spacing.md) {
                let secondary = actions.dropFirst()
                if !secondary.isEmpty {
                    Menu {
                        ForEach(Array(secondary), id: \.title) { action in
                            Button(role: action.destructive ? .destructive : nil) {
                                action.run()
                            } label: {
                                Label(action.title, systemImage: action.symbol)
                            }
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                            .frame(width: ControlHeight.lg, height: ControlHeight.lg)
                    }
                    .glassButton()
                    .accessibilityLabel(Text(String(localized: "staff.app.more", defaultValue: "Другие действия")))
                }
                if let primary = actions.first {
                    Button(role: primary.destructive ? .destructive : nil) {
                        primary.run()
                    } label: {
                        if isWorking {
                            ProgressView().frame(maxWidth: .infinity)
                        } else {
                            Label(primary.title, systemImage: primary.symbol).frame(maxWidth: .infinity)
                        }
                    }
                    .glassProminentButton()
                    .controlSize(.large)
                    .disabled(isWorking)
                }
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.md)
            .modifier(StaffBottomBarSurface())
        }
    }

    private struct Action {
        let title: String
        let symbol: String
        var destructive = false
        let run: () -> Void
    }

    private func availableActions(_ app: StaffApplication) -> [Action] {
        var primary: [Action] = []
        var secondary: [Action] = []
        let status = app.status
        let id = applicationID

        if status == "SUBMITTED" || status == "RESUBMITTED" {
            primary.append(Action(title: String(localized: "staff.app.take", defaultValue: "Взять в работу"), symbol: "hand.raised") {
                Task { await run { try await api.take(id) } }
            })
        }
        if status == "IN_REVIEW" {
            primary.append(Action(title: String(localized: "staff.app.startPreparation", defaultValue: "Начать подготовку"), symbol: "play") {
                Task { await run { try await api.startPreparation(id) } }
            })
            secondary.append(Action(title: String(localized: "staff.app.requestCorrection", defaultValue: "Запросить исправление"), symbol: "arrow.uturn.left") {
                prompt = StaffTextPrompt(
                    title: String(localized: "staff.app.requestCorrection", defaultValue: "Запросить исправление"),
                    placeholder: String(localized: "staff.app.comment", defaultValue: "Комментарий"),
                    multiline: true
                ) { comment in try await api.requestCorrection(id, comment: comment) }
            })
        }
        if status == "IN_PREPARATION" {
            primary.append(Action(title: String(localized: "staff.app.markReady", defaultValue: "Пометить готовым"), symbol: "checkmark.seal") {
                markReady(app)
            })
            secondary.append(Action(title: String(localized: "staff.app.addResult", defaultValue: "Добавить результат"), symbol: "doc.badge.plus") {
                addingResult = true
            })
        }
        // Справку отозвали после «готово» — до передачи студенту её можно выпустить заново.
        if (status == "READY" || status == "READY_FOR_PICKUP"), !app.hasActiveResult, !(app.results ?? []).isEmpty {
            secondary.append(Action(title: String(localized: "staff.app.addResult", defaultValue: "Добавить результат"), symbol: "doc.badge.plus") {
                addingResult = true
            })
        }
        if status == "READY_FOR_PICKUP" {
            primary.append(Action(title: String(localized: "staff.app.issue", defaultValue: "Выдать документ"), symbol: "hand.thumbsup") {
                // Код получения называет студент, сервер сверяет: оригинал не выдаётся без
                // того, кто подавал заявку.
                prompt = StaffTextPrompt(
                    title: String(localized: "staff.app.issue.title", defaultValue: "Код получения, который назвал студент"),
                    placeholder: String(localized: "staff.app.pickupCode", defaultValue: "Код получения")
                ) { code in try await api.issue(id, pickupCode: code) }
            })
        }
        if status == "READY" {
            primary.append(Action(title: String(localized: "staff.app.deliver", defaultValue: "Отметить предоставленным"), symbol: "checkmark.circle") {
                Task { await run { try await api.deliver(id) } }
            })
        }
        if status == "SUBMITTED" || status == "IN_REVIEW" || status == "IN_PREPARATION" {
            secondary.append(Action(title: String(localized: "staff.app.reject", defaultValue: "Отклонить"), symbol: "xmark", destructive: true) {
                prompt = StaffTextPrompt(
                    title: String(localized: "staff.app.reject", defaultValue: "Отклонить"),
                    placeholder: String(localized: "common.reason", defaultValue: "Причина"),
                    multiline: true,
                    actionTitle: String(localized: "staff.app.reject", defaultValue: "Отклонить")
                ) { reason in try await api.reject(id, reason: reason) }
            })
        }
        return primary + secondary
    }

    private func markReady(_ app: StaffApplication) {
        // Электронную выдачу без результата сервер не примет: студенту пришло бы «готово»,
        // а скачать нечего. Подсказываем до запроса.
        if app.deliveryType != "PAPER", !app.hasActiveResult {
            actionFailure = String(
                localized: "staff.app.readyNeedsResult",
                defaultValue: "Сначала добавьте результат — без него студенту нечего скачать"
            )
            return
        }
        if app.deliveryType == "ELECTRONIC" {
            Task { await run { try await api.markReady(applicationID, pickupLocation: nil) } }
        } else {
            prompt = StaffTextPrompt(
                title: String(localized: "staff.app.pickup", defaultValue: "Получение оригинала"),
                placeholder: String(localized: "staff.app.pickupLocation", defaultValue: "Где получить"),
                required: false
            ) { location in try await api.markReady(applicationID, pickupLocation: location) }
        }
    }

    private func waitingText(_ app: StaffApplication) -> String? {
        app.status == "NEEDS_CORRECTION"
            ? String(localized: "staff.app.waiting", defaultValue: "Ждём исправленных документов от студента")
            : nil
    }

    // MARK: Ответы анкеты

    /// Ответ так, как его прочтёт человек: вариант — подписью, флажок — «Да/Нет», дата —
    /// по локали. Пустой ответ не показывается.
    private func formAnswers(_ app: StaffApplication) -> [(String, String)] {
        let data = app.formData ?? [:]
        return (app.service?.formFields ?? []).compactMap { field in
            guard let value = data[field.code], !value.isNull else { return nil }
            let raw = value.string ?? value.display
            guard !raw.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
            let text: String
            switch field.type {
            case "BOOLEAN", "CHECKBOX":
                if raw == "true" {
                    text = String(localized: "common.yes", defaultValue: "Да")
                } else if raw == "false" {
                    text = String(localized: "common.no", defaultValue: "Нет")
                } else {
                    text = raw
                }
            case "SELECT", "RADIO":
                text = field.options?.first { $0.value == raw }?.label ?? raw
            case "DATE":
                text = StaffApplicationDetailView.formatDay(raw)
            default:
                text = raw
            }
            return (field.label, text)
        }
    }

    /// Дата без пояса собирается по частям: иначе в поясе западнее UTC показался бы
    /// предыдущий день.
    private static func formatDay(_ raw: String) -> String {
        let parts = raw.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3,
              let date = Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
        else { return raw }
        return DisplayFormat.date(date)
    }

    /// У событий документа comment — название требования; если требование известно,
    /// подписываем его на языке интерфейса. У назначения comment — не текст.
    private func eventComment(_ event: StaffApplicationEvent, app: StaffApplication) -> String? {
        if event.action == "ASSIGNED" { return nil }
        if let requirementID = event.requirementId, event.action == "DOCUMENT_ADDED" || event.action == "DOCUMENT_ACCEPTED" {
            if let title = app.service?.requirements?.first(where: { $0.id == requirementID })?.title, !title.isEmpty {
                return title
            }
        }
        guard let comment = event.comment, !comment.isEmpty else { return nil }
        return comment
    }

    // MARK: Загрузка

    @MainActor
    private func load() async {
        do {
            let loaded = try await api.application(id: applicationID)
            app = loaded
            failure = nil
            isOffline = false
            if !loaded.isClosed, assignees == nil {
                await loadAssignees()
            }
        } catch {
            if app == nil {
                failure = error.userMessage
                isOffline = error.isOffline
            } else {
                actionFailure = error.userMessage
            }
        }
    }

    /// Кому можно передать заявку. Сбой оставляет `assignees` пустым (`nil`): следующее
    /// обновление карточки или «Повторить» в строке спросят снова.
    @MainActor
    private func loadAssignees() async {
        do {
            assignees = try await api.assignees(applicationID)
            assigneesFailure = nil
        } catch is CancellationError {
            return
        } catch {
            assigneesFailure = error.userMessage
        }
    }

    @MainActor
    private func run(_ work: () async throws -> Void) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await work()
            await load()
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func assign(_ person: StaffApplicationAssignee) async {
        guard person.id != app?.assignedToId else { return }
        await run { try await api.assign(applicationID, userID: person.id) }
    }
}

/// Этап обработки: проверка → подготовка → выдача.
private struct StaffApplicationStepper: View {
    let status: String

    var body: some View {
        let steps = [
            String(localized: "staff.app.step.review", defaultValue: "Проверка"),
            String(localized: "staff.app.step.prepare", defaultValue: "Подготовка"),
            String(localized: "staff.app.step.issue", defaultValue: "Выдача"),
        ]
        HStack(spacing: Spacing.sm) {
            ForEach(Array(steps.enumerated()), id: \.offset) { index, title in
                VStack(spacing: Spacing.xs) {
                    Capsule()
                        .fill(index <= active ? Palette.primary : Palette.muted)
                        .frame(height: 4)
                    Text(title)
                        .font(Typography.meta.weight(index == active ? .semibold : .regular))
                        .foregroundStyle(index <= active ? Palette.foreground : Palette.mutedForeground)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(steps[active]))
    }

    private var active: Int {
        if status == "IN_PREPARATION" { return 1 }
        if ["READY", "READY_FOR_PICKUP", "ISSUED", "DELIVERED"].contains(status) { return 2 }
        return 0
    }
}

// MARK: - Результат заявки

/// Чем закончилась услуга. Для электронного документа сотрудник прикладывает файл —
/// сервер заведёт по нему документ в кабинете студента. Справку об обучении платформа
/// формирует сама — это отдельное, завершённое действие.
private struct StaffResultSheet: View {
    let applicationID: String
    let done: (String?) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var type = "ELECTRONIC_DOCUMENT"
    @State private var documentType = ""
    @State private var file: (id: String, name: String)?
    @State private var number = ""
    @State private var note = ""
    @State private var issuedTypes: [StaffDocumentType] = []
    /// Каталог видов документов не загрузился: без него «Вид документа» пуст, и выбор
    /// заблокирован — говорим об этом в секции файла и даём повторить.
    @State private var typesFailure: String?
    @State private var picking = false
    @State private var isUploading = false
    @State private var isSaving = false
    @State private var failure: String?

    private let api = StaffAPI()
    private static let types = ["ELECTRONIC_DOCUMENT", "PAPER_DOCUMENT", "INFORMATION", "OTHER"]

    var body: some View {
        NavigationStack {
            Form {
                if let failure {
                    FormAlert(message: failure)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                Section {
                    Picker(String(localized: "staff.app.resultTypeLabel", defaultValue: "Тип результата"), selection: $type) {
                        ForEach(Self.types, id: \.self) { Text(StaffApplicationText.resultType($0)).tag($0) }
                    }
                }

                if needsFile, file == nil {
                    Section {
                        Button {
                            Task { await issueCertificate() }
                        } label: {
                            Label(String(localized: "staff.app.certificate.action", defaultValue: "Сформировать и выдать"), systemImage: "doc.badge.gearshape")
                        }
                        .disabled(isSaving || isUploading)
                    } header: {
                        Text(String(localized: "staff.app.certificate", defaultValue: "Справка об обучении"))
                    } footer: {
                        Text(String(
                            localized: "staff.app.certificate.hint",
                            defaultValue: "Платформа соберёт бланк по данным студента, выдаст документ в его кабинет и присвоит код проверки. Загружать файл не нужно."
                        ))
                    }
                }

                if needsFile {
                    Section {
                        if let typesFailure {
                            FormAlert(message: typesFailure)
                                .listRowBackground(Color.clear)
                                .listRowInsets(EdgeInsets())
                            Button {
                                Task { await loadTypes() }
                            } label: {
                                Label(String(localized: "common.retry", defaultValue: "Повторить"), systemImage: "arrow.clockwise")
                            }
                        }
                        if let file {
                            HStack {
                                Label(file.name, systemImage: "paperclip").lineLimit(2)
                                Spacer()
                                Button {
                                    self.file = nil
                                } label: {
                                    Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.mutedForeground)
                                }
                                .buttonStyle(.plain)
                            }
                            Picker(String(localized: "staff.app.resultDocType", defaultValue: "Вид документа"), selection: $documentType) {
                                Text(String(localized: "staff.app.pick", defaultValue: "Выберите")).tag("")
                                ForEach(issuedTypes) { Text($0.title).tag($0.typeId) }
                            }
                        } else {
                            Button {
                                picking = true
                            } label: {
                                if isUploading {
                                    ProgressView()
                                } else {
                                    Label(String(localized: "staff.app.resultFilePick", defaultValue: "Выбрать файл"), systemImage: "paperclip")
                                }
                            }
                            .disabled(isUploading)
                        }
                    } header: {
                        Text(String(localized: "staff.app.resultFile", defaultValue: "Файл документа"))
                    } footer: {
                        Text(String(
                            localized: "staff.app.resultFile.hint",
                            defaultValue: "PDF, JPG или PNG. Документ появится у студента в разделе «Выданные университетом»."
                        ))
                    }
                }

                Section {
                    TextField(String(localized: "staff.app.resultNumberLabel", defaultValue: "Номер документа"), text: $number)
                    TextField(String(localized: "staff.app.resultNote", defaultValue: "Примечание"), text: $note, axis: .vertical)
                        .lineLimit(2...5)
                }
            }
            .navigationTitle(Text(String(localized: "staff.app.addResult", defaultValue: "Добавить результат")))
            .navigationBarTitleDisplayMode(.inline)
            .softTopEdge()
            .interactiveDismissDisabled(isSaving || isUploading)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button(String(localized: "staff.app.addResult.save", defaultValue: "Добавить")) {
                            Task { await save() }
                        }
                        .disabled(!canSave)
                    }
                }
            }
            .fileImporter(isPresented: $picking, allowedContentTypes: [.pdf, .jpeg, .png]) { result in
                Task { await upload(result) }
            }
            .task {
                if issuedTypes.isEmpty { await loadTypes() }
            }
        }
    }

    /// Выдать можно только то, что каталог вуза относит к «Выданным университетом»,
    /// и только включённые типы.
    @MainActor
    private func loadTypes() async {
        do {
            let all = try await api.effectiveDocumentTypes()
            issuedTypes = all.filter { $0.category == "ISSUED_BY_UNIVERSITY" && $0.enabled }
            typesFailure = nil
        } catch is CancellationError {
            return
        } catch {
            typesFailure = error.userMessage
        }
    }

    /// Файл нужен только электронному документу: «информация» и бумажный оригинал
    /// существуют вне платформы.
    private var needsFile: Bool { type == "ELECTRONIC_DOCUMENT" }

    private var canSave: Bool {
        guard !isUploading else { return false }
        if needsFile { return file != nil && !documentType.isEmpty }
        return true
    }

    @MainActor
    private func upload(_ result: Result<URL, Error>) async {
        guard let picked = StaffPickedFile.read(result) else { return }
        isUploading = true
        defer { isUploading = false }
        do {
            let uploaded = try await api.uploadDocumentFile(picked.data, name: picked.name, mime: picked.mime)
            file = (uploaded.id, picked.name)
            failure = nil
        } catch {
            failure = error.userMessage
        }
    }

    @MainActor
    private func save() async {
        isSaving = true
        defer { isSaving = false }
        let trimmedNumber = number.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
        let input = StaffResultInput(
            type: type,
            fileId: needsFile ? file?.id : nil,
            documentType: needsFile && file != nil ? documentType : nil,
            documentNumber: trimmedNumber.isEmpty ? nil : String(trimmedNumber.prefix(100)),
            note: trimmedNote.isEmpty ? nil : String(trimmedNote.prefix(2000))
        )
        do {
            try await api.addResult(applicationID, input)
            await done(String(localized: "staff.app.resultAdded", defaultValue: "Результат добавлен"))
            dismiss()
        } catch {
            failure = error.userMessage
        }
    }

    @MainActor
    private func issueCertificate() async {
        isSaving = true
        defer { isSaving = false }
        do {
            let answer = try await api.issueCertificate(applicationID)
            // Код проверки показываем сразу: его можно продиктовать студенту.
            await done(String(
                localized: "staff.app.certificate.issued",
                defaultValue: "Справка выдана. Код проверки: \(answer.verificationCode)"
            ))
            dismiss()
        } catch let error as APIError where error.code == .conflict {
            failure = String(
                localized: "staff.app.certificate.already",
                defaultValue: "Справка по этой заявке уже выдана. Чтобы выпустить новую, сначала отзовите прежнюю"
            )
        } catch {
            failure = error.userMessage
        }
    }
}
