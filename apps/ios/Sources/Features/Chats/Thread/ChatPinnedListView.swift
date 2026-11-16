import SwiftUI

/// «Закреплено N» — все закреплённые сообщения чата пузырями на обоях, как в Telegram:
/// старые сверху, свежие внизу, у каждого дня — своя дата. Касание сообщения закрывает
/// экран и ведёт ленту к нему; внизу — «Открепить все сообщения».
///
/// Пузыри — те же, что в ленте (`MessageBubbleView`), в режиме копии: без якорей меню и
/// без двойного касания. Сами сообщения — из ответа «закреплённые» (`model.pinned`), без
/// базы: закреплённое может лежать далеко за пределами скачанной истории.
struct ChatPinnedListView: View {
    let model: ChatThreadModel
    let viewerID: String
    let isGroup: Bool
    /// Перейти к сообщению (серверный id): экран уже закрывается.
    let onJump: (String) -> Void
    /// Открепить все — после подтверждения; `true` — получилось.
    let onUnpinAll: () async -> Bool

    @Environment(\.dismiss) private var dismiss
    @State private var confirmingUnpin = false
    @State private var isUnpinning = false

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: Spacing.xs) {
                    ForEach(days) { day in
                        Text(DaySeparatorMetrics.title(for: day.id))
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Palette.foreground)
                            .padding(.horizontal, Spacing.lg)
                            .padding(.vertical, Spacing.xs)
                            .chatCapsuleSurface()
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, Spacing.sm)
                            .accessibilityAddTraits(.isHeader)
                        ForEach(day.items) { item in
                            bubble(item)
                        }
                    }
                }
                .padding(.horizontal, Spacing.md)
                .padding(.vertical, Spacing.md)
            }
            // Как лента переписки: открывается у свежего края.
            .defaultScrollAnchor(.bottom)
            .background { ChatWallpaper().ignoresSafeArea() }
            .overlay {
                if model.pinned.isEmpty {
                    ContentUnavailableView(
                        String(localized: "chats.pinnedList.empty", defaultValue: "Закреплённых сообщений нет"),
                        systemImage: "pin.slash"
                    )
                }
            }
            .safeAreaInset(edge: .bottom) {
                if !model.pinned.isEmpty {
                    unpinButton
                }
            }
            .navigationTitle(Text(String(
                localized: "chats.pinnedList.title",
                defaultValue: "Закреплено \(model.pinned.count)"
            )))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton { dismiss() }
                }
            }
            .confirmationDialog(
                String(localized: "chats.pinned.unpinAll.title", defaultValue: "Открепить все сообщения?"),
                isPresented: $confirmingUnpin,
                titleVisibility: .visible
            ) {
                Button(
                    String(localized: "chats.pinned.unpinAll", defaultValue: "Открепить все сообщения"),
                    role: .destructive
                ) {
                    Task {
                        isUnpinning = true
                        let done = await onUnpinAll()
                        isUnpinning = false
                        if done { dismiss() }
                    }
                }
                Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
            }
        }
        .presentationDetents([.large])
    }

    /// Пузырь целиком — одна кнопка: вложения и цитата под ней не срабатывают, касание
    /// ведёт к сообщению в ленте (как выбор в режиме выбора).
    private func bubble(_ item: MessageTimeline.Item) -> some View {
        MessageBubbleView(
            item: item,
            context: BubbleContext(isGroup: isGroup, viewerID: viewerID),
            isMenuPreview: true
        )
        .overlay {
            Button {
                dismiss()
                onJump(item.message.id)
            } label: {
                Color.clear.contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(item.message.content.isEmpty
                ? String(localized: "chats.attachmentPreview", defaultValue: "Вложение")
                : item.message.content))
            .accessibilityHint(Text(String(localized: "chats.reply.jump", defaultValue: "Перейти к сообщению")))
        }
    }

    private var unpinButton: some View {
        Button {
            confirmingUnpin = true
        } label: {
            HStack(spacing: Spacing.sm) {
                if isUnpinning {
                    ProgressView()
                }
                Text(String(localized: "chats.pinned.unpinAll", defaultValue: "Открепить все сообщения"))
                    .font(Typography.body.weight(.semibold))
            }
            .frame(maxWidth: .infinity)
            .frame(minHeight: ControlHeight.lg)
        }
        .glassButton()
        .disabled(isUnpinning)
        .padding(.horizontal, Spacing.xl)
        .padding(.bottom, Spacing.md)
    }

    /// Закреплённые лентой: старые сверху, по дням. Пришли от свежего к старому.
    private var days: [MessageTimeline.Day] {
        let messages = model.pinned.reversed()
        let records = messages.map(MessageRecord.init(server:))
        var attachments: [String: [AttachmentRecord]] = [:]
        for message in messages {
            attachments[message.id] = (message.media ?? []).map { media in
                AttachmentRecord(
                    id: media.id,
                    messageId: message.id,
                    mime: media.mime,
                    name: media.name,
                    size: media.size,
                    width: media.width,
                    height: media.height,
                    localPath: nil,
                    placeholder: media.placeholder,
                    durationMs: media.durationMs,
                    spoiler: media.spoiler ?? false,
                    asDocument: media.asDocument ?? false
                )
            }
        }
        return MessageTimeline.build(from: records, attachments: attachments, viewerID: viewerID)
    }
}
