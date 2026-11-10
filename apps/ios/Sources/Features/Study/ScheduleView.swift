import SwiftUI

/// Расписание в духе «Календаря» iOS: сверху полоса дней-капсул, под ней — пары
/// выбранного дня блоками с временем слева. Идущая сейчас пара подсвечена, прошедшие
/// приглушены, между парами — перерывы.
///
/// Неделя сеткой, как в вебе, на телефоне не читается: семь колонок по восемь пар
/// превращаются в мозаику. Поэтому режим «Неделя» — список по дням, как вид «Список»
/// в «Календаре».
struct ScheduleView: View {
    @State private var model = ScheduleModel()
    @State private var mode: Mode = .day
    @State private var week: [(day: Int, date: Date, pairs: [SchedulePair])]?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    enum Mode: Hashable { case day, week }

    var body: some View {
        Group {
            if mode == .day {
                dayList
            } else {
                weekList
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) { header }
        .background(Palette.plainBackground)
        .navigationTitle(Text(MoreSection.schedule.title))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    withAnimation(Motion.respecting(.snappy(duration: 0.3), reduceMotion: reduceMotion)) {
                        mode = mode == .day ? .week : .day
                    }
                } label: {
                    Image(systemName: mode == .day ? "list.bullet.below.rectangle" : "calendar.day.timeline.left")
                }
                .accessibilityLabel(Text(mode == .day
                    ? String(localized: "schedule.mode.week", defaultValue: "Неделя")
                    : String(localized: "schedule.mode.day", defaultValue: "День")))
                .accessibilityIdentifier("schedule.mode")
            }
        }
        .task {
            model.start()
            await model.refresh()
        }
        // Неделя читается и в режиме «День»: по ней под числами полосы стоят точки
        // дней, в которые есть пары.
        .task(id: WeekKey(start: model.weekStart, parity: model.parity, synced: model.syncedAt)) {
            week = await model.weekPairs()
        }
    }

    private struct WeekKey: Equatable {
        let start: Date
        let parity: WeekParity
        let synced: Date?
    }

    // MARK: Шапка

    /// Месяц и чётность, переключатель недели и полоса дней — непрозрачной полосой под
    /// панелью навигации, список уходит под неё.
    private var header: some View {
        VStack(spacing: Spacing.sm) {
            HStack(spacing: Spacing.md) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(model.weekStart, format: .dateTime.month(.wide).year())
                        .font(.headline)
                        .foregroundStyle(Palette.foreground)
                    Text(model.parity == .odd
                        ? String(localized: "schedule.oddWeekFull", defaultValue: "Нечётная неделя")
                        : String(localized: "schedule.evenWeekFull", defaultValue: "Чётная неделя"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                }
                .accessibilityElement(children: .combine)
                Spacer(minLength: Spacing.md)
                if !isShowingToday {
                    Button(String(localized: "schedule.today", defaultValue: "Сегодня")) { goToToday() }
                        .font(.subheadline.weight(.semibold))
                        .buttonStyle(.borderless)
                }
                weekSwitch
            }
            .padding(.horizontal, Spacing.xl)

            if mode == .day {
                ScheduleDayStrip(
                    selected: model.selectedDay,
                    weekStart: model.weekStart,
                    busyDays: Set((week ?? []).map(\.day))
                ) { day in
                    withAnimation(Motion.respecting(.snappy(duration: 0.25), reduceMotion: reduceMotion)) {
                        model.select(day: day)
                    }
                }
                .padding(.horizontal, Spacing.md)
            }
        }
        .padding(.top, Spacing.xs)
        .padding(.bottom, Spacing.md)
        .background(Palette.plainBackground)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Palette.border)
                .frame(height: 0.5)
                .accessibilityHidden(true)
        }
    }

    /// Показаны две недели — текущая и следующая; стрелки переключают между ними.
    private var weekSwitch: some View {
        HStack(spacing: 0) {
            Button {
                model.toggleParity()
            } label: {
                Image(systemName: "chevron.left")
                    .frame(width: 36, height: 36)
                    .contentShape(Rectangle())
            }
            .disabled(model.weekOffset == 0)
            .accessibilityLabel(Text(String(localized: "schedule.thisWeek", defaultValue: "Эта неделя")))
            Button {
                model.toggleParity()
            } label: {
                Image(systemName: "chevron.right")
                    .frame(width: 36, height: 36)
                    .contentShape(Rectangle())
            }
            .disabled(model.weekOffset == 1)
            .accessibilityLabel(Text(String(localized: "schedule.nextWeek", defaultValue: "Следующая неделя")))
        }
        .font(.body.weight(.semibold))
        .buttonStyle(.borderless)
    }

    private var isShowingToday: Bool {
        model.weekOffset == 0 && model.selectedDay == ScheduleModel.isoDay(of: Date(), calendar: .current)
    }

    private func goToToday() {
        withAnimation(Motion.respecting(.snappy(duration: 0.3), reduceMotion: reduceMotion)) {
            if model.weekOffset != 0 { model.toggleParity() }
            model.select(day: ScheduleModel.isoDay(of: Date(), calendar: .current))
        }
    }

    // MARK: День

    private var dayList: some View {
        // Раз в минуту — чтобы подсветка «идёт сейчас» сама переезжала на следующую пару.
        TimelineView(.periodic(from: .now, by: 60)) { context in
            let pairs = model.visiblePairs
            let isToday = Calendar.current.isDateInToday(model.selectedDate)
            let clock = ScheduleModel.clock(of: context.date, calendar: .current)
            List {
                // Без единой синхронизации и без пар сбой занимает экран целиком (ниже),
                // полоса над ним была бы повтором.
                if let failure = model.failure, !(pairs.isEmpty && model.syncedAt == nil) {
                    StaleDataBanner(message: failure, isOffline: model.isOffline) { await model.refresh() }
                        .listRowInsets(EdgeInsets(top: Spacing.md, leading: Spacing.xl, bottom: Spacing.md, trailing: Spacing.xl))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }

                ForEach(Array(pairs.enumerated()), id: \.element.id) { index, item in
                    if index > 0, let gap = Self.breakMinutes(after: pairs[index - 1], before: item), gap > 0 {
                        ScheduleBreakRow(minutes: gap)
                            .listRowInsets(Self.rowInsets)
                            .listRowSeparator(.hidden)
                            .listRowBackground(Color.clear)
                    }
                    let phase: ScheduleEventPhase = isToday ? Self.phase(of: item, clock: clock) : .upcoming
                    pairLink(item, date: model.selectedDate, phase: phase)
                }

                if let syncedAt = model.syncedAt, !pairs.isEmpty {
                    syncedFooter(syncedAt)
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .overlay {
                if pairs.isEmpty {
                    emptyDay
                }
            }
            .refreshable { await model.refresh() }
        }
    }

    /// Пустой день. Пока расписание ни разу не пришло, пустота — не «пар нет»: первая
    /// синхронизация ещё идёт или не удалась.
    @ViewBuilder
    private var emptyDay: some View {
        if model.syncedAt == nil, let failure = model.failure {
            ErrorStateView(message: failure, isOffline: model.isOffline) { await model.refresh() }
        } else if model.syncedAt == nil, model.isRefreshing {
            LoadingStateView()
        } else {
            EmptyStateView(
                title: String(localized: "schedule.empty", defaultValue: "В этот день пар нет"),
                symbol: "sun.max",
                hint: model.syncedAt.map {
                    String(localized: "schedule.syncedAt", defaultValue: "Обновлено \($0.formatted(date: .abbreviated, time: .shortened))")
                }
            )
        }
    }

    // MARK: Неделя

    /// Неделя целиком: дни с парами, свободные пропущены — как в бумажном расписании.
    private var weekList: some View {
        let clock = ScheduleModel.clock(of: Date(), calendar: .current)
        // Расписание ни разу не пришло, а показать нечего.
        let blankBeforeSync = (week?.isEmpty ?? true) && model.syncedAt == nil
        return List {
            if let failure = model.failure, !blankBeforeSync {
                StaleDataBanner(message: failure, isOffline: model.isOffline) { await model.refresh() }
                    .listRowInsets(EdgeInsets(top: Spacing.md, leading: Spacing.xl, bottom: Spacing.md, trailing: Spacing.xl))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            if let week {
                ForEach(week, id: \.day) { entry in
                    let isToday = Calendar.current.isDateInToday(entry.date)
                    Section {
                        ForEach(entry.pairs) { item in
                            pairLink(item, date: entry.date, phase: isToday ? Self.phase(of: item, clock: clock) : .upcoming)
                        }
                    } header: {
                        ScheduleWeekDayHeader(date: entry.date, isToday: isToday)
                    }
                }
                if let syncedAt = model.syncedAt, !week.isEmpty {
                    syncedFooter(syncedAt)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .overlay {
            // Как и в дне: до первой синхронизации пустая неделя — загрузка или сбой.
            if blankBeforeSync, let failure = model.failure {
                ErrorStateView(message: failure, isOffline: model.isOffline) { await model.refresh() }
            } else if blankBeforeSync, model.isRefreshing {
                LoadingStateView()
            } else if let week, week.isEmpty {
                EmptyStateView(
                    title: String(localized: "schedule.weekEmpty", defaultValue: "На этой неделе пар нет"),
                    symbol: "calendar"
                )
            } else if week == nil {
                LoadingStateView()
            }
        }
        .refreshable {
            await model.refresh()
            week = await model.weekPairs()
        }
    }

    // MARK: Общее

    static let rowInsets = EdgeInsets(top: Spacing.xs, leading: Spacing.xl, bottom: Spacing.xs, trailing: Spacing.xl)

    /// Блок пары без шеврона: переход по нажатию на весь блок, как событие в «Календаре».
    private func pairLink(_ item: SchedulePair, date: Date, phase: ScheduleEventPhase) -> some View {
        ZStack {
            NavigationLink(value: AppRoute.lesson(id: item.id, date: date)) { EmptyView() }
                .opacity(0)
            ScheduleEventRow(item: item, phase: phase)
        }
        .listRowInsets(Self.rowInsets)
        .listRowSeparator(.hidden)
        .listRowBackground(Color.clear)
    }

    private func syncedFooter(_ date: Date) -> some View {
        Text(String(
            localized: "schedule.syncedAt",
            defaultValue: "Обновлено \(date.formatted(date: .abbreviated, time: .shortened))"
        ))
        .font(Typography.meta)
        .foregroundStyle(Palette.mutedForeground)
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.md)
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
    }

    /// Где пара относительно «сейчас»: время «HH:mm» сравнивается строкой.
    private static func phase(of item: SchedulePair, clock: String) -> ScheduleEventPhase {
        if item.endTime <= clock { return .past }
        if item.startTime <= clock { return .now }
        return .upcoming
    }

    /// Минуты между концом одной пары и началом следующей.
    private static func breakMinutes(after previous: SchedulePair, before next: SchedulePair) -> Int? {
        guard let end = minutes(previous.endTime), let start = minutes(next.startTime) else { return nil }
        return start - end
    }

    private static func minutes(_ clock: String) -> Int? {
        let parts = clock.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return nil }
        return parts[0] * 60 + parts[1]
    }
}

// MARK: - Полоса дней

/// Неделя капсулами, как в «Календаре»: буква дня недели и число в круге. Выбранный
/// день залит, сегодня — синим числом, под днями с парами — точка.
private struct ScheduleDayStrip: View {
    let selected: Int
    let weekStart: Date
    let busyDays: Set<Int>
    let onSelect: (Int) -> Void

    var body: some View {
        HStack(spacing: 0) {
            ForEach(1...7, id: \.self) { day in
                let date = Calendar.current.date(byAdding: .day, value: day - 1, to: weekStart) ?? weekStart
                Button {
                    onSelect(day)
                } label: {
                    ScheduleDayCell(date: date, weekday: day, isSelected: day == selected, hasDot: busyDays.contains(day))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(date, format: .dateTime.weekday(.wide).day().month()))
                .accessibilityAddTraits(day == selected ? .isSelected : [])
            }
        }
        .sensoryFeedback(.selection, trigger: selected)
    }
}

/// Неделя капсулами с переходом по неделям — выбор даты для журналов и правки
/// расписания: тот же вид, что у полосы расписания, но дата любая.
struct ScheduleDateStrip: View {
    @Binding var selection: Date
    /// Дни с отметкой-точкой (например, есть занятия).
    var hasDot: (Date) -> Bool = { _ in false }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var calendar: Calendar { .current }

    private var weekStart: Date {
        let day = calendar.startOfDay(for: selection)
        let iso = ScheduleModel.isoDay(of: day, calendar: calendar)
        return calendar.date(byAdding: .day, value: 1 - iso, to: day) ?? day
    }

    var body: some View {
        VStack(spacing: Spacing.sm) {
            HStack(spacing: Spacing.xs) {
                Text(selection, format: .dateTime.month(.wide).year())
                    .font(.headline)
                    .foregroundStyle(Palette.foreground)
                Spacer(minLength: Spacing.md)
                if !calendar.isDateInToday(selection) {
                    Button(String(localized: "schedule.today", defaultValue: "Сегодня")) { select(Date()) }
                        .font(.subheadline.weight(.semibold))
                        .padding(.trailing, Spacing.sm)
                }
                Button {
                    move(weeks: -1)
                } label: {
                    Image(systemName: "chevron.left").frame(width: 36, height: 36).contentShape(Rectangle())
                }
                .accessibilityLabel(Text(String(localized: "schedule.prevWeekAny", defaultValue: "Предыдущая неделя")))
                Button {
                    move(weeks: 1)
                } label: {
                    Image(systemName: "chevron.right").frame(width: 36, height: 36).contentShape(Rectangle())
                }
                .accessibilityLabel(Text(String(localized: "schedule.nextWeek", defaultValue: "Следующая неделя")))
            }
            .font(.body.weight(.semibold))
            .buttonStyle(.borderless)

            HStack(spacing: 0) {
                ForEach(1...7, id: \.self) { day in
                    let date = calendar.date(byAdding: .day, value: day - 1, to: weekStart) ?? weekStart
                    let isSelected = calendar.isDate(date, inSameDayAs: selection)
                    Button {
                        select(date)
                    } label: {
                        ScheduleDayCell(date: date, weekday: day, isSelected: isSelected, hasDot: hasDot(date))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(date, format: .dateTime.weekday(.wide).day().month()))
                    .accessibilityAddTraits(isSelected ? .isSelected : [])
                }
            }
        }
        .sensoryFeedback(.selection, trigger: calendar.startOfDay(for: selection))
    }

    private func select(_ date: Date) {
        withAnimation(Motion.respecting(.snappy(duration: 0.25), reduceMotion: reduceMotion)) {
            selection = date
        }
    }

    private func move(weeks: Int) {
        select(calendar.date(byAdding: .day, value: 7 * weeks, to: selection) ?? selection)
    }
}

/// День в полосе: буква дня недели, число в круге, точка под ним.
private struct ScheduleDayCell: View {
    let date: Date
    /// 1 — понедельник, 7 — воскресенье.
    let weekday: Int
    let isSelected: Bool
    let hasDot: Bool

    @ScaledMetric(relativeTo: .body) private var circle: CGFloat = 38

    /// Подписи дней — из календаря системы, на языке приложения, с понедельника.
    private static let titles: [String] = {
        let symbols = Calendar.current.veryShortStandaloneWeekdaySymbols
        return Array(symbols[1...] + symbols[..<1])
    }()

    var body: some View {
        let isToday = Calendar.current.isDateInToday(date)
        let isWeekend = weekday >= 6
        VStack(spacing: Spacing.xs) {
            Text(verbatim: Self.titles[weekday - 1])
                .font(.caption2.weight(.semibold))
                .foregroundStyle(weekdayColor(isToday: isToday, isWeekend: isWeekend))
            Text(date, format: .dateTime.day())
                .font(Typography.tabular(.body.weight(isSelected || isToday ? .semibold : .regular)))
                .foregroundStyle(numberColor(isToday: isToday, isWeekend: isWeekend))
                .frame(width: min(circle, 52), height: min(circle, 52))
                .background {
                    if isSelected {
                        Circle().fill(isToday ? Palette.primary : Palette.foreground)
                    }
                }
            Circle()
                .fill(hasDot && !isSelected ? Palette.mutedForeground.opacity(0.6) : Color.clear)
                .frame(width: 5, height: 5)
        }
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
    }

    private func weekdayColor(isToday: Bool, isWeekend: Bool) -> Color {
        if isToday { return Palette.primary }
        return isWeekend ? Palette.mutedForeground.opacity(0.7) : Palette.mutedForeground
    }

    private func numberColor(isToday: Bool, isWeekend: Bool) -> Color {
        if isSelected { return Color(uiColor: .systemBackground) }
        if isToday { return Palette.primary }
        return isWeekend ? Palette.mutedForeground : Palette.foreground
    }
}

// MARK: - Пара

private enum ScheduleEventPhase { case past, now, upcoming }

/// Пара блоком, как событие в «Календаре»: время слева столбцом, справа — цветная
/// полоса дисциплины, название, аудитория и преподаватель, пометка об изменении.
private struct ScheduleEventRow: View {
    let item: SchedulePair
    let phase: ScheduleEventPhase

    @ScaledMetric(relativeTo: .subheadline) private var timeWidth: CGFloat = 46

    var body: some View {
        let tint = item.isCancelled ? Color.gray : ScheduleSubjectTint.color(for: item.pair.subject)
        HStack(alignment: .top, spacing: Spacing.lg) {
            VStack(alignment: .trailing, spacing: 2) {
                Text(verbatim: item.startTime)
                    .font(Typography.tabular(.subheadline.weight(.semibold)))
                    .foregroundStyle(phase == .now ? Palette.primary : Palette.foreground)
                Text(verbatim: item.endTime)
                    .font(Typography.tabular(.footnote))
                    .foregroundStyle(Palette.mutedForeground)
            }
            .frame(width: min(timeWidth, 72), alignment: .trailing)
            .padding(.top, Spacing.md)

            HStack(alignment: .top, spacing: Spacing.md) {
                Capsule()
                    .fill(tint)
                    .frame(width: 4)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                        Text(item.pair.subject)
                            .font(.body.weight(.semibold))
                            .foregroundStyle(item.isCancelled ? Palette.mutedForeground : Palette.foreground)
                            .strikethrough(item.isCancelled)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                        if phase == .now, !item.isCancelled {
                            StatusBadge(text: String(localized: "schedule.now", defaultValue: "Сейчас"), tint: Palette.primary)
                        }
                    }
                    if let room = item.pair.roomName, !room.isEmpty {
                        Label(room, systemImage: "mappin.and.ellipse")
                            .font(.subheadline)
                            .foregroundStyle(Palette.mutedForeground)
                            .lineLimit(1)
                    }
                    if let teacher = item.pair.teacherName, !teacher.isEmpty {
                        Label(teacher, systemImage: "person")
                            .font(.subheadline)
                            .foregroundStyle(Palette.mutedForeground)
                            .lineLimit(1)
                    }
                    if let note = item.changeNote {
                        Label(note, systemImage: item.isCancelled ? "xmark.circle.fill" : "exclamationmark.circle.fill")
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(item.isCancelled ? Palette.destructive : Palette.warning)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .labelStyle(ScheduleCompactLabelStyle())
            }
            .padding(.vertical, Spacing.md)
            .padding(.leading, Spacing.md)
            .padding(.trailing, Spacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                tint.opacity(phase == .now ? 0.2 : 0.1),
                in: RoundedRectangle(cornerRadius: Radius.xl, style: .continuous)
            )
            .overlay {
                if phase == .now {
                    RoundedRectangle(cornerRadius: Radius.xl, style: .continuous)
                        .strokeBorder(tint.opacity(0.6), lineWidth: 1.5)
                }
            }
        }
        .opacity(phase == .past ? 0.55 : 1)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}

/// Иконка мельче текста и вплотную — строки блока пары читаются как подписи, а не пункты.
private struct ScheduleCompactLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.xs) {
            configuration.icon
                .font(.caption)
                .accessibilityHidden(true)
            configuration.title
        }
    }
}

/// Перерыв между парами — тонкой строкой, как свободное окно в «Календаре».
private struct ScheduleBreakRow: View {
    let minutes: Int

    var body: some View {
        HStack(spacing: Spacing.md) {
            Rectangle().fill(Palette.border).frame(height: 0.5)
            Text(String(localized: "schedule.break", defaultValue: "Перерыв \(minutes.formatted()) мин"))
                .font(.caption)
                .foregroundStyle(Palette.mutedForeground)
                .fixedSize()
            Rectangle().fill(Palette.border).frame(height: 0.5)
        }
        .padding(.vertical, 2)
    }
}

/// Заголовок дня в режиме «Неделя»: день недели крупно, сегодня — синим.
private struct ScheduleWeekDayHeader: View {
    let date: Date
    let isToday: Bool

    var body: some View {
        HStack(spacing: Spacing.sm) {
            Text(date, format: .dateTime.weekday(.wide).day().month())
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(isToday ? Palette.primary : Palette.foreground)
                .textCase(nil)
            if isToday {
                StatusBadge(text: String(localized: "schedule.today", defaultValue: "Сегодня"), tint: Palette.primary)
            }
        }
        .accessibilityAddTraits(.isHeader)
    }
}

/// Цвет дисциплины: одна и та же дисциплина всю неделю одного цвета — по нему пару
/// находят глазами. Хэш свой, а не `hashValue`: тот меняется от запуска к запуску.
enum ScheduleSubjectTint {
    private static let palette: [Color] = [
        TileTint.blue, TileTint.indigo, TileTint.purple, TileTint.teal,
        TileTint.orange, TileTint.pink, TileTint.green,
    ]

    static func color(for subject: String) -> Color {
        var sum: Int = 0
        for scalar in subject.lowercased().unicodeScalars {
            sum = (sum &* 31 &+ Int(scalar.value)) & 0x7FFF_FFFF
        }
        return palette[sum % palette.count]
    }
}
