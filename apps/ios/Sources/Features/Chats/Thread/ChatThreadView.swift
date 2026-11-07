import SwiftUI
import UIKit

/// Экран переписки: шапка с состоянием собеседника, плашка закреплённого, лента и
/// поле ввода.
struct ChatThreadView: View {
    let chatID: String
    let viewerID: String

    @State private var model: ChatThreadModel?
    @State private var forwarding: MessageRecord?
    @State private var reporting: MessageRecord?
    @State private var deleting: MessageRecord?
    @State private var reported = false
    @State private var pinnedIndex = 0
    private var realtime: RealtimeCoordinator { AppServices.realtime }

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
        .background(Palette.background)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                NavigationLink(value: AppRoute.chatInfo(id: chatID)) {
                    ChatTitleView(model: model, realtime: realtime)
                }
                .buttonStyle(.plain)
            }
        }
        .toolbar(.hidden, for: .tabBar)
    }

    @ViewBuilder
    private func thread(_ model: ChatThreadModel) -> some View {
        Group {
                if let failure = model.failure {
                    FormAlert(message: failure)
                        .padding(.horizontal, Spacing.xl)
                        .padding(.top, Spacing.md)
                }

                if !model.pinned.isEmpty {
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
                    onReachTop: { Task { await model.loadOlder() } },
                    onAction: { action, message in handle(action, message: message, model: model) }
                )

                if let action = model.othersAction {
                    ChatActionCaption(action: action)
                }

                if model.chat?.requestIncoming == true {
                    ChatRequestBar(chatID: chatID)
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

    private func bubbleContext(_ model: ChatThreadModel) -> BubbleContext {
        BubbleContext(
            isGroup: model.chat.map { $0.kind != .private && $0.kind != .saved } ?? false,
            othersReadAt: model.chat?.othersReadAt,
            viewerID: viewerID
        )
    }

    private func withLifecycle<V: View>(_ view: V) -> some View {
        view
        .task {
            guard model == nil else { return }
            let created = ChatThreadModel(chatID: chatID, viewerID: viewerID)
            model = created
            created.start()
            await created.enter()
            await created.markRead()
            await created.loadPinned()
        }
        .onChange(of: realtime.connectionEpoch) {
            Task { await model?.catchUpAfterReconnect() }
        }
        .onChange(of: realtime.pinnedVersions[chatID] ?? 0) {
            Task { await model?.loadPinned() }
        }
        .onChange(of: model?.days.count ?? 0) {
            // Пришло новое — пока чат открыт, оно прочитано.
            Task { await model?.markRead() }
        }
        .onDisappear {
            Task { [model] in await model?.leave() }
        }
    }

    private func withDialogs<V: View>(_ view: V) -> some View {
        view
        .sheet(item: $forwarding) { message in
            ForwardPickerView(excludedChatID: chatID) { targets in
                guard let model else { return false }
                return await model.forward(message, to: targets)
            }
        }
        .confirmationDialog(
            String(localized: "chats.report.title", defaultValue: "Что не так с сообщением?"),
            isPresented: Binding(get: { reporting != nil }, set: { if !$0 { reporting = nil } }),
            titleVisibility: .visible,
            presenting: reporting
        ) { message in
            ForEach(ComplaintReason.allCases) { reason in
                Button(reason.title) {
                    Task { reported = await model?.report(message, reason: reason.title) ?? false }
                }
            }
        }
        .confirmationDialog(
            String(localized: "chats.delete.title", defaultValue: "Удалить сообщение у всех?"),
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible,
            presenting: deleting
        ) { message in
            Button(String(localized: "feed.delete", defaultValue: "Удалить"), role: .destructive) {
                Task { await model?.delete(message) }
            }
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
            deleting = message
        case .pin:
            Task { await model.togglePin(message) }
        case .copy:
            UIPasteboard.general.string = message.content
        case .forward:
            forwarding = message
        case .report:
            reporting = message
        case .retry:
            Task { await model.retry(message) }
        case .react(let emoji):
            Task { await model.react(message, emoji: emoji) }
        case .jump(let id):
            Task { await model.jump(to: id) }
        case .openPost(let id):
            AppServices.router.stacks[.chats, default: []].append(.post(id: id))
        }
    }
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
                    .font(Typography.cardTitle)
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
                    .font(.caption)
                    .foregroundStyle(isActive ? Palette.primary : Palette.mutedForeground)
                    .lineLimit(1)
                    .contentTransition(.opacity)
            }
        }
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
            return model.isPeerOnline
                ? String(localized: "chats.online", defaultValue: "в сети")
                : nil
        case .saved:
            return nil
        default:
            return chat.memberCount > 0
                ? String(localized: "chats.members", defaultValue: "Участников: \(chat.memberCount)")
                : nil
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
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.sm)
            .background(.bar)
            .overlay(alignment: .bottom) { Rectangle().fill(Palette.border).frame(height: 0.5) }
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
                .buttonStyle(.bordered)
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
                .buttonStyle(.borderedProminent)
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
