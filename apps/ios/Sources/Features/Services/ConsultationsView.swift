import SwiftUI

/// Консультации. Студент видит свои записи и преподавателей со свободными окнами;
/// преподаватель — свои окна и кто на них записан, и открывает новые.
///
/// Подача — как список чатов: аватар того, с кем встреча, день и время, место и тема
/// ниже, статус плашкой. Отмена — смахиванием или долгим нажатием, с подтверждением.
struct ConsultationsView: View {
    let role: Role

    /// Свои записи (или окна) и, студенту, преподаватели со свободными окнами — одним
    /// значением: грузятся вместе и вместе падают.
    @State private var remote = RemoteValue<Loaded>()
    /// Период, ответ на который сейчас на экране: при смене старый список не
    /// показывается под новым переключателем.
    @State private var shownRange: ConsultationRange?
    @State private var actionFailure: String?
    @State private var creating = false
    @State private var cancelling: ConsultationSlotDTO?
    /// «Предстоящие» или «Все», как переключатель в вебе: прошедшие нужны, чтобы
    /// вспомнить, кто приходил и о чём.
    @State private var range: ConsultationRange = .upcoming

    private let api: UniversityServicesFetching = UniversityServicesAPI()
    private var isTeacher: Bool { role == .teacher }

    private struct Loaded {
        var mine: [ConsultationSlotDTO]
        /// Только студенту; у преподавателя — `nil`.
        var teachers: [ConsultationTeacherDTO]?
    }

    private var mine: [ConsultationSlotDTO]? { remote.value?.mine }
    private var teachers: [ConsultationTeacherDTO]? { remote.value?.teachers }
    private var failure: String? { remote.failure }
    private var isOffline: Bool { remote.isOffline }

    var body: some View {
        withCreateButton(list)
    }

    /// Окна открывает только преподаватель — у студента кнопки создания нет.
    @ViewBuilder
    private func withCreateButton<Content: View>(_ content: Content) -> some View {
        if isTeacher {
            content.floatingAction(String(localized: "consultations.newSlot", defaultValue: "Новое окно"), symbol: "calendar.badge.plus") {
                creating = true
            }
        } else {
            content
        }
    }

