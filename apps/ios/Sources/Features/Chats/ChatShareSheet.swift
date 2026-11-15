import Photos
import SwiftUI
import UniformTypeIdentifiers

/// Лист «Поделиться» как в Telegram: сверху — закрыть, заголовок и системное
/// «Поделиться», под ними — поиск, ниже — сетка чатов с аватарами («Избранное» первым,
/// дальше по свежести), выбор нескольких галочками. Выбрали — поле «Подпись…» и
/// «Отправить N»; ничего не выбрано — «Сохранить в галерею» (если пересылаются медиа).
///
/// Им же открывается «Переслать» из меню сообщения и из режима выбора.
///
/// Повторное нажатие и сетевой повтор не дублируют сообщения: ключ идемпотентности
/// создаётся один раз на лист и уходит с каждой попыткой (сервер отдаёт прежний ответ).
struct ChatShareSheet: View {
    /// Пересылка сообщений: сколько и что именно (для предпросмотра в параметрах).
    /// `nil` — лист «Поделиться» (медиа из просмотрщика): сетка аватаров без параметров.
    struct ForwardContext {
        struct Line: Identifiable {
            let id: String
            let sender: String
            let text: String
        }

        let count: Int
        let preview: [Line]
    }

    let send: (_ chatIDs: [String], _ comment: String?, _ hideSender: Bool, _ requestID: UUID) async -> ForwardOutcome
    /// Файлы для системного «Поделиться» и «Сохранить в галерею»; `nil` — медиа нет.
    var exportFiles: (() async throws -> [URL])?
    /// Текст для системного «Поделиться», когда файлов нет.
    var shareText: String?
    var forward: ForwardContext?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.motionReduced) private var reduceMotion
    @State private var rows: [ChatListRow] = []
    /// База прочитана — до этого пустой список не значит «чатов нет».
    @State private var loaded = false
    @State private var selected: [String] = []
    @State private var query = ""
    @State private var comment = ""
    @State private var isSending = false
    @State private var isExporting = false
    @State private var failure: String?
    @State private var sentTick = 0
    @State private var savedTick = 0
    @State private var systemShare: SharePayload?
    /// Один ключ на лист: повтор после сбоя сети сервер узнает и не отправит второй раз.
    @State private var requestID = UUID()
    // Пересылка: вкладка-папка, имена отправителей, эмодзи в комментарии, параметры.
    @State private var tab: ChatListTab = .all
    @State private var folders = ChatFoldersModel()
    @State private var hideSender = false
    @State private var showsEmoji = false
    @State private var showsOptions = false

    var body: some View {
        if let forward {
            forwardBody(forward)
        } else {
            shareBody
        }
    }

    private var shareBody: some View {
        VStack(spacing: Spacing.md) {
            header
            ExpressionSearchField(
                query: $query,
                prompt: String(localized: "chats.forward.search", defaultValue: "Поиск")
            )
            .padding(.horizontal, Spacing.xl)
            grid
        }
        .padding(.top, Spacing.lg)
        .safeAreaInset(edge: .bottom, spacing: 0) { bottomPanel }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(isSending)
        .sensoryFeedback(.success, trigger: sentTick)
        .sensoryFeedback(.success, trigger: savedTick)
        .sensoryFeedback(.selection, trigger: selected)
        .sheet(item: $systemShare) { payload in
            ShareSheet(items: payload.items)
                .presentationDetents([.medium, .large])
        }
        .task { await load() }
    }

    // MARK: Шапка

    private var header: some View {
        HStack(spacing: Spacing.md) {
            GlassCloseButton { dismiss() }
            VStack(spacing: 0) {
                Text(String(localized: "chats.share.title", defaultValue: "Поделиться"))
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.foreground)
                Text(subtitle)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .combine)
            Button {
                Task { await openSystemShare() }
            } label: {
                ZStack {
                    if isExporting {
                        ProgressView()
                    } else {
                        Image(systemName: "square.and.arrow.up")
                            .font(.body.weight(.semibold))
                            .foregroundStyle(Palette.foreground)
                    }
                }
                .frame(width: ControlHeight.xl, height: ControlHeight.xl)
                .floatingGlass(in: Circle())
                .contentShape(Circle())
            }
            .buttonStyle(.pressableIcon)
            .disabled(isExporting || (exportFiles == nil && shareText?.isEmpty != false))
            .accessibilityLabel(Text(String(localized: "chats.share.system", defaultValue: "Поделиться через…")))
        }
        .padding(.horizontal, Spacing.xl)
    }

    /// Под заголовком — кого выбрали, как в Telegram; пока никого — подсказка.
    private var subtitle: String {
        let names = selected.compactMap { id in rows.first { $0.id == id }?.displayTitle }
        return names.isEmpty
            ? String(localized: "chats.share.pick", defaultValue: "Выберите чаты")
            : names.joined(separator: ", ")
    }

    // MARK: Сетка

    private static let columns = [GridItem(.adaptive(minimum: 64, maximum: 84), spacing: Spacing.sm, alignment: .top)]

    private var grid: some View {
        ScrollView {
            LazyVGrid(columns: Self.columns, spacing: Spacing.lg) {
                ForEach(filtered) { row in
                    Button {
                        toggle(row.id)
                    } label: {
                        ShareTargetCell(row: row, isSelected: selected.contains(row.id))
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(selected.contains(row.id) ? .isSelected : [])
                }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.lg)
        }
        .scrollDismissesKeyboard(.immediately)
        .overlay {
            if loaded, filtered.isEmpty {
                EmptyStateView(
                    title: query.trimmingCharacters(in: .whitespaces).isEmpty
                        ? String(localized: "chats.empty", defaultValue: "Чатов пока нет")
                        : String(localized: "services.notFound", defaultValue: "Ничего не нашлось"),
                    symbol: query.trimmingCharacters(in: .whitespaces).isEmpty ? "bubble.left.and.bubble.right" : "magnifyingglass"
                )
            }
        }
    }

    // MARK: Нижняя панель

    @ViewBuilder
    private var bottomPanel: some View {
        VStack(spacing: Spacing.sm) {
            if let failure {
                Text(failure)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.destructive)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if !selected.isEmpty {
                TextField(
                    text: $comment,
                    prompt: Text(String(localized: "chats.share.caption", defaultValue: "Подпись…")),
                    axis: .vertical
                ) {
                    Text(String(localized: "chats.share.caption", defaultValue: "Подпись…"))
                }
                .lineLimit(1...4)
                .font(Typography.body)
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.md)
                .frame(minHeight: ControlHeight.lg)
                .composerGlass(in: RoundedRectangle(cornerRadius: ControlHeight.lg / 2, style: .continuous))
                .transition(.move(edge: .bottom).combined(with: .opacity))

                Button {
                    Task { await submit() }
                } label: {
                    HStack(spacing: Spacing.sm) {
                        Text(String(localized: "chats.send", defaultValue: "Отправить"))
                        Text(verbatim: selected.count.formatted())
                            .font(Typography.meta.weight(.bold))
                            .foregroundStyle(Palette.primary)
                            .padding(.horizontal, Spacing.sm)
                            .frame(minWidth: 22, minHeight: 22)
                            .background(Palette.primaryForeground, in: Capsule())
                    }
                }
                .buttonStyle(PrimaryButtonStyle(isLoading: isSending))
                .disabled(isSending)
            } else if exportFiles != nil {
                Button {
                    Task { await saveToGallery() }
                } label: {
                    Text(String(localized: "chats.share.saveToGallery", defaultValue: "Сохранить в галерею"))
                }
                .buttonStyle(PrimaryButtonStyle(isLoading: isExporting))
                .disabled(isExporting)
            }
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.md)
        .animation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion), value: selected.isEmpty)
    }

    // MARK: Выбор и отправка

    private func toggle(_ id: String) {
        failure = nil
        if let index = selected.firstIndex(of: id) {
            selected.remove(at: index)
        } else {
            selected.append(id)
        }
    }

    private func submit() async {
        guard !selected.isEmpty, !isSending else { return }
        isSending = true
        failure = nil
        let trimmed = comment.trimmingCharacters(in: .whitespacesAndNewlines)
        let outcome = await send(selected, trimmed.isEmpty ? nil : String(trimmed.prefix(4000)), hideSender, requestID)
        isSending = false
        if outcome.isComplete {
            sentTick += 1
            dismiss()
            return
        }
        if let message = outcome.failure {
            // Сеть или сервер: повтор пойдёт с тем же ключом и не задвоит пересланное.
            failure = message
            return
        }
        // Часть чатов отказала: дошедшие убираем из выбора, новая попытка — новый ключ
        // (прежний запрос сервер уже завершил и повторил бы его ответ).
        selected.removeAll { outcome.delivered.contains($0) }
        requestID = UUID()
        failure = String(
            localized: "chats.forward.partial",
            defaultValue: "Не удалось переслать в некоторые чаты — они остались отмеченными"
        )
    }

    private func openSystemShare() async {
        failure = nil
        if let exportFiles {
            isExporting = true
            defer { isExporting = false }
            do {
                systemShare = SharePayload(items: try await exportFiles())
            } catch is CancellationError {
                return
            } catch {
                failure = error.userMessage
            }
        } else if let shareText, !shareText.isEmpty {
            systemShare = SharePayload(items: [shareText])
        }
    }

    private func saveToGallery() async {
        guard let exportFiles else { return }
        failure = nil
        isExporting = true
        defer { isExporting = false }
        do {
            try await PhotoLibrarySaver.save(try await exportFiles())
            savedTick += 1
            dismiss()
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
        }
    }

    // MARK: Данные

    private var filtered: [ChatListRow] {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return rows }
        return rows.filter { $0.displayTitle.localizedCaseInsensitiveContains(trimmed) }
    }

    /// Список читается из базы: делятся в знакомые чаты, а сеть для выбора не нужна.
    private func load() async {
        let all = (try? await ChatListQueries(database: AppServices.database).fetchRows(for: tab)) ?? []
        rows = Self.ordered(all)
        loaded = true
    }

    /// «Избранное» первым, дальше — по свежести последнего сообщения, как в Telegram:
    /// закрепление в этом листе не важно. Туда, где висит непринятый запрос, писать нельзя.
    static func ordered(_ all: [ChatListRow]) -> [ChatListRow] {
        let writable = all.filter { !$0.requestIncoming }
        let saved = writable.filter { $0.kind == .saved }
        let rest = writable
            .filter { $0.kind != .saved }
            .sorted { ($0.lastCreatedAt ?? $0.updatedAt) > ($1.lastCreatedAt ?? $1.updatedAt) }
        return saved + rest
    }

    private struct SharePayload: Identifiable {
        let id = UUID()
        let items: [Any]
    }
}

