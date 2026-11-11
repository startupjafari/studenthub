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
    /// синий стеклянный круг в правом нижнем углу над панелью вкладок, как «новый чат».
    /// Кнопку «+» в верхней панели на таком экране не дублируют.
    ///
    /// Под кнопкой список получает запас прокрутки её высоты: иначе последняя строка
    /// (шеврон, статус, «Всего: N») навсегда оставалась под синим кругом.
    func floatingAction(_ title: String, symbol: String = "plus", action: @escaping () -> Void) -> some View {
        contentMargins(.bottom, FloatingActionButton.clearance, for: .scrollContent)
            .overlay(alignment: .bottomTrailing) {
                FloatingActionButton(title: title, symbol: symbol, action: action)
                    .padding(.trailing, Spacing.xl)
                    .padding(.bottom, Spacing.xl)
            }
    }
}

private struct FloatingActionButton: View {
    let title: String
    let symbol: String
    let action: () -> Void

    /// Высота кнопки с её отступом снизу и зазором над последней строкой.
    static let clearance: CGFloat = 56 + Spacing.xl * 2

    @ScaledMetric(relativeTo: .title2) private var size: CGFloat = 56

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.title2.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: min(size, 72), height: min(size, 72))
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
