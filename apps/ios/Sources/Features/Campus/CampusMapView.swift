import SwiftUI

/// Карта кампуса: корпус, этаж, поиск аудитории, план с масштабом и сведениями о
/// помещении. Маршрута нет: граф навигации сервер отдаёт, а поиск пути веб считает
/// у себя — на телефоне это отдельная задача.
struct CampusMapView: View {
    /// Аудитория из расписания — карта откроется на её этаже с выделением.
    var focusRoomID: String?

    @State private var model = CampusMapModel()
    @State private var query = ""

    var body: some View {
        VStack(spacing: 0) {
            if !query.isEmpty {
                searchResults
            } else {
                controls
                map
            }
        }
        .background(Palette.background)
        .navigationTitle(Text(model.published?.campus.name ?? MoreSection.campusMap.title))
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: Text(String(localized: "campus.search", defaultValue: "Аудитория или помещение")))
        .onChange(of: query) { _, text in model.search(text) }
        .toolbar {
            if let campuses = model.campuses, campuses.count > 1 {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        ForEach(campuses) { campus in
                            Button(campus.name) { Task { await model.select(campusID: campus.id) } }
                        }
                    } label: {
                        Image(systemName: "building.2")
                    }
                    .accessibilityLabel(Text(String(localized: "campus.choose", defaultValue: "Выбрать кампус")))
                }
            }
        }
        .task { await model.start(focusRoomID: focusRoomID) }
    }

    // MARK: Корпус и этаж

    @ViewBuilder
    private var controls: some View {
        if let published = model.published {
            VStack(alignment: .leading, spacing: Spacing.md) {
                if published.manifest.buildings.count > 1 {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: Spacing.md) {
                            ForEach(published.manifest.buildings) { building in
                                Chip(title: building.name, isSelected: building.id == model.buildingID) {
                                    Task { await model.select(buildingID: building.id) }
                                }
                            }
                        }
                        .padding(.horizontal, Spacing.xl)
                    }
                }
                if !model.floors.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: Spacing.sm) {
                            Text(String(localized: "campus.floor", defaultValue: "Этаж"))
                                .font(Typography.meta)
                                .foregroundStyle(Palette.mutedForeground)
                            ForEach(model.floors) { floor in
                                Chip(title: floor.title, isSelected: floor.id == model.floorID, compact: true) {
                                    Task { await model.select(floorID: floor.id) }
                                }
                                .accessibilityLabel(Text(String(localized: "campus.floorNamed", defaultValue: "Этаж \(floor.title)")))
                            }
                        }
                        .padding(.horizontal, Spacing.xl)
                    }
                }
            }
            .padding(.vertical, Spacing.md)
        }
    }

    // MARK: План

    @ViewBuilder
    private var map: some View {
        ZStack(alignment: .bottom) {
            if let geometry = model.geometry {
                FloorPlanCanvas(
                    geometry: geometry,
                    selectedRoomID: model.selectedRoomID,
                    select: { model.selectRoom($0) }
                )
                .id(model.floorID)
            } else if let failure = model.failure {
                ErrorStateView(message: failure) {
                    if let floor = model.floorID { await model.select(floorID: floor) } else { await model.loadCampuses() }
                }
            } else if model.campuses?.isEmpty == true {
                EmptyStateView(
                    title: String(localized: "campus.empty", defaultValue: "Карты кампуса пока нет"),
                    symbol: "map",
                    hint: String(localized: "campus.empty.hint", defaultValue: "Вуз ещё не опубликовал карту")
                )
            } else {
                LoadingStateView()
            }

            if let notice = model.notice {
                StaleDataBanner(message: notice)
                    .padding(Spacing.xl)
                    .onTapGesture { model.dismissNotice() }
            } else if let room = model.selectedRoom {
                RoomCard(room: room, floor: model.floors.first { $0.id == model.floorID }, building: model.building) {
                    model.selectRoom(nil)
                }
                .padding(Spacing.xl)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .frame(maxHeight: .infinity)
        .animation(.snappy, value: model.selectedRoomID)
    }

    // MARK: Поиск

    private var searchResults: some View {
        List {
            if model.isSearching, model.results.isEmpty {
                ProgressView().frame(maxWidth: .infinity).listRowBackground(Color.clear)
            } else if model.results.isEmpty {
                EmptyStateView(title: String(localized: "services.notFound", defaultValue: "Ничего не нашлось"), symbol: "magnifyingglass")
                    .listRowBackground(Color.clear)
            }
            ForEach(model.results) { hit in
                Button {
                    Task {
                        await model.open(hit)
                        query = ""
                    }
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(hit.title.isEmpty ? CampusText.kind(hit.kind) : hit.title)
                            .font(Typography.body)
                            .foregroundStyle(Palette.foreground)
                        Text([hit.building?.name, hit.floor.map { String(localized: "campus.floorNamed", defaultValue: "Этаж \($0.label ?? String($0.level ?? 0))") }]
                            .compactMap { $0 }.joined(separator: " · "))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }
}

private struct Chip: View {
    let title: String
    let isSelected: Bool
    var compact = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(Typography.meta.weight(.semibold))
                .lineLimit(1)
                .padding(.horizontal, compact ? Spacing.lg : Spacing.xl)
                .frame(minWidth: compact ? ControlHeight.md : nil, minHeight: ControlHeight.md)
                .foregroundStyle(isSelected ? Palette.primaryForeground : Palette.foreground)
                .background(isSelected ? Palette.primary : Palette.muted, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// Сведения о помещении над картой.
private struct RoomCard: View {
    let room: FloorGeometry.Room
    let floor: CampusPublishedDTO.Floor?
    let building: CampusPublishedDTO.Building?
    let close: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.lg) {
            IconTile(symbol: CampusText.symbol(room.space.kind), tint: TileTint.green, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(room.space.title.isEmpty ? CampusText.kind(room.space.kind) : room.space.title)
                    .font(Typography.cardTitle)
                    .foregroundStyle(Palette.foreground)
                Text([
                    CampusText.kind(room.space.kind),
                    building?.name,
                    floor.map { String(localized: "campus.floorNamed", defaultValue: "Этаж \($0.title)") },
                ].compactMap { $0 }.joined(separator: " · "))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
                if let capacity = room.space.capacity, capacity > 0 {
                    Label(String(localized: "campus.capacity", defaultValue: "Мест: \(capacity)"), systemImage: "person.2")
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
            }
            Spacer(minLength: 0)
            Button(action: close) {
                Image(systemName: "xmark.circle.fill")
                    .font(.title3)
                    .foregroundStyle(Palette.mutedForeground)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(String(localized: "common.close", defaultValue: "Закрыть")))
        }
        .padding(Spacing.lg)
        .floatingGlass(in: RoundedRectangle(cornerRadius: Radius.xxl, style: .continuous))
        .accessibilityElement(children: .contain)
    }
}

enum CampusText {
    static func kind(_ raw: String?) -> String {
        switch raw {
        case "auditorium": return String(localized: "campus.kind.auditorium", defaultValue: "Аудитория")
        case "lecture_hall": return String(localized: "campus.kind.lectureHall", defaultValue: "Лекционный зал")
        case "lab": return String(localized: "campus.kind.lab", defaultValue: "Лаборатория")
        case "computer_lab": return String(localized: "campus.kind.computerLab", defaultValue: "Компьютерный класс")
        case "sport_hall": return String(localized: "campus.kind.sportHall", defaultValue: "Спортзал")
        case "office": return String(localized: "campus.kind.office", defaultValue: "Кабинет")
        case "dean_office": return String(localized: "campus.kind.deanOffice", defaultValue: "Деканат")
        case "library": return String(localized: "library.title", defaultValue: "Библиотека")
        case "canteen": return String(localized: "campus.kind.canteen", defaultValue: "Столовая")
        case "restroom": return String(localized: "campus.kind.restroom", defaultValue: "Туалет")
        case "hall": return String(localized: "campus.kind.hall", defaultValue: "Холл")
        case "corridor": return String(localized: "campus.kind.corridor", defaultValue: "Коридор")
        case "stairwell": return String(localized: "campus.kind.stairwell", defaultValue: "Лестница")
        case "elevator_hall": return String(localized: "campus.kind.elevatorHall", defaultValue: "Лифтовый холл")
        default: return String(localized: "campus.kind.other", defaultValue: "Помещение")
        }
    }

    static func symbol(_ raw: String?) -> String {
        switch raw {
        case "auditorium", "lecture_hall": return "person.3.sequence"
        case "lab": return "flask"
        case "computer_lab": return "desktopcomputer"
        case "sport_hall": return "figure.run"
        case "office", "dean_office": return "door.left.hand.closed"
        case "library": return "books.vertical"
        case "canteen": return "fork.knife"
        case "restroom": return "toilet"
        case "stairwell": return "stairs"
        case "elevator_hall": return "arrow.up.arrow.down"
        default: return "square.dashed"
        }
    }
}
