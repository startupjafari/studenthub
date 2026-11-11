import SwiftUI
import UIKit

// Общие части экранов в стиле чатов (Telegram на iOS 26): шапка карточки по центру с рядом
// круглых стеклянных кнопок, плавающая кнопка создания. Эталон — `ChatInfoView` и
// `ChatListView`; здесь те же приёмы, но без привязки к чатам, чтобы карточки людей,
// групп, книг, вакансий и заявок выглядели одной семьёй.

// MARK: - Шапка карточки

/// Что стоит над заголовком шапки: фото/инициалы человека или значок сущности.
enum HeroVisual {
    case avatar(url: String?, name: String)
    case symbol(String, tint: Color)
}

/// Кнопка в ряду под шапкой: круг из стекла с символом и подпись под ним.
struct HeroAction: Identifiable {
    let id = UUID()
    let title: String
    let symbol: String
    var role: ButtonRole?
    let action: () -> Void
}

/// Шапка карточки по центру: крупный аватар или значок, заголовок, подзаголовок/статус,
/// плашки и ряд круглых стеклянных кнопок — как профиль в Telegram. Ставится первой
/// секцией `List` без фона (`HeroHeader` сам убирает фон строки и отступы).
struct HeroHeader<Badges: View>: View {
    let visual: HeroVisual
    let title: String
    var subtitle: String?
    var subtitleTint: Color = Palette.mutedForeground
    var actions: [HeroAction] = []
    @ViewBuilder var badges: () -> Badges
    /// Меню «Ещё» последней кнопкой ряда — если у карточки есть редкие действия.
    @HeroMenuBuilder var moreMenu: () -> [HeroMenuElement]

    @ScaledMetric(relativeTo: .largeTitle) private var visualSize: CGFloat = 96

    var body: some View {
        VStack(spacing: Spacing.sm) {
            visualView
                .padding(.bottom, Spacing.xs)
            Text(title)
                .font(.title2.weight(.semibold))
                .foregroundStyle(Palette.foreground)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(subtitleTint)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            badges()
            let menu = moreMenu()
            if !actions.isEmpty || !menu.isEmpty {
                HeroActionRow(actions: actions, moreMenu: { menu })
                    .padding(.top, Spacing.md)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.sm)
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: Spacing.sm, leading: 0, bottom: Spacing.sm, trailing: 0))
    }

    @ViewBuilder
    private var visualView: some View {
        let side = min(visualSize, 140)
        switch visual {
        case .avatar(let url, let name):
            AvatarView(url: url, name: name, size: side)
        case .symbol(let symbol, let tint):
            Image(systemName: symbol)
                .font(.system(size: side * 0.42, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: side, height: side)
                .background(tint.gradient, in: RoundedRectangle(cornerRadius: side * 0.28, style: .continuous))
                .accessibilityHidden(true)
        }
    }
}

extension HeroHeader where Badges == EmptyView {
    init(visual: HeroVisual, title: String, subtitle: String? = nil, subtitleTint: Color = Palette.mutedForeground, actions: [HeroAction] = []) {
        self.init(visual: visual, title: title, subtitle: subtitle, subtitleTint: subtitleTint, actions: actions, badges: { EmptyView() }, moreMenu: { [] })
    }

    init(
        visual: HeroVisual,
        title: String,
        subtitle: String? = nil,
        subtitleTint: Color = Palette.mutedForeground,
        actions: [HeroAction] = [],
        @HeroMenuBuilder moreMenu: @escaping () -> [HeroMenuElement]
    ) {
        self.init(visual: visual, title: title, subtitle: subtitle, subtitleTint: subtitleTint, actions: actions, badges: { EmptyView() }, moreMenu: moreMenu)
    }
}

extension HeroHeader {
    init(
        visual: HeroVisual,
        title: String,
        subtitle: String? = nil,
        subtitleTint: Color = Palette.mutedForeground,
        actions: [HeroAction] = [],
        @ViewBuilder badges: @escaping () -> Badges
    ) {
        self.init(visual: visual, title: title, subtitle: subtitle, subtitleTint: subtitleTint, actions: actions, badges: badges, moreMenu: { [] })
    }
}

