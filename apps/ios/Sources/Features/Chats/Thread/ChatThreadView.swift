import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Экран переписки как в Telegram: обои, по центру шапки — имя и статус, справа —
/// аватар (ведёт в информацию о чате), плашка закреплённого, лента с пузырями, кнопка
/// «вниз» со счётчиком и стеклянная панель ввода.
struct ChatThreadView: View {
    let chatID: String
    let viewerID: String

    @State private var model: ChatThreadModel?
    @State private var opener = RemoteFileOpener()
    /// Экран уходил (вперёд по стеку или назад): комната сокета отпущена.
    @State private var hasLeft = false
    @State private var forwarding: ForwardBatch?
    @State private var reporting: MessageRecord?
    /// Своё сообщение в группе, чьих прочитавших показываем.
    @State private var readersOf: MessageRecord?
    /// Подтверждение удаления: у меня или у всех.
    @State private var deleting: DeleteRequest?
    /// Меню сообщения по долгому нажатию.
    @State private var menu: MessageMenuRequest?
    /// Действие из меню ждёт, пока меню закроется: лист поверх закрывающегося
    /// полноэкранного слоя не откроется.
    @State private var pendingMenuAction: (MessageMenuAction, MessageRecord)?
    @State private var copiedTick = 0
    @State private var reported = false
    @State private var pinnedIndex = 0
    /// Лента у нижнего края — кнопка «вниз» не нужна.
    @State private var atBottom = true
    /// С какого момента человек не у низа: всё чужое позже — непрочитанное на кнопке.
    @State private var awaySince: Date?
    /// Дошёл ли человек до низа с открытия: до того счётчик ведётся от первого
    /// непрочитанного.
    @State private var reachedBottom = false
    @State private var bottomToken = 0
    /// Календарь «Перейти к дате» и день, с которого он открывается.
    @State private var showsCalendar = false
    @State private var calendarDay = Date()
    /// Поиск прямо в переписке; `nil` — режим поиска закрыт.
    @State private var search: ChatThreadSearch?
    @State private var showsSearchList = false
    @State private var pickingSearchSender = false
    /// Размер кнопки «вниз» — для запаса под ней в ленте (`ChatScrollDownButton`).
    @ScaledMetric(relativeTo: .body) private var downButtonSize: CGFloat = 40
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var realtime: RealtimeCoordinator { AppServices.realtime }
    private var jumps: ChatJumpRequests { ChatJumpRequests.shared }

    var body: some View {
        withDialogs(withLifecycle(content))
    }

    private var content: some View {
        VStack(spacing: 0) {
            if let model {
                thread(model)
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background { ChatWallpaper().ignoresSafeArea() }
        .navigationBarTitleDisplayMode(.inline)
        // В режиме поиска место шапки занимает поле, как в Telegram; выход — «Отмена».
        .toolbar(search == nil ? .automatic : .hidden, for: .navigationBar)
        .toolbar {
            if let model, model.isSelecting {
                selectionToolbar(model)
            } else {
                ToolbarItem(placement: .principal) {
                    NavigationLink(value: AppRoute.chatInfo(id: chatID)) {
                        ChatTitleView(model: model, realtime: realtime)
                    }
                    .buttonStyle(.plain)
                }
                ChatAvatarToolbarItem(chatID: chatID, chat: model?.chat, title: model?.title)
            }
        }
        // В режиме выбора место «назад» занимает «Отмена»: выход из режима, а не из
        // чата. Вместе с кнопкой система отключает и свайп назад — случайно закрыть
        // переписку с половиной выбора не выйдет.
        .navigationBarBackButtonHidden(model?.isSelecting == true)
        .toolbar(.hidden, for: .tabBar)
        .sensoryFeedback(.selection, trigger: model?.selection?.count ?? 0)
        .sensoryFeedback(.success, trigger: copiedTick)
    }

    /// Шапка режима выбора: «Отмена» слева и счётчик по центру, как в Telegram.
    @ToolbarContentBuilder
    private func selectionToolbar(_ model: ChatThreadModel) -> some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button(String(localized: "common.cancel", defaultValue: "Отмена")) {
                endSelection(model)
            }
        }
        ToolbarItem(placement: .principal) {
            Text(String(
                localized: "chats.selection.count",
                defaultValue: "Выбрано: \(model.selection?.count ?? 0)"
            ))
            .font(.headline)
            .foregroundStyle(Palette.foreground)
            .contentTransition(.numericText())
            .accessibilityAddTraits(.isHeader)
        }
    }

