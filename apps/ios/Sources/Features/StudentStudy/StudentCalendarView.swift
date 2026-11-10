import SwiftUI

/// Единый академический календарь (веб `/calendar`): пары из недельного шаблона,
/// разложенные на даты с разовыми изменениями, события, сроки заданий и экзамены.
///
/// Экраном пользуются и преподаватель, и деканат: все маршруты здесь общие для ролей
/// (`/schedule`, `/schedule/changes`, `/events`, `/assignments`, `/exams`), а куда ведёт
/// элемент — решает роль, как `calendarLinks` в вебе. Преподавателю добавляются чужие
/// пары, которые он ведёт по замене.
///
/// Месяц сеткой на телефоне — с точками-метками, день — списком под сеткой; повестка —
/// дни месяца, в которых что-то есть, подряд.
struct StudentCalendarView: View {
    @Environment(\.viewerRole) private var role

    @State private var anchor = StudentCalendarView.monthStart(Date())
    @State private var mode: Mode = .month
    @State private var filter: StudentCalendarItem.Kind?
    @State private var selectedDay: String?
    @State private var data: Loaded?
    @State private var failure: String?
    @State private var isOffline = false

    private enum Mode: Hashable { case month, agenda }

    private struct Loaded {
        let anchor: Date
        let items: [StudentCalendarItem]
    }

