import SwiftUI

// Общий набор вкладки «Обзор» для всех ролей. Обзоры живут в своих областях, а подача —
// здесь, чтобы плитки, карточки графиков и строки «требует внимания» выглядели одинаково
// у декана, охраны и администратора платформы.
//
// Каркас — сгруппированный список: секции списка и есть карточки (на iOS 26 их радиус тот
// же, что у `Radius.card`), а плитки метрик лежат в строке без фона. Стекло — только у
// контролов (селектор периода, кнопки); карточки непрозрачные.

// MARK: - Список

extension View {
    /// Стиль списка обзора: сгруппированный, с плотными промежутками между секциями —
    /// на обзоре много коротких блоков, и стандартный зазор растягивает экран вдвое.
    ///
    /// Зазор между секциями — тот же шаг, что между плитками внутри сетки: переключатель,
    /// плитки и карточки графиков стоят ровной колонкой, без полос разной ширины. Сверху —
    /// тот же отступ от панели, что у остальных плотных списков (`compactListStyle`), а
    /// не системные 35 pt над первой секцией.
    func dashboardListStyle() -> some View {
        listStyle(.insetGrouped)
            .listSectionSpacing(DashboardMetrics.gap)
            .contentMargins(.top, Spacing.sm, for: .scrollContent)
    }
}

/// Заголовок секции обзора: строчными, полужирным, с пояснением ниже. Системный заголовок
/// капсом мельче заголовков карточек графиков и рядом с ними выглядел чужим.
struct DashboardSectionHeader: View {
    let title: String
    var subtitle: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.headline)
                .foregroundStyle(Palette.foreground)
                .accessibilityAddTraits(.isHeader)
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(.footnote)
                    .foregroundStyle(Palette.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .textCase(nil)
        .padding(.bottom, Spacing.xs)
    }
}

// MARK: - Плитки метрик

/// Показатель плитки. `value == nil` — данных нет (плитка скажет об этом словами, а не
/// прочерком); `isPending` — значение ещё грузится.
struct DashboardMetric: Identifiable {
    var id: String { title }
    let title: String
    var value: String?
    let symbol: String
    var tint: Color = Palette.primary
    var caption: String?
    var captionTint: Color?
    var route: AppRoute?
    var isPending = false
}

/// Значок в маленьком тонированном круге — общий для плиток и строк обзора.
struct DashboardIconBadge: View {
    let symbol: String
    var tint: Color = Palette.primary
    @ScaledMetric(relativeTo: .footnote) private var size: CGFloat = 30

    init(symbol: String, tint: Color = Palette.primary) {
        self.symbol = symbol
        self.tint = tint
    }

    var body: some View {
        Image(systemName: symbol)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(tint)
            .frame(width: size, height: size)
            .background(tint.opacity(0.15), in: Circle())
            .accessibilityHidden(true)
    }
}

/// Плитка метрики: значок, крупное число, подпись. Высоту задаёт ряд сетки — соседние
/// плитки всегда ровные, даже если у одной подпись в две строки.
struct DashboardMetricTile: View {
    let metric: DashboardMetric
    /// Высота строки крупного числа — растёт вместе с Dynamic Type.
    @ScaledMetric(relativeTo: .title2) private var valueLineHeight: CGFloat = 28

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(alignment: .top) {
                DashboardIconBadge(symbol: metric.symbol, tint: metric.tint)
                Spacer(minLength: Spacing.md)
                if metric.route != nil {
                    DashboardOpenBadge()
                }
            }
            valueText
            Text(metric.title)
                .font(.footnote)
                .foregroundStyle(Palette.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)
            if let caption = metric.caption, !caption.isEmpty {
                Text(caption)
                    .font(.caption)
                    .foregroundStyle(metric.captionTint ?? Palette.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(Spacing.lg)
        .frame(minHeight: 112)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: DashboardMetrics.tileRadius, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: DashboardMetrics.tileRadius, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(metric.title))
        .accessibilityValue(Text(accessibilityValue))
    }