    private func endSelection(_ model: ChatThreadModel) {
        withAnimation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion)) {
            model.endSelection()
        }
    }

    @ViewBuilder
    private func thread(_ model: ChatThreadModel) -> some View {
        Group {
                if let search {
                    ChatSearchBar(search: search) { closeSearch() }
                        .transition(.move(edge: .top).combined(with: .opacity))
                }

                if let failure = model.failure {
                    FormAlert(message: failure)
                        .padding(.horizontal, Spacing.xl)
                        .padding(.top, Spacing.md)
                }

                if !model.pinned.isEmpty, search == nil {
                    PinnedBar(
                        message: model.pinned[min(pinnedIndex, model.pinned.count - 1)],
                        index: min(pinnedIndex, model.pinned.count - 1),
                        count: model.pinned.count
                    ) {
                        let current = model.pinned[min(pinnedIndex, model.pinned.count - 1)]
                        Task { await model.jump(to: current.id) }
                        // Каждое нажатие ведёт к следующему, более старому закреплённому.
                        pinnedIndex = (pinnedIndex + 1) % model.pinned.count
                    }
                }

                MessageListView(
                    days: model.days,
                    anchor: model.openingAnchor,
                    bubbleContext: bubbleContext(model),
                    focus: model.focus,
                    capabilities: { message in
                        MessageCapabilities(
                            canEdit: model.canEdit(message),
                            canDelete: model.canDelete(message),
                            canReport: message.senderId != viewerID,
                            myReaction: model.myReaction(on: message)
                        )
                    },
                    selection: model.selection,
                    scrollToBottomToken: bottomToken + model.bottomRequests,
                    onBottomChange: { bottomChanged($0) },
                    followsBottom: !model.isDetached,
                    bottomInset: listBottomInset(model),
                    onDayTap: { day in
                        calendarDay = day
                        showsCalendar = true
                    },
                    onReachTop: { Task { await model.loadOlder() } },
                    onReachBottom: { Task { await model.loadNewer() } },
                    onAction: { action, message in handle(action, message: message, model: model) },
                    onMenu: { item in openMenu(item, model: model) }
                )
                .overlay {
                    if let search, showsSearchList {
                        ChatSearchResultsList(search: search, viewerID: viewerID) { position in
                            showsSearchList = false
                            if let found = search.select(position) {
                                Task { await model.jump(to: found.id) }
                            }
                        }
                        .transition(.opacity)
                    }
                }
                .overlay {
                    // Открытие ждёт первую страницу: вместо одинокого превью — индикатор.
                    if model.isPreparing, model.days.isEmpty {
                        ProgressView()
                            .transition(.opacity)
                    }
                }
                .overlay(alignment: .bottomTrailing) {
                    ZStack {
                        if showsDownButton(model) {
                            ChatScrollDownButton(count: downButtonCount(model)) {
                                if model.isDetached {
                                    Task { await model.returnToLatest() }
                                } else {
                                    bottomToken += 1
                                }
                            }
                            .padding(.trailing, Spacing.lg)
                            .padding(.bottom, Spacing.md)
                            .transition(reduceMotion ? .opacity : .scale(scale: 0.6).combined(with: .opacity))
                        }
                    }
                    // Появление и уход — и тогда, когда кнопку убирает не прокрутка, а
                    // поиск или возврат из окна истории.
                    .animation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion), value: showsDownButton(model))
                }

                if let search {
                    // Писать во время поиска некуда: поле ввода уступает место панели
                    // со счётчиком и стрелками.
                    ChatSearchPanel(
                        search: search,
                        isGroup: bubbleContext(model).isGroup,
                        showsList: showsSearchList,
                        onCalendar: {
                            calendarDay = search.current?.createdAt ?? Date()
                            showsCalendar = true
                        },
                        onSender: { pickingSearchSender = true },
                        onList: { showsSearchList.toggle() },
                        onOlder: {
                            showsSearchList = false
                            Task {
                                if let found = await search.older() { await model.jump(to: found.id) }
                            }
                        },
                        onNewer: {
                            showsSearchList = false
                            if let found = search.newer() {
                                Task { await model.jump(to: found.id) }
                            }
                        }
                    )
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                } else if model.isSelecting {
                    // Поле ввода на время выбора уступает место панели действий.
                    MessageSelectionBar(
                        canCopy: !model.selectedText.isEmpty,
                        canForward: model.canForwardSelection,
                        canDelete: model.canDeleteSelection,
                        onCopy: {
                            UIPasteboard.general.string = model.selectedText
                            copiedTick += 1
                            endSelection(model)
                        },
                        onForward: {
                            forwarding = ForwardBatch(messages: model.selectedMessages, fromSelection: true)
                        },
                        onDelete: {
                            deleting = DeleteRequest(
                                messages: model.selectedMessages,
                                forEveryoneAllowed: model.canDeleteSelectionForEveryone,
                                fromSelection: true
                            )
                        }
                    )
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                } else if model.chat?.requestIncoming == true {
                    ChatRequestBar(chatID: chatID)
                } else if model.chat?.requestOutgoing == true, model.chat?.lastMessageId != nil || !model.days.isEmpty {
                    // Первое сообщение ушло запросом — дальше писать нельзя, пока его не
                    // примут (как в вебе): иначе следующие сообщения молча отклонялись бы.
                    Label(
                        String(localized: "chats.requestPending", defaultValue: "Запрос на переписку ещё не принят"),
                        systemImage: "clock"
                    )
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .frame(maxWidth: .infinity)
                    .padding(Spacing.xl)
                    .background(.bar)
                } else if model.chat?.blocked == true || model.chat?.blockedBy == true {
                    Text(model.chat?.blocked == true
                        ? String(localized: "chats.blockedByMe", defaultValue: "Вы заблокировали этого пользователя")
                        : String(localized: "chats.blockedMe", defaultValue: "Пользователь ограничил переписку"))
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                        .frame(maxWidth: .infinity)
                        .padding(Spacing.xl)
                        .background(.bar)
                } else {
                    MessageComposerView(model: model)
                }
        }
    }

    private func bottomChanged(_ isAtBottom: Bool) {
        withAnimation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion)) {
            atBottom = isAtBottom
        }
        if isAtBottom {
            reachedBottom = true
            awaySince = nil
        } else if awaySince == nil {
            awaySince = Date()
        }
    }

    /// Кнопка «вниз»: лента не у низа, а в окне истории — всегда (свежие сообщения
    /// дальше). В поиске её нет: у панели поиска свои стрелки, и два «вниз» сразу путают.
    private func showsDownButton(_ model: ChatThreadModel) -> Bool {
        search == nil && (!atBottom || model.isDetached)
    }

    /// В окне истории кнопка «вниз» не уходит и у его низа: под ней оставляем место,
    /// чтобы она не закрывала время последнего пузыря.
    private func listBottomInset(_ model: ChatThreadModel) -> CGFloat {
        guard model.isDetached, search == nil else { return 0 }
        return min(downButtonSize, 56) + Spacing.md
    }

    /// Число на кнопке «вниз». В окне истории свежие сообщения спрятаны за его границей,
    /// и посчитать их по ленте нельзя — берём счётчик непрочитанного с сервера.
    private func downButtonCount(_ model: ChatThreadModel) -> Int {
        model.isDetached ? max(unseen(model), model.unreadInChat) : unseen(model)
    }

    /// Непрочитанное на кнопке «вниз»: пока человек не дошёл до низа с открытия —
    /// от первого непрочитанного, потом — пришедшее, пока он листал вверх.
    private func unseen(_ model: ChatThreadModel) -> Int {
        if !reachedBottom, let anchor = model.openingAnchorDate {
            return model.unseenCount(after: anchor.addingTimeInterval(-0.001))
        }
        guard let awaySince else { return 0 }
        return model.unseenCount(after: awaySince)
    }

    private func bubbleContext(_ model: ChatThreadModel) -> BubbleContext {
        let isGroup = model.chat.map { $0.kind != .private && $0.kind != .saved } ?? false
        return BubbleContext(
            isGroup: isGroup,
            othersReadAt: model.chat?.othersReadAt,
            readMarks: isGroup ? model.readMarks : [],
            viewerID: viewerID
        )
    }

    private func withLifecycle<V: View>(_ view: V) -> some View {
        view
        .task {
            guard model == nil else { return }
            KeyboardFrame.shared.start()
            let created = ChatThreadModel(chatID: chatID, viewerID: viewerID)
            model = created
            created.start()
            await created.enter()
            await created.markRead()
            await created.loadPinned()
            await created.loadPeer()
            await created.loadGroupStatus()
        }
        .onChange(of: jumps.pending[chatID]) {
            consumeJump()
        }
        .onChange(of: jumps.days[chatID]) {
            consumeJump()
        }
        .onChange(of: jumps.searches.contains(chatID)) {
            consumeJump()
        }
        .task(id: search?.key) {
            // Пауза — чтобы не спрашивать сервер на каждую букву. Найденное самое свежее
            // совпадение сразу показывается в ленте, как в вебе.
            guard let search, let model else { return }
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            showsSearchList = false
            if let found = await search.run(), !Task.isCancelled {
                await model.jump(to: found.id)
            }
        }
        .onAppear {
            consumeJump()
        }
        .onChange(of: realtime.connectionEpoch) {
            Task {
                await model?.catchUpAfterReconnect()
                // За время обрыва события присутствия и прочтения мимо прошли.
                await model?.loadGroupStatus()
            }
        }
        .onChange(of: realtime.pinnedVersions[chatID] ?? 0) {
            Task { await model?.loadPinned() }
        }
        .onChange(of: model?.newestIncomingID) {
            // Пришло новое — пока чат открыт, оно прочитано.
            Task { await model?.markRead() }
        }
        .onAppear {
            guard hasLeft, let model else { return }
            hasLeft = false
            Task { await model.rejoin() }
        }
        .onDisappear {
            hasLeft = true
            // Ушли с экрана — выбор не переживает возвращения, как и в Telegram.
            model?.endSelection()
            showsSearchList = false
            // Голосовое не играет из-под другого экрана: остановить его потом негде.
            VoicePlayback.shared.stop()
            Task { [model] in await model?.leave() }
        }
    }

    /// Поиск, общие материалы или календарь в информации о чате просят открыть
    /// переписку на сообщении или дате.
    private func consumeJump() {
        guard let model else { return }
        if let target = jumps.pending[chatID] {
            jumps.pending[chatID] = nil
            Task { await model.jump(to: target) }
        }
        if let day = jumps.days[chatID] {
            jumps.days[chatID] = nil
            Task { await model.jump(toDay: day) }
        }
        if jumps.searches.contains(chatID) {
            jumps.searches.remove(chatID)
            openSearch(model)
        }
    }

    private func openSearch(_ model: ChatThreadModel) {
        model.endSelection()
        withAnimation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion)) {
            search = ChatThreadSearch(chatID: chatID)
        }
    }

    private func closeSearch() {
        withAnimation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion)) {
            search = nil
            showsSearchList = false
        }
    }

    private func withDialogs<V: View>(_ view: V) -> some View {
        view
        .remoteFilePreview(opener)
        .sheet(isPresented: $pickingSearchSender) {
            if let search {
                ChatSearchSenderSheet(chatID: chatID, selectedID: search.sender?.id) { member in
                    search.sender = member
                }
            }
        }
        .sheet(isPresented: $showsCalendar) {
            ChatCalendarSheet(chatID: chatID, initialDay: calendarDay) { day in
                Task { await model?.jump(toDay: day) }
            }
        }
        .sheet(item: $readersOf) { message in
            if let model {
                MessageReadersSheet(model: model, message: message)
            }
        }
        .sheet(item: $forwarding) { batch in
            ForwardPickerView(excludedChatID: chatID) { targets in
                guard let model else { return false }
                let sent = await model.forward(batch.messages, to: targets)
                if sent, batch.fromSelection { endSelection(model) }
                return sent
            }
        }
        .alert(
            String(localized: "chats.report.title", defaultValue: "Что не так с сообщением?"),
            isPresented: Binding(get: { reporting != nil }, set: { if !$0 { reporting = nil } }),
            presenting: reporting
        ) { message in
            ForEach(ComplaintReason.allCases) { reason in
                Button(reason.title) {
                    Task { reported = await model?.report(message, reason: reason.title) ?? false }
                }
            }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
        }
        .confirmationDialog(
            deleting.map { ChatPlural.deleteMessagesQuestion($0.messages.count) } ?? "",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible,
            presenting: deleting
        ) { request in
            if request.forEveryoneAllowed {
                Button(String(localized: "chats.delete.forEveryone", defaultValue: "Удалить у всех"), role: .destructive) {
                    perform(request, forEveryone: true)
                }
            }
            Button(String(localized: "chats.delete.forMe", defaultValue: "Удалить у меня"), role: .destructive) {
                perform(request, forEveryone: false)
            }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
        }
        .fullScreenCover(item: $menu, onDismiss: runPendingMenuAction) { request in
            MessageMenuOverlay(
                request: request,
                onReact: { emoji in
                    Task { await model?.react(request.item.message, emoji: emoji) }
                },
                onAction: { action in
                    pendingMenuAction = (action, request.item.message)
                },
                onDismiss: { closeMenu() }
            )
            .presentationBackground(.clear)
        }
        .alert(String(localized: "feed.report.sent", defaultValue: "Жалоба отправлена"), isPresented: $reported) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        }
        .alert(
            String(localized: "feed.actionFailed", defaultValue: "Не получилось"),
            isPresented: Binding(
                get: { model?.actionFailure != nil },
                set: { if !$0 { model?.actionFailure = nil } }
            )
        ) {
            Button(String(localized: "common.ok", defaultValue: "Понятно"), role: .cancel) {}
        } message: {
            Text(model?.actionFailure ?? "")
        }
    }

    private func handle(_ action: MessageAction, message: MessageRecord, model: ChatThreadModel) {
        switch action {
        case .reply:
            model.reply(to: message)
        case .edit:
            model.beginEdit(message)
        case .delete:
            deleting = DeleteRequest(
                messages: [message],
                forEveryoneAllowed: model.canDelete(message),
                fromSelection: false
            )
        case .pin:
            Task { await model.togglePin(message) }
        case .copy:
            UIPasteboard.general.string = message.content
        case .forward:
            forwarding = ForwardBatch(messages: [message], fromSelection: false)
        case .select:
            // Выбор — со своей шапкой и панелью: поиск уступает ему место.
            withAnimation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion)) {
                search = nil
                showsSearchList = false
                model.beginSelection(with: message)
            }
        case .toggleSelection:
            withAnimation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion)) {
                model.toggleSelection(of: message)
            }
        case .report:
            reporting = message
        case .readers:
            readersOf = message
        case .retry:
            Task { await model.retry(message) }
        case .cancelUpload:
            Task { await model.cancelUpload(message) }
        case .react(let emoji):
            Task { await model.react(message, emoji: emoji) }
        case .jump(let id):
            Task { await model.jump(to: id) }
        case .openPost(let id):
            AppServices.router.stacks[.chats, default: []].append(.post(id: id))
        case .openAttachment(let file):
            open(file)
        case .menu:
            break
        }
    }

    // MARK: Меню сообщения

    /// Долгое нажатие: меню открывается без системной анимации — у него своя, от пузыря.
    private func openMenu(_ item: MessageTimeline.Item, model: ChatThreadModel) {
        guard menu == nil, !model.isSelecting,
            let row = BubbleAnchors.shared.rect(for: item.id, part: .row),
            let bubble = BubbleAnchors.shared.rect(for: item.id, part: .bubble)
        else { return }
        let context = bubbleContext(model)
        let message = item.message
        let capabilities = MessageCapabilities(
            canEdit: model.canEdit(message),
            canDelete: model.canDelete(message),
            canReport: message.senderId != viewerID,
            myReaction: model.myReaction(on: message)
        )
        let readCount = context.isGroup && item.isOwn ? context.readCount(at: message.createdAt) : 0
        let request = MessageMenuRequest(
            item: item,
            rowRect: row,
            bubbleRect: bubble,
            context: context,
            capabilities: capabilities,
            actions: MessageMenuAction.available(
                for: message,
                isOwn: item.isOwn,
                isGroup: context.isGroup,
                capabilities: capabilities,
                readCount: readCount
            ),
            canReact: message.remoteId != nil && message.deletedAt == nil && message.systemType == nil
        )
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) { menu = request }
    }

    private func closeMenu() {
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) { menu = nil }
    }

    private func runPendingMenuAction() {
        guard let (action, message) = pendingMenuAction, let model else { return }
        pendingMenuAction = nil
        switch action {
        case .reply: handle(.reply, message: message, model: model)
        case .copy:
            handle(.copy, message: message, model: model)
            copiedTick += 1
        case .edit: handle(.edit, message: message, model: model)
        case .pin: handle(.pin, message: message, model: model)
        case .forward: handle(.forward, message: message, model: model)
        case .readers: handle(.readers, message: message, model: model)
        case .report: handle(.report, message: message, model: model)
        case .delete: handle(.delete, message: message, model: model)
        case .select: handle(.select, message: message, model: model)
        }
    }

    private func perform(_ request: DeleteRequest, forEveryone: Bool) {
        guard let model else { return }
        Task {
            if request.fromSelection {
                await model.deleteSelected(forEveryone: forEveryone)
            } else if forEveryone, let message = request.messages.first {
                await model.delete(message)
            } else {
                await model.hide(request.messages)
            }
        }
    }

    /// Вложение — системным просмотром (фото, PDF, Office, видео). Свой файл на диске
    /// открывается сразу, чужой скачивается по свежей ссылке: подписанная живёт минуты.
    private func open(_ file: AttachmentRecord) {
        if let path = file.localPath, FileManager.default.fileExists(atPath: path) {
            opener.previewURL = URL(filePath: path)
            return
        }
        Task {
            await opener.open(name: AttachmentFileName.of(file)) {
                guard let url = await AppServices.attachmentURLs.url(for: file.id) else {
                    throw URLError(.fileDoesNotExist)
                }
                return url
            }
        }
    }
}

