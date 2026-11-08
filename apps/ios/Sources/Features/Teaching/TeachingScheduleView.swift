import SwiftUI

/// Расписание преподавателя: разовые изменения его пар на ближайшие недели и правка
/// своих пар в сетке группы (день, время, чётность, аудитория), добавление пары.
///
/// Разовые изменения (перенос, отмена, замена) создаёт и снимает деканат — у
/// преподавателя на сервере на это прав нет, поэтому здесь они только видны.
struct TeachingScheduleView: View {
    /// `nil` — изменения, `pairs` — мои пары.
    @State private var tab: String?

    var body: some View {
        Group {
            if tab == nil {
                TeachingScheduleChangesList(header: tabs)
            } else {
                TeachingPairsEditor(header: tabs)
            }
        }
        .navigationTitle(Text(TeacherScreen.scheduleChanges.title))
    }

    private var tabs: AnyView {
        AnyView(
            FilterChipsRow(
                options: [
                    (nil, String(localized: "teaching.schedule.changes", defaultValue: "Изменения")),
                    ("pairs", String(localized: "teaching.schedule.pairs", defaultValue: "Мои пары")),
                ],
                selection: $tab
            )
        )
    }
}

// MARK: - Изменения

private struct TeachingScheduleChangesList: View {
    let header: AnyView

    @State private var weeks = 2
    @State private var changes: [TeachingScheduleChangeDTO]?
    @State private var failure: String?
    @State private var isOffline = false

