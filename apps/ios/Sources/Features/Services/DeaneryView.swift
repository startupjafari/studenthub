import SwiftUI

/// Запись в деканат: свои записи со статусами и новая запись с желаемым временем.
/// Время — пожелание: деканат подтверждает или переносит, и экран показывает итог.
///
/// Подача — как список чатов: значок вопроса, вид обращения, время справа, тема ниже,
/// статус плашкой. Действующие записи — сверху, состоявшиеся и отменённые — архивом.
struct DeaneryView: View {
    @State private var items: [DeaneryAppointmentDTO]?
    @State private var failure: String?
    @State private var isOffline = false
    @State private var actionFailure: String?
    @State private var creating = false
    @State private var cancelling: DeaneryAppointmentDTO?

    private let api: UniversityServicesFetching = UniversityServicesAPI()

    var body: some View {
        List {
            if let items {
                let active = items.filter(\.isCancellable)
                let archive = items.filter { !$0.isCancellable }
                if !active.isEmpty {
                    Section {
                        ForEach(active) { row($0) }
                    } header: {
                        Text(String(localized: "deanery.section.active", defaultValue: "Действующие"))
                    } footer: {
                        Text(String(localized: "deanery.swipeHint", defaultValue: "Смахните запись влево, чтобы отменить её."))
                    }
                }
                if !archive.isEmpty {
                    Section {
                        ForEach(archive) { row($0) }
                    } header: {
                        Text(String(localized: "deanery.section.archive", defaultValue: "Архив"))
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .screenState(items?.isEmpty != false) {
            if items != nil {
                EmptyStateView(
                    title: String(localized: "deanery.empty", defaultValue: "Записей пока нет"),
                    symbol: "building.columns",
                    hint: String(localized: "deanery.empty.hint", defaultValue: "Запишитесь на приём — деканат подтвердит время"),
                    actionTitle: String(localized: "deanery.new", defaultValue: "Записаться"),
                    action: { creating = true }
                )
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .navigationTitle(Text(MoreSection.deanery.title))
        .floatingAction(String(localized: "deanery.new", defaultValue: "Записаться"), symbol: "calendar.badge.plus") {
            creating = true
        }
        .sheet(isPresented: $creating) {
            NewAppointmentView { await load() }
                .presentationDetents([.medium, .large])
        }
        .confirmDestructive(
            $cancelling,
            title: { _ in String(localized: "deanery.cancel.confirm", defaultValue: "Отменить запись в деканат?") },
            actionTitle: String(localized: "deanery.cancel", defaultValue: "Отменить запись")
        ) { item in
            await cancel(item)
        }
        .actionFailureAlert($actionFailure)
        .refreshable { await load() }
        .task { await load() }
    }

    private func row(_ item: DeaneryAppointmentDTO) -> some View {
        NavigationLink {
            AppointmentDetailView(item: item) { await load() }
        } label: {
            AppointmentRow(item: item)
        }
        .swipeActions {
            if item.isCancellable {
                Button(role: .destructive) {
                    cancelling = item
                } label: {
                    Label(String(localized: "common.cancelAction", defaultValue: "Отменить"), systemImage: "xmark")
                }
            }
        }
        .contextMenu {
            if item.isCancellable {
                Button(role: .destructive) {
                    cancelling = item
                } label: {
                    Label(String(localized: "deanery.cancel", defaultValue: "Отменить запись"), systemImage: "xmark")
                }
            }
        }
    }

    @MainActor
    private func load() async {
        do {
            items = try await api.myAppointments()
            failure = nil
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    @MainActor
    private func cancel(_ item: DeaneryAppointmentDTO) async {
        do {
            try await api.cancelAppointment(id: item.id)
            await load()
        } catch {
            actionFailure = error.userMessage
        }
    }
}

enum DeaneryText {
    static let types = ["CONSULTATION", "DOCUMENT", "ACADEMIC", "OTHER"]

    static func type(_ raw: String) -> String {
        switch raw {
        case "CONSULTATION": return String(localized: "deanery.type.consultation", defaultValue: "Консультация")
        case "DOCUMENT": return String(localized: "deanery.type.document", defaultValue: "Документы")
        case "ACADEMIC": return String(localized: "deanery.type.academic", defaultValue: "Учебный вопрос")
        default: return String(localized: "deanery.type.other", defaultValue: "Другое")
        }
    }

    /// Значок вида обращения — как аватар чата: по нему запись находят глазами.
    static func symbol(_ raw: String) -> String {
        switch raw {
        case "CONSULTATION": return "bubble.left.and.bubble.right.fill"
        case "DOCUMENT": return "doc.text.fill"
        case "ACADEMIC": return "graduationcap.fill"
        default: return "questionmark.bubble.fill"
        }
    }

    static func tint(_ raw: String) -> Color {
        switch raw {
        case "CONSULTATION": return TileTint.teal
        case "DOCUMENT": return TileTint.orange
        case "ACADEMIC": return TileTint.indigo
        default: return TileTint.gray
        }
    }

    static func status(_ raw: String) -> (String, Color) {
        switch raw {
        case "REQUESTED": return (String(localized: "deanery.status.requested", defaultValue: "Ждёт подтверждения"), Palette.warning)
        case "CONFIRMED": return (String(localized: "deanery.status.confirmed", defaultValue: "Подтверждена"), Palette.success)
        case "RESCHEDULED": return (String(localized: "deanery.status.rescheduled", defaultValue: "Перенесена"), Palette.info)
        case "COMPLETED": return (String(localized: "deanery.status.completed", defaultValue: "Состоялась"), Palette.mutedForeground)
        default: return (String(localized: "deanery.status.cancelled", defaultValue: "Отменена"), Palette.mutedForeground)
        }
    }
}

/// Строка записи как строка чата: вид обращения, время справа, тема и кто принимает,
/// статус плашкой. Подтверждённое время важнее желаемого — оно и показано.
private struct AppointmentRow: View {
    let item: DeaneryAppointmentDTO

    var body: some View {
        let status = DeaneryText.status(item.status)
        TelegramStyleRow(
            title: DeaneryText.type(item.type),
            subtitle: details,
            meta: (item.scheduledAt ?? item.requestedAt).formatted(.dateTime.day().month(.abbreviated).hour().minute())
        ) {
            RowSymbol(symbol: DeaneryText.symbol(item.type), tint: DeaneryText.tint(item.type))
        } accessory: {
            StatusBadge(text: status.0, tint: status.1)
        }
    }

    private var details: String {
        [item.topic, item.staffNote, item.assignedTo?.name]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }
}

/// Карточка записи: шапка с видом обращения и статусом, время, тема, ответ деканата,
/// кто принимает; отмена — отдельной красной секцией внизу.
private struct AppointmentDetailView: View {
    let item: DeaneryAppointmentDTO
    let changed: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var confirming = false
    @State private var isWorking = false
    @State private var actionFailure: String?

    private let api: UniversityServicesFetching = UniversityServicesAPI()

    var body: some View {
        let status = DeaneryText.status(item.status)
        List {
            HeroHeader(
                visual: .symbol(DeaneryText.symbol(item.type), tint: DeaneryText.tint(item.type)),
                title: DeaneryText.type(item.type),
                subtitle: status.0,
                subtitleTint: status.1
            )

            Section {
                if let scheduled = item.scheduledAt {
                    DetailRow(
                        title: String(localized: "deanery.detail.scheduled", defaultValue: "Назначено"),
                        value: Self.full(scheduled),
                        symbol: "calendar.badge.checkmark"
                    )
                }
                DetailRow(
                    title: String(localized: "deanery.when", defaultValue: "Удобное время"),
                    value: Self.full(item.requestedAt),
                    symbol: "clock"
                )
                DetailRow(
                    title: String(localized: "deanery.detail.created", defaultValue: "Запись создана"),
                    value: DisplayFormat.dateTime(item.createdAt),
                    symbol: "paperplane"
                )
            }

            if let topic = item.topic?.trimmingCharacters(in: .whitespacesAndNewlines), !topic.isEmpty {
                Section {
                    Text(topic)
                        .font(Typography.body)
                        .foregroundStyle(Palette.foreground)
                        .textSelection(.enabled)
                } header: {
                    Text(String(localized: "deanery.detail.topic", defaultValue: "О чём вопрос"))
                }
            }

            if let note = item.staffNote?.trimmingCharacters(in: .whitespacesAndNewlines), !note.isEmpty {
                Section {
                    Text(note)
                        .font(Typography.body)
                        .foregroundStyle(Palette.foreground)
                        .textSelection(.enabled)
                } header: {
                    Text(String(localized: "deanery.detail.note", defaultValue: "Ответ деканата"))
                }
            }

            if let staff = item.assignedTo {
                Section {
                    NavigationLink(value: AppRoute.profile(id: staff.id)) {
                        PersonRow(name: staff.name, avatarURL: staff.avatarUrl)
                    }
                } header: {
                    Text(String(localized: "deanery.detail.staff", defaultValue: "Принимает"))
                }
            }

            if item.isCancellable {
                Section {
                    Button(role: .destructive) {
                        confirming = true
                    } label: {
                        HStack {
                            Label(String(localized: "deanery.cancel", defaultValue: "Отменить запись"), systemImage: "xmark.circle")
                            Spacer()
                            if isWorking { ProgressView() }
                        }
                    }
                    .foregroundStyle(Palette.destructive)
                    .disabled(isWorking)
                }
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .navigationTitle(Text(String(localized: "deanery.detail.title", defaultValue: "Запись")))
        .navigationBarTitleDisplayMode(.inline)
        .alert(
            String(localized: "deanery.cancel.confirm", defaultValue: "Отменить запись в деканат?"),
            isPresented: $confirming
        ) {
            Button(String(localized: "deanery.cancel", defaultValue: "Отменить запись"), role: .destructive) {
                Task { await cancel() }
            }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
        }
        .actionFailureAlert($actionFailure)
    }

    private static func full(_ date: Date) -> String {
        date.formatted(.dateTime.weekday(.wide).day().month(.wide).hour().minute())
    }

    @MainActor
    private func cancel() async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await api.cancelAppointment(id: item.id)
            await changed()
            dismiss()
        } catch {
            actionFailure = error.userMessage
        }
    }
}

/// Новая запись: вид вопроса, удобное время, коротко о сути.
private struct NewAppointmentView: View {
    let created: () async -> Void

    @State private var type = "OTHER"
    @State private var date = Calendar.current.date(byAdding: .day, value: 1, to: Date().rounded(minutes: 30)) ?? Date()
    @State private var topic = ""

    var body: some View {
        FormSheet(
            title: String(localized: "deanery.new", defaultValue: "Записаться"),
            saveTitle: String(localized: "deanery.send", defaultValue: "Отправить"),
            save: save,
            saved: created
        ) {
            Section {
                Picker(String(localized: "deanery.type", defaultValue: "Вопрос"), selection: $type) {
                    ForEach(DeaneryText.types, id: \.self) { value in
                        Label(DeaneryText.type(value), systemImage: DeaneryText.symbol(value)).tag(value)
                    }
                }
                DatePicker(String(localized: "deanery.when", defaultValue: "Удобное время"), selection: $date, in: Date()...)
            } footer: {
                Text(String(localized: "deanery.footer", defaultValue: "Время — пожелание. Деканат подтвердит его или предложит другое."))
            }
            Section {
                TextField(String(localized: "deanery.topic", defaultValue: "Коротко о вопросе"), text: $topic, axis: .vertical)
                    .lineLimit(3...6)
            }
        }
    }

    private func save() async throws {
        let trimmed = topic.trimmingCharacters(in: .whitespacesAndNewlines)
        try await UniversityServicesAPI().requestAppointment(
            type: type,
            at: date,
            topic: trimmed.isEmpty ? nil : String(trimmed.prefix(1000))
        )
    }
}