/// Что удаляем: одно сообщение из меню или выбранные разом. «У всех» — только своё.
private struct DeleteRequest: Identifiable {
    let id = UUID()
    let messages: [MessageRecord]
    let forEveryoneAllowed: Bool
    let fromSelection: Bool
}

/// Что пересылаем: одно сообщение из меню или выбранные разом. После пересылки
/// выбранного режим выбора закрывается.
private struct ForwardBatch: Identifiable {
    let id = UUID()
    let messages: [MessageRecord]
    let fromSelection: Bool
}

/// Шапка: название и под ним — что происходит. Приоритет: действие собеседника,
/// затем онлайн, затем число участников.
private struct ChatTitleView: View {
    let model: ChatThreadModel?
    let realtime: RealtimeCoordinator

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: Spacing.xs) {
                Text(model?.title ?? ChatTitle.fallback(for: model?.chat))
                    .font(.headline)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(1)
                if model?.chat?.kind.isOfficial == true {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.caption)
                        .foregroundStyle(Palette.primary)
                        .accessibilityLabel(Text(String(localized: "chats.official", defaultValue: "Официальный чат")))
                }
            }
            if let subtitle {
                Text(subtitle)
                    .font(.footnote)
                    .foregroundStyle(isActive ? Palette.primary : Palette.mutedForeground)
                    .lineLimit(1)
                    .contentTransition(.opacity)
            }
        }
        .padding(.horizontal, Spacing.md)
        .accessibilityElement(children: .combine)
        .accessibilityHint(Text(String(localized: "chats.info.open", defaultValue: "Информация о чате")))
    }

    private var isActive: Bool {
        model?.othersAction != nil || (model?.isPeerOnline == true)
    }

    private var subtitle: String? {
        guard let model, let chat = model.chat else { return nil }
        if let action = model.othersAction { return ChatActionCaption.title(for: action) }
        switch chat.kind {
        case .private:
            return ChatPresence.caption(
                online: model.isPeerOnline,
                lastSeen: model.peer?.lastSeenAt,
                known: model.peer != nil
            )
        case .saved:
            return nil
        default:
            // «12 участников, 3 в сети». Число в сети — из снимка участников, который
            // двигают события присутствия; пока снимка нет — просто число участников.
            let members = chat.memberCount > 0 ? chat.memberCount : (model.presence?.memberCount ?? 0)
            return ChatPresence.groupCaption(members: members, online: model.othersOnline ?? 0)
        }
    }
}

