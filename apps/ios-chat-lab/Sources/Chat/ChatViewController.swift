import UIKit

/// Экран переписки.
///
/// Устройство по образцу `ChatHistoryListNode` Telegram:
/// - лента перевёрнута (`scaleY = −1`), строка 0 — самое новое; низ ленты — это `contentOffset`
///   = `−contentInset.top`, поэтому новое сообщение «встаёт» снизу без пересчёта смещения;
/// - раскладка строк считается заранее (`MessageLayoutEngine`), ячейки только расставляют виды;
/// - изменения хранилища применяются точечно: вставки/удаления по стабильным `RowID`,
///   изменённые строки перенастраиваются на месте;
/// - если пользователь не внизу, вставки не двигают видимое: позиция держится за якорь —
///   первую видимую строку.
final class ChatViewController: UIViewController {
    let store: ChatStore

    let wallpaperView = WallpaperView()
    let chatLayout = ChatCollectionLayout()
    private(set) lazy var collectionView = UICollectionView(frame: .zero, collectionViewLayout: chatLayout)
    let inputPanel = InputPanelView()
    let pinnedPanel = PinnedPanelView()
    let scrollButton = ScrollToBottomButton()
    let floatingDate = FloatingDateView()
    let titleView = ChatTitleView()
    let avatarView = AvatarView()
    private(set) lazy var selectionBar = SelectionToolbar()
    private(set) lazy var scrollAnimator = ScrollAnimator(scrollView: collectionView)

    private(set) var rows: [ChatRow] = []
    private(set) var layouts: [MessageLayout] = []
    private var rowIndexByMessage: [MessageID: Int] = [:]
    private var layoutCache: [RowID: (row: ChatRow, layout: MessageLayout)] = [:]
    private var layoutWidth: CGFloat = 0
    var cellContext = CellContext()

    private var storeToken: ObservationToken?
    private var presenceToken: ObservationToken?
    var inputHeightConstraint: NSLayoutConstraint!
    private var didInitialScroll = false
    private(set) var unreadBelow = 0
    /// Какой закреп показан в панели (индекс в `store.pinnedIds`).
    var pinnedCursor: Int?
    /// Режим поиска (поле поиска в шапке, навигация по результатам).
    var searchController: ChatSearchController?
    /// Видимые (на экране) — для кружков и голосовых.
    private var playbackObserver: NSObjectProtocol?

    // Свайп ответа.
    var swipeCell: MessageCell?
    var swipeTriggered = false
    // Долгое нажатие.
    var pressedCell: MessageCell?
    var pressWorkItem: DispatchWorkItem?

    init(store: ChatStore) {
        self.store = store
        super.init(nibName: nil, bundle: nil)
        hidesBottomBarWhenPushed = true
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    // MARK: Жизненный цикл

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        view.accessibilityIdentifier = "chat.screen"

        wallpaperView.frame = view.bounds
        wallpaperView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        wallpaperView.apply(.preset(id: store.settings.wallpaperId))
        view.addSubview(wallpaperView)

        setupCollectionView()
        setupInputPanel()
        setupOverlays()
        setupNavigationItem()
        setupGestures()

        rebuildAll(width: view.bounds.width)

        storeToken = store.observe { [weak self] change in self?.apply(change) }
        presenceToken = MockChatService.shared.observePresence { [weak self] presence in
            self?.titleView.setPresence(presence, animated: self?.view.window != nil)
        }
        playbackObserver = NotificationCenter.default.addObserver(forName: .audioPlaybackChanged, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.refreshPlaybackCells() }
        }
        NotificationCenter.default.addObserver(self, selector: #selector(wallpaperChanged), name: .chatWallpaperDidChange, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(mediaReady(_:)), name: .mediaFileReady, object: nil)

        if !store.settings.draft.isEmpty {
            inputPanel.text = store.settings.draft
        }
        updatePinnedPanel(animated: false)
        Haptics.prepare()
    }

