import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Экран переписки как в Telegram: обои, по центру шапки — имя и статус, справа —
/// аватар (ведёт в информацию о чате), плашка закреплённого, лента с пузырями, кнопка
/// «вниз» со счётчиком и стеклянная панель ввода.
struct ChatThreadView: View {
    let chatID: String
    let viewerID: String

    @State private var model: ChatThreadModel?
    @State private var opener = RemoteFileOpener()
    /// Экран уходил (вперёд по стеку или назад): комната сокета отпущена.
    @State private var hasLeft = false
    @State private var forwarding: ForwardBatch?
    @State private var reporting: MessageRecord?
    @State private var deleting: MessageRecord?
    /// Подтверждение удаления выбранного: сколько сообщений уйдёт.
    @State private var deletingSelection: Int?
    @State private var copiedTick = 0
    @State private var reported = false
    @State private var pinnedIndex = 0
    /// Лента у нижнего края — кнопка «вниз» не нужна.
    @State private var atBottom = true
    /// С какого момента человек не у низа: всё чужое позже — непрочитанное на кнопке.
    @State private var awaySince: Date?
    /// Дошёл ли человек до низа с открытия: до того счётчик ведётся от первого
    /// непрочитанного.
    @State private var reachedBottom = false
    @State private var bottomToken = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var realtime: RealtimeCoordinator { AppServices.realtime }
    private var jumps: ChatJumpRequests { ChatJumpRequests.shared }

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
        .background { ChatWallpaper().ignoresSafeArea() }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let model, model.isSelecting {
                selectionToolbar(model)
            } else {
                ToolbarItem(placement: .principal) {
                    NavigationLink(value: AppRoute.chatInfo(id: chatID)) {
                        ChatTitleView(model: model, realtime: realtime)
                    }
                    .buttonStyle(.plain)
                }
                ChatAvatarToolbarItem(chatID: chatID, chat: model?.chat, title: model?.title)
            }
        }
        // В режиме выбора место «назад» занимает «Отмена»: выход из режима, а не из
        // чата. Вместе с кнопкой система отключает и свайп назад — случайно закрыть
        // переписку с половиной выбора не выйдет.
        .navigationBarBackButtonHidden(model?.isSelecting == true)
        .toolbar(.hidden, for: .tabBar)
        .sensoryFeedback(.selection, trigger: model?.selection?.count ?? 0)
        .sensoryFeedback(.success, trigger: copiedTick)
    }

    /// Шапка режима выбора: «Отмена» слева и счётчик по центру, как в Telegram.
    @ToolbarContentBuilder
    private func selectionToolbar(_ model: ChatThreadModel) -> some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button(String(localized: "common.cancel", defaultValue: "Отмена")) {
                endSelection(model)
            }
        }
        ToolbarItem(placement: .principal) {
            Text(String(
                localized: "chats.selection.count",
                defaultValue: "Выбрано: \(model.selection?.count ?? 0)"
            ))
            .font(.headline)
            .foregroundStyle(Palette.foreground)
            .contentTransition(.numericText())
            .accessibilityAddTraits(.isHeader)
        }
    }

    private func endSelection(_ model: ChatThreadModel) {
        withAnimation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion)) {
            model.endSelection()
        }
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
                    selection: model.selection,
                    scrollToBottomToken: bottomToken,
                    onBottomChange: { bottomChanged($0) },
                    onReachTop: { Task { await model.loadOlder() } },
                    onAction: { action, message in handle(action, message: message, model: model) }
                )
                .overlay(alignment: .bottomTrailing) {
                    if !atBottom {
                        ChatScrollDownButton(count: unseen(model)) {
                            bottomToken += 1
                        }
                        .padding(.trailing, Spacing.lg)
                        .padding(.bottom, Spacing.md)
                        .transition(reduceMotion ? .opacity : .scale(scale: 0.6).combined(with: .opacity))
                    }
                }

                if model.isSelecting {
                    // Поле ввода на время выбора уступает место панели действий.
                    MessageSelectionBar(
                        canCopy: !model.selectedText.isEmpty,
                        canForward: model.canForwardSelection,
                        canDelete: model.canDeleteSelection,
                        onCopy: {
                            UIPasteboard.general.string = model.selectedText
                            copiedTick += 1
                            endSelection(model)
                        },
                        onForward: {
                            forwarding = ForwardBatch(messages: model.selectedMessages, fromSelection: true)
                        },
                        onDelete: {
                            deletingSelection = model.selectedMessages.count
                        }
                    )
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                } else if model.chat?.requestIncoming == true {
                    ChatRequestBar(chatID: chatID)
                } else if model.chat?.requestOutgoing == true, model.chat?.lastMessageId != nil || !model.days.isEmpty {
                    // Первое сообщение ушло запросом — дальше писать нельзя, пока его не
                    // примут (как в вебе): иначе следующие сообщения молча отклонялись бы.
                    Label(
                        String(localized: "chats.requestPending", defaultValue: "Запрос на переписку ещё не принят"),
                        systemImage: "clock"
                    )
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .frame(maxWidth: .infinity)
                    .padding(Spacing.xl)
                    .background(.bar)
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

    private func bottomChanged(_ isAtBottom: Bool) {
        withAnimation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion)) {
            atBottom = isAtBottom
        }
        if isAtBottom {
            reachedBottom = true
            awaySince = nil
        } else if awaySince == nil {
            awaySince = Date()
        }
    }

    /// Непрочитанное на кнопке «вниз»: пока человек не дошёл до низа с открытия —
    /// от первого непрочитанного, потом — пришедшее, пока он листал вверх.
    private func unseen(_ model: ChatThreadModel) -> Int {
        if !reachedBottom, let anchor = model.openingAnchorDate {
            return model.unseenCount(after: anchor.addingTimeInterval(-0.001))
        }
        guard let awaySince else { return 0 }
        return model.unseenCount(after: awaySince)
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
            await created.loadPeer()
        }
        .onChange(of: jumps.pending[chatID]) {
            consumeJump()
        }
        .onAppear {
            consumeJump()
        }
        .onChange(of: realtime.connectionEpoch) {
            Task { await model?.catchUpAfterReconnect() }
        }
        .onChange(of: realtime.pinnedVersions[chatID] ?? 0) {
            Task { await model?.loadPinned() }
        }
        .onChange(of: model?.newestIncomingID) {
            // Пришло новое — пока чат открыт, оно прочитано.
            Task { await model?.markRead() }
        }
        .onAppear {
            guard hasLeft, let model else { return }
            hasLeft = false
            Task { await model.rejoin() }
        }
        .onDisappear {
            hasLeft = true
            // Ушли с экрана — выбор не переживает возвращения, как и в Telegram.
            model?.endSelection()
            Task { [model] in await model?.leave() }
        }
    }

    /// Поиск в информации о чате просит открыть переписку на найденном сообщении.
    private func consumeJump() {
        guard let target = jumps.pending[chatID], let model else { return }
        jumps.pending[chatID] = nil
        Task { await model.jump(to: target) }
    }

    private func withDialogs<V: View>(_ view: V) -> some View {
        view
        .remoteFilePreview(opener)
        .sheet(item: $forwarding) { batch in
            ForwardPickerView(excludedChatID: chatID) { targets in
                guard let model else { return false }
                let sent = await model.forward(batch.messages, to: targets)
                if sent, batch.fromSelection { endSelection(model) }
                return sent
            }
        }
        .alert(
            String(localized: "chats.report.title", defaultValue: "Что не так с сообщением?"),
            isPresented: Binding(get: { reporting != nil }, set: { if !$0 { reporting = nil } }),
            presenting: reporting
        ) { message in
            ForEach(ComplaintReason.allCases) { reason in
                Button(reason.title) {
                    Task { reported = await model?.report(message, reason: reason.title) ?? false }
                }
            }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
        }
        .alert(
            String(localized: "chats.delete.title", defaultValue: "Удалить сообщение у всех?"),
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            presenting: deleting
        ) { message in
            Button(String(localized: "feed.delete", defaultValue: "Удалить"), role: .destructive) {
                Task { await model?.delete(message) }
            }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
        }
        .alert(
            ChatPlural.deleteMessagesQuestion(deletingSelection ?? 0),
            isPresented: Binding(get: { deletingSelection != nil }, set: { if !$0 { deletingSelection = nil } })
        ) {
            Button(String(localized: "feed.delete", defaultValue: "Удалить"), role: .destructive) {
                Task { await model?.deleteSelected() }
            }
            Button(String(localized: "common.cancel", defaultValue: "Отмена"), role: .cancel) {}
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
            forwarding = ForwardBatch(messages: [message], fromSelection: false)
        case .select:
            withAnimation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion)) {
                model.beginSelection(with: message)
            }
        case .toggleSelection:
            withAnimation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion)) {
                model.toggleSelection(of: message)
            }
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
        case .openAttachment(let file):
            open(file)
        }
    }

    /// Вложение — системным просмотром (фото, PDF, Office, видео). Свой файл на диске
    /// открывается сразу, чужой скачивается по свежей ссылке: подписанная живёт минуты.
    private func open(_ file: AttachmentRecord) {
        if let path = file.localPath, FileManager.default.fileExists(atPath: path) {
            opener.previewURL = URL(filePath: path)
            return
        }
        Task {
            await opener.open(name: AttachmentFileName.of(file)) {
                guard let url = await AppServices.attachmentURLs.url(for: file.id) else {
                    throw URLError(.fileDoesNotExist)
                }
                return url
            }
        }
    }
}