/// Ряд круглых стеклянных кнопок с подписями. Последней — «Ещё», если передано меню.
struct HeroActionRow: View {
    let actions: [HeroAction]
    @HeroMenuBuilder var moreMenu: () -> [HeroMenuElement]

    init(actions: [HeroAction], @HeroMenuBuilder moreMenu: @escaping () -> [HeroMenuElement] = { [] }) {
        self.actions = actions
        self.moreMenu = moreMenu
    }

    var body: some View {
        let menu = moreMenu()
        GlassGroup(spacing: Spacing.lg) {
            HStack(alignment: .top, spacing: Spacing.md) {
                ForEach(actions) { item in
                    Button(role: item.role, action: item.action) {
                        HeroActionLabel(title: item.title, symbol: item.symbol, isDestructive: item.role == .destructive)
                    }
                    .buttonStyle(.plain)
                    .frame(maxWidth: .infinity)
                }
                if !menu.isEmpty {
                    HeroMoreButton(menu: menu)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .padding(.horizontal, Spacing.md)
    }
}

/// «Ещё» в ряду кнопок: та же `HeroActionLabel`, что у соседей, а меню открывает
/// прозрачная кнопка UIKit поверх неё (`MenuOverlay`).
///
/// SwiftUI-`Menu` на iOS 26 обводит свою подпись системным стеклом — один круг вокруг
/// значка и подписи разом, и «Ещё» выходило заметно крупнее соседних кнопок;
/// `.menuStyle(.button)` и `.buttonStyle(.plain)` этого не снимают. Меню UIKit ничего
/// вокруг подписи не рисует и открывается от самой кнопки.
struct HeroMoreButton: View {
    let menu: [HeroMenuElement]
    var title = String(localized: "chats.info.more", defaultValue: "Ещё")
    var symbol = "ellipsis"

    var body: some View {
        HeroActionLabel(title: title, symbol: symbol)
            .accessibilityHidden(true)
            .overlay {
                MenuOverlay(menu: menu.uiMenu, accessibilityLabel: title)
            }
    }
}

// MARK: - Меню действий

/// Пункт меню «Ещё». Меню строит UIKit, поэтому пункт — данные: название, значок и
/// действие, а не вью.
struct HeroMenuItem {
    let title: String
    let symbol: String?
    var isDestructive = false
    var isDisabled = false
    /// Галочка у выбранного варианта (текущий староста, выбранный срок).
    var isChecked = false
    let action: () -> Void

    init(
        _ title: String,
        symbol: String? = nil,
        isDestructive: Bool = false,
        isDisabled: Bool = false,
        isChecked: Bool = false,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.symbol = symbol
        self.isDestructive = isDestructive
        self.isDisabled = isDisabled
        self.isChecked = isChecked
        self.action = action
    }
}

/// Черта между группами пунктов — как `Divider()` в `Menu`.
struct HeroMenuDivider {}

/// Вложенное меню — как `Menu` внутри `Menu`.
struct HeroSubmenu {
    let title: String
    let symbol: String?
    let elements: [HeroMenuElement]

    init(_ title: String, symbol: String? = nil, @HeroMenuBuilder elements: () -> [HeroMenuElement]) {
        self.title = title
        self.symbol = symbol
        self.elements = elements()
    }
}

enum HeroMenuElement {
    case item(HeroMenuItem)
    case submenu(HeroSubmenu)
    case divider
}

/// Пункты меню тем же синтаксисом, что `Menu { … }`: условия, циклы, разделители.
@resultBuilder
enum HeroMenuBuilder {
    static func buildExpression(_ item: HeroMenuItem) -> [HeroMenuElement] { [.item(item)] }
    static func buildExpression(_ divider: HeroMenuDivider) -> [HeroMenuElement] { [.divider] }
    static func buildExpression(_ submenu: HeroSubmenu) -> [HeroMenuElement] { [.submenu(submenu)] }
    static func buildExpression(_ elements: [HeroMenuElement]) -> [HeroMenuElement] { elements }
    static func buildBlock(_ parts: [HeroMenuElement]...) -> [HeroMenuElement] { parts.flatMap { $0 } }
    static func buildOptional(_ part: [HeroMenuElement]?) -> [HeroMenuElement] { part ?? [] }
    static func buildEither(first: [HeroMenuElement]) -> [HeroMenuElement] { first }
    static func buildEither(second: [HeroMenuElement]) -> [HeroMenuElement] { second }
    static func buildArray(_ parts: [[HeroMenuElement]]) -> [HeroMenuElement] { parts.flatMap { $0 } }
}

extension Array where Element == HeroMenuElement {
    /// Меню UIKit: разделители режут пункты на встроенные группы, пустые группы
    /// (два разделителя подряд, разделитель в конце) не рисуются.
    var uiMenu: UIMenu {
        UIMenu(children: uiElements)
    }

    private var uiElements: [UIMenuElement] {
        var groups: [[UIMenuElement]] = [[]]
        for element in self {
            switch element {
            case .divider:
                groups.append([])
            case .item(let item):
                let action = UIAction(title: item.title, image: item.symbol.flatMap { UIImage(systemName: $0) }) { _ in item.action() }
                if item.isDestructive { action.attributes.insert(.destructive) }
                if item.isDisabled { action.attributes.insert(.disabled) }
                if item.isChecked { action.state = .on }
                groups[groups.count - 1].append(action)
            case .submenu(let submenu):
                groups[groups.count - 1].append(UIMenu(
                    title: submenu.title,
                    image: submenu.symbol.flatMap { UIImage(systemName: $0) },
                    children: submenu.elements.uiElements
                ))
            }
        }
        let filled = groups.filter { !$0.isEmpty }
        // Одна группа — пункты прямо в меню, без лишней обёртки.
        if filled.count == 1 { return filled[0] }
        return filled.map { UIMenu(options: .displayInline, children: $0) }
    }
}

/// Прозрачная кнопка UIKit, которая по касанию открывает меню. Сама ничего не рисует —
/// под ней своя подпись, и системное стекло меню её не обводит.
struct MenuOverlay: UIViewRepresentable {
    let menu: UIMenu
    let accessibilityLabel: String
    var accessibilityIdentifier: String?

    func makeUIView(context: Context) -> UIButton {
        let button = UIButton(type: .custom)
        button.showsMenuAsPrimaryAction = true
        button.backgroundColor = .clear
        return button
    }

    func updateUIView(_ button: UIButton, context: Context) {
        button.menu = menu
        button.accessibilityLabel = accessibilityLabel
        button.accessibilityIdentifier = accessibilityIdentifier
    }
}

/// Круг из стекла с символом и подпись под ним.
///
/// Круг одного размера у всех кнопок ряда, подпись — строго под ним: зазор больше, чем
/// стекло раздувается от касания, а подпись занимает свою высоту (до двух строк) и не
/// сжимается под круг. Ширину ряда делит тот, кто его строит (`HeroActionRow`).
struct HeroActionLabel: View {
    let title: String
    let symbol: String
    var isDestructive = false

    @ScaledMetric(relativeTo: .body) private var size: CGFloat = 50

    var body: some View {
        let tint = isDestructive ? Palette.destructive : Palette.primary
        let side = min(size, 64)
        VStack(spacing: Spacing.md) {
            Image(systemName: symbol)
                .font(.title3.weight(.medium))
                .foregroundStyle(tint)
                .frame(width: side, height: side)
                .glassSurface(in: Circle())
            Text(title)
                .font(.caption.weight(.medium))
                .foregroundStyle(tint)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .top)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(title))
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - Плавающая кнопка создания

extension View {
    /// Плавающая кнопка главного действия списка («Новая заявка», «Добавить книгу») —
    /// синий стеклянный круг. Кнопку «+» в верхней панели на таком экране не дублируют.
    ///
    /// На iOS 26 кнопка стоит в одну линию с островом нижней навигации, справа от него,
    /// как отдельная кнопка поиска в приложениях Apple: над панелью она закрывала
    /// последние строки списка и висела «в воздухе». Если справа от острова места нет
    /// (у роли много вкладок) или система старше — кнопка над панелью, как раньше, и
    /// список получает запас прокрутки её высоты, чтобы последняя строка не уходила
    /// под синий круг.
    func floatingAction(_ title: String, symbol: String = "plus", action: @escaping () -> Void) -> some View {
        modifier(FloatingActionPlacement(title: title, symbol: symbol, action: action))
    }
}

private struct FloatingActionPlacement: ViewModifier {
    let title: String
    let symbol: String
    let action: () -> Void

    /// Остров вкладок в координатах окна; `nil` — его нет или рядом не помещается кнопка.
    @State private var dock: CGRect?

    func body(content: Content) -> some View {
        content
            .contentMargins(.bottom, dock == nil ? FloatingActionButton.clearance : 0, for: .scrollContent)
            .overlay(alignment: .bottomTrailing) {
                if dock == nil {
                    FloatingActionButton(title: title, symbol: symbol, action: action)
                        .padding(.trailing, Spacing.xl)
                        .padding(.bottom, Spacing.xl)
                }
            }
            .overlay {
                GeometryReader { proxy in
                    let origin = proxy.frame(in: .global).origin
                    ZStack {
                        TabBarDockReader(clearance: FloatingActionButton.size + Spacing.xl + Spacing.md) { dock = $0 }
                            .frame(width: 0, height: 0)
                        if let dock {
                            FloatingActionButton(title: title, symbol: symbol, action: action)
                                .position(
                                    x: proxy.size.width - Spacing.xl - FloatingActionButton.size / 2,
                                    y: dock.midY - origin.y
                                )
                        }
                    }
                }
                .ignoresSafeArea()
            }
    }
}

/// Находит остров нижней навигации (iOS 26) и сообщает его рамку в координатах окна —
/// если справа от него помещается кнопка шириной `clearance`. Ищет по цепочке
/// ответчиков: экран лежит в стеке вкладки, стек — в контроллере вкладок `TabView`.
private struct TabBarDockReader: UIViewRepresentable {
    let clearance: CGFloat
    let report: (CGRect?) -> Void

    func makeUIView(context: Context) -> DockProbeView {
        let view = DockProbeView()
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ view: DockProbeView, context: Context) {
        view.clearance = clearance
        view.report = report
        view.scheduleMeasure()
    }

    final class DockProbeView: UIView {
        var clearance: CGFloat = 0
        var report: ((CGRect?) -> Void)?
        private var last: CGRect?
        private var isScheduled = false

        override func didMoveToWindow() {
            super.didMoveToWindow()
            scheduleMeasure()
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            scheduleMeasure()
        }

        /// Замер — после текущего прохода раскладки: панель вкладок к этому моменту уже
        /// на месте. Второй замер чуть позже ловит конец анимации перехода между экранами.
        func scheduleMeasure() {
            guard !isScheduled else { return }
            isScheduled = true
            DispatchQueue.main.async { [weak self] in
                self?.isScheduled = false
                self?.measure()
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { [weak self] in
                self?.measure()
            }
        }

        private func measure() {
            let dock = Self.dock(from: self, clearance: clearance)
            guard dock != last else { return }
            last = dock
            report?(dock)
        }

        static func dock(from view: UIView, clearance: CGFloat) -> CGRect? {
            guard #available(iOS 26, *), let window = view.window else { return nil }
            var responder: UIResponder? = view
            while let current = responder, !(current is UITabBarController) {
                responder = current.next
            }
            guard let tabs = responder as? UITabBarController else { return nil }
            let bar = tabs.tabBar
            guard !bar.isHidden, bar.alpha > 0.01, bar.window != nil else { return nil }
            // Остров — объединение видимых кнопок вкладок: сама панель на iOS 26 шире
            // острова и прозрачна по краям.
            var island = CGRect.null
            var stack: [UIView] = [bar]
            while let next = stack.popLast() {
                for child in next.subviews where !child.isHidden && child.alpha > 0.01 {
                    if child is UIControl, child.bounds.width > 1, child.bounds.height > 1 {
                        island = island.union(child.convert(child.bounds, to: window))
                    } else {
                        stack.append(child)
                    }
                }
            }
            guard !island.isNull, island.height > 20 else { return nil }
            guard window.bounds.maxX - island.maxX >= clearance else { return nil }
            return island
        }
    }
}

private struct FloatingActionButton: View {
    let title: String
    let symbol: String
    let action: () -> Void

    static let size: CGFloat = 56
    /// Высота кнопки с её отступом снизу и зазором над последней строкой.
    static let clearance: CGFloat = size + Spacing.xl * 2

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.title2.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: Self.size, height: Self.size)
                .glassSurface(tint: Palette.primary, in: Circle())
                .shadow(color: .black.opacity(0.18), radius: 10, y: 4)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(title))
    }
}

// MARK: - Строка списка с метой справа

/// Строка как в списке чатов: заголовок полужирным в одну строку, мета справа сверху
/// (время, статус), ниже — до двух строк приглушённого текста. Ведущий элемент —
/// аватар или значок; счётчик/плашка — справа снизу.
///
/// `layout: .stacked` — для каталогов с длинными названиями (вузы, заявки, люди):
/// заголовку отдана вся ширина и до двух строк, а мета и плашка уходят строкой ниже.
/// В строке чата дата рядом с заголовком уместна — там заголовок короткий; рядом с
/// названием вуза она съедала половину названия.
struct TelegramStyleRow<Leading: View, Accessory: View>: View {
    enum Layout {
        /// Заголовок в строку, мета справа от него — список чатов.
        case chat
        /// Заголовок до двух строк, подзаголовок, ниже — мета и плашка.
        case stacked
    }

    let title: String
    var subtitle: String?
    var meta: String?
    var metaTint: Color = Palette.mutedForeground
    var layout: Layout = .chat
    @ViewBuilder var leading: () -> Leading
    @ViewBuilder var accessory: () -> Accessory

    var body: some View {
        HStack(alignment: .center, spacing: Spacing.lg) {
            leading()
            switch layout {
            case .chat: chatBody
            case .stacked: stackedBody
            }
        }
        .padding(.vertical, layout == .chat ? 4 : 2)
        .accessibilityElement(children: .combine)
    }

    private var chatBody: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                Text(title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(1)
                Spacer(minLength: Spacing.sm)
                if let meta, !meta.isEmpty {
                    Text(meta)
                        .font(.subheadline)
                        .foregroundStyle(metaTint)
                        .lineLimit(1)
                }
            }
            HStack(alignment: .bottom, spacing: Spacing.sm) {
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Spacer(minLength: 0)
                }
                accessory()
            }
        }
    }

    private var stackedBody: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.body.weight(.semibold))
                .foregroundStyle(Palette.foreground)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            // Мета слева, плашка справа — на одной линии под текстом. Длинная мета
            // ужимается сама, плашка — никогда.
            HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                if let meta, !meta.isEmpty {
                    Text(meta)
                        .font(.footnote)
                        .foregroundStyle(metaTint)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                accessory()
                    .fixedSize()
            }
            .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension TelegramStyleRow where Accessory == EmptyView {
    init(
        title: String,
        subtitle: String? = nil,
        meta: String? = nil,
        metaTint: Color = Palette.mutedForeground,
        layout: Layout = .chat,
        @ViewBuilder leading: @escaping () -> Leading
    ) {
        self.init(title: title, subtitle: subtitle, meta: meta, metaTint: metaTint, layout: layout, leading: leading, accessory: { EmptyView() })
    }
}

/// Значок сущности в строке — как аватар чата, но для заявки, книги, события.
struct RowSymbol: View {
    let symbol: String
    var tint: Color = Palette.primary
    var size: CGFloat = 44

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.42, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(tint.gradient, in: Circle())
            .accessibilityHidden(true)
    }
}
