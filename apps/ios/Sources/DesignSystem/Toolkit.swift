import QuickLook
import SwiftUI

// Общие кирпичи экранов-списков, форм и сводок. Админских разделов в вебе больше сотни,
// и все они собраны из одного и того же: список с поиском и подгрузкой, лист с формой,
// плитки цифр, строка человека, подтверждение опасного действия, открытие файла.
// Здесь они один раз — экраны отличаются данными, а не поведением.

// MARK: - Роль в окружении

private struct ViewerRoleKey: EnvironmentKey {
    static let defaultValue: Role = .unknown
}

extension EnvironmentValues {
    /// Роль вошедшего: экраны, общие для нескольких ролей (жалобы, заявки, журнал),
    /// по ней решают, какие действия показать. Решение о доступе всё равно за сервером.
    var viewerRole: Role {
        get { self[ViewerRoleKey.self] }
        set { self[ViewerRoleKey.self] = newValue }
    }
}

// MARK: - Список с подгрузкой

/// `List` над `PagedLoader`: состояния, подгрузка у последней строки, обновление жестом.
/// Шапку (фильтры, сводку) экран передаёт в `header` — она остаётся видна и при пустом
/// списке, чтобы фильтр можно было снять.
struct PagedList<Item: Decodable & Identifiable, Row: View, Header: View>: View {
    let loader: PagedLoader<Item>
    var empty: EmptyStateView
    @ViewBuilder var header: () -> Header
    @ViewBuilder var row: (Item) -> Row

    init(
        loader: PagedLoader<Item>,
        empty: EmptyStateView,
        @ViewBuilder header: @escaping () -> Header,
        @ViewBuilder row: @escaping (Item) -> Row
    ) {
        self.loader = loader
        self.empty = empty
        self.header = header
        self.row = row
    }

    var body: some View {
        List {
            header()
            if loader.isLoaded, !loader.items.isEmpty {
                if let failure = loader.failure {
                    StaleDataBanner(message: failure, isOffline: loader.isOffline) { await loader.reload() }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
                Section {
                    ForEach(loader.items) { item in
                        row(item)
                            .task { await loader.loadMore(after: item) }
                    }
                    if let pageFailure = loader.pageFailure {
                        PageFailureRow(message: pageFailure) { await loader.retryMore() }
                    } else if loader.hasMore {
                        HStack {
                            Spacer()
                            ProgressView()
                            Spacer()
                        }
                        .listRowBackground(Color.clear)
                    }
                } footer: {
                    if let total = loader.total, total > 0 {
                        Text(String(localized: "common.totalCount", defaultValue: "Всего: \(total.formatted())"))
                    }
                }
            }
        }
        // Поиск, фильтры и список — плотно, без пустых полос, которые список ставит
        // над первой секцией и между секциями.
        .compactListStyle()
        // Пусто, первая загрузка и ошибка — по центру экрана, а не строкой у края шапки.
        .screenState(!loader.isLoaded || loader.items.isEmpty) {
            if loader.isLoaded {
                empty
            } else if let failure = loader.failure {
                ErrorStateView(message: failure, isOffline: loader.isOffline) { await loader.reload() }
            } else {
                LoadingStateView()
            }
        }
        .pullToRefresh { await loader.reload() }
        .task { await loader.loadIfNeeded() }
        // Вернулись из фона после долгой паузы — первая страница перечитывается фоном,
        // показанное остаётся на месте (`AppLifecycle`).
        .onChange(of: AppLifecycle.shared.foregroundEpoch) {
            Task { await loader.reload() }
        }
    }
}

/// Строка под списком: следующая страница не пришла. Сразу под последним элементом —
/// там, куда человек смотрит, а не полосой наверху, которую он уже пролистал.
struct PageFailureRow: View {
    let message: String
    let retry: () async -> Void

