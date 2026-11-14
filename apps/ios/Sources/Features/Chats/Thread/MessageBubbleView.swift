import SwiftUI
import UIKit

/// Что знает о чате каждая ячейка ленты. Отдельным значением, чтобы смена (собеседник
/// дочитал, пришло имя группы) перерисовывала ровно те ячейки, которых касается.
struct BubbleContext: Hashable {
    var isGroup = false
    /// До какого времени дочитал переписку собеседник личного чата, а в группе — тот
    /// из участников, кто продвинулся дальше всех.
    var othersReadAt: Date?
    /// Группа: до какого момента дочитал каждый из других участников, по возрастанию.
    /// По ним — число прочитавших у своего сообщения.
    var readMarks: [Date] = []
    var viewerID = ""
    /// Поиск в переписке: найденное подсвечивается в тексте пузырей.
    var highlight: String?

    /// Сколько других участников группы дочитали до этого момента.
    func readCount(at date: Date) -> Int {
        // Первая отметка не раньше `date` — бинарным поиском: ячеек тысячи, а
        // участников в группе сотни.
        var low = 0
        var high = readMarks.count
        while low < high {
            let mid = (low + high) / 2
            if readMarks[mid] < date { low = mid + 1 } else { high = mid }
        }
        return readMarks.count - low
    }
}

/// Что можно сделать с конкретным сообщением — решает модель экрана.
struct MessageCapabilities: Hashable {
    var canEdit = false
    var canDelete = false
    var canReport = false
    var myReaction: String?
}

/// Действие из пузыря или его меню.
enum MessageAction {
    case reply, edit, delete, pin, copy, forward, report, retry
    /// Скопировать кусок сообщения (блок кода) — с подтверждением, как «Скопировать».
    case copyText(String)
    /// Кто прочитал своё сообщение в группе.
    case readers
    /// Крестик на загружаемом вложении: отменить отправку.
    case cancelUpload
    /// Крестик на плитке загружаемого альбома: убрать из отправки только этот файл.
    case cancelUploadFile(AttachmentRecord)
    /// Войти в режим выбора с этим сообщением и переключить его отметку в режиме.
    case select, toggleSelection
    case react(String)
    /// Долгое нажатие: меню с реакциями поверх размытой переписки.
    case menu
    case jump(String)
    case openPost(String)
    case openAttachment(AttachmentRecord)
}

/// Пузырь сообщения в духе Telegram.
///
/// Своё справа и фирменным синим, чужое слева на светлой (в тёмной теме — серой)
/// подложке. Хвостик — только у последнего сообщения подряд идущей группы, углы между
/// сообщениями группы со стороны автора — малые. Время, «изм.» и галочки — внутри
/// пузыря в правом нижнем углу: если в последней строке текста хватает места, они
/// встают в неё, иначе уходят на свою строку. В группе у чужих — имя автора у первого
/// сообщения и аватар у последнего.
struct MessageBubbleView: View {
    let item: MessageTimeline.Item
    var context = BubbleContext()
    var capabilities = MessageCapabilities()
    /// Режим выбора нескольких: слева кружок-отметка, касание переключает её.
    var selecting = false
    var isSelected = false
    /// Копия пузыря в меню по долгому нажатию: без жестов и без якорей положения.
    var isMenuPreview = false
    var onAction: (MessageAction) -> Void = { _ in }

    @State private var reactionTick = 0
    @Environment(\.colorScheme) private var scheme
    @Environment(\.motionReduced) private var reduceMotion
    @ScaledMetric(relativeTo: .body) private var avatarSize: CGFloat = 32

    private var message: MessageRecord { item.message }
    private var extras: MessageExtras { message.extras ?? MessageExtras() }
    private var isDeleted: Bool { message.deletedAt != nil }
    private var showsAvatarColumn: Bool { context.isGroup && !item.isOwn }

    /// Сдвиг чужого пузыря в режиме выбора: ширина кружка и зазор до пузыря.
    @ScaledMetric(relativeTo: .body) private var selectionMarkSize: CGFloat = 24
    private var selectionInset: CGFloat { min(selectionMarkSize, 32) + Spacing.md }

