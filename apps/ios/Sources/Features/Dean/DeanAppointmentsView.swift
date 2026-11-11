import SwiftUI

/// Очередь записи в деканат: открытые записи (ближайший приём сверху) и архив (свежий
/// сверху). Действия — по той же таблице переходов, что проверяет сервер: «Завершить»
/// неподтверждённую или «Подтвердить» подтверждённую упирались бы в 409.
struct DeanAppointmentsView: View {
    private enum Tab: String, Hashable { case active, closed }

    @State private var tab: Tab? = .active
    @State private var loader: PagedLoader<DeanAppointment>
    @State private var scheduling: Scheduling?
    @State private var completing: DeanAppointment?
    @State private var cancelling: DeanAppointment?
    @State private var actionFailure: String?
    @State private var opened: DeanAppointment?
    /// Действие, выбранное в карточке записи: выполняется, когда карточка закроется, —
    /// второй лист поверх закрывающегося iOS не покажет.
    @State private var afterCard: (() -> Void)?

    private let api = DeanAPI()
    private static let pageSize = 100

    struct Scheduling: Identifiable {
        let appointment: DeanAppointment
        let reschedule: Bool
        var id: String { appointment.id + (reschedule ? ":r" : ":c") }
    }

    init() {
        _loader = State(initialValue: Self.makeLoader(view: "active"))
    }

    private static func makeLoader(view: String) -> PagedLoader<DeanAppointment> {
        PagedLoader(limit: pageSize, fetch: makeFetch(view: view))
    }

    /// Очередь отдаёт массив, а следующую порцию просит по id последней записи —
    /// курсор собираем сами и отдаём загрузчику через `meta`.
    private static func makeFetch(view: String) -> (PageRequest) async throws -> Page<DeanAppointment> {
        let api = DeanAPI()
        return { request in
            let items = try await api.appointmentQueue(view: view, cursor: request.page == 1 ? nil : request.cursor, limit: request.limit)
            return Page(
                items: items,
                meta: APIMeta(cursor: items.last?.id, hasNext: items.count == request.limit, total: nil, prevCursor: nil, hasPrev: nil)
            )
        }
    }

    var body: some View {
        PagedList(
            loader: loader,
            empty: tab == .closed
                ? EmptyStateView(title: String(localized: "dean.appointments.archiveEmpty", defaultValue: "Архив пуст"), symbol: "archivebox")
                : EmptyStateView(
                    title: String(localized: "dean.appointments.empty", defaultValue: "Записей нет"),
                    symbol: "calendar.badge.clock",
                    hint: String(localized: "dean.appointments.emptyHint", defaultValue: "Студенты записываются на приём в разделе «Сервисы»")
                ),
            header: {
                FilterChipsRow(
                    options: [
                        (Tab.active, String(localized: "dean.appointments.active", defaultValue: "Очередь")),
                        (Tab.closed, String(localized: "dean.appointments.closed", defaultValue: "Архив")),
                    ],
                    selection: $tab
                )
            },
            row: { item in
                Button {
                    opened = item
                } label: {
                    DeanAppointmentRow(item: item)
                }
                .buttonStyle(.plain)
                .swipeActions(edge: .trailing) {
                    if item.can("CANCELLED") {
                        Button(role: .destructive) {
                            cancelling = item
                        } label: {
                            Label(String(localized: "dean.appointments.cancel", defaultValue: "Отменить"), systemImage: "xmark")
                        }
                    }
                    if item.can("RESCHEDULED") {
                        Button {
                            scheduling = Scheduling(appointment: item, reschedule: true)
                        } label: {
                            Label(String(localized: "dean.appointments.reschedule", defaultValue: "Перенести"), systemImage: "clock.arrow.circlepath")
                        }
                        .tint(Palette.info)
                    }
                }
                .swipeActions(edge: .leading) {
                    if item.can("CONFIRMED") {
                        Button {
                            scheduling = Scheduling(appointment: item, reschedule: false)
                        } label: {
                            Label(String(localized: "dean.appointments.confirm", defaultValue: "Подтвердить"), systemImage: "checkmark")
                        }
                        .tint(Palette.success)
                    } else if item.can("COMPLETED") {
                        Button {
                            completing = item
                        } label: {
                            Label(String(localized: "dean.appointments.complete", defaultValue: "Завершить"), systemImage: "checkmark.seal")
                        }
                        .tint(Palette.success)
                    }
                }
                .contextMenu { menu(item) }
            }
        )
        .navigationTitle(Text(DeanScreen.appointments.title))
        .onChange(of: tab) { _, newValue in
            Task { await loader.replace(fetch: Self.makeFetch(view: (newValue ?? .active).rawValue)) }
        }
        .sheet(item: $opened, onDismiss: {
            let action = afterCard
            afterCard = nil
            action?()
        }) { item in
            DeanAppointmentCard(item: item, actions: cardActions(item)) {
                cardMenu(item)
            }
            .presentationDetents([.medium, .large])
        }
        .sheet(item: $scheduling) { item in
            DeanAppointmentScheduleForm(appointment: item.appointment, reschedule: item.reschedule) {
                await loader.reload()
            }
        }
        .confirmationDialog(
            String(localized: "dean.appointments.completeTitle", defaultValue: "Завершить приём?"),
            isPresented: Binding(get: { completing != nil }, set: { if !$0 { completing = nil } }),
            titleVisibility: .visible,
            presenting: completing
        ) { item in
            Button(String(localized: "dean.appointments.complete", defaultValue: "Завершить")) {
                Task { await run(item) { try await api.completeAppointment(id: item.id) } }
            }
        } message: { _ in
            Text(String(localized: "dean.appointments.completeHint", defaultValue: "Запись уйдёт в архив, студент получит уведомление."))
        }
        .confirmDestructive(
            $cancelling,
            title: { String(localized: "dean.appointments.cancelTitle", defaultValue: "Отменить запись \($0.student.name)? Студент получит уведомление.") },
            actionTitle: String(localized: "dean.appointments.cancelAction", defaultValue: "Отменить запись")
        ) { item in
            await run(item) { try await api.cancelAppointment(id: item.id) }
        }
        .actionFailureAlert($actionFailure)
    }

