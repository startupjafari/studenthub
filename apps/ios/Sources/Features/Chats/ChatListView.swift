import GRDB
import SwiftUI

/// Список чатов в духе Telegram для iOS 26.
///
/// Рисуется из базы и потому открывается мгновенно и в самолёте. Сеть здесь только
/// догоняет: ошибка запроса показывается строкой сверху, а список продолжает жить.
/// Сверху — поле поиска на всю ширину и стеклянная дорожка папок; слева в панели —
/// «Изм.» (выбор нескольких чатов), справа — синяя кнопка нового чата. Архив — строкой
/// над списком и отдельным экраном, как в Telegram.
struct ChatListView: View {
    /// Экран архива: те же строки и действия, без папок и кнопки нового чата.
    var isArchive = false

    @State private var model = ChatListModel()
    @State private var query = ""
    @State private var chip: ChatListTab? = .all
    @State private var composing: NewChatKind?
    @State private var clearing: ChatListRow?
    @State private var clearingPeriod: ChatListRow?
    @State private var deleting: [ChatListRow] = []
    @State private var editMode: EditMode = .inactive
    @State private var selection: Set<String> = []
    @State private var showsArchive = false
    @State private var didStart = false
    @State private var folders = ChatFoldersModel()
    @State private var showsFolders = false
    @State private var showsBlocked = false
    @State private var editingFolder: ChatFolderEditTarget?
    @State private var deletingFolder: ChatFolderDTO?
    /// Список катится пальцем или по инерции — перестановки строк не анимируются: пружина
    /// посреди прокрутки дёргала строки под пальцем.
    @State private var isScrolling = false
    /// Истории в шапке: стопка авторов с непросмотренным, касание — просмотр.
    @State private var stories = StoriesModel()
    @State private var viewingRing: ChatStoryTarget?
    @Environment(\.viewerID) private var viewerID
    @Environment(\.motionReduced) private var reduceMotion
    private var realtime: RealtimeCoordinator { AppServices.realtime }

    private var isEditing: Bool { editMode.isEditing }
    private var isSearching: Bool { !query.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        withDialogs(list)
            .task {
                // `.task` повторяется при каждом возврате из чата. Наблюдения за базой
                // живут, пока жив экран, — пересоздавать их незачем, а сокет и так держит
                // список свежим; полный обход страниц — раз за показ вкладки и жестом.
                guard !didStart else { return }
                didStart = true
                model.start(archive: isArchive)
                if !isArchive { folders.start() }
                await reload()
            }
    }

    // MARK: Список

