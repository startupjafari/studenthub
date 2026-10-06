import SwiftUI

/// Поле ввода.
///
/// Высота панели — 48 pt: осознанное исключение из высоты островов (DESIGN_SYSTEM
/// §4), потому что в открытом чате нижняя навигация скрыта и совпадать не с чем.
struct MessageComposerView: View {
    @Bindable var model: ChatThreadModel

    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            if let replyTo = model.replyTo {
                ReplyBar(text: replyTo.content) { model.cancelReply() }
            }

            HStack(alignment: .bottom, spacing: Spacing.md) {
                TextField(
                    text: $model.draft,
                    prompt: Text(verbatim: String(localized: "chats.placeholder", defaultValue: "Сообщение")),
                    axis: .vertical
                ) {
                    Text(verbatim: String(localized: "chats.placeholder", defaultValue: "Сообщение"))
                }
                .labelsHidden()
                .lineLimit(1...5)
                .font(Typography.body)
                .foregroundStyle(Palette.foreground)
                .focused($isFocused)
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.md)
                .background(Palette.muted, in: RoundedRectangle(cornerRadius: Radius.xl))
                .onChange(of: model.draft) {
                    model.draftChanged()
                }

                Button {
                    Task { await model.send() }
                } label: {
                    Image(systemName: "arrow.up")
                        .font(Typography.body.weight(.semibold))
                        .foregroundStyle(Palette.primaryForeground)
                        .frame(width: ControlHeight.lg, height: ControlHeight.lg)
                        .background(canSend ? Palette.primary : Palette.mutedForeground, in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(!canSend)
                .accessibilityLabel(Text(String(localized: "chats.send", defaultValue: "Отправить")))
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.md)
            .frame(minHeight: ControlHeight.chatInput)
        }
        .background(Palette.background)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(Palette.border)
                .frame(height: 1)
        }
    }

    private var canSend: Bool {
        !model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

/// Полоска «отвечаю на…» над полем ввода.
private struct ReplyBar: View {
    let text: String
    let onCancel: () -> Void

    var body: some View {
        HStack(spacing: Spacing.md) {
            Rectangle()
                .fill(Palette.primary)
                .frame(width: 2, height: ControlHeight.sm)
            VStack(alignment: .leading, spacing: 0) {
                Text(String(localized: "chats.replyingTo", defaultValue: "Ответ"))
                    .font(Typography.meta)
                    .foregroundStyle(Palette.primary)
                Text(text)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(1)
            }
            Spacer(minLength: Spacing.md)
            Button(action: onCancel) {
                Image(systemName: "xmark")
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(String(localized: "common.cancel", defaultValue: "Отменить")))
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.md)
        .background(Palette.muted)
    }
}