    var body: some View {
        List {
            header
            Section {
                Picker(String(localized: "teaching.schedule.range", defaultValue: "Период"), selection: $weeks) {
                    Text(String(localized: "teaching.schedule.range.week", defaultValue: "Неделя")).tag(1)
                    Text(String(localized: "teaching.schedule.range.twoWeeks", defaultValue: "Две недели")).tag(2)
                    Text(String(localized: "teaching.schedule.range.month", defaultValue: "Месяц")).tag(4)
                }
            }
            .listRowBackground(Palette.card)

            if let changes {
                if changes.isEmpty {
                    EmptyStateView(
                        title: String(localized: "teaching.schedule.noChanges", defaultValue: "Изменений нет"),
                        symbol: "calendar.badge.checkmark",
                        hint: String(localized: "teaching.schedule.noChanges.hint", defaultValue: "Переносы, отмены и замены ваших пар появятся здесь.")
                    )
                    .listRowBackground(Color.clear)
                } else {
                    ForEach(groupedByDay(changes), id: \.day) { group in
                        Section(group.title) {
                            ForEach(group.items) { change in changeRow(change) }
                        }
                        .listRowBackground(Palette.card)
                    }
                }
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }

            Section {
                Text(String(localized: "teaching.schedule.changes.footer", defaultValue: "Перенос, отмену и замену занятия оформляет деканат — обратитесь туда, если нужно разовое изменение."))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            }
            .listRowBackground(Color.clear)
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .refreshable { await load() }
        .task(id: weeks) { await load() }
    }

    private func groupedByDay(_ changes: [TeachingScheduleChangeDTO]) -> [(day: String, title: String, items: [TeachingScheduleChangeDTO])] {
        let grouped = Dictionary(grouping: changes) { teachingChangeDay($0.date) }
        return grouped.keys.sorted().map { day in
            let sample = grouped[day]?.first?.date
            let title = sample.map {
                $0.formatted(Date.FormatStyle(date: .complete, time: .omitted, timeZone: TimeZone(identifier: "UTC") ?? .current))
            } ?? day
            return (day: day, title: title, items: grouped[day] ?? [])
        }
    }

    private func changeRow(_ change: TeachingScheduleChangeDTO) -> some View {
        let kind = TeachingText.changeType(change.type)
        var lines: [String] = []
        if let pair = change.pair {
            lines.append("\(pair.startTime)–\(pair.endTime)")
        }
        switch change.type {
        case "MOVED":
            if let start = change.newStartTime, let end = change.newEndTime {
                lines.append(String(localized: "teaching.schedule.movedTo", defaultValue: "Новое время: \(start)–\(end)"))
            }
        case "ROOM_CHANGED":
            if let room = change.newRoom?.name {
                lines.append(String(localized: "teaching.schedule.newRoom", defaultValue: "Аудитория: \(room)"))
            }
        case "SUBSTITUTED":
            if let teacher = change.newTeacher {
                lines.append(String(localized: "teaching.schedule.substitute", defaultValue: "Заменяет: \(teacher.name)"))
            }
        default:
            break
        }
        if let note = change.note, !note.isEmpty { lines.append(note) }
        return ListCardRow(
            title: change.pair?.subject ?? "—",
            status: (kind.text, kind.tint),
            lines: lines
        )
    }

    @MainActor
    private func load() async {
        let from = Calendar.current.startOfDay(for: Date())
        let to = Calendar.current.date(byAdding: .day, value: weeks * 7, to: from) ?? from
        do {
            changes = try await TeachingAPI().scheduleChanges(from: from, to: to).sorted { $0.date < $1.date }
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }
}

// MARK: - Свои пары

/// Сетка группы, где он ведёт занятия: версия расписания, пары по дням. Свои пары
/// правятся, чужие видны для ориентира — пересечения по времени решает сервер.
private struct TeachingPairsEditor: View {
    let header: AnyView

    @Environment(\.viewerID) private var viewerID

    @State private var groups: [CourseDTO.Group]?
    @State private var groupID = ""
    @State private var containers: [TeachingScheduleContainerDTO] = []
    @State private var containerID = ""
    @State private var detail: TeachingScheduleDetailDTO?
    @State private var failure: String?
    @State private var isOffline = false
    @State private var adding = false
    @State private var editing: PairDTO?
    @State private var onlyMine = true

    private let api = TeachingAPI()

    var body: some View {
        List {
            header
            if let groups {
                Section {
                    Picker(String(localized: "teaching.schedule.group", defaultValue: "Группа"), selection: $groupID) {
                        Text(String(localized: "teaching.materials.group.pick", defaultValue: "Выберите группу")).tag("")
                        ForEach(groups, id: \.id) { Text($0.name).tag($0.id) }
                    }
                    if !containers.isEmpty {
                        Picker(String(localized: "teaching.schedule.version", defaultValue: "Версия расписания"), selection: $containerID) {
                            ForEach(containers) { container in
                                Text(container.isActive
                                    ? String(localized: "teaching.schedule.version.active", defaultValue: "\(container.name) · активное")
                                    : container.name
                                ).tag(container.id)
                            }
                        }
                    }
                    if detail != nil {
                        Toggle(String(localized: "teaching.schedule.onlyMine", defaultValue: "Только мои пары"), isOn: $onlyMine)
                    }
                }
                .listRowBackground(Palette.card)

                if groups.isEmpty {
                    EmptyStateView(
                        title: String(localized: "teaching.schedule.noGroups", defaultValue: "Групп пока нет"),
                        symbol: "person.3",
                        hint: String(localized: "teaching.schedule.noGroups.hint", defaultValue: "Пары можно править в группах, где вы ведёте дисциплины.")
                    )
                    .listRowBackground(Color.clear)
                } else if !groupID.isEmpty, containers.isEmpty, failure == nil {
                    EmptyStateView(
                        title: String(localized: "teaching.schedule.noContainers", defaultValue: "Расписания нет"),
                        symbol: "calendar.badge.plus",
                        hint: String(localized: "teaching.schedule.noContainers.hint", defaultValue: "Расписание группы составляет деканат. Когда оно появится, вы сможете править свои пары.")
                    )
                    .listRowBackground(Color.clear)
                }
                if let detail {
                    pairsSections(detail)
                }
            }
            if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await loadAll() }
                    .listRowBackground(Color.clear)
            } else if groups == nil {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .toolbar {
            if !containerID.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        adding = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel(Text(String(localized: "teaching.schedule.addPair", defaultValue: "Добавить пару")))
                }
            }
        }
        .sheet(isPresented: $adding) {
            TeachingPairForm(scheduleID: containerID, pair: nil, viewerID: viewerID) { await loadDetail() }
        }
        .sheet(item: Binding(get: { editing.map(TeachingEditedPair.init) }, set: { editing = $0?.pair })) { item in
            TeachingPairForm(scheduleID: containerID, pair: item.pair, viewerID: viewerID) { await loadDetail() }
        }
        .refreshable { await loadAll() }
        .task { if groups == nil { await loadAll() } }
        .onChange(of: groupID) { Task { await loadContainers() } }
        .onChange(of: containerID) { Task { await loadDetail() } }
    }