    var body: some View {
        VStack(spacing: Spacing.sm) {
            Text(message)
                .font(Typography.meta)
                .foregroundStyle(Palette.mutedForeground)
                .multilineTextAlignment(.center)
            RetryButton(action: retry)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.md)
        .listRowBackground(Color.clear)
    }
}

extension PagedList where Header == EmptyView {
    init(loader: PagedLoader<Item>, empty: EmptyStateView, @ViewBuilder row: @escaping (Item) -> Row) {
        self.init(loader: loader, empty: empty, header: { EmptyView() }, row: row)
    }
}

// MARK: - Экран с одной загрузкой

/// Экран, который грузит одно значение: карточка, сводка, настройки. `reloadToken` —
/// повод перечитать (сохранили форму — увеличили счётчик). Политика загрузки — у
/// `RemoteValue`: сохранённое сразу, сеть фоном, полоса «данные не свежие» над
/// показанным. `caching: false` — экран, который нельзя показывать из сохранённого.
///
/// Экрану, который после действия правит значение на месте, нужна сама модель —
/// `RemoteValueContent` над своим `RemoteValue`.
struct RemoteContent<Value, Content: View>: View {
    var reloadToken: Int = 0
    let load: () async throws -> Value
    @ViewBuilder let content: (Value) -> Content

    @State private var remote: RemoteValue<Value>

    init(
        reloadToken: Int = 0,
        caching: Bool = true,
        load: @escaping () async throws -> Value,
        @ViewBuilder content: @escaping (Value) -> Content
    ) {
        self.reloadToken = reloadToken
        self.load = load
        self.content = content
        _remote = State(initialValue: RemoteValue(caching: caching))
    }

    var body: some View {
        RemoteValueContent(remote: remote, reloadToken: reloadToken, load: load, content: content)
    }
}

/// Состояния экрана над `RemoteValue`: значение (с полосой, если обновление не
/// удалось), ошибка на весь экран, загрузка. Сам грузит при показе, по `reloadToken` и
/// после возврата приложения из фона (`AppLifecycle`).
struct RemoteValueContent<Value, Content: View>: View {
    let remote: RemoteValue<Value>
    var reloadToken: Int = 0
    let load: () async throws -> Value
    @ViewBuilder let content: (Value) -> Content

    var body: some View {
        Group {
            if let value = remote.value {
                content(value)
                    // Обновление не удалось, а старое на экране: говорим об этом полосой,
                    // а не молча показываем несвежее (и не стираем его ошибкой).
                    .safeAreaInset(edge: .top, spacing: 0) {
                        if let failure = remote.failure {
                            StaleDataBanner(message: failure, isOffline: remote.isOffline) { await remote.load(load) }
                                .padding(.horizontal, Spacing.xl)
                                .padding(.vertical, Spacing.sm)
                        }
                    }
            } else if let failure = remote.failure {
                ErrorStateView(message: failure, isOffline: remote.isOffline) { await remote.load(load) }
            } else if remote.checkedCache {
                LoadingStateView()
            } else {
                Color.clear
            }
        }
        // Возврат из фона после долгой паузы — тоже повод перечитать (`AppLifecycle`).
        .task(id: RemoteContentRefresh(token: reloadToken, epoch: AppLifecycle.shared.foregroundEpoch)) {
            await remote.load(load)
        }
    }
}

/// Повод перечитать `RemoteContent`: просьба экрана или возврат приложения из фона.
private struct RemoteContentRefresh: Hashable {
    let token: Int
    let epoch: Int
}

// MARK: - Лист с формой

/// Лист «Отмена — заголовок — Сохранить» над `Form`. Ошибка сохранения показывается
/// над полями, и лист прокручивается к ней; лист не закрывается. Успех закрывает его и
/// зовёт `saved`.
///
/// Несохранённое в форме — смахнуть лист нельзя, а крестик сначала спрашивает, выбросить
/// ли правки: без этого заполненная на треть заявка терялась от случайного жеста.
/// Набранный в полях листа текст лист замечает сам (системные уведомления о вводе), так
/// что ни одна из форм не теряет напечатанное. `isDirty` — для правок без клавиатуры:
/// выбор в списке, переключатель, дата.
struct FormSheet<Content: View>: View {
    let title: String
    var saveTitle: String = String(localized: "common.save", defaultValue: "Сохранить")
    var canSave: Bool = true
    var isDirty: Bool = false
    let save: () async throws -> Void
    var saved: () async -> Void = {}
    @ViewBuilder let content: () -> Content

