import SwiftUI
import UniformTypeIdentifiers

/// Вкладки папок над списком чатов, как в Telegram: стеклянная дорожка, у своей папки —
/// число непрочитанных чатов, в режиме «Изм.» — крестик удаления и перетаскивание.
///
/// Свой вид, а не `FilterChips`: у капсул фильтров нет ни счётчиков, ни правки, а
/// дорожка папок — единственное место, где они нужны. Внешне — та же дорожка: стекло,
/// «таблетка» выбранного, тающие края.
struct ChatFolderTabs<MenuContent: View>: View {
    let tabs: [ChatListTab]
    @Binding var selection: ChatListTab?
    let badges: [String: ChatFolderBadge]
    let isEditing: Bool
    /// Крестик у своей папки в режиме правки — подтверждение спрашивает экран.
    let delete: (String) -> Void
    /// Новый порядок своих папок — id слева направо.
    let reorder: ([String]) -> Void
    /// Меню долгого нажатия на вкладку. В режиме правки меню нет: долгое нажатие там
    /// начинает перетаскивание.
    @ViewBuilder let menu: (ChatListTab) -> MenuContent

    /// Порядок на экране. Во время перетаскивания живёт своей жизнью и уходит наверх
    /// одним вызовом, когда палец отпущен.
    @State private var order: [ChatListTab]
    @State private var dragging: ChatListTab?

    @Namespace private var pill
    @Environment(\.motionReduced) private var reduceMotion

    init(
        tabs: [ChatListTab],
        selection: Binding<ChatListTab?>,
        badges: [String: ChatFolderBadge],
        isEditing: Bool,
        delete: @escaping (String) -> Void,
        reorder: @escaping ([String]) -> Void,
        @ViewBuilder menu: @escaping (ChatListTab) -> MenuContent
    ) {
        self.tabs = tabs
        _selection = selection
        self.badges = badges
        self.isEditing = isEditing
        self.delete = delete
        self.reorder = reorder
        self.menu = menu
        _order = State(initialValue: tabs)
    }