    @ViewBuilder
    private var valueText: some View {
        if metric.isPending {
            // Системный индикатор на месте числа, а не серая заглушка.
            ProgressView()
                .frame(minHeight: valueLineHeight, alignment: .leading)
        } else if let value = metric.value {
            Text(verbatim: value)
                .font(DashboardMetrics.valueFont)
                .foregroundStyle(Palette.foreground)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        } else {
            // Строка той же высоты, что число: плитки без данных не «проседают» в ряду.
            Text(DashboardText.noData)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Palette.mutedForeground)
                .frame(minHeight: valueLineHeight, alignment: .leading)
        }
    }

    private var accessibilityValue: String {
        let value = metric.isPending
            ? String(localized: "common.loading", defaultValue: "Загрузка")
            : (metric.value ?? DashboardText.noData)
        guard let caption = metric.caption, !caption.isEmpty else { return value }
        return "\(value), \(caption)"
    }
}

/// Знак «открывается» в углу плитки: стрелка в круге. Бледный шеврон у края плитки
/// читался как случайная чёрточка у соседнего столбца, а не как переход.
struct DashboardOpenBadge: View {
    @ScaledMetric(relativeTo: .footnote) private var size: CGFloat = 24

    var body: some View {
        Image(systemName: "arrow.up.right")
            .font(.caption.weight(.bold))
            .foregroundStyle(Palette.mutedForeground)
            .frame(width: size, height: size)
            .background(Palette.foreground.opacity(0.08), in: Circle())
            .accessibilityHidden(true)
    }
}

/// Сетка плиток: два столбца, ряды выровнены по самой высокой плитке. На крупных
/// размерах шрифта — один столбец: в половине ширины подписи рвались бы по слогам.
/// Непарная последняя плитка занимает ряд целиком.
struct DashboardTileGrid<Item: Identifiable, Tile: View>: View {
    let items: [Item]
    @ViewBuilder let tile: (Item) -> Tile

    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let columns = typeSize.isAccessibilitySize ? 1 : 2
        let rows = stride(from: 0, to: items.count, by: columns).map { start in
            Array(items[start..<min(start + columns, items.count)])
        }
        VStack(spacing: DashboardMetrics.gap) {
            ForEach(rows.indices, id: \.self) { index in
                HStack(alignment: .top, spacing: DashboardMetrics.gap) {
                    ForEach(rows[index]) { item in
                        tile(item)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// Сетка метрик; плитка с маршрутом ведёт на свой раздел.
struct DashboardMetricGrid: View {
    let metrics: [DashboardMetric]

    var body: some View {
        DashboardTileGrid(items: metrics) { metric in
            if let route = metric.route {
                DashboardRouteButton(route: route) {
                    DashboardMetricTile(metric: metric)
                }
            } else {
                DashboardMetricTile(metric: metric)
            }
        }
    }
}

/// Переход с плитки в строке списка. Кнопка, а не `NavigationLink`: ссылку в строке
/// `List` система помечает своим шевроном — он вставал снаружи каждой плитки, справа
/// от столбца, вторым знаком рядом со стрелкой в углу.
struct DashboardRouteButton<Content: View>: View {
    let route: AppRoute
    @ViewBuilder let label: () -> Content

    var body: some View {
        Button {
            let router = AppServices.router
            router.push(route)
        } label: {
            label()
        }
        // В строке списка без своего стиля нажатие уходило бы всей строке, а не плитке.
        .buttonStyle(.plain)
    }
}

/// Секция списка с плитками: без фона строки и без отступов — плитки сами карточки.
struct DashboardMetricsSection: View {
    let metrics: [DashboardMetric]
    var title: String?
    var subtitle: String?

    var body: some View {
        if let title {
            Section {
                grid
            } header: {
                DashboardSectionHeader(title: title, subtitle: subtitle)
            }
        } else {
            Section { grid }
        }
    }

    /// Пока не пришло ни одного показателя — один индикатор по центру блока, а не
    /// сетка плиток-заглушек. Высота — как у двух рядов плиток: экран не прыгает, когда
    /// числа приходят.
    @ViewBuilder
    private var grid: some View {
        Group {
            if !metrics.isEmpty, metrics.allSatisfy(\.isPending) {
                ProgressView()
                    .frame(maxWidth: .infinity, minHeight: 112 * 2 + DashboardMetrics.gap)
            } else {
                DashboardMetricGrid(metrics: metrics)
            }
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets())
    }
}

/// Плитка быстрого перехода: значок и название раздела.
struct DashboardShortcut: Identifiable {
    var id: String { title }
    let title: String
    let symbol: String
    var tint: Color = Palette.primary
    let route: AppRoute
}

/// Секция быстрых переходов — плитки той же формы, что метрики.
struct DashboardShortcutsSection: View {
    let shortcuts: [DashboardShortcut]
    var title: String?

    var body: some View {
        if let title {
            Section {
                grid
            } header: {
                DashboardSectionHeader(title: title)
            }
        } else {
            Section { grid }
        }
    }

    private var grid: some View {
        DashboardTileGrid(items: shortcuts) { shortcut in
            DashboardRouteButton(route: shortcut.route) {
                HStack(spacing: Spacing.md) {
                    DashboardIconBadge(symbol: shortcut.symbol, tint: shortcut.tint)
                    Text(shortcut.title)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Palette.foreground)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .padding(Spacing.lg)
                .background(Palette.card, in: RoundedRectangle(cornerRadius: DashboardMetrics.tileRadius, style: .continuous))
                .contentShape(RoundedRectangle(cornerRadius: DashboardMetrics.tileRadius, style: .continuous))
                .accessibilityElement(children: .combine)
            }
            .buttonStyle(.plain)
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets())
    }
}

// MARK: - Карточки графиков

/// Содержимое карточки: заголовок, пояснение, график или состояние. Кладётся строкой в
/// секцию списка — секция и есть карточка.
struct DashboardCard<Content: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.headline)
                    .foregroundStyle(Palette.foreground)
                    .accessibilityAddTraits(.isHeader)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.footnote)
                        .foregroundStyle(Palette.mutedForeground)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, Spacing.sm)
    }
}

