import SwiftUI

/// Расписание факультета: группа → версия расписания → пары по дням. Декан добавляет,
/// правит и удаляет пары, заводит версии (новая при действующей — черновиком), делает
/// версию действующей и создаёт разовые изменения (отмена, перенос, смена аудитории,
/// замена). Перетаскивание пар по сетке, как в вебе, на телефоне заменено формой пары.
struct DeanScheduleManageView: View {
    var initialGroupID: String?

    @State private var group: DeanPickOption?
    @State private var containers: [DeanScheduleContainer]?
    @State private var containerID: String?
    @State private var detail: DeanScheduleContainerDetail?
    @State private var failure: String?
    @State private var isOffline = false
    /// Пары версии не загрузились: без этого экран навсегда оставался в загрузке.
    @State private var detailFailure: String?
    @State private var detailOffline = false
    /// Группа из карточки не загрузилась: не «Выберите группу», когда группа задана.
    @State private var groupFailure: String?
    @State private var groupOffline = false
    @State private var actionFailure: String?
    @State private var isBusy = false
    @State private var creatingVersion = false
    @State private var addingDay: Int?
    @State private var openedPair: DeanPair?
    @State private var showWeekend = false
    @State private var bootstrapped = false

    private let api = DeanAPI()

    var body: some View {
        List {
            Section {
                DeanPickerField(
                    title: String(localized: "dean.group.name", defaultValue: "Группа"),
                    selection: $group,
                    allowsNone: false,
                    noneTitle: String(localized: "dean.schedule.pickGroup", defaultValue: "Выберите группу"),
                    load: DeanPickers.groups(api)
                )
                if group != nil {
                    versionControls
                }
            }

            if group == nil, let groupFailure {
                ErrorStateView(message: groupFailure, isOffline: groupOffline) { await loadInitialGroup() }
                    .listRowBackground(Color.clear)
            } else if group == nil {
                EmptyStateView(
                    title: String(localized: "dean.schedule.pickGroup", defaultValue: "Выберите группу"),
                    symbol: "square.stack.3d.up",
                    hint: String(localized: "dean.schedule.pickGroupHint", defaultValue: "Расписание ведётся по группам: у каждой — версии, действует одна")
                )
                .listRowBackground(Color.clear)
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await loadContainers() }
                    .listRowBackground(Color.clear)
            } else if containers == nil {
                LoadingStateView().listRowBackground(Color.clear)
            } else if containerID == nil {
                EmptyStateView(
                    title: String(localized: "dean.schedule.noVersions", defaultValue: "Расписания у группы нет"),
                    symbol: "calendar.badge.plus",
                    hint: String(localized: "dean.schedule.noVersionsHint", defaultValue: "Создайте версию — в неё добавляются пары"),
                    actionTitle: String(localized: "dean.schedule.newVersion", defaultValue: "Новая версия"),
                    action: { creatingVersion = true }
                )
                .listRowBackground(Color.clear)
            } else if let detail, detail.id == containerID {
                if let detailFailure {
                    StaleDataBanner(message: detailFailure, isOffline: detailOffline) { await loadDetail() }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                days(detail)
            } else if let detailFailure {
                ErrorStateView(message: detailFailure, isOffline: detailOffline) { await loadDetail() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(initialGroupID == nil ? DeanScreen.schedule.title : DeanScreen.groupSchedule(id: "").title))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    moreMenu
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel(Text(String(localized: "dean.more", defaultValue: "Ещё")))
            }
        }
        .modifier(DeanAddPairButton(isOn: containerID != nil && detail?.id == containerID) {
            addingDay = DeanTime.isoWeekday(Date())
        })
        .refreshable { await reloadAll() }
        .task {
            guard !bootstrapped else { return }
            bootstrapped = true
            await loadInitialGroup()
        }
        .onChange(of: group?.id) { _, _ in
            containers = nil
            containerID = nil
            detail = nil
            detailFailure = nil
            Task { await loadContainers() }
        }
        .onChange(of: containerID) { _, _ in
            detailFailure = nil
            Task { await loadDetail() }
        }
        .sheet(isPresented: $creatingVersion) {
            if let group {
                DeanVersionForm(groupID: group.id, hasActive: containers?.contains { $0.isActive } ?? false) { created in
                    await loadContainers(select: created.id)
                }
            }
        }
        .sheet(item: Binding(get: { addingDay.map { DeanDayToken(day: $0) } }, set: { addingDay = $0?.day })) { token in
            if let containerID {
                DeanPairForm(scheduleID: containerID, pair: nil, day: token.day) { await loadDetail() }
            }
        }
        .sheet(item: $openedPair) { pair in
            DeanPairSheet(
                pair: pair,
                scheduleID: containerID ?? "",
                containerActive: detail?.isActive ?? false,
                timezone: detail?.timezone
            ) {
                await loadDetail()
            }
        }
        .actionFailureAlert($actionFailure)
    }