    private var list: some View {
        List(selection: $selection) {
            // Пустой список со сбоем загрузки — ошибка на весь экран (`emptyState`), строка
            // не нужна. Отказ действия показывается строкой всегда.
            if let failure = model.failure, !(showsEmptyState && model.loadFailure == failure) {
                FormAlert(message: failure)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            if let failure = folders.failure {
                FormAlert(message: failure)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            if isSearching {
                ChatSearchResults(query: query, rows: model.rows)
            } else {
                if showsArchiveRow {
                    Button {
                        showsArchive = true
                    } label: {
                        ChatArchiveRowView(rows: model.archived)
                    }
                    .buttonStyle(.plain)
                    .listRowInsets(Self.rowInsets)
                    .listRowBackground(Palette.plainBackground)
                }
                ForEach(model.rows) { row in
                    rowView(row)
                        .tag(row.id)
                        // Ручки ≡ в режиме «Изм.» — только у закреплённых, как в Telegram:
                        // остальной список упорядочен свежестью, а не руками.
                        .moveDisabled(!row.isPinned)
                }
                .onMove(perform: pinnedMove)
            }
        }
        .listStyle(.plain)
        // Живые изменения — пружиной, как в Telegram: чат с новым сообщением уезжает
        // наверх, закреплённый встаёт к закреплённым, архивный уходит из списка, счётчик
        // перещёлкивает цифры. Ревизия растёт только на изменениях после первого среза
        // (`ChatListModel.liveRevision`): открытие экрана и смена вкладки не анимируются.
        .animation(
            isScrolling ? nil : Motion.respecting(Motion.calm, reduceMotion: reduceMotion),
            value: model.liveRevision
        )
        .modifier(ScrollActivityTracker(isScrolling: $isScrolling))
        // Папки закреплены под поиском, как в Telegram: строкой списка они уезжали под
        // заголовок и поле поиска и наслаивались на них. Список под ними тает мягко.
        .softEdgeBar(edge: .top) { tabsBar }
        .environment(\.editMode, $editMode)
        .overlay { emptyState }
        .listSearch(
            text: $query,
            prompt: Text(String(localized: "chats.search.prompt.short", defaultValue: "Поиск"))
        )
        .pullToRefresh {
            await reload()
        }
        .navigationTitle(Text(isArchive
            ? String(localized: "chats.tab.archive", defaultValue: "Архив")
            : AppTab.chats.title))
        .toolbar { toolbarContent }
        .toolbar(isEditing ? .hidden : .automatic, for: .tabBar)
        .navigationDestination(isPresented: $showsArchive) {
            ChatListView(isArchive: true)
        }
        .navigationDestination(isPresented: $showsFolders) {
            ChatFoldersView(model: folders)
        }
        .navigationDestination(isPresented: $showsBlocked) {
            BlockedUsersView()
        }
        .onChange(of: chip) {
            model.select(chip ?? .all)
        }
        .onChange(of: model.tab) {
            if chip != model.tab { chip = model.tab }
        }
        .onChange(of: model.rows.map(\.id)) {
            // Чат ушёл из списка (удалён, перенесён в архив) — снимаем с него выбор.
            selection.formIntersection(Set(model.rows.map(\.id)))
        }
    }

    /// Список и истории шапки друг от друга не зависят — разом. Архиву истории не нужны.
    private func reload() async {
        guard !isArchive else {
            await model.refresh()
            return
        }
        async let list: Void = model.refresh()
        async let rings: Void = stories.refresh()
        _ = await (list, rings)
    }

    /// Перетаскивание закреплённых — только в режиме «Изм.»: вне его долгое нажатие
    /// открывает меню чата.
    private var pinnedMove: ((IndexSet, Int) -> Void)? {
        guard isEditing else { return nil }
        return { source, destination in model.movePinned(from: source, to: destination) }
    }

    /// Строка «Архив» — только во «Все» и только когда в архиве что-то есть.
    private var showsArchiveRow: Bool {
        !isArchive && !isEditing && model.tab == .all && !model.archived.isEmpty
    }

    static let rowInsets = EdgeInsets(top: 0, leading: Spacing.lg, bottom: 0, trailing: Spacing.lg)

    private var showsEmptyState: Bool {
        model.rows.isEmpty && !isSearching && !showsArchiveRow
    }

    @ViewBuilder
    private var emptyState: some View {
        if showsEmptyState {
            if model.isRefreshing {
                ProgressView()
            } else if let failure = model.loadFailure {
                // В базе пусто и сервер не ответил — это не «чатов нет».
                ErrorStateView(message: failure, isOffline: model.isOffline) { await model.refresh() }
            } else if case .folder(let id, _) = model.tab {
                EmptyStateView(
                    title: String(localized: "chats.folders.emptyFolder", defaultValue: "В папке пока нет чатов"),
                    symbol: "folder",
                    hint: String(localized: "chats.folders.emptyFolder.hint", defaultValue: "Добавьте чаты в папку"),
                    actionTitle: String(localized: "chats.folders.addChats", defaultValue: "Добавить чаты"),
                    action: {
                        if let folder = folders.folder(id: id) { editingFolder = .edit(folder) }
                    }
                )
            } else if isArchive {
                ContentUnavailableView(
                    String(localized: "chats.archive.empty", defaultValue: "В архиве пусто"),
                    systemImage: "archivebox"
                )
            } else {
                ContentUnavailableView {
                    Label(String(localized: "chats.empty", defaultValue: "Чатов пока нет"), systemImage: "bubble.left.and.bubble.right")
                } description: {
                    Text(String(localized: "chats.empty.hint", defaultValue: "Напишите однокурснику или преподавателю"))
                } actions: {
                    Button(String(localized: "chats.new", defaultValue: "Новый чат")) { composing = .direct }
                        .glassProminentButton()
                }
            }
        }
    }

    // MARK: Папки

    /// Папки и вкладки по типу — стеклянной дорожкой над списком, как папки Telegram.
    /// «Архив» здесь не вкладка, а строка под ними. У своих папок — число непрочитанных
    /// чатов, в режиме «Изм.» — крестик и перетаскивание.
    @ViewBuilder
    private var tabsBar: some View {
        let tabs = model.tabs.filter { $0 != .archive }
        if !isArchive, tabs.count > 1, !isSearching {
            ChatFolderTabs(
                tabs: tabs,
                selection: $chip,
                badges: model.folderSummary.badges,
                isEditing: isEditing,
                delete: { id in deletingFolder = folders.folder(id: id) },
                reorder: { ids in folders.reorder(ids) },
                menu: tabMenu
            )
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.xs)
        }
    }

    /// Долгое нажатие на вкладку, как в Telegram: у своей папки — настройка, состав,
    /// прочтение, звук и удаление, ниже — перестановка вкладок; у встроенной — путь к
    /// настройке папок. Значки слева, как во всех меню приложения.
    @ViewBuilder
    private func tabMenu(_ tab: ChatListTab) -> some View {
        if case .folder(let id, _) = tab, let folder = folders.folder(id: id) {
            let badge = model.folderSummary.badges[id] ?? ChatFolderBadge()
            Button {
                editingFolder = .edit(folder)
            } label: {
                Label(String(localized: "chats.folders.configure", defaultValue: "Настроить папку"), systemImage: "square.and.pencil")
            }
            Button {
                editingFolder = .edit(folder, addingChats: true)
            } label: {
                Label(String(localized: "chats.folders.addChats", defaultValue: "Добавить чаты"), systemImage: "plus")
            }
            if badge.unread + badge.mutedUnread > 0 {
                Button {
                    Task { await model.markFolderRead(folderID: id) }
                } label: {
                    Label(String(localized: "chats.folders.readAll", defaultValue: "Прочитать все"), systemImage: "envelope.open")
                }
            }
            if badge.total > 0 {
                Button {
                    Task { await folders.setMuted(!badge.allMuted, folderID: id) }
                } label: {
                    if badge.allMuted {
                        Label(String(localized: "chats.folders.unmute", defaultValue: "Вкл. уведомления"), systemImage: "bell")
                    } else {
                        Label(String(localized: "chats.folders.mute", defaultValue: "Выкл. уведомления"), systemImage: "bell.slash")
                    }
                }
            }
            Button(role: .destructive) {
                deletingFolder = folder
            } label: {
                Label(String(localized: "chats.folders.deleteShort", defaultValue: "Удалить"), systemImage: "trash")
            }
            Divider()
            Button {
                startEditing()
            } label: {
                Label(String(localized: "chats.folders.reorder", defaultValue: "Изменить порядок"), systemImage: "arrow.left.arrow.right")
            }
        } else {
            Button {
                showsFolders = true
            } label: {
                Label(String(localized: "chats.folders.manage", defaultValue: "Настроить папки"), systemImage: "folder.badge.gearshape")
            }
            if folders.folders.count > 1 {
                Divider()
                Button {
                    startEditing()
                } label: {
                    Label(String(localized: "chats.folders.reorder", defaultValue: "Изменить порядок"), systemImage: "arrow.left.arrow.right")
                }
            }
        }
    }

    // MARK: Панель

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        if !isArchive, !isEditing, !unseenStories.isEmpty {
            ToolbarItem(placement: .principal) {
                ChatStoriesTitle(rings: unseenStories) {
                    viewingRing = unseenStories.first.map { ChatStoryTarget(id: $0.id) }
                }
            }
        }
        ToolbarItem(placement: isArchive ? .topBarTrailing : .topBarLeading) {
            Button {
                toggleEditing()
            } label: {
                Text(isEditing
                    ? String(localized: "chats.edit.done", defaultValue: "Готово")
                    : String(localized: "chats.edit", defaultValue: "Изм."))
                    .fontWeight(isEditing ? .semibold : .regular)
            }
            .disabled(model.rows.isEmpty && !isEditing)
        }
        if !isArchive, !isEditing {
            ToolbarItem(placement: .topBarTrailing) {
                composeMenu
            }
        }
        if isEditing {
            ToolbarItemGroup(placement: .bottomBar) {
                bulkActions
            }
        }
    }

