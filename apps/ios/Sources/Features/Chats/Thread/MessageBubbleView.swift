import SwiftUI
import UIKit

/// Что знает о чате каждая ячейка ленты. Отдельным значением, чтобы смена (собеседник
/// дочитал, пришло имя группы) перерисовывала ровно те ячейки, которых касается.
struct BubbleContext: Hashable {
    var isGroup = false
    /// До какого времени собеседник личного чата прочитал переписку.
    var othersReadAt: Date?
    var viewerID = ""
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
    case react(String)
    case jump(String)
    case openPost(String)
}

/// Пузырь сообщения.
///
/// Своё справа и синим, чужое слева и на карточке — различение по положению и цвету,
/// как во всех мессенджерах. В группе у чужих — имя автора у первого сообщения группы
/// и аватар у последнего.
struct MessageBubbleView: View {
    let item: MessageTimeline.Item
    var context = BubbleContext()
    var capabilities = MessageCapabilities()
    var onAction: (MessageAction) -> Void = { _ in }

    @State private var reactionTick = 0

    private var message: MessageRecord { item.message }
    private var extras: MessageExtras { message.extras ?? MessageExtras() }
    private var isDeleted: Bool { message.deletedAt != nil }
    private var showsAvatarColumn: Bool { context.isGroup && !item.isOwn }

    var body: some View {
        if message.systemType != nil {
            SystemMessageView(text: SystemMessageText.text(for: message))
        } else {
            VStack(alignment: item.isOwn ? .trailing : .leading, spacing: Spacing.xs) {
                HStack(alignment: .bottom, spacing: Spacing.md) {
                    if item.isOwn { Spacer(minLength: Spacing.xxl * 2) }
                    if showsAvatarColumn {
                        Group {
                            if item.isLastInGroup {
                                AvatarView(url: message.senderAvatar, name: message.senderName, size: 30)
                            } else {
                                Color.clear
                            }
                        }
                        .frame(width: 30, height: 30)
                    }
                    bubble
                        .contextMenu { menu }
                        .onTapGesture(count: 2) {
                            guard !isDeleted, message.remoteId != nil else { return }
                            reactionTick += 1
                            onAction(.react(ChatReactions.doubleTap))
                        }
                        .sensoryFeedback(.impact(weight: .light), trigger: reactionTick)
                    if !item.isOwn { Spacer(minLength: Spacing.xxl * 2) }
                }
                if !extras.reactions.isEmpty, !isDeleted {
                    reactionsRow
                        .padding(.leading, showsAvatarColumn ? 30 + Spacing.md : 0)
                }
            }
        }
    }

    // MARK: Пузырь

    private var bubble: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            if context.isGroup, !item.isOwn, item.isFirstInGroup, let name = message.senderName, !name.isEmpty {
                Text(name)
                    .font(Typography.meta.weight(.semibold))
                    .foregroundStyle(SenderColor.color(for: message.senderId))
                    .lineLimit(1)
            }

            if extras.isForwarded, !isDeleted {
                Label {
                    Text(extras.forwardedFromName.map {
                        String(localized: "chats.forwardedFrom", defaultValue: "Переслано от \($0)")
                    } ?? String(localized: "chats.forwarded", defaultValue: "Пересланное сообщение"))
                } icon: {
                    Image(systemName: "arrowshape.turn.up.right")
                }
                .font(Typography.meta.italic())
                .foregroundStyle(metaColor)
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
            }

            if !isDeleted {
                ForEach(item.attachments, id: \.id) { attachment in
                    AttachmentView(attachment: attachment, isOwn: item.isOwn)
                }
                if let post = extras.sharedPost {
                    SharedPostCard(post: post, isOwn: item.isOwn) { onAction(.openPost(post.id)) }
                }
                if let story = extras.sharedStory {
                    SharedStoryCard(story: story, isOwn: item.isOwn)
                }
                if let poll = extras.poll {
                    ChatPollView(poll: poll, isOwn: item.isOwn)
                }
            }