/// Плашка закреплённого под шапкой. Нажатие — к сообщению; при нескольких
/// закреплённых каждое следующее нажатие ведёт к следующему.
private struct PinnedBar: View {
    let message: ChatMessageDTO
    let index: Int
    let count: Int
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Spacing.md) {
                VStack(spacing: 2) {
                    ForEach(0..<min(count, 4), id: \.self) { position in
                        Capsule()
                            .fill(position == min(index, 3) ? Palette.primary : Palette.primary.opacity(0.3))
                            .frame(width: 2)
                    }
                }
                .frame(height: 32)
                VStack(alignment: .leading, spacing: 0) {
                    Text(count > 1
                        ? String(localized: "chats.pinnedCount", defaultValue: "Закреплённое \(index + 1) из \(count)")
                        : String(localized: "chats.pinnedMessage", defaultValue: "Закреплено"))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Palette.primary)
                    Text(message.content.isEmpty
                        ? String(localized: "chats.attachmentPreview", defaultValue: "Вложение")
                        : message.content)
                        .font(Typography.meta)
                        .foregroundStyle(Palette.foreground)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(systemName: "pin")
                    .foregroundStyle(Palette.mutedForeground)
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.sm)
            .contentShape(Rectangle())
            .chatPanelSurface()
            .padding(.top, Spacing.xs)
        }
        .buttonStyle(.plain)
    }
}

