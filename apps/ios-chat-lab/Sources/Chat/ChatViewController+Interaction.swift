import UIKit
import QuickLook
import SafariServices

// MARK: - Жесты ленты

extension ChatViewController: UIGestureRecognizerDelegate {
    func setupGestures() {
        let doubleTap = UITapGestureRecognizer(target: self, action: #selector(handleDoubleTap(_:)))
        doubleTap.numberOfTapsRequired = 2
        doubleTap.delegate = self
        collectionView.addGestureRecognizer(doubleTap)

        let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        tap.require(toFail: doubleTap)
        tap.delegate = self
        collectionView.addGestureRecognizer(tap)

        // Долгое нажатие: через 0,12 с пузырь «вдавливается» за 0,2 с, затем меню (Telegram).
        let longPress = UILongPressGestureRecognizer(target: self, action: #selector(handleLongPress(_:)))
        longPress.minimumPressDuration = 0.12
        longPress.delegate = self
        collectionView.addGestureRecognizer(longPress)

        let swipe = UIPanGestureRecognizer(target: self, action: #selector(handleSwipe(_:)))
        swipe.delegate = self
        swipe.accessibilityLabel = "swipeToReply"
        collectionView.addGestureRecognizer(swipe)
    }

    /// Ячейка и точка в её `contentView` (ось Y вниз).
    func hitCell(_ gesture: UIGestureRecognizer) -> (MessageCell, CGPoint)? {
        let location = gesture.location(in: collectionView)
        guard let indexPath = collectionView.indexPathForItem(at: location),
              let cell = collectionView.cellForItem(at: indexPath) as? MessageCell else { return nil }
        return (cell, gesture.location(in: cell.contentView))
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard let pan = gestureRecognizer as? UIPanGestureRecognizer, pan.view === collectionView, pan !== collectionView.panGestureRecognizer else {
            return true
        }
        // Ответ свайпом: только влево и заметно горизонтально (|dy|·2 < |dx|), не в режиме выбора.
        guard !cellContext.isSelecting else { return false }
        let velocity = pan.velocity(in: view)
        guard velocity.x < 0, abs(velocity.y) * 2 < abs(velocity.x) else { return false }
        guard let (cell, point) = hitCell(pan), cell.isBubbleRow, cell.bubbleContains(point) || true else { return false }
        return cell.primaryId.map { store.message($0)?.isService == false } ?? false
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        // Долгое нажатие и прокрутка не мешают друг другу: прокрутка отменит нажатие сама.
        gestureRecognizer is UILongPressGestureRecognizer && other === collectionView.panGestureRecognizer
    }

    @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
        guard let (cell, point) = hitCell(gesture) else {
            if !cellContext.isSelecting { view.endEditing(true) }
            return
        }
        if cellContext.isSelecting {
            if cell.isBubbleRow { toggleSelection(cell.messageIds) }
            return
        }
        guard let action = cell.action(at: point) else {
            view.endEditing(true)
            return
        }
        perform(action, cell: cell)
    }

    @objc private func handleDoubleTap(_ gesture: UITapGestureRecognizer) {
        guard !cellContext.isSelecting, let (cell, point) = hitCell(gesture), cell.bubbleContains(point), let id = cell.primaryId,
              let message = store.message(id), !message.isService else { return }
        // Двойное касание — быстрая реакция 👍 (как по умолчанию в Telegram).
        Haptics.impact()
        store.toggleReaction(id, emoji: "👍")
    }

    func perform(_ action: MessageCellAction, cell: MessageCell?) {
        switch action {
        case let .openLink(url):
            openLink(url)
        case let .openReply(id):
            scrollToMessage(id)
        case let .openMedia(id):
            openMedia(id)
        case let .toggleVoice(id):
            guard let message = store.message(id), let media = message.kind.media else { return }
            AudioPlayerService.shared.toggle(messageId: id, file: media.file)
        case let .openFile(id):
            openFile(id)
        case let .toggleVideoNote(id):
            self.cell(for: id)?.videoNoteView.toggleSound()
        case let .toggleReaction(id, emoji):
            Haptics.selection()
            store.toggleReaction(id, emoji: emoji)
        case let .failedMenu(id):
            presentFailedMenu(id)
        case .bubble:
            view.endEditing(true)
        }
    }

    // MARK: Долгое нажатие

    @objc private func handleLongPress(_ gesture: UILongPressGestureRecognizer) {
        switch gesture.state {
        case .began:
            guard !cellContext.isSelecting, let (cell, point) = hitCell(gesture), cell.bubbleContains(point),
                  let id = cell.messageId(at: point), store.message(id)?.isService == false else { return }
            pressedCell = cell
            animatePress(cell, pressed: true)
            let work = DispatchWorkItem { [weak self, weak cell] in
                MainActor.assumeIsolated {
                    guard let self, let cell, self.pressedCell === cell else { return }
                    self.pressedCell = nil
                    self.presentContextMenu(for: cell, messageId: id)
                }
            }
            pressWorkItem = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2, execute: work)
        case .changed:
            break
        case .ended, .cancelled, .failed:
            pressWorkItem?.cancel()
            if let cell = pressedCell {
                animatePress(cell, pressed: false)
                pressedCell = nil
            }
        default:
            break
        }
    }

    /// «Вдавливание» пузыря: масштаб `max(0.7, (w − 15) / w)` за 0,2 с, линейно.
    func animatePress(_ cell: MessageCell, pressed: Bool) {
        guard let layout = cell.layout else { return }
        let width = layout.bubbleFrame.width
        let scale = pressed ? max(0.7, (width - 15) / max(width, 1)) : 1
        let center = CGPoint(x: layout.bubbleFrame.midX, y: layout.bubbleFrame.midY)
        let containerCenter = CGPoint(x: cell.swipeContainer.bounds.midX, y: cell.swipeContainer.bounds.midY)
        let dx = center.x - containerCenter.x
        let dy = center.y - containerCenter.y
        let transform = CGAffineTransform(translationX: dx, y: dy).scaledBy(x: scale, y: scale).translatedBy(x: -dx, y: -dy)
        UIView.animate(withDuration: pressed ? 0.2 : 0.25, delay: 0, options: [pressed ? .curveLinear : .curveEaseOut, .beginFromCurrentState, .allowUserInteraction]) {
            cell.swipeContainer.transform = transform
        }
    }

    // MARK: Ответ свайпом

    /// Порог срабатывания: 60 pt у исходящих, 45 pt у входящих; дальше — сопротивление
    /// `s + (1 − 1/((x − s)·0,4/100 + 1))·100`, не больше 180 pt (формула Telegram).
    static func swipeOffset(forTranslation translation: CGFloat, threshold: CGFloat) -> CGFloat {
        let x = abs(min(0, translation))
        guard x > threshold else { return x }
        let resisted = threshold + (1 - 1 / ((x - threshold) * 0.4 / 100 + 1)) * 100
        return min(180, resisted)
    }

    @objc private func handleSwipe(_ gesture: UIPanGestureRecognizer) {
        switch gesture.state {
        case .began:
            guard let (cell, _) = hitCell(gesture) else { return }
            swipeCell = cell
            swipeTriggered = false
            // Прокрутка не должна ехать вместе со свайпом.
            collectionView.panGestureRecognizer.isEnabled = false
            collectionView.panGestureRecognizer.isEnabled = true
            Haptics.prepare()
        case .changed:
            guard let cell = swipeCell, let layout = cell.layout else { return }
            let threshold: CGFloat = layout.isOutgoing ? 60 : 45
            let translation = gesture.translation(in: view).x
            let offset = Self.swipeOffset(forTranslation: translation, threshold: threshold)
            cell.swipeContainer.transform = CGAffineTransform(translationX: -offset, y: 0)
            let progress = abs(min(0, translation)) / threshold
            let bubbleRight = BubbleImages.imageFrame(for: layout.bubbleFrame, outgoing: layout.isOutgoing).maxX
            let iconX = min(layout.width - 40, bubbleRight - offset + 12)
            cell.replyIcon.frame = CGRect(x: iconX, y: layout.bubbleFrame.midY - 16.5, width: 33, height: 33)
            let iconScale = 0.65 + 0.35 * min(1, 1.2 * progress)
            cell.replyIcon.alpha = min(1, progress)
            if progress >= 1, !swipeTriggered {
                swipeTriggered = true
                UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
                UIView.animate(withDuration: 0.2, animations: {
                    cell.replyIcon.transform = CGAffineTransform(scaleX: 1.1, y: 1.1)
                }, completion: { _ in
                    UIView.animate(withDuration: 0.15) { cell.replyIcon.transform = .identity }
                })
            } else if progress < 1 {
                if swipeTriggered { swipeTriggered = false }
                cell.replyIcon.transform = CGAffineTransform(scaleX: iconScale, y: iconScale)
            }
        case .ended, .cancelled, .failed:
            guard let cell = swipeCell else { return }
            let triggered = swipeTriggered && gesture.state == .ended
            swipeCell = nil
            swipeTriggered = false
            UIView.animate(withDuration: Motion.reduceMotion ? 0 : 0.3, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
                cell.swipeContainer.transform = .identity
                cell.replyIcon.alpha = 0
                cell.replyIcon.transform = CGAffineTransform(scaleX: 0.2, y: 0.2)
            }
            if triggered, let id = cell.primaryId {
                beginReply(to: id)
            }
        default:
            break
        }
    }

    // MARK: Действия с сообщениями

    func beginReply(to id: MessageID) {
        guard let message = store.message(id) else { return }
        let author = message.isOutgoing ? "себе" : store.peer.firstName
        inputPanel.setAccessory(.reply(id, author: author, text: message.previewText), animated: true)
        inputPanel.textView.becomeFirstResponder()
    }

    func beginEdit(_ id: MessageID) {
        guard let message = store.message(id), message.isEditable else { return }
        saveDraft()
        inputPanel.setAccessory(.edit(id, text: message.previewText), animated: true)
        inputPanel.text = message.text
        inputPanel.textView.becomeFirstResponder()
    }

    func copyText(_ ids: [MessageID]) {
        let texts = ids.compactMap { store.message($0) }.sorted { $0.id < $1.id }.map(\.text).filter { !$0.isEmpty }
        guard !texts.isEmpty else { return }
        UIPasteboard.general.string = texts.joined(separator: "\n\n")
        Toast.show("Текст скопирован", icon: "doc.on.doc", in: view, bottomInset: bottomVisualInset)
    }

    func togglePin(_ id: MessageID) {
        if store.isPinned(id) {
            store.unpin(id)
            Toast.show("Сообщение откреплено", icon: "pin.slash", in: view, bottomInset: bottomVisualInset)
        } else {
            store.pin(id)
            pinnedCursor = store.pinnedIds.count - 1
            updatePinnedPanel(animated: true)
            Toast.show("Сообщение закреплено", icon: "pin", in: view, bottomInset: bottomVisualInset)
        }
    }

    /// Удаление с подтверждением: «у меня» или «у меня и у собеседника» (локально — одно и то же).
    func confirmDelete(_ ids: [MessageID], completion: (() -> Void)? = nil) {
        guard !ids.isEmpty else { return }
        let title = ids.count == 1 ? "Удалить сообщение?" : "Удалить \(ids.count) сообщ.?"
        let alert = UIAlertController(title: title, message: nil, preferredStyle: .actionSheet)
        alert.addAction(UIAlertAction(title: "Удалить у меня и у \(store.peer.firstName)", style: .destructive) { [weak self] _ in
            self?.performDelete(ids)
            completion?()
        })
        alert.addAction(UIAlertAction(title: "Удалить только у меня", style: .destructive) { [weak self] _ in
            self?.performDelete(ids)
            completion?()
        })
        alert.addAction(UIAlertAction(title: "Отмена", style: .cancel))
        alert.popoverPresentationController?.sourceView = view
        present(alert, animated: true)
    }

    func performDelete(_ ids: [MessageID]) {
        if let playing = AudioPlayerService.shared.currentId, ids.contains(playing) { AudioPlayerService.shared.stop() }
        if case let .edit(editId, _)? = inputPanel.accessory, ids.contains(editId) { cancelAccessory() }
        if case let .reply(replyId, _, _)? = inputPanel.accessory, ids.contains(replyId) { cancelAccessory() }
        store.delete(ids)
        Haptics.impactMedium()
    }

    func presentFailedMenu(_ id: MessageID) {
        let alert = UIAlertController(title: "Сообщение не отправлено", message: "Проверьте соединение и попробуйте снова.", preferredStyle: .actionSheet)
        alert.addAction(UIAlertAction(title: "Отправить снова", style: .default) { [weak self] _ in self?.store.retry(id) })
        alert.addAction(UIAlertAction(title: "Удалить", style: .destructive) { [weak self] _ in self?.performDelete([id]) })
        alert.addAction(UIAlertAction(title: "Отмена", style: .cancel))
        alert.popoverPresentationController?.sourceView = view
        present(alert, animated: true)
    }

    // MARK: Ссылки и файлы

    func openLink(_ url: URL) {
        var url = url
        if url.scheme == nil, let fixed = URL(string: "https://" + url.absoluteString) { url = fixed }
        if url.scheme == "mailto" || url.scheme == "tel" {
            UIApplication.shared.open(url)
            return
        }
        let safari = SFSafariViewController(url: url)
        present(safari, animated: true)
    }

    func openFile(_ id: MessageID) {
        guard let message = store.message(id), let media = message.kind.media else { return }
        guard MediaStorage.exists(media.file) else {
            Toast.show("Файл ещё готовится", icon: "hourglass", in: view, bottomInset: bottomVisualInset)
            return
        }
        let preview = FilePreviewController(url: MediaStorage.url(for: media.file), title: media.fileName)
        present(preview.controller, animated: true)
    }

    // MARK: Режим выбора

    func beginSelection(with id: MessageID?) {
        guard !cellContext.isSelecting else { return }
        view.endEditing(true)
        cellContext.isSelecting = true
        cellContext.selectedIds = id.map { rowIdsContaining($0) } ?? []
        selectionBar.deleteButton.addTarget(self, action: #selector(deleteSelected), for: .touchUpInside)
        selectionBar.forwardButton.addTarget(self, action: #selector(forwardSelected), for: .touchUpInside)
        if selectionBar.superview == nil { view.addSubview(selectionBar) }
        selectionBar.setCount(cellContext.selectedIds.count)
        selectionBar.alpha = 0
        view.setNeedsLayout()
        view.layoutIfNeeded()
        let cancel = UIBarButtonItem(title: "Отмена", style: .prominent, target: self, action: #selector(endSelectionTapped))
        cancel.accessibilityIdentifier = "selection.cancel"
        navigationItem.rightBarButtonItems = [cancel]
        navigationItem.hidesBackButton = true
        let clear = UIBarButtonItem(title: "Очистить чат", style: .plain, target: self, action: #selector(clearHistoryTapped))
        clear.tintColor = Palette.destructive
        navigationItem.leftBarButtonItem = clear
        updateSelectionTitle()
        Motion.layout {
            self.selectionBar.alpha = 1
            self.inputPanel.alpha = 0
            self.inputHeightConstraint.constant = SelectionToolbar.height
            self.view.layoutIfNeeded()
        }
        updatePinnedPanel(animated: true)
        for case let cell as MessageCell in collectionView.visibleCells {
            cell.updateSelection(context: cellContext, animated: true)
        }
        Haptics.selection()
    }

    func rowIdsContaining(_ id: MessageID) -> Set<MessageID> {
        guard let index = rowIndex(of: id) else { return [id] }
        return Set(rows[index].allIds)
    }

    func toggleSelection(_ ids: [MessageID]) {
        let set = Set(ids)
        if set.isSubset(of: cellContext.selectedIds) {
            cellContext.selectedIds.subtract(set)
        } else {
            cellContext.selectedIds.formUnion(set)
        }
        Haptics.selection()
        selectionBar.setCount(cellContext.selectedIds.count)
        updateSelectionTitle()
        for case let cell as MessageCell in collectionView.visibleCells where !Set(cell.messageIds).isDisjoint(with: set) {
            cell.updateSelection(context: cellContext, animated: true)
        }
    }

    private func updateSelectionTitle() {
        let label = UILabel()
        label.text = cellContext.selectedIds.isEmpty ? "Выберите сообщения" : "Выбрано: \(cellContext.selectedIds.count)"
        label.font = .systemFont(ofSize: 17, weight: .semibold)
        label.accessibilityIdentifier = "selection.title"
        navigationItem.titleView = label
    }

    @objc private func endSelectionTapped() { endSelection() }

    func endSelection() {
        guard cellContext.isSelecting else { return }
        cellContext.isSelecting = false
        cellContext.selectedIds = []
        restoreNavigationItems()
        Motion.layout({
            self.selectionBar.alpha = 0
            self.inputPanel.alpha = 1
            self.inputHeightConstraint.constant = self.inputPanel.contentHeight
            self.view.layoutIfNeeded()
        }, completion: { _ in
            if !self.cellContext.isSelecting { self.selectionBar.removeFromSuperview() }
        })
        updatePinnedPanel(animated: true)
        for case let cell as MessageCell in collectionView.visibleCells {
            cell.updateSelection(context: cellContext, animated: true)
        }
    }

    @objc private func deleteSelected() {
        let ids = Array(cellContext.selectedIds)
        confirmDelete(ids) { [weak self] in self?.endSelection() }
    }

    @objc private func forwardSelected() {
        let ids = Array(cellContext.selectedIds)
        presentForwardPicker(ids) { [weak self] in self?.endSelection() }
    }

    @objc func clearHistoryTapped() {
        let alert = UIAlertController(
            title: "Очистить историю?", message: "Все сообщения в этом чате будут удалены. Это действие нельзя отменить.",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "Отмена", style: .cancel))
        alert.addAction(UIAlertAction(title: "Очистить", style: .destructive) { [weak self] _ in
            self?.endSelection()
            AudioPlayerService.shared.stop()
            self?.store.clearHistory()
            Haptics.success()
        })
        present(alert, animated: true)
    }

    // MARK: Меню «Ещё»

    func makeMoreMenu() -> UIMenu {
        UIMenu(children: [
            UIDeferredMenuElement.uncached { [weak self] completion in
                MainActor.assumeIsolated {
                    guard let self else { return completion([]) }
                    let muted = self.store.settings.isMuted
                    let actions: [UIMenuElement] = [
                        UIAction(title: "Поиск", image: UIImage(systemName: "magnifyingglass")) { [weak self] _ in self?.beginSearch() },
                        UIAction(title: "Выбрать сообщения", image: UIImage(systemName: "checkmark.circle")) { [weak self] _ in self?.beginSelection(with: nil) },
                        UIAction(title: muted ? "Включить уведомления" : "Без звука", image: UIImage(systemName: muted ? "bell" : "bell.slash")) { [weak self] _ in
                            self?.store.updateSettings { $0.isMuted.toggle() }
                        },
                        UIAction(title: ThemeManager.shared.isDark ? "Светлая тема" : "Тёмная тема", image: UIImage(systemName: ThemeManager.shared.isDark ? "sun.max" : "moon")) { _ in
                            ThemeManager.shared.toggle()
                        },
                        UIAction(title: "Обои чата", image: UIImage(systemName: "photo.on.rectangle")) { [weak self] _ in self?.presentWallpaperPicker() },
                        UIMenu(options: .displayInline, children: [
                            UIAction(title: "Debug Menu", image: UIImage(systemName: "ladybug")) { [weak self] _ in
                                guard let self else { return }
                                DebugMenu.present(from: self)
                            },
                            UIAction(title: "Очистить историю", image: UIImage(systemName: "trash"), attributes: .destructive) { [weak self] _ in self?.clearHistoryTapped() },
                        ]),
                    ]
                    completion(actions)
                }
            },
        ])
    }

    func openProfile() {
        guard !cellContext.isSelecting else { return }
        view.endEditing(true)
        let profile = ProfileViewController(store: store)
        profile.onSearch = { [weak self] in self?.beginSearch() }
        profile.onOpenMessage = { [weak self] id in self?.scrollToMessage(id) }
        navigationController?.pushViewController(profile, animated: true)
    }
}

// MARK: - Панель ввода

extension ChatViewController: InputPanelDelegate {
    func inputPanel(_ panel: InputPanelView, didSend text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        switch panel.accessory {
        case let .edit(id, _)?:
            if let message = store.message(id), case .text = message.kind, trimmed.isEmpty {
                // Пустой текст при правке = удалить (как в Telegram).
                confirmDelete([id])
                return
            }
            store.edit(id, text: trimmed)
            panel.clearAfterSend()
            panel.setAccessory(nil, animated: true)
            restoreDraftAfterEdit()
            scrollToMessage(id, highlight: true)
            Haptics.impact()
        case let .reply(id, _, _)?:
            panel.setAccessory(nil, animated: false)
            panel.clearAfterSend()
            store.send(text: trimmed, replyTo: id)
            store.updateSettings { $0.draft = "" }
        case nil:
            panel.clearAfterSend()
            store.send(text: trimmed, replyTo: nil)
            store.updateSettings { $0.draft = "" }
        }
    }

    private func restoreDraftAfterEdit() {
        let draft = store.settings.draft
        if !draft.isEmpty { inputPanel.text = draft }
    }

    func cancelAccessory() {
        let wasEdit: Bool = { if case .edit = inputPanel.accessory { return true } else { return false } }()
        inputPanel.setAccessory(nil, animated: true)
        if wasEdit {
            inputPanel.text = ""
            restoreDraftAfterEdit()
        }
    }

    func inputPanelDidCancelAccessory(_ panel: InputPanelView) { cancelAccessory() }

    func inputPanelDidTapAccessory(_ panel: InputPanelView) {
        if let id = panel.accessory?.messageId { scrollToMessage(id) }
    }

    func inputPanelDidTapAttach(_ panel: InputPanelView) { presentAttachmentMenu() }

    func inputPanelHeightDidChange(_ panel: InputPanelView, animated: Bool) {
        guard !cellContext.isSelecting else { return }
        updateInputHeight(animated: animated)
    }

    func inputPanelTextDidChange(_ panel: InputPanelView) {
        if case .edit = panel.accessory { return }
    }

    func inputPanel(_ panel: InputPanelView, didRecordVoice media: MediaRef) {
        let replyTo: MessageID? = { if case let .reply(id, _, _)? = panel.accessory { return id } else { return nil } }()
        if replyTo != nil { panel.setAccessory(nil, animated: true) }
        store.sendMedia([.voice(media)], caption: "", replyTo: replyTo)
    }

    func inputPanel(_ panel: InputPanelView, didRecordVideoNote media: MediaRef) {
        let replyTo: MessageID? = { if case let .reply(id, _, _)? = panel.accessory { return id } else { return nil } }()
        if replyTo != nil { panel.setAccessory(nil, animated: true) }
        store.sendMedia([.videoNote(media)], caption: "", replyTo: replyTo)
    }

    /// Отправка вложений (фото/видео/файлы) с подписью и ответом.
    func sendAttachments(_ kinds: [MessageKind], caption: String) {
        let replyTo: MessageID? = { if case let .reply(id, _, _)? = inputPanel.accessory { return id } else { return nil } }()
        if replyTo != nil { inputPanel.setAccessory(nil, animated: true) }
        store.sendMedia(kinds, caption: caption, replyTo: replyTo)
    }
}

/// Просмотр файла через Quick Look (PDF, текст, таблицы).
final class FilePreviewController: NSObject, QLPreviewControllerDataSource {
    private let item: PreviewItem
    let controller = QLPreviewController()

    init(url: URL, title: String?) {
        item = PreviewItem(url: url, title: title)
        super.init()
        controller.dataSource = self
        // Источник данных слабый: держим себя, пока жив контроллер.
        objc_setAssociatedObject(controller, &FilePreviewController.key, self, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
    }

    nonisolated(unsafe) private static var key: UInt8 = 0

    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { item }

    final class PreviewItem: NSObject, QLPreviewItem {
        let previewItemURL: URL?
        let previewItemTitle: String?
        init(url: URL, title: String?) {
            previewItemURL = url
            previewItemTitle = title
        }
    }
}
