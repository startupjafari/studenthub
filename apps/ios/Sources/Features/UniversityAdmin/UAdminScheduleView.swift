import SwiftUI

// Управление расписанием вуза (`features/manage-schedule`, режим admin): группа → версия
// расписания → пары недели. Версию можно создать (черновиком, если у группы уже есть
// действующая) и сделать активной; пару — добавить, изменить, удалить; у пары действующей
// версии — разовые изменения на дату (перенос, смена аудитории, отмена, замена).
// Недельная сетка с перетаскиванием на телефоне заменена списком по дням.

struct UAdminScheduleView: View {
    var initialGroupID: String?

    @State private var group: UAdminRefDTO?
    @State private var containers: [UAdminScheduleContainerDTO]?
    @State private var containerID: String?
    @State private var detail: UAdminScheduleDetailDTO?
    @State private var failure: String?
    @State private var isOffline = false
    @State private var actionFailure: String?
    @State private var pickingGroup = false
    @State private var creatingVersion = false
    @State private var editingPair: UAdminPairDTO?
    @State private var addingPair = false
    @State private var activating = false
    @State private var prepared = false

    private var container: UAdminScheduleContainerDTO? { containers?.first { $0.id == containerID } }

    var body: some View {
        List {
            Section {
                Button {
                    pickingGroup = true
                } label: {
                    groupRow
                }
                .buttonStyle(.plain)
                if let containers, !containers.isEmpty {
                    Picker(String(localized: "uadmin.schedule.version", defaultValue: "Версия"), selection: $containerID) {
                        ForEach(containers) { item in
                            Text(item.isActive ? "\(item.name) · \(String(localized: "uadmin.schedule.activeMark", defaultValue: "активна"))" : item.name)
                                .tag(Optional(item.id))
                        }
                    }
                }
                if let container, !container.isActive {
                    Button {
                        Task { await activate(container) }
                    } label: {
                        if activating {
                            ProgressView()
                        } else {
                            Label(String(localized: "uadmin.schedule.activate", defaultValue: "Сделать активной"), systemImage: "checkmark.circle")
                        }
                    }
                    .disabled(activating)
                }
            } footer: {
                if let container, !container.isActive {
                    Text(String(localized: "uadmin.schedule.draftHint", defaultValue: "Это черновик: группа его не видит, пока версию не сделают активной."))
                }
            }

            content
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(String(localized: "uadmin.schedule.title", defaultValue: "Управление расписанием")))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        pickingGroup = true
                    } label: {
                        Label(String(localized: "uadmin.schedule.choose", defaultValue: "Выбрать группу"), systemImage: "person.3")
                    }
                    if group != nil {
                        Button {
                            creatingVersion = true
                        } label: {
                            Label(String(localized: "uadmin.schedule.newVersion", defaultValue: "Новая версия расписания"), systemImage: "plus.square.on.square")
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel(Text(String(localized: "uadmin.actions", defaultValue: "Действия")))
            }
        }
        .floatingAction(String(localized: "uadmin.schedule.addPair", defaultValue: "Добавить пару")) {
            // Пару добавляют в версию: без группы или версии ведём к недостающему шагу.
            if group == nil {
                pickingGroup = true
            } else if detail == nil {
                if containers?.isEmpty == true { creatingVersion = true }
            } else {
                addingPair = true
            }
        }
        .sheet(isPresented: $pickingGroup) {
            UAdminSearchPicker(
                title: String(localized: "uadmin.schedule.group", defaultValue: "Группа"),
                prompt: String(localized: "uadmin.searchByName", defaultValue: "Поиск по названию"),
                load: UAdminPickers.groups,
                label: \.name
            ) { picked in
                guard let picked else { return }
                group = UAdminRefDTO(id: picked.id, name: picked.name)
                Task { await loadContainers(select: nil) }
            }
        }
        .sheet(isPresented: $creatingVersion) {
            if let group {
                VersionForm(groupID: group.id, hasActive: containers?.contains(where: \.isActive) ?? false) { created in
                    await loadContainers(select: created)
                }
                .presentationDetents([.medium, .large])
            }
        }
        .sheet(isPresented: $addingPair) {
            if let detail {
                PairForm(pair: nil, scheduleID: detail.id, containerActive: detail.isActive, groupID: detail.groupId) {
                    await loadDetail()
                }
            }
        }
        .sheet(item: $editingPair) { pair in
            PairForm(pair: pair, scheduleID: pair.scheduleId, containerActive: detail?.isActive ?? false, groupID: pair.groupId) {
                await loadDetail()
            }
        }
        .actionFailureAlert($actionFailure)
        .onChange(of: containerID) { _, _ in Task { await loadDetail() } }
        .refreshable { await loadContainers(select: containerID) }
        .task { await prepare() }
    }

    @ViewBuilder
    private var content: some View {
        if group == nil {
            EmptyStateView(
                title: String(localized: "uadmin.schedule.pickGroup", defaultValue: "Выберите группу"),
                symbol: "person.3",
                hint: String(localized: "uadmin.schedule.pickGroupHint", defaultValue: "Чтобы управлять расписанием, выберите группу"),
                actionTitle: String(localized: "uadmin.schedule.choose", defaultValue: "Выбрать группу"),
                action: { pickingGroup = true }
            )
            .listRowBackground(Color.clear)
        } else if let failure {
            ErrorStateView(message: failure, isOffline: isOffline) { await loadContainers(select: containerID) }
                .listRowBackground(Color.clear)
        } else if let containers, containers.isEmpty {
            EmptyStateView(
                title: String(localized: "uadmin.schedule.noVersions", defaultValue: "Пока нет версий расписания"),
                symbol: "calendar.badge.plus",
                hint: String(localized: "uadmin.schedule.noVersionsHint", defaultValue: "Создайте версию расписания, чтобы добавлять пары"),
                actionTitle: String(localized: "uadmin.schedule.newVersion", defaultValue: "Новая версия расписания"),
                action: { creatingVersion = true }
            )
            .listRowBackground(Color.clear)
        } else if let detail {
            if detail.pairs.isEmpty {
                EmptyStateView(
                    title: String(localized: "uadmin.schedule.noPairs", defaultValue: "В этой версии ещё нет пар"),
                    symbol: "calendar",
                    actionTitle: String(localized: "uadmin.schedule.addPair", defaultValue: "Добавить пару"),
                    action: { addingPair = true }
                )
                .listRowBackground(Color.clear)
            }
            ForEach(1...7, id: \.self) { day in
                let pairs = detail.pairs.filter { $0.dayOfWeek == day }.sorted { $0.startTime < $1.startTime }
                if !pairs.isEmpty {
                    Section(UAdminText.weekday(day)) {
                        ForEach(pairs) { pair in
                            Button {
                                editingPair = pair
                            } label: {
                                PairRow(pair: pair)
                            }
                            .buttonStyle(.plain)
                            .contextMenu {
                                Button {
                                    editingPair = pair
                                } label: {
                                    Label(String(localized: "uadmin.edit", defaultValue: "Изменить"), systemImage: "pencil")
                                }
                            }
                        }
                    }
                }
            }
        } else {
            LoadingStateView().listRowBackground(Color.clear)
        }
    }

    /// Выбранная группа строкой как чат: инициалы, название, состояние версии.
    @ViewBuilder
    private var groupRow: some View {
        if let group {
            TelegramStyleRow(title: group.name, subtitle: versionLine) {
                AvatarView(url: nil, name: group.name, size: 48)
            } accessory: {
                Image(systemName: "chevron.up.chevron.down")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.mutedForeground)
                    .accessibilityHidden(true)
            }
        } else {
            TelegramStyleRow(
                title: String(localized: "uadmin.schedule.pickGroup", defaultValue: "Выберите группу"),
                subtitle: String(localized: "uadmin.schedule.pickGroupHint", defaultValue: "Чтобы управлять расписанием, выберите группу")
            ) {
                RowSymbol(symbol: "person.3.fill", tint: TileTint.teal, size: 48)
            }
        }
    }

    private var versionLine: String {
        guard let container else {
            return String(localized: "uadmin.schedule.changeGroup", defaultValue: "Нажмите, чтобы выбрать другую группу")
        }
        let name = container.name
        if container.isActive {
            return String(localized: "uadmin.schedule.activeVersion", defaultValue: "Действующая версия: \(name)")
        }
        return String(localized: "uadmin.schedule.draftVersion", defaultValue: "Черновик: \(name)")
    }

    @MainActor
    private func prepare() async {
        guard !prepared else { return }
        prepared = true
        guard let initialGroupID else { return }
        if let loaded = try? await UAdminAPI().group(id: initialGroupID) {
            group = UAdminRefDTO(id: loaded.id, name: loaded.name)
            await loadContainers(select: nil)
        }
    }

    /// Версии группы. Выбранную не сбрасываем на активную: только что созданный черновик
    /// остаётся открытым. Нет выбранной в списке — встаём на активную.
    @MainActor
    private func loadContainers(select: String?) async {
        guard let group else { return }
        do {
            let list = try await UAdminAPI().scheduleContainers(groupID: group.id)
            containers = list
            failure = nil
            let wanted = select.flatMap { id in list.first { $0.id == id }?.id }
            let next = wanted ?? (list.first(where: \.isActive) ?? list.first)?.id
            if next == containerID {
                await loadDetail()
            } else {
                containerID = next
            }
            if next == nil { detail = nil }
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    @MainActor
    private func loadDetail() async {
        guard let containerID else {
            detail = nil
            return
        }
        do {
            let loaded = try await UAdminAPI().scheduleContainer(id: containerID)
            guard loaded.id == self.containerID else { return }
            detail = loaded
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    @MainActor
    private func activate(_ container: UAdminScheduleContainerDTO) async {
        activating = true
        defer { activating = false }
        do {
            try await UAdminAPI().activateContainer(id: container.id)
            await loadContainers(select: container.id)
        } catch {
            // Пары версии сверяются с активными сетками других групп: конфликт — с перечнем.
            actionFailure = UAdminFailure.schedule(error)
        }
    }
}

private struct PairRow: View {
    let pair: UAdminPairDTO

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.lg) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: pair.startTime).font(Typography.body.monospacedDigit()).foregroundStyle(Palette.foreground)
                Text(verbatim: pair.endTime).font(Typography.meta.monospacedDigit()).foregroundStyle(Palette.mutedForeground)
            }
            .frame(width: 52, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(pair.subject).font(Typography.cardTitle).foregroundStyle(Palette.foreground).lineLimit(3)
                let meta = [pair.room?.name, pair.teacher?.name].compactMap { $0 }.joined(separator: " · ")
                if !meta.isEmpty {
                    Text(meta).font(Typography.meta).foregroundStyle(Palette.mutedForeground).lineLimit(2)
                }
            }
            Spacer(minLength: 0)
            if pair.weekType != "BOTH" {
                StatusBadge(text: UAdminText.weekType(pair.weekType), tint: Palette.info)
            }
        }
        .padding(.vertical, Spacing.xs)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Версия