/// Что пересылаем: одно сообщение из меню или выбранные разом. После пересылки
/// выбранного режим выбора закрывается.
private struct ForwardBatch: Identifiable {
    let id = UUID()
    let messages: [MessageRecord]
    let fromSelection: Bool
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
                    .font(.headline)
                    .foregroundStyle(Palette.foreground)
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
                    .font(.footnote)
                    .foregroundStyle(isActive ? Palette.primary : Palette.mutedForeground)
                    .lineLimit(1)
                    .contentTransition(.opacity)
            }
        }
        .padding(.horizontal, Spacing.md)
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
            return ChatPresence.caption(
                online: model.isPeerOnline,
                lastSeen: model.peer?.lastSeenAt,
                known: model.peer != nil
            )
        case .saved:
            return nil
        default:
            return chat.memberCount > 0 ? ChatPlural.members(chat.memberCount) : nil
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
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.sm)
            .contentShape(Rectangle())
            .chatPanelSurface()
            .padding(.top, Spacing.xs)
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
                .glassButton()
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
                .glassProminentButton()
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

/// Аватар чата справа в шапке — ведёт в информацию о чате. На iOS 26 без общей
/// стеклянной подложки панели: круглое фото само по себе, как в Telegram.
private struct ChatAvatarToolbarItem: ToolbarContent {
    let chatID: String
    let chat: ChatRecord?
    let title: String?