    @ViewBuilder
    private func menu(_ item: DeanAppointment) -> some View {
        if item.can("CONFIRMED") {
            Button {
                scheduling = Scheduling(appointment: item, reschedule: false)
            } label: {
                Label(String(localized: "dean.appointments.confirm", defaultValue: "Подтвердить"), systemImage: "checkmark.circle")
            }
        }
        if item.can("RESCHEDULED") {
            Button {
                scheduling = Scheduling(appointment: item, reschedule: true)
            } label: {
                Label(String(localized: "dean.appointments.reschedule", defaultValue: "Перенести"), systemImage: "clock")
            }
        }
        if item.can("COMPLETED") {
            Button {
                completing = item
            } label: {
                Label(String(localized: "dean.appointments.complete", defaultValue: "Завершить"), systemImage: "checkmark.seal")
            }
        }
        if item.can("CANCELLED") {
            Button(role: .destructive) {
                cancelling = item
            } label: {
                Label(String(localized: "dean.appointments.cancelAction", defaultValue: "Отменить запись"), systemImage: "xmark.circle")
            }
        }
        NavigationLink(value: AppRoute.dean(.student(id: item.student.id))) {
            Label(String(localized: "dean.appointments.openStudent", defaultValue: "Карточка студента"), systemImage: "person")
        }
    }

    // MARK: Карточка записи

    /// Закрыть карточку и выполнить действие после — формы и подтверждения живут здесь.
    private func later(_ action: @escaping () -> Void) {
        afterCard = action
        opened = nil
    }

    private func cardActions(_ item: DeanAppointment) -> [HeroAction] {
        var list: [HeroAction] = []
        if item.can("CONFIRMED") {
            list.append(HeroAction(title: String(localized: "dean.appointments.confirm", defaultValue: "Подтвердить"), symbol: "checkmark") {
                later { scheduling = Scheduling(appointment: item, reschedule: false) }
            })
        } else if item.can("COMPLETED") {
            list.append(HeroAction(title: String(localized: "dean.appointments.complete", defaultValue: "Завершить"), symbol: "checkmark.seal") {
                later { completing = item }
            })
        }
        if item.can("RESCHEDULED") {
            list.append(HeroAction(title: String(localized: "dean.appointments.reschedule", defaultValue: "Перенести"), symbol: "clock.arrow.circlepath") {
                later { scheduling = Scheduling(appointment: item, reschedule: true) }
            })
        }
        list.append(HeroAction(title: String(localized: "dean.contact.message", defaultValue: "Написать"), symbol: "bubble.left.fill") {
            later { Task { await openChat(item.student.id) } }
        })
        return list
    }

    @HeroMenuBuilder
    private func cardMenu(_ item: DeanAppointment) -> [HeroMenuElement] {
        HeroMenuItem(String(localized: "dean.appointments.openStudent", defaultValue: "Карточка студента"), symbol: "person") {
            later { DeanNav.push(.dean(.student(id: item.student.id))) }
        }
        if item.can("CANCELLED") {
            HeroMenuItem(String(localized: "dean.appointments.cancelAction", defaultValue: "Отменить запись"), symbol: "xmark.circle", isDestructive: true) {
                later { cancelling = item }
            }
        }
    }