private struct VersionForm: View {
    let groupID: String
    /// У группы уже есть активная версия — новую создаём черновиком.
    let hasActive: Bool
    let created: (String) async -> Void

    @State private var name = ""
    @State private var createdID: String?

    var body: some View {
        FormSheet(
            title: String(localized: "uadmin.schedule.newVersion", defaultValue: "Новая версия расписания"),
            saveTitle: String(localized: "uadmin.create", defaultValue: "Создать"),
            canSave: !trimmed.isEmpty && trimmed.count <= 150,
            save: { createdID = try await UAdminAPI().createContainer(groupID: groupID, name: trimmed, isActive: !hasActive).id },
            saved: { if let createdID { await created(createdID) } }
        ) {
            Section {
                TextField(String(localized: "uadmin.schedule.versionPlaceholder", defaultValue: "Название, например Осенний семестр 2026/27"), text: $name)
            } footer: {
                if hasActive {
                    Text(String(localized: "uadmin.schedule.versionDraftHint", defaultValue: "Версия создаётся черновиком: у группы остаётся текущее расписание, пока вы не сделаете новую активной."))
                }
            }
        }
    }

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
}

// MARK: - Пара

/// Пара: правка постоянного расписания сверху, разовые изменения на дату — ниже (только
/// у действующей версии: черновик группе не виден, а уведомление ушло бы всем).
private struct PairForm: View {
    let pair: UAdminPairDTO?
    let scheduleID: String
    let containerActive: Bool
    let groupID: String
    let saved: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var subject = ""
    @State private var day = 1
    @State private var weekType = "BOTH"
    @State private var start = UAdminClock.date("08:00")
    @State private var end = UAdminClock.date("09:30")
    @State private var room: UAdminRefDTO?
    @State private var teacher: UAdminRefDTO?
    @State private var pickingRoom = false
    @State private var pickingTeacher = false
    @State private var confirmDelete = false
    @State private var failure: String?
    @State private var isSaving = false
    @State private var changes: [UAdminScheduleChangeDTO] = []
    @State private var creatingChange = false
    @State private var removingChange: UAdminScheduleChangeDTO?
    @State private var prepared = false