    deinit {
        if let playbackObserver { NotificationCenter.default.removeObserver(playbackObserver) }
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        LocalNotifications.shared.isChatVisible = true
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        LocalNotifications.shared.isChatVisible = false
        saveDraft()
    }

    override func viewWillLayoutSubviews() {
        super.viewWillLayoutSubviews()
        if abs(view.bounds.width - layoutWidth) > 0.5 {
            rebuildAll(width: view.bounds.width)
            collectionView.reloadData()
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        collectionView.frame = view.bounds
        updateInsets()
        layoutOverlays()
        if !didInitialScroll, view.window != nil || view.bounds.height > 0 {
            didInitialScroll = true
            collectionView.layoutIfNeeded()
            collectionView.contentOffset = CGPoint(x: 0, y: -collectionView.contentInset.top)
        }
    }

    // MARK: Настройка видов

    private func setupCollectionView() {
        collectionView.backgroundColor = .clear
        collectionView.transform = CGAffineTransform(scaleX: 1, y: -1)
        collectionView.contentInsetAdjustmentBehavior = .never
        collectionView.keyboardDismissMode = .interactive
        collectionView.alwaysBounceVertical = true
        collectionView.showsHorizontalScrollIndicator = false
        collectionView.dataSource = self
        collectionView.delegate = self
        collectionView.prefetchDataSource = self
        collectionView.isPrefetchingEnabled = true
        collectionView.scrollsToTop = false
        collectionView.register(MessageCell.self, forCellWithReuseIdentifier: MessageCell.reuseId)
        collectionView.accessibilityIdentifier = "chat.list"
        view.addSubview(collectionView)
    }

    private func setupInputPanel() {
        inputPanel.delegate = self
        inputPanel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(inputPanel)
        view.keyboardLayoutGuide.followsUndockedKeyboard = true
        inputHeightConstraint = inputPanel.heightAnchor.constraint(equalToConstant: inputPanel.contentHeight)
        NSLayoutConstraint.activate([
            inputPanel.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            inputPanel.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            inputPanel.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            inputHeightConstraint,
        ])
        installInputExtensions()
    }

    private func setupOverlays() {
        pinnedPanel.onTap = { [weak self] in self?.pinnedPanelTapped() }
        pinnedPanel.onClose = { [weak self] in self?.pinnedPanelClose() }
        pinnedPanel.accessibilityIdentifier = "pinned.panel"
        view.addSubview(pinnedPanel)
        view.addSubview(floatingDate)
        scrollButton.addAction(UIAction { [weak self] _ in self?.scrollToBottomTapped() }, for: .touchUpInside)
        view.addSubview(scrollButton)
    }

    private func setupNavigationItem() {
        titleView.configure(name: store.peer.displayName)
        titleView.addAction(UIAction { [weak self] _ in self?.openProfile() }, for: .touchUpInside)
        navigationItem.titleView = titleView
        avatarView.configure(peer: store.peer)
        avatarView.frame = CGRect(x: 0, y: 0, width: 37, height: 37)
        let avatarButton = UIButton(type: .custom)
        avatarButton.frame = avatarView.frame
        avatarView.isUserInteractionEnabled = false
        avatarButton.addSubview(avatarView)
        avatarButton.widthAnchor.constraint(equalToConstant: 37).isActive = true
        avatarButton.heightAnchor.constraint(equalToConstant: 37).isActive = true
        avatarButton.accessibilityLabel = "Профиль \(store.peer.displayName)"
        avatarButton.accessibilityIdentifier = "chat.avatar"
        avatarButton.addAction(UIAction { [weak self] _ in self?.openProfile() }, for: .touchUpInside)
        let avatarItem = UIBarButtonItem(customView: avatarButton)
        avatarItem.hidesSharedBackground = true
        let moreItem = UIBarButtonItem(image: UIImage(systemName: "ellipsis"), menu: makeMoreMenu())
        moreItem.accessibilityLabel = "Ещё"
        moreItem.accessibilityIdentifier = "chat.more"
        navigationItem.rightBarButtonItems = [avatarItem, moreItem]
        navigationItem.backButtonDisplayMode = .minimal
    }

    func restoreNavigationItems() {
        navigationItem.leftBarButtonItem = nil
        navigationItem.hidesBackButton = false
        navigationItem.titleView = titleView
        setupNavigationItem()
    }

    // MARK: Данные

    func replyPreview(_ id: MessageID) -> ReplyPreview? {
        guard let message = store.message(id) else { return nil }
        var thumb: String?
        switch message.kind {
        case let .photo(media), let .video(media), let .videoNote(media): thumb = media.file
        default: break
        }
        return ReplyPreview(
            targetId: id, authorName: message.isOutgoing ? "Вы" : store.peer.firstName, text: message.previewText,
            isDeleted: false, isOutgoingTarget: message.isOutgoing, thumbnailFile: thumb
        )
    }

    private func computeLayouts(for newRows: [ChatRow], width: CGFloat, dirty: Set<MessageID>) -> [MessageLayout] {
        var result: [MessageLayout] = []
        result.reserveCapacity(newRows.count)
        var newCache: [RowID: (row: ChatRow, layout: MessageLayout)] = [:]
        newCache.reserveCapacity(newRows.count)
        for row in newRows {
            let replyDirty = row.messages.first?.replyTo.map { dirty.contains($0) } ?? false
            if let cached = layoutCache[row.id], cached.row == row, cached.layout.width == width, !replyDirty {
                result.append(cached.layout)
                newCache[row.id] = cached
            } else {
                let layout = MessageLayoutEngine.layout(row: row, width: width, replyLookup: replyPreview)
                result.append(layout)
                newCache[row.id] = (row, layout)
            }
        }
        layoutCache = newCache
        return result
    }

    private func rebuildIndex() {
        rowIndexByMessage.removeAll(keepingCapacity: true)
        for (index, row) in rows.enumerated() {
            for id in row.allIds { rowIndexByMessage[id] = index }
        }
    }

    func rebuildAll(width: CGFloat) {
        guard width > 0 else { return }
        layoutWidth = width
        layoutCache.removeAll()
        rows = ChatRowBuilder.build(messages: store.messages)
        layouts = computeLayouts(for: rows, width: width, dirty: [])
        chatLayout.heights = layouts.map(\.height)
        rebuildIndex()
    }

    func rowIndex(of id: MessageID) -> Int? { rowIndexByMessage[id] }

    func cell(for id: MessageID) -> MessageCell? {
        guard let index = rowIndexByMessage[id] else { return nil }
        return collectionView.cellForItem(at: IndexPath(item: index, section: 0)) as? MessageCell
    }

    // MARK: Применение изменений

    private func apply(_ change: ChatChange) {
        guard isViewLoaded else { return }
        if change.isReset || view.window == nil {
            let wasReset = change.isReset
            rebuildAll(width: layoutWidth > 0 ? layoutWidth : view.bounds.width)
            UIView.performWithoutAnimation {
                collectionView.reloadData()
                collectionView.layoutIfNeeded()
            }
            if wasReset { scrollToBottom(animated: false) }
            updatePinnedPanel(animated: false)
            searchController?.storeDidChange()
            return
        }

        PerformanceMonitor.shared.markActive(for: 0.6)
        let wasAtBottom = isAtBottom
        let oldRows = rows
        let newRows = ChatRowBuilder.build(messages: store.messages)
        let dirty = Set(change.updated + change.removed)
        let newLayouts = computeLayouts(for: newRows, width: layoutWidth, dirty: dirty)

        let oldIds = oldRows.map(\.id)
        let newIds = newRows.map(\.id)
        let difference = newIds.difference(from: oldIds)
        var deletions: [IndexPath] = []
        var insertions: [IndexPath] = []
        for step in difference {
            switch step {
            case let .remove(offset, _, _): deletions.append(IndexPath(item: offset, section: 0))
            case let .insert(offset, _, _): insertions.append(IndexPath(item: offset, section: 0))
            }
        }
        let insertedSet = Set(insertions.map(\.item))
        var changedNewIndices: [Int] = []
        let oldById = Dictionary(oldRows.enumerated().map { ($0.element.id, $0.offset) }, uniquingKeysWith: { first, _ in first })
        for (index, row) in newRows.enumerated() where !insertedSet.contains(index) {
            guard let oldIndex = oldById[row.id] else { continue }
            if oldRows[oldIndex] != row || layouts[oldIndex].height != newLayouts[index].height || dirty.contains(where: { row.allIds.contains($0) }) {
                changedNewIndices.append(index)
            }
        }

        // Якорь: первая видимая строка не должна сдвинуться, если пользователь не внизу.
        var anchor: (id: RowID, y: CGFloat)?
        if !wasAtBottom, let first = firstVisibleRowIndex(), first < oldRows.count, let frame = chatLayout.frameForItem(first) {
            anchor = (oldRows[first].id, frame.minY)
        }

        let incoming = change.reason == .receive
        let ownInsert = change.reason == .send || change.reason == .forward
        if incoming, !wasAtBottom { unreadBelow += change.inserted.count }

        let animated = change.animated && UIView.areAnimationsEnabled
        chatLayout.plainInsertions = ownInsert && wasAtBottom
        // Если лента ещё ни разу не раскладывалась, UIKit спросит «старое» число строк у
        // источника данных — модель к этому моменту должна быть прежней.
        collectionView.layoutIfNeeded()

        let applyUpdates = {
            self.collectionView.performBatchUpdates {
                // Модель меняется внутри пакета — как требует UICollectionView.
                self.rows = newRows
                self.layouts = newLayouts
                self.rebuildIndex()
                self.chatLayout.heights = newLayouts.map(\.height)
                self.collectionView.deleteItems(at: deletions)
                self.collectionView.insertItems(at: insertions)
            }
            for index in changedNewIndices {
                guard let cell = self.collectionView.cellForItem(at: IndexPath(item: index, section: 0)) as? MessageCell else { continue }
                cell.configure(row: newRows[index], layout: newLayouts[index], context: self.cellContext, animated: animated)
            }
            if let anchor, let newIndex = newRows.firstIndex(where: { $0.id == anchor.id }), let frame = self.chatLayout.frameForItem(newIndex) {
                self.collectionView.contentOffset.y += frame.minY - anchor.y
            }
        }

        if animated, wasAtBottom || insertions.isEmpty {
            // Удаление: строка гаснет и сжимается (раскладка), соседи съезжают за 0,4 с.
            Motion.spring(duration: 0.4, applyUpdates)
        } else {
            UIView.performWithoutAnimation {
                applyUpdates()
                collectionView.layoutIfNeeded()
            }
        }

        if ownInsert {
            if wasAtBottom, let last = change.inserted.last {
                animateSendTransition(messageId: last)
                wallpaperView.advance()
            } else {
                scrollToBottom(animated: true)
            }
        }
        if incoming, wasAtBottom, view.window != nil {
            // Собеседник «прочитал» сразу: мы внизу.
        }
        scrollButton.setUnread(unreadBelow)
        updatePinnedPanel(animated: true)
        searchController?.storeDidChange()
        if change.reason == .delete || change.reason == .edit {
            UIAccessibility.post(notification: .layoutChanged, argument: nil)
        }
    }

    /// Полёт отправленного: пузырь вылетает из поля ввода. Вертикаль и горизонталь —
    /// разными кривыми (как у Telegram), 0,3 с, аддитивно — поверх движения ленты.
    private func animateSendTransition(messageId: MessageID) {
        guard !Motion.reduceMotion, UIView.areAnimationsEnabled, let cell = cell(for: messageId), let layout = cell.layout else { return }
        let source = inputPanel.textFrameInWindow
        let targetInContent = CGPoint(x: layout.bubbleFrame.minX + layout.textFrame.minX, y: layout.bubbleFrame.minY + layout.textFrame.minY)
        let sourceInContent = cell.contentView.convert(CGPoint(x: source.minX + 6, y: source.minY + 8), from: nil)
        let dx = sourceInContent.x - targetInContent.x
        let dy = sourceInContent.y - targetInContent.y
        guard abs(dy) < 1000 else { return }
        let horizontal = CABasicAnimation(keyPath: "position.x")
        horizontal.fromValue = dx
        horizontal.toValue = 0
        horizontal.isAdditive = true
        horizontal.duration = 0.3
        horizontal.timingFunction = BezierCurve.sendHorizontal.timingFunction
        let vertical = CABasicAnimation(keyPath: "position.y")
        vertical.fromValue = dy
        vertical.toValue = 0
        vertical.isAdditive = true
        vertical.duration = 0.3
        vertical.timingFunction = BezierCurve.sendVertical.timingFunction
        cell.swipeContainer.layer.add(horizontal, forKey: "send.x")
        cell.swipeContainer.layer.add(vertical, forKey: "send.y")
        // Пузырь «раскрывается» вокруг текста.
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 0
        fade.toValue = 1
        fade.duration = 0.15
        cell.bubbleImageView.layer.add(fade, forKey: "send.fade")
    }

    // MARK: Позиция ленты

    /// Внизу ли лента (порог Telegram — 0,9 pt; берём с запасом на округления).
    var isAtBottom: Bool {
        collectionView.contentOffset.y <= -collectionView.contentInset.top + 2
    }

    var distanceFromBottom: CGFloat {
        collectionView.contentOffset.y + collectionView.contentInset.top
    }

    func firstVisibleRowIndex() -> Int? {
        let visibleBottomY = collectionView.contentOffset.y + collectionView.contentInset.top
        return chatLayout.indexForItem(atContentY: max(0, visibleBottomY))
    }

    func scrollToBottom(animated: Bool) {
        let target = -collectionView.contentInset.top
        if animated {
            // Если далеко — сперва прыжок на экран от низа, затем короткая прокрутка (как Telegram).
            let screen = collectionView.bounds.height
            if collectionView.contentOffset.y - target > screen * 2.5 {
                collectionView.contentOffset.y = target + screen
            }
            scrollAnimator.animate(to: target, duration: 0.4)
        } else {
            scrollAnimator.cancel()
            collectionView.contentOffset.y = target
        }
        unreadBelow = 0
        scrollButton.setUnread(0)
    }

    private func scrollToBottomTapped() {
        Haptics.impact()
        scrollToBottom(animated: true)
    }

    /// Перейти к сообщению: строку — в центр видимой области, затем подсветка пузыря
    /// (держится 0,7 с, гаснет 0,3 с).
    func scrollToMessage(_ id: MessageID, highlight: Bool = true, animated: Bool = true) {
        guard let index = rowIndexByMessage[id], let frame = chatLayout.frameForItem(index) else {
            Toast.show("Сообщение удалено", icon: "trash", in: view, bottomInset: bottomVisualInset)
            return
        }
        let insets = collectionView.contentInset
        let visibleHeight = collectionView.bounds.height - insets.top - insets.bottom
        var target = frame.midY - insets.top - visibleHeight / 2
        let minOffset = -insets.top
        let maxOffset = max(minOffset, chatLayout.collectionViewContentSize.height - collectionView.bounds.height + insets.bottom)
        target = min(max(target, minOffset), maxOffset)
        let finish = { [weak self] in
            guard let self, highlight else { return }
            self.collectionView.layoutIfNeeded()
            self.cell(for: id)?.flashHighlight()
            UIAccessibility.post(notification: .layoutChanged, argument: self.cell(for: id))
        }
        if animated {
            let screen = collectionView.bounds.height
            let distance = target - collectionView.contentOffset.y
            if abs(distance) > screen * 2.5 {
                collectionView.contentOffset.y = target - (distance > 0 ? screen : -screen)
            }
            scrollAnimator.animate(to: target, duration: 0.4, completion: finish)
        } else {
            collectionView.contentOffset.y = target
            finish()
        }
    }

    // MARK: Отступы и клавиатура

    var bottomVisualInset: CGFloat { view.bounds.height - inputPanel.frame.minY }

    private var topVisualInset: CGFloat {
        view.safeAreaInsets.top + (pinnedPanel.isHidden ? 0 : PinnedPanelView.height)
    }

    /// Нижний отступ ленты = верх панели ввода (вместе с клавиатурой). Смещение
    /// компенсируется, чтобы содержимое ехало вместе с панелью, как у Telegram.
    func updateInsets() {
        let bottom = bottomVisualInset
        let top = topVisualInset
        var insets = collectionView.contentInset
        let delta = bottom - insets.top
        guard abs(delta) > 0.01 || abs(insets.bottom - top) > 0.01 else { return }
        insets.top = bottom
        insets.bottom = top
        let offset = collectionView.contentOffset
        collectionView.contentInset = insets
        collectionView.verticalScrollIndicatorInsets = UIEdgeInsets(top: bottom, left: 0, bottom: top, right: 0)
        if abs(delta) > 0.01 { PerformanceMonitor.shared.markActive(for: 0.6) }
        if didInitialScroll, !collectionView.isTracking, abs(delta) > 0.01 {
            collectionView.contentOffset = CGPoint(x: offset.x, y: offset.y - delta)
        }
    }

    func updateInputHeight(animated: Bool) {
        let height = currentInputPanelHeight()
        guard inputHeightConstraint.constant != height else { return }
        inputHeightConstraint.constant = height
        if animated {
            Motion.layout(duration: 0.25) { self.view.layoutIfNeeded() }
        } else {
            view.layoutIfNeeded()
        }
    }

    /// Высота нижней панели: поле ввода или панель выбора.
    func currentInputPanelHeight() -> CGFloat {
        cellContext.isSelecting ? SelectionToolbar.height : inputPanel.contentHeight
    }

    private func layoutOverlays() {
        let top = view.safeAreaInsets.top
        pinnedPanel.frame = CGRect(x: 0, y: top, width: view.bounds.width, height: PinnedPanelView.height)
        let buttonSize = scrollButton.bounds.size
        scrollButton.center = CGPoint(x: view.bounds.width - 8 - buttonSize.width / 2, y: inputPanel.frame.minY - 12 - buttonSize.height / 2)
        if cellContext.isSelecting {
            selectionBar.frame = CGRect(x: 0, y: view.bounds.height - view.safeAreaInsets.bottom - SelectionToolbar.height, width: view.bounds.width, height: SelectionToolbar.height + view.safeAreaInsets.bottom)
        }
    }

    // MARK: Закреп

    func updatePinnedPanel(animated: Bool) {
        let pinned = store.pinnedIds.compactMap { store.message($0) }
        let shouldShow = !pinned.isEmpty && searchController == nil && !cellContext.isSelecting
        if shouldShow {
            var cursor = pinnedCursor ?? pinned.count - 1
            cursor = min(max(0, cursor), pinned.count - 1)
            pinnedCursor = cursor
            pinnedPanel.configure(message: pinned[cursor], index: cursor, count: pinned.count, animated: animated)
        } else {
            pinnedCursor = nil
        }
        guard pinnedPanel.isHidden == shouldShow else { return }
        if shouldShow {
            pinnedPanel.isHidden = false
            pinnedPanel.alpha = 0
            pinnedPanel.transform = CGAffineTransform(translationX: 0, y: -PinnedPanelView.height / 2)
        }
        let apply = {
            self.pinnedPanel.alpha = shouldShow ? 1 : 0
            self.pinnedPanel.transform = shouldShow ? .identity : CGAffineTransform(translationX: 0, y: -PinnedPanelView.height / 2)
        }
        if shouldShow { updateInsets() }
        if animated {
            Motion.layout(duration: 0.3, apply) { _ in
                if !shouldShow { self.pinnedPanel.isHidden = true }
                self.updateInsets()
            }
        } else {
            apply()
            pinnedPanel.isHidden = !shouldShow
            updateInsets()
        }
    }

    private func pinnedPanelTapped() {
        let pinned = store.pinnedIds
        guard let cursor = pinnedCursor, cursor < pinned.count else { return }
        scrollToMessage(pinned[cursor])
        // Следующее нажатие — к более старому закрепу (по кругу), как у Telegram.
        pinnedCursor = cursor == 0 ? pinned.count - 1 : cursor - 1
        updatePinnedPanel(animated: true)
    }

    private func pinnedPanelClose() {
        let pinned = store.pinnedIds
        guard let cursor = pinnedCursor, cursor < pinned.count else { return }
        let id = pinned[cursor]
        let alert = UIAlertController(title: nil, message: pinned.count > 1 ? "Открепить это сообщение или все закреплённые?" : "Открепить сообщение?", preferredStyle: .actionSheet)
        alert.addAction(UIAlertAction(title: "Открепить", style: .destructive) { [weak self] _ in
            self?.store.unpin(id)
            Haptics.selection()
        })
        if pinned.count > 1 {
            alert.addAction(UIAlertAction(title: "Открепить все (\(pinned.count))", style: .destructive) { [weak self] _ in
                self?.store.unpinAll()
            })
        }
        alert.addAction(UIAlertAction(title: "Отмена", style: .cancel))
        alert.popoverPresentationController?.sourceView = pinnedPanel
        present(alert, animated: true)
    }

    // MARK: Прочее

    @objc private func wallpaperChanged() {
        wallpaperView.apply(.preset(id: store.settings.wallpaperId))
    }

    @objc private func mediaReady(_ notification: Notification) {
        guard let file = notification.object as? String else { return }
        for case let cell as MessageCell in collectionView.visibleCells {
            guard let row = cell.row, let layout = cell.layout else { continue }
            if row.messages.contains(where: { $0.kind.media?.file == file }) {
                cell.configure(row: row, layout: layout, context: cellContext, animated: false)
                cell.willDisplay()
            }
        }
        if file == store.peer.avatarFile { avatarView.configure(peer: store.peer) }
    }

    private func refreshPlaybackCells() {
        for case let cell as MessageCell in collectionView.visibleCells { cell.refreshPlayback() }
    }

    func saveDraft() {
        let draft: String
        if case .edit = inputPanel.accessory { draft = "" } else { draft = inputPanel.text }
        store.updateSettings { $0.draft = draft }
    }

    func reconfigureVisibleCells(animated: Bool) {
        for case let cell as MessageCell in collectionView.visibleCells {
            guard let indexPath = collectionView.indexPath(for: cell), indexPath.item < rows.count else { continue }
            cell.configure(row: rows[indexPath.item], layout: layouts[indexPath.item], context: cellContext, animated: animated)
        }
    }
}

// MARK: - Источник данных и прокрутка

extension ChatViewController: UICollectionViewDataSource, UICollectionViewDelegate, UICollectionViewDataSourcePrefetching {
    func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int {
        rows.count
    }

