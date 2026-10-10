import SwiftUI

/// Пузырь сообщения.
///
/// Своё справа и синим, чужое слева и на карточке — различение по положению и цвету,
/// как во всех мессенджерах; подпись автора появляется только в групповых чатах и
/// только у первого сообщения группы.
struct MessageBubbleView: View {
    let item: MessageTimeline.Item
    let onRetry: () -> Void

    private var message: MessageRecord { item.message }

    var body: some View {
        if message.systemType != nil {
            SystemMessageView(text: message.content)
        } else {
            HStack {
                if item.isOwn { Spacer(minLength: Spacing.xxl) }
                bubble
                if !item.isOwn { Spacer(minLength: Spacing.xxl) }
            }
        }
    }

    private var bubble: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            if let quote = message.replyQuote, message.deletedAt == nil {
                ReplyQuoteView(text: quote, isOwn: item.isOwn)
            }

            if message.deletedAt == nil {
                ForEach(item.attachments, id: \.id) { attachment in
                    AttachmentView(attachment: attachment, isOwn: item.isOwn)
                }
            }

            // Подпись к вложению может быть пустой — тогда и строки нет.
            if !message.content.isEmpty || item.attachments.isEmpty {
                Text(text)
                    .font(Typography.body)
                    .foregroundStyle(textColor)
                    .italic(message.deletedAt != nil)
            }

            HStack(spacing: Spacing.xs) {
                if message.editedAt != nil, message.deletedAt == nil {
                    Text(String(localized: "chats.edited", defaultValue: "изм."))
                        .font(Typography.meta)
                        .foregroundStyle(metaColor)
                }
                Text(message.createdAt.formatted(date: .omitted, time: .shortened))
                    .font(Typography.tabular(Typography.meta))
                    .foregroundStyle(metaColor)
                if item.isOwn {
                    stateMark
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.md)
        .background(background, in: RoundedRectangle(cornerRadius: Radius.xl))
        .overlay(alignment: .bottomTrailing) {
            if message.sendState == .failed {
                Button(action: onRetry) {
                    Image(systemName: "arrow.clockwise.circle.fill")
                        .foregroundStyle(Palette.destructive)
                }
                .buttonStyle(.plain)
                .offset(x: Spacing.lg, y: 0)
                .accessibilityLabel(Text(String(
                    localized: "chats.retrySend",
                    defaultValue: "Отправить ещё раз"
                )))
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var text: String {
        if message.deletedAt != nil {
            return String(localized: "chats.deletedMessage", defaultValue: "Сообщение удалено")
        }
        return message.content
    }

    /// Состояние своей отправки. Галочек прочтения здесь нет намеренно: они приходят
    /// отдельным событием и появятся вместе с ним (задача 1.6).
    @ViewBuilder
    private var stateMark: some View {
        switch message.sendState {
        case .sent:
            Image(systemName: "checkmark")
                .font(Typography.meta)
                .foregroundStyle(metaColor)
                .accessibilityLabel(Text(String(localized: "chats.sent", defaultValue: "Отправлено")))
        case .pending:
            Image(systemName: "clock")
                .font(Typography.meta)
                .foregroundStyle(metaColor)
                .accessibilityLabel(Text(String(localized: "chats.sending", defaultValue: "Отправляется")))
        case .failed:
            Image(systemName: "exclamationmark.triangle.fill")
                .font(Typography.meta)
                .foregroundStyle(Palette.destructive)
                .accessibilityLabel(Text(String(
                    localized: "chats.sendFailed",
                    defaultValue: "Не отправлено"
                )))
        }
    }

    private var background: Color {
        item.isOwn ? Palette.primary : Palette.card
    }

    private var textColor: Color {
        if message.deletedAt != nil { return metaColor }
        return item.isOwn ? Palette.primaryForeground : Palette.foreground
    }

    private var metaColor: Color {
        item.isOwn ? Palette.primaryForeground.opacity(0.75) : Palette.mutedForeground
    }
}

/// Цитата над текстом: полоска и усечённый фрагмент — то же, что в вебе.
private struct ReplyQuoteView: View {
    let text: String
    let isOwn: Bool

    var body: some View {
        HStack(spacing: Spacing.md) {
            Rectangle()
                .fill(isOwn ? Palette.primaryForeground.opacity(0.6) : Palette.primary)
                .frame(width: 2)
            Text(text)
                .font(Typography.meta)
                .lineLimit(2)
                .foregroundStyle(isOwn ? Palette.primaryForeground.opacity(0.85) : Palette.mutedForeground)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
            .frame(maxWidth: .infinity)
            .padding(.vertical, Spacing.sm)
    }
}
