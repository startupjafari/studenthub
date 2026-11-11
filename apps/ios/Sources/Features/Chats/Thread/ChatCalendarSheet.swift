import SwiftUI

/// Календарь «Перейти к дате», как в Telegram: месяц сеткой, в кружке дня — снимок,
/// присланный в этот день, будущее закрыто. Нажатие на число сразу ведёт к дате:
/// дата здесь — действие, а не значение формы, и кнопка «Готово» была бы лишним шагом.
struct ChatCalendarSheet: View {
    let chatID: String
    let onPick: (Date) -> Void

    @Environment(\.dismiss) private var dismiss
    /// Первое число открытого месяца.
    @State private var month: Date
    /// День, с которого открыли календарь (дата в ленте), — он отмечен.
    private let marked: Date
    /// Миниатюры по местной дате `YYYY-MM-DD`; месяцы, уже спрошенные у сервера.
    @State private var thumbs: [String: String] = [:]
    @State private var loadedMonths: Set<Date> = []
    @ScaledMetric(relativeTo: .body) private var cellSize: CGFloat = 40
    private let api: ChatActing = ChatsAPI()

    private static let calendar = Calendar.current

    init(chatID: String, initialDay: Date = Date(), onPick: @escaping (Date) -> Void) {
        self.chatID = chatID
        self.onPick = onPick
        let day = min(Self.calendar.startOfDay(for: initialDay), Self.calendar.startOfDay(for: Date()))
        marked = day
        _month = State(initialValue: Self.monthStart(day))
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: Spacing.lg) {
                monthHeader
                grid
                Spacer(minLength: 0)
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.top, Spacing.md)
            .navigationTitle(Text(String(localized: "chats.calendar.title", defaultValue: "Перейти к дате")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
            }
            .task(id: month) { await loadThumbs(for: month) }
        }
        .presentationDetents([.medium, .large])
    }

    // MARK: Шапка месяца

    private var monthHeader: some View {
        HStack(spacing: Spacing.xs) {
            Text(month, format: .dateTime.month(.wide).year())
                .font(.title3.weight(.semibold))
                .foregroundStyle(Palette.foreground)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: Spacing.md)
            Button {
                shift(-1)
            } label: {
                Image(systemName: "chevron.left")
                    .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel(Text(String(localized: "student.calendar.prev", defaultValue: "Предыдущий месяц")))
            Button {
                shift(1)
            } label: {
                Image(systemName: "chevron.right")
                    .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                    .contentShape(Rectangle())
            }
            // Дальше текущего месяца сообщений нет заведомо.
            .disabled(isLatestMonth)
            .accessibilityLabel(Text(String(localized: "student.calendar.next", defaultValue: "Следующий месяц")))
        }
        .font(.body.weight(.semibold))
        .buttonStyle(.borderless)
        .foregroundStyle(Palette.primary)
    }

    private var isLatestMonth: Bool {
        Self.calendar.isDate(month, equalTo: Date(), toGranularity: .month)
    }

    private func shift(_ delta: Int) {
        guard let next = Self.calendar.date(byAdding: .month, value: delta, to: month) else { return }
        month = min(next, Self.monthStart(Date()))
    }

    // MARK: Сетка

    /// Понедельник первым — как во всех календарях приложения.
    private static let weekdays: [String] = {
        let symbols = calendar.veryShortStandaloneWeekdaySymbols
        return Array(symbols[1...] + symbols[..<1])
    }()

    private var grid: some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: 7)
        return LazyVGrid(columns: columns, spacing: Spacing.sm) {
            ForEach(Array(Self.weekdays.enumerated()), id: \.offset) { _, title in
                Text(verbatim: title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Palette.mutedForeground)
            }
            ForEach(Array(cells.enumerated()), id: \.offset) { _, day in
                if let day {
                    cell(day)
                } else {
                    Color.clear.frame(height: min(cellSize, 52))
                }
            }
        }
    }

    /// Дни месяца с пустыми клетками до первого числа.
    private var cells: [Date?] {
        let calendar = Self.calendar
        guard let range = calendar.range(of: .day, in: .month, for: month) else { return [] }
        let lead = (calendar.component(.weekday, from: month) + 5) % 7
        let days = range.compactMap { calendar.date(byAdding: .day, value: $0 - 1, to: month) }
        return Array(repeating: nil, count: lead) + days
    }

    private func cell(_ day: Date) -> some View {
        let calendar = Self.calendar
        let isFuture = day > calendar.startOfDay(for: Date())
        let isMarked = calendar.isDate(day, inSameDayAs: marked)
        let isToday = calendar.isDateInToday(day)
        let thumb = thumbs[Self.key(day)]
        let size = min(cellSize, 52)
        return Button {
            onPick(day)
            dismiss()
        } label: {
            ZStack {
                if isMarked {
                    Circle().fill(Palette.primary)
                } else if let thumb, let url = URL(string: thumb) {
                    // Снимок дня — фоном под числом, приглушённо: число должно читаться.
                    RemoteImage(url: url, cacheKey: "chat-calendar:\(chatID):\(Self.key(day))", maxPixelSize: size * 3)
                        .overlay(Color.black.opacity(0.4))
                        .clipShape(Circle())
                }
                Text(verbatim: String(calendar.component(.day, from: day)))
                    .font(Typography.tabular(.body.weight(isMarked || isToday ? .semibold : .regular)))
                    .foregroundStyle(numberColor(isMarked: isMarked, hasThumb: thumb != nil, isToday: isToday))
            }
            .frame(width: size, height: size)
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isFuture)
        .opacity(isFuture ? 0.3 : 1)
        .accessibilityLabel(Text(day, format: .dateTime.day().month(.wide).year()))
        .accessibilityAddTraits(isMarked ? .isSelected : [])
    }

    private func numberColor(isMarked: Bool, hasThumb: Bool, isToday: Bool) -> Color {
        if isMarked { return Palette.primaryForeground }
        if hasThumb { return .white }
        return isToday ? Palette.primary : Palette.foreground
    }

    // MARK: Миниатюры

    /// Снимки ровно открытого месяца — так же, как в вебе. Сбой не мешает: календарь
    /// работает и без кружков со снимками.
    private func loadThumbs(for month: Date) async {
        guard !loadedMonths.contains(month),
            let next = Self.calendar.date(byAdding: .month, value: 1, to: month)
        else { return }
        let end = next.addingTimeInterval(-0.001)
        guard let days = try? await api.mediaCalendar(chatID: chatID, from: month, to: end) else { return }
        loadedMonths.insert(month)
        for day in days {
            thumbs[day.day] = day.url
        }
    }

    private static func monthStart(_ date: Date) -> Date {
        calendar.date(from: calendar.dateComponents([.year, .month], from: date)) ?? date
    }

    /// Местная дата `YYYY-MM-DD` — ключ дня в ответе сервера.
    private static func key(_ day: Date) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: day)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }
}
