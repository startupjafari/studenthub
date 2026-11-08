import SwiftUI

// Кампусы вуза (Ф22): список, свойства, корпуса и этажи, публикация и версии карты.
// Холст-редактор этажа и территории (`/campus-editor/*`) на телефоне не повторяем: план
// смотрится в общей карте кампуса, а всё, что в вебе делается формами, — здесь.

// MARK: - Список

struct UAdminCampusListView: View {
    @State private var items: [UAdminCampusSummaryDTO]?
    @State private var failure: String?
    @State private var isOffline = false
    @State private var creating = false

    var body: some View {
        List {
            if let items {
                if items.isEmpty {
                    EmptyStateView(
                        title: String(localized: "uadmin.campus.empty", defaultValue: "Кампусов пока нет"),
                        symbol: "map",
                        hint: String(localized: "uadmin.campus.emptyHint", defaultValue: "Создайте кампус, добавьте корпус и этажи — после публикации карту увидят все в вузе."),
                        actionTitle: String(localized: "uadmin.campus.create", defaultValue: "Создать кампус"),
                        action: { creating = true }
                    )
                    .listRowBackground(Color.clear)
                } else {
                    Section {
                        ForEach(items) { campus in
                            NavigationLink(value: AppRoute.uniAdmin(.campus(id: campus.id))) {
                                ListCardRow(
                                    title: campus.name,
                                    subtitle: campus.description,
                                    status: campus.publishedVersionId == nil
                                        ? (String(localized: "uadmin.campus.draft", defaultValue: "Черновик"), Palette.mutedForeground)
                                        : (String(localized: "uadmin.campus.published", defaultValue: "Опубликован"), Palette.success),
                                    lines: [String(localized: "uadmin.campus.buildingsCount", defaultValue: "Корпусов: \(campus.buildingsCount.formatted())")]
                                )
                            }
                        }
                    } footer: {
                        Text(String(localized: "uadmin.campus.editorHint", defaultValue: "Планы этажей рисуются в редакторе веб-версии. Здесь — корпуса, этажи, публикация и версии."))
                    }
                    .listRowBackground(Palette.card)
                    Section {
                        NavigationLink(value: AppRoute.section(.campusMap)) {
                            IconRow(title: String(localized: "uadmin.campus.openMap", defaultValue: "Открыть карту"), symbol: "map", tint: TileTint.green)
                        }
                    }
                    .listRowBackground(Palette.card)
                }
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle(Text(UniAdminScreen.campuses.title))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    creating = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel(Text(String(localized: "uadmin.campus.create", defaultValue: "Создать кампус")))
            }
        }
        .sheet(isPresented: $creating) {
            CampusPropertiesForm(campus: nil) { await load() }
        }
        .refreshable { await load() }
        .task { await load() }
    }

    @MainActor
    private func load() async {
        do {
            items = try await UAdminAPI().campuses()
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }
}

/// Название и описание кампуса: создание и правка свойств.
private struct CampusPropertiesForm: View {
    let campus: UAdminCampusTreeDTO?
    let saved: () async -> Void

    @State private var name = ""
    @State private var description = ""
    @State private var prepared = false

    var body: some View {
        FormSheet(
            title: campus == nil
                ? String(localized: "uadmin.campus.create", defaultValue: "Создать кампус")
                : String(localized: "uadmin.campus.properties", defaultValue: "Свойства кампуса"),
            canSave: !trimmed.isEmpty && trimmed.count <= 120,
            save: {
                let api = UAdminAPI()
                let text = String(description.trimmingCharacters(in: .whitespacesAndNewlines).prefix(1000))
                if let campus {
                    try await api.updateCampus(id: campus.id, name: trimmed, description: text)
                } else {
                    _ = try await api.createCampus(name: trimmed, description: text)
                }
            },
            saved: saved
        ) {
            Section {
                TextField(String(localized: "uadmin.campus.namePlaceholder", defaultValue: "Название, например Главный кампус"), text: $name)
                TextField(String(localized: "uadmin.campus.description", defaultValue: "Описание"), text: $description, axis: .vertical)
                    .lineLimit(2...6)
            }
            .listRowBackground(Palette.card)
        }
        .onAppear {
            guard !prepared else { return }
            prepared = true
            name = campus?.name ?? ""
            description = campus?.description ?? ""
        }
    }

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
}

// MARK: - Кампус

struct UAdminCampusDetailView: View {
    let campusID: String

    @Environment(\.dismiss) private var dismiss
    @State private var tree: UAdminCampusTreeDTO?
    @State private var versions: [UAdminCampusVersionDTO] = []
    @State private var failure: String?
    @State private var isOffline = false
    @State private var actionFailure: String?
    @State private var notice: String?
    @State private var editingProperties = false
    @State private var publishing = false
    @State private var creatingBuilding = false
    @State private var editingBuilding: UAdminCampusBuildingDTO?
    @State private var deletingBuilding: UAdminCampusBuildingDTO?
    @State private var addingFloorTo: UAdminCampusBuildingDTO?
    @State private var editingFloor: UAdminCampusFloorDTO?
    @State private var deletingFloor: UAdminCampusFloorDTO?
    @State private var restoring: UAdminCampusVersionDTO?
    @State private var deletingCampus = false

