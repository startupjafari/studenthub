import SwiftUI

/// Карта кампуса: корпус, этаж, поиск аудитории, план с масштабом и сведениями о
/// помещении. Маршрута нет: граф навигации сервер отдаёт, а поиск пути веб считает
/// у себя — на телефоне это отдельная задача.
struct CampusMapView: View {
    /// Аудитория из расписания — карта откроется на её этаже с выделением.
    var focusRoomID: String?

    @State private var model = CampusMapModel()
    @State private var query = ""
    @Environment(\.motionReduced) private var reduceMotion

    var body: some View {
        Group {
            if !query.isEmpty {
                searchResults
            } else {
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
                        Picker(selection: Binding(
                            get: { model.published?.campus.id },
                            set: { id in if let id { Task { await model.select(campusID: id) } } }
                        )) {
                            ForEach(campuses) { campus in
                                Text(campus.name).tag(Optional(campus.id))
                            }
                        } label: {
                            Text(String(localized: "campus.choose", defaultValue: "Выбрать кампус"))
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

    // MARK: План

    /// План во весь экран, поверх — стеклянные элементы управления, как в «Картах»:
    /// корпуса капсулами сверху, этажи — столбиком справа, как кнопки лифта, сведения о
    /// помещении — карточкой снизу.
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
                ErrorStateView(message: failure, isOffline: model.isOffline) {
                    if let floor = model.floorID { await model.select(floorID: floor) } else { await model.loadCampuses() }
                }
            } else if model.campuses?.isEmpty == true {
                EmptyStateView(
                    title: String(localized: "campus.empty", defaultValue: "Карты кампуса пока нет"),
                    symbol: "map",
                    hint: String(localized: "campus.empty.hint", defaultValue: "Вуз ещё не опубликовал карту")
                )
            } else if model.hasNothingToDraw {
                EmptyStateView(
                    title: String(localized: "campus.noPlan", defaultValue: "План корпуса ещё не готов"),
                    symbol: "building.2",
                    hint: String(localized: "campus.noPlan.hint", defaultValue: "Вуз ещё не добавил на карту корпуса и этажи")
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
        .overlay(alignment: .top) { controls }
        .frame(maxHeight: .infinity)
        .animation(Motion.respecting(Motion.snappy, reduceMotion: reduceMotion), value: model.selectedRoomID)
    }

    // MARK: Корпус и этаж

    @ViewBuilder
    private var controls: some View {
        if let published = model.published {
            VStack(alignment: .trailing, spacing: Spacing.md) {
                if published.manifest.buildings.count > 1 {
                    FilterChips(
                        options: published.manifest.buildings.map { (value: Optional($0.id), title: $0.name) },
                        selection: Binding(
                            get: { model.buildingID },
                            set: { id in if let id { Task { await model.select(buildingID: id) } } }
                        )
                    )
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                if model.floors.count > 1 {
                    FloorPicker(floors: model.floors, selection: model.floorID) { id in
                        Task { await model.select(floorID: id) }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.horizontal, Spacing.xl)
            .padding(.top, Spacing.md)
        }
    }

    // MARK: Поиск

    private var searchResults: some View {
        List {
            ForEach(model.results) { hit in
                Button {
                    Task {
                        await model.open(hit)
                        query = ""
                    }
                } label: {
                    TelegramStyleRow(
                        title: hit.title.isEmpty ? CampusText.kind(hit.kind) : hit.title,
                        subtitle: [
                            hit.title.isEmpty ? nil : CampusText.kind(hit.kind),
                            hit.building?.name,
                            hit.floor.map { String(localized: "campus.floorNamed", defaultValue: "Этаж \($0.label ?? String($0.level ?? 0))") },
                        ].compactMap { $0 }.joined(separator: " · ")
                    ) {
                        RowSymbol(symbol: CampusText.symbol(hit.kind), tint: TileTint.green, size: 40)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .compactListStyle()
        .screenState(model.results.isEmpty) {
            if let failure = model.searchFailure {
                ErrorStateView(message: failure, isOffline: model.searchOffline) { model.search(query) }
            } else if model.isSearching {
                LoadingStateView()
            } else {
                EmptyStateView(
                    title: String(localized: "services.notFound", defaultValue: "Ничего не нашлось"),
                    symbol: "magnifyingglass",
                    hint: String(localized: "services.notFound.hint", defaultValue: "Попробуйте другое слово")
                )
            }
        }
    }
}

/// Этажи столбиком в стекле — как кнопки лифта и переключатель этажей в «Картах»:
/// верхний этаж сверху.
private struct FloorPicker: View {
    let floors: [CampusPublishedDTO.Floor]
    let selection: String?
    let select: (String) -> Void

    @ScaledMetric(relativeTo: .body) private var side: CGFloat = 40

    private var height: CGFloat {
        let visible = CGFloat(min(floors.count, 5))
        return visible * min(side, 56) + (visible - 1) * 2 + 8
    }

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: 2) {
                ForEach(floors) { floor in
                    let isOn = floor.id == selection
                    Button {
                        select(floor.id)
                    } label: {
                        Text(verbatim: floor.title)
                            .font(.subheadline.weight(isOn ? .bold : .medium))
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                            .frame(width: min(side, 56), height: min(side, 56))
                            .foregroundStyle(isOn ? Palette.primaryForeground : Palette.foreground)
                            .background {
                                if isOn {
                                    Circle().fill(Palette.primary)
                                }
                            }
                            .contentShape(Circle())
                    }
                    .buttonStyle(.pressableIcon)
                    .accessibilityLabel(Text(String(localized: "campus.floorNamed", defaultValue: "Этаж \(floor.title)")))
                    .accessibilityAddTraits(isOn ? .isSelected : [])
                }
            }
            .padding(4)
        }
        // Больше пяти этажей — столбик прокручивается, а не закрывает план.
        .frame(height: height)
        .glassSurface(interactive: false, in: Capsule())
        .sensoryFeedback(.selection, trigger: selection)
    }
}

/// Сведения о помещении над картой.
private struct RoomCard: View {
    let room: FloorGeometry.Room
    let floor: CampusPublishedDTO.Floor?
    let building: CampusPublishedDTO.Building?
    let close: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: Spacing.lg) {
            RowSymbol(symbol: CampusText.symbol(room.space.kind), tint: TileTint.green, size: 48)
            VStack(alignment: .leading, spacing: 2) {
                Text(room.space.title.isEmpty ? CampusText.kind(room.space.kind) : room.space.title)
                    .font(.headline)
                    .foregroundStyle(Palette.foreground)
                Text([
                    CampusText.kind(room.space.kind),
                    building?.name,
                    floor.map { String(localized: "campus.floorNamed", defaultValue: "Этаж \($0.title)") },
                ].compactMap { $0 }.joined(separator: " · "))
                .font(.subheadline)
                .foregroundStyle(Palette.mutedForeground)
                if let capacity = room.space.capacity, capacity > 0 {
                    Label(String(localized: "campus.capacity", defaultValue: "Мест: \(capacity)"), systemImage: "person.2")
                        .font(.subheadline)
                        .foregroundStyle(Palette.mutedForeground)
                }
            }
            Spacer(minLength: 0)
            Button(action: close) {
                Image(systemName: "xmark")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Palette.mutedForeground)
                    .frame(width: 30, height: 30)
                    .glassSurface(in: Circle())
            }
            .buttonStyle(.pressableIcon)
            .accessibilityLabel(Text(String(localized: "common.close", defaultValue: "Закрыть")))
        }
        .padding(Spacing.lg)
        .floatingGlass(in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
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
