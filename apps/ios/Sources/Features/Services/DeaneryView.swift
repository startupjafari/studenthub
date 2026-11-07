import SwiftUI

/// Запись в деканат: свои записи со статусами и новая запись с желаемым временем.
/// Время — пожелание: деканат подтверждает или переносит, и экран показывает итог.
struct DeaneryView: View {
    @State private var items: [DeaneryAppointmentDTO]?
    @State private var failure: String?
    @State private var actionFailure: String?
    @State private var creating = false
    @State private var cancelling: DeaneryAppointmentDTO?

    private let api: UniversityServicesFetching = UniversityServicesAPI()

    var body: some View {
        List {
            if let items {
                if items.isEmpty {
                    EmptyStateView(
                        title: String(localized: "deanery.empty", defaultValue: "Записей пока нет"),
                        symbol: "building.columns",
                        hint: String(localized: "deanery.empty.hint", defaultValue: "Запишитесь на приём — деканат подтвердит время"),
                        actionTitle: String(localized: "deanery.new", defaultValue: "Записаться"),
                        action: { creating = true }
                    )
                    .listRowBackground(Color.clear)
                }
                ForEach(items) { item in
                    AppointmentRow(item: item)
                        .listRowBackground(Palette.card)
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
            } else if let failure {
                ErrorStateView(message: failure) { await load() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(MoreSection.deanery.title))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    creating = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel(Text(String(localized: "deanery.new", defaultValue: "Записаться")))
            }
        }
        .sheet(isPresented: $creating) {
            NewAppointmentView { await load() }
        }
        .confirmationDialog(
            String(localized: "deanery.cancel.confirm", defaultValue: "Отменить запись в деканат?"),
            isPresented: Binding(get: { cancelling != nil }, set: { if !$0 { cancelling = nil } }),
            titleVisibility: .visible
        ) {
            Button(String(localized: "deanery.cancel", defaultValue: "Отменить запись"), role: .destructive) {
                if let item = cancelling { Task { await cancel(item) } }
            }
        }
        .actionFailureAlert($actionFailure)
        .refreshable { await load() }
        .task { await load() }
    }

    @MainActor
    private func load() async {
        do {
            items = try await api.myAppointments()
            failure = nil
        } catch {
            failure = error.userMessage
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

private struct AppointmentRow: View {
    let item: DeaneryAppointmentDTO

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text(DeaneryText.type(item.type))
                    .font(Typography.cardTitle)
                    .foregroundStyle(Palette.foreground)
                Spacer(minLength: Spacing.md)
                let status = DeaneryText.status(item.status)
                StatusBadge(text: status.0, tint: status.1)
            }
            // Подтверждённое время важнее желаемого: оно и идёт первым.
            Label {
                Text(item.scheduledAt ?? item.requestedAt, format: .dateTime.weekday(.abbreviated).day().month().hour().minute())
            } icon: {
                Image(systemName: item.scheduledAt == nil ? "clock" : "calendar.badge.checkmark")
            }
            if let topic = item.topic, !topic.isEmpty {
                Text(topic).foregroundStyle(Palette.foreground)
            }
            if let note = item.staffNote, !note.isEmpty {
                Label(note, systemImage: "text.bubble")
            }
            if let staff = item.assignedTo {
                Label(staff.name, systemImage: "person")
            }
        }
        .font(Typography.meta)
        .foregroundStyle(Palette.mutedForeground)
        .padding(.vertical, Spacing.xs)
        .accessibilityElement(children: .combine)
    }
}

private struct NewAppointmentView: View {
    let created: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var type = "OTHER"
    @State private var date = Calendar.current.date(byAdding: .day, value: 1, to: Date().rounded(minutes: 30)) ?? Date()
    @State private var topic = ""
    @State private var failure: String?
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                if let failure {
                    FormAlert(message: failure).listRowBackground(Color.clear)
                }
                Section {
                    Picker(String(localized: "deanery.type", defaultValue: "Вопрос"), selection: $type) {
                        ForEach(DeaneryText.types, id: \.self) { Text(DeaneryText.type($0)).tag($0) }
                    }
                    DatePicker(String(localized: "deanery.when", defaultValue: "Удобное время"), selection: $date, in: Date()...)
                    TextField(String(localized: "deanery.topic", defaultValue: "Коротко о вопросе"), text: $topic, axis: .vertical)
                        .lineLimit(3...6)
                } footer: {
                    Text(String(localized: "deanery.footer", defaultValue: "Время — пожелание. Деканат подтвердит его или предложит другое."))
                }
                .listRowBackground(Palette.card)
            }
            .scrollContentBackground(.hidden)
            .background(Palette.background)
            .navigationTitle(Text(String(localized: "deanery.new", defaultValue: "Записаться")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "common.cancel", defaultValue: "Отмена")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "deanery.send", defaultValue: "Отправить")) {
                        Task { await save() }
                    }
                    .disabled(isSaving)
                }
            }
        }
    }

    @MainActor
    private func save() async {
        isSaving = true
        defer { isSaving = false }
        let trimmed = topic.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            try await UniversityServicesAPI().requestAppointment(
                type: type,
                at: date,
                topic: trimmed.isEmpty ? nil : String(trimmed.prefix(1000))
            )
            await created()
            dismiss()
        } catch {
            failure = error.userMessage
        }
    }
}
