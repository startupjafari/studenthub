import SwiftUI
import UIKit

/// Пункт меню сообщения по долгому нажатию. Порядок — как в Telegram.
enum MessageMenuAction: Hashable, Identifiable {
    case reply, copy, edit
    case pin(isPinned: Bool)
    case forward
    case readers(count: Int)
    case report, delete, select

    var id: String {
        switch self {
        case .reply: "reply"
        case .copy: "copy"
        case .edit: "edit"
        case .pin: "pin"
        case .forward: "forward"
        case .readers: "readers"
        case .report: "report"
        case .delete: "delete"
        case .select: "select"
        }
    }

    var title: String {
        switch self {
        case .reply: String(localized: "chats.reply", defaultValue: "Ответить")
        case .copy: String(localized: "chats.menu.copy", defaultValue: "Скопировать")
        case .edit: String(localized: "feed.edit", defaultValue: "Редактировать")
        case .pin(let isPinned):
            isPinned
                ? String(localized: "chats.unpin", defaultValue: "Открепить")
                : String(localized: "chats.pin", defaultValue: "Закрепить")
        case .forward: String(localized: "chats.forward", defaultValue: "Переслать")
        case .readers(let count):
            count > 0 ? ChatPlural.readBy(count) : String(localized: "chats.readBy.none", defaultValue: "Пока никто не прочитал")
        case .report: String(localized: "feed.report", defaultValue: "Пожаловаться")
        case .delete: String(localized: "feed.delete", defaultValue: "Удалить")
        case .select: String(localized: "chats.selection.select", defaultValue: "Выбрать")
        }
    }

    var symbol: String {
        switch self {
        case .reply: "arrowshape.turn.up.left"
        case .copy: "doc.on.doc"
        case .edit: "square.and.pencil"
        case .pin(let isPinned): isPinned ? "pin.slash" : "pin"
        case .forward: "arrowshape.turn.up.right"
        case .readers: "checkmark.message"
        case .report: "exclamationmark.bubble"
        case .delete: "trash"
        case .select: "checkmark.circle"
        }
    }

    var isDestructive: Bool { self == .delete }

    /// Что доступно для сообщения. Удалить у себя можно любое дошедшее до сервера, у всех
    /// — по правам (`capabilities.canDelete`): какой вариант, спросит подтверждение.
    static func available(
        for message: MessageRecord,
        isOwn: Bool,
        isGroup: Bool,
        capabilities: MessageCapabilities,
        readCount: Int
    ) -> [MessageMenuAction] {
        if message.deletedAt != nil || message.systemType != nil {
            return [.select]
        }
        let hasText = !message.content.isEmpty
        guard message.remoteId != nil else {
            // Не дошедшее до сервера: только своё и только локально.
            var local: [MessageMenuAction] = []
            if hasText { local.append(.copy) }
            if capabilities.canDelete { local.append(.delete) }
            return local + [.select]
        }
        var actions: [MessageMenuAction] = [.reply]
        if hasText { actions.append(.copy) }
        if capabilities.canEdit { actions.append(.edit) }
        actions.append(.pin(isPinned: message.pinnedAt != nil))
        actions.append(.forward)
        if isGroup, isOwn, message.sendState == .sent { actions.append(.readers(count: readCount)) }
        if capabilities.canReport { actions.append(.report) }
        actions.append(.delete)
        actions.append(.select)
        return actions
    }
}

/// Что открыть в меню: сообщение, где оно на экране и что с ним можно делать.
struct MessageMenuRequest: Identifiable {
    let id = UUID()
    let item: MessageTimeline.Item
    /// Строка ленты целиком (с аватаром) и сам пузырь — в координатах окна.
    let rowRect: CGRect
    let bubbleRect: CGRect
    let context: BubbleContext
    let capabilities: MessageCapabilities
    let actions: [MessageMenuAction]
    /// Реакции можно ставить только дошедшему до сервера.
    let canReact: Bool
}

/// Меню сообщения как в Telegram: переписка размывается, пузырь остаётся на своём месте
/// (и сдвигается, только если меню иначе не влезает), над ним — панель реакций, под ним —
/// компактный список действий. Реакции раскрываются в полный выбор emoji.
struct MessageMenuOverlay: View {
    let request: MessageMenuRequest
    let onReact: (String) -> Void
    let onAction: (MessageMenuAction) -> Void
    let onDismiss: () -> Void

