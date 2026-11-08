import SwiftUI

/// Расписание: неделя полосой дней, под ней — пары выбранного дня.
///
/// Неделя сеткой, как в вебе, на телефоне не читается: семь колонок по восемь пар
/// превращаются в мозаику. Поэтому день выбирается сверху, а пары идут списком.
struct ScheduleView: View {
    @State private var model = ScheduleModel()
    @State private var mode: Mode = .day
    @State private var week: [(day: Int, date: Date, pairs: [SchedulePair])]?

    enum Mode: Hashable { case day, week }

    var body: some View {
        VStack(spacing: 0) {
            Picker(String(localized: "schedule.mode", defaultValue: "Режим"), selection: $mode) {
                Text(String(localized: "schedule.mode.day", defaultValue: "День")).tag(Mode.day)
                Text(String(localized: "schedule.mode.week", defaultValue: "Неделя")).tag(Mode.week)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, Spacing.xl)
            .padding(.top, Spacing.sm)
            .accessibilityIdentifier("schedule.mode")

            if mode == .day {
                DayStrip(selected: model.selectedDay, weekStart: model.weekStart) { model.select(day: $0) }
                dayList
            } else {
                weekList
            }
        }
        .background(Palette.plainBackground)
        .navigationTitle(Text(AppTab.schedule.title))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    model.toggleParity()
                } label: {
                    Text(model.parity == .odd
                        ? String(localized: "schedule.oddWeek", defaultValue: "Нечётная")
                        : String(localized: "schedule.evenWeek", defaultValue: "Чётная"))
                        .font(Typography.meta)
                }
            }
        }
        .task {
            model.start()
            await model.refresh()
        }
        .task(id: WeekKey(mode: mode, start: model.weekStart, parity: model.parity, synced: model.syncedAt)) {
            guard mode == .week else { return }
            week = await model.weekPairs()
        }
    }

    private struct WeekKey: Equatable {
        let mode: Mode
        let start: Date
        let parity: WeekParity
        let synced: Date?
    }

    private var dayList: some View {
        List {
            if let failure = model.failure {
                FormAlert(message: failure)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            ForEach(model.visiblePairs) { item in
                NavigationLink(value: AppRoute.lesson(id: item.id, date: model.selectedDate)) {
                    PairRow(item: item)
                }
            }

            if model.visiblePairs.isEmpty {
                Text(String(localized: "schedule.empty", defaultValue: "В этот день пар нет"))
                    .font(Typography.body)
                    .foregroundStyle(Palette.mutedForeground)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Spacing.xxl)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            if let syncedAt = model.syncedAt {
                Text(String(
                    localized: "schedule.syncedAt",
                    defaultValue: "Обновлено \(syncedAt.formatted(date: .abbreviated, time: .shortened))"
                ))
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            }
        }
        .listStyle(.plain)
        .refreshable { await model.refresh() }
    }

    /// Неделя целиком: дни с парами, свободные пропущены — как в бумажном расписании.
    private var weekList: some View {
        List {
            if let week {
                if week.isEmpty {
                    EmptyStateView(
                        title: String(localized: "schedule.weekEmpty", defaultValue: "На этой неделе пар нет"),
                        symbol: "calendar"
                    )
                    .listRowBackground(Color.clear)
                }
                ForEach(week, id: \.day) { entry in
                    Section {
                        ForEach(entry.pairs) { item in
                            NavigationLink(value: AppRoute.lesson(id: item.id, date: entry.date)) {
                                PairRow(item: item)
                            }
                        }
                    } header: {
                        Text(entry.date, format: .dateTime.weekday(.wide).day().month())
                            .foregroundStyle(Calendar.current.isDateInToday(entry.date) ? Palette.primary : Palette.mutedForeground)
                    }
                }
            } else {
                LoadingStateView().listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .refreshable {
            await model.refresh()
            week = await model.weekPairs()
        }
    }
}

/// Полоса дней недели: день недели и число, сегодня отмечено точкой.
private struct DayStrip: View {
    let selected: Int
    let weekStart: Date
    let onSelect: (Int) -> Void

    /// Подписи дней — из календаря системы, на языке приложения, с понедельника.
    private static let titles: [String] = {
        let symbols = Calendar.current.shortStandaloneWeekdaySymbols
        return Array(symbols[1...] + symbols[..<1])
    }()

    var body: some View {
        HStack(spacing: Spacing.sm) {
            ForEach(1...7, id: \.self) { day in
                let date = Calendar.current.date(byAdding: .day, value: day - 1, to: weekStart) ?? weekStart
                let isToday = Calendar.current.isDateInToday(date)
                Button {
                    onSelect(day)
                } label: {
                    VStack(spacing: 2) {
                        Text(verbatim: Self.titles[day - 1])
                            .font(.caption2.weight(.medium))
                        Text(date, format: .dateTime.day())
                            .font(Typography.tabular(Typography.body.weight(day == selected ? .bold : .regular)))
                        Circle()
                            .fill(isToday ? Palette.primary : Color.clear)
                            .frame(width: 4, height: 4)
                    }
                    .frame(maxWidth: .infinity)
                    // Высота от содержимого, а не фиксированная: на крупных
                    // кеглях фиксированная обрезала бы подпись.
                    .padding(.vertical, Spacing.sm)
                    .background(
                        day == selected ? Palette.primary.opacity(0.12) : Palette.muted,
                        in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
                    )
                    .foregroundStyle(day == selected ? Palette.primary : Palette.foreground)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(date, format: .dateTime.weekday(.wide).day().month()))
                .accessibilityAddTraits(day == selected ? .isSelected : [])
            }
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.md)
        .background(Palette.plainBackground)
    }
}

/// Строка пары: время слева, предмет и место справа.
private struct PairRow: View {
    let item: SchedulePair

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.lg) {
            VStack(alignment: .leading, spacing: 0) {
                Text(verbatim: item.startTime)
                    .font(Typography.tabular(Typography.body))
                    .foregroundStyle(Palette.foreground)
                Text(verbatim: item.endTime)
                    .font(Typography.tabular(Typography.meta))
                    .foregroundStyle(Palette.mutedForeground)
            }
            .frame(width: 56, alignment: .leading)

            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(item.pair.subject)
                    .font(Typography.cardTitle)
                    .foregroundStyle(item.isCancelled ? Palette.mutedForeground : Palette.foreground)
                    .strikethrough(item.isCancelled)

                HStack(spacing: Spacing.md) {
                    if let teacher = item.pair.teacherName {
                        Label(teacher, systemImage: "person")
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    if let room = item.pair.roomName {
                        Label(room, systemImage: "mappin")
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                }

                if let note = item.changeNote {
                    Text(note)
                        .font(Typography.meta)
                        .foregroundStyle(Palette.warning)
                }
            }
        }
        .padding(.vertical, Spacing.sm)
        .accessibilityElement(children: .combine)
    }
}
