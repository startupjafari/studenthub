import SwiftUI

/// Расписание: неделя полосой дней, под ней — пары выбранного дня.
///
/// Неделя сеткой, как в вебе, на телефоне не читается: семь колонок по восемь пар
/// превращаются в мозаику. Поэтому день выбирается сверху, а пары идут списком.
struct ScheduleView: View {
    @State private var model = ScheduleModel()

    var body: some View {
        VStack(spacing: 0) {
            DayStrip(selected: model.selectedDay) { model.select(day: $0) }

            List {
                if let failure = model.failure {
                    FormAlert(message: failure)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }

                ForEach(model.visiblePairs) { item in
                    NavigationLink(value: AppRoute.lesson(id: item.id)) {
                        PairRow(item: item)
                    }
                    .listRowBackground(Palette.card)
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
            .scrollContentBackground(.hidden)
            .refreshable { await model.refresh() }
        }
        .background(Palette.background)
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
    }
}

/// Полоса дней недели.
private struct DayStrip: View {
    let selected: Int
    let onSelect: (Int) -> Void

    private static let titles = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

    var body: some View {
        HStack(spacing: Spacing.sm) {
            ForEach(1...7, id: \.self) { day in
                Button {
                    onSelect(day)
                } label: {
                    Text(verbatim: Self.titles[day - 1])
                        .font(Typography.meta)
                        .frame(maxWidth: .infinity)
                        .frame(height: ControlHeight.md)
                        .background(
                            day == selected ? Palette.primary.opacity(0.1) : Palette.muted,
                            in: RoundedRectangle(cornerRadius: Radius.md)
                        )
                        .foregroundStyle(day == selected ? Palette.primary : Palette.mutedForeground)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.md)
        .background(Palette.background)
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
