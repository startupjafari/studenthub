import AVKit
import SwiftUI

// Камеры вуза (PROJECT.md §3.10): выключатель модуля, агенты в сети вуза, камеры за ними
// и просмотр потока. Видео — LL-HLS ретранслятора с медиатокеном в заголовке; токен
// продлевается пульсом сессии просмотра.

// MARK: - Управление

struct UAdminCamerasView: View {
    @State private var enabled: Bool?
    @State private var agents: [UAdminCameraAgentDTO]?
    @State private var cameras: [UAdminCameraDTO]?
    @State private var failure: String?
    @State private var isOffline = false
    @State private var actionFailure: String?
    @State private var confirmDisable = false
    @State private var creatingAgent = false
    @State private var issued: UAdminAgentTokenDTO?
    @State private var rotating: UAdminCameraAgentDTO?
    @State private var deletingAgent: UAdminCameraAgentDTO?
    @State private var cameraForm: CameraFormTarget?
    @State private var deletingCamera: UAdminCameraDTO?
    @State private var togglingModule = false

    var body: some View {
        List {
            if let enabled, let agents, let cameras {
                moduleSection(enabled)
                agentsSection(agents)
                camerasSection(cameras, agents: agents, enabled: enabled)
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(UniAdminScreen.cameras.title))
        .sheet(isPresented: $creatingAgent) {
            AgentNameForm { token in issued = token } saved: { await load() }
        }
        .sheet(item: Binding(get: { issued.map(IssuedToken.init) }, set: { if $0 == nil { issued = nil } })) { token in
            AgentTokenSheet(name: token.value.agent.name, token: token.value.token)
        }
        .sheet(item: $cameraForm) { target in
            CameraForm(camera: target.camera, agents: agents ?? []) { await load() }
        }
        .confirmationDialog(
            String(localized: "uadmin.cameras.disableConfirm", defaultValue: "Выключить камеры? Все просмотры прервутся сразу, новые станут недоступны."),
            isPresented: $confirmDisable,
            titleVisibility: .visible
        ) {
            Button(String(localized: "uadmin.cameras.disable", defaultValue: "Выключить камеры"), role: .destructive) {
                Task { await setModule(false) }
            }
        }
        .confirmDestructive(
            $rotating,
            title: { String(localized: "uadmin.cameras.rotateConfirm", defaultValue: "Перевыпустить токен агента «\($0.name)»? Прежний перестанет работать сразу, пароли его камер придётся ввести заново.") },
            actionTitle: String(localized: "uadmin.cameras.rotate", defaultValue: "Перевыпустить токен")
        ) { agent in
            do {
                issued = try await UAdminAPI().rotateAgentToken(id: agent.id)
                await load()
            } catch {
                actionFailure = error.userMessage
            }
        }
        .confirmDestructive(
            $deletingAgent,
            title: { String(localized: "uadmin.cameras.deleteAgentConfirm", defaultValue: "Удалить агента «\($0.name)» вместе с его камерами (\($0.cameraCount.formatted()))?") },
            actionTitle: String(localized: "uadmin.delete", defaultValue: "Удалить")
        ) { agent in
            await run { try await UAdminAPI().deleteAgent(id: agent.id) }
        }
        .confirmDestructive(
            $deletingCamera,
            title: { String(localized: "uadmin.cameras.deleteCameraConfirm", defaultValue: "Удалить камеру «\($0.name)»?") },
            actionTitle: String(localized: "uadmin.delete", defaultValue: "Удалить")
        ) { camera in
            await run { try await UAdminAPI().deleteCamera(id: camera.id) }
        }
        .actionFailureAlert($actionFailure)
        .refreshable { await load() }
        .task { await load() }
    }

    private func moduleSection(_ enabled: Bool) -> some View {
        Section {
            Toggle(
                isOn: Binding(
                    get: { enabled },
                    set: { value in
                        if value {
                            Task { await setModule(true) }
                        } else {
                            confirmDisable = true
                        }
                    }
                )
            ) {
                Label(String(localized: "uadmin.cameras.module", defaultValue: "Камеры вуза"), systemImage: "power")
            }
            .disabled(togglingModule)
        } footer: {
            Text(String(localized: "uadmin.cameras.moduleHint", defaultValue: "Агенты в сети вуза, камеры за ними и выключатель модуля. Смотрят камеры только охрана и администратор вуза."))
        }
    }

    private func agentsSection(_ agents: [UAdminCameraAgentDTO]) -> some View {
        Section {
            if agents.isEmpty {
                Text(String(localized: "uadmin.cameras.agentsEmpty", defaultValue: "Агентов пока нет. Добавьте агента и установите его на сервер в сети, где находятся камеры."))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            }
            ForEach(agents) { agent in
                ListCardRow(
                    title: agent.name,
                    subtitle: [
                        agent.version.map { String(localized: "uadmin.cameras.version", defaultValue: "Версия \($0)") },
                        String(localized: "uadmin.cameras.count", defaultValue: "Камер: \(agent.cameraCount.formatted())"),
                    ].compactMap { $0 }.joined(separator: " · "),
                    status: Self.connection(agent.connection),
                    lines: [agent.lastSeenAt.map { String(localized: "uadmin.cameras.lastSeen", defaultValue: "На связи: \(DisplayFormat.relative($0))") } ?? ""]
                )
                .swipeActions {
                    Button(role: .destructive) {
                        deletingAgent = agent
                    } label: {
                        Label(String(localized: "uadmin.delete", defaultValue: "Удалить"), systemImage: "trash")
                    }
                    Button {
                        rotating = agent
                    } label: {
                        Label(String(localized: "uadmin.cameras.rotate", defaultValue: "Перевыпустить токен"), systemImage: "key")
                    }
                    .tint(Palette.warning)
                }
                .contextMenu {
                    Button {
                        rotating = agent
                    } label: {
                        Label(String(localized: "uadmin.cameras.rotate", defaultValue: "Перевыпустить токен"), systemImage: "key")
                    }
                    Button(role: .destructive) {
                        deletingAgent = agent
                    } label: {
                        Label(String(localized: "uadmin.cameras.deleteAgent", defaultValue: "Удалить агента"), systemImage: "trash")
                    }
                }
            }
            Button {
                creatingAgent = true
            } label: {
                Label(String(localized: "uadmin.cameras.addAgent", defaultValue: "Добавить агента"), systemImage: "plus")
            }
        } header: {
            Text(String(localized: "uadmin.cameras.agents", defaultValue: "Агенты"))
        } footer: {
            Text(String(localized: "uadmin.cameras.agentsHint", defaultValue: "Программа в сети вуза: забирает видео с камер и отдаёт его наружу только по запросу."))
        }
    }

    private func camerasSection(_ cameras: [UAdminCameraDTO], agents: [UAdminCameraAgentDTO], enabled: Bool) -> some View {
        Section {
            if enabled, !cameras.isEmpty {
                NavigationLink(value: AppRoute.uniAdmin(.cameraWatch)) {
                    Label(String(localized: "uadmin.cameras.watch", defaultValue: "Смотреть камеры"), systemImage: "play.rectangle")
                }
            }
            if cameras.isEmpty {
                Text(
                    agents.isEmpty
                        ? String(localized: "uadmin.cameras.addAgentFirst", defaultValue: "Сначала добавьте агента")
                        : String(localized: "uadmin.cameras.camerasEmpty", defaultValue: "Камер пока нет. Добавьте камеру: адрес её потока в сети вуза и, если нужно, логин и пароль.")
                )
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
            }
            ForEach(cameras) { camera in
                Button {
                    cameraForm = CameraFormTarget(camera: camera)
                } label: {
                    ListCardRow(
                        title: camera.name,
                        subtitle: [camera.room?.name, camera.agent?.name].compactMap { $0 }.joined(separator: " · "),
                        status: camera.enabled
                            ? UAdminCameraStatus.badge(camera.status)
                            : (String(localized: "uadmin.cameras.disabledCamera", defaultValue: "Отключена"), Palette.mutedForeground),
                        lines: [
                            camera.hasCredentials == true
                                ? String(localized: "uadmin.cameras.passwordSet", defaultValue: "Пароль задан")
                                : String(localized: "uadmin.cameras.passwordNone", defaultValue: "Без пароля"),
                        ]
                    )
                    .opacity(camera.enabled ? 1 : 0.6)
                }
                .buttonStyle(.plain)
                .swipeActions {
                    Button(role: .destructive) {
                        deletingCamera = camera
                    } label: {
                        Label(String(localized: "uadmin.delete", defaultValue: "Удалить"), systemImage: "trash")
                    }
                }
            }
            Button {
                cameraForm = CameraFormTarget(camera: nil)
            } label: {
                Label(String(localized: "uadmin.cameras.addCamera", defaultValue: "Добавить камеру"), systemImage: "plus")
            }
            .disabled(agents.isEmpty)
        } header: {
            Text(String(localized: "uadmin.cameras.cameras", defaultValue: "Камеры"))
        } footer: {
            Text(String(localized: "uadmin.cameras.camerasHint", defaultValue: "Пароль камеры шифруется ключом агента — платформа его не видит."))
        }
    }

    static func connection(_ raw: String) -> (String, Color) {
        switch raw {
        case "ONLINE": return (String(localized: "uadmin.cameras.connection.online", defaultValue: "На связи"), Palette.success)
        case "OFFLINE": return (String(localized: "uadmin.cameras.connection.offline", defaultValue: "Нет связи"), Palette.mutedForeground)
        case "NEVER": return (String(localized: "uadmin.cameras.connection.never", defaultValue: "Ещё не подключался"), Palette.warning)
        default: return (raw, Palette.mutedForeground)
        }
    }

    @MainActor
    private func load() async {
        let api = UAdminAPI()
        do {
            async let settingsTask = api.cameraSettings()
            async let agentsTask = api.cameraAgents()
            async let camerasTask = api.cameras()
            let (settings, agentList, cameraList) = try await (settingsTask, agentsTask, camerasTask)
            enabled = settings
            agents = agentList
            cameras = cameraList
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    @MainActor
    private func run(_ action: () async throws -> Void) async {
        do {
            try await action()
            await load()
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func setModule(_ value: Bool) async {
        togglingModule = true
        defer { togglingModule = false }
        await run { try await UAdminAPI().setCameras(enabled: value) }
    }
}

enum UAdminCameraStatus {
    static func badge(_ raw: String) -> (String, Color) {
        switch raw {
        case "ONLINE": return (String(localized: "uadmin.cameras.status.online", defaultValue: "В сети"), Palette.success)
        case "OFFLINE": return (String(localized: "uadmin.cameras.status.offline", defaultValue: "Нет связи"), Palette.mutedForeground)
        case "AUTH_FAILED": return (String(localized: "uadmin.cameras.status.authFailed", defaultValue: "Неверный пароль"), Palette.destructive)
        case "UNKNOWN": return (String(localized: "uadmin.cameras.status.unknown", defaultValue: "Неизвестно"), Palette.mutedForeground)
        default: return (raw, Palette.mutedForeground)
        }
    }
}

private struct CameraFormTarget: Identifiable {
    let id = UUID()
    let camera: UAdminCameraDTO?
}

private struct IssuedToken: Identifiable {
    let value: UAdminAgentTokenDTO
    var id: String { value.agent.id + value.token.suffix(6) }
}

private struct AgentNameForm: View {
    let created: (UAdminAgentTokenDTO) -> Void
    let saved: () async -> Void

    @State private var name = ""
    @State private var result: UAdminAgentTokenDTO?

    var body: some View {
        FormSheet(
            title: String(localized: "uadmin.cameras.addAgent", defaultValue: "Добавить агента"),
            canSave: !trimmed.isEmpty && trimmed.count <= 100,
            save: { result = try await UAdminAPI().createAgent(name: trimmed) },
            saved: {
                await saved()
                // Токен показываем после закрытия формы: два листа разом SwiftUI не покажет.
                try? await Task.sleep(for: .milliseconds(600))
                if let result { created(result) }
            }
        ) {
            Section {
                TextField(String(localized: "uadmin.cameras.agentPlaceholder", defaultValue: "Например, «Главный корпус»"), text: $name)
            }
        }
    }

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
}

/// Токен агента показывается один раз: потом получить его можно только перевыпуском.
private struct AgentTokenSheet: View {
    let name: String
    let token: String

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    UAdminSecretField(value: token)
                } header: {
                    Text(String(localized: "uadmin.cameras.token", defaultValue: "Токен"))
                } footer: {
                    Text(String(localized: "uadmin.cameras.tokenHint", defaultValue: "Токен показывается один раз. Укажите его при установке агента в сети вуза и никому не передавайте: с ним можно выдать себя за агента."))
                }
            }
            .navigationTitle(Text(String(localized: "uadmin.cameras.tokenTitle", defaultValue: "Токен агента «\(name)»")))
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled()
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "uadmin.cameras.tokenDone", defaultValue: "Я сохранил токен")) { dismiss() }
                }
            }
        }
    }
}