    var body: some View {
        List {
            Section {
                monthHeader
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: Spacing.xs, leading: Spacing.xs, bottom: 0, trailing: 0))

            FilterChipsRow(options: Self.filterOptions, selection: $filter)

            if let data, Self.calendar.isDate(data.anchor, equalTo: anchor, toGranularity: .month) {
                if let failure {
                    StaleDataBanner(message: failure, isOffline: isOffline) { await load() }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                let byDay = Self.group(data.items.filter { filter == nil || $0.kind == filter })
                if mode == .month {
                    Section {
                        StudentMonthGrid(
                            cells: Self.cells(for: anchor),
                            month: Self.calendar.component(.month, from: anchor),
                            byDay: byDay,
                            selected: $selectedDay
                        )
                    }
                    let day = selectedDay ?? Self.dayKey(Date())
                    if Self.cells(for: anchor).contains(where: { Self.dayKey($0) == day }) {
                        dayDetails(day, items: byDay[day] ?? [], showEmpty: true)
                    }
                } else {
                    let days = Self.cells(for: anchor).map(Self.dayKey).filter { (byDay[$0]?.isEmpty == false) || StudentHoliday.on($0) != nil }
                    if days.isEmpty {
                        EmptyStateView(
                            title: String(localized: "student.calendar.empty", defaultValue: "Событий нет"),
                            symbol: "tray",
                            hint: String(localized: "student.calendar.emptyHint", defaultValue: "В этом месяце пока ничего не запланировано.")
                        )
                        .listRowBackground(Color.clear)
                    }
                    ForEach(days, id: \.self) { day in
                        dayDetails(day, items: byDay[day] ?? [], showEmpty: false)
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
        .listSectionSpacing(.compact)
        .navigationTitle(Text(StudentScreen.calendar.title))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    mode = mode == .month ? .agenda : .month
                } label: {
                    Image(systemName: mode == .month ? "list.bullet" : "calendar")
                }
                .accessibilityLabel(Text(mode == .month
                    ? String(localized: "student.calendar.view.agenda", defaultValue: "Повестка")
                    : String(localized: "student.calendar.view.month", defaultValue: "Месяц")))
            }
        }
        .refreshable { await load() }
        .task(id: anchor) { await load() }
    }

    // MARK: Шапка

    /// Месяц крупно слева, как в «Календаре»; справа — «Сегодня» и стрелки.
    private var monthHeader: some View {
        HStack(spacing: Spacing.xs) {
            Text(anchor, format: .dateTime.month(.wide).year())
                .font(.title2.weight(.bold))
                .foregroundStyle(Palette.foreground)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: Spacing.md)
            if !Self.calendar.isDate(anchor, equalTo: Date(), toGranularity: .month) {
                Button(String(localized: "schedule.today", defaultValue: "Сегодня")) {
                    anchor = Self.monthStart(Date())
                    selectedDay = nil
                }
                .font(.subheadline.weight(.semibold))
                .padding(.trailing, Spacing.sm)
            }
            Button {
                shift(-1)
            } label: {
                Image(systemName: "chevron.left")
                    .frame(width: 40, height: 40)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel(Text(String(localized: "student.calendar.prev", defaultValue: "Предыдущий месяц")))
            Button {
                shift(1)
            } label: {
                Image(systemName: "chevron.right")
                    .frame(width: 40, height: 40)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel(Text(String(localized: "student.calendar.next", defaultValue: "Следующий месяц")))
        }
        .font(.body.weight(.semibold))
        .buttonStyle(.borderless)
        .foregroundStyle(Palette.primary)
    }

    private func shift(_ delta: Int) {
        anchor = Self.calendar.date(byAdding: .month, value: delta, to: anchor) ?? anchor
        selectedDay = nil
    }

    // MARK: День

    @ViewBuilder
    private func dayDetails(_ day: String, items: [StudentCalendarItem], showEmpty: Bool) -> some View {
        let holiday = StudentHoliday.on(day)
        Section {
            if let holiday {
                Label {
                    Text(verbatim: holiday.dayOff
                        ? "\(holiday.title) · \(String(localized: "student.calendar.dayOff", defaultValue: "нерабочий день"))"
                        : holiday.title)
                } icon: {
                    Image(systemName: "sparkles")
                }
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
            }
            if items.isEmpty && showEmpty && holiday == nil {
                Label(String(localized: "student.calendar.noItems", defaultValue: "Нет событий"), systemImage: "sun.max")
                    .font(.subheadline)
                    .foregroundStyle(Palette.mutedForeground)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Spacing.md)
            }
            ForEach(items) { item in
                if let route = item.route {
                    NavigationLink(value: route) { StudentCalendarRow(item: item) }
                } else {
                    StudentCalendarRow(item: item)
                }
            }
        } header: {
            Text(Self.date(day) ?? Date(), format: .dateTime.weekday(.wide).day().month(.wide))
                .font(.subheadline.weight(.semibold))
                .textCase(nil)
                .foregroundStyle(day == Self.dayKey(Date()) ? Palette.primary : Palette.foreground)
        }
    }

    // MARK: Загрузка

    @MainActor
    private func load() async {
        let month = anchor
        let cells = Self.cells(for: month)
        guard let first = cells.first, let last = cells.last else { return }
        let api = StudentStudyAPI()
        let role = role
        let dueTo = Self.calendar.date(byAdding: .day, value: 1, to: last) ?? last
        do {
            let schedule = try await api.schedule()
            async let changesValue = try? api.scheduleChanges(from: Self.dayKey(first), to: Self.dayKey(last))
            async let eventsValue = try? api.upcomingEvents(limit: 50)
            async let assignmentsValue = try? api.assignments(limit: 100, dueFrom: first, dueTo: dueTo).items
            async let examsValue = try? api.exams(from: first, to: dueTo)
            async let meValue = Self.substituteID(api: api, role: role)
            let links = StudentCalendarLinks(role: role)
            let changes = await changesValue
            let events = await eventsValue
            let assignments = await assignmentsValue
            let exams = await examsValue
            let items = StudentCalendarBuilder.build(
                pairs: schedule.pairs,
                changes: changes ?? [],
                events: events ?? [],
                assignments: assignments ?? [],
                exams: exams ?? [],
                dates: cells,
                substituteID: await meValue,
                links: links
            )
            guard month == anchor else { return }
            data = Loaded(anchor: month, items: items)
            // Остальное — дополнение к парам: без него календарь всё равно полезен, но
            // пустой день из-за упавших заданий не должен выглядеть свободным.
            let isComplete = changes != nil && events != nil && assignments != nil && exams != nil
            failure = isComplete
                ? nil
                : String(localized: "student.partialFailure", defaultValue: "Часть данных не загрузилась")
            isOffline = false
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
            isOffline = error.isOffline
        }
    }

    /// Свой id — только преподавателю: по нему находятся пары, где он заменяющий.
    private static func substituteID(api: StudentStudyAPI, role: Role) async -> String? {
        guard role == .teacher else { return nil }
        return (try? await api.me())?["id"]?.string
    }

    // MARK: Даты

    fileprivate static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.firstWeekday = 2
        calendar.locale = Locale.current
        return calendar
    }()