/// Секция-карточка; строки после карточки (`footer`) — переходы «Открыть всё».
struct DashboardCardSection<Content: View, Footer: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder let content: () -> Content
    @ViewBuilder let footer: () -> Footer

    init(
        title: String,
        subtitle: String? = nil,
        @ViewBuilder content: @escaping () -> Content,
        @ViewBuilder footer: @escaping () -> Footer
    ) {
        self.title = title
        self.subtitle = subtitle
        self.content = content
        self.footer = footer
    }

    var body: some View {
        Section {
            DashboardCard(title: title, subtitle: subtitle, content: content)
            footer()
        }
    }
}

extension DashboardCardSection where Footer == EmptyView {
    init(title: String, subtitle: String? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.init(title: title, subtitle: subtitle, content: content, footer: { EmptyView() })
    }
}

/// Загрузка внутри карточки: высота как у графика, чтобы экран не прыгал.
struct DashboardLoadingPlaceholder: View {
    var height: CGFloat = DashboardMetrics.chartHeight

    var body: some View {
        ProgressView()
            .frame(maxWidth: .infinity, minHeight: height)
            .accessibilityLabel(Text(String(localized: "common.loading", defaultValue: "Загрузка")))
    }
}

/// Пусто — и это не ошибка: значок в круге и одна короткая фраза.
struct DashboardEmptyPlaceholder: View {
    let text: String
    var symbol: String = "chart.bar.xaxis"

    var body: some View {
        VStack(spacing: Spacing.md) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(Palette.mutedForeground)
                .frame(width: 44, height: 44)
                .background(Palette.muted, in: Circle())
                .accessibilityHidden(true)
            Text(text)
                .font(.footnote)
                .foregroundStyle(Palette.mutedForeground)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, minHeight: 120)
        .accessibilityElement(children: .combine)
    }
}

/// Сбой запроса блока — не «данных нет»: иначе сбой выглядел бы хорошей новостью.
struct DashboardFailurePlaceholder: View {
    var message: String?
    let retry: () async -> Void

    var body: some View {
        VStack(spacing: Spacing.md) {
            Image(systemName: "exclamationmark.triangle")
                .font(.title3)
                .foregroundStyle(Palette.warning)
                .frame(width: 44, height: 44)
                .background(Palette.warning.opacity(0.15), in: Circle())
                .accessibilityHidden(true)
            Text(message ?? String(localized: "state.failed", defaultValue: "Не удалось загрузить"))
                .font(.footnote)
                .foregroundStyle(Palette.mutedForeground)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            RetryButton(action: retry)
        }
        .frame(maxWidth: .infinity, minHeight: 140)
    }
}

// MARK: - Полосы

/// Полоса «подпись — значение»: топ действий, конверсии, крупнейшие вузы.
struct DashboardBar {
    let label: String
    /// Доля 0…1 — длина полосы.
    let fraction: Double
    let valueText: String
    var tint: Color?
}

