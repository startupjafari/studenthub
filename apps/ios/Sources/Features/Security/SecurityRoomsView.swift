import SwiftUI

/// Справочник помещений для охраны (веб `/security/rooms`): где что находится, часы
/// работы и телефон. Только чтение. Помещение с выданным QR открывает «что сейчас идёт».
struct SecurityRoomsView: View {
    @State private var loader: PagedLoader<SecurityRoomDTO>
    @State private var search = ""
    @State private var sort: String? = "name"
    @State private var descending = false
    @State private var enteringCode = false
    @State private var codeInput = ""
    @State private var openCode: String?
    @State private var codeInvalid = false

    private static let api = SecurityAPI()

    init() {
        _loader = State(initialValue: PagedLoader(limit: 50) { request in
            try await Self.api.rooms(request, search: nil, sort: "name", order: "asc")
        })
    }

    var body: some View {
        PagedList(
            loader: loader,
            empty: EmptyStateView(
                title: search.isEmpty
                    ? String(localized: "security.rooms.empty", defaultValue: "Помещений пока нет")
                    : String(localized: "security.nothingFound", defaultValue: "Ничего не найдено"),
                symbol: "door.left.hand.closed",
                hint: search.isEmpty ? String(localized: "security.rooms.emptyHint", defaultValue: "Помещения заводит администратор вуза.") : nil
            ),
            row: { room in
                Group {
                    if let code = room.qrCode {
                        NavigationLink(value: AppRoute.security(.roomStatus(code: code))) {
                            SecurityRoomRow(room: room)
                        }
                    } else {
                        SecurityRoomRow(room: room)
                    }
                }
                .swipeActions(edge: .trailing) {
                    if let url = SecurityRoomRow.phoneURL(room.phone) {
                        Link(destination: url) {
                            Label(String(localized: "security.call", defaultValue: "Позвонить"), systemImage: "phone.fill")
                        }
                        .tint(Palette.success)
                    }
                }
                .contextMenu {
                    if let url = SecurityRoomRow.phoneURL(room.phone), let phone = room.phone {
                        Link(destination: url) {
                            Label(phone, systemImage: "phone")
                        }
                    }
                }
            }
        )
        .navigationTitle(Text(SecurityScreen.rooms.title))
        .debouncedSearch($search, prompt: String(localized: "security.rooms.search", defaultValue: "Поиск по названию")) { _ in
            await reload()
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    codeInput = ""
                    enteringCode = true
                } label: {
                    Image(systemName: "keyboard")
                }
                .accessibilityLabel(Text(String(localized: "security.rooms.enterCode", defaultValue: "Ввести код с наклейки")))
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker(String(localized: "security.rooms.sort", defaultValue: "Сортировка"), selection: $sort) {
                        Text(String(localized: "security.rooms.sortName", defaultValue: "По названию")).tag(String?.some("name"))
                        Text(String(localized: "security.rooms.sortKind", defaultValue: "По назначению")).tag(String?.some("kind"))
                        Text(String(localized: "security.rooms.sortBuilding", defaultValue: "По корпусу")).tag(String?.some("building"))
                        Text(String(localized: "security.rooms.sortFloor", defaultValue: "По этажу")).tag(String?.some("floor"))
                        Text(String(localized: "security.rooms.sortCapacity", defaultValue: "По вместимости")).tag(String?.some("capacity"))
                    }
                    Toggle(String(localized: "security.rooms.descending", defaultValue: "По убыванию"), isOn: $descending)
                } label: {
                    Image(systemName: "arrow.up.arrow.down")
                }
                .accessibilityLabel(Text(String(localized: "security.rooms.sort", defaultValue: "Сортировка")))
            }
        }
        .alert(String(localized: "security.rooms.enterCode", defaultValue: "Ввести код с наклейки"), isPresented: $enteringCode) {
            TextField(String(localized: "security.rooms.codePlaceholder", defaultValue: "Например, ABCD-EFGH"), text: $codeInput)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
            Button(String(localized: "security.rooms.open", defaultValue: "Открыть")) {
                if let code = SecurityQRTarget.roomCode(fromInput: codeInput) {
                    openCode = code
                } else {
                    codeInvalid = true
                }
            }
        } message: {
            Text(String(localized: "security.rooms.codeHint", defaultValue: "Восемь символов с наклейки над дверью — если QR повреждён"))
        }
        .alert(String(localized: "security.rooms.codeInvalid", defaultValue: "Код состоит из 8 букв и цифр, например ABCD-EFGH"), isPresented: $codeInvalid) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        }
        .navigationDestination(item: $openCode) { code in
            SecurityRoomStatusView(code: code)
        }
        .onChange(of: sort) { _, _ in Task { await reload() } }
        .onChange(of: descending) { _, _ in Task { await reload() } }
    }

    @MainActor
    private func reload() async {
        let needle = search.trimmingCharacters(in: .whitespaces)
        let sort = sort
        let order = descending ? "desc" : "asc"
        await loader.replace { request in
            try await Self.api.rooms(request, search: needle.isEmpty ? nil : needle, sort: sort, order: order)
        }
    }
}