    var body: some View {
        if message.systemType != nil {
            SystemMessageView(text: SystemMessageText.text(for: message))
        } else {
            // Кружок выбора — поверх ряда, а чужой пузырь отъезжает смещением. Вставка
            // кружка в HStack сужала ряд: переносы текста менялись мгновенно, а рамка
            // ехала анимацией, и на кадр текст вылезал за пузырь. Смещение раскладку не
            // трогает. Свой пузырь не двигается — кружку хватает левого отступа.
            row
                .offset(x: selecting && !item.isOwn ? selectionInset : 0)
                .overlay(alignment: .leading) {
                    if selecting {
                        SelectionMark(isSelected: isSelected)
                            .transition(.move(edge: .leading).combined(with: .opacity))
                    }
                }
            // В режиме выбора пузырь целиком — одна большая кнопка: вложения, цитата
            // и меню под ней не срабатывают, касание только переключает отметку.
            .overlay {
                if selecting {
                    Button {
                        onAction(.toggleSelection)
                    } label: {
                        Color.clear.contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(accessibilitySummary))
                    .accessibilityValue(Text(isSelected
                        ? String(localized: "chats.selection.selected", defaultValue: "Выбрано")
                        : String(localized: "chats.selection.notSelected", defaultValue: "Не выбрано")))
                    .accessibilityAddTraits(isSelected ? .isSelected : [])
                }
            }
            .animation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion), value: selecting)
        }
    }

    private var row: some View {
        HStack(alignment: .bottom, spacing: Spacing.xs) {
            if item.isOwn { Spacer(minLength: Spacing.xxl * 2) }
            if showsAvatarColumn {
                Group {
                    if item.isLastInGroup {
                        AvatarView(url: message.senderAvatar, name: message.senderName, size: min(avatarSize, 44))
                    } else {
                        Color.clear
                    }
                }
                .frame(width: min(avatarSize, 44), height: min(avatarSize, 44))
                .accessibilityHidden(true)
            }
            Group {
                if let sticker = extras.sticker, !isDeleted {
                    stickerBubble(sticker)
                } else {
                    bubble
                }
            }
                .bubbleAnchor(message.id, part: .bubble, enabled: !isMenuPreview)
                // Долгое нажатие и двойной тап-реакцию ловит лента (UIKit), а не пузырь:
                // то же касание ведёт открывшееся меню к пункту, не отрывая пальца
                // (`MessageMenuTouch`), а двойной тап не ждёт второго касания у кнопок
                // внутри пузыря и не срабатывает на них (`bubbleControl`).
                .sensoryFeedback(.impact(weight: .light), trigger: reactionTick)
                .accessibilityAction(named: Text(String(localized: "chats.menu.actions", defaultValue: "Действия"))) {
                    onAction(.menu)
                }
            if !item.isOwn { Spacer(minLength: Spacing.xxl * 2) }
        }
        .bubbleAnchor(message.id, part: .row, enabled: !isMenuPreview)
        .accessibilityIdentifier("message.bubble.\(message.remoteId ?? message.id)")
        .accessibilityHidden(selecting)
    }

    /// Что прочитает VoiceOver у пузыря в режиме выбора: сам пузырь скрыт под кнопкой.
    private var accessibilitySummary: String {
        let body: String
        if isDeleted {
            body = deletedText
        } else if isUnsupportedKind {
            body = unsupportedText
        } else if !message.content.isEmpty {
            body = message.content
        } else if let poll = extras.poll {
            body = poll.question
        } else {
            body = String(localized: "chats.attachmentPreview", defaultValue: "Вложение")
        }
        guard !item.isOwn, let name = message.senderName, !name.isEmpty else { return body }
        return "\(name): \(body)"
    }

    // MARK: Пузырь

    private var shape: ChatBubbleShape {
        ChatBubbleShape(
            isOwn: item.isOwn,
            hasTail: item.isLastInGroup,
            joinsAbove: !item.isFirstInGroup,
            joinsBelow: !item.isLastInGroup
        )
    }

    private var bubble: some View {
        ChatBubbleStack(spacing: ChatBubbleMetrics.partSpacing) {
            if context.isGroup, !item.isOwn, item.isFirstInGroup, let name = message.senderName, !name.isEmpty {
                Text(name)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(SenderColor.color(for: message.senderId))
                    .lineLimit(1)
            }

            if extras.isForwarded, !isDeleted {
                Label {
                    Text(extras.forwardedFromName.map {
                        String(localized: "chats.forwardedFrom", defaultValue: "Переслано от \($0)")
                    } ?? String(localized: "chats.forwarded", defaultValue: "Пересланное сообщение"))
                } icon: {
                    Image(systemName: "arrowshape.turn.up.right.fill")
                }
                .font(.footnote.weight(.medium))
                .foregroundStyle(item.isOwn ? Palette.primaryForeground : Palette.primary)
                .lineLimit(1)
            }

            if let replyID = message.replyToId, !isDeleted {
                Button {
                    onAction(.jump(replyID))
                } label: {
                    ReplyQuoteView(
                        author: extras.replySenderName,
                        text: message.replyQuote ?? extras.replyContent,
                        isOwn: item.isOwn
                    )
                }
                .buttonStyle(.plain)
                .bubbleControl(enabled: !isMenuPreview)
                .layoutValue(key: ChatStretches.self, value: true)
            }

            if !isDeleted {
                // Снимки и ролики — альбомом-мозаикой, если их несколько; голосовые,
                // аудио и файлы — строками под ним, как в вебе (`MessageAttachments`).
                // Снимок без подписи повторяет углы пузыря; своя неудачная отправка — круг
                // «повторить» прямо на снимке, как в Telegram.
                if mediaAttachments.count > 1 {
                    ChatMediaMosaic(items: mediaAttachments, upload: mediaUpload, tileUpload: tileUpload) { attachment in
                        onAction(.openAttachment(attachment))
                    }
                    .bubbleControl(enabled: !isMenuPreview)
                    .environment(\.chatMediaCorners, isMediaOnly ? mediaCorners : nil)
                } else if let single = mediaAttachments.first {
                    AttachmentView(attachment: single, isOwn: item.isOwn, upload: mediaUpload) {
                        onAction(.openAttachment(single))
                    }
                    .bubbleControl(enabled: !isMenuPreview)
                    .environment(\.chatMediaCorners, isMediaOnly ? mediaCorners : nil)
                }
                ForEach(otherAttachments, id: \.id) { attachment in
                    AttachmentView(attachment: attachment, isOwn: item.isOwn, upload: upload) {
                        onAction(.openAttachment(attachment))
                    }
                    .bubbleControl(enabled: !isMenuPreview)
                }
                if let share = profileShare {
                    ProfileShareCard(share: share, isOwn: item.isOwn)
                        .bubbleControl(enabled: !isMenuPreview)
                        .id(share.userID)
                }
                if let post = extras.sharedPost {
                    SharedPostCard(post: post, isOwn: item.isOwn) { onAction(.openPost(post.id)) }
                        .bubbleControl(enabled: !isMenuPreview)
                        .layoutValue(key: ChatStretches.self, value: true)
                }
                if let story = extras.sharedStory {
                    SharedStoryCard(story: story, isOwn: item.isOwn)
                        .bubbleControl(enabled: !isMenuPreview)
                        .layoutValue(key: ChatStretches.self, value: true)
                }
                if let poll = extras.poll {
                    ChatPollView(poll: poll, isOwn: item.isOwn)
                        // Состояние пузыря (выбор, результаты) — своё у каждого опроса.
                        .id(poll.id)
                        .bubbleControl(enabled: !isMenuPreview)
                }
                if let location = extras.location {
                    LocationMessageView(location: location, isOwn: item.isOwn, messageID: message.remoteId)
                        .bubbleControl(enabled: !isMenuPreview)
                }
                if let contact = extras.contact {
                    ContactMessageView(contact: contact, isOwn: item.isOwn)
                        .bubbleControl(enabled: !isMenuPreview)
                }
                if let checklist = extras.checklist {
                    ChecklistMessageView(
                        checklist: checklist, isOwn: item.isOwn, isAuthor: item.isOwn, viewerID: context.viewerID
                    )
                    .bubbleControl(enabled: !isMenuPreview)
                }
            }

            if hasText {
                textBlock
            }

            // У карточки профиля превью той же ссылки было бы повтором.
            if let preview = extras.linkPreview, !isDeleted, profileShare == nil {
                LinkPreviewCard(preview: preview, isOwn: item.isOwn)
                    .bubbleControl(enabled: !isMenuPreview)
                    .layoutValue(key: ChatStretches.self, value: true)
            }

            // Место под время: строкой реакций или отдельной строкой, если текста
            // нет или он не последний в пузыре.
            if showsReactions {
                HStack(alignment: .bottom, spacing: Spacing.md) {
                    reactions
                        .bubbleControl(enabled: !isMenuPreview)
                    meta(metaColor).hidden()
                }
                // Первая реакция всплывает пружинкой из угла, как в Telegram.
                .transition(
                    reduceMotion
                        ? AnyTransition.opacity
                        : AnyTransition.scale(scale: 0.5, anchor: item.isOwn ? .bottomTrailing : .bottomLeading)
                            .combined(with: .opacity)
                )
            } else if !textCarriesMeta, !isMediaOnly {
                meta(metaColor).hidden()
            }
        }
        // Реакции приходят из модели, а не из касания в `withAnimation`: своя пружина на
        // их смену — появление, исчезновение, смена числа.
        .animation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion), value: extras.reactions)
        .overlay(alignment: .bottomTrailing) {
            if isMediaOnly {
                meta(Palette.primaryForeground)
                    .padding(.horizontal, Spacing.sm)
                    .padding(.vertical, 2)
                    .background(Palette.overlay.opacity(0.45), in: Capsule())
                    .padding(Spacing.sm)
            } else {
                meta(metaColor)
            }
        }
        .padding(.leading, padding(leading: true))
        .padding(.trailing, padding(leading: false))
        .padding(.vertical, isMediaOnly ? ChatBubbleMetrics.mediaOnlyVerticalPadding : ChatBubbleMetrics.verticalPadding)
        .background {
            if PerformanceFlags.chatBubbleFlatShadow {
                // Та же тень без размытия: подложка со сдвигом вниз под заливкой пузыря.
                shape
                    .fill(Palette.overlay.opacity(item.isOwn || scheme == .dark ? 0 : 0.10))
                    .offset(y: 0.6)
                    .overlay { shape.fill(background) }
            } else {
                shape
                    .fill(background)
                    .shadow(
                        color: Palette.overlay.opacity(item.isOwn || scheme == .dark ? 0 : 0.10),
                        radius: 0.6,
                        x: 0,
                        y: 0.6
                    )
            }
        }
        .contentShape(shape)
        .overlay(alignment: item.isOwn ? .bottomLeading : .bottomTrailing) {
            if message.sendState == .failed {
                Button {
                    onAction(.retry)
                } label: {
                    Image(systemName: "exclamationmark.circle.fill")
                        .font(.title3)
                        .foregroundStyle(Palette.destructive)
                }
                .buttonStyle(.plain)
                .bubbleControl(enabled: !isMenuPreview)
                .offset(x: item.isOwn ? -(Spacing.xxl + Spacing.xs) : Spacing.xxl + Spacing.xs)
                .accessibilityLabel(Text(String(localized: "chats.retrySend", defaultValue: "Отправить ещё раз")))
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// Стикер — без пузыря: над ним ответ, под ним реакции, время — в капсуле на углу.
    private func stickerBubble(_ sticker: MessageExtras.Sticker) -> some View {
        VStack(alignment: item.isOwn ? .trailing : .leading, spacing: Spacing.xs) {
            if let replyID = message.replyToId {
                Button {
                    onAction(.jump(replyID))
                } label: {
                    ReplyQuoteView(
                        author: extras.replySenderName,
                        text: message.replyQuote ?? extras.replyContent,
                        isOwn: false
                    )
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, Spacing.xs)
                    .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
                }
                .buttonStyle(.plain)
                .bubbleControl(enabled: !isMenuPreview)
            }
            StickerMessageView(sticker: sticker)
                .overlay(alignment: .bottomTrailing) {
                    meta(Palette.primaryForeground)
                        .padding(.horizontal, Spacing.sm)
                        .padding(.vertical, 2)
                        .background(Palette.overlay.opacity(0.45), in: Capsule())
                }
            if showsReactions {
                reactions
                    .padding(Spacing.xs)
                    .background(item.isOwn ? Palette.primary : Palette.card, in: Capsule())
                    .bubbleControl(enabled: !isMenuPreview)
            }
        }
        .contentShape(Rectangle())
    }

    /// Своё сообщение с файлами в пути: доля отправленного — из общего реестра загрузок.
    private var upload: AttachmentUploadState? {
        guard item.isOwn, message.remoteId == nil, message.sendState == .pending, !item.attachments.isEmpty else {
            return nil
        }
        return AttachmentUploadState(fraction: AttachmentUploads.shared.progress[message.id] ?? 0) {
            onAction(.cancelUpload)
        }
    }

    /// Кольцо и крестик на каждой плитке своего альбома в пути, как в Telegram: у
    /// каждого файла своя доля, крестик убирает из отправки только его.
    private var tileUpload: ((AttachmentRecord) -> AttachmentUploadState)? {
        guard upload != nil else { return nil }
        let progress = AttachmentUploads.shared.fileProgress
        return { attachment in
            AttachmentUploadState(fraction: progress[attachment.id] ?? 0) {
                onAction(.cancelUploadFile(attachment))
            }
        }
    }

    /// Состояние отправки для снимков: к кольцу загрузки добавляется неудача — круг
    /// «повторить» на самом снимке. Строкам файлов и аудио — только кольцо (`upload`).
    private var mediaUpload: AttachmentUploadState? {
        if let upload { return upload }
        guard item.isOwn, message.remoteId == nil, message.sendState == .failed, !item.attachments.isEmpty else {
            return nil
        }
        return AttachmentUploadState(
            fraction: 0,
            cancel: { onAction(.cancelUpload) },
            retry: { onAction(.retry) }
        )
    }

    /// Углы снимка без подписи: форма пузыря, сжатая на его внутренний отступ (3 pt).
    /// Со стороны автора нижний угол — у хвостика или стыка с соседним сообщением —
    /// малый, верхний малый, если сверху сообщение той же группы.
    private var mediaCorners: RectangleCornerRadii {
        let inset: CGFloat = 3
        let large = ChatBubbleShape.radius - inset
        let small = max(ChatBubbleShape.joinedRadius - inset, 2)
        let authorTop = item.isFirstInGroup ? large : small
        return item.isOwn
            ? RectangleCornerRadii(topLeading: large, bottomLeading: large, bottomTrailing: small, topTrailing: authorTop)
            : RectangleCornerRadii(topLeading: authorTop, bottomLeading: small, bottomTrailing: large, topTrailing: large)
    }

    /// Отступ содержимого: со стороны хвостика — плюс его ширина. Хвостик рисуется
    /// внутри рамки пузыря у всех сообщений группы, поэтому края пузырей совпадают.
    private func padding(leading: Bool) -> CGFloat {
        let base: CGFloat = isMediaOnly ? 3 : Spacing.lg
        let tailSide = leading ? !item.isOwn : item.isOwn
        return base + (tailSide ? ChatBubbleShape.tailWidth : 0)
    }

    // MARK: Текст и время

    /// Текстовая строка есть, если есть текст, сообщение удалено или в нём вообще
    /// ничего другого нет. Подпись к вложению может быть пустой — тогда и строки нет.
    /// Профиль, которым поделились, — карточкой вместо текста со ссылкой.
    private var hasText: Bool {
        if isDeleted { return true }
        if profileShare != nil { return false }
        return !message.content.isEmpty
            || (item.attachments.isEmpty && extras.poll == nil && extras.sharedPost == nil && extras.sharedStory == nil
                && !hasSpecialContent)
    }

    /// «Имя\nссылка на профиль» — так уходит «Поделиться профилем»; рисуем карточкой.
    private var profileShare: ProfileShare? {
        guard !isDeleted, item.attachments.isEmpty else { return nil }
        return ProfileShare.parse(message.content)
    }

    /// Снимки и ролики — плитками (одиночной или альбомом), остальное — строками.
    private var mediaAttachments: [AttachmentRecord] {
        item.attachments.filter(\.showsAsMedia)
    }

    private var otherAttachments: [AttachmentRecord] {
        item.attachments.filter { !$0.showsAsMedia }
    }

    private var showsReactions: Bool { !extras.reactions.isEmpty && !isDeleted }

    /// Ни текста, ни файлов, ни известного содержимого — вид из будущей версии. Вместо пустого
    /// пузыря — заглушка «обновите приложение», как в превью списка (IOS_RULES 9.2.8).
    private var isUnsupportedKind: Bool {
        !isDeleted && message.content.isEmpty && item.attachments.isEmpty && !extras.hasKnownContent
    }

    /// Геопозиция, контакт, список или стикер — сообщение без текста, но не пустое.
    private var hasSpecialContent: Bool {
        extras.location != nil || extras.contact != nil || extras.checklist != nil || extras.sticker != nil
    }

    /// Время встаёт в последнюю строку текста, если текст — последний в пузыре. Текст,
    /// который кончается блоком кода или цитатой, времени не несёт: оно уходит на свою
    /// строку.
    private var textCarriesMeta: Bool {
        guard hasText, !showsReactions, extras.linkPreview == nil || isDeleted else { return false }
        if isDeleted { return true }
        guard let last = codeSegments?.last else { return textBlocks?.last?.isQuote != true }
        guard case .text(let text) = last else { return false }
        return MessageTextBlocks.carriesMeta(text)
    }

    /// Цитаты и списки без блоков кода — по блокам; `nil` — обычный текст одной строкой
    /// `Text`, как раньше (предфильтр — проход по началам строк, разбор кешируется).
    private var textBlocks: [MessageTextBlocks.Block]? {
        isDeleted || isUnsupportedKind ? nil : MessageTextBlocks.blocks(ifAny: message.content)
    }

    /// Текст с блоками кода ```` ``` ```` — по сегментам; `nil` — обычный текст (разбор
    /// не трогается, проверка — одна `contains`, сам разбор кешируется).
    private var codeSegments: [MessageCodeBlocks.Segment]? {
        isDeleted ? nil : MessageCodeBlocks.segments(ifAny: message.content)
    }

    /// Только фото без подписи — время поверх снимка, в тёмной капсуле.
    private var isMediaOnly: Bool {
        !isDeleted && !hasText && !showsReactions && !item.attachments.isEmpty
            && item.attachments.allSatisfy(\.showsAsMedia)
            && extras.poll == nil && extras.sharedPost == nil && extras.sharedStory == nil && !hasSpecialContent
            && extras.linkPreview == nil && message.replyToId == nil && !extras.isForwarded
            && !(context.isGroup && !item.isOwn && item.isFirstInGroup)
    }

    @ViewBuilder
    private var textBlock: some View {
        if let segments = codeSegments {
            MessageCodeText(
                segments: segments,
                isOwn: item.isOwn,
                textColor: textColor,
                tint: item.isOwn ? Palette.primaryForeground : Palette.primary,
                highlight: context.highlight,
                metaPlaceholder: textCarriesMeta ? metaPlaceholder : nil,
                onCopy: { onAction(.copyText($0)) }
            )
        } else if let blocks = textBlocks {
            MessageTextBlocksView(
                blocks: blocks,
                style: BubbleTextStyle(isOwn: item.isOwn, highlight: context.highlight),
                textColor: textColor,
                tint: item.isOwn ? Palette.primaryForeground : Palette.primary,
                metaPlaceholder: textCarriesMeta ? metaPlaceholder : nil
            )
        } else {
            plainTextBlock
        }
    }

    private var plainTextBlock: some View {
        let placeholder = isDeleted ? deletedText : isUnsupportedKind ? unsupportedText : nil
        let body = Text(placeholder.map { AttributedString($0) } ?? highlightedContent)
            .font(Typography.body)
        let line = textCarriesMeta ? body + metaPlaceholder : body
        return line
            .foregroundStyle(textColor)
            .tint(item.isOwn ? Palette.primaryForeground : Palette.primary)
            .italic(placeholder != nil)
            .fixedSize(horizontal: false, vertical: true)
            // Невидимую копию времени VoiceOver прочитал бы второй раз.
            .accessibilityLabel(Text(placeholder ?? message.content))
    }

    /// Текст с разметкой и — в режиме поиска — с подсвеченными совпадениями.
    private var highlightedContent: AttributedString {
        var text = RichText.attributed(message.content)
        if let term = context.highlight {
            SearchHighlight.apply(term, to: &text, background: item.isOwn ? SearchHighlight.outgoing : SearchHighlight.incoming)
        }
        return text
    }

    private var time: String {
        item.time.isEmpty ? message.createdAt.formatted(date: .omitted, time: .shortened) : item.time
    }

    /// Время, «изм.», булавка и галочки.
    private func meta(_ color: Color) -> some View {
        HStack(spacing: 3) {
            if message.pinnedAt != nil, !isDeleted {
                Image(systemName: "pin.fill")
                    .accessibilityLabel(Text(String(localized: "chats.pinnedMessage", defaultValue: "Закреплено")))
            }
            if message.editedAt != nil, !isDeleted {
                Text(String(localized: "chats.edited", defaultValue: "изм."))
            }
            Text(verbatim: time)
            if item.isOwn {
                stateMark
            }
        }
        .font(Typography.tabular(.caption2))
        .foregroundStyle(color)
        .fixedSize()
    }

    /// Невидимая копия подписи времени в конце текста: она держит место, куда сверху
    /// ложится настоящая. Так время встаёт в последнюю строку, если там есть место.
    private var metaPlaceholder: Text {
        var text = Text(verbatim: "\u{2002}")
        if message.pinnedAt != nil, !isDeleted {
            text = text + Text(Image(systemName: "pin.fill")) + Text(verbatim: " ")
        }
        if message.editedAt != nil, !isDeleted {
            text = text + Text(String(localized: "chats.edited", defaultValue: "изм.")) + Text(verbatim: " ")
        }
        text = text + Text(verbatim: time)
        if item.isOwn {
            text = text + Text(verbatim: " ") + stateMarkPlaceholder
        }
        return text
            .font(Typography.tabular(.caption2))
            .foregroundStyle(Color.clear)
    }

    /// Копия `stateMark` для места под время: тот же знак, что нарисуется сверху. Две
    /// галочки там, где видна одна, оставляли зазор, а часы и «!» уже галочек.
    private var stateMarkPlaceholder: Text {
        switch message.sendState {
        case .sent:
            // Вторая галочка у видимой метки сдвинута на полширины, копия берёт её
            // целиком: резерв чуть шире, но время на текст не наедет.
            var checks = Text(Image(systemName: "checkmark"))
            if isRead { checks = checks + Text(Image(systemName: "checkmark")) }
            checks = checks.font(.caption2.weight(.bold))
            return readCount > 0 ? checks + Text(verbatim: " \(readCount.formatted())") : checks
        case .pending:
            return Text(Image(systemName: "clock"))
        case .failed:
            return Text(Image(systemName: "exclamationmark.circle.fill"))
        }
    }

    // MARK: Реакции

    /// Реакции внутри пузыря, над временем, как в Telegram. Своя — залитая капсула.
    private var reactions: some View {
        ChatFlowLayout(spacing: Spacing.xs) {
            ForEach(extras.reactions, id: \.emoji) { group in
                let mine = group.userIds.contains(context.viewerID)
                let count = group.userIds.count
                Button {
                    reactionTick += 1
                    onAction(.react(group.emoji))
                } label: {
                    HStack(spacing: 3) {
                        Text(verbatim: group.emoji)
                        if count > 1 {
                            Text(verbatim: count.formatted())
                                .font(Typography.tabular(.footnote).weight(.semibold))
                                .contentTransition(.numericText(value: Double(count)))
                        }
                    }
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, ChatBubbleMetrics.reactionVerticalPadding)
                    .foregroundStyle(reactionForeground(mine: mine))
                    .background(reactionBackground(mine: mine), in: Capsule())
                    // Своя реакция поставлена или снята — капсула коротко «вздыхает».
                    .keyframeAnimator(initialValue: CGFloat(1), trigger: reduceMotion ? false : mine) { content, scale in
                        content.scaleEffect(scale)
                    } keyframes: { _ in
                        SpringKeyframe(1.18, duration: 0.14, spring: .snappy)
                        SpringKeyframe(1.0, duration: 0.3, spring: .bouncy)
                    }
                }
                .buttonStyle(.plain)
                .transition(
                    reduceMotion
                        ? AnyTransition.opacity
                        : AnyTransition.scale(scale: 0.3).combined(with: .opacity)
                )
                .accessibilityLabel(Text(verbatim: group.emoji))
                .accessibilityValue(Text(verbatim: group.userIds.count.formatted()))
                .accessibilityAddTraits(mine ? .isSelected : [])
            }
        }
        .font(.subheadline)
    }

    private func reactionBackground(mine: Bool) -> Color {
        if item.isOwn {
            return mine ? Palette.primaryForeground : Palette.primaryForeground.opacity(0.22)
        }
        return mine ? Palette.primary : Palette.primary.opacity(0.12)
    }

    private func reactionForeground(mine: Bool) -> Color {
        if item.isOwn {
            return mine ? Palette.primary : Palette.primaryForeground
        }
        return mine ? Palette.primaryForeground : Palette.primary
    }

    // MARK: Оформление

    private var deletedText: String {
        String(localized: "chats.deletedMessage", defaultValue: "Сообщение удалено")
    }

    private var unsupportedText: String {
        String(localized: "chats.preview.unsupported", defaultValue: "Сообщение не поддерживается этой версией — обновите приложение")
    }

    /// Сколько участников группы прочитали своё сообщение; в личном чате — 0.
    private var readCount: Int {
        guard context.isGroup, item.isOwn, message.sendState == .sent else { return 0 }
        return context.readCount(at: message.createdAt)
    }

    /// Две галочки — дочитал собеседник, а в группе — хоть кто-то из участников, как в
    /// вебе и Telegram.
    private var isRead: Bool {
        (context.othersReadAt.map { $0 >= message.createdAt } ?? false) || readCount > 0
    }

    /// Состояние своей отправки: часы, одна галочка — доставлено, две — прочитано, в
    /// группе рядом — число прочитавших.
    @ViewBuilder
    private var stateMark: some View {
        switch message.sendState {
        case .sent:
            ChatReadChecks(isRead: isRead, readCount: readCount)
        case .pending:
            Image(systemName: "clock")
                .accessibilityLabel(Text(String(localized: "chats.sending", defaultValue: "Отправляется")))
        case .failed:
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(item.isOwn ? Palette.primaryForeground : Palette.destructive)
                .accessibilityLabel(Text(String(localized: "chats.sendFailed", defaultValue: "Не отправлено")))
        }
    }

    private var background: Color {
        item.isOwn ? Palette.primary : Palette.card
    }

    private var textColor: Color {
        if isDeleted { return metaColor }
        return item.isOwn ? Palette.primaryForeground : Palette.foreground
    }

    private var metaColor: Color {
        item.isOwn ? Palette.primaryForeground.opacity(0.75) : Palette.mutedForeground
    }
}