    // MARK: Версии

    @ViewBuilder
    private var versionControls: some View {
        if let containers, !containers.isEmpty {
            Picker(String(localized: "dean.schedule.version", defaultValue: "Версия"), selection: $containerID) {
                ForEach(containers) { container in
                    Text(verbatim: container.isActive
                        ? "\(container.name) · \(String(localized: "dean.schedule.activeShort", defaultValue: "действует"))"
                        : container.name)
                        .tag(String?.some(container.id))
                }
            }
            if let current = containers.first(where: { $0.id == containerID }), !current.isActive {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    HStack(spacing: Spacing.sm) {
                        StatusBadge(text: String(localized: "dean.schedule.draftBadge", defaultValue: "Черновик"), tint: Palette.warning)
                        Text(String(localized: "dean.schedule.draftHint", defaultValue: "Черновик: группа его не видит, пока версию не сделают действующей."))
                            .font(.caption)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    Button {
                        Task { await activate(current) }
                    } label: {
                        if isBusy {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                        } else {
                            Label(String(localized: "dean.schedule.activate", defaultValue: "Сделать действующей"), systemImage: "checkmark.circle")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .glassProminentButton()
                    .disabled(isBusy)
                }
                .padding(.vertical, Spacing.xs)
            }
        }
    }

    /// Редкие действия экрана — в одном меню панели, как «Ещё» у чатов.
    @ViewBuilder
    private var moreMenu: some View {
        Button {
            creatingVersion = true
        } label: {
            Label(String(localized: "dean.schedule.newVersion", defaultValue: "Новая версия"), systemImage: "plus.square.on.square")
        }
        .disabled(group == nil)
        if let detail, !detail.pairs.contains(where: { $0.dayOfWeek > 5 }) {
            Button {
                withAnimation { showWeekend.toggle() }
            } label: {
                Label(
                    showWeekend
                        ? String(localized: "dean.schedule.hideWeekend", defaultValue: "Скрыть выходные")
                        : String(localized: "dean.schedule.showWeekend", defaultValue: "Показать выходные"),
                    systemImage: showWeekend ? "eye.slash" : "eye"
                )
            }
        }
    }

    // MARK: Дни

    @ViewBuilder
    private func days(_ detail: DeanScheduleContainerDetail) -> some View {
        let hasWeekend = detail.pairs.contains { $0.dayOfWeek > 5 }
        let days = showWeekend || hasWeekend ? Array(1...7) : Array(1...5)
        ForEach(days, id: \.self) { day in
            let pairs = detail.pairs.filter { $0.dayOfWeek == day }.sorted { $0.startTime < $1.startTime }
            Section {
                if pairs.isEmpty {
                    Button {
                        addingDay = day
                    } label: {
                        Label(String(localized: "dean.schedule.addPair", defaultValue: "Добавить пару"), systemImage: "plus")
                            .font(Typography.body)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                }
                ForEach(pairs) { pair in
                    Button {
                        openedPair = pair
                    } label: {
                        DeanPairRow(pair: pair)
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button {
                            openedPair = pair
                        } label: {
                            Label(String(localized: "dean.edit", defaultValue: "Изменить"), systemImage: "pencil")
                        }
                        Button {
                            addingDay = day
                        } label: {
                            Label(String(localized: "dean.schedule.addPair", defaultValue: "Добавить пару"), systemImage: "plus")
                        }
                    }
                }
            } header: {
                HStack {
                    Text(DeanText.day(day))
                    Spacer()
                    if !pairs.isEmpty {
                        Button {
                            addingDay = day
                        } label: {
                            Image(systemName: "plus.circle")
                        }
                        .accessibilityLabel(Text(addPairLabel(day)))
                    }
                }
            }
        }
    }

    private func addPairLabel(_ day: Int) -> String {
        let name = DeanText.day(day)
        return String(localized: "dean.schedule.addPairDay", defaultValue: "Добавить пару: \(name)")
    }

    // MARK: Загрузка

    @MainActor
    private func reloadAll() async {
        guard group != nil else {
            await loadInitialGroup()
            return
        }
        await loadContainers(select: containerID)
        await loadDetail()
    }

    /// Группа из карточки группы — сразу выбрана.
    @MainActor
    private func loadInitialGroup() async {
        guard let initialGroupID, group == nil else { return }
        do {
            let loaded = try await api.group(id: initialGroupID)
            group = DeanPickOption(id: loaded.id, title: loaded.name)
            groupFailure = nil
        } catch is CancellationError {
            return
        } catch {
            groupFailure = error.userMessage
            groupOffline = error.isOffline
        }
    }

    /// Выбранную версию не сбрасываем на действующую при обновлении списка: только что
    /// созданный черновик остаётся открытым.
    @MainActor
    private func loadContainers(select: String? = nil) async {
        guard let groupID = group?.id else { return }
        do {
            let list = try await api.scheduleContainers(groupID: groupID)
            guard groupID == group?.id else { return }
            containers = list
            failure = nil
            let wanted = select ?? containerID
            let next = list.contains { $0.id == wanted } ? wanted : (list.first { $0.isActive } ?? list.first)?.id
            if next != containerID {
                containerID = next
            } else {
                await loadDetail()
            }
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    @MainActor
    private func loadDetail() async {
        guard let id = containerID else {
            detail = nil
            detailFailure = nil
            return
        }
        do {
            let loaded = try await api.scheduleContainer(id: id)
            guard id == containerID else { return }
            detail = loaded
            detailFailure = nil
        } catch is CancellationError {
            return
        } catch {
            guard id == containerID else { return }
            // Пары на экране остаются (полоса над ними), без пар — ошибка с повтором.
            detailFailure = error.userMessage
            detailOffline = error.isOffline
        }
    }

    /// Пары версии сверяются с действующими сетками других групп: конфликт — с перечнем.
    @MainActor
    private func activate(_ container: DeanScheduleContainer) async {
        isBusy = true
        defer { isBusy = false }
        do {
            try await api.updateScheduleContainer(id: container.id, fields: ["isActive": true])
            await loadContainers(select: container.id)
        } catch {
            actionFailure = DeanErrorText.message(error)
        }
    }
}

private struct DeanDayToken: Identifiable {
    let day: Int
    var id: Int { day }
}

/// Плавающая «Добавить пару» — когда версия открыта; день подставляется сегодняшний,
/// в форме его можно сменить.
private struct DeanAddPairButton: ViewModifier {
    let isOn: Bool
    let action: () -> Void

    func body(content: Content) -> some View {
        if isOn {
            content.floatingAction(String(localized: "dean.schedule.addPair", defaultValue: "Добавить пару"), action: action)
        } else {
            content
        }
    }
}

/// Пара строкой: время столбиком слева, как в «Календаре», предмет и кто/где — справа.
private struct DeanPairRow: View {
    let pair: DeanPair

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.lg) {
            VStack(alignment: .trailing, spacing: 0) {
                Text(verbatim: pair.startTime)
                    .font(Typography.meta.monospacedDigit().weight(.semibold))
                    .foregroundStyle(Palette.foreground)
                Text(verbatim: pair.endTime)
                    .font(Typography.meta.monospacedDigit())
                    .foregroundStyle(Palette.mutedForeground)
            }
            .frame(minWidth: 44, alignment: .trailing)
            RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                .fill(Palette.primary)
                .frame(width: 3)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(pair.subject)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Palette.foreground)
                if let meta {
                    Text(meta)
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(2)
                }
                if pair.weekType != "BOTH" {
                    StatusBadge(text: DeanText.weekType(pair.weekType), tint: Palette.info)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Palette.mutedForeground)
                .accessibilityHidden(true)
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var meta: String? {
        var parts: [String] = []
        if let teacher = pair.teacher?.name { parts.append(teacher) }
        if let room = pair.room?.name { parts.append(room) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

// MARK: - Версия

private struct DeanVersionForm: View {
    let groupID: String
    let hasActive: Bool
    let created: (DeanScheduleContainer) async -> Void

    @State private var name = ""
    @State private var result: DeanScheduleContainer?

    private let api = DeanAPI()

    var body: some View {
        FormSheet(
            title: String(localized: "dean.schedule.newVersion", defaultValue: "Новая версия"),
            saveTitle: String(localized: "dean.schedule.create", defaultValue: "Создать"),
            canSave: !name.trimmingCharacters(in: .whitespaces).isEmpty,
            save: {
                result = try await api.createScheduleContainer(
                    groupID: groupID,
                    name: name.trimmingCharacters(in: .whitespaces),
                    isActive: !hasActive
                )
            },
            saved: { if let result { await created(result) } }
        ) {
            Section {
                TextField(String(localized: "dean.schedule.versionName", defaultValue: "Название, например «Осень 2026»"), text: $name)
            } footer: {
                if hasActive {
                    Text(String(localized: "dean.schedule.versionDraftHint", defaultValue: "У группы уже есть действующее расписание — новая версия создастся черновиком. Опубликуйте её кнопкой «Сделать действующей»."))
                }
            }
        }
    }
}

// MARK: - Пара

/// Поля пары — общие у добавления и правки.
private struct DeanPairFields: View {
    @Binding var draft: DeanPairDraft
    @Binding var room: DeanPickOption?
    @Binding var teacher: DeanPickOption?

    private let api = DeanAPI()

    var body: some View {
        Section {
            TextField(String(localized: "dean.schedule.subject", defaultValue: "Предмет"), text: $draft.subject)
            Picker(String(localized: "dean.schedule.day", defaultValue: "День"), selection: $draft.dayOfWeek) {
                ForEach(1...7, id: \.self) { Text(DeanText.day($0)).tag($0) }
            }
            Picker(String(localized: "dean.schedule.weekType", defaultValue: "Неделя"), selection: $draft.weekType) {
                ForEach(DeanText.weekTypes, id: \.self) { Text(DeanText.weekType($0)).tag($0) }
            }
            DatePicker(
                String(localized: "dean.schedule.start", defaultValue: "Начало"),
                selection: Binding(get: { DeanTime.date(draft.startTime) }, set: { draft.startTime = DeanTime.string($0) }),
                displayedComponents: .hourAndMinute
            )
            DatePicker(
                String(localized: "dean.schedule.end", defaultValue: "Конец"),
                selection: Binding(get: { DeanTime.date(draft.endTime) }, set: { draft.endTime = DeanTime.string($0) }),
                displayedComponents: .hourAndMinute
            )
            if draft.startTime >= draft.endTime {
                Text(String(localized: "dean.schedule.timeOrder", defaultValue: "Конец должен быть позже начала"))
                    .font(.caption)
                    .foregroundStyle(Palette.destructive)
            }
        }

        Section {
            DeanPickerField(
                title: String(localized: "dean.exams.room", defaultValue: "Аудитория"),
                selection: $room,
                load: DeanPickers.rooms(api)
            )
            DeanPickerField(
                title: String(localized: "dean.courses.col.teacher", defaultValue: "Преподаватель"),
                selection: $teacher,
                load: DeanPickers.teachingStaff(api)
            )
        } footer: {
            Text(String(localized: "dean.schedule.teacherHint", defaultValue: "Преподавателем пары можно поставить преподавателя или декана вуза."))
        }
    }
}

private struct DeanPairForm: View {
    let scheduleID: String
    let pair: DeanPair?
    let saved: () async -> Void

    @State private var draft: DeanPairDraft
    @State private var room: DeanPickOption?
    @State private var teacher: DeanPickOption?

    private let api = DeanAPI()

    init(scheduleID: String, pair: DeanPair?, day: Int, saved: @escaping () async -> Void) {
        self.scheduleID = scheduleID
        self.pair = pair
        self.saved = saved
        var draft = DeanPairDraft()
        draft.dayOfWeek = day
        _draft = State(initialValue: draft)
    }

    private var isValid: Bool {
        !draft.subject.trimmingCharacters(in: .whitespaces).isEmpty && draft.startTime < draft.endTime
    }

    var body: some View {
        FormSheet(
            title: String(localized: "dean.schedule.addPair", defaultValue: "Добавить пару"),
            saveTitle: String(localized: "dean.schedule.create", defaultValue: "Создать"),
            canSave: isValid,
            save: {
                var draft = draft
                draft.roomId = room?.id
                draft.teacherId = teacher?.id
                do {
                    try await api.createPair(scheduleID: scheduleID, draft: draft)
                } catch {
                    throw DeanErrorText.failure(DeanErrorText.message(error))
                }
            },
            saved: saved
        ) {
            DeanPairFields(draft: $draft, room: $room, teacher: $teacher)
        }
    }
}

/// Карточка пары: правка постоянного расписания сверху, разовые изменения снизу. Это
/// разные вещи: правка меняет саму пару, изменение — только одну дату.
private struct DeanPairSheet: View {
    let pair: DeanPair
    let scheduleID: String
    let containerActive: Bool
    let timezone: String?
    let changed: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var draft: DeanPairDraft
    @State private var room: DeanPickOption?
    @State private var teacher: DeanPickOption?
    @State private var changes: [DeanScheduleChange]?
    /// Изменения не загрузились — не «Разовых изменений нет».
    @State private var changesFailure: String?
    @State private var change: DeanScheduleChangeDraft
    @State private var changeDate: Date
    @State private var changeRoom: DeanPickOption?
    @State private var changeTeacher: DeanPickOption?
    @State private var changeStart = DeanTime.date("08:00")
    @State private var changeEnd = DeanTime.date("09:30")
    @State private var failure: String?
    @State private var notice: String?
    @State private var isSaving = false
    @State private var confirmDelete = false
    @State private var removing: DeanScheduleChange?

    private let api = DeanAPI()

    init(pair: DeanPair, scheduleID: String, containerActive: Bool, timezone: String?, changed: @escaping () async -> Void) {
        self.pair = pair
        self.scheduleID = scheduleID
        self.containerActive = containerActive
        self.timezone = timezone
        self.changed = changed
        _draft = State(initialValue: DeanPairDraft(
            subject: pair.subject,
            dayOfWeek: pair.dayOfWeek,
            startTime: pair.startTime,
            endTime: pair.endTime,
            weekType: pair.weekType,
            roomId: pair.room?.id,
            teacherId: pair.teacher?.id
        ))
        _room = State(initialValue: pair.room.map { DeanPickOption(id: $0.id, title: $0.name) })
        _teacher = State(initialValue: pair.teacher.map { DeanPickOption(id: $0.id, title: $0.name) })
        let next = Self.nextDate(of: pair.dayOfWeek)
        _changeDate = State(initialValue: next)
        _change = State(initialValue: DeanScheduleChangeDraft(date: DeanTime.day(next)))
        _changeStart = State(initialValue: DeanTime.date(pair.startTime))
        _changeEnd = State(initialValue: DeanTime.date(pair.endTime))
    }

    /// Ближайшая дата с днём недели пары — с неё удобно начинать разовое изменение.
    private static func nextDate(of weekday: Int) -> Date {
        let today = Calendar.current.startOfDay(for: Date())
        for offset in 0..<7 {
            if let date = Calendar.current.date(byAdding: .day, value: offset, to: today), DeanTime.isoWeekday(date) == weekday {
                return date
            }
        }
        return today
    }

    private var zone: TimeZone { timezone.flatMap(TimeZone.init(identifier:)) ?? .current }

    var body: some View {
        NavigationStack {
            Form {
                if let failure {
                    FormAlert(message: failure)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }

                DeanPairFields(draft: $draft, room: $room, teacher: $teacher)

                if containerActive {
                    changesSection
                    newChangeSection
                } else {
                    Section {
                        IconRow(
                            title: String(localized: "dean.schedule.changeDraftHint", defaultValue: "Разовые изменения — только у пар действующей версии: черновик группа не видит."),
                            symbol: "calendar.badge.exclamationmark",
                            tint: TileTint.gray
                        )
                    }
                }

                // Опасное — последним, отдельной секцией, как в карточках чатов.
                Section {
                    Button(role: .destructive) {
                        confirmDelete = true
                    } label: {
                        Label(String(localized: "dean.schedule.deletePair", defaultValue: "Удалить пару"), systemImage: "trash")
                            .foregroundStyle(Palette.destructive)
                    }
                    .disabled(isSaving)
                }
            }
            .navigationTitle(Text(pair.subject))
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
                        Button(String(localized: "common.save", defaultValue: "Сохранить")) { Task { await savePair() } }
                            .disabled(draft.subject.trimmingCharacters(in: .whitespaces).isEmpty || draft.startTime >= draft.endTime)
                    }
                }
            }
            .task { if containerActive, changes == nil { await loadChanges() } }
            .confirmationDialog(
                String(localized: "dean.schedule.deletePairConfirm", defaultValue: "Удалить пару из расписания?"),
                isPresented: $confirmDelete,
                titleVisibility: .visible
            ) {
                Button(String(localized: "dean.schedule.deletePair", defaultValue: "Удалить пару"), role: .destructive) {
                    Task { await deletePair() }
                }
            } message: {
                Text(String(localized: "dean.schedule.deletePairHint", defaultValue: "Пара исчезнет у группы и преподавателя. Если по ней уже отмечали посещаемость, удалить не получится."))
            }
            .confirmDestructive(
                $removing,
                title: { _ in String(localized: "dean.schedule.removeChangeConfirm", defaultValue: "Убрать изменение? Пара вернётся в своё обычное время, группа получит уведомление.") },
                actionTitle: String(localized: "dean.schedule.removeChange", defaultValue: "Убрать изменение")
            ) { item in
                await removeChange(item)
            }
            .alert(notice ?? "", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
                Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
            }
        }
    }

    @ViewBuilder
    private var changesSection: some View {
        Section {
            if let changes {
                let own = changes.filter { $0.pairId == pair.id }
                if own.isEmpty {
                    Text(String(localized: "dean.schedule.noChanges", defaultValue: "Разовых изменений нет"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
                ForEach(own) { item in
                    let kind = DeanText.changeType(item.type)
                    TelegramStyleRow(title: kind.0, subtitle: changeSubtitle(item)) {
                        DeanDateTile(date: item.date, tint: kind.1)
                    }
                    .swipeActions {
                        Button(role: .destructive) {
                            removing = item
                        } label: {
                            Label(String(localized: "dean.schedule.removeChange", defaultValue: "Убрать изменение"), systemImage: "arrow.uturn.backward")
                        }
                    }
                    .contextMenu {
                        Button(role: .destructive) {
                            removing = item
                        } label: {
                            Label(String(localized: "dean.schedule.removeChange", defaultValue: "Убрать изменение"), systemImage: "arrow.uturn.backward")
                        }
                    }
                }
            } else if let changesFailure {
                DashboardFailurePlaceholder(message: changesFailure) { await loadChanges() }
            } else {
                ProgressView()
            }
        } header: {
            Text(String(localized: "dean.schedule.pairChanges", defaultValue: "Изменения этой пары"))
        } footer: {
            Text(String(localized: "dean.schedule.pairChangesHint", defaultValue: "Неделя назад и семестр вперёд. Ошибочное изменение убирается свайпом."))
        }
    }

    @ViewBuilder
    private var newChangeSection: some View {
        Section {
            Picker(String(localized: "dean.schedule.changeType", defaultValue: "Что меняется"), selection: $change.type) {
                ForEach(DeanText.changeTypes, id: \.self) { Text(DeanText.changeType($0).0).tag($0) }
            }
            DatePicker(String(localized: "dean.schedule.changeDate", defaultValue: "Дата"), selection: $changeDate, displayedComponents: .date)
            if let dateError {
                Text(dateError).font(.caption).foregroundStyle(Palette.destructive)
            }
            switch change.type {
            case "ROOM_CHANGED":
                DeanPickerField(
                    title: String(localized: "dean.schedule.newRoom", defaultValue: "Новая аудитория"),
                    selection: $changeRoom,
                    allowsNone: false,
                    load: DeanPickers.rooms(api)
                )
            case "SUBSTITUTED":
                DeanPickerField(
                    title: String(localized: "dean.schedule.substitute", defaultValue: "Заменяющий"),
                    selection: $changeTeacher,
                    allowsNone: false,
                    load: DeanPickers.teachingStaff(api)
                )
            case "MOVED":
                DatePicker(String(localized: "dean.schedule.newStart", defaultValue: "Новое начало"), selection: $changeStart, displayedComponents: .hourAndMinute)
                DatePicker(String(localized: "dean.schedule.newEnd", defaultValue: "Новый конец"), selection: $changeEnd, displayedComponents: .hourAndMinute)
            default:
                EmptyView()
            }
            TextField(String(localized: "dean.schedule.note", defaultValue: "Комментарий для группы"), text: Binding(get: { change.note ?? "" }, set: { change.note = $0 }))
            Button {
                Task { await createChange() }
            } label: {
                Label(String(localized: "dean.schedule.createChange", defaultValue: "Создать изменение"), systemImage: "calendar.badge.plus")
            }
            .disabled(!canCreateChange || isSaving)
        } header: {
            Text(String(localized: "dean.schedule.newChange", defaultValue: "Разовое изменение"))
        } footer: {
            Text(String(localized: "dean.schedule.newChangeHint", defaultValue: "Отмена, перенос, смена аудитории или замена на одну дату. Группа и преподаватель получат уведомление."))
        }
    }

    /// Изменение на день, когда пары нет, никто не увидит — сервер его тоже отклонит.
    private var dateError: String? {
        if DeanTime.isoWeekday(changeDate) != pair.dayOfWeek {
            return String(localized: "dean.schedule.wrongDay", defaultValue: "Пара идёт в другой день: \(DeanText.day(pair.dayOfWeek))")
        }
        if !WeekParity.current(changeDate).includes(weekType: pair.weekType) {
            return String(localized: "dean.schedule.wrongWeek", defaultValue: "В эту неделю пары нет: \(DeanText.weekType(pair.weekType))")
        }
        return nil
    }

    private var canCreateChange: Bool {
        guard dateError == nil else { return false }
        switch change.type {
        case "ROOM_CHANGED": return changeRoom != nil
        case "SUBSTITUTED": return changeTeacher != nil
        case "MOVED": return DeanTime.string(changeStart) < DeanTime.string(changeEnd)
        default: return true
        }
    }

    private func changeSubtitle(_ item: DeanScheduleChange) -> String? {
        let parts = [detail(item), item.note].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: "\n")
    }

    private func detail(_ item: DeanScheduleChange) -> String? {
        switch item.type {
        case "MOVED":
            guard let start = item.newStartTime, let end = item.newEndTime else { return nil }
            return "\(start)–\(end)"
        case "ROOM_CHANGED": return item.newRoom?.name
        case "SUBSTITUTED": return item.newTeacher?.name
        default: return nil
        }
    }

    @MainActor
    private func loadChanges() async {
        let today = Date()
        let from = Calendar.current.date(byAdding: .day, value: -7, to: today) ?? today
        let to = Calendar.current.date(byAdding: .day, value: 120, to: today) ?? today
        do {
            changes = try await api.scheduleChanges(
                from: DeanTime.day(from, timeZone: zone),
                to: DeanTime.day(to, timeZone: zone),
                groupID: pair.groupId
            )
            changesFailure = nil
        } catch is CancellationError {
            return
        } catch {
            // Прежний список не стираем; без него — сбой с повтором на месте секции.
            changesFailure = error.userMessage
        }
    }

    @MainActor
    private func savePair() async {
        isSaving = true
        defer { isSaving = false }
        var draft = draft
        draft.roomId = room?.id
        draft.teacherId = teacher?.id
        do {
            try await api.updatePair(id: pair.id, draft: draft)
            await changed()
            dismiss()
        } catch {
            failure = DeanErrorText.message(error)
        }
    }

    @MainActor
    private func deletePair() async {
        isSaving = true
        defer { isSaving = false }
        do {
            try await api.deletePair(id: pair.id)
            await changed()
            dismiss()
        } catch {
            if let api = error as? APIError, api.code == .conflict {
                failure = String(localized: "dean.schedule.deleteHasAttendance", defaultValue: "По паре уже отмечена посещаемость — удалить её нельзя. Перенесите или отмените занятие разовым изменением.")
            } else {
                failure = error.userMessage
            }
        }
    }

    @MainActor
    private func createChange() async {
        isSaving = true
        defer { isSaving = false }
        var draft = change
        draft.date = DeanTime.day(changeDate)
        draft.newRoomId = changeRoom?.id
        draft.newTeacherId = changeTeacher?.id
        draft.newStartTime = DeanTime.string(changeStart)
        draft.newEndTime = DeanTime.string(changeEnd)
        do {
            try await api.createScheduleChange(pairID: pair.id, draft: draft)
            change = DeanScheduleChangeDraft(date: draft.date)
            changeRoom = nil
            changeTeacher = nil
            failure = nil
            notice = String(localized: "dean.schedule.changeCreated", defaultValue: "Изменение создано, группа получит уведомление")
            await loadChanges()
        } catch {
            failure = DeanErrorText.message(error)
        }
    }

    @MainActor
    private func removeChange(_ item: DeanScheduleChange) async {
        do {
            try await api.deleteScheduleChange(id: item.id)
            changes?.removeAll { $0.id == item.id }
        } catch {
            failure = DeanErrorText.message(error)
        }
    }
}