    @Environment(\.dismiss) private var dismiss
    @State private var failure: String?
    @State private var isSaving = false
    @State private var confirmingDiscard = false
    /// Человек печатал в полях этого листа.
    @State private var typed = false

    private var hasChanges: Bool { isDirty || typed }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                Form {
                    if let failure {
                        FormAlert(message: failure)
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets())
                            .id(FormSheetAnchor.failure)
                    }
                    content()
                }
                // Длинная форма прокручена вниз — ошибка над полями была бы не видна, и
                // «Сохранить» выглядело бы как кнопка, которая ничего не делает.
                .onChange(of: failure) { _, next in
                    guard next != nil else { return }
                    withMotion { proxy.scrollTo(FormSheetAnchor.failure, anchor: .top) }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(Text(title))
            .navigationBarTitleDisplayMode(.inline)
            .softTopEdge()
            .interactiveDismissDisabled(isSaving || hasChanges)
            .onReceive(NotificationCenter.default.publisher(for: UITextField.textDidChangeNotification)) { _ in typed = true }
            .onReceive(NotificationCenter.default.publisher(for: UITextView.textDidChangeNotification)) { _ in typed = true }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton {
                        if hasChanges { confirmingDiscard = true } else { dismiss() }
                    }
                    .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button(saveTitle) { Task { await run() } }
                            .disabled(!canSave)
                            .accessibilityIdentifier("form.save")
                    }
                }
            }
            .discardChangesDialog(isPresented: $confirmingDiscard) { dismiss() }
        }
    }

    @MainActor
    private func run() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            try await save()
            await saved()
            dismiss()
        } catch {
            failure = error.userMessage
        }
    }
}

private enum FormSheetAnchor: Hashable {
    case failure
}

extension View {
    /// «Отменить изменения?» — общий вопрос всех форм перед тем, как выбросить правки.
    func discardChangesDialog(isPresented: Binding<Bool>, discard: @escaping () -> Void) -> some View {
        confirmationDialog(
            String(localized: "form.discard.title", defaultValue: "Отменить изменения?"),
            isPresented: isPresented,
            titleVisibility: .visible
        ) {
            Button(String(localized: "form.discard", defaultValue: "Не сохранять"), role: .destructive, action: discard)
            Button(String(localized: "form.keepEditing", defaultValue: "Продолжить редактирование"), role: .cancel) {}
        }
    }
}

// MARK: - Сводки

/// Плитка цифры на обзоре: значение крупно, подпись мелко, иконка — для поиска глазом.
struct StatTile: View {
    let title: String
    let value: String
    var symbol: String?
    var tint: Color = Palette.primary
    var caption: String?

    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        // При крупном шрифте значок встаёт над подписью: в одной строке он отнимал у неё
        // треть ширины, и «Пропуски» рвались переносом. Подписи не сжимаются по высоте —
        // иначе в тесной ячейке две строки схлопывались в «Сре…».
        let header = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: Spacing.xs))
            : AnyLayout(HStackLayout(spacing: Spacing.sm))
        VStack(alignment: .leading, spacing: Spacing.xs) {
            header {
                if let symbol {
                    Image(systemName: symbol)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(tint)
                        .accessibilityHidden(true)
                }
                Text(title)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(value)
                .font(.title2.weight(.semibold).monospacedDigit())
                .foregroundStyle(Palette.foreground)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let caption, !caption.isEmpty {
                Text(caption)
                    .font(.caption)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardSurface(padding: Spacing.xl)
        .accessibilityElement(children: .combine)
    }
}

/// Сетка плиток: две колонки, при крупном шрифте (размеры accessibility) — одна, как
/// `DashboardTileGrid`: в половине ширины подписи и цифры уже не помещаются.
struct StatGrid<Content: View>: View {
    @ViewBuilder let content: () -> Content

    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let count = typeSize.isAccessibilitySize ? 1 : 2
        LazyVGrid(
            // По верху, как `DashboardTileGrid`: плитка без пояснения ниже соседней, и по
            // центру она «плавала» относительно неё.
            columns: Array(repeating: GridItem(.flexible(), spacing: Spacing.md, alignment: .top), count: count),
            spacing: Spacing.md,
            content: content
        )
    }
}