    private var list: some View {
        List {
            FilterChipsRow(options: ConsultationRange.options, selection: Binding(
                get: { range },
                set: { range = $0 ?? .upcoming }
            ))

            // Обновление не удалось, а записи с прошлого раза на экране — говорим об этом.
            if let failure, mine != nil {
                StaleDataBanner(message: failure, isOffline: isOffline) { await load() }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }

            // У преподавателя секция одна: пустая — состоянием по центру экрана, у студента
            // ниже ещё запись к преподавателям, и пусто показывается строкой секции.
            if let mine, !(isTeacher && mine.isEmpty) {
                Section {
                    if mine.isEmpty {
                        EmptyStateView(
                            title: String(localized: "consultations.noBookings", defaultValue: "Вы пока ни к кому не записаны"),
                            symbol: "person.2.wave.2"
                        )
                        .listRowBackground(Color.clear)
                    }
                    ForEach(mine) { slot in
                        ConsultationSlotRow(slot: slot, person: isTeacher ? slot.student : slot.teacher)
                            .swipeActions {
                                if slot.status != "CANCELLED" {
                                    Button(role: .destructive) {
                                        cancelling = slot
                                    } label: {
                                        Label(String(localized: "common.cancelAction", defaultValue: "Отменить"), systemImage: "xmark")
                                    }
                                }
                            }
                            .contextMenu {
                                if slot.status != "CANCELLED" {
                                    Button(role: .destructive) {
                                        cancelling = slot
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
                        EmptyStateView(
                            title: String(localized: "consultations.noTeachers", defaultValue: "Свободных окон у преподавателей сейчас нет"),
                            symbol: "calendar.badge.exclamationmark"
                        )
                        .listRowBackground(Color.clear)
                    }
                    ForEach(teachers) { teacher in
                        NavigationLink {
                            TeacherSlotsView(teacher: teacher) { await load() }
                        } label: {
                            TelegramStyleRow(
                                title: teacher.name,
                                subtitle: String(localized: "consultations.openSlots", defaultValue: "Свободных окон: \(teacher.openSlots)")
                            ) {
                                AvatarView(url: teacher.avatarUrl, name: teacher.name, size: 44)
                            }
                        }
                    }
                } header: {
                    Text(String(localized: "consultations.teachers", defaultValue: "Записаться к преподавателю"))
                }
            }
        }
        .listStyle(.insetGrouped)
        .screenState(mine == nil || (isTeacher && mine?.isEmpty == true)) {
            if mine != nil {
                EmptyStateView(
                    title: String(localized: "consultations.noSlots", defaultValue: "Открытых окон нет"),
                    symbol: "calendar.badge.plus"
                )
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .navigationTitle(Text(MoreSection.consultations.title))
        .sheet(isPresented: $creating) {
            NewSlotView { await load() }
                .presentationDetents([.medium, .large])
        }
        .confirmDestructive(
            $cancelling,
            title: { slot in
                isTeacher && slot.status == "OPEN"
                    ? String(localized: "consultations.delete.confirm", defaultValue: "Удалить свободное окно?")
                    : String(localized: "consultations.cancel.confirm", defaultValue: "Отменить консультацию?")
            },
            actionTitle: String(localized: "common.cancelAction", defaultValue: "Отменить")
        ) { slot in
            await cancel(slot)
        }
        .pullToRefresh { await load() }
        .task(id: range) {
            // Другой период — прежний список уже не ответ: загрузка с нуля (сохранённое
            // для этого периода — сразу). Возврат на экран обновляет список на месте.
            if shownRange != range {
                remote.reset()
                shownRange = range
            }
            await load()
        }
        // Вернулись из фона после долгой паузы — список перечитывается фоном
        // (`AppLifecycle`), показанное остаётся на месте.
        .onChange(of: AppLifecycle.shared.foregroundEpoch) {
            Task { await load() }
        }
        .actionFailureAlert($actionFailure)
    }

    private func load() async {
        let all = range == .all
        let isTeacher = isTeacher
        let api = api
        await remote.load {
            async let slots = all ? UniversityServicesAPI().allConsultations() : api.myConsultations()
            var teachers: [ConsultationTeacherDTO]?
            if !isTeacher {
                teachers = try await api.consultationTeachers()
            }
            return Loaded(mine: try await slots, teachers: teachers)
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

/// Период списка: предстоящие или все, включая прошедшие.
private enum ConsultationRange: Hashable {
    case upcoming
    case all

    static var options: [(value: ConsultationRange?, title: String)] {
        [
            (.upcoming, String(localized: "consultations.upcoming", defaultValue: "Предстоящие")),
            (.all, String(localized: "consultations.all", defaultValue: "Все")),
        ]
    }
}

/// Строка окна как строка чата: с кем (аватар), день, время справа, место и тема ниже,
/// статус плашкой. Свободное окно без человека — зелёный значок часов.
private struct ConsultationSlotRow: View {
    let slot: ConsultationSlotDTO
    var person: PersonRefDTO?

    var body: some View {
        TelegramStyleRow(
            title: slot.startsAt.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated)),
            subtitle: details,
            meta: ConsultationText.timeRange(slot)
        ) {
            if let person {
                AvatarView(url: person.avatarUrl, name: person.name, size: 44)
            } else {
                RowSymbol(symbol: slot.isOnline == true ? "video.fill" : "clock.fill", tint: ConsultationText.statusTint(slot.status))
            }
        } accessory: {
            StatusBadge(text: ConsultationText.statusTitle(slot.status), tint: ConsultationText.statusTint(slot.status))
        }
    }

    private var details: String {
        [person?.name, ConsultationText.place(slot), slot.topic]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }
}

/// Подписи окна: статус, время, место.
private enum ConsultationText {
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

    /// «10:00–10:30» — время без даты, дата в заголовке строки.
    static func timeRange(_ slot: ConsultationSlotDTO) -> String {
        let style = Date.FormatStyle.dateTime.hour().minute()
        return "\(slot.startsAt.formatted(style))–\(slot.endsAt.formatted(style))"
    }

    static func place(_ slot: ConsultationSlotDTO) -> String? {
        if slot.isOnline == true {
            return String(localized: "consultations.online", defaultValue: "Онлайн")
        }
        let location = slot.location?.trimmingCharacters(in: .whitespaces) ?? ""
        return location.isEmpty ? nil : location
    }
}

/// Свободные окна одного преподавателя: шапка как профиль, ниже — окна; выбрал окно —
/// лист записи с темой.
private struct TeacherSlotsView: View {
    let teacher: ConsultationTeacherDTO
    let changed: () async -> Void

    @State private var remote = RemoteValue<[ConsultationSlotDTO]>()
    @State private var booking: ConsultationSlotDTO?

    private let api: UniversityServicesFetching = UniversityServicesAPI()

    private var slots: [ConsultationSlotDTO]? { remote.value }
    private var failure: String? { remote.failure }
    private var isOffline: Bool { remote.isOffline }

    var body: some View {
        List {
            HeroHeader(
                visual: .avatar(url: teacher.avatarUrl, name: teacher.name),
                title: teacher.name,
                subtitle: String(localized: "consultations.openSlots", defaultValue: "Свободных окон: \(teacher.openSlots)")
            )

            Section {
                NavigationLink(value: AppRoute.profile(id: teacher.teacherId)) {
                    IconRow(
                        title: String(localized: "consultations.teacherProfile", defaultValue: "Профиль преподавателя"),
                        symbol: "person.crop.circle",
                        tint: TileTint.blue
                    )
                }
            }

            if let slots {
                if let failure {
                    StaleDataBanner(message: failure, isOffline: isOffline) { await load() }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                Section {
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
                            ConsultationSlotRow(slot: slot)
                        }
                        .buttonStyle(.plain)
                        .disabled(slot.status != "OPEN")
                    }
                } header: {
                    Text(String(localized: "consultations.slots", defaultValue: "Окна"))
                } footer: {
                    if !slots.isEmpty {
                        Text(String(localized: "consultations.bookHint", defaultValue: "Нажмите на свободное окно, чтобы записаться."))
                    }
                }
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .navigationTitle(Text(teacher.name))
        .navigationBarTitleDisplayMode(.inline)
        .pullToRefresh { await load() }
        // Показ, возврат на экран и возврат приложения из фона — сохранённое на месте,
        // сеть обновляет фоном (`RemoteValue`).
        .task(id: AppLifecycle.shared.foregroundEpoch) { await load() }
        .sheet(item: $booking) { slot in
            BookSlotSheet(slot: slot) {
                await load()
                await changed()
            }
            .presentationDetents([.medium, .large])
        }
    }

    private func load() async {
        await remote.load { try await api.slots(teacherID: teacher.teacherId) }
    }
}

/// Запись на окно: когда и где — сведениями, тема — по желанию.
private struct BookSlotSheet: View {
    let slot: ConsultationSlotDTO
    let booked: () async -> Void

    @State private var topic = ""

    var body: some View {
        FormSheet(
            title: String(localized: "consultations.book", defaultValue: "Записаться"),
            saveTitle: String(localized: "consultations.book", defaultValue: "Записаться"),
            save: save,
            saved: booked
        ) {
            Section {
                DetailRow(
                    title: String(localized: "consultations.when", defaultValue: "Когда"),
                    value: "\(slot.startsAt.formatted(.dateTime.weekday(.wide).day().month(.wide))), \(ConsultationText.timeRange(slot))",
                    symbol: "calendar"
                )
                if let place = ConsultationText.place(slot) {
                    DetailRow(
                        title: String(localized: "consultations.where", defaultValue: "Где"),
                        value: place,
                        symbol: slot.isOnline == true ? "video" : "mappin.and.ellipse"
                    )
                }
            }
            Section {
                TextField(String(localized: "consultations.topic", defaultValue: "Тема (необязательно)"), text: $topic, axis: .vertical)
                    .lineLimit(2...5)
            }
        }
    }

    private func save() async throws {
        let trimmed = topic.trimmingCharacters(in: .whitespacesAndNewlines)
        try await UniversityServicesAPI().book(slotID: slot.id, topic: trimmed.isEmpty ? nil : String(trimmed.prefix(500)))
    }
}

/// Новое окно преподавателя.
private struct NewSlotView: View {
    let created: () async -> Void

    @State private var start = Calendar.current.date(byAdding: .day, value: 1, to: Date().rounded(minutes: 30)) ?? Date()
    @State private var minutes = 30
    @State private var location = ""
    @State private var isOnline = false

    var body: some View {
        FormSheet(
            title: String(localized: "consultations.newSlot", defaultValue: "Новое окно"),
            save: save,
            saved: created
        ) {
            Section {
                DatePicker(String(localized: "consultations.start", defaultValue: "Начало"), selection: $start, in: Date()...)
                Picker(String(localized: "consultations.duration", defaultValue: "Длительность"), selection: $minutes) {
                    ForEach([15, 30, 45, 60, 90], id: \.self) { value in
                        Text(String(localized: "consultations.minutes", defaultValue: "\(value) мин")).tag(value)
                    }
                }
            }
            Section {
                Toggle(String(localized: "consultations.online", defaultValue: "Онлайн"), isOn: $isOnline)
                if !isOnline {
                    TextField(String(localized: "consultations.location", defaultValue: "Аудитория или место"), text: $location)
                }
            }
        }
    }

    private func save() async throws {
        let end = start.addingTimeInterval(TimeInterval(minutes * 60))
        let place = location.trimmingCharacters(in: .whitespaces)
        try await UniversityServicesAPI().createSlot(
            startsAt: start,
            endsAt: end,
            location: isOnline || place.isEmpty ? nil : String(place.prefix(200)),
            isOnline: isOnline
        )
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