// MARK: - Режим «Переслать»

extension ChatShareSheet {
    /// Вкладки над списком: все, личные, группы и свои папки пользователя.
    private var tabs: [ChatListTab] {
        [.all, .personal, .groups] + folders.folders.map { .folder(id: $0.id, name: $0.name) }
    }

    private func title(of tab: ChatListTab) -> String {
        switch tab {
        case .all: String(localized: "chats.tab.all", defaultValue: "Все")
        case .personal: String(localized: "chats.tab.personal", defaultValue: "Личные")
        case .groups: String(localized: "chats.tab.groups", defaultValue: "Группы")
        case .folder(_, let name): name
        default: ""
        }
    }

    @ViewBuilder
    fileprivate func forwardBody(_ context: ForwardContext) -> some View {
        VStack(spacing: Spacing.md) {
            HStack(spacing: Spacing.md) {
                GlassCloseButton { dismiss() }
                    .accessibilityIdentifier("chat.forward.close")
                VStack(spacing: 0) {
                    Text(String(localized: "chats.forward", defaultValue: "Переслать"))
                        .font(Typography.body.weight(.semibold))
                        .foregroundStyle(Palette.foreground)
                    Text(subtitle)
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("chat.forward.title")
                // Симметрия с крестиком — заголовок по центру.
                Color.clear.frame(width: ControlHeight.xl, height: ControlHeight.xl)
            }
            .padding(.horizontal, Spacing.xl)

            ExpressionSearchField(
                query: $query,
                prompt: String(localized: "chats.forward.search", defaultValue: "Поиск")
            )
            .padding(.horizontal, Spacing.xl)
            .accessibilityIdentifier("chat.forward.search")

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.sm) {
                    ForEach(tabs, id: \.self) { item in
                        let active = item == tab
                        Button {
                            guard item != tab else { return }
                            tab = item
                            Task { await load() }
                        } label: {
                            Text(title(of: item))
                                .font(Typography.meta.weight(active ? .semibold : .regular))
                                .foregroundStyle(active ? Palette.primaryForeground : Palette.foreground)
                                .padding(.horizontal, Spacing.lg)
                                .padding(.vertical, Spacing.sm)
                                .background(Capsule().fill(active ? Palette.primary : Palette.muted))
                        }
                        .buttonStyle(.pressable)
                        .accessibilityAddTraits(active ? .isSelected : [])
                        .accessibilityIdentifier("chat.forward.tab.\(title(of: item))")
                    }
                }
                .padding(.horizontal, Spacing.xl)
            }

            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(filtered) { row in
                        Button {
                            toggle(row.id)
                        } label: {
                            ForwardTargetRow(row: row, isSelected: selected.contains(row.id))
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(selected.contains(row.id) ? .isSelected : [])
                        .accessibilityIdentifier("chat.forward.row.\(row.id)")
                    }
                }
                .padding(.bottom, Spacing.lg)
            }
            .scrollDismissesKeyboard(.interactively)
            .overlay {
                if loaded, filtered.isEmpty {
                    EmptyStateView(
                        title: query.trimmingCharacters(in: .whitespaces).isEmpty
                            ? String(localized: "chats.empty", defaultValue: "Чатов пока нет")
                            : String(localized: "services.notFound", defaultValue: "Ничего не нашлось"),
                        symbol: "magnifyingglass"
                    )
                }
            }
        }
        .padding(.top, Spacing.lg)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !selected.isEmpty {
                forwardPanel(context)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(Motion.respecting(Motion.lively, reduceMotion: reduceMotion), value: selected.isEmpty)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(isSending)
        .sensoryFeedback(.success, trigger: sentTick)
        .sensoryFeedback(.selection, trigger: selected)
        .sheet(isPresented: $showsOptions) {
            ForwardOptionsView(context: context, hideSender: $hideSender)
                .presentationDetents([.medium, .large])
        }
        .task {
            folders.start()
            await load()
        }
        .accessibilityIdentifier("chat.forward")
    }

    /// Блок над клавиатурой: «Переслать N сообщений» и режим имён, ниже — комментарий.
    private func forwardPanel(_ context: ForwardContext) -> some View {
        VStack(spacing: Spacing.sm) {
            if let failure {
                Text(failure)
                    .font(Typography.meta)
                    .foregroundStyle(Palette.destructive)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("chat.forward.failure")
            }
            Button {
                showsOptions = true
            } label: {
                HStack(spacing: Spacing.md) {
                    Image(systemName: "arrowshape.turn.up.right.fill")
                        .foregroundStyle(Palette.primary)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(ChatPlural.forwardTitle(context.count))
                            .font(Typography.meta.weight(.semibold))
                            .foregroundStyle(Palette.primary)
                        Text(hideSender
                            ? String(localized: "chats.forward.namesHidden", defaultValue: "Имена отправителей скрыты")
                            : String(localized: "chats.forward.namesShown", defaultValue: "Имена отправителей видны"))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Palette.mutedForeground)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("chat.forward.options")

            HStack(alignment: .bottom, spacing: Spacing.sm) {
                HStack(alignment: .bottom, spacing: Spacing.xs) {
                    EmojiTextField(
                        text: $comment,
                        showsEmoji: $showsEmoji,
                        placeholder: String(localized: "chats.forward.comment", defaultValue: "Добавить комментарий…"),
                        accessibilityID: "chat.forward.comment"
                    )
                    Button {
                        showsEmoji.toggle()
                    } label: {
                        Image(systemName: showsEmoji ? "keyboard" : "face.smiling")
                            .font(.title3)
                            .foregroundStyle(Palette.mutedForeground)
                            .frame(width: 32, height: 36)
                    }
                    .accessibilityLabel(Text(showsEmoji
                        ? String(localized: "chats.keyboard", defaultValue: "Клавиатура")
                        : String(localized: "chats.emoji", defaultValue: "Эмодзи")))
                    .accessibilityIdentifier("chat.forward.emoji")
                }
                .padding(.leading, Spacing.lg)
                .padding(.trailing, Spacing.xs)
                .composerGlass(in: RoundedRectangle(cornerRadius: ControlHeight.lg / 2, style: .continuous))

                Button {
                    Task { await submit() }
                } label: {
                    ZStack {
                        Circle().fill(Palette.primary)
                        if isSending {
                            ProgressView().tint(Palette.primaryForeground)
                        } else {
                            Image(systemName: "arrow.up")
                                .font(.body.weight(.bold))
                                .foregroundStyle(Palette.primaryForeground)
                        }
                    }
                    .frame(width: ControlHeight.lg, height: ControlHeight.lg)
                }
                .buttonStyle(.pressableIcon)
                .disabled(isSending)
                .accessibilityLabel(Text(String(localized: "chats.send", defaultValue: "Отправить")))
                .accessibilityIdentifier("chat.forward.send")
            }
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.md)
        .background(.bar)
    }
}