/// Полоса «доля»: посещаемость, заполненность, прогресс сбора документов.
struct ShareBar: View {
    let title: String
    /// 0…1.
    let fraction: Double
    var valueText: String?
    var tint: Color = Palette.primary

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack {
                Text(title).font(Typography.body).foregroundStyle(Palette.foreground)
                Spacer(minLength: Spacing.md)
                Text(valueText ?? fraction.formatted(.percent.precision(.fractionLength(0))))
                    .font(Typography.meta.monospacedDigit())
                    .foregroundStyle(Palette.mutedForeground)
            }
            ProgressView(value: min(max(fraction, 0), 1))
                .tint(tint)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Строки

/// Человек в списке: аватар, ФИО, подпись. Длинное не обрезается до бессмыслицы:
/// ФИО — в две строки, подпись — в две.
struct PersonRow: View {
    let name: String
    var subtitle: String?
    var avatarURL: String?
    var trailing: String?
    var size: CGFloat = 40

    var body: some View {
        HStack(spacing: Spacing.lg) {
            AvatarView(url: avatarURL, name: name, size: size)
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(Typography.body)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(2)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: Spacing.md)
            if let trailing, !trailing.isEmpty {
                Text(trailing)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Строка карточки списка: заголовок, плашка статуса справа, строки сведений ниже.
struct ListCardRow: View {
    let title: String
    var subtitle: String?
    var status: (text: String, tint: Color)?
    var lines: [String] = []

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                Text(title)
                    .font(Typography.cardTitle)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(3)
                Spacer(minLength: Spacing.md)
                if let status {
                    StatusBadge(text: status.text, tint: status.tint)
                }
            }
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(3)
            }
            ForEach(Array(lines.filter { !$0.isEmpty }.enumerated()), id: \.offset) { _, line in
                Text(line)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, Spacing.xs)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Фильтры

/// Полоса фильтров-капсул над списком. Значение `nil` — «Все».
struct FilterChips<Value: Hashable>: View {
    let options: [(value: Value?, title: String)]
    @Binding var selection: Value?
    /// Пункты делят ширину поровну, как системный сегментный переключатель («Мои /
    /// Сохранённые», вкладки профиля), — если влезают. Не влезли — обычная дорожка.
    var fillsWidth = false
    /// Действия по долгому нажатию на пункт — как меню вкладки-папки в Telegram. Пустой
    /// список — меню у пункта нет.
    var menu: (Value?) -> [FilterChipAction] = { _ in [] }

    @Namespace private var pill
    @Environment(\.motionReduced) private var reduceMotion

    // Как папки в Telegram: одна стеклянная капсула-дорожка, внутри — пункты, выбранный
    // подсвечен «таблеткой», которая переезжает к новому пункту. Не влезший в ширину
    // выбранный пункт дорожка докручивает к себе — и при выборе, и при появлении.
    var body: some View {
        ScrollViewReader { scroller in
            chips
                .onAppear { reveal(selection, with: scroller, animated: false) }
                .onChange(of: selection) { _, value in reveal(value, with: scroller, animated: true) }
        }
        .sensoryFeedback(.selection, trigger: selection)
    }

    private func reveal(_ value: Value?, with scroller: ScrollViewProxy, animated: Bool) {
        guard let index = options.firstIndex(where: { $0.value == value }) else { return }
        if animated, !reduceMotion {
            withAnimation(Motion.snappy) { scroller.scrollTo(index, anchor: .center) }
        } else {
            scroller.scrollTo(index, anchor: .center)
        }
    }

    @ViewBuilder
    private var chips: some View {
        Group {
            if fillsWidth {
                ViewThatFits(in: .horizontal) {
                    row(equalWidths: true)
                    scrolling
                }
            } else {
                scrolling
            }
        }
        .clipShape(Capsule())
        .glassSurface(interactive: false, in: Capsule())
    }

    /// Дорожка, которая листается. Края, за которыми есть ещё пункты, тают: иначе
    /// капсула резала подпись посередине буквы («остs», «Опро»), и не было видно, что
    /// дальше что-то есть.
    private var scrolling: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            row(equalWidths: false)
        }
        .scrollClipDisabled(false)
        .modifier(ScrollEdgeFade())
    }