    var body: some View {
        NavigationStack {
            Form {
                if let failure {
                    FormAlert(message: failure)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                Section {
                    TextField(String(localized: "uadmin.schedule.subject", defaultValue: "Предмет"), text: $subject)
                    Picker(String(localized: "uadmin.schedule.day", defaultValue: "День"), selection: $day) {
                        ForEach(1...7, id: \.self) { Text(UAdminText.weekday($0)).tag($0) }
                    }
                    Picker(String(localized: "uadmin.schedule.weekType", defaultValue: "Неделя"), selection: $weekType) {
                        ForEach(UAdminText.weekTypes, id: \.self) { Text(UAdminText.weekType($0)).tag($0) }
                    }
                    DatePicker(String(localized: "uadmin.schedule.start", defaultValue: "Начало"), selection: $start, displayedComponents: .hourAndMinute)
                    DatePicker(String(localized: "uadmin.schedule.end", defaultValue: "Конец"), selection: $end, displayedComponents: .hourAndMinute)
                } footer: {
                    if !timeValid {
                        Text(String(localized: "uadmin.schedule.timeInvalid", defaultValue: "Конец пары должен быть позже начала"))
                            .foregroundStyle(Palette.destructive)
                    }
                }

                Section {
                    UAdminPickerRow(
                        title: String(localized: "uadmin.schedule.room", defaultValue: "Аудитория"),
                        value: room?.name,
                        placeholder: String(localized: "uadmin.picker.none", defaultValue: "Не выбрано")
                    ) { pickingRoom = true }
                    UAdminPickerRow(
                        title: String(localized: "uadmin.schedule.teacher", defaultValue: "Преподаватель"),
                        value: teacher?.name,
                        placeholder: String(localized: "uadmin.picker.none", defaultValue: "Не выбрано")
                    ) { pickingTeacher = true }
                }

                if let pair {
                    if containerActive {
                        changesSection(pair)
                    } else {
                        Section {
                            Text(String(localized: "uadmin.schedule.changeDraftHint", defaultValue: "Разовые изменения на дату доступны только у действующей версии расписания — эту группа пока не видит."))
                                .font(Typography.meta)
                                .foregroundStyle(Palette.mutedForeground)
                        }
                    }

                    // Опасное — последним, отдельно от правки.
                    Section {
                        Button(role: .destructive) {
                            confirmDelete = true
                        } label: {
                            Label(String(localized: "uadmin.schedule.deletePair", defaultValue: "Удалить пару"), systemImage: "trash")
                                .foregroundStyle(Palette.destructive)
                        }
                    }
                }
            }
            .navigationTitle(Text(pair?.subject ?? String(localized: "uadmin.schedule.addPair", defaultValue: "Добавить пару")))
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(isSaving)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button(String(localized: "common.save", defaultValue: "Сохранить")) { Task { await save() } }
                            .disabled(!valid)
                    }
                }
            }
            .sheet(isPresented: $pickingRoom) {
                UAdminSearchPicker(
                    title: String(localized: "uadmin.schedule.room", defaultValue: "Аудитория"),
                    prompt: String(localized: "uadmin.searchByName", defaultValue: "Поиск по названию"),
                    allowsNone: true,
                    load: UAdminPickers.rooms,
                    label: \.name,
                    detail: UAdminPickers.roomDetail
                ) { picked in
                    room = picked.map { UAdminRefDTO(id: $0.id, name: $0.name) }
                }
            }
            .sheet(isPresented: $pickingTeacher) {
                UAdminSearchPicker(
                    title: String(localized: "uadmin.schedule.teacher", defaultValue: "Преподаватель"),
                    prompt: String(localized: "uadmin.searchPeople", defaultValue: "Фамилия или имя"),
                    allowsNone: true,
                    load: UAdminPickers.teachers,
                    label: \.name,
                    detail: { $0.role.map(UAdminText.role) }
                ) { picked in
                    teacher = picked.map { UAdminRefDTO(id: $0.id, name: $0.name) }
                }
            }
            .sheet(isPresented: $creatingChange) {
                if let pair {
                    ChangeForm(pair: pair) { await loadChanges() }
                }
            }
            .confirmationDialog(
                String(localized: "uadmin.schedule.deletePairConfirm", defaultValue: "Удалить пару? Она исчезнет из расписания на все недели."),
                isPresented: $confirmDelete,
                titleVisibility: .visible
            ) {
                Button(String(localized: "uadmin.schedule.deletePair", defaultValue: "Удалить пару"), role: .destructive) {
                    Task { await remove() }
                }
            }
            .confirmDestructive(
                $removingChange,
                title: { _ in String(localized: "uadmin.schedule.removeChangeConfirm", defaultValue: "Убрать это изменение? На эту дату снова будет обычное расписание.") },
                actionTitle: String(localized: "uadmin.schedule.removeChange", defaultValue: "Убрать изменение")
            ) { change in
                do {
                    try await UAdminAPI().deleteChange(id: change.id)
                    await loadChanges()
                } catch {
                    failure = UAdminFailure.schedule(error)
                }
            }
            .onAppear(perform: prepare)
            .task { await loadChanges() }
        }
    }

    private func changesSection(_ pair: UAdminPairDTO) -> some View {
        Section {
            ForEach(changes) { change in
                let detail = [Self.changeDetail(change), change.note].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
                TelegramStyleRow(
                    title: ChangeType.title(change.type),
                    subtitle: detail,
                    meta: UAdminDay.display(change.date)
                ) {
                    RowSymbol(symbol: Self.changeSymbol(change.type), tint: change.type == "CANCELLED" ? TileTint.red : TileTint.orange, size: 36)
                }
                .swipeActions {
                    Button(role: .destructive) {
                        removingChange = change
                    } label: {
                        Label(String(localized: "uadmin.schedule.removeChange", defaultValue: "Убрать изменение"), systemImage: "arrow.uturn.backward")
                    }
                }
                .contextMenu {
                    Button(role: .destructive) {
                        removingChange = change
                    } label: {
                        Label(String(localized: "uadmin.schedule.removeChange", defaultValue: "Убрать изменение"), systemImage: "arrow.uturn.backward")
                    }
                }
            }
            Button {
                creatingChange = true
            } label: {
                Label(String(localized: "uadmin.schedule.createChange", defaultValue: "Создать замену"), systemImage: "calendar.badge.plus")
            }
        } header: {
            Text(String(localized: "uadmin.schedule.changes", defaultValue: "Разовые изменения"))
        } footer: {
            Text(String(localized: "uadmin.schedule.changesHint", defaultValue: "Изменение на конкретную дату — постоянное расписание остаётся прежним"))
        }
    }

    static func changeSymbol(_ type: String) -> String {
        switch type {
        case "CANCELLED": return "xmark"
        case "MOVED": return "clock.arrow.circlepath"
        case "ROOM_CHANGED": return "door.left.hand.open"
        case "SUBSTITUTED": return "person.2.fill"
        default: return "calendar"
        }
    }

    static func changeDetail(_ change: UAdminScheduleChangeDTO) -> String? {
        switch change.type {
        case "MOVED":
            guard let start = change.newStartTime, let end = change.newEndTime else { return nil }
            return "\(start)–\(end)"
        case "ROOM_CHANGED": return change.newRoom?.name
        case "SUBSTITUTED": return change.newTeacher?.name
        default: return nil
        }
    }

    private var startString: String { UAdminClock.string(start) }
    private var endString: String { UAdminClock.string(end) }
    private var timeValid: Bool { startString < endString }
    private var trimmedSubject: String { subject.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var valid: Bool { !trimmedSubject.isEmpty && trimmedSubject.count <= 200 && timeValid }

    private func prepare() {
        guard !prepared else { return }
        prepared = true
        guard let pair else {
            // Новая пара — на сегодняшний день недели (ISO: 1 = понедельник).
            day = (Calendar.current.component(.weekday, from: Date()) + 5) % 7 + 1
            return
        }
        subject = pair.subject
        day = pair.dayOfWeek
        weekType = pair.weekType
        start = UAdminClock.date(pair.startTime)
        end = UAdminClock.date(pair.endTime)
        room = pair.room
        teacher = pair.teacher.map { UAdminRefDTO(id: $0.id, name: $0.name) }
    }

    @MainActor
    private func loadChanges() async {
        guard let pair, containerActive else { return }
        let today = Date()
        let from = UAdminDay.string(Calendar.current.date(byAdding: .day, value: -7, to: today) ?? today)
        let to = UAdminDay.string(Calendar.current.date(byAdding: .day, value: 120, to: today) ?? today)
        if let list = try? await UAdminAPI().scheduleChanges(groupID: groupID, from: from, to: to) {
            changes = list.filter { $0.pairId == pair.id }.sorted { $0.date < $1.date }
        }
    }

    @MainActor
    private func save() async {
        isSaving = true
        defer { isSaving = false }
        var body: [String: JSONValue] = [
            "subject": .string(trimmedSubject),
            "dayOfWeek": .int(day),
            "startTime": .string(startString),
            "endTime": .string(endString),
            "weekType": .string(weekType),
            "roomId": .text(room?.id),
            "teacherId": .text(teacher?.id),
        ]
        if pair == nil { body["scheduleId"] = .string(scheduleID) }
        do {
            try await UAdminAPI().savePair(id: pair?.id, body: body)
            await saved()
            dismiss()
        } catch {
            failure = UAdminFailure.schedule(error)
        }
    }

    @MainActor
    private func remove() async {
        guard let pair else { return }
        do {
            try await UAdminAPI().deletePair(id: pair.id)
            await saved()
            dismiss()
        } catch where UAdminFailure.isConflict(error) {
            failure = String(localized: "uadmin.schedule.deleteHasAttendance", defaultValue: "Пару нельзя удалить: по ней уже отмечена посещаемость. Перенесите пару — измените день или время.")
        } catch {
            failure = error.userMessage
        }
    }
}