/// Форма пузыря как в Telegram: крупное скругление, у последнего сообщения группы —
/// хвостик со стороны автора, между сообщениями группы со стороны автора — малые углы.
///
/// Хвостик занимает полосу `tailWidth` внутри рамки у всех пузырей (с хвостом или без),
/// поэтому их края в группе стоят ровно. Путь строится для своего сообщения (хвост
/// справа) и зеркалится для чужого.
struct ChatBubbleShape: Shape {
    let isOwn: Bool
    let hasTail: Bool
    var joinsAbove = false
    var joinsBelow = false

    static let tailWidth: CGFloat = 6
    static let radius: CGFloat = 18
    static let joinedRadius: CGFloat = 6

    func path(in rect: CGRect) -> Path {
        let width = rect.width
        let height = rect.height
        let body = width - Self.tailWidth
        let radius = max(0, min(Self.radius, height / 2, body / 2))
        let small = min(Self.joinedRadius, radius)
        let top = joinsAbove ? small : radius
        let bottom = joinsBelow ? small : radius

        var path = Path()
        path.move(to: CGPoint(x: radius, y: 0))
        path.addLine(to: CGPoint(x: body - top, y: 0))
        path.addArc(
            center: CGPoint(x: body - top, y: top),
            radius: top,
            startAngle: .degrees(-90),
            endAngle: .degrees(0),
            clockwise: false
        )
        if hasTail {
            // Бок уходит вниз и загибается в острый кончик за краем тела, обратно —
            // через небольшую выемку, как у хвостика в Telegram.
            path.addLine(to: CGPoint(x: body, y: max(top, height - 14)))
            path.addCurve(
                to: CGPoint(x: width, y: height),
                control1: CGPoint(x: body, y: height - 4),
                control2: CGPoint(x: width - 1.5, y: height - 0.5)
            )
            path.addCurve(
                to: CGPoint(x: body - 8, y: height - 2.5),
                control1: CGPoint(x: width - 4.5, y: height),
                control2: CGPoint(x: body - 4.5, y: height - 0.8)
            )
            path.addQuadCurve(
                to: CGPoint(x: max(radius, body - 16), y: height),
                control: CGPoint(x: body - 11, y: height)
            )
        } else {
            path.addLine(to: CGPoint(x: body, y: height - bottom))
            path.addArc(
                center: CGPoint(x: body - bottom, y: height - bottom),
                radius: bottom,
                startAngle: .degrees(0),
                endAngle: .degrees(90),
                clockwise: false
            )
        }
        path.addLine(to: CGPoint(x: radius, y: height))
        path.addArc(
            center: CGPoint(x: radius, y: height - radius),
            radius: radius,
            startAngle: .degrees(90),
            endAngle: .degrees(180),
            clockwise: false
        )
        path.addLine(to: CGPoint(x: 0, y: radius))
        path.addArc(
            center: CGPoint(x: radius, y: radius),
            radius: radius,
            startAngle: .degrees(180),
            endAngle: .degrees(270),
            clockwise: false
        )
        path.closeSubpath()

        let transform = isOwn
            ? CGAffineTransform(translationX: rect.minX, y: rect.minY)
            : CGAffineTransform(a: -1, b: 0, c: 0, d: 1, tx: rect.maxX, ty: rect.minY)
        return path.applying(transform)
    }
}