    private func row(equalWidths: Bool) -> some View {
        // Равные пункты — своя раскладка, а не HStack с бесконечной шириной: та сообщала
        // `ViewThatFits` сумму подписей, а занимала «пунктов × самый длинный», и ряд,
        // который на деле не помещался, выбирался и обрезал подпись («Пользова…»).
        let layout = equalWidths ? AnyLayout(EqualWidthRow(spacing: 2)) : AnyLayout(HStackLayout(spacing: 2))
        return layout {
            ForEach(Array(options.enumerated()), id: \.offset) { index, option in
                let isOn = option.value == selection
                Button {
                    withAnimation(Motion.respecting(Motion.snappy, reduceMotion: reduceMotion)) {
                        selection = option.value
                    }
                } label: {
                    Text(option.title)
                        .font(.subheadline.weight(isOn ? .semibold : .medium))
                        .lineLimit(1)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .frame(maxWidth: equalWidths ? .infinity : nil)
                        .foregroundStyle(isOn ? Palette.foreground : Palette.mutedForeground)
                        .background {
                            if isOn {
                                Capsule()
                                    .fill(Palette.foreground.opacity(0.12))
                                    .matchedGeometryEffect(id: "pill", in: pill)
                            }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .modifier(FilterChipMenu(actions: menu(option.value)))
                .accessibilityAddTraits(isOn ? .isSelected : [])
                .id(index)
            }
        }
        .padding(4)
    }
}

/// Ряд пунктов одной ширины — по самому длинному. Идеальная ширина честная: «пунктов ×
/// самый длинный», поэтому `ViewThatFits` отбрасывает ряд, который не помещается, и
/// берёт прокручиваемую дорожку.
private struct EqualWidthRow: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard !subviews.isEmpty else { return .zero }
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        let widest = sizes.map(\.width).max() ?? 0
        let height = sizes.map(\.height).max() ?? 0
        let needed = widest * CGFloat(subviews.count) + spacing * CGFloat(subviews.count - 1)
        guard let width = proposal.width, width.isFinite else { return CGSize(width: needed, height: height) }
        return CGSize(width: max(width, needed), height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard !subviews.isEmpty else { return }
        let cell = (bounds.width - spacing * CGFloat(subviews.count - 1)) / CGFloat(subviews.count)
        for (index, subview) in subviews.enumerated() {
            subview.place(
                at: CGPoint(x: bounds.minX + CGFloat(index) * (cell + spacing), y: bounds.midY),
                anchor: .leading,
                proposal: ProposedViewSize(width: cell, height: bounds.height)
            )
        }
    }
}

/// Пункт меню капсулы фильтра.
struct FilterChipAction {
    let title: String
    let symbol: String
    var isDestructive = false
    let action: () -> Void
}

/// Меню капсулы. Без действий модификатор не вешает `contextMenu` вовсе: пустое меню
/// всё равно приподнимало бы капсулу под пальцем и ничего не показывало.
private struct FilterChipMenu: ViewModifier {
    let actions: [FilterChipAction]