private enum ChangeType {
    static let all = ["MOVED", "ROOM_CHANGED", "CANCELLED", "SUBSTITUTED"]

    static func title(_ raw: String) -> String {
        switch raw {
        case "MOVED": return String(localized: "uadmin.schedule.change.moved", defaultValue: "Перенос")
        case "ROOM_CHANGED": return String(localized: "uadmin.schedule.change.room", defaultValue: "Смена аудитории")
        case "CANCELLED": return String(localized: "uadmin.schedule.change.cancelled", defaultValue: "Отмена")
        case "SUBSTITUTED": return String(localized: "uadmin.schedule.change.substituted", defaultValue: "Замена преподавателя")
        default: return raw
        }
    }
}

/// Разовое изменение на дату. Дата должна приходиться на день пары и на её неделю —
/// проверяем до отправки, как веб.
private struct ChangeForm: View {
    let pair: UAdminPairDTO
    let saved: () async -> Void

    @State private var type = "CANCELLED"
    @State private var date = Date()
    @State private var newStart = UAdminClock.date("08:00")
    @State private var newEnd = UAdminClock.date("09:30")
    @State private var room: UAdminRefDTO?
    @State private var teacher: UAdminRefDTO?
    @State private var note = ""
    @State private var pickingRoom = false
    @State private var pickingTeacher = false
    @State private var prepared = false

