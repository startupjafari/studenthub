import SwiftUI

/// Состояния экрана: загрузка, ошибка, пусто (DESIGN_SYSTEM §8 «Состояния»).
///
/// Один набор на всё приложение: экран, который по-своему рисует «нет связи»,
/// человек читает как другую поломку. Основа — системный `ContentUnavailableView`:
/// он сам подстраивается под Dynamic Type и VoiceOver.

/// Первая загрузка экрана без кеша.
struct LoadingStateView: View {
    var title: String?

    var body: some View {
        VStack(spacing: Spacing.lg) {
            ProgressView()
            if let title {
                Text(title)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, Spacing.xxl)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(title ?? String(localized: "common.loading", defaultValue: "Загрузка")))
        .accessibilityIdentifier("state.loading")
    }
}

/// Ошибка, из-за которой показать нечего. Нет связи отличается от прочих сбоев
/// значком и заголовком: в первом случае человек проверит сеть, во втором — подождёт.
struct ErrorStateView: View {
    let message: String
    var isOffline = false
    var retry: (() async -> Void)?

    var body: some View {
        ContentUnavailableView {
            Label(
                isOffline
                    ? String(localized: "home.offline", defaultValue: "Нет связи")
                    : String(localized: "state.failed", defaultValue: "Не удалось загрузить"),
                systemImage: isOffline ? "wifi.slash" : "exclamationmark.triangle"
            )
        } description: {
            Text(message)
        } actions: {
            if let retry {
                RetryButton(action: retry)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityIdentifier("state.error")
    }
}

/// Кнопка повтора: пока запрос идёт, второй не уходит.
struct RetryButton: View {
    let action: () async -> Void
    @State private var isRunning = false

    var body: some View {
        Button {
            guard !isRunning else { return }
            isRunning = true
            Task {
                await action()
                isRunning = false
            }
        } label: {
            if isRunning {
                ProgressView()
            } else {
                Text(String(localized: "common.retry", defaultValue: "Повторить"))
            }
        }
        .glassProminentButton()
        .disabled(isRunning)
        .accessibilityIdentifier("state.retry")
    }
}

/// Данных нет, и это не ошибка: свободный день, пустой список заявок.
///
/// Своя вёрстка, а не `ContentUnavailableView`: системный растягивается на всё, что
/// ему дали, и центрирует себя в этом. В прокрутке с минимальной высотой (вкладка
/// профиля) он уезжал за нижний край экрана, а в списках вставал на разной высоте —
/// где под шапкой, где посередине. Здесь размер по содержимому, а место на экране
/// задаёт тот, кто ставит (`screenState`).
struct EmptyStateView: View {
    let title: String
    let symbol: String
    var hint: String?
    var actionTitle: String?
    var action: (() -> Void)?

    @ScaledMetric(relativeTo: .largeTitle) private var symbolSize: CGFloat = 44

    var body: some View {
        VStack(spacing: Spacing.md) {
            Image(systemName: symbol)
                .font(.system(size: min(symbolSize, 72)))
                .foregroundStyle(Palette.mutedForeground)
                .padding(.bottom, Spacing.xs)
                .accessibilityHidden(true)
            Text(title)
                .font(.title3.weight(.bold))
                .foregroundStyle(Palette.foreground)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if let hint {
                Text(hint)
                    .font(Typography.body)
                    .foregroundStyle(Palette.mutedForeground)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .glassProminentButton()
                    .padding(.top, Spacing.sm)
            }
        }
        .frame(maxWidth: 340)
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.xxl)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("state.empty")
    }
}

extension View {
    /// Плотный сгруппированный список: настройки, каталоги, списки с фильтрами. Первая
    /// секция — на одном расстоянии от панели навигации на всех таких экранах, а не на
    /// системных 35 pt, которые список ставит над первой секцией; между секциями —
    /// компактный зазор.
    func compactListStyle() -> some View {
        listStyle(.insetGrouped)
            .listSectionSpacing(.compact)
            .contentMargins(.top, Spacing.sm, for: .scrollContent)
    }
}

extension View {
    /// Состояние экрана-списка — пусто, первая загрузка, ошибка — по центру видимой
    /// области между панелью навигации и панелью вкладок, по обеим осям.
    ///
    /// Накладывается поверх списка, а не строкой в нём: строка `List` не знает высоты
    /// экрана (`containerRelativeFrame` в ней меряет саму строку), и состояние вставало
    /// вплотную под шапкой, а крупный значок обрезался её краем. Шапка списка (фильтры,
    /// поиск) остаётся на месте и работает: подложка оверлея касания не ловит.
    func screenState<StateContent: View>(_ isShown: Bool, @ViewBuilder _ state: () -> StateContent) -> some View {
        overlay {
            if isShown {
                state()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .transition(.opacity)
            }
        }
    }
}

/// Полоса над уже показанными данными: обновление не удалось, но старое на экране.
/// Честнее, чем молча показывать несвежее, и мягче, чем стирать список ошибкой.
struct StaleDataBanner: View {
    let message: String
    var isOffline = false
    var retry: (() async -> Void)?

    var body: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: isOffline ? "wifi.slash" : "exclamationmark.triangle")
                .accessibilityHidden(true)
            Text(message).lineLimit(3)
            Spacer(minLength: 0)
            if let retry {
                Button(String(localized: "common.retry", defaultValue: "Повторить")) {
                    Task { await retry() }
                }
                .font(Typography.meta.weight(.semibold))
            }
        }
        .font(Typography.meta)
        .foregroundStyle(Palette.mutedForeground)
        .padding(Spacing.lg)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
    }
}

/// Загрузка → ошибка → пусто → содержимое: одна развилка вместо копии на каждом экране.
///
/// Пока данных нет, ошибка занимает экран; когда данные уже есть — сверху появляется
/// полоса, а список остаётся.
struct LoadableContent<Value, Content: View>: View {
    let value: Value?
    let failure: String?
    var isOffline = false
    var isEmpty: (Value) -> Bool = { _ in false }
    var empty: EmptyStateView?
    let retry: () async -> Void
    @ViewBuilder let content: (Value) -> Content

    var body: some View {
        if let value {
            Group {
                if isEmpty(value), let empty {
                    empty
                } else {
                    content(value)
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                if let failure {
                    StaleDataBanner(message: failure, isOffline: isOffline, retry: retry)
                        .padding(.horizontal, Spacing.xl)
                        .padding(.vertical, Spacing.sm)
                }
            }
        } else if let failure {
            ErrorStateView(message: failure, isOffline: isOffline, retry: retry)
        } else {
            LoadingStateView()
        }
    }
}

/// Заголовок секции на экранах-лентах (не в `List`: там свой системный заголовок).
struct SectionHeader: View {
    let title: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(Typography.sectionTitle)
                .foregroundStyle(Palette.foreground)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: Spacing.md)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .font(Typography.meta.weight(.semibold))
            }
        }
    }
}
