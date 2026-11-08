import SwiftUI
import UIKit

// Помещения вуза и QR-наклейки на дверь (Ф16). Как в вебе: список с сортировкой по всей
// выборке, создание и правка, удаление с причиной отказа, печать наклейки одного помещения
// и пачкой по корпусу/этажу, перевыпуск кода. Печать — системная (AirPrint) или «Поделиться».

struct UAdminRoomsView: View {
    @State private var loader: PagedLoader<UAdminRoomDTO>?
    @State private var query = ""
    @State private var sort: RoomSort = .name
    @State private var ascending = true
    @State private var creating = false
    @State private var editing: UAdminRoomDTO?
    @State private var deleting: UAdminRoomDTO?
    @State private var rotating: UAdminRoomDTO?
    @State private var batch = false
    @State private var sheet: QrSheet?
    @State private var busy = false
    @State private var actionFailure: String?

    var body: some View {
        Group {
            if let loader {
                PagedList(
                    loader: loader,
                    empty: EmptyStateView(
                        title: query.isEmpty
                            ? String(localized: "uadmin.room.empty", defaultValue: "Помещений пока нет")
                            : String(localized: "uadmin.picker.nothing", defaultValue: "Ничего не найдено"),
                        symbol: "door.left.hand.open",
                        hint: query.isEmpty
                            ? String(localized: "uadmin.room.emptyHint", defaultValue: "Добавьте аудитории и другие помещения, чтобы печатать для них QR.")
                            : nil,
                        actionTitle: query.isEmpty ? String(localized: "uadmin.room.add", defaultValue: "Добавить помещение") : nil,
                        action: query.isEmpty ? { creating = true } : nil
                    )
                ) { room in
                    Button {
                        editing = room
                    } label: {
                        RoomRow(room: room)
                    }
                    .buttonStyle(.plain)
                    .swipeActions {
                        Button(role: .destructive) {
                            deleting = room
                        } label: {
                            Label(String(localized: "uadmin.delete", defaultValue: "Удалить"), systemImage: "trash")
                        }
                        Button {
                            Task { await print([room]) }
                        } label: {
                            Label(String(localized: "uadmin.room.print", defaultValue: "Наклейка"), systemImage: "qrcode")
                        }
                        .tint(Palette.primary)
                    }
                    .contextMenu { menu(for: room) }
                }
            } else {
                LoadingStateView()
            }
        }
        .background(Palette.background)
        .navigationTitle(Text(UniAdminScreen.rooms.title))
        .debouncedSearch($query, prompt: String(localized: "uadmin.searchByName", defaultValue: "Поиск по названию")) { _ in
            await reload()
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker(String(localized: "uadmin.sort", defaultValue: "Сортировка"), selection: $sort) {
                        ForEach(RoomSort.allCases) { Text($0.title).tag($0) }
                    }
                    Toggle(String(localized: "uadmin.sort.ascending", defaultValue: "По возрастанию"), isOn: $ascending)
                    Divider()
                    Button {
                        batch = true
                    } label: {
                        Label(String(localized: "uadmin.room.printBatch", defaultValue: "Наклейки на корпус или этаж"), systemImage: "printer")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel(Text(String(localized: "uadmin.actions", defaultValue: "Действия")))
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    creating = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel(Text(String(localized: "uadmin.room.add", defaultValue: "Добавить помещение")))
            }
        }
        .overlay {
            if busy {
                ProgressView()
                    .padding(Spacing.xl)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: Radius.xl))
            }
        }
        .sheet(isPresented: $creating) {
            RoomForm(room: nil) { await loader?.reload() }
        }
        .sheet(item: $editing) { room in
            RoomForm(room: room) { await loader?.reload() }
        }
        .sheet(isPresented: $batch) {
            BatchPrintSheet { items in
                await loader?.reload()
                // Лист наклеек — после того как закроется лист выбора: два разом SwiftUI не покажет.
                try? await Task.sleep(for: .milliseconds(600))
                sheet = QrSheet(items: items)
            }
        }
        .sheet(item: $sheet) { sheet in
            QrStickerSheet(items: sheet.items)
        }
        .confirmDestructive(
            $deleting,
            title: { String(localized: "uadmin.room.deleteConfirm", defaultValue: "Удалить помещение «\($0.name)»? Напечатанный QR перестанет работать.") },
            actionTitle: String(localized: "uadmin.delete", defaultValue: "Удалить")
        ) { room in
            await remove(room)
        }
        .confirmDestructive(
            $rotating,
            title: { String(localized: "uadmin.room.rotateConfirm", defaultValue: "Перевыпустить код? Старая наклейка на «\($0.name)» перестанет работать.") },
            actionTitle: String(localized: "uadmin.room.rotateAction", defaultValue: "Перевыпустить")
        ) { room in
            await rotate(room)
        }
        .actionFailureAlert($actionFailure)
        .onChange(of: sort) { _, _ in Task { await reload() } }
        .onChange(of: ascending) { _, _ in Task { await reload() } }
        .task { if loader == nil { loader = PagedLoader(limit: 50, fetch: fetcher()) } }
    }

    @ViewBuilder
    private func menu(for room: UAdminRoomDTO) -> some View {
        Button {
            editing = room
        } label: {
            Label(String(localized: "uadmin.edit", defaultValue: "Изменить"), systemImage: "pencil")
        }
        Button {
            Task { await print([room]) }
        } label: {
            Label(String(localized: "uadmin.room.print", defaultValue: "Наклейка"), systemImage: "qrcode")
        }
        if room.qrCode != nil {
            Button {
                rotating = room
            } label: {
                Label(String(localized: "uadmin.room.rotate", defaultValue: "Перевыпустить код"), systemImage: "arrow.triangle.2.circlepath")
            }
        }
        NavigationLink(value: AppRoute.campusRoom(roomID: room.id)) {
            Label(String(localized: "uadmin.room.onMap", defaultValue: "Показать на карте"), systemImage: "map")
        }
        Button(role: .destructive) {
            deleting = room
        } label: {
            Label(String(localized: "uadmin.delete", defaultValue: "Удалить"), systemImage: "trash")
        }
    }

    private func fetcher() -> (PageRequest) async throws -> Page<UAdminRoomDTO> {
        let search = query.trimmingCharacters(in: .whitespaces)
        let key = sort.rawValue
        let order = ascending ? "asc" : "desc"
        return { request in
            try await UAdminAPI().rooms(request, sort: key, order: order, search: search.isEmpty ? nil : String(search.prefix(100)))
        }
    }

    @MainActor
    private func reload() async {
        guard let loader else { return }
        await loader.replace(fetch: fetcher())
    }

    @MainActor
    private func remove(_ room: UAdminRoomDTO) async {
        do {
            try await UAdminAPI().deleteRoom(id: room.id)
            loader?.remove(id: room.id)
        } catch {
            actionFailure = UAdminFailure.blocked(
                error,
                title: String(localized: "uadmin.room.deleteBlocked", defaultValue: "Помещение нельзя удалить — оно ещё используется"),
                labels: [
                    "pairs": String(localized: "uadmin.room.blocker.pairs", defaultValue: "пары в расписании"),
                    "exams": String(localized: "uadmin.room.blocker.exams", defaultValue: "предстоящие экзамены"),
                    "changes": String(localized: "uadmin.room.blocker.changes", defaultValue: "замены в расписании"),
                ]
            )
        }
    }

    @MainActor
    private func print(_ rooms: [UAdminRoomDTO]) async {
        busy = true
        defer { busy = false }
        do {
            let items = try await UAdminAPI().issueQr(roomIDs: rooms.map(\.id))
            sheet = QrSheet(items: items)
            await loader?.reload()
        } catch {
            actionFailure = error.userMessage
        }
    }

    @MainActor
    private func rotate(_ room: UAdminRoomDTO) async {
        busy = true
        defer { busy = false }
        do {
            let item = try await UAdminAPI().rotateQr(roomID: room.id)
            sheet = QrSheet(items: [item])
            await loader?.reload()
        } catch {
            actionFailure = error.userMessage
        }
    }
}