    func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
        let cell = collectionView.dequeueReusableCell(withReuseIdentifier: MessageCell.reuseId, for: indexPath) as! MessageCell
        cell.configure(row: rows[indexPath.item], layout: layouts[indexPath.item], context: cellContext, animated: false)
        return cell
    }

    func collectionView(_ collectionView: UICollectionView, willDisplay cell: UICollectionViewCell, forItemAt indexPath: IndexPath) {
        (cell as? MessageCell)?.willDisplay()
    }

    func collectionView(_ collectionView: UICollectionView, didEndDisplaying cell: UICollectionViewCell, forItemAt indexPath: IndexPath) {
        (cell as? MessageCell)?.didEndDisplaying()
    }

    /// Предзагрузка медиа ближайших строк (как `InChatPrefetchManager`): картинки
    /// распаковываются в фоне до того, как строка появится.
    func collectionView(_ collectionView: UICollectionView, prefetchItemsAt indexPaths: [IndexPath]) {
        for indexPath in indexPaths where indexPath.item < rows.count {
            let layout = layouts[indexPath.item]
            guard layout.content == .media || layout.content == .videoNote else { continue }
            for (offset, message) in rows[indexPath.item].messages.enumerated() {
                guard let media = message.kind.media, MediaStorage.exists(media.file) else { continue }
                let size = offset < layout.mediaTileFrames.count ? layout.mediaTileFrames[offset].size : layout.contentFrame.size
                switch message.kind {
                case .photo: ImagePipeline.shared.prefetch(.photo(media.file), pointSize: size)
                case .gif: ImagePipeline.shared.prefetch(.gifPoster(media.file), pointSize: size)
                case .video, .videoNote: ImagePipeline.shared.prefetch(.videoFrame(media.file), pointSize: size)
                default: break
                }
            }
        }
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        let distance = distanceFromBottom
        scrollButton.setShown(distance >= 40 || unreadBelow > 0, animated: true)
        if distance < 2, unreadBelow > 0 {
            unreadBelow = 0
            scrollButton.setUnread(0)
        }
        if scrollView.isDragging || scrollView.isDecelerating || scrollAnimator.isAnimating {
            updateFloatingDate()
        }
        PerformanceMonitor.shared.noteScroll()
    }

    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        scrollAnimator.cancel()
        PerformanceMonitor.shared.beginInteraction("scroll")
    }

    func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
        if !decelerate {
            floatingDate.scheduleHide()
            PerformanceMonitor.shared.endInteraction("scroll")
        }
    }

    func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
        floatingDate.scheduleHide()
        PerformanceMonitor.shared.endInteraction("scroll")
    }

    private func updateFloatingDate() {
        // Верх видимой области в координатах ленты (лента перевёрнута).
        let topY = collectionView.contentOffset.y + collectionView.bounds.height - collectionView.contentInset.bottom - 1
        guard let index = chatLayout.indexForItem(atContentY: topY), index < rows.count else { return }
        var date: Date?
        for candidate in index..<rows.count {
            if let message = rows[candidate].primary { date = message.date; break }
            if case let .date(day) = rows[candidate].kind { date = day; break }
        }
        guard let date else { return }
        floatingDate.show(MessageLayoutEngine.dayTitle(date), centerX: view.bounds.midX, top: topVisualInset + 8)
    }
}