    /// Новый чат: синяя круглая кнопка, на iOS 26 — тонированное стекло.
    private var composeMenu: some View {
        Menu {
            Button {
                composing = .direct
            } label: {
                Label(String(localized: "chats.new", defaultValue: "Новый чат"), systemImage: "person")
            }
            Button {
                composing = .group
            } label: {
                Label(String(localized: "chats.newGroup", defaultValue: "Новая группа"), systemImage: "person.3")
            }
            Button {
                Task { await openSaved() }
            } label: {
                Label(String(localized: "chats.saved", defaultValue: "Избранное"), systemImage: "bookmark")
            }
            Divider()
            Button {
                showsFolders = true
            } label: {
                Label(String(localized: "chats.folders.title", defaultValue: "Папки с чатами"), systemImage: "folder.badge.gearshape")
            }
            // Как в меню шапки чатов веба: чёрный список рядом с папками.
            Button {
                showsBlocked = true
            } label: {
                Label(String(localized: "chats.blocked.title", defaultValue: "Заблокированные"), systemImage: "hand.raised")
            }
        } label: {
            Image(systemName: "square.and.pencil")
                .fontWeight(.semibold)
        }
        .menuStyle(.button)
        .glassProminentButton()
        .buttonBorderShape(.circle)
        .tint(Palette.primary)
        .accessibilityLabel(Text(String(localized: "chats.new", defaultValue: "Новый чат")))
        .accessibilityIdentifier("chatlist.compose")
    }

    /// Нижняя панель режима правки: то, что API умеет делать с чатом.
    @ViewBuilder
    private var bulkActions: some View {
        let chosen = selectedRows
        Button {
            let rows = chosen.isEmpty ? model.rows : chosen
            Task {
                await model.markRead(rows)
                finishEditing()
            }
        } label: {
            Text(chosen.isEmpty
                ? String(localized: "chats.bulk.readAll", defaultValue: "Прочитать все")
                : String(localized: "chats.bulk.read", defaultValue: "Прочитать"))
        }
        .disabled(!(chosen.isEmpty ? model.rows : chosen).contains(where: \.isUnread))

        Spacer()

        Button {
            Task {
                await model.setArchived(!isArchive, rows: chosen)
                finishEditing()
            }
        } label: {
            Text(isArchive
                ? String(localized: "chats.unarchive", defaultValue: "Из архива")
                : String(localized: "chats.archive", defaultValue: "В архив"))
        }
        .disabled(chosen.isEmpty)

        Spacer()

        Button(role: .destructive) {
            deleting = chosen.filter(canDelete)
        } label: {
            Text(String(localized: "feed.delete", defaultValue: "Удалить"))
        }
        .disabled(!chosen.contains(where: canDelete))
    }

    private var selectedRows: [ChatListRow] {
        model.rows.filter { selection.contains($0.id) }
    }