private enum RoomSort: String, CaseIterable, Identifiable {
    case name, kind, building, floor, capacity, qr

    var id: String { rawValue }

    var title: String {
        switch self {
        case .name: return String(localized: "uadmin.room.sort.name", defaultValue: "Название")
        case .kind: return String(localized: "uadmin.room.sort.kind", defaultValue: "Назначение")
        case .building: return String(localized: "uadmin.room.sort.building", defaultValue: "Корпус")
        case .floor: return String(localized: "uadmin.room.sort.floor", defaultValue: "Этаж")
        case .capacity: return String(localized: "uadmin.room.sort.capacity", defaultValue: "Вместимость")
        case .qr: return String(localized: "uadmin.room.sort.qr", defaultValue: "Наличие QR")
        }
    }
}

enum UAdminRoomCode {
    /// Код печатается группами по четыре — так его легче переписать с наклейки.
    static func format(_ code: String) -> String {
        code.count == 8 ? "\(code.prefix(4))-\(code.suffix(4))" : code
    }
}

private struct RoomRow: View {
    let room: UAdminRoomDTO

    var body: some View {
        ListCardRow(
            title: room.name,
            subtitle: UAdminText.roomKind(room.kind),
            status: room.qrCode.map { (UAdminRoomCode.format($0), Palette.info) }
                ?? (String(localized: "uadmin.room.noQr", defaultValue: "QR не выдан"), Palette.mutedForeground),
            lines: [details]
        )
    }