/// Камера: агент (только при создании — пароль запечатан его ключом), адрес RTSP без
/// учётных данных, помещение, логин и пароль отдельными полями.
private struct CameraForm: View {
    let camera: UAdminCameraDTO?
    let agents: [UAdminCameraAgentDTO]
    let saved: () async -> Void

    @State private var name = ""
    @State private var agentID = ""
    @State private var streamUrl = ""
    @State private var room: UAdminRefDTO?
    @State private var enabled = true
    @State private var credentials: CredentialsMode = .keep
    @State private var username = ""
    @State private var password = ""
    @State private var pickingRoom = false
    @State private var prepared = false

    var body: some View {
        FormSheet(
            title: camera == nil
                ? String(localized: "uadmin.cameras.addCamera", defaultValue: "Добавить камеру")
                : String(localized: "uadmin.cameras.editCamera", defaultValue: "Изменить камеру"),
            canSave: valid,
            save: save,
            saved: saved
        ) {
            Section {
                TextField(String(localized: "uadmin.cameras.namePlaceholder", defaultValue: "Название, например «Вход, корпус А»"), text: $name)
                if camera == nil {
                    Picker(String(localized: "uadmin.cameras.agent", defaultValue: "Агент"), selection: $agentID) {
                        ForEach(agents) { Text($0.name).tag($0.id) }
                    }
                } else if let agent = camera?.agent {
                    LabeledContent(String(localized: "uadmin.cameras.agent", defaultValue: "Агент"), value: agent.name)
                }
                UAdminPickerRow(
                    title: String(localized: "uadmin.cameras.room", defaultValue: "Помещение"),
                    value: room?.name,
                    placeholder: String(localized: "uadmin.picker.none", defaultValue: "Не выбрано")
                ) { pickingRoom = true }
                if camera != nil {
                    Toggle(String(localized: "uadmin.cameras.enabled", defaultValue: "Камера включена"), isOn: $enabled)
                }
            }

            Section {
                TextField("rtsp://10.0.0.5:554/Streaming/Channels/102", text: $streamUrl)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .font(.body.monospaced())
            } header: {
                Text(String(localized: "uadmin.cameras.streamUrl", defaultValue: "Адрес потока"))
            } footer: {
                Text(
                    urlValid || streamUrl.isEmpty
                        ? String(localized: "uadmin.cameras.streamHint", defaultValue: "RTSP-адрес в сети вуза, без логина и пароля. Лучше второй поток камеры — он легче.")
                        : String(localized: "uadmin.cameras.streamInvalid", defaultValue: "Адрес вида rtsp://10.0.0.5:554/… — с хостом камеры, без логина и пароля (они — в отдельных полях)")
                )
                .foregroundStyle(urlValid || streamUrl.isEmpty ? Palette.mutedForeground : Palette.destructive)
            }

            Section {
                Picker(String(localized: "uadmin.cameras.credentials", defaultValue: "Пароль камеры"), selection: $credentials) {
                    Text(
                        camera?.hasCredentials == true
                            ? String(localized: "uadmin.cameras.keepPassword", defaultValue: "Оставить как есть")
                            : String(localized: "uadmin.cameras.noPassword", defaultValue: "Без пароля")
                    ).tag(CredentialsMode.keep)
                    Text(String(localized: "uadmin.cameras.setPassword", defaultValue: "Задать логин и пароль")).tag(CredentialsMode.set)
                    if camera?.hasCredentials == true {
                        Text(String(localized: "uadmin.cameras.clearPassword", defaultValue: "Убрать пароль")).tag(CredentialsMode.clear)
                    }
                }
                if credentials == .set {
                    TextField(String(localized: "uadmin.cameras.username", defaultValue: "Логин"), text: $username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField(String(localized: "uadmin.cameras.password", defaultValue: "Пароль"), text: $password)
                }
            } footer: {
                Text(String(localized: "uadmin.cameras.credentialsHint", defaultValue: "Пароль шифруется ключом агента и больше не показывается — ни вам, ни платформе."))
            }
        }
        .sheet(isPresented: $pickingRoom) {
            UAdminSearchPicker(
                title: String(localized: "uadmin.cameras.room", defaultValue: "Помещение"),
                prompt: String(localized: "uadmin.searchByName", defaultValue: "Поиск по названию"),
                allowsNone: true,
                load: UAdminPickers.rooms,
                label: \.name,
                detail: UAdminPickers.roomDetail
            ) { picked in
                room = picked.map { UAdminRefDTO(id: $0.id, name: $0.name) }
            }
        }
        .onAppear {
            guard !prepared else { return }
            prepared = true
            name = camera?.name ?? ""
            agentID = camera?.agent?.id ?? agents.first?.id ?? ""
            streamUrl = camera?.streamUrl ?? ""
            room = camera?.room
            enabled = camera?.enabled ?? true
        }
    }

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedURL: String { streamUrl.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// Та же проверка, что `CameraStreamUrlSchema`: схема rtsp(s), хост, без `логин@`.
    private var urlValid: Bool {
        let value = trimmedURL
        guard value.count <= 500, let range = value.range(of: "^rtsps?://", options: [.regularExpression, .caseInsensitive]) else {
            return false
        }
        let rest = value[range.upperBound...]
        let authority = rest.prefix { !"/?#".contains($0) }
        guard !authority.isEmpty, !authority.contains("@") else { return false }
        return String(authority).range(of: "^(\\[[0-9a-fA-F:.]+\\]|[a-zA-Z0-9.-]+)(:[0-9]{1,5})?$", options: .regularExpression) != nil
    }

    private var valid: Bool {
        guard !trimmedName.isEmpty, trimmedName.count <= 100, urlValid else { return false }
        if camera == nil, agentID.isEmpty { return false }
        if credentials == .set {
            let user = username.trimmingCharacters(in: .whitespaces)
            return !user.isEmpty && user.count <= 100 && !password.isEmpty && password.count <= 200
        }
        return true
    }

    private func save() async throws {
        var body: [String: JSONValue] = [
            "name": .string(trimmedName),
            "streamUrl": .string(trimmedURL),
            "roomId": .text(room?.id),
        ]
        switch credentials {
        case .set:
            body["credentials"] = .object(["username": .string(username.trimmingCharacters(in: .whitespaces)), "password": .string(password)])
        case .clear:
            body["credentials"] = .null
        case .keep:
            break
        }
        if camera == nil {
            body["agentId"] = .string(agentID)
        } else {
            body["enabled"] = .bool(enabled)
        }
        do {
            try await UAdminAPI().saveCamera(id: camera?.id, body: body)
        } catch where UAdminFailure.isConflict(error) && UAdminFailure.fields(error).contains("agentId") {
            throw UAdminFailure.message(String(localized: "uadmin.cameras.agentNotReady", defaultValue: "Агент ещё не выходил на связь: запустите его, затем задайте пароль камеры."))
        }
    }
}

private enum CredentialsMode: Hashable {
    case keep, set, clear
}

// MARK: - Просмотр

/// Просмотр камер: до четырёх окон одновременно — столько же разрешает сервер. Видео идёт
/// только в открытых окнах: закрыл окно — сессия закончилась, агент перестал отдавать поток.
struct UAdminCameraWatchView: View {
    @State private var enabled: Bool?
    @State private var cameras: [UAdminCameraDTO]?
    @State private var failure: String?
    @State private var isOffline = false
    @State private var watched: [String] = []
    @State private var limitReached = false

    private static let maxWatched = 4

    var body: some View {
        List {
            if let enabled, let cameras {
                if !enabled {
                    EmptyStateView(
                        title: String(localized: "uadmin.watch.disabled", defaultValue: "Камеры выключены"),
                        symbol: "video.slash",
                        hint: String(localized: "uadmin.watch.disabledHint", defaultValue: "Включите модуль камер в управлении камерами.")
                    )
                    .listRowBackground(Color.clear)
                } else if cameras.isEmpty {
                    EmptyStateView(
                        title: String(localized: "uadmin.watch.empty", defaultValue: "Камер пока нет"),
                        symbol: "video",
                        hint: String(localized: "uadmin.watch.emptyHint", defaultValue: "Добавьте камеру в управлении камерами.")
                    )
                    .listRowBackground(Color.clear)
                } else {
                    if watched.isEmpty {
                        Text(String(localized: "uadmin.watch.pick", defaultValue: "Выберите камеру в списке. Одновременно — до четырёх."))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                            .listRowBackground(Color.clear)
                    }
                    ForEach(watched, id: \.self) { id in
                        if let camera = cameras.first(where: { $0.id == id }) {
                            Section {
                                CameraPlayer(cameraID: camera.id)
                                    .listRowInsets(EdgeInsets())
                            } header: {
                                HStack {
                                    Text(verbatim: [camera.name, camera.room?.name].compactMap { $0 }.joined(separator: " · "))
                                    Spacer()
                                    Button {
                                        watched.removeAll { $0 == id }
                                    } label: {
                                        Image(systemName: "xmark.circle.fill")
                                    }
                                    .accessibilityLabel(Text(String(localized: "uadmin.watch.close", defaultValue: "Закрыть")))
                                }
                            }
                        }
                    }
                    Section {
                        ForEach(cameras) { camera in
                            Button {
                                toggle(camera.id)
                            } label: {
                                HStack {
                                    Image(systemName: watched.contains(camera.id) ? "play.rectangle.fill" : "play.rectangle")
                                        .foregroundStyle(watched.contains(camera.id) ? Palette.primary : Palette.mutedForeground)
                                        .accessibilityHidden(true)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(camera.name).foregroundStyle(Palette.foreground)
                                        if let room = camera.room {
                                            Text(room.name).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                                        }
                                    }
                                    Spacer()
                                    let status = UAdminCameraStatus.badge(camera.status)
                                    StatusBadge(text: status.0, tint: status.1)
                                }
                            }
                            .accessibilityAddTraits(watched.contains(camera.id) ? .isSelected : [])
                        }
                    } header: {
                        Text(String(localized: "uadmin.watch.list", defaultValue: "Камеры вуза"))
                    } footer: {
                        Text(String(localized: "uadmin.watch.footer", defaultValue: "Видео в реальном времени, без звука. Каждый просмотр записывается в журнал."))
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
        .navigationTitle(Text(UniAdminScreen.cameraWatch.title))
        .navigationBarTitleDisplayMode(.inline)
        .alert(
            String(localized: "uadmin.watch.limit", defaultValue: "Одновременно можно смотреть не больше четырёх камер"),
            isPresented: $limitReached
        ) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        }
        .refreshable { await load() }
        .task { await load() }
    }

    private func toggle(_ id: String) {
        if watched.contains(id) {
            watched.removeAll { $0 == id }
        } else if watched.count >= Self.maxWatched {
            limitReached = true
        } else {
            watched.append(id)
        }
    }

    @MainActor
    private func load() async {
        let api = UAdminAPI()
        do {
            async let settingsTask = api.cameraSettings()
            async let camerasTask = api.cameras()
            let (settings, list) = try await (settingsTask, camerasTask)
            enabled = settings
            cameras = list.filter(\.enabled)
            watched.removeAll { id in !list.contains { $0.id == id && $0.enabled } }
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }
}

/// Одно окно камеры: сессия просмотра, пульс и плеер.
private struct CameraPlayer: View {
    let cameraID: String

    @State private var session = CameraViewSession()

    var body: some View {
        ZStack {
            Color.black
            if let player = session.player {
                VideoPlayer(player: player)
            }
            switch session.state {
            case .starting:
                VStack(spacing: Spacing.sm) {
                    ProgressView().tint(.white)
                    Text(String(localized: "uadmin.watch.connecting", defaultValue: "Подключение к камере…"))
                        .font(Typography.meta)
                        .foregroundStyle(.white)
                }
            case .failed(let message):
                Text(message)
                    .font(Typography.meta)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding()
            case .playing:
                EmptyView()
            }
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .task { await session.run(cameraID: cameraID) }
        .onDisappear { session.stop() }
    }
}

@MainActor
@Observable
private final class CameraViewSession {
    enum State: Equatable {
        case starting
        case playing
        case failed(String)
    }

    var state: State = .starting
    var player: AVPlayer?

    @ObservationIgnored private var sessionID: String?
    @ObservationIgnored private var builtAt = Date.distantPast

    /// Старт, затем пульс до отмены задачи. Заголовки у `AVURLAsset` неизменяемы, поэтому
    /// поток пересобирается со свежим токеном, пока старый ещё действует.
    func run(cameraID: String) async {
        let api = UAdminAPI()
        do {
            var ticket = try await api.startView(cameraID: cameraID)
            sessionID = ticket.sessionId
            attach(ticket)
            while !Task.isCancelled {
                try await Task.sleep(for: .seconds(max(5, ticket.heartbeatInSec)))
                guard let id = sessionID else { return }
                do {
                    ticket = try await api.heartbeatView(sessionID: id)
                    let age = Date().timeIntervalSince(builtAt)
                    if age >= Double(max(ticket.expiresInSec - ticket.heartbeatInSec, ticket.heartbeatInSec)) {
                        attach(ticket)
                    }
                } catch let error as APIError where error.code == .notFound {
                    // Сессию закрыл сервер (перезапуск, выключение камеры) — начинаем заново.
                    ticket = try await api.startView(cameraID: cameraID)
                    sessionID = ticket.sessionId
                    attach(ticket)
                }
            }
        } catch is CancellationError {
            return
        } catch {
            state = .failed(Self.reason(error))
            player?.pause()
        }
    }

    func stop() {
        player?.pause()
        player = nil
        if let id = sessionID {
            sessionID = nil
            Task { try? await UAdminAPI().endView(sessionID: id) }
        }
    }

    private func attach(_ ticket: UAdminCameraViewTicketDTO) {
        guard let url = URL(string: ticket.hlsUrl) else {
            state = .failed(String(localized: "uadmin.watch.failed", defaultValue: "Не удалось получить видео. Закройте окно и откройте снова."))
            return
        }
        let asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": ["Authorization": "Bearer \(ticket.token)"]])
        let item = AVPlayerItem(asset: asset)
        if let player {
            player.replaceCurrentItem(with: item)
        } else {
            let created = AVPlayer(playerItem: item)
            created.isMuted = true
            player = created
        }
        player?.play()
        builtAt = Date()
        state = .playing
    }

    private static func reason(_ error: Error) -> String {
        guard UAdminFailure.isConflict(error) else { return error.userMessage }
        switch UAdminFailure.fields(error).first {
        case "relay": return String(localized: "uadmin.watch.blocked.relay", defaultValue: "Просмотр камер ещё не настроен на платформе.")
        case "module": return String(localized: "uadmin.watch.blocked.module", defaultValue: "Камеры вуза выключены.")
        case "camera": return String(localized: "uadmin.watch.blocked.camera", defaultValue: "Камера отключена.")
        case "views": return String(localized: "uadmin.watch.blocked.views", defaultValue: "Открыто слишком много камер — закройте одну.")
        default: return error.userMessage
        }
    }
}
