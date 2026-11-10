import SwiftUI

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
struct HeroHeader<Badges: View, Trailing: View>: View {
    let visual: HeroVisual
    let title: String
    var subtitle: String?
    var subtitleTint: Color = Palette.mutedForeground
    var actions: [HeroAction] = []
    @ViewBuilder var badges: () -> Badges
    /// Меню «Ещё» последней кнопкой ряда — если у карточки есть редкие действия.
    @ViewBuilder var moreMenu: () -> Trailing

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
            if !actions.isEmpty || Trailing.self != EmptyView.self {
                HeroActionRow(actions: actions, moreMenu: moreMenu)
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

extension HeroHeader where Badges == EmptyView, Trailing == EmptyView {
    init(visual: HeroVisual, title: String, subtitle: String? = nil, subtitleTint: Color = Palette.mutedForeground, actions: [HeroAction] = []) {
        self.init(visual: visual, title: title, subtitle: subtitle, subtitleTint: subtitleTint, actions: actions, badges: { EmptyView() }, moreMenu: { EmptyView() })
    }
}

extension HeroHeader where Trailing == EmptyView {
    init(
        visual: HeroVisual,
        title: String,
        subtitle: String? = nil,
        subtitleTint: Color = Palette.mutedForeground,
        actions: [HeroAction] = [],
        @ViewBuilder badges: @escaping () -> Badges
    ) {
        self.init(visual: visual, title: title, subtitle: subtitle, subtitleTint: subtitleTint, actions: actions, badges: badges, moreMenu: { EmptyView() })
    }
}

/// Ряд круглых стеклянных кнопок с подписями. Последней — «Ещё», если передано меню.
struct HeroActionRow<More: View>: View {
    let actions: [HeroAction]
    @ViewBuilder var moreMenu: () -> More

    var body: some View {
        GlassGroup(spacing: Spacing.lg) {
            HStack(alignment: .top, spacing: Spacing.md) {
                ForEach(actions) { item in
                    Button(role: item.role, action: item.action) {
                        HeroActionLabel(title: item.title, symbol: item.symbol, isDestructive: item.role == .destructive)
                    }
                    .buttonStyle(.plain)
                    .frame(maxWidth: .infinity)
                }
                if More.self != EmptyView.self {
                    Menu(content: moreMenu) {
                        HeroActionLabel(
                            title: String(localized: "chats.info.more", defaultValue: "Ещё"),
                            symbol: "ellipsis",
                            isDestructive: false
                        )
                    }
                    .buttonStyle(.plain)
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .padding(.horizontal, Spacing.md)
    }
}

extension HeroActionRow where More == EmptyView {
    init(actions: [HeroAction]) {
        self.init(actions: actions, moreMenu: { EmptyView() })
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
struct TelegramStyleRow<Leading: View, Accessory: View>: View {
    let title: String
    var subtitle: String?
    var meta: String?
    var metaTint: Color = Palette.mutedForeground
    @ViewBuilder var leading: () -> Leading
    @ViewBuilder var accessory: () -> Accessory

    var body: some View {
        HStack(alignment: .center, spacing: Spacing.lg) {
            leading()
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
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

extension TelegramStyleRow where Accessory == EmptyView {
    init(title: String, subtitle: String? = nil, meta: String? = nil, metaTint: Color = Palette.mutedForeground, @ViewBuilder leading: @escaping () -> Leading) {
        self.init(title: title, subtitle: subtitle, meta: meta, metaTint: metaTint, leading: leading, accessory: { EmptyView() })
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