/// Входящий запрос на переписку: принять или отклонить, прежде чем отвечать.
private struct ChatRequestBar: View {
    let chatID: String

    @Environment(\.dismiss) private var dismiss
    @State private var failure: String?
    private let api: ChatActing = ChatsAPI()

    var body: some View {
        VStack(spacing: Spacing.md) {
            Text(String(
                localized: "chats.request.hint",
                defaultValue: "Этот человек хочет начать с вами переписку"
            ))
            .font(Typography.meta)
            .foregroundStyle(Palette.mutedForeground)
            if let failure {
                Text(failure).font(Typography.meta).foregroundStyle(Palette.destructive)
            }
            HStack(spacing: Spacing.lg) {
                Button(String(localized: "friends.decline", defaultValue: "Отклонить"), role: .destructive) {
                    Task {
                        do {
                            try await api.declineRequest(chatID: chatID)
                            try? await AppServices.database.writer.write { db in
                                _ = try ChatRecord.deleteOne(db, key: chatID)
                            }
                            dismiss()
                        } catch {
                            failure = (error as? APIError)?.displayMessage
                        }
                    }
                }
                .glassButton()
                Button(String(localized: "friends.accept", defaultValue: "Принять")) {
                    Task {
                        do {
                            try await api.acceptRequest(chatID: chatID)
                            try? await AppServices.database.writer.write { db in
                                guard var chat = try ChatRecord.fetchOne(db, key: chatID) else { return }
                                chat.requestIncoming = false
                                try chat.update(db)
                            }
                        } catch {
                            failure = (error as? APIError)?.displayMessage
                        }
                    }
                }
                .glassProminentButton()
            }
        }
        .frame(maxWidth: .infinity)
        .padding(Spacing.xl)
        .background(.bar)
    }
}