    private var details: String {
        var parts: [String] = []
        if let building = room.building, !building.isEmpty {
            parts.append(String(localized: "uadmin.room.buildingValue", defaultValue: "Корпус \(building)"))
        }
        if let floor = room.floor {
            parts.append(String(localized: "uadmin.room.floorValue", defaultValue: "\(String(floor)) этаж"))
        }
        if let capacity = room.capacity {
            parts.append(String(localized: "uadmin.room.capacityValue", defaultValue: "\(String(capacity)) мест"))
        }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Форма помещения

private struct RoomForm: View {
    let room: UAdminRoomDTO?
    let saved: () async -> Void

    @State private var name = ""
    @State private var kind = "AUDITORIUM"
    @State private var building = ""
    @State private var floor = ""
    @State private var capacity = ""
    @State private var openHours = ""
    @State private var phone = ""
    @State private var info = ""
    @State private var prepared = false

    var body: some View {
        FormSheet(
            title: room == nil
                ? String(localized: "uadmin.room.add", defaultValue: "Добавить помещение")
                : String(localized: "uadmin.room.edit", defaultValue: "Изменить помещение"),
            canSave: canSave,
            save: save,
            saved: saved
        ) {
            Section {
                TextField(String(localized: "uadmin.room.name", defaultValue: "Название или номер, например 305"), text: $name)
                Picker(String(localized: "uadmin.room.kind", defaultValue: "Назначение"), selection: $kind) {
                    ForEach(UAdminText.roomKinds, id: \.self) { Text(UAdminText.roomKind($0)).tag($0) }
                }
            }
            .listRowBackground(Palette.card)

            Section(String(localized: "uadmin.room.place", defaultValue: "Где находится")) {
                TextField(String(localized: "uadmin.room.building", defaultValue: "Корпус"), text: $building)
                TextField(String(localized: "uadmin.room.floor", defaultValue: "Этаж"), text: $floor)
                    .keyboardType(.numbersAndPunctuation)
                if academic {
                    TextField(String(localized: "uadmin.room.capacity", defaultValue: "Вместимость"), text: $capacity)
                        .keyboardType(.numberPad)
                }
            }
            .listRowBackground(Palette.card)

            if !academic {
                Section(String(localized: "uadmin.room.service", defaultValue: "Для посетителей")) {
                    TextField(String(localized: "uadmin.room.openHours", defaultValue: "Часы работы, например Пн–Пт 09:00–18:00"), text: $openHours)
                    TextField(String(localized: "uadmin.room.phone", defaultValue: "Телефон"), text: $phone)
                        .keyboardType(.phonePad)
                }
                .listRowBackground(Palette.card)
            }

            Section {
                TextField(String(localized: "uadmin.room.info", defaultValue: "Примечание, например «Приём заявлений — окно 2»"), text: $info, axis: .vertical)
                    .lineLimit(2...5)
            } footer: {
                if !numbersValid {
                    Text(String(localized: "uadmin.room.numbersInvalid", defaultValue: "Этаж — от −5 до 100, вместимость — от 1 до 10 000"))
                        .foregroundStyle(Palette.destructive)
                }
            }
            .listRowBackground(Palette.card)
        }
        .onAppear(perform: prepare)
    }

    private var academic: Bool { UAdminText.isAcademic(kind) }
    private var floorValue: Int? { Int(floor.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "−", with: "-")) }
    private var capacityValue: Int? { Int(capacity.trimmingCharacters(in: .whitespaces)) }

    private var numbersValid: Bool {
        let floorRaw = floor.trimmingCharacters(in: .whitespaces)
        if !floorRaw.isEmpty {
            guard let value = floorValue, (-5...100).contains(value) else { return false }
        }
        let capacityRaw = capacity.trimmingCharacters(in: .whitespaces)
        if academic, !capacityRaw.isEmpty {
            guard let value = capacityValue, (1...10000).contains(value) else { return false }
        }
        return true
    }

    private var canSave: Bool {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        return !trimmed.isEmpty && trimmed.count <= 100 && numbersValid
    }

    private func prepare() {
        guard !prepared else { return }
        prepared = true
        guard let room else { return }
        name = room.name
        kind = room.kind
        building = room.building ?? ""
        floor = room.floor.map { String($0) } ?? ""
        capacity = room.capacity.map { String($0) } ?? ""
        openHours = room.openHours ?? ""
        phone = room.phone ?? ""
        info = room.info ?? ""
    }

    private func save() async throws {
        // Учебному помещению не нужны часы работы, служебному — вместимость: лишнее стираем,
        // чтобы на наклейке не осталось устаревшего.
        let body: [String: JSONValue] = [
            "name": .string(name.trimmingCharacters(in: .whitespaces)),
            "kind": .string(kind),
            "building": .text(String(building.prefix(100))),
            "floor": .int(floorValue),
            "capacity": academic ? .int(capacityValue) : .null,
            "openHours": academic ? .null : .text(String(openHours.prefix(200))),
            "phone": academic ? .null : .text(String(phone.prefix(30))),
            "info": .text(String(info.prefix(500))),
        ]
        try await UAdminAPI().saveRoom(id: room?.id, body: body)
    }
}

// MARK: - Наклейки

private struct QrSheet: Identifiable {
    let id = UUID()
    let items: [UAdminRoomQrDTO]
}

/// Готовые наклейки: картинка QR, номер, код запасным путём. Печать — AirPrint, по
/// картинке на страницу; «Поделиться» — сохранить в «Фото» или «Файлы».
private struct QrStickerSheet: View {
    let items: [UAdminRoomQrDTO]