    @State private var shown = false
    @State private var expanded = false
    /// Пункт под пальцем: меню ведут скольжением, как в Telegram, — палец лёг на
    /// панель, подсветка идёт за ним вверх и вниз, отпустил — действие.
    @State private var pressed: MessageMenuAction?
    @State private var rowFrames: [String: CGRect] = [:]
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.displayScale) private var displayScale
    @ScaledMetric(relativeTo: .body) private var rowHeight: CGFloat = 44

    private static let gap: CGFloat = 8
    /// Между панелью реакций и пузырём — место под «хвостик» из двух кружков.
    private static let reactionsGap: CGFloat = 12
    private static let reactionsHeight: CGFloat = 48
    private static let menuWidth: CGFloat = 240
    private static let edge: CGFloat = 8
    private static let menuRadius: CGFloat = 24
    /// Поля сверху и снизу списка.
    private static let menuInset: CGFloat = Spacing.sm * 2
    /// Тонкая линия с отступами над «Выбрать», как в Telegram: отделяет режим выбора от
    /// действий с самим сообщением.
    private static let selectDivider: CGFloat = 1 + Spacing.sm * 2

    var body: some View {
        GeometryReader { proxy in
            let layout = layout(in: proxy)
            ZStack(alignment: .topLeading) {
                backdrop

                bubble(layout)

                if request.canReact {
                    reactions(layout)
                }

                if !expanded {
                    menu(layout)
                }
            }
        }
        .ignoresSafeArea()
        .onAppear {
            withAnimation(Motion.respecting(.spring(duration: 0.32, bounce: 0.18), reduceMotion: reduceMotion)) {
                shown = true
            }
        }
        .onChange(of: MessageMenuTouch.shared.phase) { _, phase in follow(phase) }
        .onDisappear { MessageMenuTouch.shared.reset() }
        .accessibilityAction(.escape) { dismiss() }
    }

    // MARK: Раскладка

    private struct Layout {
        /// Верх строки с пузырём, куда она встаёт.
        var rowTop: CGFloat
        /// Высота показанной строки (длинный пузырь обрезается и прокручивается).
        var rowHeight: CGFloat
        var clipped: Bool
        var reactionsY: CGFloat
        var menuY: CGFloat
        var screen: CGSize
        var safeTop: CGFloat
        var safeBottom: CGFloat
    }

    private var menuHeight: CGFloat {
        let divider = request.actions.count > 1 && request.actions.last == .select ? Self.selectDivider : 0
        return CGFloat(request.actions.count) * rowHeight + Self.menuInset + divider
    }

    /// Отступы окна: слой меню растянут на весь экран (`ignoresSafeArea`), и его
    /// собственные отступы — нули; по ним панель реакций вставала под часы.
    private static var windowInsets: UIEdgeInsets {
        UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow?.safeAreaInsets }
            .first ?? .zero
    }

    private func layout(in proxy: GeometryProxy) -> Layout {
        let size = proxy.size
        let insets = Self.windowInsets
        let safeTop = insets.top + Self.edge
        // Открытая клавиатура остаётся поверх меню — раскладываемся над ней.
        let floor = min(size.height - insets.bottom, KeyboardFrame.shared.top ?? .infinity)
        let safeBottom = floor - Self.edge
        let row = request.rowRect
        // Пузырь внутри строки может начинаться ниже (имя автора, отступы).
        let bubbleOffset = max(0, request.bubbleRect.minY - row.minY)
        let above = request.canReact ? Self.reactionsHeight + Self.reactionsGap - bubbleOffset : 0
        let below = Self.gap + menuHeight
        let room = safeBottom - safeTop - max(0, above) - below
        let shownHeight = min(row.height, max(room, rowHeight * 2))
        var top = row.minY
        top = max(top, safeTop + max(0, above))
        top = min(top, safeBottom - below - shownHeight)
        top = max(top, safeTop)
        return Layout(
            rowTop: top,
            rowHeight: shownHeight,
            clipped: shownHeight < row.height - 0.5,
            reactionsY: top + bubbleOffset - Self.reactionsGap - Self.reactionsHeight,
            menuY: top + shownHeight + Self.gap,
            screen: size,
            safeTop: safeTop,
            safeBottom: safeBottom
        )
    }

    /// Левый край панели шириной `width`: у своего — по правому краю пузыря, у чужого —
    /// по левому, и не за краем экрана.
    private func leading(width: CGFloat, screen: CGSize) -> CGFloat {
        let bubble = request.bubbleRect
        let raw = request.item.isOwn ? bubble.maxX - width : bubble.minX
        return min(max(raw, Self.edge), screen.width - width - Self.edge)
    }

    private var anchor: UnitPoint {
        request.item.isOwn ? .trailing : .leading
    }

    // MARK: Слои

    private var backdrop: some View {
        ZStack {
            Rectangle().fill(.ultraThinMaterial)
            Palette.overlay.opacity(0.12)
        }
        .opacity(shown ? 1 : 0)
        .contentShape(Rectangle())
        .onTapGesture { dismiss() }
        .accessibilityLabel(Text(String(localized: "common.close", defaultValue: "Закрыть")))
        .accessibilityAddTraits(.isButton)
    }

    private func bubble(_ layout: Layout) -> some View {
        let row = request.rowRect
        let preview = MessageBubbleView(
            item: request.item,
            context: request.context,
            capabilities: request.capabilities,
            isMenuPreview: true
        )
        .frame(width: row.width)
        .allowsHitTesting(false)

        return Group {
            if layout.clipped {
                ScrollView {
                    preview
                }
                .defaultScrollAnchor(.bottom)
                .frame(width: row.width, height: layout.rowHeight)
            } else {
                preview
            }
        }
        .offset(x: row.minX, y: shown ? layout.rowTop : row.minY)
        .accessibilityHidden(true)
    }

    private func reactions(_ layout: Layout) -> some View {
        let width: CGFloat = expanded
            ? min(layout.screen.width - Self.edge * 2, 360)
            : CGFloat(EmojiCatalog.quickReactions.count + 1) * 42 + Spacing.md * 2
        // Раскрытый выбор растёт вверх от панели: низ остаётся над пузырём, у хвостика.
        // Сверху тесно (пузырь у шапки) — растёт вниз, поверх пузыря.
        let barBottom = layout.reactionsY + Self.reactionsHeight
        let roomAbove = barBottom - layout.safeTop
        let growsUp = roomAbove >= 240
        let height: CGFloat = expanded
            ? min(360, growsUp ? roomAbove : layout.safeBottom - max(layout.reactionsY, layout.safeTop))
            : Self.reactionsHeight
        let y = expanded && growsUp ? barBottom - height : (expanded ? max(layout.reactionsY, layout.safeTop) : layout.reactionsY)
        let x = leading(width: width, screen: layout.screen)
        // Хвостик смотрит на угол пузыря: у своего — левый верхний, у чужого — тоже
        // левый, но правее аватара; за края панели не выходит.
        let tailX = min(max(request.bubbleRect.minX + Spacing.md - x, 20), width - 20)
        return GlassGroup(spacing: Spacing.sm) {
            ZStack(alignment: .topLeading) {
                ReactionPicker(
                    expanded: $expanded,
                    mine: request.capabilities.myReaction,
                    onPick: { emoji in
                        RecentEmoji.shared.use(emoji)
                        onReact(emoji)
                        dismiss()
                    }
                )
                .frame(width: width, height: height)
                .floatingGlass(in: RoundedRectangle(cornerRadius: expanded ? 22 : Self.reactionsHeight / 2, style: .continuous))

                ReactionTail()
                    .opacity(expanded && !growsUp ? 0 : 1)
                    .offset(x: tailX - ReactionTail.big / 2, y: height - ReactionTail.big / 2)
                    .accessibilityHidden(true)
            }
        }
        .scaleEffect(shown ? 1 : 0.6, anchor: anchor)
        .opacity(shown ? 1 : 0)
        .offset(x: x, y: y)
        .animation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion), value: expanded)
    }

    private func menu(_ layout: Layout) -> some View {
        let shape = RoundedRectangle(cornerRadius: Self.menuRadius, style: .continuous)
        return VStack(spacing: 0) {
            ForEach(Array(request.actions.enumerated()), id: \.element.id) { index, action in
                // Линия — только над «Выбрать», как в Telegram.
                if action == .select, index > 0 {
                    Rectangle()
                        .fill(Palette.foreground.opacity(0.15))
                        .frame(height: 1 / displayScale)
                        .padding(.horizontal, Spacing.xl)
                        .padding(.vertical, Spacing.sm)
                        .accessibilityHidden(true)
                }
                // Как в Telegram: значок слева, подпись за ним, линий между пунктами нет.
                HStack(spacing: Spacing.lg) {
                    Image(systemName: action.symbol)
                        .font(.body)
                        .frame(width: 24)
                    Text(action.title)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
                .font(Typography.body)
                .foregroundStyle(action.isDestructive ? Palette.destructive : Palette.foreground)
                .padding(.horizontal, Spacing.xl)
                .frame(height: rowHeight)
                .background(pressed == action ? Palette.foreground.opacity(0.12) : Color.clear)
                .opacity(isEnabled(action) ? 1 : 0.4)
                .contentShape(Rectangle())
                .background {
                    GeometryReader { row in
                        Color.clear.preference(
                            key: MenuRowFrames.self,
                            value: [action.id: row.frame(in: .global)]
                        )
                    }
                }
                // VoiceOver и UI-тесты нажимают пункт как кнопку.
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isButton)
                .accessibilityIdentifier("message.menu.\(action.id)")
                .accessibilityAction { perform(action) }
            }
        }
        .padding(.vertical, Spacing.sm)
        .frame(width: Self.menuWidth)
        // Подсветка крайних пунктов не вылезает за скругление.
        .clipShape(shape)
        .onPreferenceChange(MenuRowFrames.self) { rowFrames = $0 }
        .contentShape(shape)
        .gesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .global)
                .onChanged { drag in pressed = action(at: drag.location) }
                .onEnded { drag in
                    let chosen = action(at: drag.location)
                    pressed = nil
                    if let chosen { perform(chosen) }
                }
        )
        .sensoryFeedback(.selection, trigger: pressed) { _, now in now != nil }
        // Плотная тёмная подложка под стеклом, как у меню Telegram: пузырь и обои под
        // панелью не просвечивают, текст читается на любом фоне.
        .background(Palette.popover.opacity(0.85), in: shape)
        .floatingGlass(in: shape)
        .scaleEffect(shown ? 1 : 0.6, anchor: request.item.isOwn ? .topTrailing : .topLeading)
        .opacity(shown ? 1 : 0)
        .offset(x: leading(width: Self.menuWidth, screen: layout.screen), y: layout.menuY)
        .transition(.opacity)
    }

    /// Палец, которым меню открыли, ещё на экране: ведёт подсветку, отпускание над
    /// пунктом — выбор. Отпустили мимо пунктов (на месте нажатия) — меню остаётся.
    private func follow(_ phase: MessageMenuTouch.Phase) {
        switch phase {
        case .idle:
            break
        case .moving(let point):
            guard !expanded else { return }
            pressed = action(at: point)
        case .released(let point):
            MessageMenuTouch.shared.reset()
            let chosen = expanded ? nil : action(at: point)
            pressed = nil
            if let chosen { perform(chosen) }
        }
    }

    private func isEnabled(_ action: MessageMenuAction) -> Bool {
        action != .readers(count: 0)
    }

    /// Пункт под точкой панели; мимо пунктов или неактивный — ничего.
    private func action(at point: CGPoint) -> MessageMenuAction? {
        request.actions.first { action in
            isEnabled(action) && rowFrames[action.id]?.contains(point) == true
        }
    }

    private func perform(_ action: MessageMenuAction) {
        onAction(action)
        dismiss()
    }

    private func dismiss() {
        guard shown else { return }
        withAnimation(Motion.respecting(.spring(duration: 0.25, bounce: 0), reduceMotion: reduceMotion)) {
            shown = false
            expanded = false
        }
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(reduceMotion ? 50 : 230))
            onDismiss()
        }
    }
}