/// Помещение в справочнике — как строка чата: значок назначения, название, этаж справа,
/// ниже — где находится и часы работы. Позвонить — свайпом или долгим нажатием.
private struct SecurityRoomRow: View {
    let room: SecurityRoomDTO

    var body: some View {
        TelegramStyleRow(
            title: room.name,
            subtitle: subtitle,
            meta: room.floor.map { String(localized: "security.rooms.floorValue", defaultValue: "\(String($0)) этаж") }
        ) {
            RowSymbol(symbol: SecurityRoomRow.symbol(room.kind), tint: SecurityRoomRow.tint(room.kind))
        }
    }

    private var subtitle: String {
        let place = [SecurityText.roomKind(room.kind), room.building]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
        let extra = [room.openHours, room.phone].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        return extra.isEmpty ? place : "\(place)\n\(extra)"
    }

    static func phoneURL(_ phone: String?) -> URL? {
        guard let phone, !phone.isEmpty else { return nil }
        return URL(string: "tel:\(phone.filter { $0.isNumber || $0 == "+" })")
    }

    static func symbol(_ kind: String) -> String {
        switch kind {
        case "AUDITORIUM": return "studentdesk"
        case "LAB": return "flask.fill"
        case "SPORT_HALL": return "figure.run"
        case "LIBRARY": return "books.vertical.fill"
        case "ASSEMBLY_HALL": return "theatermasks.fill"
        case "ADMIN_OFFICE", "DEAN_OFFICE": return "building.columns.fill"
        case "ACCOUNTING": return "banknote.fill"
        case "CANTEEN": return "fork.knife"
        case "DORMITORY": return "bed.double.fill"
        default: return "door.left.hand.closed"
        }
    }

    static func tint(_ kind: String) -> Color {
        switch kind {
        case "AUDITORIUM": return TileTint.blue
        case "LAB": return TileTint.teal
        case "SPORT_HALL": return TileTint.green
        case "LIBRARY": return TileTint.indigo
        case "ASSEMBLY_HALL": return TileTint.purple
        case "ADMIN_OFFICE", "DEAN_OFFICE": return TileTint.gray
        case "ACCOUNTING": return TileTint.yellow
        case "CANTEEN": return TileTint.orange
        case "DORMITORY": return TileTint.pink
        default: return TileTint.gray
        }
    }
}

// MARK: - Помещение по коду

/// Помещение по коду с наклейки (веб `/r/<код>`): свободно или занято, текущая и следующая
/// пара, остаток дня и сведения о помещении. Обновляется раз в минуту.
struct SecurityRoomStatusView: View {
    let code: String

    @State private var token = 0
    private let api = SecurityAPI()

    var body: some View {
        RemoteContent(reloadToken: token, load: { try await api.roomStatus(code: code) }) { data in
            SecurityRoomStatusContent(data: data) { token += 1 }
        }
        .navigationTitle(Text(SecurityScreen.roomStatus(code: code).title))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                if Task.isCancelled { break }
                token += 1
            }
        }
    }
}

private struct SecurityRoomStatusContent: View {
    let data: SecurityRoomStatusDTO
    let refresh: () -> Void