    var body: some View {
        FormSheet(
            title: String(localized: "uadmin.schedule.createChange", defaultValue: "Создать замену"),
            saveTitle: String(localized: "uadmin.create", defaultValue: "Создать"),
            canSave: dateProblem == nil && fieldsValid,
            save: save,
            saved: saved
        ) {
            Section {
                Picker(String(localized: "uadmin.schedule.changeType", defaultValue: "Тип"), selection: $type) {
                    ForEach(ChangeType.all, id: \.self) { Text(ChangeType.title($0)).tag($0) }
                }
                DatePicker(String(localized: "uadmin.schedule.date", defaultValue: "Дата"), selection: $date, displayedComponents: .date)
                switch type {
                case "MOVED":
                    DatePicker(String(localized: "uadmin.schedule.newStart", defaultValue: "Новое начало"), selection: $newStart, displayedComponents: .hourAndMinute)
                    DatePicker(String(localized: "uadmin.schedule.newEnd", defaultValue: "Новый конец"), selection: $newEnd, displayedComponents: .hourAndMinute)
                case "ROOM_CHANGED":
                    UAdminPickerRow(title: String(localized: "uadmin.schedule.newRoom", defaultValue: "Новая аудитория"), value: room?.name) { pickingRoom = true }
                case "SUBSTITUTED":
                    UAdminPickerRow(title: String(localized: "uadmin.schedule.newTeacher", defaultValue: "Заменяющий преподаватель"), value: teacher?.name) { pickingTeacher = true }
                default:
                    EmptyView()
                }
                TextField(String(localized: "uadmin.schedule.note", defaultValue: "Комментарий (необязательно)"), text: $note, axis: .vertical)
                    .lineLimit(1...4)
            } footer: {
                if let dateProblem {
                    Text(dateProblem).foregroundStyle(Palette.destructive)
                } else {
                    Text(String(localized: "uadmin.schedule.changeNotify", defaultValue: "Группа и преподаватели получат уведомление."))
                }
            }
        }
        .sheet(isPresented: $pickingRoom) {
            UAdminSearchPicker(
                title: String(localized: "uadmin.schedule.newRoom", defaultValue: "Новая аудитория"),
                prompt: String(localized: "uadmin.searchByName", defaultValue: "Поиск по названию"),
                load: UAdminPickers.rooms,
                label: \.name,
                detail: UAdminPickers.roomDetail
            ) { picked in
                room = picked.map { UAdminRefDTO(id: $0.id, name: $0.name) }
            }
        }
        .sheet(isPresented: $pickingTeacher) {
            UAdminSearchPicker(
                title: String(localized: "uadmin.schedule.newTeacher", defaultValue: "Заменяющий преподаватель"),
                prompt: String(localized: "uadmin.searchPeople", defaultValue: "Фамилия или имя"),
                load: UAdminPickers.teachers,
                label: \.name,
                detail: { $0.role.map(UAdminText.role) }
            ) { picked in
                teacher = picked.map { UAdminRefDTO(id: $0.id, name: $0.name) }
            }
        }
        .onAppear {
            guard !prepared else { return }
            prepared = true
            date = Self.nextDate(for: pair)
            newStart = UAdminClock.date(pair.startTime)
            newEnd = UAdminClock.date(pair.endTime)
        }
    }