    @ViewBuilder
    func body(content: Content) -> some View {
        if actions.isEmpty {
            content
        } else {
            content
                .contentShape(.contextMenuPreview, Capsule())
                .contextMenu {
                    ForEach(Array(actions.enumerated()), id: \.offset) { _, item in
                        Button(role: item.isDestructive ? .destructive : nil, action: item.action) {
                            Label(item.title, systemImage: item.symbol)
                        }
                    }
                }
        }
    }
}

/// Тающие края горизонтальной прокрутки — только с той стороны, где есть ещё
/// содержимое. Положение прокрутки система отдаёт с iOS 18; раньше края не тают.
private struct ScrollEdgeFade: ViewModifier {
    private struct Edges: Equatable {
        var leading = false
        var trailing = false
    }

    @State private var edges = Edges()
    private let width: CGFloat = 24

    init() {}

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 18, *) {
            content
                .onScrollGeometryChange(for: Edges.self) { geometry in
                    let offset = geometry.contentOffset.x
                    return Edges(
                        leading: offset > 1,
                        trailing: offset + geometry.containerSize.width < geometry.contentSize.width - 1
                    )
                } action: { _, new in
                    edges = new
                }
                .mask {
                    HStack(spacing: 0) {
                        LinearGradient(colors: [.clear, .black], startPoint: .leading, endPoint: .trailing)
                            .frame(width: edges.leading ? width : 0)
                        Color.black
                        LinearGradient(colors: [.black, .clear], startPoint: .leading, endPoint: .trailing)
                            .frame(width: edges.trailing ? width : 0)
                    }
                }
        } else {
            content
        }
    }
}

/// Строка фильтров для `List`: без фона, отступов и разделителя под собой, чтобы
/// капсулы шли от края, а под ними не тянулась линия до первой строки.
struct FilterChipsRow<Value: Hashable>: View {
    let options: [(value: Value?, title: String)]
    @Binding var selection: Value?
    var fillsWidth = false

    var body: some View {
        FilterChips(options: options, selection: $selection, fillsWidth: fillsWidth)
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(top: Spacing.xs, leading: 0, bottom: Spacing.xs, trailing: 0))
    }
}

// MARK: - Подтверждение

extension View {
    /// Подтверждение опасного действия над элементом: удалить, заблокировать, отклонить.
    func confirmDestructive<Item>(
        _ item: Binding<Item?>,
        title: @escaping (Item) -> String,
        actionTitle: String,
        perform: @escaping (Item) async -> Void
    ) -> some View {
        // Alert, а не confirmationDialog: на iOS 26 диалог всплывает у вью, к которой
        // привязан, — у этого модификатора это весь экран, и вопрос про кнопку внизу
        // появлялся вверху. Alert всегда по центру.
        alert(
            item.wrappedValue.map(title) ?? "",
            isPresented: Binding(get: { item.wrappedValue != nil }, set: { if !$0 { item.wrappedValue = nil } }),
            presenting: item.wrappedValue
        ) { value in
            Button(actionTitle, role: .destructive) {
                Task { await perform(value) }
            }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
        }
    }

    /// Ввод короткого текста перед действием: причина отклонения, комментарий.
    func reasonPrompt(
        _ isPresented: Binding<Bool>,
        title: String,
        message: String? = nil,
        placeholder: String = String(localized: "common.reason", defaultValue: "Причина"),
        actionTitle: String,
        text: Binding<String>,
        perform: @escaping () async -> Void
    ) -> some View {
        alert(title, isPresented: isPresented) {
            TextField(placeholder, text: text)
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
            Button(actionTitle) { Task { await perform() } }
        } message: {
            if let message { Text(message) }
        }
    }
}

// MARK: - Файлы

/// Открыть файл по ссылке: скачать во временную папку и показать системным просмотром
/// (PDF, картинки, документы Office). Ссылка на хранилище живёт минуты, поэтому её
/// получают прямо перед открытием — `resolve` и делает этот запрос.
@MainActor
@Observable
final class RemoteFileOpener {
    var previewURL: URL?
    var isLoading = false
    var failure: String?