/// Получатель пересылки строкой: аватар, имя, вторая строка, круглая отметка справа.
private struct ForwardTargetRow: View {
    let row: ChatListRow
    let isSelected: Bool

    var body: some View {
        HStack(spacing: Spacing.lg) {
            ChatAvatarView(title: row.title ?? row.displayTitle, kind: row.kind, avatarURL: row.avatarUrl, online: row.online, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.displayTitle)
                    .font(Typography.body.weight(.medium))
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(1)
                if let secondary {
                    Text(secondary)
                        .font(Typography.meta)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: Spacing.md)
            ZStack {
                Circle().strokeBorder(Palette.border, lineWidth: 1.5).opacity(isSelected ? 0 : 1)
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .resizable()
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(Palette.primaryForeground, Palette.primary)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .frame(width: 24, height: 24)
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.sm)
        .contentShape(Rectangle())
        .animation(Motion.isReducedNow ? nil : Motion.lively, value: isSelected)
        .accessibilityElement(children: .combine)
        .accessibilityValue(Text(isSelected ? String(localized: "chats.forward.selected", defaultValue: "Выбран") : ""))
    }

    /// Вторая строка: «в сети» у собеседника, «Группа» или «Избранное».
    private var secondary: String? {
        switch row.kind {
        case .saved: return String(localized: "chats.saved.subtitle", defaultValue: "Избранное")
        case .private: return row.online ? String(localized: "chats.online", defaultValue: "в сети") : nil
        case .group, .groupOfficial, .subject, .faculty, .dean, .event:
            return String(localized: "chats.forward.kind.group", defaultValue: "Группа")
        default: return nil
        }
    }
}

/// Параметры пересылки: предпросмотр и «показать / скрыть имя отправителя». Смена сразу
/// видна в предпросмотре; получатели и комментарий листа не трогаются.
struct ForwardOptionsView: View {
    let context: ChatShareSheet.ForwardContext
    @Binding var hideSender: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        ForEach(context.preview.prefix(3)) { line in
                            VStack(alignment: .leading, spacing: 2) {
                                if !hideSender {
                                    Text(String(localized: "chats.forward.from", defaultValue: "Переслано от \(line.sender)"))
                                        .font(Typography.meta.weight(.semibold))
                                        .foregroundStyle(Palette.primary)
                                        .transition(.opacity)
                                }
                                Text(line.text)
                                    .font(Typography.meta)
                                    .foregroundStyle(Palette.foreground)
                                    .lineLimit(2)
                            }
                            .padding(Spacing.md)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Palette.muted, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
                        }
                        Text(ChatPlural.forwardMessages(context.count))
                            .font(Typography.meta)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    .animation(Motion.isReducedNow ? nil : Motion.lively, value: hideSender)
                    .accessibilityIdentifier("chat.forward.preview")
                }
                Section {
                    option(String(localized: "chats.forward.showNames", defaultValue: "Показать имя отправителя"), selected: !hideSender, id: "show") {
                        hideSender = false
                    }
                    option(String(localized: "chats.forward.hideNames", defaultValue: "Скрыть имя отправителя"), selected: hideSender, id: "hide") {
                        hideSender = true
                    }
                }
            }
            .navigationTitle(Text(String(localized: "chats.forward.options", defaultValue: "Параметры пересылки")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "common.done", defaultValue: "Готово")) { dismiss() }
                        .accessibilityIdentifier("chat.forward.options.done")
                }
            }
        }
    }

    private func option(_ title: String, selected: Bool, id: String, action: @escaping () -> Void) -> some View {
        Button(action: {
            Haptics.tap()
            action()
        }) {
            HStack {
                Text(title).foregroundStyle(Palette.foreground)
                Spacer()
                if selected {
                    Image(systemName: "checkmark").foregroundStyle(Palette.primary).font(.body.weight(.semibold))
                }
            }
        }
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("chat.forward.names.\(id)")
    }
}