    @ViewBuilder
    private func pairsSections(_ detail: TeachingScheduleDetailDTO) -> some View {
        let visible = detail.pairs.filter { !onlyMine || $0.teacher?.id == viewerID }
        if visible.isEmpty {
            EmptyStateView(
                title: String(localized: "teaching.schedule.noPairs", defaultValue: "Пар нет"),
                symbol: "calendar",
                actionTitle: String(localized: "teaching.schedule.addPair", defaultValue: "Добавить пару"),
                action: { adding = true }
            )
            .listRowBackground(Color.clear)
        }
        ForEach(1...7, id: \.self) { day in
            let pairs = visible.filter { $0.dayOfWeek == day }.sorted { $0.startTime < $1.startTime }
            if !pairs.isEmpty {
                Section(TeachingText.weekday(day)) {
                    ForEach(pairs, id: \.id) { pair in
                        let mine = pair.teacher?.id == viewerID
                        Button {
                            if mine { editing = pair }
                        } label: {
                            pairRow(pair, mine: mine)
                        }
                        .buttonStyle(.plain)
                        .disabled(!mine)
                    }
                }
                .listRowBackground(Palette.card)
            }
        }
    }

    private func pairRow(_ pair: PairDTO, mine: Bool) -> some View {
        var details: [String] = []
        if pair.weekType != "BOTH" { details.append(TeachingText.weekType(pair.weekType)) }
        if let room = pair.room?.name { details.append(room) }
        if !mine, let teacher = pair.teacher {
            details.append(DisplayFormat.name(first: teacher.firstName, last: teacher.lastName))
        }
        return HStack(alignment: .top, spacing: Spacing.lg) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: pair.startTime).font(Typography.body.monospacedDigit())
                Text(verbatim: pair.endTime).font(Typography.meta.monospacedDigit()).foregroundStyle(Palette.mutedForeground)
            }
            .frame(width: 52, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(pair.subject).font(Typography.cardTitle).foregroundStyle(mine ? Palette.foreground : Palette.mutedForeground)
                if !details.isEmpty {
                    Text(details.joined(separator: " · ")).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                }
            }
            Spacer(minLength: 0)
            if mine {
                Image(systemName: "pencil").font(Typography.meta).foregroundStyle(Palette.mutedForeground)
            }
        }
        .contentShape(Rectangle())
        .padding(.vertical, Spacing.xs)
    }

    @MainActor
    private func loadAll() async {
        do {
            let courses = try await CoursesAPI().courses(mine: true)
            var seen = Set<String>()
            groups = courses.compactMap(\.group)
                .filter { seen.insert($0.id).inserted }
                .sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
            failure = nil
            if groupID.isEmpty, let first = groups?.first {
                groupID = first.id
            } else {
                await loadContainers()
            }
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    @MainActor
    private func loadContainers() async {
        detail = nil
        guard !groupID.isEmpty else {
            containers = []
            containerID = ""
            return
        }
        do {
            containers = try await api.scheduleContainers(groupID: groupID)
            failure = nil
            let next = containers.first(where: { $0.id == containerID })?.id
                ?? (containers.first(where: \.isActive) ?? containers.first)?.id
                ?? ""
            if next == containerID { await loadDetail() } else { containerID = next }
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    @MainActor
    private func loadDetail() async {
        guard !containerID.isEmpty else {
            detail = nil
            return
        }
        do {
            detail = try await api.schedule(id: containerID)
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }
}

/// Обёртка для `.sheet(item:)`: `PairDTO` не `Identifiable`, а менять общий тип нельзя.
private struct TeachingEditedPair: Identifiable {
    let pair: PairDTO
    var id: String { pair.id }
}

/// Новая пара (преподаватель ставит себя) или правка своей.
private struct TeachingPairForm: View {
    let scheduleID: String
    let pair: PairDTO?
    let viewerID: String
    let saved: () async -> Void

    @State private var subject: String
    @State private var day: Int
    @State private var weekType: String
    @State private var start: Date
    @State private var end: Date
    @State private var room: TeachingNamedRef?

    init(scheduleID: String, pair: PairDTO?, viewerID: String, saved: @escaping () async -> Void) {
        self.scheduleID = scheduleID
        self.pair = pair
        self.viewerID = viewerID
        self.saved = saved
        _subject = State(initialValue: pair?.subject ?? "")
        _day = State(initialValue: pair?.dayOfWeek ?? min(teachingWeekday(of: Date()), 6))
        _weekType = State(initialValue: pair?.weekType ?? "BOTH")
        _start = State(initialValue: teachingTimeDate(pair?.startTime ?? "08:00"))
        _end = State(initialValue: teachingTimeDate(pair?.endTime ?? "09:30"))
        _room = State(initialValue: pair?.room.map { TeachingNamedRef(id: $0.id, name: $0.name) })
    }

    var body: some View {
        FormSheet(
            title: pair == nil
                ? String(localized: "teaching.schedule.addPair", defaultValue: "Добавить пару")
                : String(localized: "teaching.schedule.editPair", defaultValue: "Изменить пару"),
            canSave: isValid,
            save: save,
            saved: saved
        ) {
            Section {
                TextField(String(localized: "teaching.schedule.subject", defaultValue: "Дисциплина"), text: $subject)
                Picker(String(localized: "teaching.schedule.day", defaultValue: "День"), selection: $day) {
                    ForEach(1...7, id: \.self) { Text(TeachingText.weekday($0)).tag($0) }
                }
                Picker(String(localized: "teaching.schedule.weekType", defaultValue: "Неделя"), selection: $weekType) {
                    ForEach(TeachingText.weekTypes, id: \.self) { Text(TeachingText.weekType($0)).tag($0) }
                }
                DatePicker(String(localized: "teaching.schedule.start", defaultValue: "Начало"), selection: $start, displayedComponents: .hourAndMinute)
                    .onChange(of: start) { oldValue, newValue in
                        // Длительность пары сохраняется при сдвиге начала.
                        end = end.addingTimeInterval(newValue.timeIntervalSince(oldValue))
                    }
                DatePicker(String(localized: "teaching.schedule.end", defaultValue: "Конец"), selection: $end, displayedComponents: .hourAndMinute)
                TeachingRoomField(room: $room)
            } footer: {
                if teachingTimeString(start) >= teachingTimeString(end) {
                    Text(String(localized: "teaching.schedule.timeInvalid", defaultValue: "Конец пары должен быть позже начала"))
                        .foregroundStyle(Palette.destructive)
                }
            }
            .listRowBackground(Palette.card)
        }
    }

    private var isValid: Bool {
        let name = subject.trimmingCharacters(in: .whitespaces)
        return !name.isEmpty && name.count <= 200 && teachingTimeString(start) < teachingTimeString(end)
    }

    private func save() async throws {
        let api = TeachingAPI()
        let name = subject.trimmingCharacters(in: .whitespaces)
        let startTime = teachingTimeString(start)
        let endTime = teachingTimeString(end)
        if let pair {
            var fields: [String: JSONValue] = [:]
            if name != pair.subject { fields["subject"] = .string(name) }
            if day != pair.dayOfWeek { fields["dayOfWeek"] = .int(day) }
            if weekType != pair.weekType { fields["weekType"] = .string(weekType) }
            if startTime != pair.startTime { fields["startTime"] = .string(startTime) }
            if endTime != pair.endTime { fields["endTime"] = .string(endTime) }
            if room?.id != pair.room?.id { fields["roomId"] = room.map { .string($0.id) } ?? .null }
            guard !fields.isEmpty else { return }
            try await api.updatePair(id: pair.id, JSONBody(fields))
        } else {
            var fields: [String: JSONValue] = [
                "scheduleId": .string(scheduleID),
                "subject": .string(name),
                "teacherId": .string(viewerID),
                "dayOfWeek": .int(day),
                "startTime": .string(startTime),
                "endTime": .string(endTime),
                "weekType": .string(weekType),
            ]
            if let room { fields["roomId"] = .string(room.id) }
            try await api.createPair(JSONBody(fields))
        }
    }
}
