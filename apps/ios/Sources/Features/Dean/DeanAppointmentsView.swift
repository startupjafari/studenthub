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
                DeanAppointmentRow(item: item)
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

private struct DeanAppointmentRow: View {
    let item: DeanAppointment

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text(item.student.name).font(Typography.cardTitle).foregroundStyle(Palette.foreground)
                Spacer(minLength: Spacing.md)
                let status = DeaneryText.status(item.status)
                StatusBadge(text: status.0, tint: status.1)
            }
            Text(DeaneryText.type(item.type))
            Label {
                VStack(alignment: .leading, spacing: 0) {
                    Text(item.when, format: .dateTime.weekday(.abbreviated).day().month().hour().minute())
                    // Пока приём не назначен, в строке стоит пожелание студента — без пометки
                    // его легко принять за подтверждённое время.
                    if item.scheduledAt == nil {
                        Text(String(localized: "dean.appointments.requested", defaultValue: "желаемое время")).font(.caption)
                    }
                }
            } icon: {
                Image(systemName: item.scheduledAt == nil ? "clock" : "calendar.badge.checkmark")
            }
            if let topic = item.topic, !topic.isEmpty {
                Text(topic).foregroundStyle(Palette.foreground).lineLimit(4)
            }
            if let note = item.staffNote, !note.isEmpty {
                Label(note, systemImage: "text.bubble")
            }
            if let staff = item.assignedTo {
                Label(staff.name, systemImage: "person.badge.shield.checkmark")
            }
        }
        .font(Typography.meta)
        .foregroundStyle(Palette.mutedForeground)
        .padding(.vertical, Spacing.xs)
        .accessibilityElement(children: .combine)
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
            .listRowBackground(Palette.card)
            Section {
                DatePicker(String(localized: "dean.appointments.time", defaultValue: "Время приёма"), selection: $date, in: Date()...)
                TextField(String(localized: "dean.appointments.note", defaultValue: "Комментарий студенту"), text: $note, axis: .vertical)
                    .lineLimit(2...5)
            } footer: {
                Text(String(localized: "dean.appointments.formHint", defaultValue: "Студент получит уведомление с назначенным временем и комментарием."))
            }
            .listRowBackground(Palette.card)
        }
    }
}