    var body: some View {
        let day = SecurityRoomDay(data: data)
        List {
            Section {
                HeroHeader(
                    visual: .symbol(SecurityRoomRow.symbol(data.room.kind), tint: SecurityRoomRow.tint(data.room.kind)),
                    title: data.room.name,
                    subtitle: [SecurityText.roomKind(data.room.kind), data.room.universityShort ?? data.room.university]
                        .compactMap { $0 }
                        .joined(separator: " · "),
                    actions: heroActions
                ) {
                    Text(String(localized: "security.room.updatedAt", defaultValue: "Обновлено в \(data.now.time)"))
                        .font(.caption)
                        .foregroundStyle(Palette.mutedForeground)
                }
            }

            Section {
                occupancy(day)
            }
            .listRowBackground(day.tint.opacity(0.12))

            if let current = day.current {
                Section(String(localized: "security.room.now", defaultValue: "Сейчас идёт")) {
                    SecurityDayPairRow(item: current)
                }
            } else if let next = day.next {
                Section(String(localized: "security.room.next", defaultValue: "Следующая пара")) {
                    SecurityDayPairRow(item: next)
                }
            }

            if data.academic, !day.items.isEmpty {
                Section {
                    ForEach(day.items) { item in
                        SecurityDayPairRow(item: item)
                    }
                } header: {
                    Text(String(localized: "security.room.today", defaultValue: "Сегодня в помещении"))
                } footer: {
                    Text(String(localized: "security.room.todayHint", defaultValue: "Пары по расписанию до конца дня"))
                }
            }

            Section(String(localized: "security.room.about", defaultValue: "О помещении")) {
                DetailRow(title: String(localized: "security.room.kind", defaultValue: "Назначение"), value: SecurityText.roomKind(data.room.kind), symbol: "tag")
                if let building = data.room.building {
                    DetailRow(title: String(localized: "security.room.building", defaultValue: "Корпус"), value: building, symbol: "building.2")
                }
                if let floor = data.room.floor {
                    DetailRow(title: String(localized: "security.room.floor", defaultValue: "Этаж"), value: String(floor), symbol: "square.stack.3d.up")
                }
                if let capacity = data.room.capacity {
                    DetailRow(
                        title: String(localized: "security.room.capacity", defaultValue: "Вместимость"),
                        value: String(localized: "security.room.capacityValue", defaultValue: "\(String(capacity)) мест"),
                        symbol: "person.3"
                    )
                }
                if let hours = data.room.openHours {
                    DetailRow(title: String(localized: "security.room.hours", defaultValue: "Часы работы"), value: hours, symbol: "clock")
                }
                if let phone = data.room.phone {
                    DetailRow(title: String(localized: "security.room.phone", defaultValue: "Телефон"), value: phone, symbol: "phone")
                }
                if let info = data.room.info {
                    DetailRow(title: String(localized: "security.room.info", defaultValue: "Примечание"), value: info, symbol: "info.circle")
                }
                NavigationLink(value: AppRoute.campusRoom(roomID: data.room.id)) {
                    Label(String(localized: "security.room.onMap", defaultValue: "Показать на карте"), systemImage: "map")
                }
            }
        }
        .listStyle(.insetGrouped)
        .pullToRefresh { refresh() }
    }

    @Environment(\.openURL) private var openURL

    private var heroActions: [HeroAction] {
        var actions: [HeroAction] = []
        if let url = SecurityRoomRow.phoneURL(data.room.phone) {
            actions.append(HeroAction(title: String(localized: "security.call", defaultValue: "Позвонить"), symbol: "phone.fill") { openURL(url) })
        }
        actions.append(HeroAction(title: String(localized: "security.room.refresh", defaultValue: "Обновить"), symbol: "arrow.clockwise", action: refresh))
        return actions
    }