    @Environment(\.dismiss) private var dismiss
    @State private var sharing = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(items) { item in
                        VStack(spacing: Spacing.md) {
                            if let image = Self.image(item.qr) {
                                Image(uiImage: image)
                                    .interpolation(.none)
                                    .resizable()
                                    .scaledToFit()
                                    .frame(maxWidth: 220)
                                    .accessibilityLabel(Text(String(localized: "uadmin.room.qrAlt", defaultValue: "QR-код помещения \(item.name)")))
                            }
                            Text(item.name).font(.title2.weight(.semibold))
                            Text(UAdminRoomCode.format(item.code))
                                .font(.headline.monospaced())
                                .foregroundStyle(Palette.mutedForeground)
                                .textSelection(.enabled)
                            let place = [UAdminText.roomKind(item.kind), item.building, item.floor.map { String(localized: "uadmin.room.floorValue", defaultValue: "\(String($0)) этаж") }]
                                .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
                            if !place.isEmpty {
                                Text(place).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, Spacing.md)
                    }
                } footer: {
                    Text(String(localized: "uadmin.room.qrFooter", defaultValue: "Код под QR — запасной путь, если камера не читает наклейку. У помещений с наклейкой код не меняется."))
                }
                .listRowBackground(Palette.card)
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Palette.background)
            .navigationTitle(Text(String(localized: "uadmin.room.stickers", defaultValue: "Наклейки")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "uadmin.done", defaultValue: "Готово")) { dismiss() }
                }
                ToolbarItemGroup(placement: .bottomBar) {
                    Button {
                        printStickers()
                    } label: {
                        Label(String(localized: "uadmin.print", defaultValue: "Печать"), systemImage: "printer")
                    }
                    Spacer()
                    Button {
                        sharing = true
                    } label: {
                        Label(String(localized: "uadmin.share", defaultValue: "Поделиться"), systemImage: "square.and.arrow.up")
                    }
                }
            }
            .sheet(isPresented: $sharing) {
                UAdminActivitySheet(items: stickers)
            }
        }
    }

    /// Наклейка целиком — QR и номер крупно, как печатает веб.
    @MainActor
    private var stickers: [UIImage] {
        items.compactMap { item in
            guard let qr = Self.image(item.qr) else { return nil }
            let renderer = ImageRenderer(content: StickerPrint(item: item, qr: qr))
            renderer.scale = 3
            return renderer.uiImage
        }
    }

    @MainActor
    private func printStickers() {
        let controller = UIPrintInteractionController.shared
        let info = UIPrintInfo(dictionary: nil)
        info.outputType = .general
        info.jobName = String(localized: "uadmin.room.stickers", defaultValue: "Наклейки")
        controller.printInfo = info
        controller.printingItems = stickers
        controller.present(animated: true)
    }

    static func image(_ dataURL: String) -> UIImage? {
        guard let comma = dataURL.firstIndex(of: ",") else { return nil }
        let base64 = String(dataURL[dataURL.index(after: comma)...])
        guard let data = Data(base64Encoded: base64) else { return nil }
        return UIImage(data: data)
    }
}

private struct StickerPrint: View {
    let item: UAdminRoomQrDTO
    let qr: UIImage