// MARK: - Панель выбора

final class SelectionToolbar: UIView {
    static let height: CGFloat = 52

    let deleteButton = UIButton(type: .system)
    let forwardButton = UIButton(type: .system)
    let countLabel = UILabel()
    private let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemChromeMaterial))
    private let separator = UIView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        addSubview(blur)
        separator.backgroundColor = .separator
        addSubview(separator)
        deleteButton.setImage(UIImage(systemName: "trash", withConfiguration: UIImage.SymbolConfiguration(pointSize: 20)), for: .normal)
        deleteButton.tintColor = Palette.destructive
        deleteButton.accessibilityLabel = "Удалить выбранные"
        deleteButton.accessibilityIdentifier = "selection.delete"
        forwardButton.setImage(UIImage(systemName: "arrowshape.turn.up.right", withConfiguration: UIImage.SymbolConfiguration(pointSize: 20)), for: .normal)
        forwardButton.accessibilityLabel = "Переслать выбранные"
        forwardButton.accessibilityIdentifier = "selection.forward"
        countLabel.font = .systemFont(ofSize: 15, weight: .semibold)
        countLabel.textAlignment = .center
        countLabel.accessibilityIdentifier = "selection.count"
        addSubview(deleteButton)
        addSubview(forwardButton)
        addSubview(countLabel)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func setCount(_ count: Int) {
        countLabel.text = count == 0 ? "Выберите сообщения" : "Выбрано: \(count)"
        deleteButton.isEnabled = count > 0
        forwardButton.isEnabled = count > 0
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        blur.frame = bounds
        separator.frame = CGRect(x: 0, y: 0, width: bounds.width, height: 1 / traitCollection.displayScale)
        deleteButton.frame = CGRect(x: 8, y: 4, width: 44, height: 44)
        forwardButton.frame = CGRect(x: bounds.width - 52, y: 4, width: 44, height: 44)
        countLabel.frame = CGRect(x: 60, y: 4, width: bounds.width - 120, height: 44)
    }
}