    @ViewBuilder
    private func occupancy(_ day: SecurityRoomDay) -> some View {
        HStack(spacing: Spacing.lg) {
            Image(systemName: day.occupancy == .busy ? "door.left.hand.closed" : "door.left.hand.open")
                .font(.title.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 56, height: 56)
                .background(day.tint.gradient, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                switch day.occupancy {
                case .unknown:
                    Text(String(localized: "security.room.serviceHint", defaultValue: "Расписания занятий нет — смотрите часы работы."))
                        .font(Typography.body)
                        .foregroundStyle(Palette.foreground)
                case .busy:
                    Text(String(localized: "security.room.busy", defaultValue: "Занято"))
                        .font(.title2.weight(.bold))
                        .foregroundStyle(day.tint)
                    if let until = day.busyUntil {
                        Text(String(localized: "security.room.busyUntil", defaultValue: "До \(until)"))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                case .free:
                    Text(String(localized: "security.room.free", defaultValue: "Свободно"))
                        .font(.title2.weight(.bold))
                        .foregroundStyle(day.tint)
                    Text(day.freeUntil.map { String(localized: "security.room.freeUntil", defaultValue: "Свободно до \($0)") }
                        ?? String(localized: "security.room.freeRest", defaultValue: "Занятий больше нет"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, Spacing.md)
        .accessibilityElement(children: .combine)
    }
}

/// Пара дня в помещении с учётом изменений на сегодня.
private struct SecurityDayPair: Identifiable {
    enum State { case normal, now, past, cancelled, changed }

    let pair: SecurityRoomPairDTO
    let change: SecurityRoomChangeDTO?
    let start: String
    let end: String
    let state: State
    let isCurrent: Bool

    var id: String { pair.id }
}

/// «Занято или свободно» — теми же правилами, что `buildRoomStatus` в вебе: пары дня
/// недели и чётности с сервера, изменения на сегодня, аудитория — из изменения, иначе из
/// пары (пару могли увести отсюда или привести сюда).
private struct SecurityRoomDay {
    enum Occupancy { case busy, free, unknown }

    let items: [SecurityDayPair]
    let current: SecurityDayPair?
    let next: SecurityDayPair?
    let occupancy: Occupancy
    let busyUntil: String?
    let freeUntil: String?

    init(data: SecurityRoomStatusDTO) {
        let now = data.now
        let parity = Self.parity(of: now.date)
        var changes: [String: SecurityRoomChangeDTO] = [:]
        for change in data.changes where change.date.prefix(10) == now.date {
            changes[change.pairId] = change
        }
        let items = data.pairs
            .filter { $0.dayOfWeek == now.dayOfWeek && ($0.weekType == "BOTH" || $0.weekType == parity) }
            .sorted { $0.startTime < $1.startTime }
            .map { pair -> SecurityDayPair in
                let change = changes[pair.id]
                let start = change?.newStartTime ?? pair.startTime
                let end = change?.newEndTime ?? pair.endTime
                let cancelled = change?.type == "CANCELLED"
                let isCurrent = !cancelled && now.time >= start && now.time < end
                let state: SecurityDayPair.State
                if cancelled {
                    state = .cancelled
                } else if change != nil {
                    state = .changed
                } else if isCurrent {
                    state = .now
                } else if now.time >= end {
                    state = .past
                } else {
                    state = .normal
                }
                return SecurityDayPair(pair: pair, change: change, start: start, end: end, state: state, isCurrent: isCurrent)
            }
            .filter { ($0.change?.newRoom?.id ?? $0.pair.room?.id) == data.room.id }

        self.items = items
        let current = items.first { $0.isCurrent }
        let upcoming = items.first { $0.state != .cancelled && $0.start > now.time }
        self.current = current
        next = current ?? upcoming
        occupancy = !data.academic ? .unknown : (current != nil ? .busy : .free)
        busyUntil = current?.end
        freeUntil = current == nil ? upcoming?.start : nil
    }

    var tint: Color {
        switch occupancy {
        case .busy: return Palette.warning
        case .free: return Palette.success
        case .unknown: return Palette.primary
        }
    }

    /// Чётность недели по дате сервера: телефон с уехавшими часами показал бы другую неделю.
    private static func parity(of date: String) -> String {
        let parts = date.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return WeekParity.current().rawValue }
        var components = DateComponents()
        components.year = parts[0]
        components.month = parts[1]
        components.day = parts[2]
        components.hour = 12
        let utc = TimeZone(identifier: "UTC") ?? .current
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = utc
        guard let day = calendar.date(from: components) else { return WeekParity.current().rawValue }
        return WeekParity.current(day, in: utc).rawValue
    }
}

private struct SecurityDayPairRow: View {
    let item: SecurityDayPair

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.lg) {
            VStack(alignment: .trailing, spacing: 0) {
                Text(verbatim: item.start).font(Typography.meta.monospacedDigit().weight(.semibold))
                Text(verbatim: item.end).font(.caption.monospacedDigit())
            }
            .foregroundStyle(item.state == .past ? Palette.mutedForeground : Palette.foreground)
            .frame(width: 48, alignment: .trailing)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.pair.subject)
                    .font(Typography.cardTitle)
                    .foregroundStyle(item.state == .cancelled || item.state == .past ? Palette.mutedForeground : Palette.foreground)
                    .strikethrough(item.state == .cancelled)
                let teacher = item.change?.newTeacher?.name ?? item.pair.teacher?.name
                let meta = [item.pair.group?.name, teacher].compactMap { $0 }.filter { $0 != "—" }.joined(separator: " · ")
                if !meta.isEmpty {
                    Text(meta).font(Typography.meta).foregroundStyle(Palette.mutedForeground)
                }
                if let note = item.change?.note, !note.isEmpty {
                    Text(note).font(Typography.meta).foregroundStyle(Palette.warning)
                }
            }
            Spacer(minLength: 0)
            switch item.state {
            case .now: SecurityBadge(text: String(localized: "security.room.stateNow", defaultValue: "Идёт"), tint: Palette.warning)
            case .cancelled: SecurityBadge(text: String(localized: "security.room.stateCancelled", defaultValue: "Отменена"), tint: Palette.destructive)
            case .changed: SecurityBadge(text: String(localized: "security.room.stateChanged", defaultValue: "Изменена"), tint: Palette.info)
            case .normal, .past: EmptyView()
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}