    private func toggleEditing() {
        withAnimation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion)) {
            editMode = isEditing ? .inactive : .active
            selection = []
        }
    }

    /// «Изменить порядок» из меню вкладки — тот же режим «Изм.»: вкладки получают
    /// крестики и перетаскивание, закреплённые — ручки.
    private func startEditing() {
        guard !isEditing else { return }
        withAnimation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion)) {
            editMode = .active
            selection = []
        }
    }

    /// Авторы с непросмотренными историями — до трёх, своё кольцо не в счёт. Раздел
    /// выключен или не загрузился — пусто, и шапка остаётся прежней.
    private var unseenStories: [StoryRingDTO] {
        guard stories.failure == nil else { return [] }
        return Array(stories.rings.filter { $0.hasUnseen && $0.author.id != viewerID }.prefix(3))
    }

    private func finishEditing() {
        withAnimation(Motion.respecting(Motion.calm, reduceMotion: reduceMotion)) {
            editMode = .inactive
            selection = []
        }
    }

    // MARK: Диалоги

    private func withDialogs<V: View>(_ view: V) -> some View {
        view
            .sheet(item: $editingFolder) { target in
                ChatFolderEditorView(model: folders, target: target)
            }
            .chatFolderDeleteAlert($deletingFolder, model: folders)
            .fullScreenCover(item: $viewingRing) { target in
                StoryViewer(model: stories, startRingID: target.id)
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("stories.viewer")
            }
            .sheet(item: $clearingPeriod) { row in
                // Последнее сообщение могло попасть в период — превью в списке берём заново.
                ChatClearPeriodSheet(chatID: row.id) { await model.refresh() }
            }
            .sheet(item: $composing) { kind in
                NewChatView(kind: kind) { chatID in
                    composing = nil
                    Task {
                        await model.refresh()
                        AppServices.router.push(.chat(id: chatID), in: .chats)
                    }
                }
            }
            .alert(
                String(localized: "chats.clear.title", defaultValue: "Очистить историю у себя?"),
                isPresented: Binding(get: { clearing != nil }, set: { if !$0 { clearing = nil } }),
                presenting: clearing
            ) { row in
                Button(String(localized: "chats.clear", defaultValue: "Очистить историю"), role: .destructive) {
                    Task { await model.clearHistory(row) }
                }
                Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
            } message: { _ in
                Text(String(localized: "chats.clear.message", defaultValue: "У собеседников переписка останется."))
            }
            .alert(
                deleting.count > 1
                    ? String(localized: "chats.delete.selected.title", defaultValue: "Удалить выбранные чаты?")
                    : ChatLeaveTitle.question(for: deleting.first?.kind ?? .private, isOwner: deleting.first?.isOwner ?? false),
                isPresented: Binding(get: { !deleting.isEmpty }, set: { if !$0 { deleting = [] } }),
                presenting: deleting.isEmpty ? nil : deleting
            ) { rows in
                Button(
                    rows.count == 1
                        ? ChatLeaveTitle.title(for: rows[0].kind, isOwner: rows[0].isOwner)
                        : String(localized: "chats.delete.selected", defaultValue: "Удалить и покинуть"),
                    role: .destructive
                ) {
                    Task {
                        await model.delete(rows)
                        finishEditing()
                    }
                }
                Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
            } message: { rows in
                if rows.count > 1 {
                    Text(String(
                        localized: "chats.delete.selected.message",
                        defaultValue: "Личные чаты удалятся у вас, из групп вы выйдете."
                    ))
                }
            }
    }

    // MARK: Строка

    private func rowView(_ row: ChatListRow) -> some View {
        // Ссылка спрятана под строкой: так у строки нет стрелки справа, как в Telegram,
        // а касание по-прежнему открывает чат.
        // «Печатает…» строка читает сама из наблюдаемого объекта своего чата: из общего
        // словаря в теле списка любое событие набора пересчитывало бы весь список.
        ChatRowView(
            row: row,
            activity: realtime.activity(for: row.id),
            isGroup: row.kind != .private && row.kind != .saved,
            // Теги папок — только во «Все»: на вкладке папки её же тег ничего не говорит.
            tags: !isArchive && model.tab == .all ? model.folderSummary.tags[row.id] ?? [] : []
        )
        .accessibilityIdentifier("chatlist.row.\(row.id)")
        .background {
            NavigationLink(value: AppRoute.chat(id: row.id)) { EmptyView() }
                .opacity(0)
        }
        .listRowInsets(Self.rowInsets)
        .listRowBackground(ChatRowBackground(isPinned: row.isPinned))
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            // Как в Telegram: «Прочитано» у непрочитанного, «Непрочитано» — у остальных.
            Button {
                Task { await model.toggleMarkedUnread(row) }
            } label: {
                if row.isUnread {
                    Label(String(localized: "chats.markRead", defaultValue: "Прочитано"), systemImage: "checkmark.message.fill")
                } else {
                    Label(String(localized: "chats.markUnread.short", defaultValue: "Непрочитано"), systemImage: "message.badge.fill")
                }
            }
            .tint(Palette.primary)
            Button {
                Task { await model.togglePinned(row) }
            } label: {
                Label(pinTitle(row), systemImage: row.isPinned ? "pin.slash.fill" : "pin.fill")
            }
            .tint(Palette.success)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if canDelete(row) {
                Button(role: .destructive) {
                    deleting = [row]
                } label: {
                    Label(String(localized: "feed.delete", defaultValue: "Удалить"), systemImage: "trash.fill")
                }
            }
            Button {
                Task { await model.toggleArchived(row) }
            } label: {
                Label(archiveTitle(row), systemImage: row.archivedAt == nil ? "archivebox.fill" : "tray.and.arrow.up.fill")
            }
            .tint(Palette.mutedForeground)
            Button {
                Task {
                    if row.muted {
                        await model.toggleMuted(row)
                    } else {
                        await model.mute(row, minutes: nil)
                    }
                }
            } label: {
                Label(
                    row.muted
                        ? String(localized: "chats.unmute", defaultValue: "Включить звук")
                        : String(localized: "chats.mute", defaultValue: "Без звука"),
                    systemImage: row.muted ? "bell.fill" : "bell.slash.fill"
                )
            }
            .tint(Palette.warning)
        }
        .contextMenu {
            contextMenu(row)
        } preview: {
            ChatPeekView(row: row, viewerID: viewerID)
        }
    }

    @ViewBuilder
    private func contextMenu(_ row: ChatListRow) -> some View {
        Button {
            Task { await model.toggleMarkedUnread(row) }
        } label: {
            if row.isUnread {
                Label(String(localized: "chats.markAsRead", defaultValue: "Пометить как прочитанное"), systemImage: "checkmark.message")
            } else {
                Label(String(localized: "chats.markUnread", defaultValue: "Пометить как новое"), systemImage: "message.badge")
            }
        }
        Button {
            Task { await model.togglePinned(row) }
        } label: {
            Label(pinTitle(row), systemImage: row.isPinned ? "pin.slash" : "pin")
        }
        MuteMenu(isMuted: row.muted) { minutes, importantOnly in
            Task { await model.mute(row, minutes: minutes, importantOnly: importantOnly) }
        } unmute: {
            Task { await model.toggleMuted(row) }
        }
        if !isArchive, !row.requestIncoming {
            folderMenu(row)
        }
        Button {
            Task { await model.toggleArchived(row) }
        } label: {
            Label(archiveTitle(row), systemImage: "archivebox")
        }
        Divider()
        Menu {
            Button(role: .destructive) {
                clearing = row
            } label: {
                Label(String(localized: "chats.clear.all", defaultValue: "Всю историю"), systemImage: "trash")
            }
            Button {
                clearingPeriod = row
            } label: {
                Label(String(localized: "chats.clear.period", defaultValue: "За период…"), systemImage: "calendar")
            }
        } label: {
            Label(String(localized: "chats.clear", defaultValue: "Очистить историю"), systemImage: "eraser")
        }
        if canDelete(row) {
            Button(role: .destructive) {
                deleting = [row]
            } label: {
                Label(ChatLeaveTitle.title(for: row.kind, isOwner: row.isOwner), systemImage: "trash")
            }
        }
    }

    /// «Добавить в папку» — подменю с галочками, как в Telegram: отметка кладёт чат в папку,
    /// повторная вынимает. На открытой вкладке своей папки — ещё и «Удалить из папки».
    @ViewBuilder
    private func folderMenu(_ row: ChatListRow) -> some View {
        // На вкладке папки строка в ней по определению: выбрана явно или попала по типу.
        if case .folder(let id, _) = model.tab, folders.folder(id: id) != nil {
            Button {
                Task { await folders.remove(chatID: row.id, fromFolder: id) }
            } label: {
                Label(String(localized: "chats.folders.removeFrom", defaultValue: "Удалить из папки"), systemImage: "folder.badge.minus")
            }
        }
        Menu {
            ForEach(folders.folders) { folder in
                Toggle(isOn: Binding(
                    get: { folder.chatIds.contains(row.id) },
                    set: { _ in Task { await folders.toggle(chatID: row.id, folderID: folder.id) } }
                )) {
                    Label(folder.name, systemImage: "folder")
                }
            }
            if folders.canCreate {
                if !folders.folders.isEmpty { Divider() }
                Button {
                    editingFolder = ChatFolderEditTarget(chatIDs: [row.id])
                } label: {
                    Label(String(localized: "chats.folders.new", defaultValue: "Новая папка"), systemImage: "folder.badge.plus")
                }
            }
        } label: {
            Label(String(localized: "chats.folders.addTo", defaultValue: "Добавить в папку"), systemImage: "folder.badge.plus")
        }
    }

    private func pinTitle(_ row: ChatListRow) -> String {
        row.isPinned
            ? String(localized: "chats.unpin", defaultValue: "Открепить")
            : String(localized: "chats.pin", defaultValue: "Закрепить")
    }

    private func archiveTitle(_ row: ChatListRow) -> String {
        row.archivedAt == nil
            ? String(localized: "chats.archive", defaultValue: "В архив")
            : String(localized: "chats.unarchive", defaultValue: "Из архива")
    }

    /// Удалить или покинуть можно личный чат и группу; официальные заводит система.
    private func canDelete(_ row: ChatListRow) -> Bool {
        row.kind == .private || row.kind == .group
    }

    private func openSaved() async {
        guard let id = try? await ChatsAPI().savedMessages() else { return }
        await model.refresh()
        AppServices.router.push(.chat(id: id), in: .chats)
    }
}