    var body: some View {
        ScrollViewReader { scroller in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 2) {
                    ForEach(order, id: \.self) { tab in
                        chip(tab)
                            .id(tab)
                    }
                }
                .padding(4)
                // Отпустили между вкладками — порядок всё равно сохраняется.
                .onDrop(of: [.text], delegate: FolderTabDrop(target: nil, order: $order, dragging: $dragging, animation: animation, commit: commit))
            }
            .scrollClipDisabled(false)
            .modifier(ScrollEdgeFade())
            .onAppear { reveal(selection, with: scroller, animated: false) }
            .onChange(of: selection) { _, value in reveal(value, with: scroller, animated: true) }
        }
        .clipShape(Capsule())
        .glassSurface(interactive: false, in: Capsule())
        .sensoryFeedback(.selection, trigger: selection)
        .onChange(of: tabs) { _, tabs in
            if dragging == nil { order = tabs }
        }
        .onChange(of: isEditing) { _, editing in
            // Перетаскивание бросили за пределами дорожки — сохраняем то, что на экране.
            if !editing {
                if dragging != nil { commit() }
                order = tabs
            }
        }
    }

    private var animation: Animation? {
        Motion.respecting(Motion.snappy, reduceMotion: reduceMotion)
    }

    private func reveal(_ value: ChatListTab?, with scroller: ScrollViewProxy, animated: Bool) {
        guard let value, order.contains(value) else { return }
        if animated, !reduceMotion {
            withAnimation(Motion.snappy) { scroller.scrollTo(value, anchor: .center) }
        } else {
            scroller.scrollTo(value, anchor: .center)
        }
    }

    private func commit() {
        dragging = nil
        let ids = order.compactMap(\.folderID)
        guard ids != tabs.compactMap(\.folderID) else { return }
        reorder(ids)
    }

    // MARK: Вкладка

    @ViewBuilder
    private func chip(_ tab: ChatListTab) -> some View {
        let isOn = tab == selection
        let folderID = tab.folderID
        let editable = isEditing && folderID != nil
        HStack(spacing: Spacing.xs) {
            Button {
                withAnimation(animation) { selection = tab }
            } label: {
                HStack(spacing: Spacing.xs) {
                    Text(ChatTabTitle.title(of: tab))
                        .font(.subheadline.weight(isOn ? .semibold : .medium))
                        .lineLimit(1)
                        .foregroundStyle(isOn ? Palette.foreground : Palette.mutedForeground)
                    if !editable, let folderID, let badge = badges[folderID] {
                        FolderTabBadge(badge: badge)
                    }
                }
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(isOn ? .isSelected : [])

            if editable, let folderID {
                Button {
                    delete(folderID)
                } label: {
                    Image(systemName: "xmark")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Palette.mutedForeground)
                        .frame(width: 18, height: 18)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .transition(.scale(scale: 0.5).combined(with: .opacity))
                .accessibilityLabel(Text(String(localized: "chats.folders.delete", defaultValue: "Удалить папку")))
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background {
            if isOn {
                Capsule()
                    .fill(Palette.foreground.opacity(0.12))
                    .matchedGeometryEffect(id: "pill", in: pill)
            }
        }
        .opacity(dragging == tab ? 0.4 : 1)
        .contentShape(Capsule())
        .modifier(FolderTabInteraction(
            tab: tab,
            canDrag: editable,
            hasMenu: !isEditing,
            order: $order,
            dragging: $dragging,
            animation: animation,
            commit: commit,
            menu: { menu(tab) }
        ))
    }
}

/// Число непрочитанных чатов папки. Чаты без звука — серым и только когда других нет:
/// так считает Telegram.
private struct FolderTabBadge: View {
    let badge: ChatFolderBadge

    var body: some View {
        let count = badge.unread > 0 ? badge.unread : badge.mutedUnread
        if count > 0 {
            Text(verbatim: count > 99 ? "99+" : count.formatted())
                .font(Typography.tabular(.caption2).weight(.bold))
                .foregroundStyle(Palette.primaryForeground)
                .padding(.horizontal, 5)
                .frame(minWidth: 18, minHeight: 18)
                .background(badge.unread > 0 ? Palette.primary : Palette.mutedForeground, in: Capsule())
                .contentTransition(.numericText(value: Double(count)))
                .accessibilityLabel(Text(String(
                    localized: "chats.unreadCount",
                    defaultValue: "Непрочитанных: \(count.formatted())"
                )))
        }
    }
}

/// Меню вне правки и перетаскивание в ней. Своя папка двигается только среди своих:
/// бросить её можно лишь на другую свою папку.
private struct FolderTabInteraction<MenuContent: View>: ViewModifier {
    let tab: ChatListTab
    let canDrag: Bool
    let hasMenu: Bool
    @Binding var order: [ChatListTab]
    @Binding var dragging: ChatListTab?
    let animation: Animation?
    let commit: () -> Void
    @ViewBuilder let menu: () -> MenuContent

    func body(content: Content) -> some View {
        if canDrag, let id = tab.folderID {
            content
                .onDrag {
                    dragging = tab
                    return NSItemProvider(object: id as NSString)
                } preview: {
                    Text(ChatTabTitle.title(of: tab))
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(Palette.muted, in: Capsule())
                }
                .onDrop(
                    of: [.text],
                    delegate: FolderTabDrop(target: tab, order: $order, dragging: $dragging, animation: animation, commit: commit)
                )
        } else if hasMenu {
            content
                .contentShape(.contextMenuPreview, Capsule())
                .contextMenu { menu() }
        } else {
            content
        }
    }
}

/// Перестановка на лету: папка под пальцем меняется местами с той, над которой он
/// оказался. `target == nil` — сама дорожка: там папку только отпускают.
private struct FolderTabDrop: DropDelegate {
    let target: ChatListTab?
    @Binding var order: [ChatListTab]
    @Binding var dragging: ChatListTab?
    let animation: Animation?
    let commit: () -> Void

    func dropEntered(info: DropInfo) {
        guard let target, let dragging, dragging != target,
              let from = order.firstIndex(of: dragging), let to = order.firstIndex(of: target)
        else { return }
        withAnimation(animation) {
            order.move(fromOffsets: IndexSet(integer: from), toOffset: to > from ? to + 1 : to)
        }
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        DropProposal(operation: .move)
    }

    func validateDrop(info: DropInfo) -> Bool {
        dragging != nil
    }

    func performDrop(info: DropInfo) -> Bool {
        commit()
        return true
    }
}