/// Название чата без названия: «Избранное» и подписи официальных по типу.
enum ChatTitle {
    static func fallback(for chat: ChatRecord?) -> String {
        guard let chat else { return String(localized: "shell.chat", defaultValue: "Чат") }
        if let subject = chat.subject, !subject.isEmpty { return subject }
        switch chat.kind {
        case .saved: return String(localized: "chats.saved", defaultValue: "Избранное")
        case .groupOfficial: return String(localized: "chats.kind.group", defaultValue: "Чат группы")
        case .faculty: return String(localized: "chats.kind.faculty", defaultValue: "Факультет")
        case .dean: return String(localized: "chats.kind.dean", defaultValue: "Деканат")
        case .support, .supportPlatform: return String(localized: "chats.kind.support", defaultValue: "Поддержка")
        default: return String(localized: "chats.untitled", defaultValue: "Без названия")
        }
    }
}

/// Аватар чата справа в шапке — ведёт в информацию о чате. На iOS 26 без общей
/// стеклянной подложки панели: круглое фото само по себе, как в Telegram.
private struct ChatAvatarToolbarItem: ToolbarContent {
    let chatID: String
    let chat: ChatRecord?
    let title: String?

    @ScaledMetric(relativeTo: .body) private var size: CGFloat = 36

    var body: some ToolbarContent {
        #if compiler(>=6.2)
            if #available(iOS 26, *) {
                item.sharedBackgroundVisibility(.hidden)
            } else {
                item
            }
        #else
            item
        #endif
    }

    private var item: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            NavigationLink(value: AppRoute.chatInfo(id: chatID)) {
                ChatAvatarView(
                    title: title ?? ChatTitle.fallback(for: chat),
                    kind: chat?.kind ?? .unknown,
                    avatarURL: chat?.avatarUrl,
                    size: min(size, 44)
                )
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(String(localized: "chats.info.open", defaultValue: "Информация о чате")))
        }
    }
}