/// Чат в сетке: аватар с галочкой выбора и подпись в две строки.
private struct ShareTargetCell: View {
    let row: ChatListRow
    let isSelected: Bool

    private static let avatar: CGFloat = 60

    var body: some View {
        VStack(spacing: Spacing.xs) {
            ChatAvatarView(title: row.title ?? row.displayTitle, kind: row.kind, avatarURL: row.avatarUrl, size: Self.avatar)
                .padding(3)
                .overlay {
                    Circle()
                        .strokeBorder(Palette.primary, lineWidth: 2)
                        .opacity(isSelected ? 1 : 0)
                }
                .overlay(alignment: .bottomTrailing) {
                    if isSelected {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.title3)
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(Palette.primaryForeground, Palette.primary)
                            .background(Circle().fill(Palette.background).padding(2))
                            .transition(.scale.combined(with: .opacity))
                    }
                }
            Text(row.displayTitle)
                .font(Typography.meta)
                .foregroundStyle(isSelected ? Palette.primary : Palette.foreground)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .frame(maxWidth: .infinity)
        }
        .contentShape(Rectangle())
        .animation(Motion.isReducedNow ? nil : Motion.lively, value: isSelected)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - «Фото»

/// Сохранение снимков и роликов в «Фото». Видео или снимок — по расширению файла.
enum PhotoLibrarySaver {
    struct Denied: LocalizedError {
        var errorDescription: String? {
            String(localized: "media.photosDenied", defaultValue: "Нет доступа к «Фото». Разрешите его в Настройках")
        }
    }

    static func save(_ files: [URL]) async throws {
        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else { throw Denied() }
        try await PHPhotoLibrary.shared().performChanges {
            for file in files {
                if UTType(filenameExtension: file.pathExtension)?.conforms(to: .movie) == true {
                    PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: file)
                } else {
                    PHAssetChangeRequest.creationRequestForAssetFromImage(atFileURL: file)
                }
            }
        }
    }
}