    private static func monthStart(_ date: Date) -> Date {
        calendar.date(from: calendar.dateComponents([.year, .month], from: date)) ?? date
    }

    /// Клетки сетки месяца: с понедельника недели 1-го числа до воскресенья недели последнего.
    fileprivate static func cells(for month: Date) -> [Date] {
        let start = monthStart(month)
        guard let range = calendar.range(of: .day, in: .month, for: start),
              let end = calendar.date(byAdding: .day, value: range.count - 1, to: start)
        else { return [] }
        let lead = (calendar.component(.weekday, from: start) + 5) % 7
        let trail = 6 - (calendar.component(.weekday, from: end) + 5) % 7
        guard let first = calendar.date(byAdding: .day, value: -lead, to: start) else { return [] }
        let count = lead + range.count + trail
        return (0..<count).compactMap { calendar.date(byAdding: .day, value: $0, to: first) }
    }

    fileprivate static func dayKey(_ date: Date) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    fileprivate static func date(_ key: String) -> Date? {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    private static func group(_ items: [StudentCalendarItem]) -> [String: [StudentCalendarItem]] {
        Dictionary(grouping: items, by: \.day).mapValues { list in
            list.sorted { ($0.start ?? "99") < ($1.start ?? "99") }
        }
    }

    private static let filterOptions: [(value: StudentCalendarItem.Kind?, title: String)] = [
        (nil, String(localized: "student.filter.all", defaultValue: "Все")),
        (.pair, String(localized: "student.calendar.filter.pairs", defaultValue: "Пары")),
        (.assignment, String(localized: "student.calendar.filter.assignments", defaultValue: "Задания")),
        (.exam, String(localized: "student.calendar.filter.exams", defaultValue: "Экзамены")),
        (.event, String(localized: "student.calendar.filter.events", defaultValue: "События")),
    ]
}

// MARK: - Модель

/// Элемент календаря: пара на дату, событие, срок задания или экзамен.
struct StudentCalendarItem: Identifiable, Equatable {
    enum Kind: Hashable { case pair, event, assignment, exam }

    let id: String
    /// «ГГГГ-ММ-ДД» — местный день.
    let day: String
    let start: String?
    let end: String?
    let title: String
    let subtitle: String?
    let kind: Kind
    var cancelled = false
    var changed = false
    var changeTitle: String?
    var route: AppRoute?

    var tint: Color {
        switch kind {
        case .event: return Palette.info
        case .assignment: return Palette.warning
        case .exam: return Palette.success
        case .pair: return cancelled ? Palette.destructive : (changed ? Palette.warning : Palette.primary)
        }
    }

    var kindTitle: String {
        switch kind {
        case .pair: return String(localized: "student.calendar.kind.pair", defaultValue: "Пара")
        case .event: return String(localized: "student.calendar.kind.event", defaultValue: "Событие")
        case .assignment: return String(localized: "student.calendar.kind.assignment", defaultValue: "Срок сдачи")
        case .exam: return String(localized: "student.calendar.kind.exam", defaultValue: "Экзамен")
        }
    }
}

/// Куда ведёт элемент: экраны у ролей свои — преподаватель со студенческих «Заданий»
/// попадал бы на «Сдать работу».
struct StudentCalendarLinks {
    let role: Role

    func pair(id: String, date: Date) -> AppRoute? {
        switch role {
        case .student, .starosta, .teacher: return .lesson(id: id, date: date)
        case .dean: return .dean(.schedule)
        default: return nil
        }
    }

    func event(id: String) -> AppRoute? { .event(id: id) }

    func assignment(id: String) -> AppRoute? {
        switch role {
        case .teacher: return .teacher(.assignmentSubmissions(assignmentID: id))
        case .dean: return .dean(.courses)
        default: return .assignment(id: id)
        }
    }