/// Устойчивый цвет имени автора в группе: один человек — один цвет во всех чатах.
enum SenderColor {
    private static let palette: [Color] = [
        Palette.primary, Palette.chart3, Palette.chart4, Palette.chart5, Palette.info, Palette.success,
    ]

    static func color(for id: String) -> Color {
        let hash = id.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0x7FFF_FFFF }
        return palette[hash % palette.count]
    }
}

/// Цитата над текстом, как в Telegram: тонированная плашка с полоской слева, автор
/// и фрагмент.
private struct ReplyQuoteView: View {
    let author: String?
    let text: String?
    let isOwn: Bool

    var body: some View {
        HStack(spacing: Spacing.md) {
            Capsule()
                .fill(isOwn ? Palette.primaryForeground : Palette.primary)
                .frame(width: 3)
            VStack(alignment: .leading, spacing: 0) {
                if let author, !author.isEmpty {
                    Text(author)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(isOwn ? Palette.primaryForeground : Palette.primary)
                        .lineLimit(1)
                }
                Text(text?.isEmpty == false
                    ? text!
                    : String(localized: "chats.deletedMessage", defaultValue: "Сообщение удалено"))
                    .font(.footnote)
                    .lineLimit(2)
                    .foregroundStyle(isOwn ? Palette.primaryForeground.opacity(0.9) : Palette.foreground)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, ChatBubbleMetrics.replyVerticalPadding)
        .padding(.trailing, Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            (isOwn ? Palette.primaryForeground.opacity(0.18) : Palette.primary.opacity(0.1)),
            in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
        )
        .clipShape(RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityHint(Text(String(localized: "chats.reply.jump", defaultValue: "Перейти к сообщению")))
    }
}

/// Превью ссылки под текстом. Подпись — хост из самого адреса, а не `siteName`: его
/// пишет чужой сайт и может назваться кем угодно («StudentHub», банк). Переход — через
/// `ExternalLinkOpener`, с подтверждением для чужих адресов.
private struct LinkPreviewCard: View {
    let preview: MessageExtras.LinkPreview
    let isOwn: Bool

    var body: some View {
        if let url = URL(string: preview.url) {
            Button {
                ExternalLinkOpener.open(url)
            } label: {
                HStack(spacing: Spacing.md) {
                    Rectangle()
                        .fill(isOwn ? Palette.primaryForeground.opacity(0.6) : Palette.primary)
                        .frame(width: 2)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: ExternalLink.displayHost(url) ?? preview.url)
                            .font(Typography.meta.weight(.semibold))
                            .lineLimit(1)
                        if let title = preview.title, !title.isEmpty {
                            Text(title)
                                .font(Typography.meta.weight(.medium))
                                .lineLimit(2)
                        }
                        if let description = preview.description, !description.isEmpty {
                            Text(description)
                                .font(Typography.meta)
                                .lineLimit(3)
                                .opacity(0.85)
                        }
                    }
                    .multilineTextAlignment(.leading)
                }
                .foregroundStyle(isOwn ? Palette.primaryForeground : Palette.foreground)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isLink)
        }
    }
}

