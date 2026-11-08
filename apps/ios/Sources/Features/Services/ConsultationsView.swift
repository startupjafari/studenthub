import SwiftUI

/// Консультации. Студент видит свои записи и преподавателей со свободными окнами;
/// преподаватель — свои окна и кто на них записан, и открывает новые.
struct ConsultationsView: View {
    let role: Role

    @State private var mine: [ConsultationSlotDTO]?
    @State private var teachers: [ConsultationTeacherDTO]?
    @State private var failure: String?
    @State private var actionFailure: String?
    @State private var creating = false
    /// «Предстоящие» или «Все», как переключатель в вебе: прошедшие нужны, чтобы
    /// вспомнить, кто приходил и о чём.
    @State private var showsPast = false

    private let api: UniversityServicesFetching = UniversityServicesAPI()
    private var isTeacher: Bool { role == .teacher }

    var body: some View {
        List {
            Picker(String(localized: "consultations.range", defaultValue: "Период"), selection: $showsPast) {
                Text(String(localized: "consultations.upcoming", defaultValue: "Предстоящие")).tag(false)
                Text(String(localized: "consultations.all", defaultValue: "Все")).tag(true)
            }
            .pickerStyle(.segmented)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())

            if let mine {
                Section {
                    if mine.isEmpty {
                        Text(isTeacher
                            ? String(localized: "consultations.noSlots", defaultValue: "Открытых окон нет")
                            : String(localized: "consultations.noBookings", defaultValue: "Вы пока ни к кому не записаны"))
                            .font(Typography.body)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    ForEach(mine) { slot in
                        SlotRow(slot: slot, showsTeacher: !isTeacher, showsStudent: isTeacher)
                            .swipeActions {
                                if slot.status != "CANCELLED" {
                                    Button(role: .destructive) {
                                        Task { await cancel(slot) }
                                    } label: {
                                        Label(String(localized: "common.cancelAction", defaultValue: "Отменить"), systemImage: "xmark")
                                    }
                                }
                            }
                    }
                } header: {
                    Text(isTeacher
                        ? String(localized: "consultations.mySlots", defaultValue: "Мои окна")
                        : String(localized: "consultations.myBookings", defaultValue: "Мои записи"))
                } footer: {
                    if !mine.isEmpty {
                        Text(String(localized: "consultations.swipeHint", defaultValue: "Смахните влево, чтобы отменить."))
                    }
                }
            }

            if !isTeacher, let teachers {
                Section {
                    if teachers.isEmpty {
                        Text(String(localized: "consultations.noTeachers", defaultValue: "Свободных окон у преподавателей сейчас нет"))
                            .font(Typography.body)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    ForEach(teachers) { teacher in
                        NavigationLink {
                            TeacherSlotsView(teacher: teacher) { await load() }
                        } label: {
                            HStack(spacing: Spacing.lg) {
                                AvatarView(url: teacher.avatarUrl, name: teacher.name, size: 40)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(teacher.name).font(Typography.body)
                                    Text(String(localized: "consultations.openSlots", defaultValue: "Свободных окон: \(teacher.openSlots)"))
                                        .font(Typography.meta)
                                        .foregroundStyle(Palette.mutedForeground)
                                }
                            }
                        }
                    }
                } header: {
                    Text(String(localized: "consultations.teachers", defaultValue: "Записаться к преподавателю"))
                }
            }

            if mine == nil {
                if let failure {
                    ErrorStateView(message: failure) { await load() }
                        .listRowBackground(Color.clear)
                } else {
                    LoadingStateView().listRowBackground(Color.clear)
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(MoreSection.consultations.title))
        .toolbar {
            if isTeacher {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        creating = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel(Text(String(localized: "consultations.newSlot", defaultValue: "Новое окно")))
                }
            }
        }
        .sheet(isPresented: $creating) {
            NewSlotView { await load() }
        }
        .refreshable { await load() }
        .task(id: showsPast) { await load() }
        .actionFailureAlert($actionFailure)
    }

    @MainActor
    private func load() async {
        do {
            async let slots = showsPast ? UniversityServicesAPI().allConsultations() : api.myConsultations()
            if !isTeacher {
                teachers = try await api.consultationTeachers()
            }
            mine = try await slots
            failure = nil
        } catch {
            failure = error.userMessage
        }
    }

    @MainActor
    private func cancel(_ slot: ConsultationSlotDTO) async {
        do {
            // Преподаватель удаляет свободное окно; занятое — отменяет, чтобы студент
            // получил уведомление, а не потерял запись молча.
            if isTeacher, slot.status == "OPEN" {
                try await api.deleteSlot(id: slot.id)
            } else {
                try await api.cancel(slotID: slot.id)
            }
            await load()
        } catch {
            actionFailure = error.userMessage
        }
    }
}

/// Строка окна: время, место, с кем.
private struct SlotRow: View {
    let slot: ConsultationSlotDTO
    var showsTeacher = false
    var showsStudent = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack {
                Text(slot.startsAt, format: .dateTime.weekday(.abbreviated).day().month(.abbreviated).hour().minute())
                    .font(Typography.body.weight(.medium))
                Text(verbatim: "–")
                Text(slot.endsAt, format: .dateTime.hour().minute())
                    .font(Typography.body)
                Spacer(minLength: 0)
                StatusBadge(text: Self.statusTitle(slot.status), tint: Self.statusTint(slot.status))
            }
            if showsTeacher, let teacher = slot.teacher {
                Label(teacher.name, systemImage: "person")
            }
            if showsStudent, let student = slot.student {
                Label(student.name, systemImage: "person")
            }
            if slot.isOnline == true {
                Label(String(localized: "consultations.online", defaultValue: "Онлайн"), systemImage: "video")
            } else if let location = slot.location, !location.isEmpty {
                Label(location, systemImage: "mappin.and.ellipse")
            }
            if let topic = slot.topic, !topic.isEmpty {
                Text(topic).foregroundStyle(Palette.foreground)
            }
        }
        .font(Typography.meta)
        .foregroundStyle(Palette.mutedForeground)
        .accessibilityElement(children: .combine)
    }

    static func statusTitle(_ status: String) -> String {
        switch status {
        case "OPEN": return String(localized: "consultations.status.open", defaultValue: "Свободно")
        case "BOOKED": return String(localized: "consultations.status.booked", defaultValue: "Запись")
        default: return String(localized: "consultations.status.cancelled", defaultValue: "Отменено")
        }
    }

    static func statusTint(_ status: String) -> Color {
        switch status {
        case "OPEN": return Palette.success
        case "BOOKED": return Palette.primary
        default: return Palette.mutedForeground
        }
    }
}

