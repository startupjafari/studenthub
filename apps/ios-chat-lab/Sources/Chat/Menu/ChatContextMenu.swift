import UIKit

// MARK: - Вход из ленты

extension ChatViewController {
    /// Меню сообщения по образцу Telegram (`ContextControllerExtractedPresentationNode`):
    /// пузырь «вынимается» из ленты поверх размытого фона, сверху — панель реакций,
    /// снизу — список действий. Числа — `TELEGRAM_CHAT_ANALYSIS.md` §4.
    func presentContextMenu(for cell: MessageCell, messageId: MessageID) {
        guard let window = view.window, let message = store.message(messageId), !message.isService else {
            animatePress(cell, pressed: false)
            return
        }
        view.endEditing(true)
        PerformanceMonitor.shared.markActive(for: 1)
        let overlay = ContextMenuOverlay(controller: self, cell: cell, message: message, actions: contextActions(for: message))
        overlay.present(in: window)
    }

    private func contextActions(for message: Message) -> [ContextMenuAction] {
        let id = message.id
        let rowIds = Array(rowIdsContaining(id)).sorted()
        var actions: [ContextMenuAction] = [
            ContextMenuAction(id: "reply", title: "Ответить", symbol: "arrowshape.turn.up.left") { [weak self] in
                self?.beginReply(to: id)
            },
        ]
        if message.hasCopyableText {
            actions.append(ContextMenuAction(id: "copy", title: "Копировать", symbol: "doc.on.doc") { [weak self] in
                self?.copyText([id])
            })
        }
        actions.append(ContextMenuAction(id: "forward", title: "Переслать", symbol: "arrowshape.turn.up.right") { [weak self] in
            self?.presentForwardPicker(rowIds)
        })
        if message.isEditable {
            actions.append(ContextMenuAction(id: "edit", title: "Изменить", symbol: "pencil") { [weak self] in
                self?.beginEdit(id)
            })
        }
        let pinned = store.isPinned(id)
        actions.append(ContextMenuAction(id: "pin", title: pinned ? "Открепить" : "Закрепить", symbol: pinned ? "pin.slash" : "pin") { [weak self] in
            self?.togglePin(id)
        })
        actions.append(ContextMenuAction(id: "select", title: "Выбрать", symbol: "checkmark.circle") { [weak self] in
            self?.beginSelection(with: id)
        })
        actions.append(ContextMenuAction(id: "delete", title: "Удалить", symbol: "trash", isDestructive: true) { [weak self] in
            self?.confirmDelete(rowIds)
        })
        return actions
    }

    /// Выбор получателя для пересылки (лист со строкой поиска).
    func presentForwardPicker(_ ids: [MessageID], completion: (() -> Void)? = nil) {
        guard !ids.isEmpty else { return }
        let picker = ForwardPickerController(peer: store.peer) { [weak self] target in
            guard let self else { return }
            self.store.forward(ids, to: target)
            Haptics.success()
            Toast.show("Переслано в «\(target.name)»", icon: "arrowshape.turn.up.right", in: self.view, bottomInset: self.bottomVisualInset)
            completion?()
        }
        let navigation = UINavigationController(rootViewController: picker)
        if let sheet = navigation.sheetPresentationController {
            sheet.detents = [.medium(), .large()]
            sheet.prefersGrabberVisible = true
            sheet.prefersScrollingExpandsWhenScrolledToEdge = true
        }
        present(navigation, animated: true)
    }
}

// MARK: - Модель

struct ContextMenuAction {
    var id: String
    var title: String
    var symbol: String
    var isDestructive = false
    var handler: () -> Void
}

/// Пружина открытия меню: m = 5, k = 900, c = 104 (ζ ≈ 0,78), уложенная в 0,42 с.
@MainActor
private func menuSpring(_ animations: @escaping () -> Void, completion: ((Bool) -> Void)? = nil) {
    UIView.animate(
        withDuration: 0.42, delay: 0, usingSpringWithDamping: 0.78, initialSpringVelocity: 0,
        options: [.beginFromCurrentState, .allowUserInteraction], animations: animations, completion: completion
    )
}

// MARK: - Оверлей

final class ContextMenuOverlay: UIView {
    /// Держит оверлей, пока он на экране.
    private static var current: ContextMenuOverlay?

    private weak var controller: ChatViewController?
    private weak var sourceCell: MessageCell?
    private let message: Message
    private let actions: [ContextMenuAction]