/// «Без звука» с выбором срока — те же варианты, что в вебе.
struct MuteMenu: View {
    let isMuted: Bool
    let mute: (Int?, Bool) -> Void
    let unmute: () -> Void

    var body: some View {
        if isMuted {
            Button(action: unmute) {
                Label(String(localized: "chats.unmute", defaultValue: "Включить звук"), systemImage: "bell")
            }
        } else {
            Menu {
                Self.options(mute)
            } label: {
                Label(String(localized: "chats.mute", defaultValue: "Без звука"), systemImage: "bell.slash")
            }
        }
    }

    /// Варианты срока — для меню строки списка чатов.
    @ViewBuilder
    static func options(_ mute: @escaping (Int?, Bool) -> Void) -> some View {
        Button(String(localized: "chats.mute.1h", defaultValue: "На час")) { mute(60, false) }
        Button(String(localized: "chats.mute.4h", defaultValue: "На 4 часа")) { mute(240, false) }
        Button(String(localized: "chats.mute.8h", defaultValue: "На 8 часов")) { mute(480, false) }
        Button(String(localized: "chats.mute.1d", defaultValue: "На сутки")) { mute(1440, false) }
        Button(String(localized: "chats.mute.3d", defaultValue: "На 3 дня")) { mute(4320, false) }
        Button(String(localized: "chats.mute.forever", defaultValue: "Навсегда")) { mute(nil, false) }
        Divider()
        Button(String(localized: "chats.mute.important", defaultValue: "Только важное")) { mute(nil, true) }
    }

    /// Те же варианты для кнопки «Звук» в информации о чате — её меню строит UIKit
    /// (`HeroMoreButton`).
    @HeroMenuBuilder
    static func heroOptions(_ mute: @escaping (Int?, Bool) -> Void) -> [HeroMenuElement] {
        HeroMenuItem(String(localized: "chats.mute.1h", defaultValue: "На час")) { mute(60, false) }
        HeroMenuItem(String(localized: "chats.mute.4h", defaultValue: "На 4 часа")) { mute(240, false) }
        HeroMenuItem(String(localized: "chats.mute.8h", defaultValue: "На 8 часов")) { mute(480, false) }
        HeroMenuItem(String(localized: "chats.mute.1d", defaultValue: "На сутки")) { mute(1440, false) }
        HeroMenuItem(String(localized: "chats.mute.3d", defaultValue: "На 3 дня")) { mute(4320, false) }
        HeroMenuItem(String(localized: "chats.mute.forever", defaultValue: "Навсегда")) { mute(nil, false) }
        HeroMenuDivider()
        HeroMenuItem(String(localized: "chats.mute.important", defaultValue: "Только важное")) { mute(nil, true) }
    }
}

/// Подпись удаления по виду чата: из группы выходят, личный чат удаляют у себя, а
/// создатель группы удаляет её целиком — так делает сервер (`DELETE /chats/:id`), и
/// подпись «Покинуть группу» у него обманывала бы.
enum ChatLeaveTitle {
    static func title(for kind: ChatKind, isOwner: Bool = false) -> String {
        guard kind == .group else {
            return String(localized: "chats.delete.chat", defaultValue: "Удалить чат")
        }
        return isOwner
            ? String(localized: "chats.deleteGroup", defaultValue: "Удалить группу")
            : String(localized: "chats.leave", defaultValue: "Покинуть группу")
    }

    /// Вопрос перед действием: у создателя группы — что она исчезнет у всех.
    static func question(for kind: ChatKind, isOwner: Bool) -> String {
        if kind == .group, isOwner {
            return String(localized: "chats.deleteGroup.title", defaultValue: "Удалить группу у всех участников?")
        }
        if kind == .group {
            return String(localized: "chats.leave.title", defaultValue: "Покинуть группу?")
        }
        return String(localized: "chats.delete.chat.title", defaultValue: "Удалить чат?")
    }
}

/// Подписи вкладок над списком.
enum ChatTabTitle {
    static func title(of tab: ChatListTab) -> String {
        switch tab {
        case .all: return String(localized: "chats.tab.all", defaultValue: "Все")
        case .folder(_, let name): return name
        case .requests: return String(localized: "chats.tab.requests", defaultValue: "Запросы")
        case .archive: return String(localized: "chats.tab.archive", defaultValue: "Архив")
        case .unread: return String(localized: "chats.tab.unread", defaultValue: "Непрочитанные")
        case .personal: return String(localized: "chats.tab.personal", defaultValue: "Личные")
        case .groups: return String(localized: "chats.tab.groups", defaultValue: "Группы")
        case .subjects: return String(localized: "chats.tab.subjects", defaultValue: "Предметы")
        case .university: return String(localized: "chats.tab.university", defaultValue: "Вуз")
        }
    }
}

/// Фон строки: у закреплённой чуть темнее списка, как в Telegram. Один вид на оба
/// случая — при закреплении подложка проявляется плавно, а не подменяется другим видом.
private struct ChatRowBackground: View {
    let isPinned: Bool

    var body: some View {
        ZStack {
            Palette.plainBackground
            Palette.muted.opacity(isPinned ? 0.55 : 0)
        }
    }
}

// MARK: - Строка чата