    func exam(id: String) -> AppRoute? {
        switch role {
        case .student, .starosta: return .student(.exams)
        case .teacher: return .teacher(.exam(id: id))
        case .dean: return .dean(.exams)
        default: return nil
        }
    }
}

enum StudentCalendarBuilder {
    static func build(
        pairs: [PairDTO],
        changes: [StudentScheduleChangeDTO],
        events: [StudentEventDTO],
        assignments: [AssignmentDTO],
        exams: [StudentExamDTO],
        dates: [Date],
        substituteID: String?,
        links: StudentCalendarLinks
    ) -> [StudentCalendarItem] {
        var items: [StudentCalendarItem] = []
        let merged = mergedChanges(changes)
        let calendar = StudentCalendarView.calendar
        for date in dates {
            let day = StudentCalendarView.dayKey(date)
            let dow = ((calendar.component(.weekday, from: date) + 5) % 7) + 1
            let parity = WeekParity.weekNumber(of: date, in: calendar.timeZone) % 2 == 1 ? "ODD" : "EVEN"
            var dayPairs = pairs.map(Pair.init)
            if let substituteID {
                dayPairs += substitutionPairs(changes, day: day, teacherID: substituteID)
            }
            for pair in dayPairs where pair.dayOfWeek == dow && (pair.weekType == "BOTH" || pair.weekType == parity) {
                let change = merged["\(pair.id)|\(day)"]
                let cancelled = change?.type == "CANCELLED"
                let room = change?.newRoom?.name ?? pair.room
                let teacher = change?.newTeacher?.name ?? pair.teacher
                let subtitle = [room, teacher].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
                items.append(StudentCalendarItem(
                    id: "pair-\(pair.id)-\(day)",
                    day: day,
                    start: change?.newStartTime ?? pair.startTime,
                    end: change?.newEndTime ?? pair.endTime,
                    title: pair.subject,
                    subtitle: subtitle.isEmpty ? nil : subtitle,
                    kind: .pair,
                    cancelled: cancelled,
                    changed: change != nil && !cancelled,
                    changeTitle: change.map { StudentChangeFormat.title($0.type) },
                    route: links.pair(id: pair.id, date: date)
                ))
            }
        }
        for event in events {
            items.append(StudentCalendarItem(
                id: "event-\(event.id)",
                day: StudentCalendarView.dayKey(event.startsAt),
                start: clock(event.startsAt),
                end: nil,
                title: event.title,
                subtitle: event.location ?? (event.isOnline == true ? String(localized: "student.calendar.online", defaultValue: "онлайн") : nil),
                kind: .event,
                route: links.event(id: event.id)
            ))
        }
        for assignment in assignments {
            guard let due = assignment.dueAt else { continue }
            items.append(StudentCalendarItem(
                id: "assignment-\(assignment.id)",
                day: StudentCalendarView.dayKey(due),
                start: clock(due),
                end: nil,
                title: assignment.title,
                subtitle: assignment.subject,
                kind: .assignment,
                route: links.assignment(id: assignment.id)
            ))
        }
        for exam in exams {
            let subtitle = [exam.room?.name, exam.examiner?.name].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
            items.append(StudentCalendarItem(
                id: "exam-\(exam.id)",
                day: StudentCalendarView.dayKey(exam.date),
                start: clock(exam.date),
                end: nil,
                title: exam.course.subject.name,
                subtitle: subtitle.isEmpty ? nil : subtitle,
                kind: .exam,
                route: links.exam(id: exam.id)
            ))
        }
        return items
    }

    /// Пара в одном виде — своя из расписания или чужая, которую ведёшь по замене.
    private struct Pair {
        let id: String
        let subject: String
        let dayOfWeek: Int
        let startTime: String
        let endTime: String
        let weekType: String
        let room: String?
        let teacher: String?

        init(_ pair: PairDTO) {
            id = pair.id
            subject = pair.subject
            dayOfWeek = pair.dayOfWeek
            startTime = pair.startTime
            endTime = pair.endTime
            weekType = pair.weekType
            room = pair.room?.name
            teacher = [pair.teacher?.lastName, pair.teacher?.firstName].compactMap { $0 }.joined(separator: " ")
        }

        init(id: String, change: StudentScheduleChangeDTO.Pair) {
            self.id = id
            subject = change.subject
            dayOfWeek = change.dayOfWeek ?? 0
            startTime = change.startTime
            endTime = change.endTime
            weekType = change.weekType ?? "BOTH"
            room = change.room?.name
            teacher = change.teacher?.name
        }
    }