/// Кнопка «вниз» в стеклянном круге; сверху — синяя капсула с числом пришедшего,
/// пока человек листал вверх.
private struct ChatScrollDownButton: View {
    let count: Int
    let action: () -> Void

    @ScaledMetric(relativeTo: .body) private var size: CGFloat = 40
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button(action: action) {
            Image(systemName: "chevron.down")
                .font(.body.weight(.semibold))
                .foregroundStyle(Palette.mutedForeground)
                .frame(width: min(size, 56), height: min(size, 56))
                .floatingGlass(in: Circle())
                .overlay(alignment: .top) {
                    ZStack {
                        if count > 0 {
                            Text(verbatim: count > 999 ? "999+" : count.formatted())
                                .font(Typography.tabular(.caption).weight(.semibold))
                                .foregroundStyle(Palette.primaryForeground)
                                // Число перелистывается, а не мигает, как счётчики в Telegram.
                                .contentTransition(.numericText(value: Double(count)))
                                .padding(.horizontal, Spacing.sm)
                                .frame(minWidth: 20, minHeight: 20)
                                .background(Palette.primary, in: Capsule())
                                .transition(reduceMotion ? .opacity : .scale(scale: 0.5).combined(with: .opacity))
                        }
                    }
                    .offset(y: -12)
                    .animation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion), value: count)
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(String(localized: "chats.scrollDown", defaultValue: "К последним сообщениям")))
        .accessibilityValue(count > 0
            ? Text(String(localized: "chats.unreadCount", defaultValue: "Непрочитанных: \(count.formatted())"))
            : Text(verbatim: ""))
    }
}

/// Имя файла для просмотра: по расширению система понимает, чем его показать. У фото из
/// камеры имени нет — берём расширение из типа.
enum AttachmentFileName {
    static func of(_ file: AttachmentRecord) -> String {
        of(id: file.id, name: file.name, mime: file.mime)
    }

    static func of(id: String, name: String?, mime: String) -> String {
        if let name, !name.isEmpty { return name }
        let ext = UTType(mimeType: mime)?.preferredFilenameExtension ?? "bin"
        return "\(id).\(ext)"
    }
}
