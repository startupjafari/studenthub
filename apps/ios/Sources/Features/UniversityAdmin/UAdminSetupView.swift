import SwiftUI

// Мастер первичной настройки вуза (`views/onboarding`). Открыт один шаг за раз; каждый
// закрывается прямо здесь короткой формой — ровно тем, чего серверу хватает, чтобы
// засчитать шаг. Пройденность считает сервер по самим данным.

struct UAdminSetupView: View {
    @State private var state: UAdminOnboardingDTO?
    @State private var failure: String?
    @State private var isOffline = false
    @State private var actionFailure: String?
    @State private var open: String?
    @State private var cityName: String?
    @State private var busy: String?
    @State private var launched = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if let state {
                content(state)
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .navigationTitle(Text(UniAdminScreen.setup.title))
        .actionFailureAlert($actionFailure)
        .alert(String(localized: "uadmin.setup.launched", defaultValue: "Вуз запущен"), isPresented: $launched) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        }
        .pullToRefresh { await load() }
        .task { await load() }
    }

    private func content(_ state: UAdminOnboardingDTO) -> some View {
        let done = state.steps.filter { $0.done || $0.skipped }.count
        let active = state.university.status == "ACTIVE"
        return List {
            Section {
                HeroHeader(
                    visual: .symbol("wand.and.stars", tint: TileTint.purple),
                    title: state.university.name,
                    subtitle: String(localized: "uadmin.setup.subtitle", defaultValue: "Заполните структуру «\(state.university.name)» — платформа проведёт по шагам")
                ) {
                    StatusBadge(
                        text: active
                            ? String(localized: "uadmin.setup.statusActive", defaultValue: "Вуз запущен")
                            : String(localized: "uadmin.setup.statusSetup", defaultValue: "Идёт настройка"),
                        tint: active ? Palette.success : Palette.warning
                    )
                }
            }

            Section {
                ShareBar(
                    title: String(localized: "uadmin.setup.progress", defaultValue: "Пройдено шагов"),
                    fraction: state.steps.isEmpty ? 0 : Double(done) / Double(state.steps.count),
                    valueText: String(localized: "uadmin.setup.progressValue", defaultValue: "\(done.formatted()) из \(state.steps.count.formatted())"),
                    tint: done == state.steps.count ? Palette.success : Palette.primary
                )
            }

            ForEach(Array(state.steps.enumerated()), id: \.element.id) { index, step in
                Section {
                    Button {
                        withAnimation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion)) { open = open == step.step ? nil : step.step }
                    } label: {
                        StepHeader(index: index, step: step, isOpen: open == step.step)
                    }
                    .buttonStyle(.plain)
                    if open == step.step {
                        Text(SetupText.hint(step.step))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                        stepBody(step, state: state)
                        if step.skippable, !step.done, !step.skipped {
                            Button {
                                Task { await skip(step.step) }
                            } label: {
                                Label(String(localized: "uadmin.setup.skip", defaultValue: "Пропустить шаг"), systemImage: "forward")
                            }
                            .disabled(busy != nil)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
    }

    @ViewBuilder
    private func stepBody(_ step: UAdminOnboardingDTO.Step, state: UAdminOnboardingDTO) -> some View {
        switch step.step {
        case "profile":
            DetailRow(title: String(localized: "uadmin.setup.profile.name", defaultValue: "Название"), value: state.university.name)
            DetailRow(title: String(localized: "uadmin.setup.profile.short", defaultValue: "Аббревиатура"), value: state.university.shortName ?? UAdminText.empty)
            DetailRow(title: String(localized: "uadmin.setup.profile.city", defaultValue: "Город"), value: cityName ?? state.university.city ?? UAdminText.empty)
            DetailRow(title: String(localized: "uadmin.setup.profile.timezone", defaultValue: "Часовой пояс"), value: state.university.timezone ?? UAdminText.empty)
            Text(String(localized: "uadmin.setup.profile.fix", defaultValue: "Реквизиты меняет платформа. Если что-то неверно — напишите нам, и мы поправим."))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
            if !step.done {
                Button {
                    Task { await apply { try await UAdminAPI().confirmProfile() } }
                } label: {
                    Label(String(localized: "uadmin.setup.profile.confirm", defaultValue: "Всё верно"), systemImage: "checkmark")
                }
                .disabled(busy != nil)
            }
        case "faculties":
            QuickAdd(placeholder: String(localized: "uadmin.setup.faculties.placeholder", defaultValue: "Название факультета")) { name in
                try await UAdminAPI().createFaculty(name: name)
            } added: { await load() }
        case "specialties":
            QuickAdd(placeholder: String(localized: "uadmin.setup.specialties.placeholder", defaultValue: "Название специальности")) { name in
                try await UAdminAPI().createSpecialty(name: name)
            } added: { await load() }
        case "groups":
            GroupsStep { await load() }
        case "rooms":
            QuickAdd(placeholder: String(localized: "uadmin.setup.rooms.placeholder", defaultValue: "Номер или название аудитории")) { name in
                try await UAdminAPI().saveRoom(id: nil, body: ["name": .string(name)])
            } added: { await load() }
        case "subjects":
            QuickAdd(placeholder: String(localized: "uadmin.setup.subjects.placeholder", defaultValue: "Название предмета")) { name in
                try await UAdminAPI().saveSubject(id: nil, name: name, code: nil)
            } added: { await load() }
        case "terms":
            TermsStep { await load() }
        case "deans":
            DeansStep { await load() }
        case "launch":
            launchBody(state)
        default:
            EmptyView()
        }
    }

    /// Чек-лист вместо одной кнопки: видно, что именно мешает запуску. Что блокирует —
    /// решает сервер (`blocking`).
    @ViewBuilder
    private func launchBody(_ state: UAdminOnboardingDTO) -> some View {
        if state.university.status == "ACTIVE" {
            Label(String(localized: "uadmin.setup.launchedAlready", defaultValue: "Вуз запущен и работает"), systemImage: "checkmark.seal")
                .foregroundStyle(Palette.success)
        } else {
            let blocking = Set(state.blocking)
            ForEach(state.steps.filter { $0.step != "launch" }) { step in
                Button {
                    withAnimation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion)) { open = step.step }
                } label: {
                    HStack {
                        Image(systemName: step.done ? "checkmark.circle.fill" : blocking.contains(step.step) ? "exclamationmark.circle" : "minus.circle")
                            .foregroundStyle(step.done ? Palette.success : blocking.contains(step.step) ? Palette.warning : Palette.mutedForeground)
                            .accessibilityHidden(true)
                        Text(SetupText.title(step.step)).foregroundStyle(Palette.foreground)
                        Spacer()
                        Text(
                            step.done
                                ? String(localized: "uadmin.setup.checkDone", defaultValue: "готово")
                                : blocking.contains(step.step)
                                    ? String(localized: "uadmin.setup.checkMissing", defaultValue: "не заполнено")
                                    : String(localized: "uadmin.setup.skipped", defaultValue: "пропущен")
                        )
                        .font(Typography.meta)
                        .foregroundStyle(step.done ? Palette.success : blocking.contains(step.step) ? Palette.warning : Palette.mutedForeground)
                    }
                }
            }
            Text(
                state.canLaunch
                    ? String(localized: "uadmin.setup.launchReady", defaultValue: "Всё обязательное заполнено. После запуска платформа откроется всем, кого вы пригласили.")
                    : String(localized: "uadmin.setup.launchBlocked", defaultValue: "Осталось шагов: \(state.blocking.count.formatted()) — заполните их, и вуз можно запускать.")
            )
            .font(Typography.meta)
            .foregroundStyle(Palette.mutedForeground)
            Button {
                Task {
                    await apply { try await UAdminAPI().launch() }
                    if self.state?.university.status == "ACTIVE" { launched = true }
                }
            } label: {
                Label(String(localized: "uadmin.setup.launch", defaultValue: "Запустить вуз"), systemImage: "paperplane")
                    .font(.body.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Spacing.xs)
            }
            .glassProminentButton()
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: Spacing.sm, leading: 0, bottom: Spacing.sm, trailing: 0))
            .disabled(!state.canLaunch || busy != nil)
        }
    }

    @MainActor
    private func load() async {
        do {
            let loaded = try await UAdminAPI().onboarding()
            // Открываем шаг, на котором человек остановился, — только при первой загрузке:
            // иначе карточка уезжала бы из-под рук после каждого добавления.
            if state == nil, open == nil { open = loaded.currentStep }
            state = loaded
            failure = nil
            if cityName == nil, let code = loaded.university.city, !code.isEmpty {
                cityName = try? await UAdminAPI().cityName(code: code)
            }
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    @MainActor
    private func apply(_ action: () async throws -> UAdminOnboardingDTO) async {
        busy = "action"
        defer { busy = nil }
        do {
            state = try await action()
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func skip(_ step: String) async {
        await apply { try await UAdminAPI().skip(step: step) }
        if let next = state?.currentStep { open = next }
    }
}

private struct StepHeader: View {
    let index: Int
    let step: UAdminOnboardingDTO.Step
    let isOpen: Bool

    var body: some View {
        HStack(spacing: Spacing.lg) {
            // Как значок чата: пройденный шаг — зелёная галочка, текущий — синий номер.
            if step.done {
                RowSymbol(symbol: "checkmark", tint: TileTint.green, size: 36)
            } else if step.skipped {
                RowSymbol(symbol: "forward.fill", tint: TileTint.gray, size: 36)
            } else {
                Text(verbatim: String(index + 1))
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(isOpen ? Palette.primaryForeground : Palette.foreground)
                    .frame(width: 36, height: 36)
                    .background(isOpen ? Palette.primary : Palette.muted, in: Circle())
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(SetupText.title(step.step)).font(.body.weight(.semibold)).foregroundStyle(Palette.foreground)
                Text(subtitle).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.down")
                .rotationEffect(.degrees(isOpen ? 180 : 0))
                .foregroundStyle(Palette.mutedForeground)
                .accessibilityHidden(true)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }

    private var subtitle: String {
        if step.skipped { return String(localized: "uadmin.setup.skipped", defaultValue: "пропущен") }
        if let count = step.count, count > 0 {
            return String(localized: "uadmin.setup.counted", defaultValue: "заведено: \(count.formatted())")
        }
        return SetupText.short(step.step)
    }
}

private enum SetupText {
    static func title(_ step: String) -> String {
        switch step {
        case "profile": return String(localized: "uadmin.setup.step.profile", defaultValue: "О вузе")
        case "faculties": return String(localized: "uadmin.setup.step.faculties", defaultValue: "Факультеты")
        case "specialties": return String(localized: "uadmin.setup.step.specialties", defaultValue: "Специальности")
        case "groups": return String(localized: "uadmin.setup.step.groups", defaultValue: "Группы")
        case "rooms": return String(localized: "uadmin.setup.step.rooms", defaultValue: "Аудитории")
        case "terms": return String(localized: "uadmin.setup.step.terms", defaultValue: "Учебный год")
        case "subjects": return String(localized: "uadmin.setup.step.subjects", defaultValue: "Предметы")
        case "deans": return String(localized: "uadmin.setup.step.deans", defaultValue: "Деканы")
        case "launch": return String(localized: "uadmin.setup.step.launch", defaultValue: "Запуск")
        default: return step
        }
    }

    static func short(_ step: String) -> String {
        switch step {
        case "profile": return String(localized: "uadmin.setup.short.profile", defaultValue: "Проверьте реквизиты")
        case "faculties": return String(localized: "uadmin.setup.short.faculties", defaultValue: "Добавьте факультеты")
        case "specialties": return String(localized: "uadmin.setup.short.specialties", defaultValue: "Справочник специальностей")
        case "groups": return String(localized: "uadmin.setup.short.groups", defaultValue: "Добавьте группы")
        case "rooms": return String(localized: "uadmin.setup.short.rooms", defaultValue: "Добавьте аудитории")
        case "terms": return String(localized: "uadmin.setup.short.terms", defaultValue: "Заведите семестр")
        case "subjects": return String(localized: "uadmin.setup.short.subjects", defaultValue: "Справочник предметов")
        case "deans": return String(localized: "uadmin.setup.short.deans", defaultValue: "Пригласите деканов")
        case "launch": return String(localized: "uadmin.setup.short.launch", defaultValue: "Проверка и запуск")
        default: return ""
        }
    }

    static func hint(_ step: String) -> String {
        switch step {
        case "profile":
            return String(localized: "uadmin.setup.hint.profile", defaultValue: "С этих данных начинается всё остальное: название стоит в шапке у каждого, кто войдёт, а часовой пояс определяет, в котором часу начнётся пара. Проверьте и подтвердите.")
        case "faculties":
            return String(localized: "uadmin.setup.hint.faculties", defaultValue: "Факультет — верхний уровень структуры: на нём держатся группы, деканы и права доступа. Без факультетов дальше не пройти ни одному шагу.")
        case "specialties":
            return String(localized: "uadmin.setup.hint.specialties", defaultValue: "Справочник, из которого студент выбирает специальность в профиле. Достаточно завести основные — остальные добавите позже.")
        case "groups":
            return String(localized: "uadmin.setup.hint.groups", defaultValue: "Группа — то, к чему привязаны расписание, журнал и чаты. Студента приглашают в группу, поэтому без групп нельзя позвать ни одного студента.")
        case "rooms":
            return String(localized: "uadmin.setup.hint.rooms", defaultValue: "Аудитории нужны расписанию и печатным QR над дверью: студент сканирует код и видит, что здесь сейчас идёт.")
        case "terms":
            return String(localized: "uadmin.setup.hint.terms", defaultValue: "Семестр задаёт границы учебного периода. Без него нельзя составить расписание и открыть журнал.")
        case "subjects":
            return String(localized: "uadmin.setup.hint.subjects", defaultValue: "Общий список дисциплин вуза — из него собираются курсы и расписание. Достаточно завести основные.")
        case "deans":
            return String(localized: "uadmin.setup.hint.deans", defaultValue: "Декана приглашаете вы, старост и студентов — декан. Ссылку-приглашение покажем сразу после создания.")
        case "launch":
            return String(localized: "uadmin.setup.hint.launch", defaultValue: "Пока вуз не запущен, он заведён, но не работает. Запуск открывает платформу всем, кого вы пригласили.")
        default:
            return ""
        }
    }

    static func failure(_ error: Error) -> String {
        UAdminFailure.isConflict(error)
            ? String(localized: "uadmin.setup.nameTaken", defaultValue: "Запись с таким названием уже есть")
            : error.userMessage
    }
}

/// Быстрое добавление одной строкой: поле остаётся на месте, список набивают подряд.
private struct QuickAdd<Extra: View>: View {
    let placeholder: String
    var disabled = false
    @ViewBuilder var extra: () -> Extra
    let add: (String) async throws -> Void
    let added: () async -> Void

    @State private var name = ""
    @State private var isSaving = false
    @State private var failure: String?
    @FocusState private var focused: Bool

    var body: some View {
        extra()
        HStack {
            TextField(placeholder, text: $name)
                .focused($focused)
                .submitLabel(.done)
                .onSubmit { Task { await submit() } }
                .disabled(disabled)
            if isSaving {
                ProgressView()
            } else {
                Button(String(localized: "uadmin.setup.add", defaultValue: "Добавить")) { Task { await submit() } }
                    .disabled(disabled || trimmed.isEmpty)
            }
        }
        if let failure {
            Text(failure).font(Typography.meta).foregroundStyle(Palette.destructive)
        }
    }

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    @MainActor
    private func submit() async {
        let value = trimmed
        guard !value.isEmpty, !disabled, !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            try await add(value)
            name = ""
            failure = nil
            focused = true
            await added()
        } catch {
            failure = SetupText.failure(error)
        }
    }
}

extension QuickAdd where Extra == EmptyView {
    init(placeholder: String, add: @escaping (String) async throws -> Void, added: @escaping () async -> Void) {
        self.init(placeholder: placeholder, extra: { EmptyView() }, add: add, added: added)
    }
}

/// Группа заводится только на факультете — рядом с полем выбор факультета.
private struct GroupsStep: View {
    let added: () async -> Void

    @State private var faculties: [UAdminFacultyDTO]?
    @State private var faculty = ""

    var body: some View {
        if let faculties {
            if faculties.isEmpty {
                Text(String(localized: "uadmin.setup.needFaculties", defaultValue: "Сначала заведите хотя бы один факультет — группа привязывается к нему."))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.warning)
            } else {
                QuickAdd(
                    placeholder: String(localized: "uadmin.setup.groups.placeholder", defaultValue: "Название группы"),
                    disabled: faculty.isEmpty
                ) {
                    Picker(String(localized: "uadmin.faculty", defaultValue: "Факультет"), selection: $faculty) {
                        ForEach(faculties) { Text($0.name).tag($0.id) }
                    }
                } add: { name in
                    try await UAdminAPI().createGroup(name: name, year: nil, facultyID: faculty)
                } added: {
                    await added()
                }
            }
        } else {
            ProgressView()
                .task {
                    let list = (try? await UAdminAPI().faculties()) ?? []
                    faculties = list
                    faculty = list.first?.id ?? ""
                }
        }
    }
}

/// Семестр одной строкой: название и две даты. Номер и «текущий» правят в дисциплинах.
private struct TermsStep: View {
    let added: () async -> Void

    @State private var name = ""
    @State private var startsOn = Date()
    @State private var endsOn = Calendar.current.date(byAdding: .month, value: 4, to: Date()) ?? Date()
    @State private var isSaving = false
    @State private var failure: String?

    var body: some View {
        TextField(String(localized: "uadmin.setup.terms.placeholder", defaultValue: "Название семестра"), text: $name)
        DatePicker(String(localized: "uadmin.terms.starts", defaultValue: "Начало"), selection: $startsOn, displayedComponents: .date)
        DatePicker(String(localized: "uadmin.terms.ends", defaultValue: "Конец"), selection: $endsOn, in: startsOn..., displayedComponents: .date)
        Button {
            Task { await submit() }
        } label: {
            if isSaving {
                ProgressView()
            } else {
                Label(String(localized: "uadmin.setup.add", defaultValue: "Добавить"), systemImage: "plus")
            }
        }
        .disabled(trimmed.isEmpty || trimmed.count > 120 || isSaving)
        if let failure {
            Text(failure).font(Typography.meta).foregroundStyle(Palette.destructive)
        }
    }

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    @MainActor
    private func submit() async {
        isSaving = true
        defer { isSaving = false }
        do {
            try await UAdminAPI().saveTerm(
                id: nil,
                body: [
                    "name": .string(trimmed),
                    "startsOn": .string(UAdminDay.string(startsOn)),
                    "endsOn": .string(UAdminDay.string(endsOn)),
                ]
            )
            name = ""
            failure = nil
            await added()
        } catch {
            failure = error.userMessage
        }
    }
}

/// Приглашение декана: факультет и, по желанию, почта. Ссылка показывается сразу и один
/// раз: сырого токена сервер не хранит.
private struct DeansStep: View {
    let added: () async -> Void

    @State private var faculties: [UAdminFacultyDTO]?
    @State private var faculty = ""
    @State private var email = ""
    @State private var link: String?
    @State private var isSaving = false
    @State private var failure: String?

    var body: some View {
        if let faculties {
            if faculties.isEmpty {
                Text(String(localized: "uadmin.setup.needFaculties", defaultValue: "Сначала заведите хотя бы один факультет — группа привязывается к нему."))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.warning)
            } else {
                Picker(String(localized: "uadmin.faculty", defaultValue: "Факультет"), selection: $faculty) {
                    ForEach(faculties) { Text($0.name).tag($0.id) }
                }
                TextField(String(localized: "uadmin.setup.deans.placeholder", defaultValue: "Почта декана — необязательно"), text: $email)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Button {
                    Task { await invite() }
                } label: {
                    if isSaving {
                        ProgressView()
                    } else {
                        Label(String(localized: "uadmin.setup.invite", defaultValue: "Пригласить"), systemImage: "person.badge.plus")
                    }
                }
                .disabled(faculty.isEmpty || isSaving)
                if let failure {
                    Text(failure).font(Typography.meta).foregroundStyle(Palette.destructive)
                }
                if let link {
                    Text(String(localized: "uadmin.setup.inviteCreated", defaultValue: "Приглашение создано. Ссылка показывается один раз — скопируйте её и отправьте декану."))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                    UAdminSecretField(value: link)
                }
            }
        } else {
            ProgressView()
                .task {
                    let list = (try? await UAdminAPI().faculties()) ?? []
                    faculties = list
                    faculty = list.first?.id ?? ""
                }
        }
    }

    @MainActor
    private func invite() async {
        isSaving = true
        defer { isSaving = false }
        do {
            let trimmed = email.trimmingCharacters(in: .whitespaces)
            let created = try await UAdminAPI().inviteDean(facultyID: faculty, email: trimmed.isEmpty ? nil : trimmed)
            let path = "register?token=\(created.token)"
            link = AppConfiguration.webBaseURL.map { "\($0.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/\(path)" } ?? "/\(path)"
            email = ""
            failure = nil
            await added()
        } catch {
            failure = error.userMessage
        }
    }
}