    @ScaledMetric(relativeTo: .body) private var size: CGFloat = 36

    var body: some ToolbarContent {
        #if compiler(>=6.2)
            if #available(iOS 26, *) {
                item.sharedBackgroundVisibility(.hidden)
            } else {
                item
            }
        #else
            item
        #endif
    }

    private var item: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            NavigationLink(value: AppRoute.chatInfo(id: chatID)) {
                ChatAvatarView(
                    title: title ?? ChatTitle.fallback(for: chat),
                    kind: chat?.kind ?? .unknown,
                    avatarURL: chat?.avatarUrl,
                    size: min(size, 44)
                )
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(String(localized: "chats.info.open", defaultValue: "Информация о чате")))
        }
    }
}

/// Кнопка «вниз» в стеклянном круге; сверху — синяя капсула с числом пришедшего,
/// пока человек листал вверх.
private struct ChatScrollDownButton: View {
    let count: Int
    let action: () -> Void

    @ScaledMetric(relativeTo: .body) private var size: CGFloat = 40

    var body: some View {
        Button(action: action) {
            Image(systemName: "chevron.down")
                .font(.body.weight(.semibold))
                .foregroundStyle(Palette.mutedForeground)
                .frame(width: min(size, 56), height: min(size, 56))
                .floatingGlass(in: Circle())
                .overlay(alignment: .top) {
                    if count > 0 {
                        Text(verbatim: count > 999 ? "999+" : count.formatted())
                            .font(Typography.tabular(.caption).weight(.semibold))
                            .foregroundStyle(Palette.primaryForeground)
                            .padding(.horizontal, Spacing.sm)
                            .frame(minWidth: 20, minHeight: 20)
                            .background(Palette.primary, in: Capsule())
                            .offset(y: -12)
                    }
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(String(localized: "chats.scrollDown", defaultValue: "К последним сообщениям")))
        .accessibilityValue(count > 0
            ? Text(String(localized: "chats.unreadCount", defaultValue: "Непрочитанных: \(count.formatted())"))
            : Text(verbatim: ""))
    }
}

/// Имя файла для просмотра: по расширению система понимает, чем его показать. У фото из
/// камеры имени нет — берём расширение из типа.
enum AttachmentFileName {
    static func of(_ file: AttachmentRecord) -> String {
        if let name = file.name, !name.isEmpty { return name }
        let ext = UTType(mimeType: file.mime)?.preferredFilenameExtension ?? "bin"
        return "\(file.id).\(ext)"
    }
}