    private let dimView = UIView()
    private let blurView = UIVisualEffectView(effect: nil)
    private var blurAnimator: UIViewPropertyAnimator?
    private var blurLink: CADisplayLink?
    private var blurFrom: CGFloat = 0
    private var blurTo: CGFloat = 0
    private var blurStart: CFTimeInterval = 0
    private var blurDuration: CFTimeInterval = 0.2
    /// Доля полного размытия, примерно равная радиусу 10 pt.
    private static let blurFraction: CGFloat = 0.32

    private let snapshotContainer = UIView()
    private var snapshot: UIView?
    private let menuView = ContextActionListView()
    private let reactionBar = ReactionBarView()

    private var sourceFrame: CGRect = .zero
    private var targetBubbleFrame: CGRect = .zero
    private var pressScale: CGFloat = 1
    private var isClosing = false
    private var longPressTarget: UILongPressGestureRecognizer?
    /// Касание началось вне меню и реакций — по отпусканию закрыть.
    private var touchStartedOutside = false

    private var reduceMotion: Bool { Motion.reduceMotion || !UIView.areAnimationsEnabled }

    init(controller: ChatViewController, cell: MessageCell, message: Message, actions: [ContextMenuAction]) {
        self.controller = controller
        self.sourceCell = cell
        self.message = message
        self.actions = actions
        super.init(frame: .zero)
        accessibilityIdentifier = "contextMenu"
        accessibilityViewIsModal = true
        isAccessibilityElement = false
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    // MARK: Показ

    func present(in window: UIWindow) {
        guard let cell = sourceCell else { return }
        Self.current?.close(animated: false)
        Self.current = self
        frame = window.bounds
        autoresizingMask = [.flexibleWidth, .flexibleHeight]

        // Фон: затемнение + размытие (радиус ~10), оба проявляются за 0,2 с.
        dimView.backgroundColor = UIColor.dynamic(light: UIColor.black.withAlphaComponent(0.18), dark: UIColor.black.withAlphaComponent(0.45))
        dimView.frame = bounds
        dimView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        dimView.alpha = 0
        blurView.frame = bounds
        blurView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        addSubview(blurView)
        addSubview(dimView)
        let animator = UIViewPropertyAnimator(duration: 1, curve: .linear) { [blurView] in
            blurView.effect = UIBlurEffect(style: .regular)
        }
        animator.pausesOnCompletion = true
        animator.fractionComplete = 0
        blurAnimator = animator

        // Снимок пузыря из текущего (вдавленного) состояния.
        cell.swipeContainer.layer.removeAllAnimations()
        pressScale = cell.swipeContainer.transform.a
        cell.swipeContainer.transform = .identity
        sourceFrame = cell.bubbleFrameInWindow()
        let localRect = cell.swipeContainer.convert(sourceFrame, from: nil)
        let snapshot = cell.swipeContainer.resizableSnapshotView(from: localRect, afterScreenUpdates: true, withCapInsets: .zero) ?? UIView()
        self.snapshot = snapshot
        snapshotContainer.clipsToBounds = false
        snapshotContainer.isUserInteractionEnabled = false
        snapshotContainer.accessibilityElementsHidden = true
        addSubview(snapshotContainer)
        snapshotContainer.addSubview(snapshot)
        cell.swipeContainer.alpha = 0

        // Меню и реакции.
        let mine = message.reactions.first(where: \.byMe)?.emoji
        reactionBar.configure(selected: mine)
        reactionBar.onPick = { [weak self] emoji, sourceView in self?.pickReaction(emoji, from: sourceView) }
        reactionBar.onExpand = { [weak self] in self?.expandReactions() }
        menuView.configure(actions: actions)
        addSubview(reactionBar)
        addSubview(menuView)

        window.addSubview(self)
        layoutTargets()

        // Исходное положение: пузырь на месте, в масштабе вдавливания.
        snapshotContainer.frame = sourceFrame
        snapshot.frame = snapshotContainer.bounds
        snapshotContainer.transform = CGAffineTransform(scaleX: pressScale, y: pressScale)

        let finalMenuFrame = menuView.frame
        let finalBarFrame = reactionBar.frame

        if reduceMotion {
            snapshotContainer.transform = .identity
            snapshotContainer.frame = targetBubbleFrame
            snapshot.frame = snapshotContainer.bounds
            for view in [menuView, reactionBar, dimView] { view.alpha = 0 }
            animator.fractionComplete = Self.blurFraction
            blurView.alpha = 0
            UIView.animate(withDuration: 0.2) {
                for view in [self.menuView, self.reactionBar, self.dimView, self.blurView] { view.alpha = 1 }
            }
        } else {
            animateBlur(to: Self.blurFraction, duration: 0.2)
            UIView.animate(withDuration: 0.2) { self.dimView.alpha = 1 }

            // Меню появляется из 0,01 у края, прилегающего к пузырю.
            setAnchoredScale(menuView, finalFrame: finalMenuFrame, scale: 0.01, anchorTop: finalMenuFrame.minY >= targetBubbleFrame.maxY - 1)
            menuView.alpha = 0
            UIView.animate(withDuration: 0.05) { self.menuView.alpha = 1 }

            reactionBar.alpha = 0
            reactionBar.frame = finalBarFrame.offsetBy(dx: 0, dy: sourceFrame.minY - targetBubbleFrame.minY)
            UIView.animate(withDuration: 0.15) { self.reactionBar.alpha = 1 }
            reactionBar.animateButtonsIn()

            menuSpring {
                self.snapshotContainer.transform = .identity
                self.snapshotContainer.frame = self.targetBubbleFrame
                self.snapshot?.frame = self.snapshotContainer.bounds
                self.menuView.transform = .identity
                self.menuView.frame = finalMenuFrame
                self.reactionBar.frame = finalBarFrame
            }
        }

        attachToLongPress()
        Haptics.prepare()
        UIAccessibility.post(notification: .screenChanged, argument: menuView.firstItem)
    }

    /// Положение пузыря, реакций и меню (отступы Telegram: пузырь↔меню 7 pt, низ 10 pt над
    /// безопасной зоной, верх = статус-бар + 8 pt, край экрана 12 pt, реакции 46 pt на 18 pt выше).
    private func layoutTargets() {
        let safe = safeAreaInsets
        let width = bounds.width
        let menuSize = menuView.preferredSize()
        let barSize = reactionBar.preferredSize(maxWidth: width - 24)
        let topLimit = safe.top + 8
        let bottomLimit = bounds.height - safe.bottom - 10
        let above = barSize.height + 18
        let below = 7 + menuSize.height

        // Пузырь выше доступного места — уменьшаем снимок.
        var bubbleSize = sourceFrame.size
        let maxBubbleHeight = bottomLimit - topLimit - above - below
        if bubbleSize.height > maxBubbleHeight, maxBubbleHeight > 40 {
            let scale = max(0.35, maxBubbleHeight / bubbleSize.height)
            bubbleSize = CGSize(width: bubbleSize.width * scale, height: min(bubbleSize.height * scale, maxBubbleHeight))
            snapshotContainer.clipsToBounds = true
        }
        var bubbleX = sourceFrame.minX
        if bubbleSize.width != sourceFrame.width {
            // Уменьшенный пузырь держится за свой край экрана.
            bubbleX = sourceFrame.midX > width / 2 ? sourceFrame.maxX - bubbleSize.width : sourceFrame.minX
        }
        var bubbleY = sourceFrame.minY
        bubbleY = min(bubbleY, bottomLimit - below - bubbleSize.height)
        bubbleY = max(bubbleY, topLimit + above)
        targetBubbleFrame = CGRect(x: bubbleX, y: bubbleY, width: bubbleSize.width, height: bubbleSize.height)

        let alignRight = targetBubbleFrame.midX > width / 2
        func horizontal(_ size: CGSize) -> CGFloat {
            let x = alignRight ? targetBubbleFrame.maxX - size.width : targetBubbleFrame.minX
            return min(max(12, x), width - 12 - size.width)
        }
        var menuY = targetBubbleFrame.maxY + 7
        if menuY + menuSize.height > bottomLimit {
            // Не помещается снизу даже после сдвига (крошечный экран) — меню поверх низа пузыря.
            menuY = bottomLimit - menuSize.height
        }
        menuView.transform = .identity
        menuView.frame = CGRect(x: horizontal(menuSize), y: menuY, width: menuSize.width, height: menuSize.height)
        reactionBar.frame = CGRect(x: horizontal(barSize), y: max(topLimit, targetBubbleFrame.minY - 18 - barSize.height), width: barSize.width, height: barSize.height)
        reactionBar.alignsRight = alignRight
    }

    private func setAnchoredScale(_ view: UIView, finalFrame: CGRect, scale: CGFloat, anchorTop: Bool) {
        let anchorX = finalFrame.midX > bounds.width / 2 ? finalFrame.maxX : finalFrame.minX
        let anchorY = anchorTop ? finalFrame.minY : finalFrame.maxY
        view.transform = .identity
        view.frame = finalFrame
        let dx = anchorX - finalFrame.midX
        let dy = anchorY - finalFrame.midY
        view.transform = CGAffineTransform(translationX: dx, y: dy).scaledBy(x: scale, y: scale).translatedBy(x: -dx, y: -dy)
    }

    // MARK: Размытие

    /// Радиус размытия ведём долей аниматора (display link), а не прозрачностью эффекта.
    private func animateBlur(to fraction: CGFloat, duration: CFTimeInterval) {
        blurFrom = blurAnimator?.fractionComplete ?? 0
        blurTo = fraction
        blurStart = CACurrentMediaTime()
        blurDuration = max(0.01, duration)
        blurLink?.invalidate()
        let link = CADisplayLink(target: BlurTicker(self), selector: #selector(BlurTicker.tick))
        link.add(to: .main, forMode: .common)
        blurLink = link
    }

    fileprivate func blurTick() {
        let t = min(1, (CACurrentMediaTime() - blurStart) / blurDuration)
        let eased = t < 0.5 ? 2 * t * t : 1 - pow(-2 * t + 2, 2) / 2
        blurAnimator?.fractionComplete = blurFrom + (blurTo - blurFrom) * CGFloat(eased)
        if t >= 1 {
            blurLink?.invalidate()
            blurLink = nil
        }
    }

    private final class BlurTicker: NSObject {
        weak var owner: ContextMenuOverlay?
        init(_ owner: ContextMenuOverlay) { self.owner = owner }
        @objc func tick() { MainActor.assumeIsolated { owner?.blurTick() } }
    }

    // MARK: Касания: скольжение по пунктам, тап по фону

    /// Палец, который открыл меню, ещё на экране: продолжаем вести его по пунктам.
    private func attachToLongPress() {
        guard let collectionView = controller?.collectionView else { return }
        let press = collectionView.gestureRecognizers?.compactMap { $0 as? UILongPressGestureRecognizer }.first
        guard let press, press.state == .began || press.state == .changed else { return }
        press.addTarget(self, action: #selector(trackLongPress(_:)))
        longPressTarget = press
    }

    private func detachFromLongPress() {
        longPressTarget?.removeTarget(self, action: #selector(trackLongPress(_:)))
        longPressTarget = nil
    }

    @objc private func trackLongPress(_ gesture: UILongPressGestureRecognizer) {
        let point = gesture.location(in: self)
        switch gesture.state {
        case .changed:
            trackFinger(at: point)
        case .ended:
            detachFromLongPress()
            if let index = menuView.highlightedIndex {
                trigger(index)
            } else if let emoji = reactionBar.emoji(at: convert(point, to: reactionBar)) {
                pickReaction(emoji.0, from: emoji.1)
            }
        case .cancelled, .failed:
            detachFromLongPress()
            menuView.setHighlighted(nil)
        default:
            break
        }
    }

    private func trackFinger(at point: CGPoint) {
        let local = convert(point, to: menuView)
        let index = menuView.bounds.contains(local) ? menuView.index(at: local) : nil
        if index != menuView.highlightedIndex {
            if index != nil { Haptics.selection() }
            menuView.setHighlighted(index)
        }
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = touches.first, !isClosing else { return }
        let point = touch.location(in: self)
        touchStartedOutside = !menuView.frame.contains(point) && !reactionBar.frame.contains(point)
        if !touchStartedOutside { trackFinger(at: point) }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = touches.first, !isClosing, !touchStartedOutside else { return }
        trackFinger(at: touch.location(in: self))
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard !isClosing else { return }
        if touchStartedOutside {
            close(animated: true)
            return
        }
        if let index = menuView.highlightedIndex {
            trigger(index)
        }
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        menuView.setHighlighted(nil)
    }

    override func accessibilityPerformEscape() -> Bool {
        close(animated: true)
        return true
    }

    private func trigger(_ index: Int) {
        guard index < actions.count, !isClosing else { return }
        let action = actions[index]
        menuView.setHighlighted(index)
        close(animated: true) {
            action.handler()
        }
    }

    fileprivate func triggerAction(id: String) {
        guard let index = actions.firstIndex(where: { $0.id == id }) else { return }
        trigger(index)
    }

    // MARK: Реакции

    private func expandReactions() {
        let maxHeight = max(120, targetBubbleFrame.minY - safeAreaInsets.top - 8 - 18)
        let expandedHeight = min(46 * 4 + 12, maxHeight)
        let width = bounds.width - 24
        var frame = reactionBar.frame
        frame.origin.x = 12
        frame.size.width = width
        frame.origin.y = frame.maxY - expandedHeight
        frame.size.height = expandedHeight
        reactionBar.setExpanded(true)
        Haptics.impact()
        menuSpring {
            self.reactionBar.frame = frame
            self.reactionBar.layoutIfNeeded()
        }
    }

    /// Реакция улетает в пузырь, меню закрывается за 0,25 с, затем реакция ставится —
    /// чип в ячейке появляется своей пружиной.
    private func pickReaction(_ emoji: String, from sourceView: UIView) {
        guard !isClosing else { return }
        Haptics.selection()
        let messageId = message.id
        let flying = UILabel()
        flying.text = emoji
        flying.font = .systemFont(ofSize: 30)
        flying.textAlignment = .center
        flying.frame = sourceView.convert(sourceView.bounds, to: self)
        addSubview(flying)
        let returnFrame = currentReturnFrame()
        let target = CGPoint(x: message.isOutgoing ? returnFrame.maxX - 22 : returnFrame.minX + 22, y: returnFrame.maxY - 14)
        if reduceMotion {
            flying.removeFromSuperview()
        } else {
            UIView.animate(withDuration: 0.25, delay: 0, options: [.curveEaseInOut]) {
                flying.center = target
                flying.transform = CGAffineTransform(scaleX: 0.5, y: 0.5)
            } completion: { _ in
                UIView.animate(withDuration: 0.1, animations: { flying.alpha = 0 }, completion: { _ in flying.removeFromSuperview() })
            }
        }
        close(animated: true, duration: 0.25) { [weak controller] in
            controller?.store.toggleReaction(messageId, emoji: emoji)
        }
    }

    // MARK: Закрытие

    private func currentReturnFrame() -> CGRect {
        if let controller, let cell = controller.cell(for: message.id) {
            sourceCell = cell
            cell.swipeContainer.alpha = 0
            return cell.bubbleFrameInWindow()
        }
        return sourceFrame
    }

    func close(animated: Bool, duration: TimeInterval = 0.2, completion: (() -> Void)? = nil) {
        guard !isClosing else { return }
        isClosing = true
        PerformanceMonitor.shared.markActive(for: 0.5)
        detachFromLongPress()
        let returnFrame = currentReturnFrame()
        let cellAlive = controller?.cell(for: message.id) != nil
        let finish = { [weak self] in
            guard let self else { return }
            self.sourceCell?.swipeContainer.alpha = 1
            self.blurLink?.invalidate()
            self.blurAnimator?.stopAnimation(true)
            self.removeFromSuperview()
            if Self.current === self { Self.current = nil }
            UIAccessibility.post(notification: .screenChanged, argument: nil)
            completion?()
        }
        guard animated, !reduceMotion else {
            if animated {
                UIView.animate(withDuration: 0.2, animations: { self.alpha = 0 }, completion: { _ in finish() })
            } else {
                finish()
            }
            return
        }
        animateBlur(to: 0, duration: duration)
        let menuFinal = menuView.frame
        UIView.animate(withDuration: duration, delay: 0, options: [.curveEaseInOut, .beginFromCurrentState]) {
            self.dimView.alpha = 0
            self.reactionBar.alpha = 0
            self.menuView.alpha = 0
            self.setAnchoredScale(self.menuView, finalFrame: menuFinal, scale: 0.01, anchorTop: menuFinal.minY >= self.targetBubbleFrame.maxY - 1)
            if cellAlive {
                self.snapshotContainer.frame = returnFrame
                self.snapshot?.frame = self.snapshotContainer.bounds
            } else {
                self.snapshotContainer.alpha = 0
            }
        } completion: { _ in
            finish()
        }
    }
}

// MARK: - Список действий

/// Список действий: материал, скругление 14, разделители, значки справа (как у Telegram).
final class ContextActionListView: UIView {
    static let rowHeight: CGFloat = 44
    static let width: CGFloat = 250

    private let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemMaterial))
    private var rows: [ContextActionRow] = []
    private(set) var highlightedIndex: Int?

    override init(frame: CGRect) {
        super.init(frame: frame)
        layer.cornerRadius = 14
        layer.cornerCurve = .continuous
        clipsToBounds = true
        addSubview(blur)
        // Касания ведёт оверлей (скольжение по пунктам), строки — только для отрисовки и VoiceOver.
        isUserInteractionEnabled = false
        accessibilityIdentifier = "contextMenu.list"
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(actions: [ContextMenuAction]) {
        rows.forEach { $0.removeFromSuperview() }
        rows = actions.enumerated().map { index, action in
            let row = ContextActionRow(action: action, showsSeparator: index < actions.count - 1)
            row.onActivate = { [weak self] in
                guard let overlay = self?.superview as? ContextMenuOverlay else { return }
                overlay.triggerAction(id: action.id)
            }
            addSubview(row)
            return row
        }
        accessibilityElements = rows
    }

    var firstItem: UIView? { rows.first }

    func preferredSize() -> CGSize {
        CGSize(width: Self.width, height: CGFloat(rows.count) * Self.rowHeight)
    }

    func index(at point: CGPoint) -> Int? {
        let index = Int(point.y / Self.rowHeight)
        return index >= 0 && index < rows.count ? index : nil
    }

    func setHighlighted(_ index: Int?) {
        highlightedIndex = index
        for (offset, row) in rows.enumerated() { row.isHighlighted = offset == index }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        blur.frame = bounds
        for (index, row) in rows.enumerated() {
            row.frame = CGRect(x: 0, y: CGFloat(index) * Self.rowHeight, width: bounds.width, height: Self.rowHeight)
        }
    }
}

final class ContextActionRow: UIView {
    private let titleLabel = UILabel()
    private let iconView = UIImageView()
    private let separator = UIView()
    private let highlight = UIView()
    var onActivate: (() -> Void)?

    var isHighlighted = false {
        didSet { highlight.alpha = isHighlighted ? 1 : 0 }
    }

    init(action: ContextMenuAction, showsSeparator: Bool) {
        super.init(frame: .zero)
        highlight.backgroundColor = UIColor.label.withAlphaComponent(0.1)
        highlight.alpha = 0
        addSubview(highlight)
        let color: UIColor = action.isDestructive ? Palette.destructive : .label
        titleLabel.text = action.title
        titleLabel.font = .systemFont(ofSize: 17)
        titleLabel.textColor = color
        addSubview(titleLabel)
        iconView.image = UIImage(systemName: action.symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 18))
        iconView.tintColor = color
        iconView.contentMode = .center
        addSubview(iconView)
        separator.backgroundColor = .separator
        separator.isHidden = !showsSeparator
        addSubview(separator)
        isAccessibilityElement = true
        accessibilityLabel = action.title
        accessibilityTraits = .button
        accessibilityIdentifier = "contextMenu.\(action.id)"
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func accessibilityActivate() -> Bool {
        onActivate?()
        return true
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        highlight.frame = bounds
        titleLabel.frame = CGRect(x: 16, y: 0, width: bounds.width - 60, height: bounds.height)
        iconView.frame = CGRect(x: bounds.width - 44, y: 0, width: 32, height: bounds.height)
        let line = 1 / traitCollection.displayScale
        separator.frame = CGRect(x: 0, y: bounds.height - line, width: bounds.width, height: line)
    }
}

// MARK: - Панель реакций

/// Капсула реакций 46 pt. Кнопки вылетают по одной: задержка `0,01 + 0,3·расстояние/ширина`,
/// пружина 0,4 с. Стрелка раскрывает сетку со всеми эмодзи.
final class ReactionBarView: UIView {
    static let quick = ["👍", "❤️", "🔥", "😂", "😮", "😢", "🙏"]
    static let all = [
        "👍", "👎", "❤️", "🔥", "🥰", "👏", "😁", "🤔", "🤯", "😱", "🤬", "😢", "🎉", "🤩", "🤮", "💩",
        "🙏", "👌", "🕊", "🤡", "🥱", "🥴", "😍", "🐳", "❤️‍🔥", "🌚", "🌭", "💯", "🤣", "⚡️", "🍌", "🏆",
        "💔", "🤨", "😐", "🍓", "🍾", "💋", "🖕", "😈", "😴", "😭", "🤓", "👻", "👨‍💻", "👀", "🎃", "🙈",
        "😇", "😨", "🤝", "✍️", "🤗", "🫡", "🎅", "🎄", "☃️", "💅", "🤪", "🗿", "🆒", "💘", "🙉", "🦄",
        "😘", "💊", "🙊", "😎", "👾", "🤷‍♂️", "🤷", "🤷‍♀️", "😡", "😂", "😮",
    ]

    var onPick: ((String, UIView) -> Void)?
    var onExpand: (() -> Void)?
    var alignsRight = false

    private let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemMaterial))
    private let scrollView = UIScrollView()
    private var buttons: [ReactionOptionButton] = []
    private let expandButton = UIButton(type: .system)
    private var selected: String?
    private(set) var isExpanded = false

    private static let buttonSize: CGFloat = 34
    private static let spacing: CGFloat = 4
    private static let padding: CGFloat = 6

    override init(frame: CGRect) {
        super.init(frame: frame)
        layer.cornerCurve = .continuous
        clipsToBounds = true
        addSubview(blur)
        scrollView.showsVerticalScrollIndicator = false
        scrollView.alwaysBounceVertical = false
        addSubview(scrollView)
        expandButton.setImage(UIImage(systemName: "chevron.down", withConfiguration: UIImage.SymbolConfiguration(pointSize: 13, weight: .bold)), for: .normal)
        expandButton.tintColor = .secondaryLabel
        expandButton.backgroundColor = UIColor.label.withAlphaComponent(0.08)
        expandButton.layer.cornerRadius = 13
        expandButton.accessibilityLabel = "Все реакции"
        expandButton.accessibilityIdentifier = "reaction.expand"
        expandButton.addAction(UIAction { [weak self] _ in self?.onExpand?() }, for: .touchUpInside)
        addSubview(expandButton)
        accessibilityIdentifier = "reaction.bar"
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(selected: String?) {
        self.selected = selected
        rebuild(emojis: Self.quick)
    }

    private func rebuild(emojis: [String]) {
        buttons.forEach { $0.removeFromSuperview() }
        buttons = emojis.map { emoji in
            let button = ReactionOptionButton(emoji: emoji, selected: emoji == selected)
            button.addAction(UIAction { [weak self, weak button] _ in
                guard let self, let button else { return }
                self.onPick?(emoji, button)
            }, for: .touchUpInside)
            scrollView.addSubview(button)
            return button
        }
    }

    func setExpanded(_ expanded: Bool) {
        isExpanded = expanded
        expandButton.isHidden = expanded
        rebuild(emojis: expanded ? Self.all : Self.quick)
        setNeedsLayout()
    }

    func preferredSize(maxWidth: CGFloat) -> CGSize {
        let count = CGFloat(Self.quick.count + 1)
        let width = Self.padding * 2 + count * Self.buttonSize + (count - 1) * Self.spacing
        return CGSize(width: min(maxWidth, width), height: 46)
    }

    /// Эмодзи под точкой (палец отпущен над панелью после долгого нажатия).
    func emoji(at point: CGPoint) -> (String, UIView)? {
        guard bounds.contains(point) else { return nil }
        let local = convert(point, to: scrollView)
        guard let button = buttons.first(where: { $0.frame.insetBy(dx: -2, dy: -4).contains(local) }) else { return nil }
        return (button.emoji, button)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        layer.cornerRadius = isExpanded ? 20 : bounds.height / 2
        blur.frame = bounds
        let size = Self.buttonSize
        if isExpanded {
            scrollView.frame = bounds.insetBy(dx: Self.padding, dy: Self.padding)
            let columns = max(1, Int((scrollView.bounds.width + Self.spacing) / (size + Self.spacing)))
            let step = (scrollView.bounds.width - size) / CGFloat(max(1, columns - 1))
            for (index, button) in buttons.enumerated() {
                button.frame = CGRect(x: CGFloat(index % columns) * step, y: CGFloat(index / columns) * (size + 6), width: size, height: size)
            }
            scrollView.contentSize = CGSize(width: scrollView.bounds.width, height: CGFloat((buttons.count + columns - 1) / columns) * (size + 6))
        } else {
            scrollView.frame = CGRect(x: 0, y: 0, width: bounds.width - size - Self.padding, height: bounds.height)
            for (index, button) in buttons.enumerated() {
                button.frame = CGRect(x: Self.padding + CGFloat(index) * (size + Self.spacing), y: (bounds.height - size) / 2, width: size, height: size)
            }
            scrollView.contentSize = CGSize(width: Self.padding + CGFloat(buttons.count) * (size + Self.spacing), height: bounds.height)
            expandButton.frame = CGRect(x: bounds.width - Self.padding - 30, y: (bounds.height - 26) / 2, width: 26, height: 26)
        }
    }

    func animateButtonsIn() {
        guard !Motion.reduceMotion else { return }
        layoutIfNeeded()
        let width = max(1, bounds.width)
        let originX = alignsRight ? bounds.width : 0
        for button in buttons + [expandButton] {
            let distance = abs(button.frame.midX - originX)
            let delay = 0.01 + 0.3 * Double(distance / width)
            button.transform = CGAffineTransform(scaleX: 0.01, y: 0.01)
            UIView.animate(springDuration: 0.4, bounce: 0.25, initialSpringVelocity: 0, delay: delay, options: [.allowUserInteraction]) {
                button.transform = .identity
            }
        }
    }
}

final class ReactionOptionButton: UIControl {
    let emoji: String
    private let label = UILabel()
    private let selectionBackground = UIView()

    init(emoji: String, selected: Bool) {
        self.emoji = emoji
        super.init(frame: .zero)
        selectionBackground.backgroundColor = Palette.accent.withAlphaComponent(0.2)
        selectionBackground.isHidden = !selected
        selectionBackground.isUserInteractionEnabled = false
        addSubview(selectionBackground)
        label.text = emoji
        label.font = .systemFont(ofSize: 26)
        label.textAlignment = .center
        label.isUserInteractionEnabled = false
        addSubview(label)
        isAccessibilityElement = true
        accessibilityLabel = emoji
        accessibilityTraits = selected ? [.button, .selected] : .button
        accessibilityIdentifier = "reaction.option.\(emoji)"
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        selectionBackground.frame = bounds
        selectionBackground.layer.cornerRadius = bounds.width / 2
        label.frame = bounds
    }

    override var isHighlighted: Bool {
        didSet {
            UIView.animate(withDuration: 0.15, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
                self.label.transform = self.isHighlighted ? CGAffineTransform(scaleX: 1.3, y: 1.3) : .identity
            }
        }
    }
}

// MARK: - Пересылка

/// Лист выбора получателя: строка поиска и локальный список чатов.
final class ForwardPickerController: UITableViewController, UISearchResultsUpdating {
    private let targets: [ForwardTarget]
    private var filtered: [ForwardTarget]
    private let onPick: (ForwardTarget) -> Void
    private let search = UISearchController(searchResultsController: nil)

    init(peer: Peer, onPick: @escaping (ForwardTarget) -> Void) {
        targets = [
            ForwardTarget(id: peer.id, name: peer.displayName, subtitle: "этот чат", isCurrentChat: true),
            // Те же демо-чаты, что в списке чатов: счётчик пересланного виден там.
        ] + ChatListViewController.demoChats + [
            ForwardTarget(id: 1006, name: "Дина Ахметова", subtitle: "была вчера", isCurrentChat: false),
            ForwardTarget(id: 1007, name: "Походы выходного дня", subtitle: "48 участников", isCurrentChat: false),
        ]
        filtered = targets
        self.onPick = onPick
        super.init(style: .insetGrouped)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Переслать"
        navigationItem.leftBarButtonItem = UIBarButtonItem(systemItem: .cancel, primaryAction: UIAction { [weak self] _ in
            self?.dismiss(animated: true)
        })
        search.searchResultsUpdater = self
        search.obscuresBackgroundDuringPresentation = false
        search.searchBar.placeholder = "Поиск"
        search.searchBar.searchTextField.accessibilityIdentifier = "forward.search"
        navigationItem.searchController = search
        navigationItem.hidesSearchBarWhenScrolling = false
        tableView.register(ForwardTargetCell.self, forCellReuseIdentifier: "target")
        tableView.rowHeight = 56
        tableView.accessibilityIdentifier = "forward.list"
    }

    func updateSearchResults(for searchController: UISearchController) {
        let query = searchController.searchBar.text?.trimmingCharacters(in: .whitespaces) ?? ""
        filtered = query.isEmpty ? targets : targets.filter { $0.name.range(of: query, options: [.caseInsensitive, .diacriticInsensitive]) != nil }
        tableView.reloadData()
    }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { filtered.count }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "target", for: indexPath) as! ForwardTargetCell
        cell.configure(filtered[indexPath.row])
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        let target = filtered[indexPath.row]
        let onPick = onPick
        search.isActive = false
        dismiss(animated: true) { onPick(target) }
    }
}

final class ForwardTargetCell: UITableViewCell {
    private let avatar = AvatarView()

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: .subtitle, reuseIdentifier: reuseIdentifier)
        contentView.addSubview(avatar)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(_ target: ForwardTarget) {
        let parts = target.name.split(separator: " ")
        let peer = Peer(
            id: target.id, firstName: parts.first.map(String.init) ?? target.name,
            lastName: parts.count > 1 ? String(parts[1]) : "", username: "", phone: "", bio: "",
            avatarFile: target.isCurrentChat ? MockChatService.peer.avatarFile : nil
        )
        avatar.configure(peer: peer)
        textLabel?.text = target.name
        detailTextLabel?.text = target.subtitle
        detailTextLabel?.textColor = .secondaryLabel
        accessibilityIdentifier = "forward.target.\(target.id)"
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        avatar.frame = CGRect(x: 16, y: (contentView.bounds.height - 40) / 2, width: 40, height: 40)
        textLabel?.frame.origin.x = 68
        detailTextLabel?.frame.origin.x = 68
        separatorInset.left = 68
    }
}
