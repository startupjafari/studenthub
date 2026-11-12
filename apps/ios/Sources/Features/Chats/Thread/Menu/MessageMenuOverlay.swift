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
        case .edit: "pencil"
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .body) private var rowHeight: CGFloat = 44

    private static let gap: CGFloat = 8
    private static let reactionsHeight: CGFloat = 48
    private static let menuWidth: CGFloat = 250
    private static let edge: CGFloat = 8

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
        .sensoryFeedback(.impact(weight: .medium), trigger: shown) { _, now in now }
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

    private var menuHeight: CGFloat { CGFloat(request.actions.count) * rowHeight }

    private func layout(in proxy: GeometryProxy) -> Layout {
        let size = proxy.size
        let insets = proxy.safeAreaInsets
        let safeTop = insets.top + Self.edge
        // Открытая клавиатура остаётся поверх меню — раскладываемся над ней.
        let floor = min(size.height - insets.bottom, KeyboardFrame.shared.top ?? .infinity)
        let safeBottom = floor - Self.edge
        let row = request.rowRect
        // Пузырь внутри строки может начинаться ниже (имя автора, отступы).
        let bubbleOffset = max(0, request.bubbleRect.minY - row.minY)
        let above = request.canReact ? Self.reactionsHeight + Self.gap - bubbleOffset : 0
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
            reactionsY: top + bubbleOffset - Self.gap - Self.reactionsHeight,
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
        let height: CGFloat = expanded ? min(320, layout.safeBottom - max(layout.reactionsY, layout.safeTop)) : Self.reactionsHeight
        let y = expanded ? max(layout.reactionsY, layout.safeTop) : layout.reactionsY
        return ReactionPicker(
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
        .scaleEffect(shown ? 1 : 0.6, anchor: anchor)
        .opacity(shown ? 1 : 0)
        .offset(x: leading(width: width, screen: layout.screen), y: y)
        .animation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion), value: expanded)
    }

    private func menu(_ layout: Layout) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(request.actions.enumerated()), id: \.element.id) { index, action in
                Button {
                    onAction(action)
                    dismiss()
                } label: {
                    HStack(spacing: Spacing.lg) {
                        Text(action.title)
                            .lineLimit(1)
                        Spacer(minLength: Spacing.md)
                        Image(systemName: action.symbol)
                            .frame(width: 24)
                    }
                    .font(Typography.body)
                    .foregroundStyle(action.isDestructive ? Palette.destructive : Palette.foreground)
                    .padding(.horizontal, Spacing.xl)
                    .frame(height: rowHeight)
                    .contentShape(Rectangle())
                }
                .buttonStyle(MenuRowStyle())
                .accessibilityIdentifier("message.menu.\(action.id)")
                .disabled(action == .readers(count: 0))
                if index < request.actions.count - 1 {
                    Divider().padding(.leading, Spacing.xl)
                }
            }
        }
        .frame(width: Self.menuWidth)
        .floatingGlass(in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .scaleEffect(shown ? 1 : 0.6, anchor: request.item.isOwn ? .topTrailing : .topLeading)
        .opacity(shown ? 1 : 0)
        .offset(x: leading(width: Self.menuWidth, screen: layout.screen), y: layout.menuY)
        .transition(.opacity)
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

/// Подсветка нажатого пункта меню, как в системных меню.
private struct MenuRowStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? Palette.muted : Color.clear)
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
            EmojiGrid(columns: 7, onPick: onPick)
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

/// Emoji под пальцем подрастает, как в Telegram.
private struct ReactionButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 1.25 : 1)
            .animation(.spring(duration: 0.2, bounce: 0.4), value: configuration.isPressed)
    }
}

/// Сетка emoji: сверху недавние, дальше — разделы каталога с быстрым переходом.
struct EmojiGrid: View {
    var columns = 8
    let onPick: (String) -> Void

    private var recent: [String] { RecentEmoji.shared.items }

    var body: some View {
        ScrollViewReader { reader in
            VStack(spacing: 0) {
                ScrollView {
                    LazyVGrid(
                        columns: Array(repeating: GridItem(.flexible(), spacing: 0), count: columns),
                        alignment: .leading,
                        spacing: 2,
                        pinnedViews: [.sectionHeaders]
                    ) {
                        if !recent.isEmpty {
                            section(
                                id: "recent",
                                title: String(localized: "emoji.recent", defaultValue: "Недавние"),
                                emoji: recent
                            )
                        }
                        ForEach(EmojiCatalog.categories) { category in
                            section(id: category.id, title: category.title, emoji: category.emoji)
                        }
                    }
                    .padding(.horizontal, Spacing.sm)
                }
                Divider()
                HStack(spacing: 0) {
                    ForEach(EmojiCatalog.categories) { category in
                        Button {
                            withAnimation { reader.scrollTo(category.id, anchor: .top) }
                        } label: {
                            Image(systemName: category.symbol)
                                .font(.subheadline)
                                .foregroundStyle(Palette.mutedForeground)
                                .frame(maxWidth: .infinity, minHeight: 36)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(category.title))
                    }
                }
            }
        }
    }

    private func section(id: String, title: String, emoji: [String]) -> some View {
        Section {
            ForEach(emoji, id: \.self) { item in
                Button {
                    onPick(item)
                } label: {
                    Text(verbatim: item)
                        .font(.system(size: 30))
                        .frame(maxWidth: .infinity, minHeight: 42)
                }
                .buttonStyle(ReactionButtonStyle())
                .accessibilityLabel(Text(verbatim: item))
            }
        } header: {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Palette.mutedForeground)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, Spacing.xs)
                .padding(.horizontal, Spacing.xs)
                .background(.bar)
                .id(id)
        }
    }
}