    @MainActor
    private func openChat(_ userID: String) async {
        do {
            try await DeanNav.openChat(userID: userID)
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func run(_ item: DeanAppointment, _ action: () async throws -> Void) async {
        do {
            try await action()
            await loader.reload()
        } catch {
            actionFailure = error.userMessage
        }
    }
}

/// Запись строкой, как чат: значок вида вопроса, студент, время справа, вопрос и тема
/// ниже, статус — плашкой.
private struct DeanAppointmentRow: View {
    let item: DeanAppointment

    var body: some View {
        TelegramStyleRow(title: item.student.name, subtitle: subtitle, meta: when) {
            RowSymbol(symbol: DeaneryText.symbol(item.type), tint: DeaneryText.tint(item.type), size: 48)
        } accessory: {
            StatusBadge(text: status.0, tint: status.1)
        }
        .contentShape(Rectangle())
    }

    private var status: (String, Color) { DeaneryText.status(item.status) }

    private var when: String {
        item.when.formatted(.dateTime.day().month(.abbreviated).hour().minute())
    }

    private var subtitle: String {
        var line = DeaneryText.type(item.type)
        // Пока приём не назначен, в строке стоит пожелание студента — без пометки
        // его легко принять за подтверждённое время.
        if item.scheduledAt == nil {
            line += " · " + String(localized: "dean.appointments.requested", defaultValue: "желаемое время")
        }
        guard let topic = item.topic, !topic.isEmpty else { return line }
        return line + "\n" + topic
    }
}

/// Карточка записи: студент по центру, вопрос и время, действия кругами — как профиль
/// в Telegram. Действия собирает список: формы и подтверждения показывает он, когда
/// карточка закроется.
private struct DeanAppointmentCard: View {
    let item: DeanAppointment
    let actions: [HeroAction]
    @HeroMenuBuilder let moreMenu: () -> [HeroMenuElement]

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                HeroHeader(
                    visual: .symbol(DeaneryText.symbol(item.type), tint: DeaneryText.tint(item.type)),
                    title: item.student.name,
                    subtitle: DeaneryText.type(item.type),
                    actions: actions,
                    badges: {
                        StatusBadge(text: status.0, tint: status.1)
                    },
                    moreMenu: moreMenu
                )

                Section {
                    DetailRow(title: timeTitle, value: DisplayFormat.dateTime(item.when), symbol: "calendar")
                    if item.scheduledAt != nil {
                        DetailRow(
                            title: String(localized: "dean.appointments.wanted", defaultValue: "Желаемое время"),
                            value: DisplayFormat.dateTime(item.requestedAt),
                            symbol: "clock"
                        )
                    }
                    if let topic = item.topic, !topic.isEmpty {
                        DetailRow(title: String(localized: "dean.appointments.topic", defaultValue: "Тема"), value: topic, symbol: "text.alignleft")
                    }
                    if let note = item.staffNote, !note.isEmpty {
                        DetailRow(title: String(localized: "dean.appointments.note", defaultValue: "Комментарий студенту"), value: note, symbol: "text.bubble")
                    }
                    if let staff = item.assignedTo {
                        DetailRow(title: String(localized: "dean.appointments.assigned", defaultValue: "Принимает"), value: staff.name, symbol: "person.badge.shield.checkmark")
                    }
                }
            }
            .listStyle(.insetGrouped)
            .listSectionSpacing(.compact)
            .navigationTitle(Text(String(localized: "dean.appointments.card", defaultValue: "Запись")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
            }
        }
    }

    private var status: (String, Color) { DeaneryText.status(item.status) }

    private var timeTitle: String {
        item.scheduledAt == nil
            ? String(localized: "dean.appointments.wanted", defaultValue: "Желаемое время")
            : String(localized: "dean.appointments.time", defaultValue: "Время приёма")
    }
}

/// Подтвердить или перенести: время приёма и комментарий студенту.
private struct DeanAppointmentScheduleForm: View {
    let appointment: DeanAppointment
    let reschedule: Bool
    let saved: () async -> Void

    @State private var date: Date
    @State private var note: String

    private let api = DeanAPI()

    init(appointment: DeanAppointment, reschedule: Bool, saved: @escaping () async -> Void) {
        self.appointment = appointment
        self.reschedule = reschedule
        self.saved = saved
        _date = State(initialValue: max(appointment.when, Date().rounded(minutes: 15)))
        _note = State(initialValue: appointment.staffNote ?? "")
    }

    var body: some View {
        FormSheet(
            title: reschedule
                ? String(localized: "dean.appointments.rescheduleTitle", defaultValue: "Перенести приём")
                : String(localized: "dean.appointments.confirmTitle", defaultValue: "Подтвердить приём"),
            save: { try await api.confirmAppointment(id: appointment.id, at: date, note: note, reschedule: reschedule) },
            saved: saved
        ) {
            Section {
                DetailRow(title: String(localized: "dean.appointments.student", defaultValue: "Студент"), value: appointment.student.name)
                DetailRow(title: String(localized: "dean.appointments.type", defaultValue: "Вопрос"), value: DeaneryText.type(appointment.type))
                DetailRow(title: String(localized: "dean.appointments.wanted", defaultValue: "Желаемое время"), value: DisplayFormat.dateTime(appointment.requestedAt))
                if let topic = appointment.topic, !topic.isEmpty {
                    Text(topic).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                }
            }
            Section {
                DatePicker(String(localized: "dean.appointments.time", defaultValue: "Время приёма"), selection: $date, in: Date()...)
                TextField(String(localized: "dean.appointments.note", defaultValue: "Комментарий студенту"), text: $note, axis: .vertical)
                    .lineLimit(2...5)
            } footer: {
                Text(String(localized: "dean.appointments.formHint", defaultValue: "Студент получит уведомление с назначенным временем и комментарием."))
            }
        }
    }
}