/// Столбик полос в духе «Экранного времени»: подпись и число над тонкой капсулой.
struct DashboardBarList: View {
    let bars: [DashboardBar]
    var tint: Color = Palette.primary

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            ForEach(bars.indices, id: \.self) { index in
                let bar = bars[index]
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                        Text(bar.label)
                            .font(.subheadline)
                            .foregroundStyle(Palette.foreground)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: Spacing.md)
                        Text(verbatim: bar.valueText)
                            .font(.subheadline.monospacedDigit())
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    DashboardCapsuleBar(fraction: bar.fraction, tint: bar.tint ?? tint)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(bar.label))
                .accessibilityValue(Text(verbatim: bar.valueText))
            }
        }
    }
}

/// Тонкая капсула доли: дорожка приглушённая, заливка — цветом ряда.
struct DashboardCapsuleBar: View {
    let fraction: Double
    var tint: Color = Palette.primary

    var body: some View {
        GeometryReader { proxy in
            let clamped = min(max(fraction, 0), 1)
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.muted)
                Capsule()
                    .fill(tint)
                    // Ненулевое значение видно всегда: полоса в 0 pt читается как «ноль».
                    .frame(width: clamped > 0 ? max(proxy.size.width * clamped, 6) : 0)
            }
        }
        .frame(height: 6)
        .accessibilityHidden(true)
    }
}

// MARK: - Строки

/// Строка обзора: значок в круге, текст, справа — число или отметка. Шеврон добавляет
/// `NavigationLink`, в который строку обычно кладут.
struct DashboardRow: View {
    let title: String
    var subtitle: String?
    let symbol: String
    var tint: Color = Palette.primary
    var value: String?
    var badge: (text: String, tint: Color)?

    var body: some View {
        HStack(spacing: Spacing.lg) {
            DashboardIconBadge(symbol: symbol, tint: tint)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(Typography.body)
                    .foregroundStyle(Palette.foreground)
                    .fixedSize(horizontal: false, vertical: true)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.footnote)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(3)
                }
            }
            Spacer(minLength: Spacing.md)
            if let value, !value.isEmpty {
                Text(verbatim: value)
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(Palette.mutedForeground)
                    .multilineTextAlignment(.trailing)
            }
            if let badge {
                StatusBadge(text: badge.text, tint: badge.tint)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// Переход «открыть всё» в конце секции — акцентным цветом, как ссылка.
struct DashboardMoreLabel: View {
    let title: String

    var body: some View {
        Text(title)
            .font(Typography.body)
            .foregroundStyle(Palette.primary)
    }
}

/// Пустая секция строк: короткая приглушённая фраза со значком, без «сырого» текста.
struct DashboardEmptyRow: View {
    let text: String
    var symbol: String = "checkmark.circle"
    var tint: Color = Palette.mutedForeground

    var body: some View {
        HStack(spacing: Spacing.lg) {
            Image(systemName: symbol)
                .font(.body)
                .foregroundStyle(tint)
                .accessibilityHidden(true)
            Text(text)
                .font(.subheadline)
                .foregroundStyle(Palette.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.vertical, Spacing.xs)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Период

/// Селектор периода или темы над содержимым — та же капсула-дорожка, что вкладки
/// профиля, друзей и статей (`FilterChips`). Системный сегментный переключатель был
/// ниже и площе их, и один экран приложения выглядел чужим среди остальных.
struct DashboardPeriodPicker<Value: Hashable>: View {
    let title: String
    @Binding var selection: Value
    let options: [(value: Value, label: String)]

    var body: some View {
        Section {
            FilterChips(
                options: options.map { (value: Optional($0.value), title: $0.label) },
                selection: Binding(get: { selection }, set: { if let next = $0 { selection = next } }),
                fillsWidth: true
            )
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets())
        }
    }
}

// MARK: - Токены

enum DashboardMetrics {
    /// Плитка мельче секции списка — и скругление на ступень меньше `Radius.card`,
    /// иначе маленькие карточки выглядят «надутыми».
    static let tileRadius: CGFloat = Radius.xxxl
    /// Шаг между плитками и между секциями обзора — один на весь экран.
    static let gap: CGFloat = Spacing.lg
    static let chartHeight: CGFloat = 180
    static let valueFont = Font.system(.title2, design: .rounded, weight: .semibold).monospacedDigit()
}

enum DashboardText {
    static var noData: String { String(localized: "dashboard.noData", defaultValue: "Нет данных") }
    static var periodNoData: String { String(localized: "dashboard.periodEmpty", defaultValue: "За период данных нет") }
}