    var body: some View {
        VStack(spacing: 16) {
            if let university = item.university {
                Text(university).font(.system(size: 18, weight: .medium)).foregroundStyle(.black)
            }
            Image(uiImage: qr).interpolation(.none).resizable().scaledToFit().frame(width: 320, height: 320)
            Text(item.name).font(.system(size: 54, weight: .bold)).foregroundStyle(.black)
            Text(UAdminRoomCode.format(item.code)).font(.system(size: 22, weight: .medium).monospaced()).foregroundStyle(.black)
        }
        .padding(32)
        .frame(width: 480)
        .background(Color.white)
    }
}

/// Печать пачкой: корпус и этаж из списка всех помещений вуза.
private struct BatchPrintSheet: View {
    let issued: ([UAdminRoomQrDTO]) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var rooms: [UAdminRoomDTO]?
    @State private var failure: String?
    @State private var building: String = BatchPrintSheet.allBuildings
    @State private var floor: Int?
    @State private var isIssuing = false

    private static let allBuildings = "__all__"
    private static let noBuilding = "__none__"

    var body: some View {
        NavigationStack {
            Form {
                if let failure {
                    FormAlert(message: failure)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                if let rooms {
                    Section {
                        Picker(String(localized: "uadmin.room.building", defaultValue: "Корпус"), selection: $building) {
                            Text(String(localized: "uadmin.room.allBuildings", defaultValue: "Все корпуса")).tag(Self.allBuildings)
                            ForEach(buildings(rooms), id: \.self) { value in
                                Text(value == Self.noBuilding ? String(localized: "uadmin.room.noBuilding", defaultValue: "Без корпуса") : value).tag(value)
                            }
                        }
                        Picker(String(localized: "uadmin.room.floor", defaultValue: "Этаж"), selection: $floor) {
                            Text(String(localized: "uadmin.room.allFloors", defaultValue: "Все этажи")).tag(Int?.none)
                            ForEach(floors(rooms), id: \.self) { value in
                                Text(String(localized: "uadmin.room.floorValue", defaultValue: "\(String(value)) этаж")).tag(Int?.some(value))
                            }
                        }
                    } footer: {
                        Text(String(localized: "uadmin.room.batchHint", defaultValue: "Помещениям без наклейки выдадим код. У кого наклейка уже есть, код не меняется — висящие наклейки продолжат работать."))
                    }
                    .listRowBackground(Palette.card)
                    Section {
                        Text(String(localized: "uadmin.room.batchCount", defaultValue: "Помещений: \(picked(rooms).count.formatted())"))
                    }
                    .listRowBackground(Palette.card)
                } else {
                    LoadingStateView().listRowBackground(Color.clear)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Palette.background)
            .navigationTitle(Text(String(localized: "uadmin.room.printBatch", defaultValue: "Наклейки на корпус или этаж")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "common.cancel", defaultValue: "Отмена")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isIssuing {
                        ProgressView()
                    } else {
                        Button(String(localized: "uadmin.room.issue", defaultValue: "Выдать")) { Task { await issue() } }
                            .disabled(rooms.map { picked($0).isEmpty } ?? true)
                    }
                }
            }
            .onChange(of: building) { _, _ in floor = nil }
            .task { await load() }
        }
    }

    private func key(_ room: UAdminRoomDTO) -> String {
        let value = room.building?.trimmingCharacters(in: .whitespaces) ?? ""
        return value.isEmpty ? Self.noBuilding : value
    }

    private func buildings(_ rooms: [UAdminRoomDTO]) -> [String] {
        Array(Set(rooms.map(key))).sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }

    private func inBuilding(_ rooms: [UAdminRoomDTO]) -> [UAdminRoomDTO] {
        building == Self.allBuildings ? rooms : rooms.filter { key($0) == building }
    }

    private func floors(_ rooms: [UAdminRoomDTO]) -> [Int] {
        Array(Set(inBuilding(rooms).compactMap(\.floor))).sorted()
    }

    private func picked(_ rooms: [UAdminRoomDTO]) -> [UAdminRoomDTO] {
        let scoped = inBuilding(rooms)
        guard let floor else { return scoped }
        return scoped.filter { $0.floor == floor }
    }

    @MainActor
    private func load() async {
        do {
            rooms = try await UAdminAPI().allRooms()
        } catch {
            failure = error.userMessage
        }
    }

    @MainActor
    private func issue() async {
        guard let rooms else { return }
        isIssuing = true
        defer { isIssuing = false }
        do {
            let items = try await UAdminAPI().issueQr(roomIDs: picked(rooms).map(\.id))
            dismiss()
            await issued(items)
        } catch {
            failure = error.userMessage
        }
    }
}