            // Подпись к вложению может быть пустой — тогда и строки нет.
            if !message.content.isEmpty || (item.attachments.isEmpty && extras.poll == nil && extras.sharedPost == nil) {
                Text(isDeleted ? AttributedString(deletedText) : RichText.attributed(message.content))
                    .font(Typography.body)
                    .foregroundStyle(textColor)
                    .tint(item.isOwn ? Palette.primaryForeground : Palette.primary)
                    .italic(isDeleted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let preview = extras.linkPreview, !isDeleted {
                LinkPreviewCard(preview: preview, isOwn: item.isOwn)
            }

            HStack(spacing: Spacing.xs) {
                if message.pinnedAt != nil, !isDeleted {
                    Image(systemName: "pin.fill")
                        .accessibilityLabel(Text(String(localized: "chats.pinnedMessage", defaultValue: "Закреплено")))
                }
                if message.editedAt != nil, !isDeleted {
                    Text(String(localized: "chats.edited", defaultValue: "изм."))
                }
                Text(message.createdAt.formatted(date: .omitted, time: .shortened))
                    .font(Typography.tabular(Typography.meta))
                if item.isOwn {
                    stateMark
                }
            }
            .font(Typography.meta)
            .foregroundStyle(metaColor)
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.md)
        .background(background, in: BubbleShape(isOwn: item.isOwn, hasTail: item.isLastInGroup))
        .contentShape(BubbleShape(isOwn: item.isOwn, hasTail: item.isLastInGroup))
        .overlay(alignment: .bottomTrailing) {
            if message.sendState == .failed {
                Button {
                    onAction(.retry)
                } label: {
                    Image(systemName: "arrow.clockwise.circle.fill")
                        .foregroundStyle(Palette.destructive)
                }
                .buttonStyle(.plain)
                .offset(x: Spacing.lg, y: 0)
                .accessibilityLabel(Text(String(localized: "chats.retrySend", defaultValue: "Отправить ещё раз")))
            }
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: Меню

    @ViewBuilder
    private var menu: some View {
        if !isDeleted, message.remoteId != nil {
            ControlGroup {
                ForEach(ChatReactions.all, id: \.self) { emoji in
                    Button {
                        onAction(.react(emoji))
                    } label: {
                        Text(verbatim: emoji)
                    }
                    .accessibilityLabel(Text(verbatim: emoji))
                }
            }
            .controlGroupStyle(.palette)

            Button {
                onAction(.reply)
            } label: {
                Label(String(localized: "chats.reply", defaultValue: "Ответить"), systemImage: "arrowshape.turn.up.left")
            }
        }
        if !isDeleted, !message.content.isEmpty {
            Button {
                onAction(.copy)
            } label: {
                Label(String(localized: "feed.copyText", defaultValue: "Копировать текст"), systemImage: "doc.on.doc")
            }
        }
        if capabilities.canEdit {
            Button {
                onAction(.edit)
            } label: {
                Label(String(localized: "feed.edit", defaultValue: "Редактировать"), systemImage: "pencil")
            }
        }
        if !isDeleted, message.remoteId != nil {
            Button {
                onAction(.pin)
            } label: {
                Label(
                    message.pinnedAt == nil
                        ? String(localized: "chats.pin", defaultValue: "Закрепить")
                        : String(localized: "chats.unpin", defaultValue: "Открепить"),
                    systemImage: message.pinnedAt == nil ? "pin" : "pin.slash"
                )
            }
            Button {
                onAction(.forward)
            } label: {
                Label(String(localized: "chats.forward", defaultValue: "Переслать"), systemImage: "arrowshape.turn.up.right")
            }
        }
        if capabilities.canReport, !isDeleted, message.remoteId != nil {
            Button {
                onAction(.report)
            } label: {
                Label(String(localized: "feed.report", defaultValue: "Пожаловаться"), systemImage: "exclamationmark.bubble")
            }
        }
        if capabilities.canDelete {
            Button(role: .destructive) {
                onAction(.delete)
            } label: {
                Label(String(localized: "feed.delete", defaultValue: "Удалить"), systemImage: "trash")
            }
        }
    }

    // MARK: Реакции

    private var reactionsRow: some View {
        HStack(spacing: Spacing.xs) {
            ForEach(extras.reactions, id: \.emoji) { group in
                let mine = group.userIds.contains(context.viewerID)
                Button {
                    reactionTick += 1
                    onAction(.react(group.emoji))
                } label: {
                    HStack(spacing: 2) {
                        Text(verbatim: group.emoji)
                        if group.userIds.count > 1 {
                            Text(verbatim: String(group.userIds.count))
                                .font(Typography.tabular(.caption))
                        }
                    }
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, 3)
                    .background(mine ? Palette.primary.opacity(0.18) : Palette.muted, in: Capsule())
                    .overlay(Capsule().strokeBorder(mine ? Palette.primary : .clear, lineWidth: 1))
                    .foregroundStyle(Palette.foreground)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: group.emoji))
                .accessibilityValue(Text(verbatim: String(group.userIds.count)))
                .accessibilityAddTraits(mine ? .isSelected : [])
            }
        }
        .font(.footnote)
    }