    /// Ближайшая дата пары — с сегодняшнего дня, с учётом чётности недели.
    private static func nextDate(for pair: UAdminPairDTO) -> Date {
        let calendar = Calendar.current
        var candidate = calendar.startOfDay(for: Date())
        for _ in 0..<21 {
            let iso = (calendar.component(.weekday, from: candidate) + 5) % 7 + 1
            if iso == pair.dayOfWeek, WeekParity.current(candidate).includes(weekType: pair.weekType) { return candidate }
            candidate = calendar.date(byAdding: .day, value: 1, to: candidate) ?? candidate
        }
        return Date()
    }

    private var dateProblem: String? {
        let iso = (Calendar.current.component(.weekday, from: date) + 5) % 7 + 1
        if iso != pair.dayOfWeek {
            let dayName = UAdminText.weekday(pair.dayOfWeek)
            return String(localized: "uadmin.schedule.changeWrongDay", defaultValue: "Эта пара — в день «\(dayName)». Выберите такую дату")
        }
        if !WeekParity.current(date).includes(weekType: pair.weekType) {
            let parity = UAdminText.weekType(pair.weekType)
            return String(localized: "uadmin.schedule.changeWrongWeek", defaultValue: "Эта пара идёт только в неделю «\(parity)». Выберите дату такой недели")
        }
        return nil
    }

    private var fieldsValid: Bool {
        switch type {
        case "MOVED": return UAdminClock.string(newStart) < UAdminClock.string(newEnd)
        case "ROOM_CHANGED": return room != nil
        case "SUBSTITUTED": return teacher != nil
        default: return note.count <= 500
        }
    }

    private func save() async throws {
        var body: [String: JSONValue] = [
            "pairId": .string(pair.id),
            "type": .string(type),
            "date": .string(UAdminDay.string(date)),
        ]
        switch type {
        case "MOVED":
            body["newStartTime"] = .string(UAdminClock.string(newStart))
            body["newEndTime"] = .string(UAdminClock.string(newEnd))
        case "ROOM_CHANGED":
            body["newRoomId"] = .text(room?.id)
        case "SUBSTITUTED":
            body["newTeacherId"] = .text(teacher?.id)
        default:
            break
        }
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { body["note"] = .string(String(trimmed.prefix(500))) }
        do {
            try await UAdminAPI().createChange(body: body)
        } catch {
            throw UAdminFailure.message(UAdminFailure.schedule(error))
        }
    }
}