    var body: some View {
        Group {
            if let tree {
                content(tree)
            } else if let failure {
                ErrorStateView(message: failure, isOffline: isOffline) { await load() }
            } else {
                LoadingStateView()
            }
        }
        .background(Palette.background)
        .navigationTitle(Text(tree?.name ?? UniAdminScreen.campus(id: campusID).title))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let tree {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(String(localized: "uadmin.campus.publish", defaultValue: "Опубликовать")) { publishing = true }
                        .disabled(tree.buildings.isEmpty)
                }
            }
        }
        .sheet(isPresented: $editingProperties) {
            if let tree { CampusPropertiesForm(campus: tree) { await load() } }
        }
        .sheet(isPresented: $publishing) {
            if let tree { PublishSheet(tree: tree) { message in notice = message; await load() } }
        }
        .sheet(isPresented: $creatingBuilding) {
            BuildingForm(campusID: campusID, building: nil) { await load() }
        }
        .sheet(item: $editingBuilding) { building in
            BuildingForm(campusID: campusID, building: building) { await load() }
        }
        .sheet(item: $addingFloorTo) { building in
            AddFloorForm(building: building) { await load() }
        }
        .sheet(item: $editingFloor) { floor in
            FloorForm(floor: floor) { await load() }
        }
        .confirmDestructive(
            $deletingBuilding,
            title: { String(localized: "uadmin.campus.deleteBuildingConfirm", defaultValue: "Удалить корпус «\($0.name)» со всеми этажами?") },
            actionTitle: String(localized: "uadmin.delete", defaultValue: "Удалить")
        ) { building in
            await run { try await UAdminAPI().deleteBuilding(id: building.id) }
        }
        .confirmDestructive(
            $deletingFloor,
            title: { String(localized: "uadmin.campus.deleteFloorConfirm", defaultValue: "Удалить \($0.label) этаж со всеми стенами и помещениями?") },
            actionTitle: String(localized: "uadmin.delete", defaultValue: "Удалить")
        ) { floor in
            await run { try await UAdminAPI().deleteFloor(id: floor.id) }
        }
        .confirmationDialog(
            restoring.map { String(localized: "uadmin.campus.restoreConfirm", defaultValue: "Восстановить черновики из версии №\(String($0.number))?") } ?? "",
            isPresented: Binding(get: { restoring != nil }, set: { if !$0 { restoring = nil } }),
            titleVisibility: .visible,
            presenting: restoring
        ) { version in
            Button(String(localized: "uadmin.campus.restore", defaultValue: "В черновик")) {
                Task { await restore(version) }
            }
        } message: { _ in
            Text(String(localized: "uadmin.campus.restoreHint", defaultValue: "Текущие черновики этажей уйдут в снимки — их можно вернуть."))
        }
        .confirmationDialog(
            String(localized: "uadmin.campus.deleteConfirm", defaultValue: "Удалить кампус? Карта исчезнет у всех, корпуса и этажи удалятся вместе с ней."),
            isPresented: $deletingCampus,
            titleVisibility: .visible
        ) {
            Button(String(localized: "uadmin.campus.delete", defaultValue: "Удалить кампус"), role: .destructive) {
                Task { await deleteCampus() }
            }
        }
        .actionFailureAlert($actionFailure)
        .alert(
            notice ?? "",
            isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })
        ) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        }
        .refreshable { await load() }
        .task { await load() }
    }

    private func content(_ tree: UAdminCampusTreeDTO) -> some View {
        List {
            Section {
                DetailRow(
                    title: String(localized: "uadmin.campus.state", defaultValue: "Публикация"),
                    value: tree.publishedVersion.map {
                        String(localized: "uadmin.campus.publishedVersion", defaultValue: "Версия №\(String($0.number)) · \(DisplayFormat.dateTime($0.publishedAt))")
                    } ?? String(localized: "uadmin.campus.notPublished", defaultValue: "Ещё не опубликован — студенты карту не видят"),
                    symbol: "paperplane"
                )
                if let description = tree.description, !description.isEmpty {
                    DetailRow(title: String(localized: "uadmin.campus.description", defaultValue: "Описание"), value: description, symbol: "text.alignleft")
                }
                Button {
                    editingProperties = true
                } label: {
                    Label(String(localized: "uadmin.campus.properties", defaultValue: "Свойства кампуса"), systemImage: "pencil")
                }
                if tree.publishedVersion != nil {
                    NavigationLink(value: AppRoute.section(.campusMap)) {
                        Label(String(localized: "uadmin.campus.openMap", defaultValue: "Открыть карту"), systemImage: "map")
                    }
                }
            } footer: {
                Text(String(localized: "uadmin.campus.editorHint", defaultValue: "Планы этажей рисуются в редакторе веб-версии. Здесь — корпуса, этажи, публикация и версии."))
            }
            .listRowBackground(Palette.card)

            if tree.buildings.isEmpty {
                EmptyStateView(
                    title: String(localized: "uadmin.campus.noBuildings", defaultValue: "Корпусов пока нет"),
                    symbol: "building.2",
                    hint: String(localized: "uadmin.campus.noBuildingsHint", defaultValue: "Добавьте первый корпус: форма, размеры и число этажей — стены по контуру появятся сами."),
                    actionTitle: String(localized: "uadmin.campus.addBuilding", defaultValue: "Добавить корпус"),
                    action: { creatingBuilding = true }
                )
                .listRowBackground(Color.clear)
            }

            ForEach(tree.buildings) { building in
                Section {
                    ForEach(building.floors.sorted { $0.level > $1.level }) { floor in
                        FloorRow(floor: floor)
                            .swipeActions {
                                Button(role: .destructive) {
                                    deletingFloor = floor
                                } label: {
                                    Label(String(localized: "uadmin.delete", defaultValue: "Удалить"), systemImage: "trash")
                                }
                                Button {
                                    editingFloor = floor
                                } label: {
                                    Label(String(localized: "uadmin.edit", defaultValue: "Изменить"), systemImage: "pencil")
                                }
                                .tint(Palette.primary)
                            }
                            .contextMenu {
                                Button {
                                    editingFloor = floor
                                } label: {
                                    Label(String(localized: "uadmin.edit", defaultValue: "Изменить"), systemImage: "pencil")
                                }
                                Button(role: .destructive) {
                                    deletingFloor = floor
                                } label: {
                                    Label(String(localized: "uadmin.campus.deleteFloor", defaultValue: "Удалить этаж"), systemImage: "trash")
                                }
                            }
                    }
                    Button {
                        addingFloorTo = building
                    } label: {
                        Label(String(localized: "uadmin.campus.addFloor", defaultValue: "Добавить этаж"), systemImage: "plus")
                    }
                } header: {
                    HStack {
                        Text(verbatim: [building.code, building.name].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                        Spacer()
                        Menu {
                            Button {
                                editingBuilding = building
                            } label: {
                                Label(String(localized: "uadmin.campus.editBuilding", defaultValue: "Изменить корпус"), systemImage: "pencil")
                            }
                            Button(role: .destructive) {
                                deletingBuilding = building
                            } label: {
                                Label(String(localized: "uadmin.campus.deleteBuilding", defaultValue: "Удалить корпус"), systemImage: "trash")
                            }
                        } label: {
                            Image(systemName: "ellipsis.circle")
                        }
                        .accessibilityLabel(Text(String(localized: "uadmin.actions", defaultValue: "Действия")))
                    }
                }
                .listRowBackground(Palette.card)
            }

            if !tree.buildings.isEmpty {
                Section {
                    Button {
                        creatingBuilding = true
                    } label: {
                        Label(String(localized: "uadmin.campus.addBuilding", defaultValue: "Добавить корпус"), systemImage: "building.2")
                    }
                }
                .listRowBackground(Palette.card)
            }

            Section {
                if versions.isEmpty {
                    Text(String(localized: "uadmin.campus.noVersions", defaultValue: "Публикаций ещё не было"))
                        .foregroundStyle(Palette.mutedForeground)
                }
                ForEach(versions) { version in
                    VersionRow(version: version)
                        .swipeActions {
                            Button {
                                restoring = version
                            } label: {
                                Label(String(localized: "uadmin.campus.restore", defaultValue: "В черновик"), systemImage: "arrow.uturn.backward")
                            }
                            if !version.current {
                                Button {
                                    Task { await activate(version) }
                                } label: {
                                    Label(String(localized: "uadmin.campus.makeCurrent", defaultValue: "Сделать текущей"), systemImage: "checkmark")
                                }
                                .tint(Palette.success)
                            }
                        }
                        .contextMenu {
                            if !version.current {
                                Button {
                                    Task { await activate(version) }
                                } label: {
                                    Label(String(localized: "uadmin.campus.makeCurrent", defaultValue: "Сделать текущей"), systemImage: "checkmark")
                                }
                            }
                            Button {
                                restoring = version
                            } label: {
                                Label(String(localized: "uadmin.campus.restore", defaultValue: "В черновик"), systemImage: "arrow.uturn.backward")
                            }
                        }
                }
            } header: {
                Text(String(localized: "uadmin.campus.versions", defaultValue: "Версии карты"))
            } footer: {
                Text(String(localized: "uadmin.campus.versionsHint", defaultValue: "Что сейчас видят пользователи, откат и восстановление черновиков"))
            }
            .listRowBackground(Palette.card)

            Section {
                Button(role: .destructive) {
                    deletingCampus = true
                } label: {
                    Label(String(localized: "uadmin.campus.delete", defaultValue: "Удалить кампус"), systemImage: "trash")
                }
            } footer: {
                Text(String(localized: "uadmin.campus.dangerHint", defaultValue: "Карта исчезнет у всех, корпуса и этажи удалятся вместе с ней"))
            }
            .listRowBackground(Palette.card)
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
    }

    @MainActor
    private func load() async {
        let api = UAdminAPI()
        do {
            async let treeTask = api.campus(id: campusID)
            async let versionsTask = api.campusVersions(id: campusID)
            tree = try await treeTask
            versions = (try? await versionsTask) ?? versions
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
    private func activate(_ version: UAdminCampusVersionDTO) async {
        await run { try await UAdminAPI().activateVersion(campusID: campusID, versionID: version.id) }
        if actionFailure == nil {
            notice = String(localized: "uadmin.campus.activated", defaultValue: "Карта переключена на выбранную версию")
        }
    }

    @MainActor
    private func restore(_ version: UAdminCampusVersionDTO) async {
        do {
            let count = try await UAdminAPI().restoreVersion(campusID: campusID, versionID: version.id)
            notice = String(localized: "uadmin.campus.restored", defaultValue: "Восстановлено этажей: \(count.formatted())")
            await load()
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func deleteCampus() async {
        do {
            try await UAdminAPI().deleteCampus(id: campusID)
            dismiss()
        } catch {
            actionFailure = error.userMessage
        }
    }
}

private struct FloorRow: View {
    let floor: UAdminCampusFloorDTO

    var body: some View {
        HStack(spacing: Spacing.lg) {
            IconTile(symbol: "square.stack.3d.up", tint: floor.kind == "technical" ? TileTint.gray : TileTint.indigo)
            VStack(alignment: .leading, spacing: 2) {
                Text(String(localized: "uadmin.campus.floorN", defaultValue: "\(floor.label) этаж"))
                    .font(Typography.body)
                    .foregroundStyle(Palette.foreground)
                Text(
                    [
                        FloorKind.title(floor.kind),
                        String(localized: "uadmin.campus.revision", defaultValue: "ревизия \(String(floor.plan?.revision ?? 0))"),
                    ].joined(separator: " · ")
                )
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct VersionRow: View {
    let version: UAdminCampusVersionDTO

    var body: some View {
        ListCardRow(
            title: String(localized: "uadmin.campus.versionN", defaultValue: "Версия №\(String(version.number))"),
            subtitle: [
                DisplayFormat.dateTime(version.publishedAt),
                String(localized: "uadmin.campus.spaces", defaultValue: "помещений: \(version.spaces.formatted())"),
            ].joined(separator: " · "),
            status: version.current ? (String(localized: "uadmin.campus.current", defaultValue: "Текущая"), Palette.success) : nil,
            lines: [version.note ?? ""]
        )
    }
}

private enum FloorKind {
    static let all = ["regular", "basement", "technical"]

    static func title(_ raw: String) -> String {
        switch raw {
        case "regular": return String(localized: "uadmin.campus.floorKind.regular", defaultValue: "Обычный")
        case "basement": return String(localized: "uadmin.campus.floorKind.basement", defaultValue: "Подвал")
        case "technical": return String(localized: "uadmin.campus.floorKind.technical", defaultValue: "Технический")
        default: return raw
        }
    }
}

// MARK: - Корпус

/// Новый корпус — шаблоном формы и размерами в метрах, как в вебе: каждый этаж сразу
/// получает наружные стены по контуру. Правка — только название и код: контур меняется
/// на холсте территории.
private struct BuildingForm: View {
    let campusID: String
    let building: UAdminCampusBuildingDTO?
    let saved: () async -> Void

    @State private var name = ""
    @State private var code = ""
    @State private var shape: BuildingShape = .rect
    @State private var width = "60"
    @State private var depth = "18"
    @State private var wing = "18"
    @State private var floors = "3"
    @State private var firstLevel = "1"
    @State private var height = "3.3"
    @State private var positionX = "0"
    @State private var positionY = "0"
    @State private var prepared = false

    var body: some View {
        FormSheet(
            title: building == nil
                ? String(localized: "uadmin.campus.addBuilding", defaultValue: "Добавить корпус")
                : String(localized: "uadmin.campus.editBuilding", defaultValue: "Изменить корпус"),
            canSave: valid,
            save: save,
            saved: saved
        ) {
            Section {
                TextField(String(localized: "uadmin.campus.buildingName", defaultValue: "Название, например Учебный корпус"), text: $name)
                TextField(String(localized: "uadmin.campus.buildingCode", defaultValue: "Код, например А"), text: $code)
            }
            .listRowBackground(Palette.card)

            if building == nil {
                Section {
                    Picker(String(localized: "uadmin.campus.shape", defaultValue: "Форма"), selection: $shape) {
                        ForEach(BuildingShape.allCases) { Text($0.title).tag($0) }
                    }
                    meters(String(localized: "uadmin.campus.width", defaultValue: "Длина, м"), $width)
                    meters(String(localized: "uadmin.campus.depth", defaultValue: "Ширина, м"), $depth)
                    if shape != .rect {
                        meters(String(localized: "uadmin.campus.wing", defaultValue: "Ширина крыла, м"), $wing)
                    }
                } header: {
                    Text(String(localized: "uadmin.campus.outline", defaultValue: "Контур"))
                }
                .listRowBackground(Palette.card)

                Section {
                    integer(String(localized: "uadmin.campus.floors", defaultValue: "Этажей"), $floors)
                    integer(String(localized: "uadmin.campus.firstLevel", defaultValue: "Нижний этаж"), $firstLevel)
                    meters(String(localized: "uadmin.campus.floorHeight", defaultValue: "Высота этажа, м"), $height)
                } header: {
                    Text(String(localized: "uadmin.campus.floorsSection", defaultValue: "Этажи"))
                } footer: {
                    Text(String(localized: "uadmin.campus.firstLevelHint", defaultValue: "−1 — подвал, 0 — цоколь. Каждый этаж сразу получит наружные стены по контуру."))
                }
                .listRowBackground(Palette.card)

                Section(String(localized: "uadmin.campus.position", defaultValue: "Положение на территории, м")) {
                    meters("X", $positionX)
                    meters("Y", $positionY)
                }
                .listRowBackground(Palette.card)
            }
        }
        .onAppear {
            guard !prepared else { return }
            prepared = true
            name = building?.name ?? ""
            code = building?.code ?? ""
        }
    }

    private func meters(_ title: String, _ value: Binding<String>) -> some View {
        LabeledContent(title) {
            TextField(title, text: value)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
        }
    }

    private func integer(_ title: String, _ value: Binding<String>) -> some View {
        LabeledContent(title) {
            TextField(title, text: value)
                .keyboardType(.numbersAndPunctuation)
                .multilineTextAlignment(.trailing)
        }
    }

    /// Метры из поля → целые миллиметры; пусто или мусор — `nil`.
    private static func mm(_ raw: String) -> Int? {
        guard let value = Double(raw.replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespaces)), value > 0 else {
            return nil
        }
        return Int((value * 1000).rounded())
    }

    private static func signedMM(_ raw: String) -> Int {
        Double(raw.replacingOccurrences(of: ",", with: ".").replacingOccurrences(of: "−", with: "-").trimmingCharacters(in: .whitespaces))
            .map { Int(($0 * 1000).rounded()) } ?? 0
    }

    private var count: Int? { Int(floors.trimmingCharacters(in: .whitespaces)) }
    private var first: Int? { Int(firstLevel.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "−", with: "-")) }

    private var valid: Bool {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, trimmed.count <= 100, code.trimmingCharacters(in: .whitespaces).count <= 10 else { return false }
        if building != nil { return true }
        guard Self.mm(width) != nil, Self.mm(depth) != nil, let h = Self.mm(height), (2000...20000).contains(h) else { return false }
        if shape != .rect, Self.mm(wing) == nil { return false }
        guard let count, (1...60).contains(count), let first, (-5...100).contains(first) else { return false }
        return true
    }

    private func save() async throws {
        let api = UAdminAPI()
        let trimmedCode = code.trimmingCharacters(in: .whitespaces)
        if let building {
            try await api.updateBuilding(id: building.id, name: name.trimmingCharacters(in: .whitespaces), code: trimmedCode)
            return
        }
        guard let w = Self.mm(width), let d = Self.mm(depth), let h = Self.mm(height), let count, let first else { return }
        let outline = shape.outline(width: w, depth: d, wing: Self.mm(wing) ?? 0)
        var body: [String: JSONValue] = [
            "name": .string(name.trimmingCharacters(in: .whitespaces)),
            "outline": .array(outline.map { .object(["x": .int($0.x), "y": .int($0.y)]) }),
            "transform": .object(["x": .int(Self.signedMM(positionX)), "y": .int(Self.signedMM(positionY)), "rotationDeg": 0]),
            "floors": .object(["count": .int(count), "firstLevel": .int(first), "heightMm": .int(h)]),
        ]
        if !trimmedCode.isEmpty { body["code"] = .string(trimmedCode) }
        try await api.createBuilding(campusID: campusID, body: body)
    }
}

private enum BuildingShape: String, CaseIterable, Identifiable {
    case rect, l, u, t

    var id: String { rawValue }

    var title: String {
        switch self {
        case .rect: return String(localized: "uadmin.campus.shape.rect", defaultValue: "Прямоугольник")
        case .l: return String(localized: "uadmin.campus.shape.l", defaultValue: "Г-образный")
        case .u: return String(localized: "uadmin.campus.shape.u", defaultValue: "П-образный")
        case .t: return String(localized: "uadmin.campus.shape.t", defaultValue: "Т-образный")
        }
    }

    /// Контур в мм — тот же шаблон, что `outlineFromShape` в `campus-core`.
    func outline(width w: Int, depth d: Int, wing: Int) -> [UAdminCampusPointDTO] {
        let k = min(wing, w / 2 - 1, d / 2 - 1)
        func p(_ x: Int, _ y: Int) -> UAdminCampusPointDTO { UAdminCampusPointDTO(x: x, y: y) }
        switch self {
        case .rect:
            return [p(0, 0), p(w, 0), p(w, d), p(0, d)]
        case .l:
            return [p(0, 0), p(w, 0), p(w, k), p(k, k), p(k, d), p(0, d)]
        case .u:
            return [p(0, 0), p(w, 0), p(w, d), p(w - k, d), p(w - k, k), p(k, k), p(k, d), p(0, d)]
        case .t:
            let left = Int((Double(w - k) / 2).rounded())
            return [p(0, d - k), p(left, d - k), p(left, 0), p(left + k, 0), p(left + k, d - k), p(w, d - k), p(w, d), p(0, d)]
        }
    }
}

// MARK: - Этаж

/// Новый этаж: пустой по контуру корпуса или копия существующего с перенумерацией
/// помещений («3» → «4» превратит «А305» в «А405»).
private struct AddFloorForm: View {
    let building: UAdminCampusBuildingDTO
    let saved: () async -> Void

    @State private var level = ""
    @State private var label = ""
    @State private var copyFrom = AddFloorForm.empty
    @State private var renumberFrom = ""
    @State private var renumberTo = ""
    @State private var prepared = false

    private static let empty = "__empty__"

    var body: some View {
        FormSheet(
            title: String(localized: "uadmin.campus.addFloor", defaultValue: "Добавить этаж"),
            canSave: valid,
            save: save,
            saved: saved
        ) {
            Section {
                LabeledContent(String(localized: "uadmin.campus.level", defaultValue: "Уровень")) {
                    TextField(String(localized: "uadmin.campus.level", defaultValue: "Уровень"), text: $level)
                        .keyboardType(.numbersAndPunctuation)
                        .multilineTextAlignment(.trailing)
                        .onChange(of: level) { _, value in renumberTo = value }
                }
                TextField(String(localized: "uadmin.campus.floorLabel", defaultValue: "Название этажа (необязательно)"), text: $label)
            } footer: {
                if !levelValid, !level.isEmpty {
                    Text(String(localized: "uadmin.campus.levelTaken", defaultValue: "Уровень занят или вне диапазона −5…100"))
                        .foregroundStyle(Palette.destructive)
                }
            }
            .listRowBackground(Palette.card)

            Section {
                Picker(String(localized: "uadmin.campus.copyFrom", defaultValue: "Основа"), selection: $copyFrom) {
                    Text(String(localized: "uadmin.campus.emptyFloor", defaultValue: "Пустой этаж по контуру корпуса")).tag(Self.empty)
                    ForEach(building.floors.sorted { $0.level > $1.level }) { floor in
                        Text(String(localized: "uadmin.campus.floorN", defaultValue: "\(floor.label) этаж")).tag(floor.id)
                    }
                }
                if copyFrom != Self.empty {
                    TextField(String(localized: "uadmin.campus.renumberFrom", defaultValue: "Номера: было"), text: $renumberFrom)
                    TextField(String(localized: "uadmin.campus.renumberTo", defaultValue: "Номера: стало"), text: $renumberTo)
                }
            } footer: {
                if copyFrom != Self.empty {
                    Text(String(localized: "uadmin.campus.renumberHint", defaultValue: "«3» → «4» превратит «А305» в «А405». Связь с помещениями вуза у копии сбрасывается."))
                }
            }
            .listRowBackground(Palette.card)
        }
        .onChange(of: copyFrom) { _, id in
            renumberFrom = building.floors.first(where: { $0.id == id }).map { String($0.level) } ?? ""
        }
        .onAppear {
            guard !prepared else { return }
            prepared = true
            let top = building.floors.map(\.level).max() ?? 0
            level = String(top + 1)
            renumberTo = level
            if let last = building.floors.max(by: { $0.level < $1.level }) {
                copyFrom = last.id
                renumberFrom = String(last.level)
            }
        }
    }

    private var levelValue: Int? { Int(level.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "−", with: "-")) }

    private var levelValid: Bool {
        guard let value = levelValue else { return false }
        return (-5...100).contains(value) && !building.floors.contains { $0.level == value }
    }

    private var valid: Bool { levelValid && label.count <= 40 }

    private func save() async throws {
        guard let levelValue else { return }
        var body: [String: JSONValue] = ["level": .int(levelValue)]
        let trimmed = label.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty { body["label"] = .string(trimmed) }
        if copyFrom != Self.empty {
            body["copyFromFloorId"] = .string(copyFrom)
            let from = renumberFrom.trimmingCharacters(in: .whitespaces)
            let to = renumberTo.trimmingCharacters(in: .whitespaces)
            if !from.isEmpty, !to.isEmpty, from.count <= 5, to.count <= 5 {
                body["renumber"] = .object(["from": .string(from), "to": .string(to)])
            }
        }
        try await UAdminAPI().createFloor(buildingID: building.id, body: body)
    }
}

/// Свойства этажа: название, тип, высота и отметка пола.
private struct FloorForm: View {
    let floor: UAdminCampusFloorDTO
    let saved: () async -> Void

    @State private var label = ""
    @State private var kind = "regular"
    @State private var height = ""
    @State private var elevation = ""
    @State private var prepared = false

    var body: some View {
        FormSheet(
            title: String(localized: "uadmin.campus.editFloor", defaultValue: "Свойства этажа"),
            canSave: valid,
            save: {
                var body: [String: JSONValue] = [
                    "label": .string(label.trimmingCharacters(in: .whitespaces)),
                    "kind": .string(kind),
                ]
                if let h = mm(height) { body["heightMm"] = .int(h) }
                if let e = mm(elevation) { body["elevationMm"] = .int(e) }
                try await UAdminAPI().updateFloor(id: floor.id, body: body)
            },
            saved: saved
        ) {
            Section {
                TextField(String(localized: "uadmin.campus.floorLabelShort", defaultValue: "Название этажа"), text: $label)
                Picker(String(localized: "uadmin.campus.floorKind", defaultValue: "Тип"), selection: $kind) {
                    ForEach(FloorKind.all, id: \.self) { Text(FloorKind.title($0)).tag($0) }
                }
                LabeledContent(String(localized: "uadmin.campus.floorHeight", defaultValue: "Высота этажа, м")) {
                    TextField("3.3", text: $height).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                }
                LabeledContent(String(localized: "uadmin.campus.elevation", defaultValue: "Отметка пола, м")) {
                    TextField("0", text: $elevation).keyboardType(.numbersAndPunctuation).multilineTextAlignment(.trailing)
                }
            }
            .listRowBackground(Palette.card)
        }
        .onAppear {
            guard !prepared else { return }
            prepared = true
            label = floor.label
            kind = floor.kind
            height = floor.heightMm.map { Self.meters($0) } ?? ""
            elevation = floor.elevationMm.map { Self.meters($0) } ?? ""
        }
    }

    private static func meters(_ mm: Int) -> String {
        (Double(mm) / 1000).formatted(.number.precision(.fractionLength(0...2)).grouping(.never).locale(Locale(identifier: "en_US_POSIX")))
    }

    private func mm(_ raw: String) -> Int? {
        let cleaned = raw.replacingOccurrences(of: ",", with: ".").replacingOccurrences(of: "−", with: "-").trimmingCharacters(in: .whitespaces)
        return Double(cleaned).map { Int(($0 * 1000).rounded()) }
    }

    private var valid: Bool {
        let trimmed = label.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, trimmed.count <= 40 else { return false }
        if !height.isEmpty { guard let h = mm(height), (2000...20000).contains(h) else { return false } }
        if !elevation.isEmpty { guard let e = mm(elevation), (-50000...500000).contains(e) else { return false } }
        return true
    }
}

// MARK: - Публикация

/// Публикация: заметка к версии и проверка всех этажей на сервере. Не прошло — список
/// проблем по этажам (исправляются в редакторе веб-версии).
private struct PublishSheet: View {
    let tree: UAdminCampusTreeDTO
    let published: (String) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var note = ""
    @State private var issues: [(floor: String?, text: String)]?
    @State private var failure: String?
    @State private var isPublishing = false

    var body: some View {
        NavigationStack {
            Form {
                if let failure {
                    FormAlert(message: failure)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                Section {
                    TextField(String(localized: "uadmin.campus.publishNote", defaultValue: "Что изменилось (необязательно)"), text: $note, axis: .vertical)
                        .lineLimit(2...5)
                } footer: {
                    Text(String(localized: "uadmin.campus.publishHint", defaultValue: "Все этажи проверяются перед публикацией. Студенты увидят новую версию сразу."))
                }
                .listRowBackground(Palette.card)
                if let issues {
                    Section {
                        ForEach(Array(issues.enumerated()), id: \.offset) { _, issue in
                            VStack(alignment: .leading, spacing: 2) {
                                if let floor = issue.floor {
                                    Text(floor).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                                }
                                Text(issue.text).foregroundStyle(Palette.foreground)
                            }
                        }
                    } header: {
                        Text(String(localized: "uadmin.campus.publishBlocked", defaultValue: "Публикация остановлена: проблем — \(issues.count.formatted())"))
                    } footer: {
                        Text(String(localized: "uadmin.campus.fixInEditor", defaultValue: "Исправьте план этажа в редакторе веб-версии и опубликуйте снова."))
                    }
                    .listRowBackground(Palette.card)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Palette.background)
            .navigationTitle(Text(String(localized: "uadmin.campus.publish", defaultValue: "Опубликовать")))
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(isPublishing)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "common.cancel", defaultValue: "Отмена")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isPublishing {
                        ProgressView()
                    } else {
                        Button(String(localized: "uadmin.campus.publish", defaultValue: "Опубликовать")) { Task { await publish() } }
                    }
                }
            }
        }
    }

    private var floorNames: [String: String] {
        var names: [String: String] = [:]
        for building in tree.buildings {
            for floor in building.floors {
                let floorTitle = String(localized: "uadmin.campus.floorN", defaultValue: "\(floor.label) этаж")
                names[floor.id] = "\(building.code ?? building.name) · \(floorTitle)"
            }
        }
        return names
    }

    @MainActor
    private func publish() async {
        isPublishing = true
        defer { isPublishing = false }
        var revisions: [String: Int] = [:]
        for building in tree.buildings {
            for floor in building.floors {
                if let plan = floor.plan { revisions[floor.id] = plan.revision }
            }
        }
        do {
            let version = try await UAdminAPI().publishCampus(id: tree.id, note: String(note.prefix(500)), floorRevisions: revisions)
            dismiss()
            await published(
                String(localized: "uadmin.campus.publishedToast", defaultValue: "Опубликована версия №\(String(version.number)): помещений — \(version.spaces.formatted())")
            )
        } catch {
            guard case .server(.validationError, _, let details, _) = error as? APIError, !details.isEmpty else {
                failure = error.userMessage
                return
            }
            let names = floorNames
            issues = details.map { detail in
                let floorID = detail.field.split(separator: ".").dropFirst().first.map(String.init)
                return (floor: floorID.flatMap { names[$0] }, text: Self.problem(detail.message))
            }
            failure = nil
        }
    }

    static func problem(_ code: String) -> String {
        switch code {
        case "BROKEN_REF": return String(localized: "uadmin.campus.problem.brokenRef", defaultValue: "Повреждённая ссылка в плане")
        case "DUPLICATE_NODE": return String(localized: "uadmin.campus.problem.duplicateNode", defaultValue: "Две точки в одном месте")
        case "ZERO_LENGTH_WALL": return String(localized: "uadmin.campus.problem.zeroWall", defaultValue: "Стена нулевой длины")
        case "DUPLICATE_WALL": return String(localized: "uadmin.campus.problem.duplicateWall", defaultValue: "Две стены друг на друге")
        case "NOT_PLANAR": return String(localized: "uadmin.campus.problem.notPlanar", defaultValue: "Стены пересекаются без соединения")
        case "SHORT_WALL": return String(localized: "uadmin.campus.problem.shortWall", defaultValue: "Очень короткая стена")
        case "DANGLING_WALL": return String(localized: "uadmin.campus.problem.danglingWall", defaultValue: "Стена ни к чему не примыкает")
        case "ISOLATED_NODE": return String(localized: "uadmin.campus.problem.isolatedNode", defaultValue: "Одинокая точка")
        case "OPENING_PARKED": return String(localized: "uadmin.campus.problem.openingParked", defaultValue: "Дверь или окно без стены")
        case "OPENING_OUT_OF_WALL": return String(localized: "uadmin.campus.problem.openingOut", defaultValue: "Проём выходит за стену")
        case "OPENINGS_OVERLAP": return String(localized: "uadmin.campus.problem.openingsOverlap", defaultValue: "Проёмы накладываются")
        case "OPENING_TOO_HIGH": return String(localized: "uadmin.campus.problem.openingHigh", defaultValue: "Проём выше стены")
        case "SPACE_LOST": return String(localized: "uadmin.campus.problem.spaceLost", defaultValue: "Помещение потеряло свои стены")
        case "SPACE_LABEL_OUTSIDE": return String(localized: "uadmin.campus.problem.labelOutside", defaultValue: "Подпись помещения снаружи")
        case "SPACE_TOO_SMALL": return String(localized: "uadmin.campus.problem.spaceSmall", defaultValue: "Слишком маленькое помещение")
        case "ROOM_REQUIRED": return String(localized: "uadmin.campus.problem.roomRequired", defaultValue: "Учебное помещение не связано с аудиторией вуза")
        case "DUPLICATE_ROOM": return String(localized: "uadmin.campus.problem.duplicateRoom", defaultValue: "Одна аудитория вуза у двух помещений")
        case "ROOM_NOT_FOUND": return String(localized: "uadmin.campus.problem.roomNotFound", defaultValue: "Аудитория вуза не найдена")
        case "VERTICAL_DEGENERATE": return String(localized: "uadmin.campus.problem.vertical", defaultValue: "Лестница или лифт без площади")
        case "EMPTY": return String(localized: "uadmin.campus.problem.empty", defaultValue: "В кампусе нет корпусов")
        default: return code
        }
    }
}