/// Строка списка как в Telegram: крупный аватар, имя полужирным, справа время и
/// галочки, ниже — превью в две строки и счётчик непрочитанного.
struct ChatRowView: View {
    let row: ChatListRow
    var action: String?
    /// Что делают в чате сейчас («печатает…») — следит только за этим чатом.
    var activity: ChatActivity?
    var isGroup = false
    /// Теги папок с цветом — маленькими плашками после имени.
    var tags: [ChatFolderTag] = []

    @Environment(\.viewerID) private var viewerID
    @ScaledMetric(relativeTo: .body) private var avatarSize: CGFloat = 58

    var body: some View {
        HStack(alignment: .center, spacing: Spacing.lg) {
            ChatAvatarView(
                title: row.displayTitle,
                kind: row.kind,
                avatarURL: row.avatarUrl,
                online: row.kind == .private && row.online,
                size: min(avatarSize, 84)
            )

            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.xs) {
                    Text(row.displayTitle)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Palette.foreground)
                        .lineLimit(1)
                        // Имя важнее тегов: при нехватке места сжимаются теги.
                        .layoutPriority(1)
                    if row.kind.isOfficial {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.caption)
                            .foregroundStyle(Palette.primary)
                            .accessibilityLabel(Text(String(localized: "chats.official", defaultValue: "Официальный чат")))
                    }
                    if row.muted {
                        Image(systemName: "speaker.slash.fill")
                            .font(.caption2)
                            .foregroundStyle(Palette.mutedForeground)
                            .accessibilityLabel(Text(String(localized: "chats.mutedBadge", defaultValue: "Уведомления выключены")))
                    }
                    ForEach(tags.prefix(2), id: \.folderID) { tag in
                        ChatFolderTagLabel(tag: tag)
                    }
                    Spacer(minLength: Spacing.md)
                    if let isRead = readState {
                        ChatReadChecks(isRead: isRead)
                            .foregroundStyle(isRead ? Palette.primary : Palette.mutedForeground)
                    }
                    Text(ChatMoment.short(row.lastCreatedAt ?? row.updatedAt))
                        .font(Typography.tabular(.subheadline))
                        .foregroundStyle(Palette.mutedForeground)
                }

                HStack(alignment: .center, spacing: Spacing.md) {
                    preview
                        .font(.subheadline)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    trailingBadge
                }
            }
            // Разделитель — от текста, а не от края: под аватаром линии нет.
            .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
        }
        .padding(.vertical, Spacing.sm)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    /// Галочки — у своего последнего сообщения, как в вебе: в группе две, когда его
    /// прочитал хоть кто-то (`othersReadAt` — самое дальнее прочтение среди других).
    /// В «Избранном» читать некому. `nil` — галочек нет.
    private var readState: Bool? {
        guard row.kind != .saved, row.lastSenderId == viewerID, row.draftText?.isEmpty != false,
              row.lastSystemType == nil, row.lastDeletedAt == nil, let last = row.lastCreatedAt
        else { return nil }
        return (row.othersReadAt ?? .distantPast) >= last
    }

    /// Миниатюра снимка или ролика последнего сообщения — перед текстом превью.
    @ViewBuilder
    private var thumbnail: some View {
        if let media = row.previewMedia {
            ChatPreviewThumbnail(attachment: media)
        }
    }

    /// Счётчик и булавка появляются и уходят «пузырём» — в анимации списка
    /// (`ChatListView`, `liveRevision`); без неё — сразу.
    @ViewBuilder
    private var trailingBadge: some View {
        if row.unreadCount > 0 {
            ChatUnreadBadge(count: row.unreadCount, muted: row.muted)
                .transition(.scale(scale: 0.5).combined(with: .opacity))
        } else if row.markedUnread {
            // «Пометить как новое» — синий кружок без числа, как в Telegram.
            ChatUnreadBadge(count: 0, muted: row.muted)
                .transition(.scale(scale: 0.5).combined(with: .opacity))
        } else if row.isPinned {
            Image(systemName: "pin.fill")
                .font(.caption)
                .rotationEffect(.degrees(45))
                .foregroundStyle(Palette.mutedForeground)
                .transition(.scale(scale: 0.5).combined(with: .opacity))
                .accessibilityLabel(Text(String(localized: "chats.pinnedBadge", defaultValue: "Закреплён")))
        }
    }

    /// Имя автора последнего сообщения в группе: «Вы» или имя без фамилии.
    private var senderName: String? {
        guard isGroup, row.lastDeletedAt == nil, row.draftText?.isEmpty != false else { return nil }
        if row.lastSenderId == viewerID, row.lastSenderId != nil {
            return String(localized: "chats.you", defaultValue: "Вы")
        }
        guard let sender = row.lastSenderName, !sender.isEmpty else { return nil }
        return sender.split(separator: " ").last.map(String.init) ?? sender
    }

    @ViewBuilder
    private var preview: some View {
        if let action = activity?.action ?? action {
            Text(ChatActionCaption.title(for: action))
                .foregroundStyle(Palette.primary)
                .lineLimit(2, reservesSpace: true)
        } else if let draft = row.draftText, !draft.isEmpty {
            (Text(String(localized: "chats.draft", defaultValue: "Черновик: ")).foregroundStyle(Palette.destructive)
                + Text(draft).foregroundStyle(Palette.mutedForeground))
                .lineLimit(2, reservesSpace: true)
        } else if row.lastSystemType != nil {
            Text(String(localized: "chats.system.unknown", defaultValue: "Событие в чате"))
                .foregroundStyle(Palette.mutedForeground)
                .lineLimit(2, reservesSpace: true)
        } else if let text = row.preview {
            if let senderName {
                VStack(alignment: .leading, spacing: 0) {
                    Text(senderName)
                        .foregroundStyle(Palette.foreground)
                        .lineLimit(1)
                    HStack(alignment: .center, spacing: Spacing.xs) {
                        thumbnail
                        Text(text)
                            .foregroundStyle(Palette.mutedForeground)
                            .lineLimit(1)
                    }
                }
            } else {
                HStack(alignment: .top, spacing: Spacing.xs) {
                    thumbnail
                    Text(text)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(2, reservesSpace: true)
                }
            }
        } else if row.requestIncoming {
            Text(String(localized: "chats.request.preview", defaultValue: "Запрос на переписку"))
                .foregroundStyle(Palette.primary)
                .lineLimit(2, reservesSpace: true)
        } else {
            // Пустой чат — место под превью всё равно держим: строки одной высоты.
            Text(verbatim: " ")
                .lineLimit(2, reservesSpace: true)
                .accessibilityHidden(true)
        }
    }
}