    func open(name: String, resolve: @escaping () async throws -> URL) async {
        isLoading = true
        defer { isLoading = false }
        do {
            previewURL = try await Self.download(name: name, from: try await resolve())
        } catch {
            failure = error.userMessage
        }
    }

    /// Скачать во временную папку под настоящим именем — его видят просмотр и лист
    /// «Поделиться» (сохранённый в «Файлы» документ называется так же, как в чате).
    nonisolated static func download(name: String, from remote: URL) async throws -> URL {
        let (temp, response) = try await URLSession.shared.download(from: remote)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw APIError.malformedResponse(statusCode: http.statusCode)
        }
        let folder = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let safeName = name.replacingOccurrences(of: "/", with: "-")
        let target = folder.appending(path: safeName.isEmpty ? remote.lastPathComponent : safeName)
        try FileManager.default.moveItem(at: temp, to: target)
        return target
    }
}

extension View {
    /// Показ скачанного файла и ошибки скачивания. Экран держит `RemoteFileOpener` в
    /// `@State` и зовёт `open` по нажатию.
    func remoteFilePreview(_ opener: RemoteFileOpener) -> some View {
        modifier(RemoteFilePreviewModifier(opener: opener))
    }
}

private struct RemoteFilePreviewModifier: ViewModifier {
    @Bindable var opener: RemoteFileOpener

    func body(content: Content) -> some View {
        content
            .quickLookPreview($opener.previewURL)
            .actionFailureAlert($opener.failure)
            .overlay {
                if opener.isLoading {
                    ProgressView()
                        .padding(Spacing.xl)
                        .glassSurface(interactive: false, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                }
            }
    }
}

// MARK: - Сведения из JSON

/// Секция «подпись — значение» по объекту JSON: для сводок, полей журнала, деталей
/// записи, форма которых шире, чем стоит описывать типом. Порядок — как задан в `keys`;
/// без него — по алфавиту.
struct JSONDetailsSection: View {
    let title: String?
    let value: JSONValue
    var keys: [(key: String, title: String)]?

    var body: some View {
        Section {
            ForEach(rows, id: \.0) { row in
                DetailRow(title: row.0, value: row.1)
            }
        } header: {
            if let title { Text(title) }
        }

    }

    private var rows: [(String, String)] {
        guard let object = value.object else { return [] }
        if let keys {
            return keys.compactMap { entry in
                guard let field = object[entry.key], !field.isNull else { return nil }
                return (entry.title, field.display)
            }
        }
        return object.keys.sorted().compactMap { key in
            guard let field = object[key], !field.isNull, field.object == nil else { return nil }
            return (key, field.display)
        }
    }
}

// MARK: - Форматы

enum DisplayFormat {
    /// «12 окт., 14:30».
    static func dateTime(_ date: Date?) -> String {
        guard let date else { return "—" }
        return date.formatted(.dateTime.day().month(.abbreviated).hour().minute())
    }

    /// «12 окт. 2026».
    static func date(_ date: Date?) -> String {
        guard let date else { return "—" }
        return date.formatted(.dateTime.day().month(.abbreviated).year())
    }

    /// «+7 771 574 95 26» — из того, как номер набрали: «87715749526», «+7 (771)
    /// 574-95-26», «7715749526». Номер другого формата остаётся как есть: угадывать
    /// чужие правила группировки хуже, чем показать набранное.
    static func phone(_ raw: String) -> String {
        let allowed = Set("+0123456789 -()")
        guard raw.allSatisfy({ allowed.contains($0) }) else { return raw }
        var digits = raw.filter(\.isNumber)
        if digits.count == 11, digits.hasPrefix("8") || digits.hasPrefix("7") {
            digits.removeFirst()
        }
        guard digits.count == 10 else { return raw }
        let d = Array(digits)
        return "+7 \(String(d[0..<3])) \(String(d[3..<6])) \(String(d[6..<8])) \(String(d[8..<10]))"
    }

