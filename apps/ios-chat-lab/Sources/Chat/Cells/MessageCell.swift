import UIKit

/// Что произошло от нажатия в ячейке. Ячейка только определяет цель; действие выполняет
/// контроллер ленты.
enum MessageCellAction {
    case openLink(URL)
    case openReply(MessageID)
    case openMedia(MessageID)
    case toggleVoice(MessageID)
    case openFile(MessageID)
    case toggleVideoNote(MessageID)
    case toggleReaction(MessageID, String)
    case failedMenu(MessageID)
    case bubble(MessageID)
}

/// Состояние ленты, которое влияет на вид ячейки, но не на раскладку.
struct CellContext {
    var isSelecting = false
    var selectedIds: Set<MessageID> = []
    var highlightQuery: String?
}

final class MessageCell: UICollectionViewCell {
    static let reuseId = "MessageCell"

    /// Сдвигается свайпом ответа и режимом выбора.
    let swipeContainer = UIView()
    let bubbleImageView = UIImageView()
    let bubbleContent = UIView()
    private let accessibilityAnchor = UIView()

    private lazy var textView = MessageTextView()
    private lazy var replyView = ReplyHeaderView()
    private lazy var forwardView = ForwardHeaderView()
    private(set) lazy var mosaicView = MediaMosaicView()
    private lazy var fileView = FileBlockView()
    private(set) lazy var voiceView = VoiceBlockView()
    private(set) lazy var videoNoteView = VideoNoteView()
    private let statusView = MessageStatusView()
    private var chipViews: [ReactionChipView] = []
    private let servicePill = UIView()
    private let serviceLabel = MessageTextView()
    private lazy var failedButton: UIButton = {
        let button = UIButton(type: .system)
        button.setImage(UIImage(systemName: "exclamationmark.circle.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 22)), for: .normal)
        button.tintColor = Palette.destructive
        button.isUserInteractionEnabled = false
        button.accessibilityLabel = "Не отправлено"
        return button
    }()
    private lazy var checkbox = SelectionCheckView()
    let replyIcon = SwipeReplyIconView()
    private let highlightOverlay = UIImageView()

    private(set) var layout: MessageLayout?
    private(set) var row: ChatRow?
    private var context = CellContext()

    var messageIds: [MessageID] { row?.allIds ?? [] }
    var primaryId: MessageID? { row?.primary?.id }
    var isBubbleRow: Bool { layout?.style == .bubble || layout?.style == .freeform }

    override init(frame: CGRect) {
        super.init(frame: frame)
        // Лента перевёрнута (низ — индекс 0), содержимое ячейки переворачиваем обратно.
        contentView.transform = CGAffineTransform(scaleX: 1, y: -1)
        contentView.addSubview(swipeContainer)
        swipeContainer.addSubview(bubbleImageView)
        swipeContainer.addSubview(highlightOverlay)
        swipeContainer.addSubview(accessibilityAnchor)
        swipeContainer.addSubview(bubbleContent)
        bubbleContent.addSubview(statusView)
        highlightOverlay.alpha = 0
        accessibilityAnchor.isUserInteractionEnabled = false
        accessibilityAnchor.isAccessibilityElement = true
        contentView.addSubview(servicePill)
        servicePill.addSubview(serviceLabel)
        servicePill.layer.cornerCurve = .continuous
        contentView.addSubview(replyIcon)
        replyIcon.alpha = 0
        registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (cell: MessageCell, _) in cell.applyTheme() }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func prepareForReuse() {
        super.prepareForReuse()
        swipeContainer.transform = .identity
        replyIcon.alpha = 0
        highlightOverlay.layer.removeAllAnimations()
        highlightOverlay.alpha = 0
        if layout?.content == .videoNote { videoNoteView.stop() }
    }

    override func apply(_ layoutAttributes: UICollectionViewLayoutAttributes) {
        super.apply(layoutAttributes)
        // Высоту ячейки меняет пакетное обновление; раскладка внутри уже посчитана.
    }

    // MARK: Настройка

    func configure(row: ChatRow, layout: MessageLayout, context: CellContext, animated: Bool) {
        let previousRow = self.row
        self.row = row
        self.layout = layout
        self.context = context
        let sameRow = previousRow?.id == row.id
        let bounds = CGRect(x: 0, y: 0, width: layout.width, height: layout.height)
        swipeContainer.frame = bounds

        switch layout.style {
        case .date, .service:
            configureService(layout)
            return
        case .bubble, .freeform:
            servicePill.isHidden = true
            bubbleContent.isHidden = false
        }
        guard let primary = row.primary else { return }
        let outgoing = layout.isOutgoing
        let freeform = layout.style == .freeform

        // Пузырь.
        bubbleImageView.isHidden = freeform
        if !freeform {
            bubbleImageView.image = BubbleImages.image(outgoing: outgoing, merge: layout.merge, highlighted: false, traits: traitCollection)
            bubbleImageView.frame = BubbleImages.imageFrame(for: layout.bubbleFrame, outgoing: outgoing)
            highlightOverlay.image = BubbleImages.image(outgoing: outgoing, merge: layout.merge, highlighted: true, traits: traitCollection)
            highlightOverlay.frame = bubbleImageView.frame
        }
        bubbleContent.frame = layout.bubbleFrame
        accessibilityAnchor.frame = layout.bubbleFrame

        // «Переслано от».
        if let name = layout.forwardName, let frame = layout.forwardFrame {
            if forwardView.superview == nil { bubbleContent.addSubview(forwardView) }
            forwardView.isHidden = false
            forwardView.frame = frame
            forwardView.configure(name: name, outgoing: outgoing)
        } else if forwardView.superview != nil {
            forwardView.isHidden = true
        }

        // Ответ.
        if let reply = layout.reply, let frame = layout.replyFrame {
            if replyView.superview == nil { bubbleContent.addSubview(replyView) }
            replyView.isHidden = false
            replyView.frame = frame
            replyView.configure(reply, outgoing: outgoing, freeform: freeform)
        } else if replyView.superview != nil {
            replyView.isHidden = true
        }

        // Содержимое.
        setContentVisible(layout.content)
        switch layout.content {
        case .media:
            mosaicView.frame = layout.contentFrame
            mosaicView.configure(messages: row.messages, frames: layout.mediaTileFrames, roundsTop: layout.mediaRoundsTop, roundsBottom: layout.mediaRoundsBottom)
        case .file:
            if let media = primary.kind.media {
                fileView.frame = layout.contentFrame
                fileView.configure(media: media, outgoing: outgoing)
            }
        case .voice:
            if let media = primary.kind.media {
                voiceView.frame = layout.contentFrame
                voiceView.configure(message: primary, media: media)
            }
        case .videoNote:
            if let media = primary.kind.media {
                videoNoteView.frame = layout.contentFrame
                videoNoteView.configure(message: primary, media: media)
            }
        case .none:
            break
        }

        // Текст.
        if let text = layout.text {
            if textView.superview == nil { bubbleContent.insertSubview(textView, belowSubview: statusView) }
            textView.isHidden = false
            textView.frame = layout.textFrame
            textView.textColor = Palette.text(outgoing: outgoing)
            textView.linkColor = Palette.link(outgoing: outgoing)
            textView.highlightQuery = context.highlightQuery
            if !sameRow || textView.layout?.string != text.string || textView.layout?.boxWidth != text.boxWidth {
                textView.layout = text
            }
        } else if textView.superview != nil {
            textView.isHidden = true
        }

        // Реакции.
        configureReactions(layout, outgoing: outgoing, freeform: freeform, animated: animated && sameRow, previous: previousRow?.primary?.reactions ?? [])

        // Статус.
        statusView.frame = layout.statusFrame
        statusView.configure(
            text: layout.statusText, status: outgoing ? primary.status : nil, outgoing: outgoing,
            placement: layout.statusPlacement, animated: animated && sameRow
        )
        statusView.isHidden = primary.status == .failed && layout.statusPlacement == .inline && false

        // Ошибка отправки — значок слева от пузыря.
        if primary.status == .failed {
            if failedButton.superview == nil { swipeContainer.addSubview(failedButton) }
            failedButton.isHidden = false
            failedButton.frame = CGRect(x: layout.bubbleFrame.minX - 34, y: layout.bubbleFrame.maxY - 28, width: 28, height: 28)
        } else if failedButton.superview != nil {
            failedButton.isHidden = true
        }

        // Режим выбора.
        updateSelection(context: context, animated: animated)

        // Ответ свайпом: значок справа.
        replyIcon.frame = CGRect(x: layout.width - 8, y: layout.bubbleFrame.midY - 15, width: 30, height: 30)

        accessibilityAnchor.accessibilityIdentifier = "message.\(primary.id)"
        accessibilityAnchor.accessibilityLabel = accessibilityText(primary, layout: layout)
        accessibilityAnchor.accessibilityValue = outgoing ? statusDescription(primary.status) : nil
        accessibilityAnchor.accessibilityHint = "Удерживайте для меню, смахните влево для ответа"
        accessibilityElements = [accessibilityAnchor] + chipViews.filter { !$0.isHidden } + (primary.status == .failed ? [failedButton] : [])
    }

    private func accessibilityText(_ message: Message, layout: MessageLayout) -> String {
        var parts: [String] = []
        if let forward = layout.forwardName { parts.append("Переслано от \(forward)") }
        if let reply = layout.reply { parts.append("Ответ на: \(reply.text)") }
        let description = message.kind.shortDescription
        if !description.isEmpty { parts.append(description) }
        if !message.text.isEmpty { parts.append(message.text) }
        if message.editedAt != nil { parts.append("изменено") }
        return parts.joined(separator: ". ")
    }

    private func statusDescription(_ status: DeliveryStatus) -> String {
        switch status {
        case .sending: return "отправляется"
        case .sent: return "отправлено"
        case .delivered: return "доставлено"
        case .read: return "прочитано"
        case .failed: return "ошибка отправки"
        }
    }

    private func setContentVisible(_ content: MessageLayout.Content) {
        func toggle(_ view: UIView, _ visible: Bool) {
            if visible {
                if view.superview == nil { bubbleContent.insertSubview(view, at: 0) }
                view.isHidden = false
            } else if view.superview != nil {
                view.isHidden = true
            }
        }
        toggle(mosaicView, content == .media)
        toggle(fileView, content == .file)
        toggle(voiceView, content == .voice)
        toggle(videoNoteView, content == .videoNote)
        if content != .videoNote, videoNoteView.superview != nil { videoNoteView.stop() }
    }

    private func configureReactions(_ layout: MessageLayout, outgoing: Bool, freeform: Bool, animated: Bool, previous: [MessageReaction]) {
        while chipViews.count < layout.reactionChips.count {
            let chip = ReactionChipView()
            bubbleContent.addSubview(chip)
            chipViews.append(chip)
        }
        let previousEmoji = Set(previous.map(\.emoji))
        for (index, chipView) in chipViews.enumerated() {
            guard index < layout.reactionChips.count else {
                chipView.isHidden = true
                continue
            }
            let chip = layout.reactionChips[index]
            chipView.isHidden = false
            chipView.frame = chip.frame
            chipView.configure(chip, outgoing: outgoing, freeform: freeform)
            if animated, !previousEmoji.contains(chip.emoji) {
                chipView.animateAppearance()
            }
        }
    }

    private func configureService(_ layout: MessageLayout) {
        bubbleImageView.isHidden = true
        bubbleContent.isHidden = true
        failedButton.isHidden = true
        servicePill.isHidden = false
        servicePill.frame = layout.servicePillFrame
        servicePill.layer.cornerRadius = min(11, layout.servicePillFrame.height / 2)
        servicePill.backgroundColor = Palette.serviceFill
        let text = layout.serviceTextLayout ?? TextLayout.make(layout.serviceText, font: Fonts.service, maxWidth: layout.servicePillFrame.width, detectLinks: false)
        serviceLabel.layout = text
        serviceLabel.textColor = Palette.serviceText
        serviceLabel.frame = CGRect(
            x: (layout.servicePillFrame.width - text.size.width) / 2, y: (layout.servicePillFrame.height - text.size.height) / 2,
            width: text.size.width, height: text.size.height
        )
        accessibilityAnchor.frame = layout.servicePillFrame
        accessibilityAnchor.accessibilityIdentifier = layout.style == .date ? "date.\(layout.serviceText)" : "service"
        accessibilityAnchor.accessibilityLabel = layout.serviceText
        accessibilityAnchor.accessibilityValue = nil
        accessibilityAnchor.accessibilityHint = nil
        accessibilityElements = [accessibilityAnchor]
        updateSelection(context: CellContext(), animated: false)
    }

    private func applyTheme() {
        guard let row, let layout else { return }
        configure(row: row, layout: layout, context: context, animated: false)
    }

    // MARK: Выбор

    func updateSelection(context: CellContext, animated: Bool) {
        self.context.isSelecting = context.isSelecting
        self.context.selectedIds = context.selectedIds
        let selectable = isBubbleRow && context.isSelecting
        if selectable, checkbox.superview == nil { contentView.addSubview(checkbox) }
        let isSelected = !Set(messageIds).isDisjoint(with: context.selectedIds)
        let offset: CGFloat = selectable && !(layout?.isOutgoing ?? true) ? 42 : 0
        let apply = {
            self.swipeContainer.frame.origin.x = offset
            self.checkbox.alpha = selectable ? 1 : 0
        }
        if let layout, checkbox.superview != nil {
            checkbox.frame = CGRect(x: 10, y: layout.bubbleFrame.maxY - 30, width: 28, height: 28)
            checkbox.setSelected(isSelected, animated: animated)
            checkbox.accessibilityIdentifier = "select.\(primaryId ?? 0)"
        }
        if animated { Motion.layout(apply) } else { apply() }
    }

    // MARK: Подсветка (переход к сообщению из ответа/поиска)

    func flashHighlight() {
        guard isBubbleRow else { return }
        highlightOverlay.layer.removeAllAnimations()
        highlightOverlay.alpha = 1
        let duration = Motion.reduceMotion ? 0.01 : 0.6
        UIView.animate(withDuration: duration, delay: 0.9, options: [.curveEaseOut, .allowUserInteraction]) {
            self.highlightOverlay.alpha = 0
        }
    }

    func setPressed(_ pressed: Bool) {
        guard layout?.style == .bubble else { return }
        UIView.animate(withDuration: pressed ? 0.12 : 0.2, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
            self.highlightOverlay.alpha = pressed ? 0.6 : 0
        }
    }

    // MARK: Нажатия

    /// Цель нажатия. `point` — в координатах `contentView` (ось Y вниз).
    func action(at point: CGPoint) -> MessageCellAction? {
        guard let layout, let row, let primary = row.primary, isBubbleRow else { return nil }
        let local = swipeContainer.convert(point, from: contentView)
        if primary.status == .failed, !failedButton.isHidden, failedButton.frame.insetBy(dx: -8, dy: -8).contains(local) {
            return .failedMenu(primary.id)
        }
        let inBubble = bubbleContent.convert(local, from: swipeContainer)
        let hitArea = CGRect(origin: .zero, size: layout.bubbleFrame.size).insetBy(dx: -6, dy: -4)
        guard hitArea.contains(inBubble) else { return nil }

        for chip in chipViews where !chip.isHidden && chip.frame.insetBy(dx: -2, dy: -3).contains(inBubble) {
            return .toggleReaction(primary.id, chip.emoji)
        }
        if let reply = layout.reply, !replyView.isHidden, replyView.frame.contains(inBubble), !reply.isDeleted {
            return .openReply(reply.targetId)
        }
        switch layout.content {
        case .media where mosaicView.frame.contains(inBubble):
            let point = mosaicView.convert(inBubble, from: bubbleContent)
            if let tile = mosaicView.tile(at: point) { return .openMedia(tile.messageId) }
        case .voice where voiceView.frame.contains(inBubble):
            return .toggleVoice(primary.id)
        case .file where fileView.frame.insetBy(dx: -4, dy: -4).contains(inBubble):
            return .openFile(primary.id)
        case .videoNote where videoNoteView.frame.contains(inBubble):
            return .toggleVideoNote(primary.id)
        default:
            break
        }
        if let text = layout.text, !textView.isHidden, textView.frame.contains(inBubble) {
            let textPoint = textView.convert(inBubble, from: bubbleContent)
            if let url = textView.link(at: textPoint) { return .openLink(url) }
            _ = text
        }
        return .bubble(primary.id)
    }

    /// Сообщение под точкой (альбом — конкретная плитка).
    func messageId(at point: CGPoint) -> MessageID? {
        guard let layout, let row else { return nil }
        if layout.content == .media {
            let local = mosaicView.convert(point, from: contentView)
            if let tile = mosaicView.tile(at: local) { return tile.messageId }
        }
        return row.primary?.id
    }

    func bubbleContains(_ point: CGPoint) -> Bool {
        guard let layout, isBubbleRow else { return false }
        let local = swipeContainer.convert(point, from: contentView)
        return layout.bubbleFrame.insetBy(dx: -6, dy: -4).contains(local)
    }

    /// Рамка пузыря в координатах окна (для меню и перехода в просмотрщик).
    func bubbleFrameInWindow() -> CGRect {
        guard let layout else { return .zero }
        let frame = layout.style == .freeform ? layout.bubbleFrame : BubbleImages.imageFrame(for: layout.bubbleFrame, outgoing: layout.isOutgoing)
        return swipeContainer.convert(frame, to: nil)
    }

    func mediaTile(for id: MessageID) -> MediaTileView? {
        guard layout?.content == .media else { return nil }
        return mosaicView.tile(for: id)
    }

    /// Обновить только состояние проигрывания (без перенастройки ячейки).
    func refreshPlayback() {
        if layout?.content == .voice { voiceView.updatePlayback() }
    }

    func willDisplay() {
        if layout?.content == .videoNote, !Motion.reduceMotion { videoNoteView.startMuted() }
    }

    func didEndDisplaying() {
        if layout?.content == .videoNote { videoNoteView.stop() }
    }
}

// MARK: - Галочка выбора

final class SelectionCheckView: UIView {
    private let circle = CAShapeLayer()
    private let fill = CAShapeLayer()
    private let check = CAShapeLayer()
    private(set) var isSelected = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        layer.addSublayer(circle)
        layer.addSublayer(fill)
        layer.addSublayer(check)
        circle.fillColor = UIColor.black.withAlphaComponent(0.1).cgColor
        circle.lineWidth = 1.5
        check.fillColor = nil
        check.strokeColor = UIColor.white.cgColor
        check.lineWidth = 2
        check.lineCap = .round
        check.lineJoin = .round
        isAccessibilityElement = true
        accessibilityTraits = .button
        isUserInteractionEnabled = false
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        let rect = bounds.insetBy(dx: 2, dy: 2)
        circle.path = UIBezierPath(ovalIn: rect).cgPath
        fill.path = circle.path
        let path = UIBezierPath()
        path.move(to: CGPoint(x: rect.minX + rect.width * 0.28, y: rect.midY))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.44, y: rect.minY + rect.height * 0.66))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.74, y: rect.minY + rect.height * 0.34))
        check.path = path.cgPath
        circle.strokeColor = UIColor.white.cgColor
        fill.fillColor = Palette.accent.resolvedColor(with: traitCollection).cgColor
    }

    func setSelected(_ selected: Bool, animated: Bool) {
        let changed = selected != isSelected
        isSelected = selected
        accessibilityValue = selected ? "выбрано" : "не выбрано"
        CATransaction.begin()
        CATransaction.setDisableActions(!animated || !changed)
        fill.opacity = selected ? 1 : 0
        check.strokeEnd = selected ? 1 : 0
        CATransaction.commit()
        if animated, changed, selected, !Motion.reduceMotion {
            let pop = CAKeyframeAnimation(keyPath: "transform.scale")
            pop.values = [0.8, 1.1, 1]
            pop.duration = 0.25
            layer.add(pop, forKey: "pop")
        }
    }
}

// MARK: - Значок ответа свайпом

final class SwipeReplyIconView: UIView {
    private let background = UIView()
    private let icon = UIImageView(image: UIImage(systemName: "arrowshape.turn.up.left.fill"))

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        background.backgroundColor = Palette.serviceFill
        addSubview(background)
        icon.tintColor = .white
        icon.contentMode = .scaleAspectFit
        addSubview(icon)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        background.frame = bounds
        background.layer.cornerRadius = bounds.width / 2
        icon.frame = bounds.insetBy(dx: 7, dy: 7)
    }
}