    /// Чужие пары, где преподаватель — заменяющий на эту дату: в его выборке их нет.
    private static func substitutionPairs(_ changes: [StudentScheduleChangeDTO], day: String, teacherID: String) -> [Pair] {
        var seen = Set<String>()
        var out: [Pair] = []
        let sameDay = changes.filter { $0.day == day && $0.type == "SUBSTITUTED" }
        for change in sameDay.sorted(by: { ($0.createdAt ?? "") < ($1.createdAt ?? "") }).reversed() {
            guard !seen.contains(change.pairId), let pair = change.pair else { continue }
            seen.insert(change.pairId)
            guard pair.teacher?.id != teacherID, change.newTeacher?.id == teacherID else { continue }
            out.append(Pair(id: change.pairId, change: pair))
        }
        return out
    }

    /// Несколько изменений пары на дату сводятся в одно, как на сервере (`mergeChanges`):
    /// отмена побеждает, остальные поля берутся из последнего изменения, где они есть.
    static func mergedChanges(_ changes: [StudentScheduleChangeDTO]) -> [String: StudentScheduleChangeDTO] {
        let grouped = Dictionary(grouping: changes) { "\($0.pairId)|\($0.day)" }
        return grouped.compactMapValues { list in
            let sorted = list.sorted { ($0.createdAt ?? "") < ($1.createdAt ?? "") }
            if let cancel = sorted.first(where: { $0.type == "CANCELLED" }) { return cancel }
            var merged: StudentScheduleChangeDTO?
            for change in sorted {
                let moved = change.type == "MOVED" && change.newStartTime != nil && change.newEndTime != nil
                let roomChanged = (change.type == "ROOM_CHANGED" || change.type == "MOVED") && change.newRoom != nil
                let substituted = change.type == "SUBSTITUTED" && change.newTeacher != nil
                merged = StudentScheduleChangeDTO(
                    id: change.id,
                    pairId: change.pairId,
                    type: change.type,
                    date: change.date,
                    newStartTime: moved ? change.newStartTime : merged?.newStartTime,
                    newEndTime: moved ? change.newEndTime : merged?.newEndTime,
                    note: change.note ?? merged?.note,
                    createdAt: change.createdAt,
                    newRoom: roomChanged ? change.newRoom : merged?.newRoom,
                    newTeacher: substituted ? change.newTeacher : merged?.newTeacher,
                    pair: change.pair
                )
            }
            return merged
        }
    }

    private static func clock(_ date: Date) -> String {
        let parts = StudentCalendarView.calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }
}

/// Подпись разового изменения пары — как в вебе (`Schedule.change*`).
enum StudentChangeFormat {
    static func title(_ type: String) -> String {
        switch type {
        case "CANCELLED": return String(localized: "student.change.cancelled", defaultValue: "Отменена")
        case "MOVED": return String(localized: "student.change.moved", defaultValue: "Перенесена")
        case "ROOM_CHANGED": return String(localized: "student.change.room", defaultValue: "Другая аудитория")
        case "SUBSTITUTED": return String(localized: "student.change.substituted", defaultValue: "Замена")
        default: return type
        }
    }
}

// MARK: - Праздники

/// Праздники Казахстана — тот же справочник, что в вебе (`shared/config/holidays.ts`),
/// без «мягких» дат: они в календаре не показываются. Считаются на устройстве — даты
/// одинаковы для всех, запрос ради них был бы лишним.
struct StudentHoliday {
    let id: String
    let title: String
    let dayOff: Bool

    private enum When {
        case fixed(from: String, to: String)
        case lunar([String: String])
        /// n-й день недели (1 — понедельник) месяца.
        case nth(month: Int, weekday: Int, nth: Int)
    }

    private static let table: [(id: String, priority: Int, dayOff: Bool, when: When)] = [
        ("repression-victims-day", 100, false, .fixed(from: "05-31", to: "05-31")),
        ("new-year", 80, true, .fixed(from: "01-01", to: "01-02")),
        ("orthodox-christmas", 80, true, .fixed(from: "01-07", to: "01-07")),
        ("womens-day", 80, true, .fixed(from: "03-08", to: "03-08")),
        ("nauryz", 80, true, .fixed(from: "03-21", to: "03-23")),
        ("unity-day", 80, true, .fixed(from: "05-01", to: "05-01")),
        ("defender-day", 80, true, .fixed(from: "05-07", to: "05-07")),
        ("victory-day", 80, true, .fixed(from: "05-09", to: "05-09")),
        ("kurban-ait", 80, true, .lunar(["2026": "05-27", "2027": "05-16", "2028": "05-05"])),
        ("capital-day", 80, true, .fixed(from: "07-06", to: "07-06")),
        ("constitution-day", 80, true, .fixed(from: "08-30", to: "08-30")),
        ("republic-day", 80, true, .fixed(from: "10-25", to: "10-25")),
        ("independence-day", 80, true, .fixed(from: "12-16", to: "12-16")),
        ("knowledge-day", 60, false, .fixed(from: "09-01", to: "09-01")),
        ("teachers-day", 60, false, .nth(month: 10, weekday: 7, nth: 1)),
        ("oraza-ait", 50, false, .lunar(["2026": "03-20", "2027": "03-09", "2028": "02-26"])),
        ("languages-day", 50, false, .fixed(from: "09-22", to: "09-22")),
        ("students-day", 50, false, .fixed(from: "11-17", to: "11-17")),
        ("new-year-eve", 50, false, .fixed(from: "12-29", to: "12-31")),
    ]