    /// Длительность ролика: «0:07», «12:40», «1:02:03».
    static func duration(milliseconds: Int) -> String {
        let total = max(0, milliseconds / 1000)
        let hours = total / 3600
        let minutes = total % 3600 / 60
        let seconds = total % 60
        let tail = String(format: "%02d", seconds)
        return hours > 0
            ? "\(hours):\(String(format: "%02d", minutes)):\(tail)"
            : "\(minutes):\(tail)"
    }

    /// «5 мин назад».
    static func relative(_ date: Date?) -> String {
        guard let date else { return "—" }
        return date.formatted(.relative(presentation: .named))
    }

    static func name(first: String?, last: String?, middle: String? = nil) -> String {
        let parts = [last, first, middle].compactMap { $0?.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return parts.isEmpty ? "—" : parts.joined(separator: " ")
    }

    static func percent(_ value: Double?) -> String {
        guard let value else { return "—" }
        return "\(Int(value.rounded()))%"
    }

    static func fileSize(_ bytes: Int?) -> String {
        guard let bytes else { return "" }
        return ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }
}

/// Поиск с задержкой: запрос уходит, когда человек перестал печатать, а не на каждую
/// букву. Первый показ экрана поиск не запускает — первую страницу грузит сам список.
extension View {
    func debouncedSearch(
        _ text: Binding<String>,
        prompt: String,
        delay: Duration = .milliseconds(350),
        onChange: @escaping (String) async -> Void
    ) -> some View {
        modifier(DebouncedSearchModifier(text: text, prompt: prompt, delay: delay, onChange: onChange))
    }
}

extension View {
    /// Поиск экрана-списка, как в Telegram: на входе поле видно под заголовком, при
    /// прокрутке вниз уезжает под шапку, при прокрутке вверх возвращается. Место поля —
    /// явно в шапке: размещение по умолчанию на iOS 26 ставило поиск то в шапку, то в
    /// нижнюю панель, и экраны вели себя по-разному. С обновлением оттягиванием не
    /// спорит: сначала выезжает поле, дальше тянется список (`PullTuner`).
    ///
    /// Листы выбора (переслать, человек, поделиться) держат поле видимым всегда —
    /// `.navigationBarDrawer(displayMode: .always)`: там поиск и есть главное действие.
    func listSearch(text: Binding<String>, prompt: Text) -> some View {
        searchable(text: text, placement: .navigationBarDrawer(displayMode: .automatic), prompt: prompt)
    }
}

private struct DebouncedSearchModifier: ViewModifier {
    @Binding var text: String
    let prompt: String
    let delay: Duration
    let onChange: (String) async -> Void

    @State private var lastSent = ""

    func body(content: Content) -> some View {
        content
            .listSearch(text: $text, prompt: Text(prompt))
            .task(id: text) {
                let needle = text.trimmingCharacters(in: .whitespaces)
                guard needle != lastSent else { return }
                if !needle.isEmpty {
                    try? await Task.sleep(for: delay)
                    guard !Task.isCancelled else { return }
                }
                lastSent = needle
                await onChange(needle)
            }
    }
}

// MARK: - Подстановки в локализованные строки

/// Значения для `\(…)` внутри `String(localized:defaultValue:)` без кавычек: разбор строк
/// (`LocalizationTests`, синхронизация каталога) обрывает значение на первой кавычке, и
/// `\(name ?? "")` превращался в каталоге в обрывок кода, который видел человек.
extension Optional where Wrapped == String {
    /// Пустая строка вместо `nil`.
    var orEmpty: String { self ?? "" }
    /// Тире вместо `nil` или пустого.
    var orDash: String {
        guard let self, !self.isEmpty else { return "—" }
        return self
    }
}

extension DisplayFormat {
    /// «4:05» — минуты и секунды обратного отсчёта.
    static func minutesSeconds(_ seconds: Int) -> String {
        let clamped = max(0, seconds)
        let rest = clamped % 60
        return "\(clamped / 60):" + (rest < 10 ? "0\(rest)" : "\(rest)")
    }
}