    // MARK: Оформление

    private var deletedText: String {
        String(localized: "chats.deletedMessage", defaultValue: "Сообщение удалено")
    }

    /// Состояние своей отправки: часы, одна галочка — доставлено, две — прочитано.
    @ViewBuilder
    private var stateMark: some View {
        switch message.sendState {
        case .sent:
            if let readAt = context.othersReadAt, readAt >= message.createdAt, !context.isGroup {
                Image(systemName: "checkmark.circle.fill")
                    .accessibilityLabel(Text(String(localized: "chats.read", defaultValue: "Прочитано")))
            } else {
                Image(systemName: "checkmark")
                    .accessibilityLabel(Text(String(localized: "chats.sent", defaultValue: "Отправлено")))
            }
        case .pending:
            Image(systemName: "clock")
                .accessibilityLabel(Text(String(localized: "chats.sending", defaultValue: "Отправляется")))
        case .failed:
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Palette.destructive)
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

/// Форма пузыря: скругление системы, у последнего в группе — меньший угол со стороны
/// автора, как «хвостик». Без рисованного хвоста: он спорит со стеклом iOS 26.
struct BubbleShape: Shape {
    let isOwn: Bool
    let hasTail: Bool

    func path(in rect: CGRect) -> Path {
        let big = Radius.xxl
        let small = hasTail ? Radius.sm : big
        return Path(
            roundedRect: rect,
            cornerRadii: RectangleCornerRadii(
                topLeading: big,
                bottomLeading: isOwn ? big : small,
                bottomTrailing: isOwn ? small : big,
                topTrailing: big
            ),
            style: .continuous
        )
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

/// Цитата над текстом: полоска, автор и усечённый фрагмент.
private struct ReplyQuoteView: View {
    let author: String?
    let text: String?
    let isOwn: Bool

    var body: some View {
        HStack(spacing: Spacing.md) {
            Rectangle()
                .fill(isOwn ? Palette.primaryForeground.opacity(0.6) : Palette.primary)
                .frame(width: 2)
            VStack(alignment: .leading, spacing: 0) {
                if let author, !author.isEmpty {
                    Text(author)
                        .font(Typography.meta.weight(.semibold))
                        .foregroundStyle(isOwn ? Palette.primaryForeground : Palette.primary)
                        .lineLimit(1)
                }
                Text(text?.isEmpty == false
                    ? text!
                    : String(localized: "chats.deletedMessage", defaultValue: "Сообщение удалено"))
                    .font(Typography.meta)
                    .lineLimit(2)
                    .foregroundStyle(isOwn ? Palette.primaryForeground.opacity(0.85) : Palette.mutedForeground)
            }
        }
        .padding(.vertical, 2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityHint(Text(String(localized: "chats.reply.jump", defaultValue: "Перейти к сообщению")))
    }
}

/// Превью ссылки под текстом.
private struct LinkPreviewCard: View {
    let preview: MessageExtras.LinkPreview
    let isOwn: Bool

    var body: some View {
        if let url = URL(string: preview.url) {
            Link(destination: url) {
                HStack(spacing: Spacing.md) {
                    Rectangle()
                        .fill(isOwn ? Palette.primaryForeground.opacity(0.6) : Palette.primary)
                        .frame(width: 2)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(preview.siteName ?? url.host() ?? preview.url)
                            .font(Typography.meta.weight(.semibold))
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
            .font(Typography.meta)
            .foregroundStyle(Palette.mutedForeground)
            .multilineTextAlignment(.center)
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.xs)
            .background(Palette.muted.opacity(0.7), in: Capsule())
            .frame(maxWidth: .infinity)
            .padding(.vertical, Spacing.sm)
    }
}