    /// Праздник дня «ГГГГ-ММ-ДД» с наибольшим приоритетом или `nil`.
    static func on(_ day: String) -> StudentHoliday? {
        guard day.count == 10 else { return nil }
        let year = String(day.prefix(4))
        let monthDay = String(day.suffix(5))
        let match = table
            .filter { matches($0.when, year: year, monthDay: monthDay) }
            .max { $0.priority < $1.priority }
        return match.map { StudentHoliday(id: $0.id, title: title($0.id), dayOff: $0.dayOff) }
    }

    private static func matches(_ when: When, year: String, monthDay: String) -> Bool {
        switch when {
        case .fixed(let from, let to): return monthDay >= from && monthDay <= to
        case .lunar(let byYear): return byYear[year] == monthDay
        case .nth(let month, let weekday, let nth):
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
            guard let y = Int(year), let first = calendar.date(from: DateComponents(year: y, month: month, day: 1)) else { return false }
            let firstISO = ((calendar.component(.weekday, from: first) + 5) % 7) + 1
            let day = 1 + ((weekday - firstISO + 7) % 7) + (nth - 1) * 7
            return String(format: "%02d-%02d", month, day) == monthDay
        }
    }

    private static func title(_ id: String) -> String {
        switch id {
        case "repression-victims-day": return String(localized: "student.holiday.repressionVictimsDay", defaultValue: "День памяти жертв политических репрессий")
        case "new-year": return String(localized: "student.holiday.newYear", defaultValue: "Новый год")
        case "orthodox-christmas": return String(localized: "student.holiday.orthodoxChristmas", defaultValue: "Рождество Христово")
        case "womens-day": return String(localized: "student.holiday.womensDay", defaultValue: "Международный женский день")
        case "nauryz": return String(localized: "student.holiday.nauryz", defaultValue: "Наурыз мейрамы")
        case "unity-day": return String(localized: "student.holiday.unityDay", defaultValue: "День единства народа Казахстана")
        case "defender-day": return String(localized: "student.holiday.defenderDay", defaultValue: "День защитника Отечества")
        case "victory-day": return String(localized: "student.holiday.victoryDay", defaultValue: "День Победы")
        case "kurban-ait": return String(localized: "student.holiday.kurbanAit", defaultValue: "Курбан айт")
        case "capital-day": return String(localized: "student.holiday.capitalDay", defaultValue: "День Столицы")
        case "constitution-day": return String(localized: "student.holiday.constitutionDay", defaultValue: "День Конституции")
        case "republic-day": return String(localized: "student.holiday.republicDay", defaultValue: "День Республики")
        case "independence-day": return String(localized: "student.holiday.independenceDay", defaultValue: "День Независимости")
        case "knowledge-day": return String(localized: "student.holiday.knowledgeDay", defaultValue: "День знаний")
        case "teachers-day": return String(localized: "student.holiday.teachersDay", defaultValue: "День учителя")
        case "oraza-ait": return String(localized: "student.holiday.orazaAit", defaultValue: "Ораза айт")
        case "languages-day": return String(localized: "student.holiday.languagesDay", defaultValue: "День языков народа Казахстана")
        case "students-day": return String(localized: "student.holiday.studentsDay", defaultValue: "Международный день студентов")
        case "new-year-eve": return String(localized: "student.holiday.newYearEve", defaultValue: "Канун Нового года")
        default: return id
        }
    }
}

// MARK: - Вид

/// Элемент дня как событие «Календаря»: время столбцом слева, цветная полоса вида,
/// название и подробности, плашка изменения.
private struct StudentCalendarRow: View {
    let item: StudentCalendarItem