/// Счётчик непрочитанного: синяя капсула, у заглушённых — серая. Число меняется
/// перещёлкиванием цифр (`numericText`), когда список анимирует изменение. Ноль —
/// пометка «как новое»: кружок без числа.
private struct ChatUnreadBadge: View {
    let count: Int
    let muted: Bool

    @ScaledMetric(relativeTo: .footnote) private var height: CGFloat = 22

    var body: some View {
        if count > 0 {
            Text(verbatim: count > 999 ? "999+" : count.formatted())
                .font(Typography.tabular(.footnote).weight(.semibold))
                .contentTransition(.numericText(value: Double(min(count, 1000))))
                .foregroundStyle(Palette.primaryForeground)
                .padding(.horizontal, Spacing.sm)
                .frame(minWidth: height, minHeight: height)
                .background(muted ? Palette.mutedForeground : Palette.primary, in: Capsule())
                .accessibilityLabel(Text(String(
                    localized: "chats.unreadCount",
                    defaultValue: "Непрочитанных: \(count.formatted())"
                )))
        } else {
            // Пометка «как новое»: кружок того же размера без числа.
            Circle()
                .fill(muted ? Palette.mutedForeground : Palette.primary)
                .frame(width: height, height: height)
                .accessibilityLabel(Text(String(localized: "chats.markedUnread", defaultValue: "Помечен как новый")))
        }
    }
}

/// Строка «Архив»: серый аватар с коробкой, названия архивных чатов вместо превью.
private struct ChatArchiveRowView: View {
    let rows: [ChatListRow]

    @ScaledMetric(relativeTo: .body) private var avatarSize: CGFloat = 58

    var body: some View {
        let size = min(avatarSize, 84)
        HStack(alignment: .center, spacing: Spacing.lg) {
            ZStack {
                Circle().fill(Palette.mutedForeground.opacity(0.6))
                Image(systemName: "archivebox.fill")
                    .font(.system(size: size * 0.4, weight: .medium))
                    .foregroundStyle(Palette.primaryForeground)
            }
            .frame(width: size, height: size)
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline) {
                    Text(String(localized: "chats.tab.archive", defaultValue: "Архив"))
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Palette.foreground)
                    Spacer(minLength: Spacing.md)
                }
                HStack(alignment: .center, spacing: Spacing.md) {
                    Text(rows.prefix(8).map(\.displayTitle).joined(separator: ", "))
                        .font(.subheadline)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(2, reservesSpace: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    let unread = rows.reduce(0) { $0 + $1.unreadCount }
                    if unread > 0 {
                        ChatUnreadBadge(count: unread, muted: true)
                    }
                }
            }
            .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
        }
        .padding(.vertical, Spacing.sm)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}

/// Превью чата по долгому нажатию: шапка и последние сообщения на обоях — как в
/// Telegram. Читается из базы: превью должно открываться мгновенно.
private struct ChatPeekView: View {
    let row: ChatListRow
    let viewerID: String

    @State private var items: [MessageTimeline.Item] = []

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: Spacing.md) {
                ChatAvatarView(title: row.displayTitle, kind: row.kind, avatarURL: row.avatarUrl, size: 36)
                Text(row.displayTitle)
                    .font(.headline)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.md)
            .background(.bar)

            VStack(spacing: 2) {
                ForEach(items) { item in
                    MessageBubbleView(
                        item: item,
                        context: BubbleContext(
                            isGroup: row.kind != .private && row.kind != .saved,
                            othersReadAt: row.othersReadAt,
                            viewerID: viewerID
                        ),
                        // Копия в превью: без якорей, иначе она перехватит у пузыря
                        // в ленте место, из которого растёт меню.
                        isMenuPreview: true
                    )
                }
            }
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.md)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            .background { ChatWallpaper() }
            .clipped()
            .allowsHitTesting(false)
        }
        .frame(width: 340, height: 440)
        .task { await load() }
    }

    private func load() async {
        let id = row.id
        let snapshot = try? await AppServices.database.reader.read { db -> ThreadSnapshot in
            let messages = try MessageRecord
                .filter(MessageRecord.Columns.chatId == id)
                .order(MessageRecord.Columns.createdAt.desc)
                .limit(12)
                .fetchAll(db)
            let ids = messages.map(\.id)
            let attachments = try AttachmentRecord
                .filter(ids.contains(AttachmentRecord.Columns.messageId))
                .fetchAll(db)
            return ThreadSnapshot(
                messages: messages.reversed(),
                attachments: Dictionary(grouping: attachments, by: \.messageId)
            )
        }
        guard let snapshot else { return }
        items = MessageTimeline.build(
            from: snapshot.messages,
            attachments: snapshot.attachments,
            viewerID: viewerID
        ).flatMap(\.items)
    }
}

// MARK: - Аватар

/// Аватар чата: фото, иначе символ по типу или инициалы на цветном круге — цвет
/// постоянный для названия, как в Telegram. Точка — собеседник в сети.
struct ChatAvatarView: View {
    let title: String?
    let kind: ChatKind
    var avatarURL: String?
    var online = false
    var size: CGFloat = 52

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Group {
                if let avatarURL, let url = URL(string: avatarURL) {
                    RemoteImage(url: url, cacheKey: "chat:\(avatarURL.split(separator: "?").first ?? "")")
                } else if let symbol {
                    ZStack {
                        Circle().fill(gradient(kind == .saved ? Palette.primary : tone))
                        Image(systemName: symbol)
                            .font(.system(size: size * 0.4, weight: .semibold))
                            .foregroundStyle(Palette.primaryForeground)
                    }
                } else {
                    ZStack {
                        Circle().fill(gradient(tone))
                        Text(verbatim: initials)
                            .font(.system(size: size * 0.38, weight: .semibold, design: .rounded))
                            .foregroundStyle(Palette.primaryForeground)
                            .minimumScaleFactor(0.5)
                            .lineLimit(1)
                    }
                }
            }
            .frame(width: size, height: size)
            .clipShape(Circle())