/// «Хвостик» панели реакций, как в Telegram: кружок у края панели и кружок поменьше
/// ближе к пузырю — панель будто выдута из сообщения.
private struct ReactionTail: View {
    static let big: CGFloat = 12
    static let small: CGFloat = 6

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.clear
                .frame(width: Self.big, height: Self.big)
                .floatingGlass(in: Circle())
            Color.clear
                .frame(width: Self.small, height: Self.small)
                .floatingGlass(in: Circle())
                .offset(x: -Self.small, y: Self.big - 1)
        }
        .frame(width: Self.big, height: Self.big, alignment: .topLeading)
        .allowsHitTesting(false)
    }
}

/// Рамки пунктов меню в его системе координат — по ним палец находит пункт.
private struct MenuRowFrames: PreferenceKey {
    static let defaultValue: [String: CGRect] = [:]

    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
        value.merge(nextValue()) { $1 }
    }
}

/// Панель реакций: быстрые emoji и стрелка к полному выбору (недавние + каталог).
struct ReactionPicker: View {
    @Binding var expanded: Bool
    let mine: String?
    let onPick: (String) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if expanded {
            EmojiBrowser(columns: 8, onPick: onPick)
                .transition(.opacity)
        } else {
            HStack(spacing: 0) {
                ForEach(EmojiCatalog.quickReactions, id: \.self) { emoji in
                    Button {
                        onPick(emoji)
                    } label: {
                        Text(verbatim: emoji)
                            .font(.system(size: 28))
                            .frame(width: 42, height: 42)
                            .background(emoji == mine ? Palette.primary.opacity(0.2) : Color.clear, in: Circle())
                    }
                    .buttonStyle(ReactionButtonStyle())
                    .accessibilityIdentifier("message.react.\(emoji)")
                    .accessibilityLabel(Text(verbatim: emoji))
                    .accessibilityAddTraits(emoji == mine ? .isSelected : [])
                }
                Button {
                    withAnimation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion)) { expanded = true }
                } label: {
                    Image(systemName: "chevron.down")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Palette.mutedForeground)
                        .frame(width: 42, height: 42)
                }
                .buttonStyle(ReactionButtonStyle())
                .accessibilityLabel(Text(String(localized: "chats.reactions.more", defaultValue: "Другие реакции")))
            }
            .padding(.horizontal, Spacing.md)
        }
    }
}