    @ScaledMetric(relativeTo: .subheadline) private var timeWidth: CGFloat = 44

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            VStack(alignment: .trailing, spacing: 2) {
                if let start = item.start {
                    Text(verbatim: start)
                        .font(Typography.tabular(.subheadline.weight(.semibold)))
                        .foregroundStyle(Palette.foreground)
                    if let end = item.end {
                        Text(verbatim: end)
                            .font(Typography.tabular(.footnote))
                            .foregroundStyle(Palette.mutedForeground)
                    }
                } else {
                    Image(systemName: Self.symbol(item.kind))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(item.tint)
                        .accessibilityHidden(true)
                }
            }
            .frame(width: min(timeWidth, 72), alignment: .trailing)
            Capsule()
                .fill(item.tint)
                .frame(width: 4)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(item.cancelled ? Palette.mutedForeground : Palette.foreground)
                    .strikethrough(item.cancelled)
                    .lineLimit(3)
                if let subtitle = item.subtitle {
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(2)
                }
                HStack(spacing: Spacing.sm) {
                    StatusBadge(text: item.kindTitle, tint: item.tint)
                    if let change = item.changeTitle {
                        StatusBadge(text: change, tint: item.cancelled ? Palette.destructive : Palette.warning)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    private static func symbol(_ kind: StudentCalendarItem.Kind) -> String {
        switch kind {
        case .pair: return "book.closed.fill"
        case .event: return "star.fill"
        case .assignment: return "flag.fill"
        case .exam: return "rosette"
        }
    }
}

/// Сетка месяца: число, сегодня кружком, под числом — до трёх меток цвета типа.
private struct StudentMonthGrid: View {
    let cells: [Date]
    let month: Int
    let byDay: [String: [StudentCalendarItem]]
    @Binding var selected: String?

    private static let weekdays: [String] = {
        let symbols = Calendar.current.veryShortStandaloneWeekdaySymbols
        return Array(symbols[1...] + symbols[..<1])
    }()

    var body: some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: 7)
        LazyVGrid(columns: columns, spacing: Spacing.xs) {
            ForEach(Array(Self.weekdays.enumerated()), id: \.offset) { index, title in
                Text(verbatim: title)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(index >= 5 ? Palette.mutedForeground.opacity(0.6) : Palette.mutedForeground)
            }
            ForEach(cells, id: \.self) { date in
                cell(date)
            }
        }
        .padding(.vertical, Spacing.sm)
    }

    private func numberColor(isToday: Bool, isSelected: Bool, outside: Bool, dayOff: Bool) -> Color {
        if isSelected { return Color(uiColor: .systemBackground) }
        if isToday { return Palette.primary }
        if outside { return Palette.mutedForeground.opacity(0.5) }
        return dayOff ? Palette.destructive : Palette.foreground
    }

    private func cell(_ date: Date) -> some View {
        let calendar = StudentCalendarView.calendar
        let key = StudentCalendarView.dayKey(date)
        let items = byDay[key] ?? []
        let isToday = calendar.isDateInToday(date)
        let isSelected = selected == key || (selected == nil && isToday)
        let outside = calendar.component(.month, from: date) != month
        let holiday = StudentHoliday.on(key)
        let dayOff = holiday?.dayOff == true
        return Button {
            selected = key
        } label: {
            VStack(spacing: 3) {
                Text(verbatim: String(calendar.component(.day, from: date)))
                    .font(Typography.tabular(.body.weight(isToday || isSelected ? .semibold : .regular)))
                    .foregroundStyle(numberColor(isToday: isToday, isSelected: isSelected, outside: outside, dayOff: dayOff))
                    .frame(width: 36, height: 36)
                    .background {
                        if isSelected {
                            Circle().fill(isToday ? Palette.primary : Palette.foreground)
                        }
                    }
                HStack(spacing: 2) {
                    ForEach(items.prefix(3)) { item in
                        Circle().fill(item.tint).frame(width: 5, height: 5)
                    }
                }
                .frame(height: 5)
                .opacity(outside ? 0.4 : 1)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: "\(date.formatted(.dateTime.weekday(.wide).day().month(.wide))), \(items.count)"))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