            if online {
                Circle()
                    .fill(Palette.success)
                    .frame(width: size * 0.26, height: size * 0.26)
                    .overlay(Circle().strokeBorder(Palette.plainBackground, lineWidth: max(2, size * 0.04)))
                    .accessibilityLabel(Text(String(localized: "chats.online", defaultValue: "в сети")))
            }
        }
        .accessibilityHidden(!online)
    }

    private static let tones: [Color] = [
        Palette.primary, Palette.chart2, Palette.chart3, Palette.warning, Palette.destructive, Palette.success,
    ]

    private var tone: Color {
        let seed = title ?? kind.rawValue
        let hash = seed.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0x7FFF_FFFF }
        return Self.tones[hash % Self.tones.count]
    }

    private func gradient(_ color: Color) -> LinearGradient {
        LinearGradient(colors: [color.opacity(0.72), color], startPoint: .top, endPoint: .bottom)
    }

    private var initials: String {
        let words = (title ?? "").split(whereSeparator: { $0 == " " || $0 == "-" }).prefix(2)
        let letters = words.compactMap(\.first).map { String($0).uppercased() }.joined()
        return letters.isEmpty ? "?" : letters
    }

    private var symbol: String? {
        switch kind {
        case .saved: return "bookmark.fill"
        case .groupOfficial: return "person.3.fill"
        case .subject: return "book.closed.fill"
        case .faculty: return "building.2.fill"
        case .dean: return "building.columns.fill"
        case .support, .supportPlatform: return "questionmark.bubble.fill"
        case .event: return "calendar"
        default: return nil
        }
    }
}

/// Время в строке списка: сегодня — часы и минуты, на этой неделе — день, дальше —
/// дата. Как в вебе и как во всех мессенджерах: длинная дата в строке не читается.
enum ChatMoment {
    static func short(_ date: Date, now: Date = Date(), calendar: Calendar = .current) -> String {
        if calendar.isDateInToday(date) {
            return date.formatted(date: .omitted, time: .shortened)
        }
        if let week = calendar.date(byAdding: .day, value: -6, to: now), date > week {
            return date.formatted(.dateTime.weekday(.abbreviated))
        }
        return date.formatted(.dateTime.day().month(.twoDigits).year(.twoDigits))
    }
}

/// Катится ли список. Фаза прокрутки есть с iOS 18; на iOS 17 признак остаётся `false`,
/// и анимация перестановок работает как раньше.
private struct ScrollActivityTracker: ViewModifier {
    @Binding var isScrolling: Bool

    func body(content: Content) -> some View {
        if #available(iOS 18, *) {
            content.onScrollPhaseChange { _, phase in
                let scrolling = phase != .idle
                if isScrolling != scrolling { isScrolling = scrolling }
            }
        } else {
            content
        }
    }
}

// MARK: - Миниатюра в превью

/// Миниатюра снимка или ролика в превью строки, как в Telegram: скруглённый квадрат
/// чуть меньше строки текста. Сначала — размытое превью из сообщения, затем копия тем
/// же загрузчиком и в тот же кэш, что плитки переписки. Спойлер так и остаётся размытым.
private struct ChatPreviewThumbnail: View {
    let attachment: AttachmentRecord

    @Environment(\.displayScale) private var displayScale
    @ScaledMetric(relativeTo: .subheadline) private var side: CGFloat = 18
    /// Загруженная копия вместе с id файла: строка переиспользуется под новое последнее
    /// сообщение, и чужой снимок не должен мелькнуть у него.
    @State private var loaded: (id: String, image: UIImage)?

    /// Ключ — тот же, что у плитки на 40 pt: мелкая копия общая с превью переписки.
    private static let points: CGFloat = 40

    var body: some View {
        let key = ChatMediaTile.cacheKey(attachment, points: Self.points)
        let image = loaded?.id == attachment.id ? loaded?.image : nil
        let shown = image ?? ImageMemoryCache.shared.image(for: key) ?? ChatMediaImages.preview(for: attachment)
        ZStack {
            if let shown {
                Image(uiImage: shown)
                    .resizable()
                    .scaledToFill()
                    .blur(radius: attachment.spoiler ? 3 : 0)
            } else {
                Palette.muted
            }
            if attachment.mime.hasPrefix("video/") {
                Image(systemName: "play.fill")
                    .font(.system(size: side * 0.4, weight: .bold))
                    .foregroundStyle(.white)
                    .shadow(radius: 1)
            }
        }
        .frame(width: side, height: side)
        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
        .accessibilityHidden(true)
        .task(id: attachment.id) {
            guard !attachment.spoiler, ImageMemoryCache.shared.image(for: key) == nil else { return }
            let id = attachment.id
            if case .loaded(let image) = await ChatMediaImages.load(
                attachment, points: Self.points, scale: displayScale, key: key
            ) {
                loaded = (id, image)
            }
        }
    }
}

// MARK: - Истории в шапке

/// Кольцо, которое открывает просмотр историй.
private struct ChatStoryTarget: Identifiable {
    let id: String
}

/// Заголовок «Чаты» со стопкой аватаров авторов непросмотренных историй слева — как в
/// Telegram. Касание открывает просмотр с первого автора.
private struct ChatStoriesTitle: View {
    let rings: [StoryRingDTO]
    let open: () -> Void

    private let size: CGFloat = 28

    var body: some View {
        Button(action: open) {
            HStack(spacing: Spacing.sm) {
                HStack(spacing: -size * 0.4) {
                    ForEach(Array(rings.enumerated()), id: \.element.id) { index, ring in
                        AvatarView(url: ring.author.avatarUrl, name: ring.author.name, size: size - 4)
                            .padding(2)
                            .background(Palette.plainBackground, in: Circle())
                            .overlay(
                                Circle().strokeBorder(
                                    AngularGradient(
                                        colors: [Palette.primary, Palette.chart3, Palette.primary],
                                        center: .center
                                    ),
                                    lineWidth: 1.5
                                )
                            )
                            // Первый — сверху стопки, как в Telegram.
                            .zIndex(Double(rings.count - index))
                    }
                }
                Text(AppTab.chats.title)
                    .font(.headline)
                    .foregroundStyle(Palette.foreground)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(AppTab.chats.title))
        .accessibilityHint(Text(String(localized: "chats.stories.open", defaultValue: "Открыть истории")))
        .accessibilityIdentifier("chatlist.stories")
    }
}