/// Пост, которым поделились в чат: открывается в ленте.
private struct SharedPostCard: View {
    let post: MessageExtras.SharedPostCard
    let isOwn: Bool
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Label(String(localized: "shell.post", defaultValue: "Публикация"), systemImage: "doc.text")
                    .font(.caption.weight(.semibold))
                    .opacity(0.8)
                if post.isDeleted {
                    Text(String(localized: "feed.originalUnavailable", defaultValue: "Публикация недоступна"))
                        .font(Typography.meta)
                        .italic()
                } else {
                    if let author = post.authorName {
                        Text(author).font(Typography.meta.weight(.semibold))
                    }
                    if let title = post.title, !title.isEmpty {
                        Text(title).font(Typography.body.weight(.medium)).lineLimit(2)
                    }
                    if let excerpt = post.excerpt, !excerpt.isEmpty {
                        Text(excerpt).font(Typography.meta).lineLimit(4)
                    }
                }
            }
            .multilineTextAlignment(.leading)
            .padding(Spacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                (isOwn ? Palette.primaryForeground : Palette.muted).opacity(isOwn ? 0.15 : 1),
                in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
            )
            .foregroundStyle(isOwn ? Palette.primaryForeground : Palette.foreground)
        }
        .buttonStyle(.plain)
        .disabled(post.isDeleted)
    }
}

