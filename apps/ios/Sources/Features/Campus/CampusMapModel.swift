import Foundation
import Observation

/// Состояние карты: какой кампус, корпус, этаж открыт, что найдено и что выделено.
///
/// Планы этажей кешируются в памяти на время экрана: переключение этажей туда-обратно
/// не должно каждый раз тянуть план заново.
@Observable
final class CampusMapModel {
    private(set) var campuses: [CampusSummaryDTO]?
    private(set) var published: CampusPublishedDTO?
    private(set) var buildingID: String?
    private(set) var floorID: String?
    private(set) var geometry: FloorGeometry?
    private(set) var selectedRoomID: String?
    private(set) var results: [CampusSpaceHitDTO] = []
    private(set) var isSearching = false
    private(set) var isLoadingFloor = false
    private(set) var failure: String?
    private(set) var isOffline = false
    /// Поиск не удался — экран говорит об этом, а не «Ничего не нашлось».
    private(set) var searchFailure: String?
    private(set) var searchOffline = false
    private(set) var notice: String?

    private let api: CampusFetching
    @ObservationIgnored private var cache: [String: FloorGeometry] = [:]
    @ObservationIgnored private var searchTask: Task<Void, Never>?

    init(api: CampusFetching = CampusAPI()) {
        self.api = api
    }

    var building: CampusPublishedDTO.Building? {
        published?.manifest.buildings.first { $0.id == buildingID }
    }

    /// Этажи сверху вниз — как кнопки лифта.
    var floors: [CampusPublishedDTO.Floor] {
        (building?.floors ?? []).sorted { $0.level > $1.level }
    }

    var selectedRoom: FloorGeometry.Room? {
        geometry?.rooms.first { $0.id == selectedRoomID }
    }

    /// Открыть карту. `roomID` — аудитория из расписания: карта сразу на её этаже.
    @MainActor
    func start(focusRoomID roomID: String?) async {
        if let roomID {
            do {
                let hit = try await api.location(roomID: roomID)
                await open(hit)
                return
            } catch let error as APIError where error.code == .notFound {
                notice = String(localized: "campus.roomNotOnMap", defaultValue: "Этой аудитории пока нет на карте")
            } catch {
                fail(error)
            }
        }
        await loadCampuses()
    }

    /// Карта опубликована, но рисовать нечего: ни одного корпуса или у корпуса нет
    /// этажей. Без этого признака экран навсегда оставался в загрузке.
    var hasNothingToDraw: Bool {
        guard let published, failure == nil, !isLoadingFloor, geometry == nil else { return false }
        return published.manifest.buildings.isEmpty || floors.isEmpty
    }

    @MainActor
    func loadCampuses() async {
        do {
            let list = try await api.campuses()
            campuses = list
            failure = nil
            if published == nil, let first = list.first {
                await select(campusID: first.id)
            }
        } catch {
            fail(error)
        }
    }

    @MainActor
    func select(campusID: String) async {
        do {
            let value = try await api.published(campusID: campusID)
            published = value
            cache = [:]
            failure = nil
            if let building = value.manifest.buildings.first {
                await select(buildingID: building.id)
            }
        } catch {
            fail(error)
        }
    }

    @MainActor
    func select(buildingID: String) async {
        self.buildingID = buildingID
        // Первый этаж по умолчанию — вход обычно там; нет его — нижний из наземных.
        let floor = floors.first { $0.level == 1 } ?? floors.last { $0.level >= 0 } ?? floors.last
        if let floor { await select(floorID: floor.id) }
    }

    @MainActor
    func select(floorID: String, highlight spaceID: String? = nil) async {
        guard let campusID = published?.campus.id else { return }
        self.floorID = floorID
        selectedRoomID = spaceID
        if let cached = cache[floorID] {
            geometry = cached
            return
        }
        geometry = nil
        isLoadingFloor = true
        defer { isLoadingFloor = false }
        do {
            let plan = try await api.floor(campusID: campusID, floorID: floorID)
            // Разбор геометрии — не на главном потоке: на большом этаже тысячи стен.
            let built = await Task.detached(priority: .userInitiated) { FloorGeometry(plan) }.value
            cache[floorID] = built
            if self.floorID == floorID { geometry = built }
            failure = nil
        } catch {
            fail(error)
        }
    }

    @MainActor
    func selectRoom(_ id: String?) {
        selectedRoomID = id
    }

    /// Найденное помещение: нужный кампус, корпус, этаж — и выделение.
    @MainActor
    func open(_ hit: CampusSpaceHitDTO) async {
        notice = nil
        if published?.campus.id != hit.campusId {
            do {
                published = try await api.published(campusID: hit.campusId)
                cache = [:]
            } catch {
                fail(error)
                return
            }
        }
        if let floor = hit.floor?.id {
            if let building = hit.building?.id { buildingID = building }
            await select(floorID: floor, highlight: hit.spaceId)
        } else {
            // Помещение без этажа на плане: без выбора этажа карта навсегда оставалась
            // в загрузке. Открываем этаж по умолчанию его корпуса (или первого корпуса)
            // и говорим, что само помещение на плане не отмечено.
            notice = String(localized: "campus.roomNotOnMap", defaultValue: "Этой аудитории пока нет на карте")
            if let building = hit.building?.id ?? published?.manifest.buildings.first?.id {
                await select(buildingID: building)
            }
        }
        results = []
    }

    /// Поиск с паузой: запрос уходит, когда человек перестал печатать.
    @MainActor
    func search(_ text: String) {
        searchTask?.cancel()
        let query = text.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else {
            results = []
            searchFailure = nil
            isSearching = false
            return
        }
        isSearching = true
        searchTask = Task { [api, campusID = published?.campus.id] in
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            do {
                let found = try await api.search(query, campusID: campusID)
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    self.results = found
                    self.searchFailure = nil
                    self.isSearching = false
                }
            } catch {
                // Отменил новый ввод — его запрос и решит, что показать. Оборванное
                // соединение без отмены задачи — не повод крутить поиск вечно.
                guard !Task.isCancelled else { return }
                if error is CancellationError {
                    await MainActor.run { self.isSearching = false }
                    return
                }
                let message = error.userMessage
                let offline = error.isOffline
                await MainActor.run {
                    self.results = []
                    self.searchFailure = message
                    self.searchOffline = offline
                    self.isSearching = false
                }
            }
        }
    }

    @MainActor
    func dismissNotice() {
        notice = nil
    }

    @MainActor
    private func fail(_ error: Error) {
        failure = error.userMessage
        isOffline = error.isOffline
    }
}