/// Свободные окна одного преподавателя: выбрать и записаться с темой.
private struct TeacherSlotsView: View {
    let teacher: ConsultationTeacherDTO
    let changed: () async -> Void

    @State private var slots: [ConsultationSlotDTO]?
    @State private var failure: String?
    @State private var booking: ConsultationSlotDTO?
    @State private var topic = ""

    private let api: UniversityServicesFetching = UniversityServicesAPI()

    var body: some View {
        List {
            if let slots {
                if slots.isEmpty {
                    EmptyStateView(
                        title: String(localized: "consultations.noOpen", defaultValue: "Свободных окон нет"),
                        symbol: "calendar.badge.exclamationmark"
                    )
                    .listRowBackground(Color.clear)
                }
                ForEach(slots) { slot in
                    Button {
                        if slot.status == "OPEN" { booking = slot }
                    } label: {
                        SlotRow(slot: slot)
                    }
                    .buttonStyle(.plain)
                    .disabled(slot.status != "OPEN")
                }
            } else if let failure {
                ErrorStateView(message: failure) { await load() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(teacher.name))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .alert(
            String(localized: "consultations.book", defaultValue: "Записаться"),
            isPresented: Binding(get: { booking != nil }, set: { if !$0 { booking = nil } })
        ) {
            TextField(String(localized: "consultations.topic", defaultValue: "Тема (необязательно)"), text: $topic)
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
            Button(String(localized: "consultations.book", defaultValue: "Записаться")) {
                if let slot = booking { Task { await book(slot) } }
            }
        } message: {
            if let slot = booking {
                Text(slot.startsAt, format: .dateTime.weekday(.wide).day().month().hour().minute())
            }
        }
    }

    @MainActor
    private func load() async {
        do {
            slots = try await api.slots(teacherID: teacher.teacherId)
            failure = nil
        } catch {
            failure = error.userMessage
        }
    }

    @MainActor
    private func book(_ slot: ConsultationSlotDTO) async {
        let trimmed = topic.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            try await api.book(slotID: slot.id, topic: trimmed.isEmpty ? nil : String(trimmed.prefix(500)))
            topic = ""
            await load()
            await changed()
        } catch {
            failure = error.userMessage
        }
    }
}

/// Новое окно преподавателя.
private struct NewSlotView: View {
    let created: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var start = Calendar.current.date(byAdding: .day, value: 1, to: Date().rounded(minutes: 30)) ?? Date()
    @State private var minutes = 30
    @State private var location = ""
    @State private var isOnline = false
    @State private var failure: String?
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                if let failure {
                    FormAlert(message: failure).listRowBackground(Color.clear)
                }
                Section {
                    DatePicker(String(localized: "consultations.start", defaultValue: "Начало"), selection: $start, in: Date()...)
                    Picker(String(localized: "consultations.duration", defaultValue: "Длительность"), selection: $minutes) {
                        ForEach([15, 30, 45, 60, 90], id: \.self) { value in
                            Text(String(localized: "consultations.minutes", defaultValue: "\(value) мин")).tag(value)
                        }
                    }
                    Toggle(String(localized: "consultations.online", defaultValue: "Онлайн"), isOn: $isOnline)
                    if !isOnline {
                        TextField(String(localized: "consultations.location", defaultValue: "Аудитория или место"), text: $location)
                    }
                }
            }
            .navigationTitle(Text(String(localized: "consultations.newSlot", defaultValue: "Новое окно")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "common.save", defaultValue: "Сохранить")) {
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
        do {
            let end = start.addingTimeInterval(TimeInterval(minutes * 60))
            let place = location.trimmingCharacters(in: .whitespaces)
            try await UniversityServicesAPI().createSlot(
                startsAt: start,
                endsAt: end,
                location: isOnline || place.isEmpty ? nil : String(place.prefix(200)),
                isOnline: isOnline
            )
            await created()
            dismiss()
        } catch {
            failure = error.userMessage
        }
    }
}

/// Плашка статуса: цвет плюс подпись — цветом одним статус не передаём.
struct StatusBadge: View {
    let text: String
    let tint: Color

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, 2)
            .foregroundStyle(tint)
            .background(tint.opacity(0.12), in: Capsule())
    }
}

extension Date {
    /// Ближайшая вперёд отметка, кратная `minutes`: новое окно не начинается в 10:07.
    func rounded(minutes: Int) -> Date {
        let step = TimeInterval(minutes * 60)
        return Date(timeIntervalSinceReferenceDate: (timeIntervalSinceReferenceDate / step).rounded(.up) * step)
    }
}

extension View {
    /// Алерт отказа действия: текст ошибки, кнопка «Понятно».
    func actionFailureAlert(_ message: Binding<String?>) -> some View {
        alert(
            String(localized: "feed.actionFailed", defaultValue: "Не получилось"),
            isPresented: Binding(get: { message.wrappedValue != nil }, set: { if !$0 { message.wrappedValue = nil } })
        ) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        } message: {
            Text(message.wrappedValue ?? "")
        }
    }
}