/// История, на которую ответили или которой поделились.
private struct SharedStoryCard: View {
    let story: MessageExtras.SharedStoryCard
    let isOwn: Bool

    var body: some View {
        HStack(spacing: Spacing.md) {
            RoundedRectangle(cornerRadius: Radius.md)
                .fill(StoryBackground.gradient(story.background))
                .frame(width: 36, height: 56)
                .overlay {
                    if story.text == nil {
                        Image(systemName: "clock.badge.xmark").foregroundStyle(.white)
                    }
                }
            VStack(alignment: .leading, spacing: 2) {
                Text(story.isReply
                    ? String(localized: "chats.storyReply", defaultValue: "Ответ на историю")
                    : String(localized: "chats.storyShared", defaultValue: "История"))
                    .font(.caption.weight(.semibold))
                if let author = story.authorName {
                    Text(author).font(Typography.meta)
                }
                Text(story.text ?? String(localized: "chats.storyExpired", defaultValue: "История больше недоступна"))
                    .font(Typography.meta)
                    .lineLimit(2)
                    .opacity(0.85)
            }
        }
        .foregroundStyle(isOwn ? Palette.primaryForeground : Palette.foreground)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Текст системного сообщения. Сервер шлёт только тип и подробности — фразу собирает
/// клиент, на языке приложения.
enum SystemMessageText {
    static func text(for message: MessageRecord) -> String {
        let actor = message.senderName ?? ""
        let target = message.extras?.systemMeta?.targetName ?? ""
        let title = message.extras?.systemMeta?.title ?? ""
        switch message.systemType {
        case "member_added":
            return String(localized: "chats.system.added", defaultValue: "\(actor) добавил(а) \(target)")
        case "member_removed":
            return String(localized: "chats.system.removed", defaultValue: "\(actor) удалил(а) \(target)")
        case "member_left":
            return String(localized: "chats.system.left", defaultValue: "\(actor) покинул(а) чат")
        case "member_joined":
            return String(localized: "chats.system.joined", defaultValue: "\(actor) присоединился(ась) к чату")
        case "member_banned":
            return String(localized: "chats.system.banned", defaultValue: "\(actor) заблокировал(а) \(target)")
        case "admin_granted":
            return String(localized: "chats.system.adminGranted", defaultValue: "\(actor) назначил(а) \(target) администратором")
        case "admin_revoked":
            return String(localized: "chats.system.adminRevoked", defaultValue: "\(actor) снял(а) \(target) с администраторов")
        case "title_changed":
            return String(localized: "chats.system.titleChanged", defaultValue: "\(actor) переименовал(а) чат в «\(title)»")
        case "avatar_changed":
            return String(localized: "chats.system.avatarChanged", defaultValue: "\(actor) сменил(а) фото чата")
        case "message_pinned":
            return String(localized: "chats.system.pinned", defaultValue: "\(actor) закрепил(а) сообщение")
        case "owner_changed":
            return String(localized: "chats.system.ownerChanged", defaultValue: "\(target) теперь владелец чата")
        default:
            return message.content.isEmpty
                ? String(localized: "chats.system.unknown", defaultValue: "Событие в чате")
                : message.content
        }
    }
}

/// Системное сообщение: «такой-то вошёл в группу». Без автора и без пузыря.
private struct SystemMessageView: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.footnote.weight(.medium))
            .foregroundStyle(Palette.foreground)
            .multilineTextAlignment(.center)
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.xs)
            .chatCapsuleSurface()
            .frame(maxWidth: .infinity)
            .padding(.vertical, Spacing.sm)
    }
}

/// Кружок-отметка слева от сообщения в режиме выбора, как в Telegram: пустой контур
/// или залитый синим с белой галочкой.
private struct SelectionMark: View {
    let isSelected: Bool

    @ScaledMetric(relativeTo: .body) private var size: CGFloat = 24

    var body: some View {
        Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
            .resizable()
            .symbolRenderingMode(.palette)
            .foregroundStyle(
                isSelected ? Palette.primaryForeground : Palette.mutedForeground,
                isSelected ? Palette.primary : Palette.mutedForeground
            )
            .frame(width: min(size, 32), height: min(size, 32))
            .contentTransition(.symbolEffect(.replace))
            .accessibilityHidden(true)
    }
}
